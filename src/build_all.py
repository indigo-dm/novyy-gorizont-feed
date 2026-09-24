from __future__ import annotations

import json
import os
import subprocess
import sys

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
    fallback_url = os.environ.get("PROFITBASE_FEED_URL", "").strip()
    run([sys.executable, "src/prepare_site.py"], os.environ.copy())

    public_projects: list[dict[str, object]] = []
    node = os.environ.get("NODE_BINARY", "node")
    for project in REGISTRY["projects"]:
        slug = str(project["slug"])
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
        env = os.environ.copy()
        env["PROJECT_SLUG"] = slug
        env["PROFITBASE_FEED_URL"] = feed_url
        run([sys.executable, "src/fetch_feed.py"], env)
        run([sys.executable, "src/build_pilot.py"], env)
        run([node, "src/render_pilot.cjs"], env)
        run([sys.executable, "src/validate_pilot.py"], env)
        run([sys.executable, "src/build_site.py"], env)

    if not any(item["available"] for item in public_projects):
        raise RuntimeError("No configured project feeds were available")
    public_registry = {
        "version": 1,
        "default_project": default_slug,
        "projects": public_projects,
    }
    (ROOT / "site" / "projects.json").write_text(
        json.dumps(public_registry, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(json.dumps(public_registry, ensure_ascii=False))


if __name__ == "__main__":
    main()
