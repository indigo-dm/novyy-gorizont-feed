from __future__ import annotations

import copy
import json
import os
from datetime import datetime, timezone, timedelta
from pathlib import Path
from urllib.parse import urlparse
from urllib.request import Request, urlopen
import xml.etree.ElementTree as ET


ROOT = Path(__file__).resolve().parents[1]
CONFIG_PATH = ROOT / "config.json"
INPUT_XML = ROOT / "input" / "avito.xml"
MANIFEST_PATH = ROOT / "output" / "pilot-manifest.json"
PILOT_XML_PATH = ROOT / "output" / "pilot-avito.xml"


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


def download(url: str, destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    request = Request(url, headers={"User-Agent": "novyy-gorizont-feed-generator/1.0"})
    with urlopen(request, timeout=60) as response:
        destination.write_bytes(response.read())


def main() -> None:
    config = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    tree = ET.parse(INPUT_XML)
    root = tree.getroot()
    ads = list(root.findall("Ad"))

    representatives: dict[str, ET.Element] = {}
    for ad in ads:
        urls = image_urls(ad)
        if urls:
            representatives.setdefault(urls[0], ad)

    items: list[dict[str, object]] = []
    selected_ids: set[str] = set()
    for plan_url, ad in representatives.items():
        ad_id = node_text(ad, "Id")
        house_id = node_text(ad, "NewDevelopmentId")
        urls = image_urls(ad)
        plan_name = local_plan_name(plan_url)
        selected_ids.add(ad_id)
        plan_file = f"cache/plans/{plan_name}"
        plan_path = ROOT / plan_file
        if not plan_path.exists() or plan_path.stat().st_size == 0:
            download(plan_url, plan_path)
        items.append(
            {
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
        )

    items.sort(key=lambda x: (x["house_id"], int(x["rooms"] or 0), float(x["area"] or 0)))
    checked_at = datetime.now(timezone(timedelta(hours=3))).isoformat(timespec="seconds")
    manifest = {
        "project": config["project"],
        "source": "Profitbase XML from GitHub Actions secret",
        "checked_at": checked_at,
        "source_ads": len(ads),
        "unique_plans": len(items),
        "publish_ready": False,
        "publish_blocker": "Pilot feed only. Do not connect to Avito until explicit approval.",
        "items": items,
    }
    MANIFEST_PATH.parent.mkdir(parents=True, exist_ok=True)
    MANIFEST_PATH.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")

    pilot_root = ET.Element(root.tag, root.attrib)
    public_base = config["public_image_base_url"].rstrip("/")
    ads_by_id = {node_text(ad, "Id"): ad for ad in ads if node_text(ad, "Id") in selected_ids}
    for item in items:
        ad = ads_by_id[str(item["id"])]
        clone = copy.deepcopy(ad)
        images = clone.find("Images")
        if images is not None:
            first_image = images.find("Image")
            if first_image is not None:
                first_image.set("url", f"{public_base}/{node_text(clone, 'Id')}.png")
                first_image.text = None
        pilot_root.append(clone)

    ET.indent(pilot_root, space="  ")
    ET.ElementTree(pilot_root).write(PILOT_XML_PATH, encoding="utf-8", xml_declaration=True)
    print(json.dumps({"source_ads": len(ads), "pilot_ads": len(items), "manifest": str(MANIFEST_PATH), "xml": str(PILOT_XML_PATH)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
