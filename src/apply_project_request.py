from __future__ import annotations

import json
import os
import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
REGISTRY_PATH = ROOT / "projects.json"


def clean_text(value: object, name: str, maximum: int) -> str:
    result = str(value or "").strip()
    if not result or len(result) > maximum:
        raise ValueError(f"Invalid {name}")
    return result


def main() -> None:
    body = os.environ.get("ISSUE_BODY", "")
    match = re.search(
        r"FEED_PROJECT_JSON_START\s*(\{.*?\})\s*FEED_PROJECT_JSON_END",
        body,
        flags=re.DOTALL,
    )
    if not match:
        raise SystemExit("Project JSON markers were not found in the issue body")
    try:
        payload = json.loads(match.group(1))
        if payload.get("version") != 1:
            raise ValueError("Unsupported project format")
        slug = clean_text(payload.get("slug"), "slug", 48)
        if not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", slug):
            raise ValueError("Project slug must contain lowercase Latin letters, digits and hyphens")
        name = clean_text(payload.get("name"), "name", 80)
        registry = json.loads(REGISTRY_PATH.read_text(encoding="utf-8"))
        if any(item.get("slug") == slug for item in registry["projects"]):
            raise ValueError("A project with this slug already exists")
    except (ValueError, TypeError, json.JSONDecodeError) as error:
        raise SystemExit(f"Invalid project request: {error}") from error

    project_dir = ROOT / "projects" / slug
    assets_dir = project_dir / "assets"
    assets_dir.mkdir(parents=True, exist_ok=False)
    (assets_dir / ".gitkeep").write_text("", encoding="utf-8")
    config = {
        "project": name,
        "source_feed_key": slug,
        "public_image_base_url": (
            "https://indigo-dm.github.io/novyy-gorizont-feed/"
            f"projects/{slug}/images"
        ),
        "brand": {
            "green": "#00605C",
            "green_dark": "#004C49",
            "gold": "#CEAD75",
            "white": "#FFFFFF",
            "font": "Manrope",
            "logo": "logo.svg",
            "key_render": "key-render.jpg",
        },
        "houses": {},
    }
    rules = {
        "version": 2,
        "rules": [],
        "image_settings": {
            "lot_overrides": {},
            "bulk_rules": [],
        },
        "parameter_settings": {
            "lot_values": {},
            "bulk_rules": [],
        },
    }
    (project_dir / "config.json").write_text(
        json.dumps(config, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    (project_dir / "promotion-rules.json").write_text(
        json.dumps(rules, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    registry["projects"].append({
        "slug": slug,
        "name": name,
        "status": "setup",
        "source_feed_key": slug,
        "compatibility_root": False,
    })
    REGISTRY_PATH.write_text(
        json.dumps(registry, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(json.dumps({"slug": slug, "name": name, "status": "setup"}, ensure_ascii=False))


if __name__ == "__main__":
    main()
