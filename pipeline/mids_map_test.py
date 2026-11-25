"""Tests for the Mids map's power matching (pipeline/mids_map.py match_powers).

Run: python -m unittest pipeline.mids_map_test
"""
from __future__ import annotations

import unittest

from pipeline.mids_map import match_powers

SHIELD = "Stalker_Defense.Shield_Defense"


def game(*rows):
    """@return Game powers from (id, name, shown name) rows."""
    return [{"id": i, "n": n, "dn": dn} for i, n, dn in rows]


def mids(*rows):
    """@return Mids powers from (StaticIndex, name, shown name) rows."""
    return [{"StaticIndex": si, "FullName": n, "DisplayName": dn} for si, n, dn in rows]


class MatchPowers(unittest.TestCase):
    def test_swapped_names_follow_what_players_see(self):
        # Homecoming's Deflection shows as Battle Agility, and so on round the three
        g = game((1, f"{SHIELD}.Deflection", "Battle Agility"), (2, f"{SHIELD}.Battle_Agility", "Active Defense"),
                 (3, f"{SHIELD}.Active_Defense", "Deflection"))
        m = mids((10, f"{SHIELD}.Deflection", "Deflection"), (11, f"{SHIELD}.Battle_Agility", "Battle Agility"),
                 (12, f"{SHIELD}.Active_Defense", "Active Defense"))
        powers, names, rep = match_powers(m, g, {}, {SHIELD.lower()})
        self.assertEqual(sorted(powers), [[10, 3], [11, 1], [12, 2]])
        self.assertEqual(names[f"{SHIELD}.Deflection"], f"{SHIELD}.Active_Defense")
        self.assertEqual(rep["export"][f"{SHIELD}.Deflection"], f"{SHIELD}.Battle_Agility")

    def test_a_renamed_power_matches_by_what_players_see(self):
        g = game((1, "Blaster_Ranged.Seismic_Blast.Shockwaves", "Seismic Shockwaves"))
        m = mids((5, "Blaster_Ranged.Seismic_Blast.Seismic_Shockwaves", "Seismic Shockwaves"))
        powers, names, rep = match_powers(m, g, {}, {"blaster_ranged.seismic_blast"})
        self.assertEqual(powers, [[5, 1]])
        self.assertEqual(rep["export"], {"Blaster_Ranged.Seismic_Blast.Shockwaves": "Blaster_Ranged.Seismic_Blast.Seismic_Shockwaves"})

    def test_a_mids_power_the_game_lacks_is_left_out(self):
        # the game's Smoke_Flash shows as Bo Ryaku; Mids' Smoke_Flash is the game's Blinding_Powder
        ninja = "Stalker_Defense.Ninjitsu"
        g = game((1, f"{ninja}.Blinding_Powder", "Smoke Flash"), (2, f"{ninja}.Smoke_Flash", "Bo Ryaku"))
        m = mids((10, f"{ninja}.Smoke_Flash", "Smoke Flash"), (11, f"{ninja}.Blinding_Powder", "Blinding Powder"))
        powers, names, rep = match_powers(m, g, {}, {ninja.lower()})
        self.assertEqual(powers, [[10, 1]])
        self.assertEqual(names[f"{ninja}.Blinding_Powder"], "")
        self.assertEqual(rep["export"][f"{ninja}.Smoke_Flash"], "")

    def test_two_mids_copies_of_one_power_both_match_it(self):
        g = game((1, "Epic.Stalker_Mace_Mastery.Web_Cocoon", "Web Cocoon"))
        m = mids((10, "Epic.Scrapper_Mace_Mastery.Web_Cocoon", "Web Cocoon"), (11, "Epic.Stalker_Mace_Mastery.Web_Cocoon", "Web Cocoon"))
        renames = {"Epic.Scrapper_Mace_Mastery.Web_Cocoon": "Epic.Stalker_Mace_Mastery.Web_Cocoon"}
        powers, _names, rep = match_powers(m, g, renames, {"epic.stalker_mace_mastery"})
        # the export's own name first, so the MxDz writer takes its index
        self.assertEqual(powers, [[11, 1], [10, 1]])
        self.assertEqual(rep["export"], {})

    def test_epic_pools_match_through_their_mids_names(self):
        g = game((1, "Epic.Blaster_Dark_Mastery.Murky_Cloud", "Murky Cloud"))
        m = mids((7, "Epic.Dark_Mastery_Blaster.Murky_Cloud", "Murky Cloud"))
        powers, names, rep = match_powers(m, g, {}, {"epic.blaster_dark_mastery"})
        self.assertEqual(powers, [[7, 1]])
        self.assertEqual(rep["export"], {"Epic.Blaster_Dark_Mastery.Murky_Cloud": "Epic.Dark_Mastery_Blaster.Murky_Cloud"})

    def test_hidden_sets_keep_their_own_names(self):
        # a pet's Fast and Slow attacks share a shown name: only player sets match by it
        g = game((1, "Pets.Titan_Weapons.Crushing_Blow_Fast", "Crushing Blow"), (2, "Pets.Titan_Weapons.Crushing_Blow_Slow", "Crushing Blow"))
        m = mids((10, "Pets.Titan_Weapons.Crushing_Blow_Fast", "Crushing Blow"))
        powers, names, _rep = match_powers(m, g, {}, set())
        self.assertEqual(powers, [[10, 1]])
        self.assertEqual(names, {})


if __name__ == "__main__":
    unittest.main()
