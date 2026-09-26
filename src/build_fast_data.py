from __future__ import annotations

import json
import os
import shutil
from datetime import datetime, timezone
from pathlib import Path

from parameter_catalog import PARAMETER_CATALOG
from project_context import (
    ASSETS_DIR,
    CONFIG_PATH,
    INPUT_DIR,
    OUTPUT_DIR,
    PROJECT,
    PROJECT_SLUG,
    REGISTRY,
    ROOT,
    RULES_PATH,
)


FAST_SITE = Path(os.environ.get("FAST_SITE_DIR", ROOT / "fast-site"))
PROJECT_SITE = FAST_SITE / "projects" / PROJECT_SLUG
PAGES_ROOT = os.environ.get(
    "FEED_ASSET_PUBLIC_ROOT",
    "https://indigo-dm.github.io/novyy-gorizont-feed",
).rstrip("/")
DATA_ROOT = os.environ.get(
    "FEED_DATA_PUBLIC_ROOT",
    "https://indigo-feed-studio-upload.indigo-dm-tech.workers.dev/data",
).rstrip("/")


def absolute_asset(path: str) -> str:
    return f"{PAGES_ROOT}/{path.lstrip('/')}"


manifest = json.loads((OUTPUT_DIR / "full-manifest.json").read_text(encoding="utf-8"))
rules = json.loads(RULES_PATH.read_text(encoding="utf-8"))
config = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))

PROJECT_SITE.mkdir(parents=True, exist_ok=True)
shutil.copy2(OUTPUT_DIR / "pilot-avito.xml", PROJECT_SITE / "pilot-avito.xml")
shutil.copy2(OUTPUT_DIR / "full-avito-demo.xml", PROJECT_SITE / "full-avito-demo.xml")
shutil.copy2(INPUT_DIR / "avito.xml", PROJECT_SITE / "source-profitbase.xml")

public_items = []
for item in manifest["items"]:
    prefix = f"projects/{PROJECT_SLUG}"
    public_items.append({
        "id": str(item["id"]),
        "house_id": str(item["house_id"]),
        "house": item["house"],
        "rooms": str(item["rooms"]),
        "area": str(item["area"]),
        "floor": str(item["floor"]),
        "floors": str(item["floors"]),
        "price": str(item["price"]),
        "decoration": item["decoration"],
        "image": absolute_asset(f"{prefix}/previews/{item['id']}.webp"),
        "thumbnail": absolute_asset(f"{prefix}/thumbnails/{item['id']}.webp"),
        "final_image": absolute_asset(f"{prefix}/images/{item['id']}.png"),
        "promotion": item.get("promotion"),
        "source_images": item.get("source_image_items", []),
        "feed_images": item.get("feed_images", []),
        "feed_parameters": item.get("feed_parameters", {}),
        "source_tags": item.get("source_tags", []),
    })

inventory = {
    "slug": PROJECT_SLUG,
    "project": manifest["project"],
    "checked_at": manifest["checked_at"],
    "source_ads": manifest["source_ads"],
    "full_ads": manifest["full_ads"],
    "unique_plans": manifest["unique_plans"],
    "source_tag_counts": manifest.get("source_tag_counts", {}),
    "parameter_catalog": PARAMETER_CATALOG,
    "items": public_items,
}
status = {
    "slug": PROJECT_SLUG,
    "project": manifest["project"],
    "checked_at": manifest["checked_at"],
    "source_ads": manifest["source_ads"],
    "full_ads": manifest["full_ads"],
    "unique_plans": manifest["unique_plans"],
    "active_promotions": sum(1 for rule in rules.get("rules", []) if rule.get("enabled")),
    "publish_ready": False,
    "mode": "fast-data",
}

brand_assets = [
    {
        "key": "logo",
        "name": "Логотип",
        "description": "Основной логотип объекта для карточек.",
        "filename": config["brand"].get("logo", "logo.svg"),
        "required": True,
    },
    {
        "key": "key_render",
        "name": "Ключевой рендер",
        "description": "Главное изображение проекта в левой части макета.",
        "filename": config["brand"].get("key_render", "key-render.jpg"),
        "required": True,
    },
]
for index, logo in enumerate(config["brand"].get("additional_logos", []), start=1):
    brand_assets.append({
        "key": f"additional_logo_{index}",
        "name": logo.get("name", f"Дополнительный логотип {index}"),
        "description": "Дополнительный вариант фирменного логотипа объекта.",
        "filename": logo["filename"],
        "required": False,
    })
for index, render in enumerate(config["brand"].get("additional_renders", []), start=1):
    brand_assets.append({
        "key": f"additional_render_{index}",
        "name": render.get("name", f"Дополнительный рендер {index}"),
        "description": "Дополнительный фирменный рендер объекта.",
        "filename": render["filename"],
        "required": False,
    })
for asset in brand_assets:
    path = ASSETS_DIR / asset["filename"]
    asset["exists"] = path.exists()
    asset["url"] = absolute_asset(f"projects/{PROJECT_SLUG}/assets/{asset['filename']}") if path.exists() else ""

assets_manifest = {
    "project": manifest["project"],
    "slug": PROJECT_SLUG,
    "upload_url": (
        "https://github.com/indigo-dm/novyy-gorizont-feed/upload/main/"
        f"projects/{PROJECT_SLUG}/assets"
    ),
    "upload_service_url": os.environ.get("FEED_STUDIO_UPLOAD_URL", "").strip(),
    "items": brand_assets,
    "brand": {
        "green": config["brand"]["green"],
        "green_dark": config["brand"]["green_dark"],
        "gold": config["brand"]["gold"],
        "gray": config["brand"].get("gray", "#9B9B9B"),
        "white": config["brand"].get("white", "#FFFFFF"),
        "font": config["brand"]["font"],
        "palette": config["brand"].get("palette"),
    },
}

for filename, payload in (
    ("inventory.json", inventory),
    ("settings.json", rules),
    ("status.json", status),
    ("assets.json", assets_manifest),
):
    (PROJECT_SITE / filename).write_text(
        json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8"
    )

registry_path = FAST_SITE / "projects.json"
if registry_path.exists():
    public_registry = json.loads(registry_path.read_text(encoding="utf-8"))
else:
    public_registry = {
        "version": 1,
        "build_id": os.environ.get("BUILD_ID", datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")),
        "default_project": REGISTRY["default_project"],
        "projects": [
            {
                "slug": item["slug"],
                "name": item["name"],
                "status": item.get("status", "setup"),
                "available": False,
                "base": f"{DATA_ROOT}/projects/{item['slug']}",
            }
            for item in REGISTRY["projects"]
        ],
    }
public_registry["build_id"] = os.environ.get(
    "BUILD_ID", datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")
)
for item in public_registry["projects"]:
    item["base"] = f"{DATA_ROOT}/projects/{item['slug']}"
    if item["slug"] == PROJECT_SLUG:
        item["available"] = True
FAST_SITE.mkdir(parents=True, exist_ok=True)
registry_path.write_text(
    json.dumps(public_registry, ensure_ascii=False, indent=2), encoding="utf-8"
)

print(json.dumps({"project": PROJECT_SLUG, "fast_site": str(PROJECT_SITE)}, ensure_ascii=False))
