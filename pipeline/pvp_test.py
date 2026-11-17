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

    def test_drops_a_group_for_a_critter_and_a_player_at_once(self):
        # the one kind the test before kept (it held a critter test) and this one drops: never true
        self.assertTrue(pvp_requires(r("enttype target> critter eq enttype target> player eq &&")))

    def test_works_values_as_eval_c_does(self):
        player = "enttype target> player eq "
        holds = lambda expr: not pvp_requires(r(player + expr + " ||"))  # noqa: E731
        self.assertFalse(holds("1 2 >"))
        self.assertTrue(holds("2 1 >"))
        self.assertFalse(holds("0 dup &&"))
        # 32-bit floats: 0.1 + 0.2 is 0.3 there
        self.assertTrue(holds("0.1 0.2 + 0.3 =="))
        # logic truncates a float: 0.5 reads as false
        self.assertFalse(holds("0.5"))
        self.assertTrue(holds("0.5 !"))
        # a division or a modulo by zero is 0
        self.assertFalse(holds("1 0 /"))
        self.assertFalse(holds("5 0 %"))
        self.assertTrue(holds("-7 2 % -1 =="))  # C's %: the sign follows the dividend
        # minmax tests the low end first: 0 between 5 and 0 is 5
        self.assertTrue(holds("0 5 0 minmax"))
        # pow works in floats, with no endless integers
        self.assertTrue(holds("2 10 pow 1024 =="))
        self.assertFalse(holds("9 99999999 pow 0 =="))
        # eq on anything but two strings is 0; == on two strings compares them
        self.assertFalse(holds("1 1 eq"))
        self.assertTrue(holds("abc ABC =="))

    def test_reads_tokens_as_eval_c_does(self):
        player = "enttype target> player eq "
        holds = lambda expr: not pvp_requires(r(player + expr + " ||"))  # noqa: E731
        self.assertTrue(holds(".9 .5 >"))  # a float only with a "."
        self.assertFalse(holds(".9"))  # which logic truncates to 0
        # not numbers there: strings, which logic reads through the ownership hook (unknown)
        for tok in ("inf", "nan", "1e5", "1_0", "0x10"):
            self.assertTrue(holds(tok), tok)
        # a variable or a property is unknown, before any function name: "$x?" pops nothing
        self.assertTrue(holds("@CustomFX *null* eq"))
        self.assertTrue(holds("1 $x? &&"))


if __name__ == "__main__":
    unittest.main()
