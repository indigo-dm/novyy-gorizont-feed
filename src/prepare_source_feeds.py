from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
from urllib.parse import urlparse


def valid_https_url(value: object) -> str:
    candidate = str(value or "").strip()
    parsed = urlparse(candidate)
    if parsed.scheme != "https" or not parsed.netloc or parsed.username or parsed.password:
        raise ValueError("Source feed URL must be an HTTPS address without embedded credentials")
    return candidate


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", required=True)
    args = parser.parse_args()

    feeds: dict[str, str] = {}
    legacy = os.environ.get("PROFITBASE_FEEDS_JSON", "").strip()
    if legacy:
        parsed = json.loads(legacy)
        if not isinstance(parsed, dict):
            raise ValueError("PROFITBASE_FEEDS_JSON must be a JSON object")
        for slug, url in parsed.items():
            feeds[str(slug)] = valid_https_url(url)

    source = Path(args.source)
    if source.is_dir():
        for path in sorted(source.glob("*.json")):
            payload = json.loads(path.read_text(encoding="utf-8"))
            if not isinstance(payload, dict) or payload.get("version") != 1:
                raise ValueError(f"Unsupported protected source feed record: {path.name}")
            slug = str(payload.get("project") or "").strip()
            if not slug or path.stem != slug:
                raise ValueError(f"Protected source feed record has an invalid project: {path.name}")
            feeds[slug] = valid_https_url(payload.get("url"))

    github_env = os.environ.get("GITHUB_ENV", "").strip()
    if not github_env:
        raise RuntimeError("GITHUB_ENV is unavailable")
    value = json.dumps(feeds, ensure_ascii=False, separators=(",", ":"))
    with Path(github_env).open("a", encoding="utf-8") as handle:
        handle.write(f"PROFITBASE_FEEDS_JSON={value}\n")
    print(f"Loaded protected source addresses for {len(feeds)} project(s).")


if __name__ == "__main__":
    main()
