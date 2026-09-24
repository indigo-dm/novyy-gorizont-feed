from __future__ import annotations

import json
from pathlib import Path
import xml.etree.ElementTree as ET


ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / "output" / "pilot-manifest.json"
PILOT_XML = ROOT / "output" / "pilot-avito.xml"


def main() -> None:
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    tree = ET.parse(PILOT_XML)
    ads = tree.getroot().findall("Ad")
    errors: list[str] = []
    ids = [str(item["id"]) for item in manifest["items"]]
    xml_ids = [(ad.findtext("Id") or "").strip() for ad in ads]
    if len(ids) != manifest["unique_plans"]:
        errors.append("Manifest item count does not match unique_plans")
    if len(set(ids)) != len(ids):
        errors.append("Duplicate ids in manifest")
    if xml_ids != ids:
        errors.append("Pilot XML ids do not match manifest order")
    for item in manifest["items"]:
        image = ROOT / "output" / str(item["output_file"])
        preview = ROOT / "output" / "previews" / image.name
        plan = ROOT / str(item["plan_file"])
        if not image.exists() or image.stat().st_size == 0:
            errors.append(f"Missing generated image: {image}")
        if not preview.exists() or preview.stat().st_size == 0:
            errors.append(f"Missing neutral preview image: {preview}")
        if not plan.exists() or plan.stat().st_size == 0:
            errors.append(f"Missing plan image: {plan}")
    result = {
        "ok": not errors,
        "source_ads": manifest["source_ads"],
        "pilot_ads": len(ads),
        "unique_plans": manifest["unique_plans"],
        "generated_images": len(list((ROOT / "output" / "images").glob("*.png"))),
        "preview_images": len(list((ROOT / "output" / "previews").glob("*.png"))),
        "publish_ready": manifest["publish_ready"],
        "errors": errors,
    }
    print(json.dumps(result, ensure_ascii=False, indent=2))
    if errors:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
