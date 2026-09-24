from __future__ import annotations

import json
import shutil

from project_context import REGISTRY, ROOT


SITE = ROOT / "site"
WEB = ROOT / "web"
SHARED_ASSETS = ROOT / "assets"

if SITE.exists():
    shutil.rmtree(SITE)
(SITE / "assets").mkdir(parents=True)
(SITE / "projects").mkdir(parents=True)

for filename in ("index.html", "app.css", "app.js"):
    shutil.copy2(WEB / filename, SITE / filename)
shutil.copy2(SHARED_ASSETS / "Manrope-Variable.ttf", SITE / "assets" / "Manrope-Variable.ttf")
shutil.copy2(SHARED_ASSETS / "logo-gold.svg", SITE / "assets" / "logo-gold.svg")
(SITE / ".nojekyll").write_text("", encoding="utf-8")
public_registry = {
    "version": 1,
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
