from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
from pathlib import Path


MAX_SETTINGS_JSON_CHARS = 2_000_000
UUID_PATTERN = r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"
KEY_PATTERN = re.compile(
    rf"^settings-requests/(?:apply|validation)/[a-z0-9]+(?:-[a-z0-9]+)*/{UUID_PATTERN}\.json$"
)


def reference_from_body(body: str) -> dict[str, object] | None:
    match = re.search(
        r"FEED_SETTINGS_REF_START\s*(\{.*?\})\s*FEED_SETTINGS_REF_END",
        body,
        flags=re.DOTALL,
    )
    if not match:
        return None
    value = json.loads(match.group(1))
    if not isinstance(value, dict) or value.get("version") != 1:
        raise ValueError("Unsupported settings reference")
    key = str(value.get("key") or "")
    sha256 = str(value.get("sha256") or "").lower()
    if not KEY_PATTERN.fullmatch(key):
        raise ValueError("Unsafe settings reference key")
    if not re.fullmatch(r"[0-9a-f]{64}", sha256):
        raise ValueError("Invalid settings reference digest")
    return {"key": key, "sha256": sha256}


def verify_file(path: Path, expected_sha256: str) -> None:
    payload = path.read_bytes()
    if len(payload) > MAX_SETTINGS_JSON_CHARS * 4:
        raise ValueError("Referenced settings file is too large")
    source = payload.decode("utf-8")
    if len(source) > MAX_SETTINGS_JSON_CHARS:
        raise ValueError("Referenced settings JSON exceeds the maximum size")
    if hashlib.sha256(payload).hexdigest() != expected_sha256:
        raise ValueError("Referenced settings digest does not match")
    value = json.loads(source)
    if not isinstance(value, dict):
        raise ValueError("Referenced settings must be a JSON object")


def write_output(name: str, value: str) -> None:
    output = os.environ.get("GITHUB_OUTPUT")
    if output:
        with Path(output).open("a", encoding="utf-8") as handle:
            handle.write(f"{name}={value}\n")
    else:
        print(f"{name}={value}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--verify-file", type=Path)
    parser.add_argument("--expected-sha256", default="")
    args = parser.parse_args()
    if args.verify_file:
        if not re.fullmatch(r"[0-9a-f]{64}", args.expected_sha256.lower()):
            raise SystemExit("Invalid expected digest")
        verify_file(args.verify_file, args.expected_sha256.lower())
        return
    reference = reference_from_body(os.environ.get("ISSUE_BODY", ""))
    write_output("storage_key", str(reference["key"]) if reference else "")
    write_output("expected_sha256", str(reference["sha256"]) if reference else "")
    write_output("settings_file", ".settings-request.json" if reference else "")


if __name__ == "__main__":
    main()
