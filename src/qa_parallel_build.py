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
        "build_id": "previous-build",
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
    assert all(
        {path.name for path in (source / "projects" / slug).iterdir()} == set(PROJECT_FILES)
        for slug in expected
    )

    # An empty source retains old files and their checked_at rather than pretending to rebuild.
    for slug in expected:
        marker = source / "artifacts" / f"feed-project-{slug}" / "refresh-outcome.json"
        marker.write_text(json.dumps({
            "project": slug, "status": "unavailable", "reason": "empty_source_response",
        }), encoding="utf-8")
    command = [
        PYTHON, "src/finalize_project_registry.py",
        "--source", str(source), "--published", str(published),
        "--registry", "projects.json", "--build-id", "new-attempt",
    ]
    subprocess.run(command, cwd=ROOT, check=True)
    skipped_result = json.loads((source / "projects.json").read_text(encoding="utf-8"))
    assert skipped_result["build_id"] == "previous-build"
    assert all(item["available"] and item["source_refresh"]["status"] == "unavailable" for item in skipped_result["projects"])

print({
    "matrix_projects": expected,
    "parallel_artifacts_collected": True,
    "registry_finalized_once": True,
    "r2_registry_finalized_once": True,
    "artifacts_exclude_rendered_media": True,
})
