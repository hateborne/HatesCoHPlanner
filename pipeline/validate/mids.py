"""Cross-check the live decode against MidsReborn's database (the validation oracle).

Mids is pre-I28 and stores some things differently from the game, so this never "fixes" the
live data: it reports agreement rates and lists every disagreement for review.

Checks:
  * display names of powers present in both
  * attribute labels: our exe-derived attribute name vs Mids' EffectType/DamageType on effects
    paired by (power, ModifierTable, Scale)
  * archetype HP / HP cap / resistance cap at level 50 vs Mids I12.mhd archetype records
  * enhancement grade values and ED thresholds vs Mids Maths.mhd
"""
from __future__ import annotations

import json
import time
from collections import Counter, defaultdict

from pipeline import config, mids_ref
from pipeline.decode.live import LiveData

# Mids is a reference: its numbers back up or question ours, they never replace them

# Mids EffectType ids (MidsReborn Core/Enums.cs).
MIDS_ET = {0: "None", 1: "Accuracy", 2: "ViewAttrib", 3: "Damage", 4: "DamageBuff", 5: "Defense",
           6: "DropToggles", 7: "Endurance", 8: "EnduranceDiscount", 9: "Enhancement", 10: "Fly",
           11: "SpeedFlying", 12: "GrantPower", 13: "Heal", 14: "HitPoints", 15: "InterruptTime",
           16: "JumpHeight", 17: "SpeedJumping", 18: "Meter", 19: "Mez", 20: "MezResist",
           21: "MovementControl", 22: "MovementFriction", 23: "PerceptionRadius", 24: "Range",
           25: "RechargeTime", 26: "Recovery", 27: "Regeneration", 28: "ResEffect",
           29: "Resistance", 30: "RevokePower", 31: "Reward", 32: "SpeedRunning",
           33: "SetCostume", 34: "SetMode", 35: "Slow", 36: "StealthRadius",
           37: "StealthRadiusPlayer", 38: "EntCreate", 39: "ThreatLevel", 40: "ToHit",
           41: "Translucency", 42: "XPDebtProtection", 43: "SilentKill", 44: "Elusivity",
           45: "GlobalChanceMod", 46: "LevelShift", 47: "UnsetMode", 48: "Rage", 49: "MaxRunSpeed",
           50: "MaxJumpSpeed", 51: "MaxFlySpeed", 52: "DesignerStatus", 53: "PowerRedirect",
           54: "TokenAdd", 55: "ExperienceGain", 56: "InfluenceGain", 57: "PrestigeGain",
           58: "AddBehavior", 59: "RechargePower", 60: "RewardSourceTeam", 61: "VisionPhase",
           62: "CombatPhase", 63: "ClearFog", 64: "SetSZEValue", 65: "ExclusiveVisionPhase",
           66: "Absorb", 67: "XAfraid", 68: "XAvoid", 69: "BeastRun", 70: "ClearDamagers",
           71: "EntCreate_x", 72: "Glide", 73: "Hoverboard", 74: "Jumppack", 75: "MagicCarpet",
           76: "NinjaRun", 77: "Null", 78: "NullBool", 79: "Stealth", 80: "SteamJump", 81: "Walk",
           82: "XPDebt", 83: "ForceMove", 84: "ModifyAttrib", 85: "ExecutePower"}

MEZ = {"Confused", "Afraid", "Terrorized", "Held", "Immobilized", "Stunned", "Sleep", "Knockup",
       "Knock", "Repel", "Teleport", "Untouchable", "Intangible", "OnlyAffectsSelf", "Placate",
       "Taunt", "Fly", "Jumppack", "NullBool"}

# Archetype reference values decoded from Mids I12.mhd v2025.12.1240 ARCHETYPES section
# (HP at level 50, HP cap, resistance cap). Mids predates I28, so Brute/Sentinel/MM may differ.
MIDS_AT = {
    "Class_Blaster": (1205, 1847.3, .75), "Class_Controller": (1017, 1606.3, .75),
    "Class_Defender": (1017, 1606.3, .75), "Class_Scrapper": (1339, 2409.5, .75),
    "Class_Tanker": (1874, 3534, .90), "Class_Peacebringer": (1071, 2409.5, .85),
    "Class_Warshade": (1071, 2409.5, .85), "Class_Sentinel": (1205, 2088.3, .75),
    "Class_Brute": (1499, 3212.7, .90), "Class_Stalker": (1204, 2088.25, .75),
    "Class_Mastermind": (803, 1606.3, .75), "Class_Dominator": (1017, 1606.3, .75),
    "Class_Corruptor": (1071, 1606.3, .75), "Class_Arachnos_Widow": (1071, 2409.5, .85),
    "Class_Arachnos_Soldier": (1071, 2409.5, .85),
}

# Mids Maths.mhd: TO/DO/SO per schedule A..D, IO at levels 25 and 50, ED thresholds per schedule.
MIDS_GRADES = {"TO": [.083, .05, .10, .15], "DO": [.167, .10, .20, .30], "SO": [.333, .20, .40, .60]}
MIDS_IO = {25: {"A": .320}, 50: {"A": .424, "B": .255, "C": .509, "D": .764}}
MIDS_ED = {"A": (.70, .90, 1.00), "B": (.40, .50, .60), "C": (.80, 1.00, 1.20), "D": (1.20, 1.50, 1.80)}


def expected_family(attr_name: str, aspect: str, live: LiveData) -> set[str]:
    """Mids EffectType names compatible with one of our (attribute, aspect) pairs."""
    an = live.attrib_names
    if attr_name.startswith("DamageType"):
        if aspect == "kResistance":
            return {"Resistance"}
        if aspect == "kStrength":
            # Mids files resistance-enhancing boosts as "Resistance" and damage ones as DamageBuff.
            return {"DamageBuff", "Enhancement", "Resistance"}
        return {"Damage", "Heal"}
    if attr_name.startswith("DefenseType") or attr_name == "Defense":
        return {"Defense", "Enhancement"} if aspect != "kResistance" else {"ResEffect"}
    if attr_name.startswith("Elusivity"):
        return {"Elusivity"}
    if attr_name in MEZ:
        if aspect == "kResistance":
            return {"MezResist", "ResEffect"}
        if aspect == "kStrength":
            return {"Enhancement", "Mez"}
        return {"Mez", "Fly", "Jumppack", "NullBool"}
    if attr_name == "HitPoints":
        return {"Heal", "HitPoints", "Damage", "ResEffect", "Enhancement"}
    if attr_name == "Endurance":
        return {"Endurance", "Enhancement", "ResEffect"}
    _ = an
    base = {attr_name, "Enhancement", "ResEffect"}
    if attr_name in ("SpeedRunning", "SpeedFlying", "SpeedJumping"):
        base |= {"Slow", "MaxRunSpeed", "MaxFlySpeed", "MaxJumpSpeed"}
    if attr_name == "RechargeTime":
        base |= {"Slow"}
    return base


def run(live: LiveData) -> dict | None:
    """Run all checks; returns a dict the report renderer formats (None without Mids data)."""
    if not config.mids_available():
        return None
    t0 = time.time()
    mids = mids_ref.powers()
    mp = {p["FullName"].lower(): p for p in mids}
    ours = {p["FullName"].lower(): p for p in live.powers}
    M = live.messages
    out: dict = {"load_secs": round(time.time() - t0, 1)}

    # -- names
    both = [k for k in ours if k in mp]
    name_same = name_diff = 0
    diffs = []
    for k in both:
        a = M.get(ours[k]["DisplayName"], "")
        b = mp[k]["DisplayName"]
        if a.strip().lower() == b.strip().lower():
            name_same += 1
        else:
            name_diff += 1
            if len(diffs) < 40 and a and b:
                diffs.append((ours[k]["FullName"], b, a))
    out["names"] = {"in_both": len(both), "same": name_same, "different": name_diff,
                    "examples": diffs}

    # -- attribute labels
    attribs = live.attribs
    asp_enum = live.enums["mod.Aspect"]
    agree: dict[int, Counter] = defaultdict(Counter)
    disagree_examples: dict[int, list] = defaultdict(list)
    for k in both:
        meff = mp[k].get("Effects") or []
        if not meff:
            continue
        by_tbl = defaultdict(list)
        for e in meff:
            by_tbl[(e["ModifierTable"].lower(), round(e["Scale"], 3))].append(e)

        def walk(effs):
            for e in effs or []:
                for a in e.get("AttribMod") or []:
                    yield a
                yield from walk(e.get("Effect"))
        for a in walk(ours[k].get("Effect")):
            cands = by_tbl.get((a["Table"].lower(), round(a["Scale"], 3)))
            if not cands:
                continue
            mids_types = {MIDS_ET.get(e["EffectType"], str(e["EffectType"])) for e in cands}
            asp = asp_enum.get(a["Aspect"], a["Aspect"])
            for off in a["Attrib"]:
                nm = attribs.get(off, {}).get("name", f"?{off}")
                fam = expected_family(nm, asp, live)
                ok = bool(fam & mids_types)
                agree[off]["ok" if ok else "bad"] += 1
                if not ok and len(disagree_examples[off]) < 3:
                    disagree_examples[off].append((ours[k]["FullName"], nm, asp,
                                                   sorted(mids_types)))
    rows = []
    for off, c in sorted(agree.items()):
        n = c["ok"] + c["bad"]
        rows.append({"offset": off, "name": attribs.get(off, {}).get("name", "?"), "pairs": n,
                     "agree": round(c["ok"] / n, 4), "examples": disagree_examples.get(off, [])})
    unlabelled = sorted({off for p in live.powers for e in _walk_all(p) for off in e["Attrib"]
                         if off not in attribs})
    out["attribs"] = {"rows": rows, "unlabelled": unlabelled}

    # -- archetypes
    at_rows = []
    for c in live.classes:
        mx = c["AttribMaxTable"][0]["HitPoints"]
        mm = c["AttribMaxMaxTable"][0]["HitPoints"]
        rc = c["ResistanceMaxTable"][0]["DamageType00"]
        ref = MIDS_AT.get(c["Name"])
        at_rows.append({"at": c["Name"], "hp50": round(mx[49], 2), "hpcap50": round(mm[49], 2),
                        "rescap50": round(rc[49], 3),
                        "mids": ref, "match": bool(ref) and abs(mx[49] - ref[0]) < 1.5
                        and abs(mm[49] - ref[1]) < 1.5 and abs(rc[49] - ref[2]) < 1e-3})
    out["archetypes"] = at_rows

    # -- enhancement grades, IO curves, ED (from class 0; these tables are class-independent)
    c0 = {m["Name"].lower(): m["Values"] for m in live.classes[0]["ModTable"]}
    ones = c0["melee_ones"][0]
    pw = {p["FullName"]: p for p in live.powers}

    def boost_scale(name):
        rec = pw.get(name)
        return rec["Effect"][0]["AttribMod"][0]["Scale"] if rec else None
    grade = {
        "TO": boost_scale("Boosts.Generic_Accuracy.Generic_Accuracy"),
        "SO": boost_scale("Boosts.Magic_Accuracy.Magic_Accuracy"),
    }
    io = {lvl: {"A": c0["melee_boosts_33"][lvl - 1], "B": c0["melee_boosts_20"][lvl - 1],
                "C": c0["melee_boosts_40"][lvl - 1], "D": c0["melee_boosts_60"][lvl - 1]}
          for lvl in (25, 50)}
    ed = {}
    for d in live.dim_returns:
        if not d["AttribReturnSet"]:
            continue
        rs = d["AttribReturnSet"][0]
        starts = tuple(round(r["Start"], 3) for r in rs["Return"])
        ed[tuple(d["Boost"]) or ("default",)] = starts
    out["enhance"] = {"ones": ones, "grade": grade, "io": io, "ed": {str(k): v for k, v in ed.items()},
                      "mids_grade": MIDS_GRADES, "mids_io": MIDS_IO, "mids_ed": MIDS_ED}
    return out


def _walk_all(p):
    def walk(effs):
        for e in effs or []:
            for a in e.get("AttribMod") or []:
                yield a
            yield from walk(e.get("Effect"))
    yield from walk(p.get("Effect"))
    yield from walk(p.get("ActivationEffect"))
