from __future__ import annotations

import json
import os
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from project_context import ROOT


PUBLISHED = Path(os.environ.get("PUBLISHED_DATA_DIR", ROOT / ".feed-data" / "published"))
CACHE = Path(os.environ.get("RENDER_CACHE_DIR", ROOT / "render-cache"))
PUBLIC_ROOT = os.environ.get(
    "CURRENT_PAGES_ROOT", "https://indigo-feed-studio-upload.indigo-dm-tech.workers.dev/media"
).rstrip("/")


def download(url: str, destination: Path) -> str:
    if destination.is_file() and destination.stat().st_size:
        return "cached"
    destination.parent.mkdir(parents=True, exist_ok=True)
    request = Request(url, headers={"User-Agent": "feed-studio-render-cache/1.0"})
    for attempt in range(1, 4):
        try:
            with urlopen(request, timeout=60) as response:
                payload = response.read()
            if not payload:
                raise RuntimeError(f"Empty response from {url}")
            temporary = destination.with_suffix(destination.suffix + ".part")
            temporary.write_bytes(payload)
            temporary.replace(destination)
            return "downloaded"
        except HTTPError as error:
            if error.code == 404:
                return "missing"
            if attempt == 3 or not (error.code == 429 or 500 <= error.code < 600):
                raise
        except (URLError, TimeoutError):
            if attempt == 3:
                raise
        time.sleep(2 ** (attempt - 1))
    return "missing"


def main() -> None:
    registry = json.loads((PUBLISHED / "projects.json").read_text(encoding="utf-8"))
    tasks: list[tuple[str, Path]] = []
    for project in registry.get("projects", []):
        if not project.get("available"):
            continue
        slug = str(project["slug"])
        inventory_path = PUBLISHED / "projects" / slug / "inventory.json"
        if not inventory_path.is_file():
            continue
        inventory = json.loads(inventory_path.read_text(encoding="utf-8"))
        for item in inventory.get("items", []):
            item_id = str(item["id"])
            for folder, extension in (
                ("images", "png"),
                ("previews", "webp"),
                ("thumbnails", "webp"),
            ):
                relative = f"projects/{slug}/{folder}/{item_id}.{extension}"
                tasks.append((f"{PUBLIC_ROOT}/{relative}", CACHE / slug / folder / f"{item_id}.{extension}"))

    counters = {"cached": 0, "downloaded": 0, "missing": 0}
    with ThreadPoolExecutor(max_workers=16) as executor:
        futures = [executor.submit(download, url, destination) for url, destination in tasks]
        for future in as_completed(futures):
            counters[future.result()] += 1
    print(json.dumps({"files": len(tasks), **counters}, ensure_ascii=False))


if __name__ == "__main__":
    main()
