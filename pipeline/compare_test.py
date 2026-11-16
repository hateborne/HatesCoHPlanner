"""Tests for pipeline/compare.py: python -m unittest pipeline.compare_test (run by CI).

Small synthetic data only: no client and no committed game data. Each false-difference pitfall
(shifted attribute offsets, Knock / Knockback, per-server damage type numbering, Mode indices,
per-level arrays of different lengths) has a test that the two sides compare equal, and the real
differences have tests that they are found.
"""
from __future__ import annotations

import unittest
from unittest import mock

from pipeline import compare as C


def named(*names: str) -> list:
    """@return attribNames entries for a list of names."""
    return [{"n": n, "dn": n, "icon": ""} for n in names]


def core(attribs: dict, damage=("Smashing", "Lethal", "Fire"), modes=("A", "B", "C"), **extra) -> dict:
    """@return A minimal core.json with the given attributes (offset -> name)."""
    c = {"attribs": {str(o): {"name": n, "aliases": [], "kind": "float"} for o, n in attribs.items()},
         "attribNames": {"Damage": named(*damage), "Defense": [], "Elusivity": [],
                         "Boost": named("Accuracy_Boost", "Damage_Boost"), "Group": [], "Mode": named(*modes)},
         "archetypes": [], "categories": {}, "modTables": [], "origins": [],
         "schedule": {"power": [0], "slot": [2], "pool": [3], "epic": [34], "freeSlots": [0]},
         "dimReturns": [], "boostEffect": {"above": [1], "below": [1], "boosters": [1]},
         "exemplar": {"Limits": [0.1], "Weights": [1], "PreClamp": [1], "PostClamp": [1]}}
    c.update(extra)
    return c


def mod(a: list, **kw) -> dict:
    """@return A mod with the usual required fields."""
    m = {"a": a, "asp": "Current", "t": "Magnitude", "tg": "Caster", "tbl": "Melee_Ones", "sc": 1}
    m.update(kw)
    return m


def power(pid: int, name: str, **kw) -> dict:
    """@return A power with the usual required fields."""
    p = {"id": pid, "n": name, "dn": name, "sh": "", "lh": "", "icon": "", "type": "Click", "tgt": "Caster"}
    p.update(kw)
    return p


def side(label: str, c: dict, sets=(), powers=(), boosts=None) -> C.Side:
    """@return A Side over the given pieces."""
    return C.Side(label, label.lower(), "v1", c, list(sets), list(powers), boosts or {})


def pset(sid: int, name: str, p: list, av: list, **kw) -> dict:
    """@return A powerset with the usual required fields."""
    s = {"id": sid, "n": name, "dn": name, "sh": "", "lh": "", "icon": "", "p": p, "av": av}
    s.update(kw)
    return s


def at(name: str, pri: str, mod_map: dict | None = None, **tables) -> dict:
    """@return An archetype whose only category is its primary."""
    a = {"id": 1, "n": name, "dn": name, "sh": "", "lh": "", "icon": "", "mod": mod_map or {},
         "cats": {"pri": pri, "sec": "", "pool": "", "epic": "", "inherent": ""}}
    for t in ("base", "min", "max", "maxMax", "strMin", "strMax", "resMin", "resMax"):
        a[t] = tables.get(t, {})
    return a


class Names(unittest.TestCase):
    def test_shifted_offsets_are_not_a_difference(self):
        # Homecoming has TimeToRoot at 356, so everything after it sits 4 higher
        hc = side("HC", core({352: "ToHit", 356: "TimeToRoot", 360: "RechargeTime"}))
        ts = side("TS", core({352: "ToHit", 356: "RechargeTime"}))
        self.assertEqual(C.mod_parts(hc, mod([360])), C.mod_parts(ts, mod([356])))
        self.assertNotEqual(C.mod_parts(hc, mod([356])), C.mod_parts(ts, mod([356])))
        self.assertEqual(hc.attribs([360, 352]), ["RechargeTime", "ToHit"])

    def test_knock_and_knockback_are_one_attribute(self):
        hc = side("HC", core({328: "Knock"}))
        ts = side("TS", core({328: "Knockback"}))
        self.assertEqual(hc.attrib(328), "Knockback")
        self.assertEqual(C.mod_parts(hc, mod([328])), C.mod_parts(ts, mod([328])))

    def test_damage_types_are_named_by_their_own_list(self):
        # Fire is DamageType02 on Homecoming (offset 8) and DamageType01 on the other (offset 4)
        hc = side("HC", core({0: "DamageType00", 4: "DamageType01", 8: "DamageType02"},
                             damage=("Smashing", "Lethal", "Fire", "Sonic")))
        ts = side("TS", core({0: "DamageType00", 4: "DamageType01"}, damage=("Smashing", "Fire")))
        self.assertEqual(hc.attrib(8), "DamageType.Fire")
        self.assertEqual(ts.attrib(4), "DamageType.Fire")
        self.assertEqual(C.mod_parts(hc, mod([8])), C.mod_parts(ts, mod([4])))
        self.assertNotEqual(C.mod_parts(hc, mod([4])), C.mod_parts(ts, mod([4])))  # Lethal against Fire

    def test_defense_and_damage_do_not_collide(self):
        c = core({0: "DamageType00", 4: "DefenseType00"})
        c["attribNames"]["Defense"] = named("Smashing")
        s = side("HC", c)
        self.assertNotEqual(s.attrib(0), s.attrib(4))

    def test_mode_indices_resolve_to_names(self):
        hc = side("HC", core({473: "SetMode"}, modes=("Skip", "Other", "Dark_Nova")))
        ts = side("TS", core({473: "SetMode"}, modes=("Dark_Nova",)))
        self.assertEqual(C.mod_parts(hc, mod([473], mag=2)), C.mod_parts(ts, mod([473], mag=0)))
        self.assertNotEqual(C.mod_parts(hc, mod([473], mag=1)), C.mod_parts(ts, mod([473], mag=0)))
        # a magnitude that is not a mode stays a number
        self.assertIn("mag=2", C.mod_parts(hc, mod([1], mag=2))[1])
        p_hc, p_ts = power(1, "A.B.C", modd=[2]), power(1, "A.B.C", modd=[0])
        self.assertEqual(C.power_view(hc, p_hc)["modd"], C.power_view(ts, p_ts)["modd"])

    def test_boost_types_resolve_to_names(self):
        s = side("HC", core({}))
        self.assertEqual(s.boost_type(3), "Origin3")
        self.assertEqual(s.boost_type(6), "Damage_Boost")

    def test_unknown_offsets_and_ids_do_not_crash(self):
        s = side("HC", core({}))
        self.assertEqual(s.attrib(999), "@999")
        self.assertEqual(s.power_name(5), "#5")
        self.assertEqual(s.mode(50), "mode#50")


class Effects(unittest.TestCase):
    def sides(self):
        return side("HC", core({0: "A", 4: "B"})), side("TS", core({0: "A", 4: "B"}))

    def test_attribute_order_and_grouping_do_not_matter(self):
        hc, ts = self.sides()
        one = [{"m": [mod([0, 4])]}]
        two = [{"m": [mod([4])]}, {"m": [mod([0])]}]
        self.assertEqual(C.effect_lines(hc, one), C.effect_lines(ts, two))

    def test_nesting_and_tags_are_ignored(self):
        hc, ts = self.sides()
        nested = [{"req": ["x"], "sub": [{"m": [mod([0])]}]}]
        flat = [{"req": ["x"], "tag": ["Damage"], "m": [mod([0])]}]
        self.assertEqual(C.effect_lines(hc, nested), C.effect_lines(ts, flat))

    def test_table_name_case_is_ignored(self):
        hc, ts = self.sides()
        self.assertEqual(C.mod_parts(hc, mod([0], tbl="Melee_Res_Dmg")), C.mod_parts(ts, mod([0], tbl="Melee_Res_DMG")))

    def test_real_effect_differences_are_found(self):
        hc, ts = self.sides()
        self.assertNotEqual(C.effect_lines(hc, [{"m": [mod([0], sc=2)]}]), C.effect_lines(ts, [{"m": [mod([0], sc=3)]}]))
        self.assertNotEqual(C.effect_lines(hc, [{"m": [mod([0])]}]), C.effect_lines(ts, [{"ch": 0.5, "m": [mod([0])]}]))
        self.assertNotEqual(C.effect_lines(hc, [{"m": [mod([0], dur=5)]}]), C.effect_lines(ts, [{"m": [mod([0], dur=6)]}]))


class Arrays(unittest.TestCase):
    def test_longer_homecoming_table_matches_on_the_first_fifty_levels(self):
        hc = [float(i) for i in range(105)]
        ts = [float(i) for i in range(50)]
        self.assertIsNone(C.array_diff(hc, ts))

    def test_difference_inside_the_fifty_levels_is_found(self):
        hc = [1.0] * 105
        ts = [1.0] * 50
        ts[2] = 2.0
        d = C.array_diff(hc, ts)
        self.assertIn("1 of 50 levels differ", d)
        self.assertIn("level 3: 1 -> 2", d)

    def test_difference_after_level_fifty_is_ignored(self):
        hc = [1.0] * 105
        hc[60] = 9.0
        self.assertIsNone(C.array_diff(hc, [1.0] * 50))

    def test_scalars_and_lists(self):
        self.assertIsNone(C.array_diff(2, 2.0))
        self.assertEqual(C.array_diff(2, 3), "2 -> 3")
        self.assertIsNone(C.array_diff(1.0, [1.0] * 50))
        self.assertIsNotNone(C.array_diff(1.0, [1.0] * 49 + [2.0]))
        self.assertIn("length 3 -> 2", C.array_diff([1, 2, 3], [1, 2]))

    def test_formatting(self):
        self.assertEqual(C.fmt(1.0), "1")
        self.assertEqual(C.fmt(5.2), "5.2")
        self.assertEqual(C.fmt_arr([1] * 50), "[1 x50]")
        self.assertEqual(C.fmt_arr([1, 1.05, 1.1, 1.15]), "[1, 1.05, 1.1, 1.15]")
        self.assertEqual(C.level_text(-1), "granted")
        self.assertEqual(C.level_text(0), "L1")
        self.assertEqual(C.ascii_text("a\u2019b \u00e9"), "a'b \\xe9")


def pair(hc_powers, ts_powers, hc_set, ts_set, hc_core=None, ts_core=None):
    """@return (HC side, TS side) holding one archetype and one power set each."""
    cats = {"categories": {"Cat": [1]}, "archetypes": [at("Class_X", "Cat")]}
    hc = side("HC", hc_core or core({}, **cats), [hc_set], hc_powers)
    ts = side("TS", ts_core or core({}, **cats), [ts_set], ts_powers)
    return hc, ts


class Compare(unittest.TestCase):
    def test_power_fields(self):
        a = power(1, "Cat.Set.Rage", rech=240, end=20, acc=1)
        b = power(9, "Cat.Set.Rage", rech=180, end=5.2)
        texts, _, fields = C.diff_power(*pair([a], [b], pset(1, "Cat.Set", [1], [0]), pset(1, "Cat.Set", [9], [0])), a, b)
        self.assertIn("recharge 240 -> 180", texts)
        self.assertIn("endurance 20 -> 5.2", texts)
        self.assertEqual(sorted(fields), ["end", "rech"])  # accuracy 1 against the default 1 is equal

    def test_auto_and_area(self):
        a = power(1, "Cat.Set.Siphon", type="Click", tgt="Foe", rech=20)
        b = power(9, "Cat.Set.Siphon", type="Auto", tgt="Caster", rad=80, area="Sphere")
        hc, ts = pair([a], [b], pset(1, "Cat.Set", [1], [0]), pset(1, "Cat.Set", [9], [0]))
        texts, _, _ = C.diff_power(hc, ts, a, b)
        self.assertIn("type Click -> Auto", texts)
        self.assertIn("radius - -> 80", texts)

    def test_equal_powers_across_ids_and_servers(self):
        a = power(1, "Cat.Set.P", rech=4, atk=[0, 4], eff=[{"m": [mod([0])]}], icon="x")
        b = power(77, "Cat.Set.P", rech=4, atk=[4, 0], eff=[{"m": [mod([0])]}], icon="thunderspy:x", dn="Other")
        hc, ts = pair([a], [b], pset(1, "Cat.Set", [1], [0]), pset(5, "Cat.Set", [77], [0]),
                      core({0: "A", 4: "B"}, categories={"Cat": [1]}, archetypes=[at("Class_X", "Cat")]),
                      core({0: "A", 4: "B"}, categories={"Cat": [5]}, archetypes=[at("Class_X", "Cat")]))
        r = C.compare(hc, ts)
        self.assertEqual(r.counts["powers_compared"], 1)
        self.assertEqual(r.counts["powers_differ"], 0)
        self.assertEqual(r.counts["sets_differ"], 0)

    def test_order_levels_and_missing_powers(self):
        hc_set = pset(1, "Cat.Set", [1, 2, 3], [0, 31, 5])
        ts_set = pset(1, "Cat.Set", [11, 12, 13], [0, 15, 15])
        hc = [power(1, "Cat.Set.Cinders"), power(2, "Cat.Set.Fire_Imps"), power(3, "Cat.Set.Old_One")]
        ts = [power(11, "Cat.Set.Fire_Imps"), power(12, "Cat.Set.Cinders"), power(13, "Cat.Set.New_One")]
        hcs, tss = pair(hc, ts, hc_set, ts_set)
        r = C.compare(hcs, tss)
        text = "\n".join("\n".join(ls) for _, ls in r.sections)
        self.assertIn("Order: HC Cinders, Fire_Imps -> TS Fire_Imps, Cinders", text)
        self.assertIn("Cinders L1 -> L16", text)
        self.assertIn("Fire_Imps L32 -> L1", text)
        self.assertIn("Powers only on HC: Old_One (L6)", text)
        self.assertIn("Powers only on TS: New_One (L16)", text)
        self.assertEqual(r.counts["sets_differ"], 1)

    def test_power_names_match_ignoring_case(self):
        hcs, tss = pair([power(1, "Cat.Set.Tough_hide", rech=1)], [power(2, "Cat.Set.Tough_Hide", rech=2)],
                        pset(1, "Cat.Set", [1], [0]), pset(1, "Cat.Set", [2], [0]))
        r = C.compare(hcs, tss)
        self.assertEqual(r.counts["powers_only_base"], 0)
        self.assertEqual(r.counts["powers_differ"], 1)

    def test_sets_on_one_server_only(self):
        cats = {"categories": {"Cat": [1, 2]}, "archetypes": [at("Class_X", "Cat")]}
        hc = side("HC", core({}, **cats), [pset(1, "Cat.One", [], []), pset(2, "Cat.Two", [], [])])
        ts = side("TS", core({}, **cats), [pset(1, "Cat.One", [], [])])
        r = C.compare(hc, ts)
        self.assertEqual((r.counts["sets_only_base"], r.counts["sets_only_other"]), (1, 0))
        self.assertIn("Cat.Two", "\n".join(ls[0] for t, ls in r.sections if "one server only" in t))

    def test_game_rules(self):
        hcc = core({}, boostEffect={"above": [1, 1.05, 1.1, 1.15], "below": [1], "boosters": [1]})
        tsc = core({}, boostEffect={"above": [1] * 50, "below": [1], "boosters": [1]},
                   schedule={"power": [0], "slot": [2, 2], "pool": [0, 3], "epic": [34], "freeSlots": [0]})
        r = C.compare(side("HC", hcc), side("TS", tsc))
        text = "\n".join("\n".join(ls) for _, ls in r.sections)
        self.assertIn("boostEffect.above (4 entries -> 50): HC [1, 1.05, 1.1, 1.15] -> TS [1 x50]", text)
        self.assertIn("schedule.pool (1 entries -> 2): HC [4] -> TS [1, 4]", text)
        self.assertIn("schedule.slot (1 entries -> 2)", text)
        self.assertNotIn("boostEffect.below", text)
        self.assertEqual(r.counts["core_diffs"], 3)

    def test_archetype_tables(self):
        # same first fifty levels, longer Homecoming table: no difference; one changed table: found
        hc_tables = [[0.5] * 105, [1.0] * 105, [2.0] * 105]
        ts_tables = [[0.5] * 50, [1.5] * 50]
        hc_at = at("Class_X", "Cat", {"melee_a": 0, "melee_b": 1, "melee_c": 2},
                   max={"DamageType00": [100] * 105, "Knock": 1}, base={"ToHit": 0.75})
        ts_at = at("Class_X", "Cat", {"melee_a": 0, "melee_b": 1}, max={"DamageType00": [100] * 50, "Knockback": 1},
                   base={"ToHit": 0.75})
        hc = side("HC", core({}, archetypes=[hc_at], modTables=hc_tables, categories={}))
        ts = side("TS", core({}, damage=("Fire",), archetypes=[ts_at], modTables=ts_tables, categories={}))
        hc.core["attribNames"]["Damage"] = named("Fire", "Sonic")
        r = C.compare(hc, ts)
        text = "\n".join("\n".join(ls) for _, ls in r.sections)
        self.assertIn("- melee_b: 50 of 50 levels differ; level 1: 1 -> 1.5", text)
        self.assertIn("- melee_c: only on HC (all 1 archetypes)", text)
        self.assertNotIn("melee_a:", text)
        self.assertNotIn("max.DamageType", text)  # equal over the first 50 levels
        self.assertNotIn("max.Knock", text)       # the same attribute

    def test_enhancement_sets_and_bonus_powers(self):
        bon_hc = power(100, "Set_Bonus.Global_Bonus.Aegis", rech=1)
        bon_ts = power(200, "Set_Bonus.Set_Bonus.Aegis", rech=1)
        pvp_ts = power(201, "Set_Bonus.PVP_Set_Bonus.Aegis", rech=2)
        hc_set = {"id": 1, "n": "Thunder", "dn": "T", "grp": "Melee Damage", "conv": [], "minL": 10, "maxL": 25,
                  "slots": [[5]], "elig": [1], "bon": [{"min": 2, "max": 3, "auto": [100]}]}
        ts_set = dict(hc_set, id=9, slots=[[6]], elig=[], bon=[{"min": 2, "max": 4, "auto": [200]}])
        hc = side("HC", core({}), [], [power(1, "A.B.C")],
                  {"boosts": [power(5, "Boosts.X")], "bonusPowers": [bon_hc], "sets": [hc_set]})
        ts = side("TS", core({}), [], [power(1, "A.B.C")],
                  {"boosts": [power(6, "Boosts.X")], "bonusPowers": [bon_ts, pvp_ts], "sets": [ts_set]})
        r = C.compare(hc, ts)
        text = "\n".join("\n".join(ls) for _, ls in r.sections)
        self.assertIn("eligible powers (shared powers only): 1 only on HC", text)
        self.assertIn("bonuses: 1 only on HC, 1 only on TS", text)
        self.assertNotIn("piece enhancements differ", text)  # the piece has the same name on both
        self.assertEqual(r.counts["bonus_both"], 1)           # Aegis matched across the two categories
        self.assertEqual(r.counts["bonus_differ"], 0)
        self.assertIn("Set bonus powers only on TS (1): Set_Bonus.PVP_Set_Bonus.Aegis", text)


class Report(unittest.TestCase):
    def test_render_is_ascii_and_summarised(self):
        hc = side("HC", core({}), [], [power(1, "A.B.C", dn="caf\u00e9")])
        ts = side("TS", core({}), [], [power(1, "A.B.C")])
        r = C.compare(hc, ts)
        text = C.render(r)
        text.encode("ascii")
        self.assertIn("## Summary", text)
        self.assertIn("HC = hc v1; TS = ts v1", text)

    def test_field_counts_break_ties_by_name(self):
        # counted in two orders: the same list either way, most first, then by name
        for keys in (["rech", "end", "acc", "acc"], ["acc", "end", "acc", "rech"]):
            got = C.field_counts(C.Counter(keys))
            self.assertEqual(got, [("accuracy", 2), ("endurance", 1), ("recharge", 1)])

    def test_report_section_without_homecoming(self):
        with mock.patch.object(C.config, "version_index", return_value=None):
            out = "\n".join(C.report_section("thunderspy", "ts9-6", C.Path("nowhere")))
        self.assertIn("Not compared", out)
        self.assertIn("## Differences from Homecoming", out)

    def test_report_section_survives_unreadable_data(self):
        with mock.patch.object(C.config, "version_index", side_effect=ValueError("bad index")):
            out = "\n".join(C.report_section("thunderspy", "ts9-6", C.Path("nowhere")))
        self.assertIn("Not compared (ValueError: bad index)", out)


if __name__ == "__main__":
    unittest.main()
