from __future__ import annotations

import os
import socket
import sys
import time
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from project_context import INPUT_DIR, PROJECT_SLUG

RETRYABLE_HTTP_CODES = {408, 425, 429, 500, 502, 503, 504}


def retry_delays(attempts: int) -> list[int]:
    configured = os.environ.get("PROFITBASE_FETCH_BACKOFF_SECONDS", "5,15,30")
    try:
        delays = [max(0, int(value.strip())) for value in configured.split(",") if value.strip()]
    except ValueError as error:
        raise SystemExit("PROFITBASE_FETCH_BACKOFF_SECONDS must contain whole seconds") from error
    if not delays:
        delays = [0]
    return [delays[min(index, len(delays) - 1)] for index in range(max(0, attempts - 1))]


def download_feed(url: str, attempts: int, delays: list[int]) -> bytes:
    request = Request(url, headers={"User-Agent": f"feed-studio/{PROJECT_SLUG}"})
    for attempt in range(1, attempts + 1):
        try:
            with urlopen(request, timeout=90) as response:
                return response.read()
        except HTTPError as error:
            retryable = error.code in RETRYABLE_HTTP_CODES
            if not retryable or attempt >= attempts:
                if retryable:
                    raise SystemExit(
                        f"Profitbase is unavailable after {attempt} attempts (HTTP {error.code})"
                    ) from None
                raise SystemExit(f"Profitbase rejected the request (HTTP {error.code})") from None
            delay = delays[attempt - 1]
            print(
                f"Profitbase attempt {attempt}/{attempts} returned HTTP {error.code}; retrying in {delay}s",
                file=sys.stderr,
            )
            time.sleep(delay)
        except (URLError, TimeoutError, socket.timeout):
            if attempt >= attempts:
                raise SystemExit(f"Profitbase connection failed after {attempt} attempts") from None
            delay = delays[attempt - 1]
            print(
                f"Profitbase attempt {attempt}/{attempts} could not connect; retrying in {delay}s",
                file=sys.stderr,
            )
            time.sleep(delay)
    raise AssertionError("unreachable")


def main() -> None:
    destination = INPUT_DIR / "avito.xml"
    url = os.environ.get("PROFITBASE_FEED_URL", "").strip()
    if not url:
        raise SystemExit("PROFITBASE_FEED_URL GitHub Actions secret is not configured")

    try:
        attempts = max(1, int(os.environ.get("PROFITBASE_FETCH_ATTEMPTS", "4")))
    except ValueError as error:
        raise SystemExit("PROFITBASE_FETCH_ATTEMPTS must be a whole number") from error
    content = download_feed(url, attempts, retry_delays(attempts))
    if not content.lstrip().startswith(b"<?xml"):
        raise SystemExit("Profitbase response is not XML")

    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_bytes(content)
    print(f"Downloaded {len(content)} bytes to {destination}")


if __name__ == "__main__":
    main()
