"""Tests for the pseudo-pet export (python -m unittest pipeline.pets_test; run by CI).

export.ent_create_param reads an EntCreate mod's Params by the client's own layout, and
Exporter.build_pets resolves each pet as the live client's power info does (decompiled), with
synthetic client data so no client is needed.
"""
from __future__ import annotations

import dataclasses
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from pipeline import config, export
from pipeline.coh import p7reader as P
from pipeline.decode.live import LiveData, ent_create_layout_of
from pipeline.export import Exporter, ent_create_param

# Homecoming's EntCreate param struct (CostumeEffect included) and Thunderspy's (without it)
HC = [("EntityDef", False), ("Class", False), ("Costume", False), ("DisplayName", False),
      ("PriorityList", False), ("AIConfig", False), ("CostumeEffect", False),
      ("PowerCategory", True), ("Powerset", True), ("Power", True)]
TS = [c for c in HC if c[0] != "CostumeEffect"]


def params(words: list, strings: dict, n: int = 3) -> dict:
    """@return A decoded Params stash table (type n)."""
    return {"n": n, "words": words, "strings": strings}


class EntCreateParamTest(unittest.TestCase):
    def test_power_list(self):
        # Burn: no villain def, two powers named in the mod
        p = params([0, 0, 0, 7, 8, 0, 0, 0, 0, 2, 11, 12],
                   {3: "Burn Flames", 4: "PL_StaticObject", 10: "Redirects.A", 11: "Redirects.B"})
        self.assertEqual(ent_create_param(p, HC),
                         {"EntityDef": "", "Class": "", "Power": ["Redirects.A", "Redirects.B"]})

    def test_villain_def(self):
        p = params([5, 6, 0, 0, 8, 0, 0, 0, 0, 0], {0: "Pets_Thing", 1: "Class_Minion_Pets", 4: "PL"})
        self.assertEqual(ent_create_param(p, HC),
                         {"EntityDef": "Pets_Thing", "Class": "Class_Minion_Pets", "Power": []})

    def test_each_client_by_its_layout(self):
        ts = params([5, 0, 0, 0, 8, 0, 0, 0, 0], {0: "Pets_Burn", 4: "PL"})
        self.assertEqual(ent_create_param(ts, TS)["EntityDef"], "Pets_Burn")
        self.assertIsNone(ent_create_param(ts, HC))  # too short for Homecoming's struct

    def test_refuses_what_does_not_fit(self):
        self.assertIsNone(ent_create_param(None, HC))
        self.assertIsNone(ent_create_param(params([0] * 10, {}, n=4), HC))  # a power list's params
        self.assertIsNone(ent_create_param(params([0] * 9 + [5], {}), HC))  # a count past the end
        self.assertIsNone(ent_create_param(params([0] * 11, {}), HC))  # words left over
        self.assertIsNone(ent_create_param(params([0] * 10, {}), []))  # no layout

    def test_layout_as_a_bin_struct_reads(self):
        col = P.PB.Column
        cols = [col("{", P.PB.TOK_START), col("EntityDef", P.PB.TOK_INDIRECT | P.PB.TOK_STRING_X),
                col("Alias", P.PB.TOK_REDUNDANTNAME | P.PB.TOK_STRING_X),
                col("Runtime", P.TOK_NOBIN | P.PB.TOK_INT_X),
                col("Power", P.PB.TOK_INDIRECT | P.PB.TOK_EARRAY | P.PB.TOK_STRING_X)]
        self.assertEqual(ent_create_layout_of(cols), [("EntityDef", False), ("Power", True)])


def mod(attrib: int, **kw) -> dict:
    """@return A decoded AttribMod."""
    m = {"Attrib": [attrib], "Aspect": 32, "Type": 1, "Target": 4, "Table": "Melee_Damage", "Scale": 1.0,
         "ApplicationType": 0, "Duration": 0.0, "Magnitude": 1.0, "StackType": 0, "Flags": [0, 0],
         "Params": None}
    m.update(kw)
    return m


def power(name: str, ptype: int, mods: list, ap: float = 0.0, hidden: list | None = None) -> dict:
    """@return A decoded power with one effect group, and `hidden` in a sub-group of a HideFromInfo group."""
    group = lambda flags, ms, sub: {"Chance": 1.0, "Requires": [], "Flags": flags,  # noqa: E731
                                    "AttribMod": ms, "Effect": sub}
    sub = [group(32, [], [group(0, hidden, [])])] if hidden else []
    return {"FullName": name, "Type": ptype, "ActivatePeriod": ap, "Effect": [group(0, mods, sub)],
            "ActivationEffect": []}


ENT = 469
COPY_BOOSTS, PSEUDO_PET = 1 << 2, 1 << 5  # bits 34 and 37: Flags word 1


def live() -> LiveData:
    """@return Synthetic client data: a hidden PseudoPet, a villain-def pet, a real pet and a pet with no class."""
    ent_pow = params([0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 1, 1], {10: "Pets.Patch.Tick", 11: "Pets.Patch.Flash"})
    ent_def = params([1, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1], {0: "Pets_Puddle", 10: "Pets.Patch.Tick"})
    ent_real = params([1, 0, 0, 0, 0, 0, 0, 0, 0, 0], {0: "Pets_Henchman"})
    ent_bare = params([0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1], {10: "Pets.Patch.Tick"})
    grant = params([0, 0, 1, 7], {3: "Pets.Patch.Tick"}, n=4)
    powers = [
        power("Blaster_Ranged.Fire_Blast.Burn", 0, [mod(ENT, Params=ent_def), mod(ENT, Params=ent_real),
                                                    mod(ENT, Params=ent_bare)],
              hidden=[mod(ENT, Duration=10.0, Flags=[0, COPY_BOOSTS | PSEUDO_PET], Params=ent_pow)]),
        power("Pets.Patch.Tick", 1, [mod(8, Scale=0.1, Table="Melee_Pet_Only")], ap=0.8),
        power("Pets.Patch.Flash", 1, [mod(481, Params=grant)]),
        power("Pets.Puddle.Aura", 1, [mod(8, Scale=0.2)], ap=2.0),
        power("Pets.Puddle.Ripple", 1, [mod(8, Scale=0.3)], ap=1.0),
        power("Pets.Henchman.Punch", 0, [mod(0)]),
    ]
    sets = [{"FullName": "Blaster_Ranged.Fire_Blast", "Name": "Fire_Blast", "Powers": ["Blaster_Ranged.Fire_Blast.Burn"]},
            {"FullName": "Pets.Patch", "Name": "Patch", "Powers": ["Pets.Patch.Tick", "Pets.Patch.Flash"]},
            {"FullName": "Pets.Puddle", "Name": "Puddle", "Powers": ["Pets.Puddle.Aura", "Pets.Puddle.Ripple"]},
            {"FullName": "Pets.Henchman", "Name": "Henchman", "Powers": ["Pets.Henchman.Punch"]}]
    cats = [{"Name": "Blaster_Ranged", "PowerSets": ["Blaster_Ranged.Fire_Blast"]},
            {"Name": "Pets", "PowerSets": ["Pets.Patch", "Pets.Puddle", "Pets.Henchman"]}]
    table = lambda name, v: {"Name": name, "Values": [v] * 50}  # noqa: E731
    classes = [{"Name": "Class_Blaster", "ModTable": [table("Melee_Damage", -10.0), table("Melee_Pet_Only", -3.0)]}]
    attribs = {ENT: {"name": "EntCreate", "aliases": [], "kind": "special"},
               **{o: {"name": n, "aliases": [], "kind": "special"}
                  for o, n in ((481, "GrantPower"), (482, "RevokePower"), (486, "GrantBoostedPower"),
                               (512, "ExecutePower"))}}
    return LiveData(
        powers=powers, powersets=sets, powercats=cats, classes=classes, boostsets=[], origins=[],
        attrib_names={}, dim_returns=[], schedules={}, boost_effect={}, exemplar={}, messages={},
        attribs=attribs,
        enums={"power.Type": {0: "kClick", 1: "kAuto", 2: "kToggle"},
               "mod.Aspect": {32: "kAbsolute"}, "mod.Type": {1: "kMagnitude"}, "mod.Target": {4: "kAffected"},
               "mod.ApplicationType": {0: "kOnTick"}, "mod.StackType": {0: "kStack"},
               "mod.Flags": {34: "CopyBoosts", 35: "CopyCreatorMods", 37: "PseudoPet"},
               "effect.Flags": {32: "HideFromInfo"}},
        villains=[{"Name": "Pets_Puddle", "Class": "Class_Minion_Pets",
                   "Power": [{"PowerCategory": "Pets", "PowerSet": "Puddle", "Power": "*"},
                             {"PowerCategory": "Pets", "PowerSet": "Patch", "Power": "Flash"}]},
                  {"Name": "Pets_Henchman", "Class": "Class_Minion_Pets",
                   "Power": [{"PowerCategory": "Pets", "PowerSet": "Henchman", "Power": "Punch"}]}],
        villain_classes=[{"Name": "Class_Minion_Pets", "ModTable": [table("Melee_Damage", -20.0),
                                                                    table("Melee_Pet_Only", -4.0),
                                                                    table("Unused", 1.0)]}],
        ent_create_layout=HC)


class BuildPetsTest(unittest.TestCase):
    def setUp(self):
        self.ex = Exporter(live())
        self.ex.exported_names = {"Blaster_Ranged.Fire_Blast.Burn"}
        self.ex.used_tables = {"melee_damage"}  # what core.json holds for the archetypes
        self.pets = self.ex.build_pets()

    def test_resolves_each_pet_as_the_client_does(self):
        # in the client's template order (a group's sub-groups first), each pet's powers as it
        # lists them: the villain def's refs last first ("*" sets in order), then the mod's own
        # Power list last first
        made = self.pets["pets"]["Blaster_Ranged.Fire_Blast.Burn"]
        self.assertEqual(made, [
            {"p": ["Pets.Patch.Flash", "Pets.Patch.Tick"], "hid": 1, "dur": 10, "boosts": 1, "pseudo": 1},
            {"p": ["Pets.Patch.Flash", "Pets.Puddle.Aura", "Pets.Puddle.Ripple", "Pets.Patch.Tick"],
             "def": 3, "cls": "Class_Minion_Pets"},
        ])
        self.assertEqual(self.pets["summary"]["skipped"],
                         {"no class": 1, "not auto only (a real pet)": 1})

    def test_pet_powers_and_tables(self):
        self.assertEqual(sorted(self.pets["powers"]),
                         ["Pets.Patch.Flash", "Pets.Patch.Tick", "Pets.Puddle.Aura", "Pets.Puddle.Ripple"])
        self.assertEqual(self.pets["powers"]["Pets.Patch.Tick"]["type"], "Auto")
        self.assertEqual(self.pets["powers"]["Pets.Patch.Tick"]["ap"], 0.8)
        # a pet's grants are named, not numbered: the pets file allocates no ids
        self.assertEqual(self.pets["powers"]["Pets.Patch.Flash"]["eff"][0]["m"][0]["pwn"], ["Pets.Patch.Tick"])
        self.assertNotIn("pw", self.pets["powers"]["Pets.Patch.Flash"]["eff"][0]["m"][0])
        # the villain class gets every table its pets read; an archetype only those core.json lacks
        self.assertEqual(sorted(self.pets["classes"]["Class_Minion_Pets"]), ["melee_damage", "melee_pet_only"])
        self.assertEqual(sorted(self.pets["classes"]["Class_Blaster"]), ["melee_pet_only"])
        self.assertNotIn("plus", self.pets)  # Homecoming's client adds no activation

    def test_changes_nothing_the_version_exports(self):
        self.assertEqual(self.ex.used_tables, {"melee_damage"})
        self.assertEqual(dict(self.ex.ids.added), {k: 0 for k in self.ex.ids.added})


class PetWarningsTest(unittest.TestCase):
    def test_flags_a_client_no_one_has_read(self):
        summary = {"no_entcreate": False, "skipped": {"no EntCreate params": 2}}
        with tempfile.TemporaryDirectory() as d:
            exe = Path(d) / "client.exe"
            exe.write_bytes(b"not a client anyone has read")
            with mock.patch.object(config, "EXE", exe):
                unread = export.pet_warnings(summary)
                read = dataclasses.replace(config.SERVER, pet_checked=(export.sha1(exe),))
                with mock.patch.object(config, "SERVER", read):
                    checked = export.pet_warnings(summary)
        self.assertEqual(len(unread), 2)
        self.assertIn("2 EntCreate mods", unread[0])
        self.assertIn("pet_checked", unread[1])
        self.assertEqual(checked, unread[:1])  # read: only the layout warning stays


if __name__ == "__main__":
    unittest.main()
