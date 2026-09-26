from __future__ import annotations

import hashlib
from pathlib import Path
from typing import Callable


SUPPORTED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".svg"}


def display_name(filename: str) -> str:
    stem = Path(filename).stem.replace("_", " ").replace("-", " ").strip()
    return " ".join(part.capitalize() for part in stem.split()) or "Материал"


def build_material_catalog(
    brand: dict[str, object],
    assets_dir: Path,
    url_for: Callable[[str], str],
) -> tuple[list[dict[str, object]], dict[str, str]]:
    current = {
        "logo": str(brand.get("logo") or "logo.svg"),
        "key_render": str(brand.get("key_render") or "key-render.jpg"),
    }
    metadata: dict[str, dict[str, str]] = {
        current["logo"]: {
            "name": "Логотип",
            "description": "Основной логотип объекта для брендированных карточек.",
        },
        current["key_render"]: {
            "name": "Ключевой рендер",
            "description": "Главное изображение проекта в левой части макета.",
        },
    }
    for index, item in enumerate(brand.get("additional_logos", []), start=1):
        if not isinstance(item, dict) or not item.get("filename"):
            continue
        filename = str(item["filename"])
        metadata[filename] = {
            "name": str(item.get("name") or f"Дополнительный логотип {index}"),
            "description": "Дополнительный вариант фирменного логотипа объекта.",
        }
    for index, item in enumerate(brand.get("additional_renders", []), start=1):
        if not isinstance(item, dict) or not item.get("filename"):
            continue
        filename = str(item["filename"])
        metadata[filename] = {
            "name": str(item.get("name") or f"Дополнительный рендер {index}"),
            "description": "Дополнительный фирменный рендер объекта.",
        }

    filenames = set(metadata)
    if assets_dir.is_dir():
        filenames.update(
            path.relative_to(assets_dir).as_posix()
            for path in assets_dir.rglob("*")
            if path.is_file() and path.suffix.lower() in SUPPORTED_EXTENSIONS
        )

    items: list[dict[str, object]] = []
    for filename in sorted(
        filenames,
        key=lambda value: (
            value not in current.values(),
            value.startswith("uploads/"),
            value.lower(),
        ),
    ):
        path = assets_dir / filename
        active_for = [role for role, selected in current.items() if selected == filename]
        details = metadata.get(filename, {})
        items.append({
            "key": "asset-" + hashlib.sha1(filename.encode("utf-8")).hexdigest()[:12],
            "name": details.get("name") or display_name(filename),
            "description": details.get("description") or "Загруженный фирменный материал объекта.",
            "filename": filename,
            "required": bool(active_for),
            "exists": path.is_file(),
            "url": url_for(filename) if path.is_file() else "",
            "active_for": active_for,
            "uploaded": filename.startswith("uploads/"),
        })
    return items, current
