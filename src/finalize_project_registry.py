from __future__ import annotations

import argparse
import json
import shutil
from datetime import datetime, timezone
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", required=True)
    parser.add_argument("--published", required=True)
    parser.add_argument("--registry", required=True)
    parser.add_argument("--build-id", default="")
    args = parser.parse_args()

    source = Path(args.source).resolve()
    published = Path(args.published).resolve()
    configured = json.loads(Path(args.registry).read_text(encoding="utf-8"))
    previous_path = published / "projects.json"
    previous = json.loads(previous_path.read_text(encoding="utf-8")) if previous_path.is_file() else {"projects": []}
    previous_by_slug = {str(item["slug"]): item for item in previous.get("projects", [])}

    projects: list[dict[str, object]] = []
    built: list[str] = []
    for project in configured.get("projects", []):
        slug = str(project["slug"])
        project_dir = source / "projects" / slug
        artifact_dir = source / "artifacts" / f"feed-project-{slug}"
        if artifact_dir.is_dir():
            shutil.copytree(artifact_dir, project_dir, dirs_exist_ok=True)
        available = (project_dir / "inventory.json").is_file()
        if available:
            built.append(slug)
        else:
            available = bool(previous_by_slug.get(slug, {}).get("available"))
        projects.append({
            "slug": slug,
            "name": project["name"],
            "status": project.get("status", "setup"),
            "available": available,
            "base": f"projects/{slug}",
        })

    expected = {
        str(project["slug"])
        for project in configured.get("projects", [])
        if project.get("source_feed_key") or project.get("source_feed_secret")
    }
    missing = sorted(expected - set(built))
    if missing:
        raise RuntimeError("Build artifacts are missing for projects: " + ", ".join(missing))

    registry = {
        "version": 1,
        "build_id": args.build_id.strip() or datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S"),
        "default_project": configured["default_project"],
        "projects": projects,
    }
    source.mkdir(parents=True, exist_ok=True)
    (source / "projects.json").write_text(
        json.dumps(registry, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(json.dumps({"built": built, "build_id": registry["build_id"]}, ensure_ascii=False))


if __name__ == "__main__":
    main()
