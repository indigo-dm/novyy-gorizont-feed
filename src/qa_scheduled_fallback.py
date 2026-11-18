#!/usr/bin/env python3

import unittest
from datetime import datetime, timezone

from scheduled_fallback import primary_run_covers_window, target_window


class ScheduledFallbackTests(unittest.TestCase):
    def test_daytime_window(self):
        self.assertEqual(
            target_window(datetime(2026, 11, 19, 10, 48, tzinfo=timezone.utc)),
            "2026-11-19T10:17Z",
        )

    def test_delayed_daytime_event_still_maps_to_daytime_window(self):
        self.assertEqual(
            target_window(datetime(2026, 11, 19, 20, 0, tzinfo=timezone.utc)),
            "2026-11-19T10:17Z",
        )

    def test_delayed_midnight_event_crosses_utc_date(self):
        self.assertEqual(
            target_window(datetime(2026, 11, 20, 2, 0, tzinfo=timezone.utc)),
            "2026-11-19T21:17Z",
        )

    def test_active_primary_run_suppresses_fallback(self):
        runs = [{"display_title": "Fast feed refresh all-projects 2026-11-19T10:17Z", "status": "in_progress", "conclusion": None}]
        self.assertTrue(primary_run_covers_window(runs, "2026-11-19T10:17Z"))

    def test_successful_primary_run_suppresses_fallback(self):
        runs = [{"display_title": "Fast feed refresh all-projects 2026-11-19T10:17Z", "status": "completed", "conclusion": "success"}]
        self.assertTrue(primary_run_covers_window(runs, "2026-11-19T10:17Z"))

    def test_failed_primary_run_allows_fallback(self):
        runs = [{"display_title": "Fast feed refresh all-projects 2026-11-19T10:17Z", "status": "completed", "conclusion": "failure"}]
        self.assertFalse(primary_run_covers_window(runs, "2026-11-19T10:17Z"))


if __name__ == "__main__":
    unittest.main()
