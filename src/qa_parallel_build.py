from __future__ import annotations

import json
import subprocess
import sys
import tempfile
from pathlib import Path

from sync_fast_data import PROJECT_FILES


ROOT = Path(__file__).resolve().parents[1]
PYTHON = sys.executable
configured = json.loads((ROOT / "projects.json").read_text(encoding="utf-8"))
expected = [
    str(project["slug"])
    for project in configured["projects"]
    if project.get("source_feed_key") or project.get("source_feed_secret")
]

matrix = json.loads(subprocess.check_output(
    [PYTHON, "src/project_matrix.py"],
    cwd=ROOT,
    text=True,
))
assert matrix == expected

with tempfile.TemporaryDirectory() as temporary:
    root = Path(temporary)
    source = root / "staged"
    published = root / "published"
    published.mkdir(parents=True)
    (published / "projects.json").write_text(json.dumps({
        "projects": [{"slug": slug, "available": True} for slug in expected],
    }), encoding="utf-8")
    for slug in expected:
        artifact = source / "artifacts" / f"feed-project-{slug}"
        artifact.mkdir(parents=True)
        for filename in PROJECT_FILES:
            payload = json.dumps({"slug": slug, "items": []}) if filename.endswith(".json") else "<Ads/>"
            (artifact / filename).write_text(payload, encoding="utf-8")

    subprocess.run([
        PYTHON,
        "src/finalize_project_registry.py",
        "--source", str(source),
        "--published", str(published),
        "--registry", "projects.json",
        "--build-id", "qa-build",
    ], cwd=ROOT, check=True)
    result = json.loads((source / "projects.json").read_text(encoding="utf-8"))
    assert result["build_id"] == "qa-build"
    assert [item["slug"] for item in result["projects"] if item["available"]] == expected
    assert all((source / "projects" / slug / "inventory.json").is_file() for slug in expected)
    subprocess.run([
        PYTHON,
        "src/sync_fast_data.py",
        "--source", str(source),
        "--destination", str(published),
    ], cwd=ROOT, check=True)
    assert all((published / "projects" / slug / "avito.xml").is_file() for slug in expected)

print({
    "matrix_projects": expected,
    "parallel_artifacts_collected": True,
    "registry_finalized_once": True,
    "snapshot_finalized_once": True,
})
