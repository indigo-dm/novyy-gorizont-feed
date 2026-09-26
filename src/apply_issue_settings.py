from __future__ import annotations

import json
import os
import re
from datetime import date
from pathlib import Path
from urllib.parse import urlparse


ROOT = Path(__file__).resolve().parents[1]
ALLOWED_ROOMS = {"1", "2", "3", "4", "5"}
ALLOWED_PARAMETERS = {
    "ViewFromWindows",
    "PassengerElevator",
    "FreightElevator",
    "Courtyard",
    "Parking",
    "BathroomMulti",
    "CeilingHeight",
    "NDAdditionally",
}
MULTI_PARAMETERS = {
    "ViewFromWindows",
    "Courtyard",
    "Parking",
    "BathroomMulti",
    "NDAdditionally",
}
PARAMETER_OPTIONS = {
    "ViewFromWindows": {"Во двор", "На улицу", "На солнечную сторону"},
    "Courtyard": {"Закрытая территория", "Детская площадка", "Спортивная площадка"},
    "Parking": {
        "Подземная",
        "Наземная многоуровневая",
        "Открытая во дворе",
        "За шлагбаумом во дворе",
        "Гостевая",
    },
    "BathroomMulti": {"Раздельный", "Совмещенный"},
    "NDAdditionally": {"Гардеробная", "Панорамные окна"},
}


def text(value: object, name: str, maximum: int, default: str = "") -> str:
    result = str(value if value is not None else default).strip()
    if not result:
        result = default
    if len(result) > maximum:
        raise ValueError(f"{name} exceeds {maximum} characters")
    return result


def string_list(value: object, name: str, allowed: set[str] | None = None) -> list[str]:
    if not isinstance(value, list):
        raise ValueError(f"{name} must be a list")
    result = list(dict.fromkeys(str(item).strip() for item in value if str(item).strip()))
    if len(result) > 250:
        raise ValueError(f"{name} contains too many values")
    if allowed is not None and not set(result).issubset(allowed):
        raise ValueError(f"{name} contains unsupported values")
    return result


def nullable_number(value: object, name: str) -> float | None:
    if value in (None, ""):
        return None
    number = float(str(value))
    if number < 0 or number > 500:
        raise ValueError(f"{name} is outside the allowed range")
    return number


def iso_date(value: object, name: str) -> str:
    result = str(value or "").strip()
    if result:
        date.fromisoformat(result)
    return result


def http_url(value: object, name: str) -> str:
    result = text(value, name, 1500)
    parsed = urlparse(result)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise ValueError(f"{name} must be an HTTP(S) URL")
    return result


def filters(source: dict[str, object], name: str, allowed_houses: set[str]) -> dict[str, object]:
    area_min = nullable_number(source.get("area_min"), f"{name}.area_min")
    area_max = nullable_number(source.get("area_max"), f"{name}.area_max")
    if area_min is not None and area_max is not None and area_min > area_max:
        raise ValueError(f"{name}: area_min is greater than area_max")
    include_ids = string_list(source.get("include_ids", []), f"{name}.include_ids")
    exclude_ids = string_list(source.get("exclude_ids", []), f"{name}.exclude_ids")
    floors = string_list(source.get("floors", []), f"{name}.floors")
    if any(not value.isdigit() for value in include_ids + exclude_ids):
        raise ValueError(f"{name}: lot ids must contain digits only")
    if any(not value.isdigit() or not 1 <= int(value) <= 300 for value in floors):
        raise ValueError(f"{name}: floors must contain numbers between 1 and 300")
    return {
        "house_ids": string_list(source.get("house_ids", []), f"{name}.house_ids", allowed_houses),
        "rooms": string_list(source.get("rooms", []), f"{name}.rooms", ALLOWED_ROOMS),
        "floors": floors,
        "area_min": area_min,
        "area_max": area_max,
        "include_ids": include_ids,
        "exclude_ids": exclude_ids,
    }


def parameter_value(tag: str, value: object, name: str) -> object:
    if tag not in ALLOWED_PARAMETERS:
        raise ValueError(f"{name} contains an unsupported parameter: {tag}")
    if tag in MULTI_PARAMETERS:
        values = string_list(value, name)
        if not values or len(values) > 12:
            raise ValueError(f"{name} must contain between 1 and 12 values")
        if not set(values).issubset(PARAMETER_OPTIONS[tag]):
            raise ValueError(f"{name} contains an unsupported value")
        return values
    if tag in {"PassengerElevator", "FreightElevator"}:
        result = int(str(value))
        if result < 1 or result > 8:
            raise ValueError(f"{name} is outside the allowed range")
        return str(result)
    result = float(str(value).replace(",", "."))
    if result < 2 or result > 10:
        raise ValueError(f"{name} is outside the allowed range")
    return str(result).rstrip("0").rstrip(".")


def settings_map(value: object, name: str) -> dict[str, object]:
    if not isinstance(value, dict):
        raise ValueError(f"{name} must be an object")
    return {
        str(tag): parameter_value(str(tag), item, f"{name}.{tag}")
        for tag, item in value.items()
    }


def image_settings(value: object, allowed_houses: set[str], project_slug: str) -> dict[str, object]:
    source = value if isinstance(value, dict) else {}
    raw_overrides = source.get("lot_overrides", {})
    if not isinstance(raw_overrides, dict) or len(raw_overrides) > 250:
        raise ValueError("image_settings.lot_overrides must be an object with no more than 250 lots")
    overrides: dict[str, object] = {}
    for lot_id, raw in raw_overrides.items():
        lot_id = str(lot_id)
        if not lot_id.isdigit() or not isinstance(raw, dict):
            raise ValueError("Invalid image lot override")
        added = raw.get("added", [])
        if not isinstance(added, list) or len(added) > 20:
            raise ValueError(f"image_settings.lot_overrides.{lot_id}.added is invalid")
        clean_added = []
        for index, item in enumerate(added, start=1):
            if not isinstance(item, dict):
                raise ValueError(f"Added image {index} for lot {lot_id} is invalid")
            image_id = text(item.get("id"), "image id", 80)
            if not re.fullmatch(r"[A-Za-z0-9_-]+", image_id):
                raise ValueError(f"Added image {index} for lot {lot_id} has an invalid id")
            clean_item = {"id": image_id, "url": http_url(item.get("url"), "image url")}
            path = str(item.get("path") or "").strip()
            if path:
                expected = rf"uploads/{re.escape(project_slug)}/{re.escape(lot_id)}/{re.escape(image_id)}\.(?:jpg|jpeg|png|webp)"
                if not re.fullmatch(expected, path, flags=re.IGNORECASE):
                    raise ValueError(f"Added image {index} for lot {lot_id} has an invalid managed path")
                clean_item["path"] = path
            clean_added.append(clean_item)
        overrides[lot_id] = {
            "order": string_list(raw.get("order", []), "image order"),
            "hidden": string_list(raw.get("hidden", []), "hidden images"),
            "added": clean_added,
        }
    raw_rules = source.get("bulk_rules", [])
    if not isinstance(raw_rules, list) or len(raw_rules) > 30:
        raise ValueError("image_settings.bulk_rules must be a list with no more than 30 items")
    rules = []
    for index, raw in enumerate(raw_rules, start=1):
        if not isinstance(raw, dict):
            raise ValueError(f"Image rule {index} must be an object")
        rule = {
            "id": text(raw.get("id"), f"Image rule {index} id", 64),
            "name": text(raw.get("name"), f"Image rule {index} name", 80, "Перестановка изображений"),
            "enabled": bool(raw.get("enabled", True)),
            **filters(raw, f"Image rule {index}", allowed_houses),
        }
        if not re.fullmatch(r"[A-Za-z0-9_-]+", str(rule["id"])):
            raise ValueError(f"Image rule {index} has an invalid id")
        rule["from_position"] = int(raw.get("from_position", 0))
        rule["to_position"] = int(raw.get("to_position", 0))
        if not 1 <= rule["from_position"] <= 40 or not 1 <= rule["to_position"] <= 40:
            raise ValueError(f"Image rule {index} contains an invalid position")
        rules.append(rule)
    return {"lot_overrides": overrides, "bulk_rules": rules}


def parameter_settings(value: object, allowed_houses: set[str]) -> dict[str, object]:
    source = value if isinstance(value, dict) else {}
    raw_lots = source.get("lot_values", {})
    if not isinstance(raw_lots, dict) or len(raw_lots) > 250:
        raise ValueError("parameter_settings.lot_values must be an object with no more than 250 lots")
    lots = {}
    for lot_id, values in raw_lots.items():
        lot_id = str(lot_id)
        if not lot_id.isdigit():
            raise ValueError("Invalid parameter lot id")
        lots[lot_id] = settings_map(values, f"parameter_settings.lot_values.{lot_id}")
    raw_rules = source.get("bulk_rules", [])
    if not isinstance(raw_rules, list) or len(raw_rules) > 30:
        raise ValueError("parameter_settings.bulk_rules must be a list with no more than 30 items")
    rules = []
    for index, raw in enumerate(raw_rules, start=1):
        if not isinstance(raw, dict):
            raise ValueError(f"Parameter rule {index} must be an object")
        rule = {
            "id": text(raw.get("id"), f"Parameter rule {index} id", 64),
            "name": text(raw.get("name"), f"Parameter rule {index} name", 80, "Массовые параметры"),
            "enabled": bool(raw.get("enabled", True)),
            "values": settings_map(raw.get("values", {}), f"Parameter rule {index}.values"),
            **filters(raw, f"Parameter rule {index}", allowed_houses),
        }
        if not re.fullmatch(r"[A-Za-z0-9_-]+", str(rule["id"])):
            raise ValueError(f"Parameter rule {index} has an invalid id")
        rules.append(rule)
    return {"lot_values": lots, "bulk_rules": rules}


def pending_upload_deletions(value: object, project_slug: str) -> list[dict[str, str]]:
    if value is None:
        return []
    if not isinstance(value, list) or len(value) > 50:
        raise ValueError("pending_upload_deletions must be a list with no more than 50 items")
    result: list[dict[str, str]] = []
    for index, item in enumerate(value, start=1):
        if not isinstance(item, dict):
            raise ValueError(f"Pending upload deletion {index} is invalid")
        lot_id = text(item.get("lot"), "upload deletion lot", 20)
        image_id = text(item.get("id"), "upload deletion image id", 80)
        path = text(item.get("path"), "upload deletion path", 260)
        if not lot_id.isdigit() or not re.fullmatch(r"add-[A-Za-z0-9_-]+", image_id):
            raise ValueError(f"Pending upload deletion {index} has invalid identifiers")
        expected = rf"uploads/{re.escape(project_slug)}/{re.escape(lot_id)}/{re.escape(image_id)}\.(?:jpg|jpeg|png|webp)"
        if not re.fullmatch(expected, path, flags=re.IGNORECASE):
            raise ValueError(f"Pending upload deletion {index} is outside the managed upload folder")
        result.append({"lot": lot_id, "id": image_id, "path": path})
    return result


def material_settings(value: object, project_dir: Path, config: dict[str, object]) -> dict[str, str]:
    source = value if isinstance(value, dict) else {}
    brand = config.get("brand") if isinstance(config.get("brand"), dict) else {}
    assets_dir = (project_dir / "assets").resolve()
    result: dict[str, str] = {}
    for role, fallback in (
        ("logo", str(brand.get("logo") or "logo.svg")),
        ("key_render", str(brand.get("key_render") or "key-render.jpg")),
    ):
        filename = text(source.get(role), f"material_settings.{role}", 180, fallback).replace("\\", "/")
        if filename.startswith("/") or ".." in Path(filename).parts or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._/-]*", filename):
            raise ValueError(f"material_settings.{role} contains an unsafe path")
        if Path(filename).suffix.lower() not in {".jpg", ".jpeg", ".png", ".webp", ".svg"}:
            raise ValueError(f"material_settings.{role} has an unsupported file type")
        target = (assets_dir / filename).resolve()
        if assets_dir not in target.parents or not target.is_file():
            raise ValueError(f"material_settings.{role} does not exist")
        result[role] = filename
    return result


def validate(
    payload: object,
    allowed_houses: set[str],
    project_slug: str,
    project_dir: Path,
    config: dict[str, object],
) -> dict[str, object]:
    if not isinstance(payload, dict) or payload.get("version") not in {1, 2, 3}:
        raise ValueError("Unsupported settings format")
    source_rules = payload.get("rules")
    if not isinstance(source_rules, list) or len(source_rules) > 10:
        raise ValueError("rules must be a list with no more than 10 items")
    rules: list[dict[str, object]] = []
    ids: set[str] = set()
    for index, source in enumerate(source_rules, start=1):
        if not isinstance(source, dict):
            raise ValueError(f"Rule {index} must be an object")
        rule_id = text(source.get("id"), f"Rule {index} id", 64)
        if not re.fullmatch(r"[A-Za-z0-9_-]+", rule_id):
            raise ValueError(f"Rule {index} has an invalid id")
        if rule_id in ids:
            raise ValueError(f"Duplicate rule id: {rule_id}")
        ids.add(rule_id)
        area_min = nullable_number(source.get("area_min"), "area_min")
        area_max = nullable_number(source.get("area_max"), "area_max")
        if area_min is not None and area_max is not None and area_min > area_max:
            raise ValueError(f"Rule {rule_id}: area_min is greater than area_max")
        starts_at = iso_date(source.get("starts_at"), "starts_at")
        ends_at = iso_date(source.get("ends_at"), "ends_at")
        if starts_at and ends_at and starts_at > ends_at:
            raise ValueError(f"Rule {rule_id}: starts_at is after ends_at")
        include_ids = string_list(source.get("include_ids", []), "include_ids")
        exclude_ids = string_list(source.get("exclude_ids", []), "exclude_ids")
        if any(not value.isdigit() for value in include_ids + exclude_ids):
            raise ValueError(f"Rule {rule_id}: lot ids must contain digits only")
        rules.append({
            "id": rule_id,
            "name": text(source.get("name"), "name", 80, "Акция"),
            "enabled": bool(source.get("enabled", False)),
            "label": text(source.get("label"), "label", 24, "Акция"),
            "text": text(source.get("text"), "text", 60),
            "house_ids": string_list(source.get("house_ids", []), "house_ids", allowed_houses),
            "rooms": string_list(source.get("rooms", []), "rooms", ALLOWED_ROOMS),
            "area_min": area_min,
            "area_max": area_max,
            "starts_at": starts_at,
            "ends_at": ends_at,
            "include_ids": include_ids,
            "exclude_ids": exclude_ids,
        })
    excluded_lot_ids = string_list(payload.get("excluded_lot_ids", []), "excluded_lot_ids")
    if any(not value.isdigit() for value in excluded_lot_ids):
        raise ValueError("excluded_lot_ids must contain digits only")
    return {
        "version": 2,
        "rules": rules,
        "excluded_lot_ids": excluded_lot_ids,
        "image_settings": image_settings(payload.get("image_settings", {}), allowed_houses, project_slug),
        "parameter_settings": parameter_settings(payload.get("parameter_settings", {}), allowed_houses),
        "material_settings": material_settings(payload.get("material_settings", {}), project_dir, config),
        "pending_upload_deletions": pending_upload_deletions(payload.get("pending_upload_deletions"), project_slug),
    }


def main() -> None:
    body = os.environ.get("ISSUE_BODY", "")
    match = re.search(
        r"FEED_SETTINGS_JSON_START\s*(\{.*?\})\s*FEED_SETTINGS_JSON_END",
        body,
        flags=re.DOTALL,
    )
    if not match:
        raise SystemExit("Settings JSON markers were not found in the issue body")
    try:
        payload = json.loads(match.group(1))
        registry = json.loads((ROOT / "projects.json").read_text(encoding="utf-8"))
        project_slug = str(payload.get("project") or registry["default_project"])
        project = next((item for item in registry["projects"] if item.get("slug") == project_slug), None)
        if project is None:
            raise ValueError("Unknown project")
        project_dir = ROOT / "projects" / project_slug
        config = json.loads((project_dir / "config.json").read_text(encoding="utf-8"))
        allowed_houses = set(str(value) for value in config.get("houses", {}))
        validated = validate(payload, allowed_houses, project_slug, project_dir, config)
    except (ValueError, TypeError, json.JSONDecodeError) as error:
        raise SystemExit(f"Invalid feed settings: {error}") from error
    output = project_dir / "promotion-rules.json"
    previous = json.loads(output.read_text(encoding="utf-8")) if output.exists() else {}
    previous_materials = {
        "logo": str(config.get("brand", {}).get("logo") or "logo.svg"),
        "key_render": str(config.get("brand", {}).get("key_render") or "key-render.jpg"),
    }
    selected_materials = validated["material_settings"]
    mode = "full" if (
        previous.get("rules", []) != validated["rules"]
        or previous_materials != selected_materials
    ) else "fast"
    if not isinstance(config.get("brand"), dict):
        raise SystemExit("Invalid project config: brand settings are missing")
    config["brand"]["logo"] = selected_materials["logo"]
    config["brand"]["key_render"] = selected_materials["key_render"]
    (project_dir / "config.json").write_text(
        json.dumps(config, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    output.write_text(json.dumps(validated, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    github_output = os.environ.get("GITHUB_OUTPUT", "").strip()
    if github_output:
        with Path(github_output).open("a", encoding="utf-8") as handle:
            handle.write(f"project={project_slug}\n")
            handle.write(f"mode={mode}\n")
    print(json.dumps({
        "project": project_slug,
        "mode": mode,
        "rules": len(validated["rules"]),
        "output": str(output),
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
