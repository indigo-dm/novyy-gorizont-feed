from __future__ import annotations

from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
workflow = (ROOT / ".github" / "workflows" / "build-fast-data.yml").read_text(encoding="utf-8")
refresh = (ROOT / ".github" / "workflows" / "refresh-fast-data.yml").read_text(encoding="utf-8")
renderer = (ROOT / "src" / "render_pilot.cjs").read_text(encoding="utf-8")

assert "uses: ./.github/workflows/deploy-pages.yml" in workflow
assert "render_ids: changed" in workflow
assert "secrets: inherit" in workflow
assert "--data-only" not in workflow
assert "src/build_fast.py" not in workflow
assert "uses: ./.github/workflows/build-fast-data.yml" in refresh
assert "actions: read" in refresh
assert "card_version: String(item.card_version || '')" in renderer

print({
    "safe_refresh": True,
    "incremental_renderer": True,
    "data_only_publish_removed": True,
})
