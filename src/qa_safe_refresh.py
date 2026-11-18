from __future__ import annotations

from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
workflow = (ROOT / ".github" / "workflows" / "build-fast-data.yml").read_text(encoding="utf-8")
refresh = (ROOT / ".github" / "workflows" / "refresh-fast-data.yml").read_text(encoding="utf-8")
deploy = (ROOT / ".github" / "workflows" / "deploy-pages.yml").read_text(encoding="utf-8")
apply_settings = (ROOT / ".github" / "workflows" / "apply-settings.yml").read_text(encoding="utf-8")
validate_feed = (ROOT / ".github" / "workflows" / "validate-feed.yml").read_text(encoding="utf-8")
compact = (ROOT / ".github" / "workflows" / "compact-feed-data.yml").read_text(encoding="utf-8")
backup = (ROOT / ".github" / "workflows" / "backup-feed-data.yml").read_text(encoding="utf-8")
renderer = (ROOT / "src" / "render_pilot.cjs").read_text(encoding="utf-8")

assert "uses: ./.github/workflows/deploy-pages.yml" in workflow
assert "render_ids: changed" in workflow
assert "secrets: inherit" in workflow
assert "max-parallel: 4" in workflow
assert "finalize: false" in workflow
assert "src/finalize_project_registry.py" in workflow
assert "--registry-only" in workflow
assert "--data-only" not in workflow
assert "src/build_fast.py" not in workflow
assert "uses: ./.github/workflows/build-fast-data.yml" in refresh
assert "actions: write" in refresh
assert "actions: write" in workflow
assert "actions: write" in deploy
assert "Remove obsolete rendered card caches" in deploy
assert ".slice(1)" in deploy
assert "format('render-cache/{0}'" in deploy
assert "--skip-registry" in deploy
assert "Preserve project data for registry finalization" in deploy
assert "Load current published state from R2" in deploy
assert "PUBLISHED_DATA_DIR: .published" in deploy
assert "ref: feed-data" not in deploy
assert "git -C .feed-data" not in deploy
assert "Checkout current published data" not in workflow
assert "git -C .feed-data" not in workflow
assert "Load current public registry from R2" in workflow
assert "--force-with-lease" in compact
assert "git checkout --orphan feed-data-compacted" in compact
assert "Mirror current published data from R2" in backup
assert "cron: \"47 2 * * *\"" in backup
assert "card_version: publishedCardVersion(item)" in renderer
assert "require('./card_version.cjs')" in renderer
for settings_workflow in (apply_settings, validate_feed):
    assert "src/resolve_settings_reference.py" in settings_workflow
    assert "SETTINGS_JSON_FILE:" in settings_workflow
    assert "aws s3 cp" in settings_workflow
    assert "aws s3 rm" in settings_workflow

print({
    "safe_refresh": True,
    "incremental_renderer": True,
    "parallel_project_builds": 4,
    "project_scoped_render_cache": True,
    "single_registry_finalization": True,
    "r2_is_hot_path_source": True,
    "feed_data_daily_backup": True,
    "data_only_publish_removed": True,
    "render_cache_retention": 2,
    "feed_data_compaction": True,
    "r2_settings_references": True,
})
