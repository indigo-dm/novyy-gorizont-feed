from __future__ import annotations

import json
import os
import re
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import quote, urlencode
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parents[1]


def github_json(url: str, token: str, method: str = "GET", payload: dict[str, object] | None = None) -> dict[str, object]:
    data = json.dumps(payload).encode("utf-8") if payload is not None else None
    request = Request(
        url,
        data=data,
        method=method,
        headers={
            "Accept": "application/vnd.github+json",
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "User-Agent": "indigo-feed-studio-cleanup",
            "X-GitHub-Api-Version": "2022-11-28",
        },
    )
    with urlopen(request, timeout=60) as response:
        return json.loads(response.read().decode("utf-8"))


def main() -> None:
    token = os.environ.get("GITHUB_TOKEN", "").strip()
    repository = os.environ.get("GITHUB_REPOSITORY", "").strip()
    branch = os.environ.get("GITHUB_MEDIA_BRANCH", "media").strip() or "media"
    if not token or not re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", repository):
        raise SystemExit("GitHub cleanup credentials are unavailable")

    deleted = 0
    already_missing = 0
    for settings_path in sorted((ROOT / "projects").glob("*/promotion-rules.json")):
        project_slug = settings_path.parent.name
        settings = json.loads(settings_path.read_text(encoding="utf-8"))
        for item in settings.get("pending_upload_deletions", []):
            lot_id = str(item.get("lot") or "")
            image_id = str(item.get("id") or "")
            path = str(item.get("path") or "")
            expected = rf"uploads/{re.escape(project_slug)}/{re.escape(lot_id)}/{re.escape(image_id)}\.(?:jpg|jpeg|png|webp)"
            if not lot_id.isdigit() or not re.fullmatch(r"add-[A-Za-z0-9_-]+", image_id) or not re.fullmatch(expected, path, flags=re.IGNORECASE):
                raise ValueError(f"Unsafe upload cleanup path: {path}")
            encoded_path = quote(path, safe="/")
            content_url = f"https://api.github.com/repos/{repository}/contents/{encoded_path}?{urlencode({'ref': branch})}"
            try:
                content = github_json(content_url, token)
            except HTTPError as error:
                if error.code == 404:
                    already_missing += 1
                    continue
                raise
            github_json(
                f"https://api.github.com/repos/{repository}/contents/{encoded_path}",
                token,
                method="DELETE",
                payload={
                    "message": f"Delete uploaded image {image_id} for {project_slug} lot {lot_id}",
                    "sha": str(content["sha"]),
                    "branch": branch,
                },
            )
            deleted += 1

    print(json.dumps({"deleted": deleted, "already_missing": already_missing}, ensure_ascii=False))


if __name__ == "__main__":
    main()
