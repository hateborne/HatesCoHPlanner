"""Tests for the recipe export (python -m unittest pipeline.recipes_test; run by CI).

recipes.build turns decoded client records into the recipe file, with synthetic records so no
client is needed.
"""
from __future__ import annotations

import json
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest import mock

import pipeline.assets
from pipeline import config, recipes

ENUMS = {"recipe.Type": {0: "Workshop", 1: "Drop", 2: "Memorized"},
         "recipe.Rarity": {1: "Common", 2: "Uncommon", 3: "Rare", 4: "VeryRare"},
         "salvage.Type": {0: "Base", 1: "Invention", 2: "Token"},
         "salvage.Rarity": {0: "Ubiquitous", 1: "Common", 2: "Uncommon", 3: "Rare"}}
MESSAGES = {"P1": "Brass", "P2": "Ruby", "P3": "Iron", "PR": "Some Set: Damage (Recipe)", "PC": "Invention: Damage (Recipe)"}
SET = "Boosts.Crafted_Some_Set_A.Crafted_Some_Set_A"
COMMON = "Boosts.Crafted_Damage.Crafted_Damage"
GAPPED = "Boosts.Crafted_Some_Set_B.Crafted_Some_Set_B"


def salvage(name: str, key: str, rarity: int, icon: str, kind: int = 1) -> dict:
    """@return A decoded salvage record."""
    return {"Name": name, "DisplayName": key, "Rarity": rarity, "Type": kind, "Icon": icon}


def recipe(enh: str, level: int, need: list, name: str = "PR", rarity: int = 3, kind: int = 1, creates: int = 1) -> dict:
    """@return A decoded recipe record; `need` is [(amount, salvage name)]."""
    return {"Name": f"{enh}_{level}", "DisplayName": name, "Enhancement": enh, "Level": level, "Rarity": rarity,
            "Type": kind, "CreatesEnhancement": creates, "Salvage": [{"Amount": a, "Salvage": s} for a, s in need]}


def decoded(recipe_list: list, salvage_list: list | None = None) -> dict:
    """@return What recipes.decode gives, from synthetic records."""
    defs = [salvage("S_Brass", "P1", 1, "salvage_Brass.tga"), salvage("S_Ruby", "P2", 3, "salvage_Ruby.tga"),
            salvage("S_Iron", "P3", 2, "salvage_Iron.tgs")]
    return {"recipes": recipe_list, "salvage": defs if salvage_list is None else salvage_list, "messages": MESSAGES,
            "enums": ENUMS, "health": {}, "set_pieces": {SET.lower(), GAPPED.lower()}}


class BuildTest(unittest.TestCase):
    def test_tiers_and_salvage(self):
        low, high = [(1, "S_Brass"), (1, "S_Iron")], [(1, "S_Ruby"), (2, "S_Iron")]
        data, summary = recipes.build(decoded([recipe(SET, lv, low if lv <= 31 else high) for lv in range(30, 34)]), "i28p4")
        self.assertEqual(summary["problems"], [])
        self.assertEqual((summary["recipes"], summary["enhancements"], summary["salvage"]), (4, 1, 3))
        self.assertEqual(data["v"], 1)
        self.assertEqual(data["dataVersion"], "i28p4")
        # sorted by internal name; the icon is the texture's name in lower case, whatever its extension
        self.assertEqual(data["salvage"], [["Brass", 1, "salvage_brass"], ["Iron", 2, "salvage_iron"], ["Ruby", 3, "salvage_ruby"]])
        # levels with the same salvage are one tier; an amount of 2 repeats the index
        self.assertEqual(data["recipes"][SET], {"dn": "Some Set: Damage (Recipe)", "r": 3, "t": [[30, 31, [0, 1]], [32, 33, [2, 1, 1]]]})

    def test_levels_with_gaps_are_listed(self):
        data, summary = recipes.build(decoded([recipe(GAPPED, lv, [(1, "S_Brass")], rarity=2) for lv in (10, 15, 20)]), "i28p4")
        self.assertEqual(summary["problems"], [])
        self.assertEqual(data["recipes"][GAPPED], {"dn": "Some Set: Damage (Recipe)", "r": 2, "t": [[10, 20, [0]]], "lv": [10, 15, 20]})

    def test_only_set_pieces(self):
        # a common IO's recipe drops too, but the shopping list only holds set pieces
        data, summary = recipes.build(decoded([recipe(SET, 30, [(1, "S_Brass")]),
                                               recipe(COMMON, 30, [(1, "S_Ruby")], name="PC", rarity=1)]), "i28p4")
        self.assertEqual(summary["problems"], [])
        self.assertEqual(list(data["recipes"]), [SET])
        self.assertEqual((summary["recipes"], summary["not_set"]), (1, 1))
        self.assertEqual(data["salvage"], [["Brass", 1, "salvage_brass"]])  # the left-out recipe's salvage is not listed

    def test_names_are_matched_without_case(self):
        # the client spells one enhancement two ways (Crafted_Multi_strike / Crafted_Multi_Strike); the app looks names up in lower case
        other = SET.replace("Some_Set", "some_set")
        data, summary = recipes.build(decoded([recipe(SET, 30, [(1, "S_Brass")]), recipe(other, 31, [(1, "S_Brass")])]), "i28p4")
        self.assertEqual(summary["problems"], [])
        self.assertEqual(data["recipes"], {SET: {"dn": "Some Set: Damage (Recipe)", "r": 3, "t": [[30, 31, [0]]]}})
        problems = recipes.build(decoded([recipe(SET, 30, [(1, "S_Brass")]), recipe(other, 30, [(1, "S_Ruby")])]), "i28p4")[1]["problems"]
        self.assertTrue(any("two dropped recipes" in p for p in problems), problems)

    def test_only_dropped_enhancement_recipes(self):
        need = [(1, "S_Brass")]
        data, summary = recipes.build(decoded([
            recipe(SET, 30, need),
            recipe(SET, 30, need, kind=2),             # memorized: another way to the same piece
            recipe(SET, 31, need, kind=0),             # a store's
            recipe("", 30, need),                      # makes no enhancement
            recipe(GAPPED, 30, need, creates=0),
        ]), "i28p4")
        self.assertEqual(summary["problems"], [])
        self.assertEqual(list(data["recipes"]), [SET])
        self.assertEqual(data["recipes"][SET]["t"], [[30, 30, [0]]])
        self.assertEqual(summary["recipes"], 1)

    def test_problems_are_named(self):
        cases = {
            "no definition": decoded([recipe(SET, 30, [(1, "S_Missing")])]),
            "not invention salvage": decoded([recipe(SET, 30, [(1, "S_Token")])], [salvage("S_Token", "P1", 1, "x.tga", kind=2)]),
            "no text": decoded([recipe(SET, 30, [(1, "S_Brass")], name="PX")]),
            "unknown rarity": decoded([recipe(SET, 30, [(1, "S_Brass")], rarity=9)]),
            "two dropped recipes": decoded([recipe(SET, 30, [(1, "S_Brass")]), recipe(SET, 30, [(1, "S_Ruby")])]),
            "disagree": decoded([recipe(SET, 30, [(1, "S_Brass")]), recipe(SET, 31, [(1, "S_Brass")], rarity=2)]),
            # the app refuses a whole file over an icon name it does not take
            "no icon named": decoded([recipe(SET, 30, [(1, "S_Odd")])], [salvage("S_Odd", "P1", 1, "salvage_Foo-Bar.tga")]),
        }
        for want, d in cases.items():
            with self.subTest(want):
                problems = recipes.build(d, "i28p4")[1]["problems"]
                self.assertTrue(any(want in p for p in problems), problems)

    def test_no_set_recipe_at_all_is_a_problem(self):
        # the set list came back empty (a renamed field in a new client): a file with no recipes must not replace a good one
        d = decoded([recipe(SET, 30, [(1, "S_Brass")])])
        d["set_pieces"] = set()
        data, summary = recipes.build(d, "i28p4")
        self.assertEqual(data["recipes"], {})
        self.assertTrue(any("no dropped recipe makes a set piece" in p for p in summary["problems"]), summary["problems"])

    def test_enums_without_the_names_are_a_problem(self):
        d = decoded([recipe(SET, 30, [(1, "S_Brass")])])
        d["enums"] = {**ENUMS, "recipe.Type": {0: "Workshop"}}
        self.assertTrue(recipes.build(d, "i28p4")[1]["problems"])


class FoldersTest(unittest.TestCase):
    def test_side_folders_are_never_versions(self):
        for name in (config.PETS_FOLDER, config.RECIPES_FOLDER, config.FINDER_FOLDER):
            self.assertFalse(config.valid_version_id(name), name)
        self.assertTrue(config.valid_version_id("i28p4"))

    def test_icon_names(self):
        self.assertEqual(recipes.icon_name("salvage_Iron.tgs"), "salvage_iron")
        self.assertEqual(recipes.icon_name("GUI/Icons/salvage_Brass.tga"), "salvage_brass")
        self.assertEqual(recipes.icon_name(""), "")


class ExportIconsTest(unittest.TestCase):
    """export_icons with stand-ins for the texture reader and the image writer (neither is needed to decide what to write)."""

    def run_export(self, tmp: Path, replace: bool) -> tuple[dict, list]:
        """@return (export_icons' result, the icon paths written) for three icons: one there already, one new, one with no texture."""
        written: list[str] = []

        def write(_img, rel_out: str) -> str:
            written.append(rel_out)
            out = tmp / f"{rel_out}.png"
            out.parent.mkdir(parents=True, exist_ok=True)
            out.write_bytes(b"new")
            return rel_out

        class Index:
            def find(self, name, prefer=""):
                return None if name == "salvage_gone" else types.SimpleNamespace(read=lambda: b"")

        assets = types.ModuleType("pipeline.assets.export_assets")
        assets._write = write
        textures = types.ModuleType("pipeline.assets.textures")
        textures.TextureIndex = Index
        textures.decode = lambda _data: object()
        data = {"salvage": [["Brass", 1, "salvage_brass"], ["Ruby", 3, "salvage_ruby"], ["Gone", 1, "salvage_gone"], ["None", 1, ""]]}
        with mock.patch.object(config, "ASSETS_OUT", tmp), mock.patch.object(config, "REPO", tmp), \
                mock.patch.dict(sys.modules, {assets.__name__: assets, textures.__name__: textures}), \
                mock.patch.object(pipeline.assets, "export_assets", assets, create=True), \
                mock.patch.object(pipeline.assets, "textures", textures, create=True):
            return recipes.export_icons(data, replace), written

    def test_adds_only_what_is_missing_unless_told_to_replace(self):
        for replace, want in ((False, ["icons/salvage/salvage_ruby"]), (True, ["icons/salvage/salvage_brass", "icons/salvage/salvage_ruby"])):
            with self.subTest(replace=replace), tempfile.TemporaryDirectory() as folder:
                tmp = Path(folder).resolve()
                (tmp / "icons" / "salvage").mkdir(parents=True)
                (tmp / "icons" / "salvage" / "salvage_brass.png").write_bytes(b"old")
                (tmp / "manifest.json").write_text(json.dumps({"icons": {"enh": ["x"], "salvage": ["salvage_older"]}}), encoding="utf-8")
                result, written = self.run_export(tmp, replace)
                self.assertEqual(written, want)
                self.assertEqual(result, {"added": [w.rsplit("/", 1)[1] for w in want], "missing": ["salvage_gone"]})
                self.assertEqual((tmp / "icons" / "salvage" / "salvage_brass.png").read_bytes(), b"new" if replace else b"old")
                # the manifest lists the kind, with what it listed before, and leaves the other kinds alone
                manifest = json.loads((tmp / "manifest.json").read_text(encoding="utf-8"))
                self.assertEqual(manifest["icons"], {"enh": ["x"], "salvage": ["salvage_brass", "salvage_older", "salvage_ruby"]})


if __name__ == "__main__":
    unittest.main()
