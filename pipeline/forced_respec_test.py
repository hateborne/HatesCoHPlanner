"""Tests for pipeline.forced_respec (python -m unittest pipeline.forced_respec_test; run by CI)."""
from __future__ import annotations

import unittest

from pipeline.forced_respec import forced_respec_warnings

# two classes as the exporter holds them: one with specialization sets (SpecializeAt 23, so they
# open at 24) and one without
CLASS_CATS = {
    "Class_Spider": {"pri": "Spider_Pri", "sec": "Spider_Sec"},
    "Class_Blaster": {"pri": "Blaster_Ranged", "sec": "Blaster_Support"},
}
CATS = {
    "spider_pri": {"PowerSets": ["Spider_Pri.Trunk", "Spider_Pri.Branch_A", "Spider_Pri.Branch_B"]},
    "spider_sec": {"PowerSets": ["Spider_Sec.Trunk", "Spider_Sec.Branch_A"]},
    "blaster_ranged": {"PowerSets": ["Blaster_Ranged.Fire_Blast"]},
    "blaster_support": {"PowerSets": ["Blaster_Support.Gadgets"]},
}
SETS = {
    "Spider_Pri.Trunk": {"SpecializeAt": 0},
    "Spider_Pri.Branch_A": {"SpecializeAt": 23},
    "Spider_Pri.Branch_B": {"SpecializeAt": 23},
    "Spider_Sec.Trunk": {},
    "Spider_Sec.Branch_A": {"SpecializeAt": 23},
    "Blaster_Ranged.Fire_Blast": {"SpecializeAt": 0},
    "Blaster_Support.Gadgets": {},
}


def warnings(spider_respecs: object, blaster_respecs: object = None) -> list[str]:
    """@return The warnings for the two classes with these LevelUpRespecs values."""
    classes = [{"Name": "Class_Spider", "LevelUpRespecs": spider_respecs},
               {"Name": "Class_Blaster", "LevelUpRespecs": blaster_respecs},
               {"Name": "Class_Not_Exported", "LevelUpRespecs": [10]}]
    return forced_respec_warnings(classes, CLASS_CATS, CATS, SETS)


class ForcedRespecTest(unittest.TestCase):
    def test_respec_where_the_sets_open(self):
        self.assertEqual(warnings([24]), [])

    def test_a_lone_value_reads_as_one(self):
        self.assertEqual(warnings(24), [])

    def test_a_respec_elsewhere_warns(self):
        found = warnings([25])
        self.assertEqual(len(found), 1)
        self.assertIn("Class_Spider respecs on training to [25]", found[0])
        self.assertIn("open at [24]", found[0])

    def test_a_second_respec_warns(self):
        self.assertEqual(len(warnings([24, 30])), 1)

    def test_no_respec_with_sets_warns(self):
        for none in (None, [], 0, [0]):
            with self.subTest(none=none):
                found = warnings(none)
                self.assertEqual(len(found), 1)
                self.assertIn("respecs on training to no level", found[0])

    def test_a_respec_without_sets_warns(self):
        found = warnings([24], [24])
        self.assertEqual(len(found), 1)
        self.assertIn("Class_Blaster", found[0])
        self.assertIn("open at no level", found[0])

    def test_a_missing_category_reads_as_no_sets(self):
        cats = {k: v for k, v in CATS.items() if k != "spider_sec"}
        classes = [{"Name": "Class_Spider", "LevelUpRespecs": [24]}]
        self.assertEqual(forced_respec_warnings(classes, CLASS_CATS, cats, SETS), [])


if __name__ == "__main__":
    unittest.main()
