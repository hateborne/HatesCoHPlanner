"""Tests for the PvP-only requirement test (python -m unittest pipeline.pvp_test; run by CI).

pvp_requires drops a group only when its requirement can never hold in PvE; the requirements here
are the clients' own (Homecoming and Thunderspy).
"""
from __future__ import annotations

import unittest

from pipeline.pvp import pvp_requires


def r(s: str) -> list[str]:
    """@return A requirement written as the data writes it, tokens split on spaces."""
    return s.split()


class PvpRequiresTest(unittest.TestCase):
    def test_drops_a_group_for_player_targets_only(self):
        self.assertTrue(pvp_requires(r("enttype target> player eq")))
        self.assertTrue(pvp_requires(r("enttype target> player eq target.isFriend? ! &&")))
        self.assertTrue(pvp_requires(r("kMeter source> .9 < kHeld target> 0 > kSleep target> 0 > || && "
                                        "enttype target> player eq &&")))

    def test_reads_pve_as_no_pvp_map(self):
        self.assertTrue(pvp_requires(r("enttype target> player eq isPVPMap? ||")))
        self.assertFalse(pvp_requires(r("enttype target> player eq isPVPMap? ! ||")))

    def test_leaves_a_group_that_tests_for_no_player_target(self):
        # as before: a requirement of 0 (Hand Clap), a PvP map alone (Black Dwarf), a variable
        self.assertFalse(pvp_requires(r("0")))
        self.assertFalse(pvp_requires(r("isPVPMap?")))
        self.assertFalse(pvp_requires(r("@CustomFX *null* eq")))

    def test_keeps_a_group_that_also_applies_to_critters(self):
        # Stygian Circle's heal vs bosses "or players" (428.36 in game on Thunderspy, level 50)
        self.assertFalse(pvp_requires(r("arch target> Class_Boss_Grunt eq arch target> Class_Boss_Elite eq || "
                                         "enttype target> player eq ||")))
        # its heal vs minions: neither a lieutenant, a boss nor a player
        self.assertFalse(pvp_requires(r("arch target> Class_Lt_Grunt eq ! arch target> Class_Lt_Sniper eq ! && "
                                         "enttype target> player eq ! &&")))
        # Blaze Mastery's Char: neither a minion, a lieutenant ... nor a player
        self.assertFalse(pvp_requires(r("arch target> Class_Minion_Grunt eq arch target> Class_Minion_Small eq || "
                                         "enttype target> player eq || !")))
        self.assertFalse(pvp_requires(r("enttype target> player eq !")))

    def test_keeps_what_it_cant_tell(self):
        self.assertFalse(pvp_requires([]))
        self.assertFalse(pvp_requires(r("enttype target> critter eq")))
        self.assertFalse(pvp_requires(r("kMeter source> 0 >")))
        self.assertFalse(pvp_requires(r("target.isFriend?")))
        self.assertFalse(pvp_requires(r("Temporary_Powers.Temporary_Powers.Combo_Level_1 source.ownPower?")))
        # control flow it doesn't follow
        self.assertFalse(pvp_requires(r("enttype target> player eq if 1 then endif")))

    def test_works_values_it_knows(self):
        player = "enttype target> player eq "
        self.assertTrue(pvp_requires(r(player + "1 2 > ||")))
        self.assertFalse(pvp_requires(r(player + "2 1 > ||")))
        self.assertTrue(pvp_requires(r(player + "0 dup && ||")))
        self.assertFalse(pvp_requires(r(player + "1 0 / ||")))  # a division by zero is unknown, not false
        self.assertFalse(pvp_requires(r(player + "@CustomFX *null* eq ||")))  # a variable is unknown


if __name__ == "__main__":
    unittest.main()
