from __future__ import annotations

import json
import os
import re
import shutil

from project_context import REGISTRY, ROOT


SITE = ROOT / "site"
WEB = ROOT / "web"
SHARED_ASSETS = ROOT / "assets"

if SITE.exists():
    shutil.rmtree(SITE)
(SITE / "assets").mkdir(parents=True)
(SITE / "projects").mkdir(parents=True)

for filename in ("index.html", "app.css", "app.js", "access.js"):
    shutil.copy2(WEB / filename, SITE / filename)

password_hash = os.environ.get("FEED_STUDIO_PASSWORD_HASH", "").strip().lower()
if not re.fullmatch(r"[0-9a-f]{64}", password_hash):
    raise RuntimeError("FEED_STUDIO_PASSWORD_HASH must be a SHA-256 hex digest")
(SITE / "access-config.js").write_text(
    "window.FEED_STUDIO_ACCESS = "
    + json.dumps({"version": 1, "passwordHash": password_hash}, separators=(",", ":"))
    + ";\n",
    encoding="utf-8",
)
shutil.copy2(SHARED_ASSETS / "Manrope-Variable.ttf", SITE / "assets" / "Manrope-Variable.ttf")
shutil.copy2(SHARED_ASSETS / "logo-gold.svg", SITE / "assets" / "logo-gold.svg")
shutil.copy2(SHARED_ASSETS / "indigo-logo.svg", SITE / "assets" / "indigo-logo.svg")
(SITE / ".nojekyll").write_text("", encoding="utf-8")
public_registry = {
    "version": 1,
    "build_id": os.environ.get("BUILD_ID", "development"),
    "default_project": REGISTRY["default_project"],
    "projects": [
        {
            "slug": project["slug"],
            "name": project["name"],
            "status": project.get("status", "setup"),
            "available": False,
            "base": f"projects/{project['slug']}",
        }
        for project in REGISTRY["projects"]
    ],
}
(SITE / "projects.json").write_text(
    json.dumps(public_registry, ensure_ascii=False, indent=2), encoding="utf-8"
)
print(SITE)
