from __future__ import annotations

import os
from urllib.request import Request, urlopen

from project_context import INPUT_DIR, PROJECT_SLUG

destination = INPUT_DIR / "avito.xml"
url = os.environ.get("PROFITBASE_FEED_URL", "").strip()

if not url:
    raise SystemExit("PROFITBASE_FEED_URL GitHub Actions secret is not configured")

request = Request(url, headers={"User-Agent": f"feed-studio/{PROJECT_SLUG}"})
with urlopen(request, timeout=90) as response:
    content = response.read()

if not content.lstrip().startswith(b"<?xml"):
    raise SystemExit("Profitbase response is not XML")

destination.parent.mkdir(parents=True, exist_ok=True)
destination.write_bytes(content)
print(f"Downloaded {len(content)} bytes to {destination}")
