from __future__ import annotations

import json
import os
import re
from datetime import date
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "promotion-rules.json"
ALLOWED_HOUSES = {"3379663", "3379674"}
ALLOWED_ROOMS = {"1", "2", "3", "4", "5"}


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


def validate(payload: object) -> dict[str, object]:
    if not isinstance(payload, dict) or payload.get("version") != 1:
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
            "house_ids": string_list(source.get("house_ids", []), "house_ids", ALLOWED_HOUSES),
            "rooms": string_list(source.get("rooms", []), "rooms", ALLOWED_ROOMS),
            "area_min": area_min,
            "area_max": area_max,
            "starts_at": starts_at,
            "ends_at": ends_at,
            "include_ids": include_ids,
            "exclude_ids": exclude_ids,
        })
    return {"version": 1, "rules": rules}


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
        validated = validate(payload)
    except (ValueError, TypeError, json.JSONDecodeError) as error:
        raise SystemExit(f"Invalid feed settings: {error}") from error
    OUTPUT.write_text(json.dumps(validated, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"rules": len(validated["rules"]), "output": str(OUTPUT)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
