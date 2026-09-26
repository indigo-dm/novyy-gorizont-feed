from __future__ import annotations

import json
import os
from pathlib import Path
import xml.etree.ElementTree as ET

from project_context import OUTPUT_DIR, WORK_DIR

OUTPUT = OUTPUT_DIR
PILOT_MANIFEST = OUTPUT / "pilot-manifest.json"
FULL_MANIFEST = OUTPUT / "full-manifest.json"
PILOT_XML = OUTPUT / "pilot-avito.xml"
FULL_XML = OUTPUT / "avito.xml"


def xml_ids(path: Path) -> list[str]:
    tree = ET.parse(path)
    return [(ad.findtext("Id") or "").strip() for ad in tree.getroot().findall("Ad")]


def main() -> None:
    fast_build = os.environ.get("FAST_BUILD") == "1"
    pilot = json.loads(PILOT_MANIFEST.read_text(encoding="utf-8"))
    full = json.loads(FULL_MANIFEST.read_text(encoding="utf-8"))
    pilot_ids = [str(item["id"]) for item in pilot["items"]]
    full_ids = [str(item["id"]) for item in full["items"]]
    feed_items = [item for item in full["items"] if not item.get("excluded_from_feed")]
    feed_ids = [str(item["id"]) for item in feed_items]
    pilot_xml_ids = xml_ids(PILOT_XML)
    full_xml_ids = xml_ids(FULL_XML)
    errors: list[str] = []

    if full["source_ads"] != len(full_ids):
        errors.append("Full manifest does not contain every source ad")
    if full["full_ads"] != len(feed_ids):
        errors.append("Full feed count does not match included manifest items")
    if len(set(full_ids)) != len(full_ids):
        errors.append("Duplicate ids in full manifest")
    if full_xml_ids != feed_ids:
        errors.append("Full XML ids do not match included manifest items")
    if pilot["unique_plans"] != len(pilot_ids):
        errors.append("Pilot manifest item count does not match unique_plans")
    if len(set(pilot_ids)) != len(pilot_ids):
        errors.append("Duplicate ids in pilot manifest")
    if pilot_xml_ids != pilot_ids:
        errors.append("Pilot XML ids do not match pilot manifest order")
    if not set(pilot_ids).issubset(set(feed_ids)):
        errors.append("Pilot ids are not a subset of included full-feed ids")
    if pilot["source_ads"] != full["source_ads"] or pilot["unique_plans"] != full["unique_plans"]:
        errors.append("Pilot and full manifest counters disagree")

    expected_final = {f"{item_id}.png" for item_id in full_ids}
    expected_previews = {f"{item_id}.webp" for item_id in full_ids}
    expected_thumbnails = {f"{item_id}.webp" for item_id in full_ids}
    actual_final = {path.name for path in (OUTPUT / "images").glob("*.png")}
    actual_previews = {path.name for path in (OUTPUT / "previews").glob("*.webp")}
    actual_thumbnails = {path.name for path in (OUTPUT / "thumbnails").glob("*.webp")}
    if not fast_build and actual_final != expected_final:
        errors.append("Generated final image set does not match full manifest")
    if not fast_build and actual_previews != expected_previews:
        errors.append("Generated preview image set does not match full manifest")
    if not fast_build and actual_thumbnails != expected_thumbnails:
        errors.append("Generated thumbnail image set does not match full manifest")

    manifest_items_by_path = {FULL_XML: feed_items, PILOT_XML: pilot["items"]}
    for path, ids in ((FULL_XML, feed_ids), (PILOT_XML, pilot_ids)):
        tree = ET.parse(path)
        manifest_items = manifest_items_by_path[path]
        for ad, expected_id, item in zip(tree.getroot().findall("Ad"), ids, manifest_items, strict=True):
            actual_urls = [image.attrib.get("url", "") for image in ad.findall("./Images/Image")]
            expected_urls = [str(image["url"]) for image in item["feed_images"]]
            if actual_urls != expected_urls:
                errors.append(f"Image order does not match manifest for ad {expected_id} in {path.name}")
            for tag, expected_value in item.get("feed_parameters", {}).items():
                node = ad.find(str(tag))
                if isinstance(expected_value, list):
                    actual_value = [(option.text or "").strip() for option in node.findall("Option")] if node is not None else []
                else:
                    actual_value = (node.text or "").strip() if node is not None else ""
                if actual_value != expected_value:
                    errors.append(f"Parameter {tag} does not match manifest for ad {expected_id} in {path.name}")
            if ad.find("NewDevelopmentId") is not None and ad.find("Address") is not None:
                errors.append(f"Redundant Address remains for ad {expected_id} in {path.name}")

    if not fast_build:
        for item in full["items"]:
            plan = WORK_DIR / str(item["plan_file"])
            if not plan.exists() or plan.stat().st_size == 0:
                errors.append(f"Missing plan image: {plan}")

    result = {
        "ok": not errors,
        "source_ads": full["source_ads"],
        "full_ads": len(full_xml_ids),
        "excluded_ads": len(full_ids) - len(feed_ids),
        "pilot_ads": len(pilot_xml_ids),
        "unique_plans": full["unique_plans"],
        "generated_images": len(actual_final),
        "preview_images": len(actual_previews),
        "thumbnail_images": len(actual_thumbnails),
        "promoted_ads": sum(1 for item in feed_items if item.get("promotion")),
        "publish_ready": full["publish_ready"],
        "errors": errors,
    }
    print(json.dumps(result, ensure_ascii=False, indent=2))
    if errors:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
