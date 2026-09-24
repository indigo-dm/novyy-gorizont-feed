from __future__ import annotations

import json
import shutil
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "output"
SITE = ROOT / "site"
WEB = ROOT / "web"
ASSETS = ROOT / "assets"

manifest = json.loads((OUTPUT / "full-manifest.json").read_text(encoding="utf-8"))
rules = json.loads((ROOT / "promotion-rules.json").read_text(encoding="utf-8"))

if SITE.exists():
    shutil.rmtree(SITE)
(SITE / "images").mkdir(parents=True)
(SITE / "previews").mkdir(parents=True)
(SITE / "assets").mkdir(parents=True)

for item in manifest["items"]:
    source = OUTPUT / item["output_file"]
    shutil.copy2(source, SITE / "images" / source.name)
    preview = OUTPUT / "previews" / f"{item['id']}.jpg"
    shutil.copy2(preview, SITE / "previews" / preview.name)

for filename in ("index.html", "app.css", "app.js"):
    shutil.copy2(WEB / filename, SITE / filename)
shutil.copy2(ASSETS / "Manrope-Variable.ttf", SITE / "assets" / "Manrope-Variable.ttf")
shutil.copy2(ASSETS / "logo-gold.svg", SITE / "assets" / "logo-gold.svg")
shutil.copy2(OUTPUT / "pilot-avito.xml", SITE / "pilot-avito.xml")
shutil.copy2(OUTPUT / "full-avito-demo.xml", SITE / "full-avito-demo.xml")
(SITE / ".nojekyll").write_text("", encoding="utf-8")

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
        "image": f"previews/{item['id']}.jpg",
        "final_image": f"images/{item['id']}.png",
        "promotion": item.get("promotion"),
    })

(SITE / "inventory.json").write_text(json.dumps({
    "project": manifest["project"],
    "checked_at": manifest["checked_at"],
    "source_ads": manifest["source_ads"],
    "full_ads": manifest["full_ads"],
    "unique_plans": manifest["unique_plans"],
    "items": public_items,
}, ensure_ascii=False, indent=2), encoding="utf-8")
(SITE / "settings.json").write_text(
    json.dumps(rules, ensure_ascii=False, indent=2), encoding="utf-8"
)
(SITE / "status.json").write_text(json.dumps({
    "project": manifest["project"],
    "checked_at": manifest["checked_at"],
    "source_ads": manifest["source_ads"],
    "full_ads": manifest["full_ads"],
    "unique_plans": manifest["unique_plans"],
    "active_promotions": sum(1 for rule in rules.get("rules", []) if rule.get("enabled")),
    "publish_ready": False,
    "mode": "full-demo",
}, ensure_ascii=False, indent=2), encoding="utf-8")
print(SITE)
