from __future__ import annotations

import json
from pathlib import Path
import xml.etree.ElementTree as ET

from project_context import CONFIG_PATH, OUTPUT_DIR, WORK_DIR

OUTPUT = OUTPUT_DIR
PILOT_MANIFEST = OUTPUT / "pilot-manifest.json"
FULL_MANIFEST = OUTPUT / "full-manifest.json"
PILOT_XML = OUTPUT / "pilot-avito.xml"
FULL_XML = OUTPUT / "full-avito-demo.xml"


def xml_ids(path: Path) -> list[str]:
    tree = ET.parse(path)
    return [(ad.findtext("Id") or "").strip() for ad in tree.getroot().findall("Ad")]


def main() -> None:
    config = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    pilot = json.loads(PILOT_MANIFEST.read_text(encoding="utf-8"))
    full = json.loads(FULL_MANIFEST.read_text(encoding="utf-8"))
    pilot_ids = [str(item["id"]) for item in pilot["items"]]
    full_ids = [str(item["id"]) for item in full["items"]]
    pilot_xml_ids = xml_ids(PILOT_XML)
    full_xml_ids = xml_ids(FULL_XML)
    errors: list[str] = []

    if full["source_ads"] != full["full_ads"] or full["full_ads"] != len(full_ids):
        errors.append("Full manifest does not contain every source ad")
    if len(set(full_ids)) != len(full_ids):
        errors.append("Duplicate ids in full manifest")
    if full_xml_ids != full_ids:
        errors.append("Full XML ids do not match full manifest order")
    if pilot["unique_plans"] != len(pilot_ids):
        errors.append("Pilot manifest item count does not match unique_plans")
    if len(set(pilot_ids)) != len(pilot_ids):
        errors.append("Duplicate ids in pilot manifest")
    if pilot_xml_ids != pilot_ids:
        errors.append("Pilot XML ids do not match pilot manifest order")
    if not set(pilot_ids).issubset(set(full_ids)):
        errors.append("Pilot ids are not a subset of full ids")
    if pilot["source_ads"] != full["source_ads"] or pilot["unique_plans"] != full["unique_plans"]:
        errors.append("Pilot and full manifest counters disagree")

    expected_final = {f"{item_id}.png" for item_id in full_ids}
    expected_previews = {f"{item_id}.jpg" for item_id in full_ids}
    actual_final = {path.name for path in (OUTPUT / "images").glob("*.png")}
    actual_previews = {path.name for path in (OUTPUT / "previews").glob("*.jpg")}
    if actual_final != expected_final:
        errors.append("Generated final image set does not match full manifest")
    if actual_previews != expected_previews:
        errors.append("Generated preview image set does not match full manifest")

    public_base = config["public_image_base_url"].rstrip("/") + "/"
    for path, ids in ((FULL_XML, full_ids), (PILOT_XML, pilot_ids)):
        tree = ET.parse(path)
        for ad, expected_id in zip(tree.getroot().findall("Ad"), ids, strict=True):
            first_image = ad.find("./Images/Image")
            expected_url = f"{public_base}{expected_id}.png"
            if first_image is None or first_image.attrib.get("url") != expected_url:
                errors.append(f"Unexpected branded image URL for ad {expected_id} in {path.name}")
            if ad.find("NewDevelopmentId") is not None and ad.find("Address") is not None:
                errors.append(f"Redundant Address remains for ad {expected_id} in {path.name}")

    for item in full["items"]:
        plan = WORK_DIR / str(item["plan_file"])
        if not plan.exists() or plan.stat().st_size == 0:
            errors.append(f"Missing plan image: {plan}")

    result = {
        "ok": not errors,
        "source_ads": full["source_ads"],
        "full_ads": len(full_xml_ids),
        "pilot_ads": len(pilot_xml_ids),
        "unique_plans": full["unique_plans"],
        "generated_images": len(actual_final),
        "preview_images": len(actual_previews),
        "promoted_ads": sum(1 for item in full["items"] if item.get("promotion")),
        "publish_ready": full["publish_ready"],
        "errors": errors,
    }
    print(json.dumps(result, ensure_ascii=False, indent=2))
    if errors:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
