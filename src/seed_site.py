from __future__ import annotations

import json
import os
import shutil
from pathlib import Path

from project_context import REGISTRY, ROOT


PUBLISHED = Path(os.environ.get("PUBLISHED_DATA_DIR", ROOT / ".feed-data" / "published"))
CACHE = Path(os.environ.get("RENDER_CACHE_DIR", ROOT / "render-cache"))
SITE = ROOT / "site"
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
    published_registry = json.loads((PUBLISHED / "projects.json").read_text(encoding="utf-8"))
    available = {
        str(item["slug"]): bool(item.get("available"))
        for item in published_registry.get("projects", [])
    }
    for project in REGISTRY["projects"]:
        slug = str(project["slug"])
        target = SITE / "projects" / slug
        target.mkdir(parents=True, exist_ok=True)
        cached = CACHE / slug
        for folder in ("images", "previews", "thumbnails"):
            source = cached / folder
            if source.is_dir():
                shutil.copytree(source, target / folder, dirs_exist_ok=True)
        assets = ROOT / "projects" / slug / "assets"
        if assets.is_dir():
            shutil.copytree(assets, target / "assets", dirs_exist_ok=True)
        published_project = PUBLISHED / "projects" / slug
        for filename in PROJECT_FILES:
            source = published_project / filename
            if source.is_file():
                shutil.copy2(source, target / filename)

    registry = {
        "version": 1,
        "build_id": published_registry.get("build_id", "seeded"),
        "default_project": REGISTRY["default_project"],
        "projects": [
            {
                "slug": item["slug"],
                "name": item["name"],
                "status": item.get("status", "setup"),
                "available": available.get(str(item["slug"]), False),
                "base": f"projects/{item['slug']}",
            }
            for item in REGISTRY["projects"]
        ],
    }
    (SITE / "projects.json").write_text(
        json.dumps(registry, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    default_project = next(
        item for item in REGISTRY["projects"] if item["slug"] == REGISTRY["default_project"]
    )
    if default_project.get("compatibility_root"):
        project_root = SITE / "projects" / str(default_project["slug"])
        for filename in PROJECT_FILES:
            source = project_root / filename
            if source.is_file():
                shutil.copy2(source, SITE / filename)
    print(json.dumps({"site": str(SITE), "projects": len(registry["projects"])}, ensure_ascii=False))


if __name__ == "__main__":
    main()
