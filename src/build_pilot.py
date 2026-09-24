from __future__ import annotations

import copy
import json
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import Request, urlopen
import xml.etree.ElementTree as ET

from project_context import CONFIG_PATH, INPUT_DIR, OUTPUT_DIR, RULES_PATH, WORK_DIR

INPUT_XML = INPUT_DIR / "avito.xml"
PILOT_MANIFEST_PATH = OUTPUT_DIR / "pilot-manifest.json"
FULL_MANIFEST_PATH = OUTPUT_DIR / "full-manifest.json"
PILOT_XML_PATH = OUTPUT_DIR / "pilot-avito.xml"
FULL_XML_PATH = OUTPUT_DIR / "full-avito-demo.xml"


def node_text(parent: ET.Element, name: str, default: str = "") -> str:
    node = parent.find(name)
    return (node.text or default).strip() if node is not None else default


def image_urls(ad: ET.Element) -> list[str]:
    images = ad.find("Images")
    if images is None:
        return []
    result: list[str] = []
    for image in images.findall("Image"):
        url = image.attrib.get("url") or (image.text or "")
        if url:
            result.append(url.strip())
    return result


def local_plan_name(url: str) -> str:
    suffix = Path(urlparse(url).path).suffix.lower() or ".img"
    stem = Path(urlparse(url).path).stem
    return f"{stem}{suffix}"


def download(url: str, destination: Path, attempts: int = 4) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    request = Request(url, headers={"User-Agent": "novyy-gorizont-feed-generator/1.0"})
    for attempt in range(1, attempts + 1):
        try:
            with urlopen(request, timeout=60) as response:
                destination.write_bytes(response.read())
            return
        except HTTPError as error:
            retryable = error.code == 429 or 500 <= error.code < 600
            if not retryable or attempt == attempts:
                raise
        except (URLError, TimeoutError):
            if attempt == attempts:
                raise
        delay = 2 ** (attempt - 1)
        print(f"Temporary download error for {url}; retry {attempt}/{attempts} in {delay}s")
        time.sleep(delay)


def active_promotion(item: dict[str, object], rules: list[dict[str, object]], today: str) -> dict[str, str] | None:
    """Return the first enabled promotion matching the lot."""
    item_id = str(item["id"])
    house_id = str(item["house_id"])
    rooms = str(item["rooms"])
    area = float(str(item["area"] or 0))
    for rule in rules:
        if not rule.get("enabled"):
            continue
        starts_at = str(rule.get("starts_at") or "")
        ends_at = str(rule.get("ends_at") or "")
        if starts_at and today < starts_at:
            continue
        if ends_at and today > ends_at:
            continue
        excluded = {str(value) for value in rule.get("exclude_ids", [])}
        if item_id in excluded:
            continue
        included = {str(value) for value in rule.get("include_ids", [])}
        if included and item_id not in included:
            continue
        house_ids = {str(value) for value in rule.get("house_ids", [])}
        if house_ids and house_id not in house_ids:
            continue
        room_values = {str(value) for value in rule.get("rooms", [])}
        if room_values and rooms not in room_values:
            continue
        area_min = rule.get("area_min")
        area_max = rule.get("area_max")
        if area_min is not None and area < float(str(area_min)):
            continue
        if area_max is not None and area > float(str(area_max)):
            continue
        return {
            "rule_id": str(rule.get("id") or ""),
            "name": str(rule.get("name") or "Акция"),
            "label": str(rule.get("label") or "Акция"),
            "text": str(rule.get("text") or ""),
        }
    return None


def sort_key(item: dict[str, object]) -> tuple[object, ...]:
    return (
        str(item["house_id"]),
        int(str(item["rooms"] or 0)),
        float(str(item["area"] or 0)),
        int(str(item["floor"] or 0)),
        str(item["id"]),
    )


def write_feed(
    source_root: ET.Element,
    ads_by_id: dict[str, ET.Element],
    items: list[dict[str, object]],
    public_base: str,
    destination: Path,
) -> None:
    output_root = ET.Element(source_root.tag, source_root.attrib)
    for item in items:
        ad_id = str(item["id"])
        clone = copy.deepcopy(ads_by_id[ad_id])
        images = clone.find("Images")
        first_image = images.find("Image") if images is not None else None
        if first_image is None:
            raise ValueError(f"Ad {ad_id} has no image to replace")
        first_image.set("url", f"{public_base}/{ad_id}.png")
        first_image.text = None
        address = clone.find("Address")
        if address is not None and clone.find("NewDevelopmentId") is not None:
            clone.remove(address)
        output_root.append(clone)
    ET.indent(output_root, space="  ")
    ET.ElementTree(output_root).write(destination, encoding="utf-8", xml_declaration=True)


def main() -> None:
    config = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    rules_config = json.loads(RULES_PATH.read_text(encoding="utf-8"))
    rules = list(rules_config.get("rules", []))
    tree = ET.parse(INPUT_XML)
    root = tree.getroot()
    ads = list(root.findall("Ad"))

    items: list[dict[str, object]] = []
    representatives: dict[str, dict[str, object]] = {}
    ads_by_id: dict[str, ET.Element] = {}
    for ad in ads:
        ad_id = node_text(ad, "Id")
        if not ad_id:
            raise ValueError("Source feed contains an ad without Id")
        if ad_id in ads_by_id:
            raise ValueError(f"Duplicate ad Id in source feed: {ad_id}")
        urls = image_urls(ad)
        if not urls:
            raise ValueError(f"Ad {ad_id} has no images")
        plan_url = urls[0]
        plan_file = f"cache/plans/{local_plan_name(plan_url)}"
        plan_path = WORK_DIR / plan_file
        if not plan_path.exists() or plan_path.stat().st_size == 0:
            download(plan_url, plan_path)
        house_id = node_text(ad, "NewDevelopmentId")
        item: dict[str, object] = {
            "id": ad_id,
            "house_id": house_id,
            "house": config["houses"].get(house_id, f"Дом {house_id}"),
            "rooms": node_text(ad, "Rooms"),
            "area": node_text(ad, "Square"),
            "floor": node_text(ad, "Floor"),
            "floors": node_text(ad, "Floors"),
            "price": node_text(ad, "Price"),
            "decoration": node_text(ad, "Decoration") or "Без отделки",
            "plan_url": plan_url,
            "plan_file": plan_file,
            "output_file": f"images/{ad_id}.png",
            "source_images": urls,
        }
        items.append(item)
        representatives.setdefault(plan_url, item)
        ads_by_id[ad_id] = ad

    items.sort(key=sort_key)
    pilot_items = sorted((copy.deepcopy(item) for item in representatives.values()), key=sort_key)
    checked_at = datetime.now(timezone(timedelta(hours=3))).isoformat(timespec="seconds")
    today = checked_at[:10]
    for item in items:
        item["promotion"] = active_promotion(item, rules, today)
    promotions_by_id = {str(item["id"]): item.get("promotion") for item in items}
    for item in pilot_items:
        item["promotion"] = promotions_by_id[str(item["id"])]

    shared = {
        "project": config["project"],
        "source": "Profitbase XML from GitHub Actions secret",
        "checked_at": checked_at,
        "source_ads": len(ads),
        "unique_plans": len(pilot_items),
        "publish_ready": False,
        "publish_blocker": "Demonstration feed only. Do not connect to Avito until explicit approval.",
        "promotion_rules": rules_config,
    }
    full_manifest = {**shared, "full_ads": len(items), "items": items}
    pilot_manifest = {**shared, "pilot_ads": len(pilot_items), "items": pilot_items}
    FULL_MANIFEST_PATH.parent.mkdir(parents=True, exist_ok=True)
    FULL_MANIFEST_PATH.write_text(json.dumps(full_manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    PILOT_MANIFEST_PATH.write_text(json.dumps(pilot_manifest, ensure_ascii=False, indent=2), encoding="utf-8")

    public_base = config["public_image_base_url"].rstrip("/")
    write_feed(root, ads_by_id, items, public_base, FULL_XML_PATH)
    write_feed(root, ads_by_id, pilot_items, public_base, PILOT_XML_PATH)
    print(json.dumps({
        "source_ads": len(ads),
        "full_ads": len(items),
        "pilot_ads": len(pilot_items),
        "unique_plans": len(pilot_items),
        "full_xml": str(FULL_XML_PATH),
        "pilot_xml": str(PILOT_XML_PATH),
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
