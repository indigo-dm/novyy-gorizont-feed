from __future__ import annotations

import json
import os
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
REGISTRY_PATH = ROOT / "projects.json"


def load_registry() -> dict[str, object]:
    registry = json.loads(REGISTRY_PATH.read_text(encoding="utf-8"))
    if registry.get("version") != 1 or not isinstance(registry.get("projects"), list):
        raise ValueError("Unsupported projects registry")
    return registry


REGISTRY = load_registry()
PROJECT_SLUG = os.environ.get("PROJECT_SLUG", str(REGISTRY["default_project"])).strip()
PROJECT = next(
    (item for item in REGISTRY["projects"] if item.get("slug") == PROJECT_SLUG),
    None,
)
if PROJECT is None:
    raise ValueError(f"Unknown project: {PROJECT_SLUG}")

PROJECT_DIR = ROOT / "projects" / PROJECT_SLUG
CONFIG_PATH = PROJECT_DIR / "config.json"
RULES_PATH = PROJECT_DIR / "promotion-rules.json"
ASSETS_DIR = PROJECT_DIR / "assets"
WORK_DIR = ROOT / "work" / PROJECT_SLUG
INPUT_DIR = WORK_DIR / "input"
OUTPUT_DIR = WORK_DIR / "output"
CACHE_DIR = WORK_DIR / "cache"


def load_config() -> dict[str, object]:
    return json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
