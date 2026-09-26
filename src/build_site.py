from __future__ import annotations

import json
import shutil

from project_context import (
    ASSETS_DIR,
    CONFIG_PATH,
    OUTPUT_DIR,
    PROJECT,
    PROJECT_SLUG,
    ROOT,
    RULES_PATH,
    REGISTRY,
)


SITE = ROOT / "site"
PROJECT_SITE = SITE / "projects" / PROJECT_SLUG
PARAMETER_CATALOG = [
    {
        "tag": "ViewFromWindows",
        "name": "Вид из окон",
        "kind": "multi",
        "values": ["Во двор", "На улицу", "На солнечную сторону"],
        "supported": True,
    },
    {
        "tag": "PassengerElevator",
        "name": "Пассажирские лифты",
        "kind": "select",
        "values": [str(value) for value in range(1, 9)],
        "supported": True,
    },
    {
        "tag": "FreightElevator",
        "name": "Грузовые лифты",
        "kind": "select",
        "values": [str(value) for value in range(1, 9)],
        "supported": True,
    },
    {
        "tag": "BathroomMulti",
        "name": "Санузел",
        "kind": "multi",
        "values": ["Раздельный", "Совмещенный"],
        "supported": True,
    },
    {
        "tag": "CeilingHeight",
        "name": "Высота потолков",
        "kind": "number",
        "min": 2,
        "max": 10,
        "step": 0.01,
        "supported": True,
    },
    {"tag": "Courtyard", "name": "Двор", "kind": "multi", "values": [], "supported": False},
    {"tag": "Parking", "name": "Парковка", "kind": "multi", "values": [], "supported": False},
    {"tag": "NDAdditionally", "name": "Дополнительно о новостройке", "kind": "multi", "values": [], "supported": False},
]

manifest = json.loads((OUTPUT_DIR / "full-manifest.json").read_text(encoding="utf-8"))
rules = json.loads(RULES_PATH.read_text(encoding="utf-8"))
config = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))

if PROJECT_SITE.exists():
    shutil.rmtree(PROJECT_SITE)
(PROJECT_SITE / "images").mkdir(parents=True)
(PROJECT_SITE / "previews").mkdir(parents=True)
(PROJECT_SITE / "thumbnails").mkdir(parents=True)
(PROJECT_SITE / "assets").mkdir(parents=True)

for item in manifest["items"]:
    source = OUTPUT_DIR / item["output_file"]
    shutil.copy2(source, PROJECT_SITE / "images" / source.name)
    preview = OUTPUT_DIR / "previews" / f"{item['id']}.webp"
    shutil.copy2(preview, PROJECT_SITE / "previews" / preview.name)
    thumbnail = OUTPUT_DIR / "thumbnails" / f"{item['id']}.webp"
    shutil.copy2(thumbnail, PROJECT_SITE / "thumbnails" / thumbnail.name)

if ASSETS_DIR.exists():
    shutil.copytree(ASSETS_DIR, PROJECT_SITE / "assets", dirs_exist_ok=True)

shutil.copy2(OUTPUT_DIR / "pilot-avito.xml", PROJECT_SITE / "pilot-avito.xml")
shutil.copy2(OUTPUT_DIR / "full-avito-demo.xml", PROJECT_SITE / "full-avito-demo.xml")

public_prefix = f"projects/{PROJECT_SLUG}"
public_items = []
for item in manifest["items"]:
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
        "image": f"{public_prefix}/previews/{item['id']}.webp",
        "thumbnail": f"{public_prefix}/thumbnails/{item['id']}.webp",
        "final_image": f"{public_prefix}/images/{item['id']}.png",
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
    "mode": "full-demo",
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
    brand_assets.append(
        {
            "key": f"additional_logo_{index}",
            "name": logo.get("name", f"Дополнительный логотип {index}"),
            "description": "Дополнительный вариант фирменного логотипа объекта.",
            "filename": logo["filename"],
            "required": False,
        }
    )
for index, render in enumerate(config["brand"].get("additional_renders", []), start=1):
    brand_assets.append(
        {
            "key": f"additional_render_{index}",
            "name": render.get("name", f"Дополнительный рендер {index}"),
            "description": "Дополнительный фирменный рендер объекта.",
            "filename": render["filename"],
            "required": False,
        }
    )
for asset in brand_assets:
    path = ASSETS_DIR / asset["filename"]
    asset["exists"] = path.exists()
    asset["url"] = f"{public_prefix}/assets/{asset['filename']}" if path.exists() else ""

assets_manifest = {
    "project": manifest["project"],
    "slug": PROJECT_SLUG,
    "upload_url": (
        "https://github.com/indigo-dm/novyy-gorizont-feed/upload/main/"
        f"projects/{PROJECT_SLUG}/assets"
    ),
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

if PROJECT.get("compatibility_root"):
    for filename in (
        "pilot-avito.xml",
        "full-avito-demo.xml",
        "inventory.json",
        "settings.json",
        "status.json",
        "assets.json",
    ):
        shutil.copy2(PROJECT_SITE / filename, SITE / filename)

registry_path = SITE / "projects.json"
if registry_path.exists():
    public_registry = json.loads(registry_path.read_text(encoding="utf-8"))
else:
    public_registry = {
        "version": 1,
        "default_project": REGISTRY["default_project"],
        "projects": [
            {
                "slug": item["slug"],
                "name": item["name"],
                "status": item.get("status", "setup"),
                "available": False,
                "base": f"projects/{item['slug']}",
            }
            for item in REGISTRY["projects"]
        ],
    }
for item in public_registry["projects"]:
    if item["slug"] == PROJECT_SLUG:
        item["available"] = True
registry_path.write_text(
    json.dumps(public_registry, ensure_ascii=False, indent=2), encoding="utf-8"
)

print(json.dumps({"project": PROJECT_SLUG, "site": str(PROJECT_SITE)}, ensure_ascii=False))
