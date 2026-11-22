import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import build_all


class UnavailableSourceTests(unittest.TestCase):
    def test_empty_source_keeps_publication_and_skips_render_and_publish(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            project = root / "site" / "projects" / "orion"
            project.mkdir(parents=True)
            original = {"status.json": '{"checked_at":"old"}', "inventory.json": '{"items":[]}', "avito.xml": "<Ads/>"}
            for name, text in original.items():
                (project / name).write_text(text, encoding="utf-8")
            output = root / "output"
            summary = root / "summary"
            env = {
                "PROJECT_SLUG": "orion", "SITE_PREPARED": "1",
                "PROFITBASE_FEEDS_JSON": json.dumps({"orion": "https://source.example/feed"}),
                "GITHUB_OUTPUT": str(output), "GITHUB_STEP_SUMMARY": str(summary),
            }
            with patch.object(build_all, "ROOT", root), patch.dict(os.environ, env, clear=True), patch.object(
                build_all, "run", side_effect=subprocess.CalledProcessError(75, "fetch_feed")
            ) as run:
                build_all.main()
                self.assertEqual(run.call_count, 1)
            self.assertEqual(output.read_text(), "skip_publish=true\n")
            for name, text in original.items():
                self.assertEqual((project / name).read_text(encoding="utf-8"), text)
            self.assertEqual(json.loads((project / "refresh-outcome.json").read_text())["status"], "unavailable")

    def test_missing_previous_publication_is_not_silently_accepted(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(build_all, "ROOT", Path(directory)):
            with self.assertRaisesRegex(RuntimeError, "no previous publication"):
                build_all.preserve_unavailable_source("orion")


if __name__ == "__main__":
    unittest.main()
