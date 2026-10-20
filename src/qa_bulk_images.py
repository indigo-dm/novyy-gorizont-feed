from __future__ import annotations

from apply_issue_settings import image_settings
from build_pilot import output_images


ITEM = {
    "id": "1",
    "house_id": "",
    "rooms": "1",
    "floor": "2",
    "plan_id": "plan-123456789abc",
    "area": "42",
    "source_values": {},
    "source_images": ["https://cdn.example/a.jpg", "https://cdn.example/b.jpg"],
}
SCOPE = {
    "enabled": True,
    "house_ids": [],
    "rooms": [],
    "floors": [],
    "plan_ids": [],
    "area_min": None,
    "area_max": None,
    "include_ids": [],
    "exclude_ids": [],
}
IMAGE = {
    "id": "bulk-qa-one",
    "url": "https://cdn.example/shared.jpg",
    "path": "uploads/orion/bulk/bulk-qa-one.jpg",
    "name": "QA image",
}
LIBRARY_IMAGE = {
    "id": "lib-0123456789abcdefabcd",
    "url": "https://cdn.example/library.jpg",
    "path": "uploads/orion/library/lib-0123456789abcdefabcd.jpg",
    "name": "Library image",
}


def add_config(mode: str, position: int = 1) -> dict[str, object]:
    rule = {
        **SCOPE,
        "id": f"image-add-{mode}",
        "name": f"Add {mode}",
        "action": "add",
        "images": [IMAGE],
        "position_mode": mode,
        "position": position,
    }
    return image_settings({"lot_overrides": {}, "bulk_rules": [rule]}, set(), "orion")


def ids(config: dict[str, object]) -> list[str]:
    return [str(image["id"]) for image in output_images(ITEM, config, "https://cdn.example/generated")]


orders = {
    "start": ids(add_config("start")),
    "position": ids(add_config("position", 2)),
    "end": ids(add_config("end")),
}
legacy = {"lot_overrides": {}, "bulk_rules": [{**SCOPE, "from_position": 3, "to_position": 1}]}
orders["legacy_move"] = ids(legacy)
library_rule = {
    **SCOPE,
    "id": "image-add-library",
    "name": "Add library",
    "action": "add",
    "images": [LIBRARY_IMAGE],
    "position_mode": "end",
    "position": 1,
}
orders["library"] = ids(image_settings({"lot_overrides": {}, "bulk_rules": [library_rule]}, set(), "orion"))

assert orders["start"][0] == IMAGE["id"]
assert orders["position"][1] == IMAGE["id"]
assert orders["end"][-1] == IMAGE["id"]
assert orders["legacy_move"][0].startswith("src-")
assert orders["library"][-1] == LIBRARY_IMAGE["id"]

print(orders)
