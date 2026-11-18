#!/usr/bin/env python3
"""Run the GitHub cron only when the primary Cloudflare dispatch is missing."""

from __future__ import annotations

import json
import os
import urllib.parse
import urllib.request
from datetime import datetime, time, timezone


PRIMARY_HOURS_UTC = (10, 21)


def target_window(now: datetime) -> str:
    """Return the primary :17 window paired with the latest reserve :47 slot."""
    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)
    now = now.astimezone(timezone.utc)
    candidates = []
    for day_offset in (0, -1):
        day = now.date()
        if day_offset:
            day = date_from_ordinal(day.toordinal() + day_offset)
        for hour in PRIMARY_HOURS_UTC:
            fallback_at = datetime.combine(day, time(hour, 47), timezone.utc)
            if fallback_at <= now:
                candidates.append(datetime.combine(day, time(hour, 17), timezone.utc))
    if not candidates:
        raise RuntimeError("Cannot determine the scheduled refresh window")
    return max(candidates).strftime("%Y-%m-%dT%H:%MZ")


def date_from_ordinal(value: int):
    from datetime import date

    return date.fromordinal(value)


def primary_run_covers_window(runs: list[dict], window_id: str) -> bool:
    for run in runs:
        if window_id not in str(run.get("display_title") or ""):
            continue
        status = str(run.get("status") or "")
        conclusion = run.get("conclusion")
        if status in {"queued", "in_progress", "waiting", "pending", "requested"}:
            return True
        if status == "completed" and conclusion == "success":
            return True
    return False


def repository_dispatch_runs(repository: str, workflow_file: str, token: str) -> list[dict]:
    workflow = urllib.parse.quote(workflow_file, safe="")
    url = (
        f"https://api.github.com/repos/{repository}/actions/workflows/{workflow}/runs"
        "?event=repository_dispatch&per_page=30"
    )
    request = urllib.request.Request(
        url,
        headers={
            "Accept": "application/vnd.github+json",
            "Authorization": f"Bearer {token}",
            "User-Agent": "feed-refresh-fallback",
            "X-GitHub-Api-Version": "2022-11-28",
        },
    )
    with urllib.request.urlopen(request, timeout=20) as response:
        payload = json.load(response)
    return list(payload.get("workflow_runs") or [])


def write_output(name: str, value: str) -> None:
    output_path = os.environ.get("GITHUB_OUTPUT")
    line = f"{name}={value}\n"
    if output_path:
        with open(output_path, "a", encoding="utf-8") as output:
            output.write(line)
    else:
        print(line, end="")


def main() -> int:
    if os.environ.get("EVENT_NAME") != "schedule":
        write_output("should_run", "true")
        write_output("target_window", "direct")
        return 0

    window_id = target_window(datetime.now(timezone.utc))
    write_output("target_window", window_id)
    try:
        runs = repository_dispatch_runs(
            os.environ["REPOSITORY"],
            os.environ.get("WORKFLOW_FILE", "refresh-fast-data.yml"),
            os.environ["GITHUB_TOKEN"],
        )
        should_run = not primary_run_covers_window(runs, window_id)
    except Exception as error:
        # Fail open: a GitHub API read failure must not suppress the reserve build.
        print(f"Fallback check failed; reserve build will run: {error}")
        should_run = True
    write_output("should_run", "true" if should_run else "false")
    print(f"Scheduled window {window_id}: reserve build {'required' if should_run else 'skipped'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
