from __future__ import annotations

import json

from project_context import REGISTRY


projects = [
    str(project["slug"])
    for project in REGISTRY.get("projects", [])
    if project.get("source_feed_key") or project.get("source_feed_secret")
]
if not projects:
    raise RuntimeError("No configured projects are available for the build matrix")
print(json.dumps(projects, ensure_ascii=False, separators=(",", ":")))
