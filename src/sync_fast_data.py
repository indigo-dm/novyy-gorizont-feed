from __future__ import annotations

import argparse
import json
import shutil
from pathlib import Path


PROJECT_FILES = (
    "inventory.json",
    "settings.json",
    "status.json",
    "assets.json",
    "source-profitbase.xml",
    "avito.xml",
    "pilot-avito.xml",
)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", required=True)
    parser.add_argument("--destination", required=True)
    parser.add_argument("--project")
    args = parser.parse_args()

    source = Path(args.source).resolve()
    destination = Path(args.destination).resolve()
    registry = json.loads((source / "projects.json").read_text(encoding="utf-8"))
    selected = {args.project} if args.project else {
        str(item["slug"]) for item in registry["projects"] if item.get("available")
    }
    destination.mkdir(parents=True, exist_ok=True)
    projects_destination = destination / "projects"
    projects_destination.mkdir(parents=True, exist_ok=True)

    existing_registry_path = destination / "projects.json"
    if existing_registry_path.exists():
        existing = json.loads(existing_registry_path.read_text(encoding="utf-8"))
        existing_by_slug = {str(item["slug"]): item for item in existing.get("projects", [])}
        for item in registry["projects"]:
            previous = existing_by_slug.get(str(item["slug"]))
            if previous and str(item["slug"]) not in selected:
                item["available"] = bool(previous.get("available"))

    for slug in sorted(selected):
        source_project = source / "projects" / slug
        if not source_project.is_dir():
            raise FileNotFoundError(f"Fast data is missing for project {slug}")
        target_project = projects_destination / slug
        target_project.mkdir(parents=True, exist_ok=True)
        for filename in PROJECT_FILES:
            shutil.copy2(source_project / filename, target_project / filename)
        legacy_feed = target_project / "full-avito-demo.xml"
        if legacy_feed.exists():
            legacy_feed.unlink()

    existing_registry_path.write_text(
        json.dumps(registry, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(json.dumps({"projects": sorted(selected), "destination": str(destination)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
