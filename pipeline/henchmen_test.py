"""Tests for the real pets export (python -m unittest pipeline.henchmen_test; run by CI).

Exporter.build_henchmen keeps the pets with a power of their own (henchmen) that the planner's Pets
and Minions cards show, with synthetic client data (pets_test's) so no client is needed.
"""
from __future__ import annotations

import json
import unittest
from pathlib import Path
from unittest import mock

from pipeline import config, export
from pipeline.export import Exporter
from pipeline.pets_test import ENT, live, mod, params, power

SUMMON = "Mastermind_Summon.Bots.Summon_Henchmen"
EQUIP = "Mastermind_Summon.Bots.Equip_Henchmen"
BURN = "Blaster_Ranged.Fire_Blast.Burn"


def group(mods: list, requires: list | None = None, chance: float = 1.0) -> dict:
    """@return A decoded effect group."""
    return {"Chance": chance, "Requires": requires or [], "Flags": 0, "AttribMod": mods, "Effect": []}


def data():
    """@return pets_test's client data plus a Mastermind-like summon, its upgrade and a henchman that
    makes a pseudo-pet."""
    d = live()
    real = params([1, 0, 0, 0, 0, 0, 0, 0, 0, 0], {0: "Pets_Henchman"})
    puddle = params([1, 0, 0, 0, 0, 0, 0, 0, 0, 0], {0: "Pets_Puddle"})
    kick = params([0, 0, 1, 7], {3: "Pets.Henchman.Kick"}, n=4)
    summon = power(SUMMON, 0, [])
    tagged = group([], chance=0.5)
    tagged.update({"Tag": ["Forces"], "Delay": 10.0,
                   "Effect": [group([mod(ENT, Params=real, Delay=5.0)], chance=0.5)]})
    summon["Effect"] = [group([mod(ENT, Params=real)]),
                        group([mod(ENT, Params=real)], ["combatlevel", "source>", "5", ">"]),
                        group([mod(ENT, Params=real, Duration=30.0)], chance=0.5),
                        tagged]
    equip = power(EQUIP, 0, [])
    equip["Effect"] = [group([mod(481, Params=kick)], ["Pets_Henchman", "target.VillainName>"])]
    d.powers += [summon, equip,
                 # its second mod stacks once whoever casts it (a Protector Bot's Force Shield)
                 power("Pets.Henchman.Kick", 0, [mod(16, Scale=0.5, Table="Ranged_Kick"),
                                                 mod(16, Scale=0.1, Table="Ranged_Kick", CasterStackType=1)]),
                 power("Pets.Henchman.Puddle", 0, [mod(ENT, Params=puddle)]),
                 power("Pets.Henchman.Call_Friend", 0, [mod(ENT, Params=real, Duration=60.0)])]
    for p in d.powers:
        p.update({"EffectArea": 0, "Target": 1, "EntsAffected": [1]})
    henchman = next(s for s in d.powersets if s["Name"] == "Henchman")
    henchman["Powers"] += ["Pets.Henchman.Kick", "Pets.Henchman.Puddle", "Pets.Henchman.Call_Friend"]
    d.powersets.append({"FullName": "Mastermind_Summon.Bots", "Name": "Bots", "Powers": [SUMMON, EQUIP]})
    vdef = next(v for v in d.villains if v["Name"] == "Pets_Henchman")
    vdef["DisplayName"] = "P1"
    vdef["VillainGroup"] = "MastermindPets"
    vdef["Power"].append({"PowerCategory": "Pets", "PowerSet": "Henchman", "Power": "Puddle"})
    vdef["Power"].append({"PowerCategory": "Pets", "PowerSet": "Henchman", "Power": "Call_Friend"})
    d.messages = {"P1": "Henchman"}
    cls = d.villain_classes[0]
    cls["AttribBase"] = [{"Regeneration": [0.25] * 50, "Absorb": [0.0] * 50}]
    cls["AttribMin"] = [{"Regeneration": [0.0] * 50, "ToHit": [-1.0] * 50}]
    cls["AttribMaxTable"] = [{"HitPoints": [100.0 + i for i in range(50)], "Endurance": [100.0] * 50, "ToHit": [5.0] * 50}]
    cls["AttribMaxMaxTable"] = [{"HitPoints": [150.0] * 50}]
    cls["StrengthMaxTable"] = [{"DamageType00": [4.0] * 50, "Accuracy": [5.0] * 50, "RechargeTime": [5.0] * 50}]
    cls["ResistanceMaxTable"] = [{"DamageType00": [0.9] * 50, "DamageType01": [], "Held": [1.0] * 50}]
    cls["ModTable"].append({"Name": "Ranged_Kick", "Values": [-6.0] * 50})
    d.enums.update({"power.EffectArea": {0: "kCharacter"}, "power.Target": {1: "kFoe"},
                    "power.EntsAffected": {1: "kFoe"}, "mod.CasterStackType": {0: "kIndividual", 1: "kCollective"}})
    return d


class BuildHenchmenTest(unittest.TestCase):
    def setUp(self):
        self.ex = Exporter(data())
        self.ex.exported_names = {BURN, SUMMON, EQUIP, "Pets.Henchman.Kick"}
        self.ex.used_tables = {"melee_damage"}  # what core.json holds for the archetypes
        self.out = self.ex.build_henchmen()

    def test_keeps_each_spawn_with_what_decides_it(self):
        # every EntCreate mod in the client's order: the second needs combat level 6, the third may
        # spawn and lasts 30 s; the fourth rolls its group's chance and its parent's, and spawns
        # after both groups' and its own delay
        self.assertEqual(self.out["makes"][SUMMON], [
            {"pet": "Pets_Henchman"},
            {"pet": "Pets_Henchman", "req": [["combatlevel", "source>", "5", ">"]]},
            {"pet": "Pets_Henchman", "ch": 0.5, "dur": 30},
            {"pet": "Pets_Henchman", "ch": 0.25, "del": 15},
        ])
        # Burn's real pet is kept; its pseudo-pets (every power Auto) are the pets file's
        self.assertEqual(self.out["makes"][BURN], [{"pet": "Pets_Henchman"}])

    def test_names_runs_and_lists_each_pet(self):
        self.assertEqual(self.out["pets"]["Pets_Henchman"], {
            "dn": "Henchman", "vd": "Pets_Henchman", "grp": "MastermindPets", "cls": "Class_Minion_Pets",
            "p": ["Pets.Henchman.Call_Friend", "Pets.Henchman.Puddle", "Pets.Henchman.Punch"], "def": 3})

    def test_a_pet_power_that_makes_a_real_pet(self):
        # its real pet is listed as a summon's (the card says what the power makes)
        self.assertEqual(self.out["makes"]["Pets.Henchman.Call_Friend"], [{"pet": "Pets_Henchman", "dur": 60}])
        self.assertNotIn("Pets.Henchman.Call_Friend", self.out.get("pseudo", {}))

    def test_pet_powers_whole_and_by_name(self):
        punch = self.out["powers"]["Pets.Henchman.Punch"]
        self.assertEqual((punch["dn"], punch["type"], punch["tgt"]), ("Punch", "Click", "Foe"))
        self.assertEqual(punch["eff"][0]["m"][0]["a"], [0])
        # the pseudo-pet a pet's power makes comes along, as the pets file holds one
        self.assertEqual(self.out["pseudo"]["Pets.Henchman.Puddle"][0]["cls"], "Class_Minion_Pets")
        self.assertIn("Pets.Puddle.Aura", self.out["powers"])

    def test_class_attribute_tables_and_mod_tables(self):
        c = self.out["classes"]["Class_Minion_Pets"]
        # what the stats read, as core.json's archetypes hold it: one number when every level has it,
        # attributes the stats don't read (Absorb, ToHit, Accuracy, Held) and empty tables left out
        self.assertEqual(c["base"], {"Regeneration": 0.25})
        self.assertEqual(c["min"], {"Regeneration": 0})
        self.assertEqual(c["max"], {"Endurance": 100, "HitPoints": [100 + i for i in range(50)]})
        self.assertEqual(c["maxMax"], {"HitPoints": 150})
        self.assertEqual(c["strMax"], {"DamageType00": 4, "RechargeTime": 5})
        self.assertEqual(c["resMax"], {"DamageType00": 0.9})
        # the tables of what an upgrade grants a pet (Equip's Kick) go with its class
        self.assertIn("ranged_kick", c["mod"])
        self.assertEqual(self.out["tables"][c["mod"]["ranged_kick"]], [-6] * 50)

    def test_marks_what_stacks_once_whoever_casts_it(self):
        # by the mod's place in the power as the site lays it out; nothing else carries the mark
        self.assertEqual(self.out["collective"], {"Pets.Henchman.Kick": [1]})
        self.assertFalse(self.ex.mark_collective)
        self.assertNotIn("cst", json.dumps(self.out["powers"]))

    def test_changes_nothing_the_version_exports(self):
        self.assertEqual(self.ex.used_tables, {"melee_damage"})
        self.assertEqual(dict(self.ex.ids.added), {k: 0 for k in self.ex.ids.added})
        self.assertNotIn("pets.henchman.punch", self.ex.ids.maps["power"])

    def test_writes_the_file_beside_the_version_folders(self):
        writes: dict = {}
        with mock.patch.object(config, "atomic_write", lambda path, text: writes.update({Path(path): text})):
            summary = export.write_henchmen(dict(self.out), "v1")
        self.assertEqual(list(writes), [config.DATA_OUT / config.HENCHMEN_FOLDER / "v1.json"])
        written = json.loads(next(iter(writes.values())))
        self.assertNotIn("summary", written)
        self.assertEqual(written["pets"], self.out["pets"])
        self.assertEqual(summary["creators"], 3)
        self.assertEqual(export.henchmen_warnings(summary), [])


if __name__ == "__main__":
    unittest.main()
