from __future__ import annotations

import os
from pathlib import Path
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parents[1]
destination = ROOT / "input" / "avito.xml"
url = os.environ.get("PROFITBASE_FEED_URL", "").strip()

if not url:
    raise SystemExit("PROFITBASE_FEED_URL GitHub Actions secret is not configured")

request = Request(url, headers={"User-Agent": "novyy-gorizont-feed-generator/1.0"})
with urlopen(request, timeout=90) as response:
    content = response.read()

if not content.lstrip().startswith(b"<?xml"):
    raise SystemExit("Profitbase response is not XML")

destination.parent.mkdir(parents=True, exist_ok=True)
destination.write_bytes(content)
print(f"Downloaded {len(content)} bytes to {destination}")
