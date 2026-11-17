"""Tests for the power-info extras export (python -m unittest pipeline.info_test; run by CI).

Exporter.build_info lays each mod's own note (DisplayInfo) out on the groups the version's files
hold, and carries what the client's power info reads from fields those files lack, with synthetic
client data so no client is needed.
"""
from __future__ import annotations

import dataclasses
import unittest
from unittest import mock

from pipeline import config
from pipeline.decode.live import LiveData
from pipeline.export import Exporter

PVP_FLAG, HIDE = 2, 32


def mod(attrib: int, info: str = "", **kw) -> dict:
    """@return A decoded AttribMod with its own note key."""
    m = {"Attrib": [attrib], "Aspect": 32, "Type": 1, "Target": 4, "Table": "Melee_Damage", "Scale": 1.0,
         "ApplicationType": 0, "Duration": 0.0, "Magnitude": 1.0, "StackType": 0, "Flags": [0, 0],
         "Params": None, "Messages": {"DisplayInfo": info}}
    m.update(kw)
    return m


def group(mods: list, sub: list | None = None, flags: int = 0, req: list | None = None) -> dict:
    """@return A decoded effect group."""
    return {"Chance": 1.0, "Requires": req or [], "Flags": flags, "AttribMod": mods, "Effect": sub or []}


def power(name: str, effs: list, show: int = 1, report: int = 0) -> dict:
    """@return A decoded power."""
    return {"FullName": name, "DisplayName": name.rsplit(".", 1)[-1], "Type": 0, "Effect": effs,
            "ActivationEffect": [], "ShowInInventory": show, "AIReport": report}


GRANT = {"n": 4, "words": [0, 0, 1, 7], "strings": {3: "Temp.Temp.Focus"}}


def live() -> LiveData:
    """@return Synthetic client data: an attack with nested notes, a PvP-only group by flag and one by
    requirement, a hidden grant, and powers with each AIReport."""
    powers = [
        power("Melee.Set.Strike", [
            group([mod(0, "P1")], [
                group([mod(4), mod(8, "P2")]),
                group([], []),                                    # no mods, no groups: not kept
                group([mod(12, "P3")], flags=PVP_FLAG),           # PvP-only by its flag
                group([mod(16, "P4")], req=["enttype", "target>", "player", "eq"]),  # by requirement
                group([mod(481, Params=GRANT)]),
            ]),
        ], report=1),
        power("Melee.Set.Sneak", [group([mod(0)])], report=2),
        power("Temp.Temp.Focus", [group([mod(0)])], show=0),
    ]
    attribs = {0: {"name": "DamageType00", "aliases": [], "kind": "float"},
               328: {"name": "Knockback", "aliases": ["Knock"], "kind": "float"},
               **{o: {"name": n, "aliases": [], "kind": "special"}
                  for o, n in ((481, "GrantPower"), (482, "RevokePower"), (486, "GrantBoostedPower"),
                               (512, "ExecutePower"))}}
    messages = {"P1": "Main Target Only", "P2": "Within 20ft radius", "P3": "PvP note", "P4": "Player note",
                "AttrDamageType[0]": "smashing damage", "AttrKnock": "knock", "NoAggro": "no aggro",
                "HitAggro": "no aggro on a miss", "Unresistable": "unresistable", "AggroReport": "Aggro Type:"}
    return LiveData(
        powers=powers, powersets=[], powercats=[], classes=[], boostsets=[], origins=[], attrib_names={},
        dim_returns=[], schedules={}, boost_effect={}, exemplar={}, messages=messages, attribs=attribs,
        enums={"mod.Aspect": {32: "kAbsolute"}, "mod.Type": {1: "kMagnitude"}, "mod.Target": {4: "kAffected"},
               "mod.ApplicationType": {0: "kOnTick"}, "mod.StackType": {0: "kStack"}, "mod.Flags": {},
               "effect.Flags": {PVP_FLAG: "PVPOnly", HIDE: "HideFromInfo"}})


class BuildInfoTest(unittest.TestCase):
    def setUp(self):
        self.ex = Exporter(live())
        # the version's files as the export wrote them
        self.written = [{"n": n, "eff": self.ex.conv_effects(self.ex.pw[n]["Effect"])}
                        for n in ("Melee.Set.Strike", "Melee.Set.Sneak")]

    def info(self, server: config.Server = config.HOMECOMING) -> dict:
        with mock.patch.object(config, "SERVER", server):
            return self.ex.build_info(self.written, {}, "i99")

    def test_lays_notes_out_on_the_kept_groups(self):
        # the empty group and both PvP-only groups are dropped, as conv_effects drops them
        notes = self.info()["notes"]["Melee.Set.Strike"]["e"]
        self.assertEqual(notes, [{"m": ["Main Target Only"], "s": [{"m": [None, "Within 20ft radius"]}, None]}])

    def test_writes_no_notes_where_the_groups_differ(self):
        self.written[0]["eff"][0]["m"][0]["sc"] = 2
        info = self.info()
        self.assertNotIn("Melee.Set.Strike", info["notes"])
        self.assertEqual(info["summary"]["mismatched"], ["Melee.Set.Strike"])

    def test_grants_aggro_names_and_texts(self):
        info = self.info()
        self.assertEqual(info["hiddenGrants"], ["Temp.Temp.Focus"])
        self.assertEqual(info["aggro"], {"Melee.Set.Strike": "no aggro", "Melee.Set.Sneak": "no aggro"})
        # an array element as "DamageType[0]"; an attribute's alias when its name has no message
        self.assertEqual(info["attr"], {"0": "smashing damage", "328": "knock"})
        self.assertEqual(info["text"], {"Unresistable": "unresistable", "AggroReport": "Aggro Type:"})
        self.assertNotIn("groups", info)

    def test_leaves_the_report_and_tables_as_build_made_them(self):
        before, tables = self.ex.report["pvp_effects_dropped"], set(self.ex.used_tables)
        self.ex.pw["Melee.Set.Strike"]["Effect"][0]["Effect"][2]["AttribMod"][0]["Table"] = "Pvp_Only"
        self.info(dataclasses.replace(config.HOMECOMING, info_lists_pvp=True))
        self.assertEqual(self.ex.report["pvp_effects_dropped"], before)
        self.assertEqual(self.ex.used_tables, tables)

    def test_names_its_version(self):
        self.assertEqual(self.info()["version"], "i99")

    def test_writes_no_notes_that_dont_line_up_with_the_groups(self):
        # one note too many for the first group's one mod
        with mock.patch.object(Exporter, "info_tree", side_effect=lambda effs, keep=False: [{"m": ["a", "b"]}] if effs else []):
            info = self.info()
        self.assertNotIn("Melee.Set.Strike", info["notes"])
        self.assertIn("Melee.Set.Strike", info["summary"]["mismatched"])

    def test_lines_up_checks_every_level(self):
        groups = [{"m": [{}], "sub": [{"m": [{}, {}]}]}]
        self.assertTrue(Exporter._lines_up([None], groups))
        self.assertTrue(Exporter._lines_up([{"m": ["x"], "s": [{"m": [None, "y"]}]}], groups))
        self.assertFalse(Exporter._lines_up([], groups))
        self.assertFalse(Exporter._lines_up([{"s": [{"m": ["y"]}]}], groups))
        self.assertFalse(Exporter._lines_up([{"s": [None, None]}], groups))

    def test_carries_flagged_pvp_groups_for_a_client_that_lists_them(self):
        ts = dataclasses.replace(config.HOMECOMING, info_lists_pvp=True, hit_aggro=True)
        info = self.info(ts)
        eff = info["groups"]["Melee.Set.Strike"]["eff"][0]["sub"]
        # the flagged group is kept; the one requiring a player target is not (the check drops it)
        self.assertEqual([g.get("fl") for g in eff], [None, ["PVPOnly"], None])
        self.assertEqual(info["notes"]["Melee.Set.Strike"]["e"][0]["s"][1], {"m": ["PvP note"]})
        self.assertEqual(info["aggro"]["Melee.Set.Sneak"], "no aggro on a miss")

    def test_lists_no_pvp_group_whose_table_the_version_lacks(self):
        ts = dataclasses.replace(config.HOMECOMING, info_lists_pvp=True)
        self.ex.pw["Melee.Set.Strike"]["Effect"][0]["Effect"][2]["AttribMod"][0]["Table"] = "Pvp_Only"
        info = self.info(ts)
        self.assertNotIn("groups", info)
        self.assertEqual(info["summary"]["untabled"], ["Melee.Set.Strike"])
        # its notes are laid out on the version's own groups instead
        self.assertEqual(info["notes"]["Melee.Set.Strike"]["e"][0]["s"], [{"m": [None, "Within 20ft radius"]}, None])


if __name__ == "__main__":
    unittest.main()
