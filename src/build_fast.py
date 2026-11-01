from __future__ import annotations

import json
import os
import subprocess
import sys
from datetime import datetime, timezone

from project_context import REGISTRY, ROOT


def run(command: list[str], env: dict[str, str]) -> None:
    subprocess.run(command, cwd=ROOT, env=env, check=True)


def feed_url(slug: str) -> str:
    raw = os.environ.get("PROFITBASE_FEEDS_JSON", "").strip()
    feeds = json.loads(raw) if raw else {}
    if not isinstance(feeds, dict):
        raise ValueError("PROFITBASE_FEEDS_JSON must be a JSON object")
    default_slug = str(REGISTRY["default_project"])
    return str(feeds.get(slug) or (os.environ.get("PROFITBASE_FEED_URL", "") if slug == default_slug else "")).strip()


def build_project(slug: str, build_id: str) -> None:
    url = feed_url(slug)
    if not url:
        raise RuntimeError(f"Profitbase feed is not configured for {slug}")
    env = os.environ.copy()
    env.update({
        "PROJECT_SLUG": slug,
        "PROFITBASE_FEED_URL": url,
        "BUILD_ID": build_id,
        "FAST_BUILD": "1",
    })
    run([sys.executable, "src/fetch_feed.py"], env)
    run([sys.executable, "src/build_pilot.py"], env)
    run([sys.executable, "src/validate_pilot.py"], env)
    run([sys.executable, "src/build_fast_data.py"], env)


def main() -> None:
    requested = os.environ.get("PROJECT_SLUG", "").strip()
    build_id = os.environ.get("BUILD_ID", "").strip() or datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")
    if requested:
        build_project(requested, build_id)
        return
    for project in REGISTRY["projects"]:
        if project.get("status") == "active":
            build_project(str(project["slug"]), build_id)


if __name__ == "__main__":
    main()
