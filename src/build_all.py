from __future__ import annotations

import json
import os
import subprocess
import sys
from datetime import datetime, timezone

from project_context import REGISTRY, ROOT


def run(command: list[str], env: dict[str, str]) -> None:
    subprocess.run(command, cwd=ROOT, env=env, check=True)


def main() -> None:
    feeds: dict[str, str] = {}
    raw_feeds = os.environ.get("PROFITBASE_FEEDS_JSON", "").strip()
    if raw_feeds:
        parsed = json.loads(raw_feeds)
        if not isinstance(parsed, dict):
            raise ValueError("PROFITBASE_FEEDS_JSON must be a JSON object")
        feeds = {str(key): str(value).strip() for key, value in parsed.items() if str(value).strip()}

    default_slug = str(REGISTRY["default_project"])
    build_id = os.environ.get("BUILD_ID", "").strip() or datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")
    fallback_url = os.environ.get("PROFITBASE_FEED_URL", "").strip()
    requested_slug = os.environ.get("PROJECT_SLUG", "").strip()
    if requested_slug and not any(str(item["slug"]) == requested_slug for item in REGISTRY["projects"]):
        raise ValueError(f"Unknown project: {requested_slug}")
    build_env = os.environ.copy()
    build_env["BUILD_ID"] = build_id
    if os.environ.get("SITE_PREPARED") != "1":
        run([sys.executable, "src/prepare_site.py"], build_env)

    public_projects: list[dict[str, object]] = []
    attempted_projects: list[str] = []
    built_projects: list[str] = []
    failed_projects: list[str] = []
    node = os.environ.get("NODE_BINARY", "node")
    for project in REGISTRY["projects"]:
        slug = str(project["slug"])
        if requested_slug and slug != requested_slug:
            continue
        feed_url = feeds.get(slug, "") or (fallback_url if slug == default_slug else "")
        available = bool(feed_url and project.get("status") == "active")
        public_projects.append({
            "slug": slug,
            "name": project["name"],
            "status": project.get("status", "setup"),
            "available": available,
            "base": f"projects/{slug}",
        })
        if not available:
            continue
        attempted_projects.append(slug)
        env = build_env.copy()
        env["PROJECT_SLUG"] = slug
        env["PROFITBASE_FEED_URL"] = feed_url
        try:
            run([sys.executable, "src/fetch_feed.py"], env)
        except subprocess.CalledProcessError:
            if requested_slug:
                raise
            failed_projects.append(slug)
            print(
                f"::warning title=Profitbase refresh skipped::{slug}: source feed download failed; "
                "the previously published project files will be kept",
                file=sys.stderr,
            )
            continue
        run([sys.executable, "src/build_pilot.py"], env)
        run([node, "src/render_pilot.cjs"], env)
        run([sys.executable, "src/validate_pilot.py"], env)
        run([sys.executable, "src/build_site.py"], env)
        built_projects.append(slug)

    if requested_slug:
        registry_path = ROOT / "site" / "projects.json"
        public_registry = json.loads(registry_path.read_text(encoding="utf-8")) if registry_path.is_file() else {
            "version": 1,
            "default_project": default_slug,
            "projects": [],
        }
        public_registry["build_id"] = build_id
        built = next((item for item in public_projects if item["slug"] == requested_slug), None)
        if built is None or not built["available"]:
            raise RuntimeError(f"Configured project feed is unavailable: {requested_slug}")
        for item in public_registry.get("projects", []):
            if item.get("slug") == requested_slug:
                item.update(built)
                break
        else:
            public_registry.setdefault("projects", []).append(built)
    else:
        if not attempted_projects:
            raise RuntimeError("No configured project feeds were available")
        if not built_projects:
            raise RuntimeError(
                "All configured project builds failed; previously published feeds remain unchanged"
            )
        public_registry = {
            "version": 1,
            "build_id": build_id,
            "default_project": default_slug,
            "projects": public_projects,
        }
    (ROOT / "site" / "projects.json").write_text(
        json.dumps(public_registry, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    if failed_projects:
        print(
            "Kept previous published files for failed projects: " + ", ".join(failed_projects),
            file=sys.stderr,
        )
    print(json.dumps(public_registry, ensure_ascii=False))


if __name__ == "__main__":
    main()
