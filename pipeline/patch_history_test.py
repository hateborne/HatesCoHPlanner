"""Tests for pipeline/patch-history.json, the patch timeline (python -m unittest pipeline.patch_history_test; run by CI)."""
from __future__ import annotations

import datetime
import json
import unittest
from pathlib import Path

PATH = Path(__file__).with_name("patch-history.json")
KEYS = ("date", "issue", "page", "server", "label", "kind", "build", "source", "sections", "planner", "markers")
OPTIONAL = ("note",)
KINDS = {"beta", "live", "hotfix", "server-side", "rolled-back"}
SERVERS = {"Retail beta", "SCoRE", "Homecoming"}
SOURCE = "https://homecoming.wiki/wiki/"


class PatchHistory(unittest.TestCase):
    """Every entry has the fields docs/patch-history.md describes, in date order, in ASCII."""

    @classmethod
    def setUpClass(cls) -> None:
        cls.raw = PATH.read_bytes()
        cls.patches = json.loads(cls.raw)["patches"]

    def test_is_ascii(self) -> None:
        self.assertTrue(all(b < 127 for b in self.raw), "patch-history.json must be ASCII only")

    def test_entries_have_exactly_the_documented_fields(self) -> None:
        for e in self.patches:
            with self.subTest(date=e.get("date"), label=e.get("label")):
                self.assertTrue(set(KEYS) <= set(e), f"missing {set(KEYS) - set(e)}")
                self.assertTrue(set(e) <= set(KEYS + OPTIONAL), f"unknown {set(e) - set(KEYS + OPTIONAL)}")

    def test_field_values(self) -> None:
        for e in self.patches:
            with self.subTest(date=e["date"], label=e["label"]):
                datetime.date.fromisoformat(e["date"])
                self.assertIsInstance(e["issue"], int)
                self.assertTrue(e["page"] is None or isinstance(e["page"], int))
                self.assertIn(e["server"], SERVERS)
                self.assertIn(e["kind"], KINDS)
                self.assertTrue(e["build"] is None or (isinstance(e["build"], str) and e["build"]))
                self.assertTrue(e["source"].startswith(SOURCE), e["source"])
                self.assertTrue(e["label"])
                for key in ("sections", "planner", "markers"):
                    self.assertIsInstance(e[key], list)
                    self.assertTrue(all(isinstance(x, str) and x for x in e[key]), key)
                if "note" in e:
                    self.assertTrue(isinstance(e["note"], str) and e["note"])

    def test_in_date_order(self) -> None:
        dates = [e["date"] for e in self.patches]
        self.assertEqual(dates, sorted(dates))


if __name__ == "__main__":
    unittest.main()
