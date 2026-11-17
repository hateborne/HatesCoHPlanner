"""Turn the raw live decode into the compact JSON the site loads.

Output: <server data>/<gameVersion>/{core,powersets,powers,boosts,mids-map}.json, then
<server data>/versions.json and latest.json (last). The server data folder is public/data for
Homecoming and public/data/<server> for another (config.DATA_OUT); a server without a Mids
database gets no mids-map.json.
Only player-reachable data is exported: the 15 archetypes' primary/secondary categories, Pool,
Epic and Inherent sets, every enhancement (Boosts.*) and IO set, the set-bonus powers they grant,
and anything those powers redirect to or grant. PvP-only effects are dropped (PvP is out of v1).
"""
from __future__ import annotations

import datetime as dt
import hashlib
import json
import re
from pathlib import Path
from collections import Counter

from pipeline import config
from pipeline.coh.p7reader import param_power_names
from pipeline.decode.live import LiveData, sha1
from pipeline.forced_respec import forced_respec_warnings
from pipeline.ids import IdRegistry

# special attributes whose mods name powers in their Params (481, 482, 486, 512 on Homecoming and
# Thunderspy; looked up by name so another client's numbering can't miss them)
GRANT_NAMES = ("GrantPower", "RevokePower", "GrantBoostedPower", "ExecutePower")
PVP_ONLY = ["enttype", "target>", "player", "eq"]
PVE_ONLY = ["enttype", "target>", "critter", "eq"]


def num(v):
    """Round floats to 6 significant digits so the JSON stays small (ints pass through)."""
    if isinstance(v, float):
        r = float(f"{v:.6g}")
        return int(r) if r.is_integer() and abs(r) < 1e15 else r
    return v


def strip_k(name):
    return name[1:] if isinstance(name, str) and name.startswith("k") else name


def contains_seq(seq: list, sub: list) -> bool:
    n = len(sub)
    return any(seq[i:i + n] == sub for i in range(len(seq) - n + 1))


ENT_CREATE_PARAM = 3  # the param type of an EntCreate mod's Params (the client tests `*params == 3`)


def ent_create_param(params, layout: list) -> dict | None:
    """The names an EntCreate mod's Params carry.

    The client's parse table (LiveData.ent_create_layout) gives the order: one word per field
    (EntityDef, Class, ..., a string's pool offset or 0), and for a string earray (PowerCategory,
    Powerset, Power) a count followed by its strings.

    @param params A mod's decoded Params ({"n": param type, "words", "strings"}), or None.
    @param layout [(field name, is a string earray)] in serialized order.
    @return {"EntityDef", "Class", "Power": [names]} (empty when absent), or None when the Params
        aren't an EntCreate struct or its words don't fit the layout exactly.
    """
    if not params or params.get("n") != ENT_CREATE_PARAM or not layout:
        return None
    words, strings = params.get("words") or [], params.get("strings") or {}
    i = 0
    got: dict = {}
    for name, is_array in layout:
        if i >= len(words):
            return None
        if is_array:
            n = words[i]
            if i + 1 + n > len(words):
                return None
            got[name] = [strings[j] for j in range(i + 1, i + 1 + n) if j in strings]
            i += 1 + n
        else:
            got[name] = strings.get(i, "")
            i += 1
    if i != len(words):
        return None
    return {"EntityDef": got.get("EntityDef") or "", "Class": got.get("Class") or "",
            "Power": got.get("Power") or []}


def grant_attribs(attribs: dict) -> set[int]:
    """The attribute offsets whose mods carry power names (kGrantPower and kin).

    @param attribs LiveData.attribs ({offset: {"name", "aliases", "kind"}}).
    @return Their offsets.
    @raise RuntimeError When the client names none of them (granted powers would silently vanish).
    """
    out = {o for o, a in attribs.items() if a.get("kind") == "special" and a["name"] in GRANT_NAMES}
    if len(out) != len(GRANT_NAMES):
        raise RuntimeError(f"the client's special attributes lack some of {GRANT_NAMES} (found {sorted(out)})")
    return out


class Exporter:
    """Builds the site data from a LiveData decode."""

    def __init__(self, live: LiveData):
        self.L = live
        self.ids = IdRegistry()
        self.M = live.messages
        self.pw = {p["FullName"]: p for p in live.powers}
        self.pw_lower = {k.lower(): k for k in self.pw}
        self.sets = {s["FullName"]: s for s in live.powersets}
        self.sets_lower = {k.lower(): k for k in self.sets}
        self.cats = {c["Name"].lower(): c for c in live.powercats}
        self.E = live.enums
        self.grant_attribs = grant_attribs(live.attribs)
        # no_frames: enhancements left without frame art because the client has no frame columns
        self.report: dict = {"missing_text": Counter(), "unresolved_refs": Counter(),
                             "pvp_effects_dropped": 0, "no_frames": 0}
        self.used_tables: set[str] = set()

    # ---- helpers ------------------------------------------------------------------------------
    def text(self, key: str) -> str:
        """Display text for a message key.

        A string that isn't a key in the message store is shown as written, as the client's
        textStd does: Thunderspy's data writes some names straight into the field ("Earth Combat",
        "Auto Turret", Primalist's help), where Homecoming's always gives a "P<number>" key. A
        "P<number>" key the store lacks is missing text and stays empty.

        @param key The field's value (a message key, or the text itself).
        @return The text to show.
        """
        if not key:
            return ""
        t = self.M.get(key)
        if t is None:
            if re.fullmatch(r"P\d+", key):
                self.report["missing_text"]["P"] += 1
                return ""
            self.report["missing_text"]["written as text"] += 1
            return key
        return t

    def power_name(self, name: str) -> str | None:
        return self.pw_lower.get(name.lower())

    def enum(self, kind: str, v):
        return strip_k(self.E.get(kind, {}).get(v, v))

    # ---- scope --------------------------------------------------------------------------------
    def scope(self):
        """Pick exported powersets and the closure of powers they need."""
        player_cats = set()
        self.class_cats = {}
        for c in self.L.classes:
            pri = self.cats[c["PrimaryCategory"].lower()]["Name"]
            sec = self.cats[c["SecondaryCategory"].lower()]["Name"]
            pool = self.cats[c["PowerPoolCategory"].lower()]["Name"]
            epic = self.cats[(c["EpicPoolCategory"] or "Epic").lower()]["Name"]
            self.class_cats[c["Name"]] = {"pri": pri, "sec": sec, "pool": pool, "epic": epic,
                                          "inherent": "Inherent"}
            player_cats |= {pri, sec, pool, epic, "Inherent"}
        self.player_cats = sorted(player_cats)
        set_names = []
        for cat in self.player_cats:
            set_names += self.cats[cat.lower()]["PowerSets"]
        self.export_sets = [s for s in set_names if s in self.sets]

        seeds = [p for s in self.export_sets for p in self.sets[s]["Powers"]]
        boost_sets = self.cats["boosts"]["PowerSets"]
        self.boost_powers = [p for s in boost_sets for p in self.sets.get(s, {}).get("Powers", [])]
        bonus = []
        for bs in self.L.boostsets:
            for b in bs["Bonuses"]:
                bonus += b["AutoPowers"]
                if b.get("BonusPower"):
                    bonus.append(b["BonusPower"])
        seeds += self.boost_powers + bonus

        keep: dict[str, int] = {}
        stack = [(p, 0) for p in seeds]
        while stack:
            name, depth = stack.pop()
            real = self.power_name(name)
            if real is None:
                self.report["unresolved_refs"][name] += 1
                continue
            if real in keep or depth > 6:
                continue
            keep[real] = depth
            rec = self.pw[real]
            for r in rec.get("Redirect") or []:
                stack.append((r["Power"], depth + 1))
            for a in self.walk_mods(rec):
                if set(a["Attrib"]) & self.grant_attribs:
                    for n in param_power_names(a["Params"]):
                        stack.append((n, depth + 1))
        self.export_powers = list(keep)

    @staticmethod
    def walk_mods(rec):
        def walk(effs):
            for e in effs or []:
                for a in e.get("AttribMod") or []:
                    yield a
                yield from walk(e.get("Effect"))
        yield from walk(rec.get("Effect"))
        yield from walk(rec.get("ActivationEffect"))

    # ---- conversion ---------------------------------------------------------------------------
    def conv_mod(self, a, ids: bool = True) -> dict:
        """One AttribMod in the site's short form.

        @param a The decoded mod.
        @param ids Name granted powers by id (`pw`); False names them by full name (`pwn`) instead,
            so nothing allocates an id (pseudo-pet powers, which no build names).
        @return The mod.
        """
        o = {"a": a["Attrib"],
             "asp": self.enum("mod.Aspect", a["Aspect"]),
             "t": self.enum("mod.Type", a["Type"]),
             "tg": self.enum("mod.Target", a["Target"]),
             "tbl": a["Table"], "sc": num(a["Scale"])}
        self.used_tables.add(a["Table"].lower())
        app = self.enum("mod.ApplicationType", a["ApplicationType"])
        if app != "OnTick":
            o["app"] = app
        if a["Duration"]:
            o["dur"] = num(a["Duration"])
        if a["Magnitude"] != 1.0:
            o["mag"] = num(a["Magnitude"])
        for src, dst in (("Delay", "del"), ("Period", "per")):
            if a.get(src):
                o[dst] = num(a[src])
        if a.get("TickChance", 1.0) != 1.0:
            o["tc"] = num(a["TickChance"])
        stk = self.enum("mod.StackType", a["StackType"])
        if stk != "Stack":
            o["stk"] = stk
        if a.get("StackLimit"):
            o["stkL"] = a["StackLimit"]
        if a.get("StackKey", -1) not in (-1, 0):
            o["stkK"] = a["StackKey"]
        for src, dst in (("DurationExpr", "dx"), ("MagnitudeExpr", "mx"),
                         ("DelayedRequires", "dreq"), ("Suppress", "sup")):
            if a.get(src):
                o[dst] = a[src]
        names = self.mod_flags(a.get("Flags") or [])
        if names:
            o["fl"] = names
        if a.get("BoostModAllowed"):
            o["bma"] = a["BoostModAllowed"]
        if set(a["Attrib"]) & self.grant_attribs:
            names = [self.power_name(n) for n in param_power_names(a["Params"])]
            if ids:
                o["pw"] = [self.ids.get("power", n) for n in names if n]
            else:
                o["pwn"] = [n for n in names if n]  # by name: a pet's grants allocate no id
        return o

    def mod_flags(self, words: list) -> list[str]:
        """AttribMod Flags bit array -> flag names (e.g. IgnoreStrength, Boost)."""
        names = []
        en = self.E.get("mod.Flags", {})
        for wi, w in enumerate(words):
            for b in range(32):
                if w & (1 << b):
                    names.append(en.get(wi * 32 + b, f"bit{wi * 32 + b}"))
        return names

    def effect_flags(self, v: int) -> list[str]:
        en = self.E.get("effect.Flags", {})
        return [n for bit, n in sorted(en.items()) if v & bit]

    def pvp_flag(self, e: dict) -> bool:
        """@return Whether an effect group carries the PVPOnly flag."""
        return "PVPOnly" in self.effect_flags(e.get("Flags") or 0)

    def pvp_only(self, e: dict, keep_flagged: bool = False) -> bool:
        """Whether conv_effects drops an effect group as PvP-only.

        @param e The decoded group.
        @param keep_flagged Keep a group only its flag makes PvP-only (a client that tests no group
            flags lists it); one that requires a player target is still dropped, as the client's own
            requirement check leaves it out too.
        @return True for its PVPOnly flag (unless kept) or a player-target requirement.
        """
        req = e.get("Requires") or []
        return (not keep_flagged and self.pvp_flag(e)) or (
            contains_seq(req, PVP_ONLY) and not contains_seq(req, PVE_ONLY))

    def conv_effects(self, effs, ids: bool = True, keep_pvp: bool = False) -> list:
        """Effect groups in the site's short form, PvP-only groups dropped.

        @param effs The decoded groups.
        @param ids See conv_mod.
        @param keep_pvp Keep the groups only their PVPOnly flag makes PvP-only (a client that lists
            them: build_info).
        @return The groups that hold mods.
        """
        out = []
        for e in effs or []:
            req = e.get("Requires") or []
            eflags = self.effect_flags(e.get("Flags") or 0)
            if self.pvp_only(e, keep_pvp):
                self.report["pvp_effects_dropped"] += 1
                continue
            o = {}
            if e.get("Chance", 1.0) != 1.0:
                o["ch"] = num(e["Chance"])
            if e.get("ProcsPerMinute"):
                o["ppm"] = num(e["ProcsPerMinute"])
            if e.get("Delay"):
                o["del"] = num(e["Delay"])
            if req:
                o["req"] = req
            if e.get("Tag"):
                o["tag"] = e["Tag"]
            if eflags:
                o["fl"] = eflags
            if e.get("EvalFlags"):
                o["ef"] = e["EvalFlags"]
            mods = [self.conv_mod(a, ids) for a in e.get("AttribMod") or []]
            if mods:
                o["m"] = mods
            sub = self.conv_effects(e.get("Effect"), ids, keep_pvp)
            if sub:
                o["sub"] = sub
            if mods or sub:
                out.append(o)
        return out

    def conv_power(self, name: str) -> dict:
        r = self.pw[name]
        o = {"id": self.ids.get("power", name), "n": name,
             "dn": self.text(r["DisplayName"]), "sh": self.text(r["DisplayShortHelp"]),
             "lh": self.text(r["DisplayHelp"]),
             "icon": r["IconName"].rsplit(".", 1)[0] if r["IconName"] else "",
             "type": self.enum("power.Type", r["Type"])}
        defaults = {"AutoIssue": 0, "Free": 0, "NumAllowed": 1, "Accuracy": 1.0, "RechargeTime": 0.0,
                    "EnduranceCost": 0.0, "Range": 0.0, "RangeSecondary": 0.0,
                    "TimeToActivate": 0.0, "ActivatePeriod": 0.0, "Radius": 0.0, "Arc": 0.0,
                    "MaxTargetsHit": 0, "InterruptTime": 0.0, "IgnoreStrength": 0,
                    "ProcAllowed": 0, "ForceLevelBought": -1, "MaxBoosts": 0,
                    "ShowInManage": 1, "ShowInInfo": 1, "IgnoreLevelBought": 0}
        short = {"AutoIssue": "auto", "Free": "free", "NumAllowed": "na", "Accuracy": "acc",
                 "RechargeTime": "rech", "EnduranceCost": "end", "Range": "rng",
                 "RangeSecondary": "rng2", "TimeToActivate": "cast", "ActivatePeriod": "ap",
                 "Radius": "rad", "Arc": "arc", "MaxTargetsHit": "maxT", "InterruptTime": "intr",
                 "IgnoreStrength": "ign", "ProcAllowed": "proc", "ForceLevelBought": "flb",
                 "MaxBoosts": "maxB", "ShowInManage": "sm", "ShowInInfo": "si",
                 "IgnoreLevelBought": "ilb"}
        for k, dv in defaults.items():
            v = r.get(k, dv)
            if v != dv:
                o[short[k]] = num(v)
        area = self.enum("power.EffectArea", r["EffectArea"])
        if area != "Character":
            o["area"] = area
        o["tgt"] = self.enum("power.Target", r["Target"])
        ea = [self.enum("power.EntsAffected", v) for v in r.get("EntsAffected") or []]
        if ea and ea != [o["tgt"]]:
            o["ea"] = ea
        for src, dst in (("BuyRequires", "br"), ("ActivateRequires", "actr"),
                         ("SlotRequires", "slr"), ("BoostsAllowed", "ba"),
                         ("GroupMembership", "gm"), ("AttackTypes", "atk"),
                         ("RechargeGroup", "rg"), ("ModesRequired", "modr"),
                         ("ModesDisallowed", "modd")):
            if r.get(src):
                o[dst] = r[src]
        if r.get("MaxBoosts"):
            o["slot"] = [r["MinSlotLevel"], r["MaxSlotLevel"]]
            o["maxBL"] = r["MaxBoostLevel"]
        if r.get("Redirect"):
            o["redir"] = [{"p": self.ids.get("power", self.power_name(x["Power"])),
                           "req": x["Requires"]}
                          for x in r["Redirect"] if self.power_name(x["Power"])]
        eff = self.conv_effects(r.get("Effect"))
        if eff:
            o["eff"] = eff
        act = self.conv_effects(r.get("ActivationEffect"))
        if act:
            o["act"] = act
        if r["Type"] == 3:  # enhancement
            if "BoostFrameLeft" in r:
                o["bf"] = [r["BoostFrameLeft"], r["BoostFrameRight"]]
            else:  # older clients (before the February 10, 2026 update) have no frame columns
                self.report["no_frames"] += 1
            for src, dst in (("BoostPog", "pog"), ("BoostBoostable", "bb"),
                             ("BoostUsePlayerLevel", "bup"), ("BoostIgnoreEffectiveness", "bie"),
                             ("BoostAlwaysCountForSet", "bac"), ("BoostLicenseLevel", "bll"),
                             ("BoostHideLevel", "bhl"), ("BoostCombinable", "bcm"),
                             ("BoostAccountBound", "bab")):
                if r.get(src):
                    o[dst] = r[src]
            if not r.get("BoostTradeable"):
                o["ntr"] = 1  # the tooltip's "You may not trade this Enhancement.
            cc = r.get("BoostCatalystConversion")
            if cc and self.power_name(cc):
                o["bcc"] = self.ids.get("power", self.power_name(cc))
        return o

    def conv_set(self, name: str) -> dict:
        s = self.sets[name]
        o = {"id": self.ids.get("powerset", name), "n": name,
             "dn": self.text(s["DisplayName"]), "sh": self.text(s["DisplayShortHelp"]),
             "lh": self.text(s["DisplayHelp"]),
             "icon": s["IconName"].rsplit(".", 1)[0] if s["IconName"] else "",
             "p": [], "av": []}
        for p, av in zip(s["Powers"], s["Available"]):
            real = self.power_name(p)
            if real is None:
                self.report["unresolved_refs"][p] += 1
                continue
            o["p"].append(self.ids.get("power", real))
            o["av"].append(av)
        for src, dst in (("SetBuyRequires", "sbr"), ("SetRequires", "sr"),
                         ("SpecializeRequires", "spr")):
            if s.get(src):
                o[dst] = s[src]
        if s.get("SetBuyRequiresFailedText"):
            t = s["SetBuyRequiresFailedText"]
            o["sbrt"] = self.M.get(t, t)
        if s.get("SpecializeAt"):
            o["spa"] = s["SpecializeAt"]
        if not s.get("ShowInManage", 1):
            o["sm"] = 0
        return o

    def conv_boostset(self, bs, exported_power_ids: set[int]) -> dict:
        o = {"id": self.ids.get("boostset", bs["Name"]), "n": bs["Name"],
             "dn": self.text(bs["DisplayName"]), "grp": self.text(bs["GroupName"]),
             "conv": bs["ConversionGroups"], "minL": bs["MinLevel"], "maxL": bs["MaxLevel"],
             "slots": [], "elig": [], "bon": []}
        for bl in bs["BoostLists"]:
            o["slots"].append([self.ids.get("power", self.power_name(b)) for b in bl["Boosts"]
                               if self.power_name(b)])
        for p in bs["Powers"]:
            real = self.power_name(p)
            if real:
                pid = self.ids.get("power", real)
                if pid in exported_power_ids:
                    o["elig"].append(pid)
        for b in bs["Bonuses"]:
            x = {"min": b["MinBoosts"], "max": b["MaxBoosts"],
                 "auto": [self.ids.get("power", self.power_name(n)) for n in b["AutoPowers"]
                          if self.power_name(n)]}
            if b["Requires"]:
                x["req"] = b["Requires"]
            if b.get("BonusPower") and self.power_name(b["BonusPower"]):
                x["bp"] = self.ids.get("power", self.power_name(b["BonusPower"]))
            if b.get("DisplayText"):
                x["txt"] = self.text(b["DisplayText"])
            o["bon"].append(x)
        return o

    # ---- pseudo-pets ---------------------------------------------------------------------------
    def _set_in_category(self, category: str, set_name: str) -> dict | None:
        """@return The powerset of a category with this short name (category_GetBaseSetByName), or None."""
        cat = self.cats.get((category or "").lower())
        if cat is None:
            return None
        for full in cat["PowerSets"]:
            s = self.sets.get(full)
            if s is not None and s["Name"].lower() == (set_name or "").lower():
                return s
        return None

    def _pet_powers(self, par: dict, vdef: dict | None) -> tuple[list[str], int]:
        """The powers a pseudo-pet runs, in the order the client's power info lists them.

        Its villain def's Power refs, last first (a "*" power takes the whole set in order; a
        category, set or power the client lacks is skipped), then the mod's own Power list, last
        first (power_AddPetEffects; getTotalDamage walks them the same way).

        @param par The mod's EntCreate params (ent_create_param).
        @param vdef Its villain def, or None.
        @return (full power names, how many of them come from the villain def).
        """
        names: list[str] = []
        for ref in reversed((vdef or {}).get("Power") or []):
            s = self._set_in_category(ref["PowerCategory"], ref["PowerSet"])
            if s is None:
                continue
            if ref["Power"].startswith("*"):
                names += [n for n in (self.power_name(p) for p in s["Powers"]) if n]
            else:
                n = self.power_name(f"{s['FullName']}.{ref['Power']}")
                if n:
                    names.append(n)
        from_def = len(names)
        names += [n for n in (self.power_name(p) for p in reversed(par["Power"])) if n]
        return names, from_def

    def client_templates(self, rec: dict):
        """A power's mods in the order of the client's template list, with whether each is hidden.

        The client flattens a power's Effect groups, then its ActivationEffect groups, each group's
        sub-groups before its own mods (its loader, decompiled). A mod is hidden when a group
        around it is HideFromInfo: the power info then lists no pet for it.

        @param rec A decoded power.
        @return Iterator of (mod, hidden).
        """
        def walk(effs, hidden):
            for e in effs or []:
                h = hidden or "HideFromInfo" in self.effect_flags(e.get("Flags") or 0)
                yield from walk(e.get("Effect"), h)
                for a in e.get("AttribMod") or []:
                    yield a, h
        yield from walk(rec.get("Effect"), False)
        yield from walk(rec.get("ActivationEffect"), False)

    def _pvp_executions(self, rec: dict, execute: int) -> list[dict]:
        """The ExecutePower mods of a power's PvP-only groups, which conv_effects drops.

        The client's damage total counts every ExecutePower mod, whatever its group (its
        getTotalDamage, decompiled), so the pets file keeps these for the version's own data.

        @param rec A decoded power.
        @param execute The ExecutePower attribute's offset.
        @return One {"p": [executed powers], "boosts"?: 1 (CopyBoosts)} per executing mod and
            attribute, in the client's template order.
        """
        out: list[dict] = []

        def walk(effs, pvp: bool) -> None:
            for e in effs or []:
                req = e.get("Requires") or []
                p = pvp or "PVPOnly" in self.effect_flags(e.get("Flags") or 0) or (
                    contains_seq(req, PVP_ONLY) and not contains_seq(req, PVE_ONLY))
                walk(e.get("Effect"), p)
                if not p:
                    continue
                for a in e.get("AttribMod") or []:
                    names = [n for n in (self.power_name(x) for x in param_power_names(a.get("Params"))) if n]
                    for _ in range(a["Attrib"].count(execute) if names else 0):
                        x: dict = {"p": names}
                        if "CopyBoosts" in self.mod_flags(a.get("Flags") or []):
                            x["boosts"] = 1
                        out.append(x)

        walk(rec.get("Effect"), False)
        walk(rec.get("ActivationEffect"), False)
        return out

    def _special(self, name: str) -> int | None:
        """@return The offset of the client's special attribute with this name, or None."""
        return next((o for o, a in self.L.attribs.items() if a.get("kind") == "special" and a["name"] == name), None)

    def build_pets(self) -> dict:
        """The pseudo-pets whose damage the client's power info adds to the power that creates them.

        Port of the live client's getTotalDamage pet branch (decompiled; Homecoming's differs from
        the OuroV2 source): an EntCreate mod names its pet's powers through its villain def
        (EntityDef) and its own Power list (_pet_powers). The client counts a pet only when every
        one of those powers is Auto (pet_IsAutoOnly). It runs them with the caster's class when the
        mod is a PseudoPet, else with the mod's Class, else with the villain def's class (a pet with
        none is left out: no class, no tables). The engine (powerinfo.ts) does the rest: each pet
        power's damage times max(1, floor(Duration / its ActivatePeriod)), enhanced only with
        CopyBoosts (Thunderspy's client adds one activation: "plus").

        The file sits beside the version folders (<server data>/pets/<version>.json), so a
        published folder never changes. Nothing here allocates an id or changes core.json, and
        the report's counts are left as they were. Call after build().

        @return {"pets": {creating power: [creation]}, "powers": {pet power: {"type", "ap"?,
            "eff"?, "act"?}}, "classes": {class: {table: index into tables}}, "tables": [values],
            "summary": counts, "plus"?, "names"?, "exec"?}, where a creation is {"p": [pet powers, as the
            client lists them], "def"?: how many of them come from the villain def, "dur"?,
            "boosts"?: 1, "pseudo"?: 1, "cls"?, "hid"?: 1 (the client lists none of it: its mod is
            under a HideFromInfo group and config.Server.pet_skip_hidden)}, in the order of the
            client's template list. "powers" also holds what a pet's powers execute (ExecutePower:
            the pet runs it, and its damage counts). A pet power's mods name granted powers by full
            name ("pwn"), and "names" gives the display name of those the version's own data
            lacks. "exec" lists, per power, the executions its PvP-only groups hold (_pvp_executions;
            what they execute is carried too). "classes" holds a villain class's tables, and only
            those tables of an archetype that core.json lacks. "plus" is the server's client's extra
            activation
            (config.Server.pet_extra), when it has one.
        """
        ent = self._special("EntCreate")
        villains = {v["Name"].lower(): v for v in self.L.villains}
        vclasses = {c["Name"].lower(): c for c in self.L.villain_classes}
        pclasses = {c["Name"].lower(): c for c in self.L.classes}
        skipped: Counter = Counter()

        def creation(a, hidden: bool) -> dict | None:
            par = ent_create_param(a.get("Params"), self.L.ent_create_layout)
            if par is None:
                skipped["no EntCreate params"] += 1
                return None
            vdef = villains.get(par["EntityDef"].lower()) if par["EntityDef"] else None
            if par["EntityDef"] and vdef is None:
                skipped["unknown villain def"] += 1
            names, from_def = self._pet_powers(par, vdef)
            if not names:
                skipped["no powers"] += 1
                return None
            if any(self.enum("power.Type", self.pw[n]["Type"]) != "Auto" for n in names):
                skipped["not auto only (a real pet)"] += 1
                return None
            flags = set(self.mod_flags(a.get("Flags") or []))
            o: dict = {"p": names}
            if from_def:
                o["def"] = from_def
            if hidden and config.SERVER.pet_skip_hidden:
                o["hid"] = 1
            if a.get("Duration"):
                o["dur"] = num(a["Duration"])
            if "CopyBoosts" in flags:
                o["boosts"] = 1
            if "PseudoPet" in flags:
                o["pseudo"] = 1
                return o
            c = par["Class"].lower()
            cls = (vclasses.get(c) or pclasses.get(c)) if c else None
            if cls is None and vdef is not None:
                cls = vclasses.get(vdef["Class"].lower())
            if cls is None:
                skipped["no class"] += 1
                return None
            o["cls"] = cls["Name"]
            return o

        execute = self._special("ExecutePower")
        grants = {o for o in (self._special("GrantPower"), self._special("GrantBoostedPower")) if o is not None}
        pets: dict[str, list] = {}
        # every power the file carries: a pet's powers, what they execute, and what a dropped
        # PvP-only group executes
        pet_names: set[str] = set()
        dropped: dict[str, list] = {}  # power -> the executions its dropped PvP-only groups hold
        frontier: list[str] = []
        seen: set[str] = set()

        def carry(name: str) -> None:
            if name not in pet_names:
                pet_names.add(name)
                frontier.append(name)

        def visit(name: str) -> None:
            if name in seen:
                return
            seen.add(name)
            rec = self.pw[name]
            if ent is not None:
                made = [c for c in (creation(a, h) for a, h in self.client_templates(rec)
                                    if ent in a["Attrib"]) if c]
                if made:
                    pets[name] = made
                    for c in made:
                        for p in c["p"]:
                            carry(p)
            if execute is not None:
                found = self._pvp_executions(rec, execute)
                if found:
                    dropped[name] = found
                    for x in found:
                        for t in x["p"]:
                            carry(t)

        def targets(rec: dict, attribs: set) -> list[str]:
            """@return The powers a power's grant-style mods on these attributes name (resolved)."""
            out = []
            for a in self.walk_mods(rec):
                if set(a["Attrib"]) & attribs:
                    out += [n for n in (self.power_name(x) for x in param_power_names(a.get("Params"))) if n]
            return out

        for name in sorted(self.exported_names):
            visit(name)
        while frontier:  # a carried power may make pets, or execute powers that run with it
            n = frontier.pop()
            visit(n)
            for t in targets(self.pw[n], {execute} if execute is not None else set()):
                carry(t)

        kept_tables, kept_pvp = set(self.used_tables), self.report["pvp_effects_dropped"]
        kept_text = Counter(self.report["missing_text"])
        powers: dict[str, dict] = {}
        tables: set[str] = set()
        for n in sorted(pet_names):
            r = self.pw[n]
            o = {"type": self.enum("power.Type", r["Type"])}
            if r.get("ActivatePeriod"):
                o["ap"] = num(r["ActivatePeriod"])
            for src, dst in (("Effect", "eff"), ("ActivationEffect", "act")):
                effs = self.conv_effects(r.get(src), ids=False)
                if effs:
                    o[dst] = effs
            powers[n] = o
            tables.update(a["Table"].lower() for a in self.walk_mods(r) if a.get("Table"))
        # what a pet's power grants, by name, when the version's own data lacks it ("Grants power X")
        names = {t: self.text(self.pw[t].get("DisplayName") or "") for n in pet_names
                 for t in targets(self.pw[n], grants) if t not in self.exported_names}
        names = {t: dn for t, dn in sorted(names.items()) if dn}
        self.used_tables, self.report["pvp_effects_dropped"] = kept_tables, kept_pvp
        self.report["missing_text"] = kept_text

        pool: dict[tuple, int] = {}
        pool_list: list[list] = []
        classes: dict[str, dict] = {}

        def add(c: dict, skip: set[str]) -> None:
            got = {}
            for mt in c["ModTable"]:
                k = mt["Name"].lower()
                if k in tables and k not in skip:
                    vals = tuple(num(x) for x in mt["Values"])
                    if vals not in pool:
                        pool[vals] = len(pool_list)
                        pool_list.append(list(vals))
                    got[k] = pool[vals]
            if got:
                classes[c["Name"]] = dict(sorted(got.items()))

        made = [c for cs in pets.values() for c in cs]
        for name in sorted({c["cls"] for c in made if "cls" in c}):
            if name.lower() in vclasses:
                add(vclasses[name.lower()], set())
            else:
                add(pclasses[name.lower()], kept_tables)  # an archetype: core.json has the rest
        if any(c.get("pseudo") for c in made):
            for c in self.L.classes:  # a PseudoPet runs with its caster's class, any archetype
                if c["Name"] not in classes:
                    add(c, kept_tables)
        extra = {"plus": config.SERVER.pet_extra} if config.SERVER.pet_extra else {}
        if names:
            extra["names"] = names
        if dropped:
            extra["exec"] = dict(sorted(dropped.items()))
        return {**extra, "pets": dict(sorted(pets.items())), "powers": powers,
                "classes": dict(sorted(classes.items())), "tables": pool_list,
                "summary": {"creators": len(pets), "pets": len(made), "powers": len(powers),
                            "pet_powers": len({p for c in made for p in c["p"]}), "exec": len(dropped),
                            "classes": len(classes), "skipped": dict(sorted(skipped.items())),
                            "no_entcreate": ent is None}}

    # ---- archetypes ---------------------------------------------------------------------------
    def info_tree(self, effs, keep_pvp: bool = False) -> list:
        """Each mod's own note (Messages.DisplayInfo, translated), laid out as conv_effects lays out
        the groups: one entry per group it keeps, in order.

        @param effs The decoded groups.
        @param keep_pvp As conv_effects.
        @return One entry per kept group: {"m": [note or None per mod]?, "s": [entries]?}, or None
            when neither it nor a group in it has a note.
        """
        out: list = []
        for e in effs or []:
            if self.pvp_only(e, keep_pvp):
                continue
            mods = e.get("AttribMod") or []
            sub = self.info_tree(e.get("Effect"), keep_pvp)
            if not mods and not sub:
                continue  # conv_effects keeps no group without mods or kept sub-groups
            notes = [self.text((a.get("Messages") or {}).get("DisplayInfo") or "") or None for a in mods]
            node: dict = {}
            if any(notes):
                node["m"] = notes
            if any(x is not None for x in sub):
                node["s"] = sub
            out.append(node or None)
        return out

    def _attr_names(self) -> dict:
        """@return {offset: text}: each attribute's name as the client's power info writes it, the
        message "Attr" + its field name (an array element as "DamageType[0]"), for those it has."""
        out = {}
        for off, a in sorted(self.L.attribs.items()):
            for name in [a["name"], *a.get("aliases", [])]:
                m = re.fullmatch(r"([A-Za-z_]+?)(\d\d)", name)
                field = f"{m.group(1)}[{int(m.group(2))}]" if m else name
                text = self.M.get(f"Attr{field}")
                if text:
                    out[str(off)] = text
                    break
        return out

    def build_info(self, powers: list[dict], pet_powers: dict) -> dict:
        """The power-info extras of a version: what the client's power info reads from fields the
        version's own files don't carry (<server data>/info/<version>.json).

        1. notes: per power (the version's own and its pets file's), each mod's own note
           (DisplayInfo: "Within 20ft radius", "Main Target Only"), laid out as its groups.
        2. groups: on a server whose client lists PvP-only groups (Server.info_lists_pvp), the
           groups of each power with a group only its PVPOnly flag makes PvP-only, that one kept
           (granted powers by name).
        3. hiddenGrants: the granted powers whose grant the client doesn't list (ShowInInventory 0).
        4. aggro: per power, the "Aggro Type" row's text (AIReport 1 or 2).
        5. attr: the attribute names; text: the client's texts for the notes the planner writes.

        A power's notes and groups are only written when its groups, made again here, are the very
        groups the version's files hold, so a note can never land on another mod.

        @param powers The version's power records as written (powers.json, boosts.json).
        @param pet_powers Its pets file's "powers".
        @return The file, with a "summary".
        """
        notes: dict = {}
        groups: dict = {}
        mismatched: list[str] = []
        lists_pvp = config.SERVER.info_lists_pvp
        for name, out, ids in ([(p["n"], p, True) for p in powers]
                               + [(n, p, False) for n, p in sorted(pet_powers.items())]):
            rec = self.pw.get(name)
            if rec is None:
                continue
            made = (self.conv_effects(rec.get("Effect"), ids), self.conv_effects(rec.get("ActivationEffect"), ids))
            if made != (out.get("eff") or [], out.get("act") or []):
                mismatched.append(name)
                continue
            keep = lists_pvp and any(self.pvp_flag(e) and not self.pvp_only(e, True) for e in self._all_groups(rec))
            if keep:
                full = {k: v for k, v in (("eff", self.conv_effects(rec.get("Effect"), False, True)),
                                          ("act", self.conv_effects(rec.get("ActivationEffect"), False, True))) if v}
                groups[name] = full
            tree = {k: v for k, v in (("e", self.info_tree(rec.get("Effect"), keep)),
                                      ("a", self.info_tree(rec.get("ActivationEffect"), keep)))
                    if any(x is not None for x in v)}
            if tree:
                notes[name] = tree
        hidden = set()
        for name in [*(p["n"] for p in powers), *pet_powers]:
            for e in self._all_groups(self.pw.get(name) or {}):
                for a in e.get("AttribMod") or []:
                    if set(a["Attrib"]) & self.grant_attribs:
                        for n in param_power_names(a.get("Params")):
                            g = self.pw.get(self.power_name(n) or "")
                            if g is not None and not g.get("ShowInInventory"):
                                hidden.add(g["FullName"])
        aggro = {}
        for p in powers:
            rep = (self.pw.get(p["n"]) or {}).get("AIReport")
            if rep in (1, 2):
                key = "HitAggro" if rep == 2 and config.SERVER.hit_aggro else "NoAggro"
                if self.M.get(key):
                    aggro[p["n"]] = self.M[key]
        text = {k: self.M[k] for k in ("Unresistable", "IgnoresBuffsAndEnhancements", "AggroReport") if self.M.get(k)}
        out = {"notes": notes, "hiddenGrants": sorted(hidden), "aggro": aggro, "attr": self._attr_names(), "text": text}
        if groups:
            out["groups"] = groups
        out["summary"] = {"notes": len(notes), "groups": len(groups), "hidden_grants": len(hidden),
                          "aggro": len(aggro), "mismatched": mismatched}
        return out

    @staticmethod
    def _all_groups(rec: dict):
        """@return Every effect group of a decoded power, its activation effects too, nested ones included."""
        def walk(effs):
            for e in effs or []:
                yield e
                yield from walk(e.get("Effect"))
        yield from walk(rec.get("Effect"))
        yield from walk(rec.get("ActivationEffect"))

    @staticmethod
    def compact_attr_table(rows) -> dict:
        """[{attr: [per-level values]}] -> {attr: value | [values]} with constant arrays collapsed."""
        if not rows:
            return {}
        out = {}
        for k, v in rows[0].items():
            if isinstance(v, list):
                vals = [num(x) for x in v]
                if not vals:
                    continue
                out[k] = vals[0] if all(x == vals[0] for x in vals) else vals
            elif v:
                out[k] = num(v)
        return out

    def conv_classes(self):
        pool: dict[tuple, int] = {}
        pool_list: list[list] = []
        out = []
        for c in self.L.classes:
            tables = {}
            for mt in c["ModTable"]:
                if mt["Name"].lower() not in self.used_tables:
                    continue
                vals = tuple(num(x) for x in mt["Values"])
                if vals not in pool:
                    pool[vals] = len(pool_list)
                    pool_list.append(list(vals))
                tables[mt["Name"].lower()] = pool[vals]
            cc = self.class_cats[c["Name"]]
            out.append({
                "id": self.ids.get("archetype", c["Name"]), "n": c["Name"],
                "dn": self.text(c["DisplayName"]), "sh": self.text(c["DisplayShortHelp"]),
                "lh": self.text(c["DisplayHelp"]),
                "icon": c["Icon"].rsplit(".", 1)[0] if c["Icon"] else "",
                "cats": cc,
                "base": self.compact_attr_table(c["AttribBase"]),
                "min": self.compact_attr_table(c["AttribMin"]),
                "strMin": self.compact_attr_table(c["StrengthMin"]),
                "resMin": self.compact_attr_table(c["ResistanceMin"]),
                "max": self.compact_attr_table(c["AttribMaxTable"]),
                "maxMax": self.compact_attr_table(c["AttribMaxMaxTable"]),
                "strMax": self.compact_attr_table(c["StrengthMaxTable"]),
                "resMax": self.compact_attr_table(c["ResistanceMaxTable"]),
                "mod": tables,
            })
        return out, pool_list

    # ---- main ---------------------------------------------------------------------------------
    def build(self) -> dict:
        self.scope()
        powers_by_name = {}
        for name in self.export_powers:
            powers_by_name[name] = self.conv_power(name)
        self.exported_names = set(powers_by_name)
        boost_names = {self.power_name(b) for b in self.boost_powers if self.power_name(b)}
        bonus_names = {n for n in self.export_powers if n.lower().startswith("set_bonus.")}
        exported_ids = {p["id"] for p in powers_by_name.values()}
        sets = [self.conv_set(s) for s in self.export_sets]
        boostsets = [self.conv_boostset(bs, exported_ids) for bs in self.L.boostsets]
        archetypes, mod_pool = self.conv_classes()

        an = self.L.attrib_names
        attr_names = {k: [{"n": x["Name"], "dn": self.text(x["DisplayName"]) or x["DisplayName"],
                           "icon": x.get("IconName", "")} for x in an[k]]
                      for k in ("Damage", "Defense", "Boost", "Elusivity", "Group")}
        # power modes (SetMode's magnitude indexes this list; requires test them as k<Name>,
        # e.g. Bio Armor's "kDefensiveAdaptation Source.Mode?")
        attr_names["Mode"] = [{"n": x["Name"], "dn": x["Name"], "icon": ""} for x in an["Mode"]]
        origins = [{"id": self.ids.get("origin", o["Name"]), "n": o["Name"],
                    "dn": self.text(o["DisplayName"]), "sh": self.text(o["DisplayShortHelp"]),
                    "lh": self.text(o["DisplayHelp"]),
                    "icon": o["Icon"].rsplit(".", 1)[0] if o["Icon"] else ""}
                   for o in self.L.origins]
        dim = [{"default": d["Default"], "boost": d["Boost"],
                "sets": [{"default": s["Default"], "a": s["Attrib"],
                          "ret": [{"start": num(r["Start"]), "h": num(r["Handicap"])}
                                  for r in s["Return"]]} for s in d["AttribReturnSet"]]}
               for d in self.L.dim_returns]
        sched = self.L.schedules
        core = {
            "archetypes": archetypes,
            "modTables": mod_pool,
            "origins": origins,
            "attribs": {str(k): v for k, v in sorted(self.L.attribs.items())},
            "attribNames": attr_names,
            "categories": {c: [self.ids.get("powerset", s) for s in self.cats[c.lower()]["PowerSets"]
                               if s in self.sets]
                           for c in self.player_cats},
            "schedule": {"power": sched["Power"], "slot": sched["AssignableBoost"],
                         "pool": sched["PoolPowerSet"], "epic": sched["EpicPowerSet"],
                         "freeSlots": sched["FreeBoostSlotsOnPower"]},
            "dimReturns": dim,
            "boostEffect": {k: [num(x) for x in v] for k, v in self.L.boost_effect.items()},
            "exemplar": {k: [num(x) for x in v] for k, v in self.L.exemplar.items()},
        }
        powers = [p for n, p in powers_by_name.items() if n not in boost_names and n not in bonus_names]
        # each enhancement's category line (its Boosts.* set's short help: "Invention",
        # "Training (All Origins)", "Set: Apocalypse", ...) for the enhancement tooltip
        for n in boost_names:
            pset = self.sets.get(n.rsplit(".", 1)[0])
            cat = self.text(pset.get("DisplayShortHelp", "")) if pset else ""
            if cat and n in powers_by_name:
                powers_by_name[n]["cat"] = cat
        boosts = {"boosts": [powers_by_name[n] for n in sorted(boost_names) if n in powers_by_name],
                  "bonusPowers": [powers_by_name[n] for n in sorted(bonus_names)],
                  "sets": boostsets}
        return {"core": core, "powersets": sets, "powers": powers, "boosts": boosts}


def info_powers(built: dict) -> list[dict]:
    """@return The power records of a version (Exporter.build's, or its files') whose info is shown:
    its powers, enhancements and set bonuses."""
    return [*built["powers"], *built["boosts"]["boosts"], *built["boosts"]["bonusPowers"]]


def utc_now() -> str:
    """@return The current UTC time as 'YYYY-MM-DDTHH:MM:SSZ'."""
    return dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _dump(obj) -> str:
    return json.dumps(obj, separators=(",", ":"), ensure_ascii=False)


def content_hash(core: dict, others: list[str]) -> str:
    """12-hex hash of the four data files as written (core.json without its own manifest.hash).

    @param core core.json content (the manifest.hash key is ignored).
    @param others Serialized powersets, powers and boosts JSON text, in that order.
    """
    c = dict(core)
    m = dict(c["manifest"])
    m.pop("hash", None)
    c["manifest"] = m
    h = hashlib.sha1()
    for text in [_dump(c)] + others:
        h.update(text.encode("utf-8"))
    return h.hexdigest()[:12]


def newest_mids_map(exclude) -> "Path | None":
    """@return The newest mids-map.json in another version folder of this server, or None."""
    found = [p for p in config.DATA_OUT.glob("*/mids-map.json") if p.parent.resolve() != exclude.resolve()]
    return max(found, key=lambda p: p.stat().st_mtime) if found else None


def donor_of(donor: str) -> tuple[str, Path]:
    """The server and data folder --frames-from names: "<version>" or "<server>/<version>".

    @param donor The flag's value ("i28p4", "homecoming/i28p4").
    @return (server id, the version folder); a bare version is the selected server's.
    @raise SystemExit For a server the pipeline doesn't know or an invalid version id.
    """
    server, _, version = donor.rpartition("/")
    if (server and server not in config.SERVERS) or not config.valid_version_id(version):
        raise SystemExit(f"error: --frames-from {donor}: expected <version> or <server>/<version>")
    server = server or config.SERVER.id
    return server, config.data_dir(server) / version


def data_rel(*parts: str) -> str:
    """@return A path under the selected server's data folder as messages name it ("public/data/thunderspy/ts9-6")."""
    return "/".join([config.DATA_OUT.relative_to(config.REPO).as_posix(), *parts])


def _frame_flags(b: dict) -> tuple:
    """@return The enhancement property besides its set that picks a frame: attuned (scales with the player's level).

    Catalyst conversion and account binding don't: Homecoming gives every crafted set piece a
    catalyst conversion, Thunderspy none, and Thunderspy binds its superior ATOs to the account.
    """
    return (bool(b.get("bup")),)


def borrow_frames(boosts: list[dict], sets: list[dict], donor: str) -> dict:
    """Give enhancements without frame art the frames the donor version draws for them.

    Clients without frame columns (an older Homecoming, Thunderspy) choose frames in code. The owner
    chose to show the donor's frame art instead (cosmetic only, recorded in the manifest as
    framesFrom):

    1. An enhancement the donor has by the same internal name gets its frames.
    2. Only with a donor on another server (an older version of the same server keeps the frames
       it was published with): a set enhancement the donor lacks gets the pair the donor's set
       enhancements that are attuned as it is (or not) all use for one of its set's conversion
       groups (ECUncommon, ECRare, ECSATO, ...). Only groups that fix a single pair across
       the donor count, and they must agree. On Homecoming's own data this rule picks the right
       pair for every set enhancement it answers (2054, left out one set at a time) and answers all
       but 24.
    3. Anything else keeps no frames.

    @param boosts This version's exported enhancements; changed in place.
    @param sets This version's exported IO sets (slots hold enhancement ids).
    @param donor The donor version: "<version>" or "<server>/<version>".
    @return {"by_name": count, "by_set": count, "none": [names left without frames], "cross": the
        donor is another server's}.
    @raise SystemExit When the donor version has no readable boosts.json.
    """
    donor_server, root = donor_of(donor)
    try:
        src = json.loads((root / "boosts.json").read_text(encoding="utf-8"))
    except (OSError, ValueError) as e:
        raise SystemExit(f"error: --frames-from {donor}: no readable boosts.json there ({e})")
    frames = {b["n"]: b["bf"] for b in src.get("boosts", []) if b.get("bf")}
    # (conversion group, flags) -> every frame pair the donor's set enhancements show for it
    dby = {b["id"]: b for b in src.get("boosts", [])}
    by_group: dict[tuple, set] = {}
    for s in src.get("sets", []):
        for pid in (p for slot in s["slots"] for p in slot):
            b = dby.get(pid)
            if b and b.get("bf"):
                for c in s["conv"]:
                    by_group.setdefault((c, _frame_flags(b)), set()).add(tuple(b["bf"]))
    set_of = {pid: s for s in sets for slot in s["slots"] for pid in slot}
    if donor_server == config.SERVER.id:
        set_of = {}  # same server (however the flag names it): by name only
    res: dict = {"by_name": 0, "by_set": 0, "none": [], "cross": donor_server != config.SERVER.id}
    for b in boosts:
        if "bf" in b:
            continue
        if b["n"] in frames:
            b["bf"] = frames[b["n"]]
            res["by_name"] += 1
            continue
        s = set_of.get(b["id"])
        picks = set()
        for c in (s["conv"] if s else []):
            pairs = by_group.get((c, _frame_flags(b)), set())
            if len(pairs) == 1:
                picks |= pairs
        if len(picks) == 1:
            b["bf"] = list(picks.pop())
            res["by_set"] += 1
        else:
            res["none"].append(b["n"])
    return res


def write(live: LiveData, version: str, frames_from: str | None = None, *,
          overwrite_published: bool = False, refresh_mids_map: bool = False,
          assets: bool = True, add_only_icons: bool = False) -> dict:
    """Export the data set for game version `version` and return a summary for the report.

    Order: build in memory (pseudo-pets too; the Mids map and another server's icon names with
    their failures tolerated), check the folder may be written, save the ids file, write another server's
    icons, then write the data files and the version's pseudo-pet file (<server data>/pets/
    <version>.json, beside the folder: it is not part of the version hash) atomically. Nothing is
    written before the check. The version index files are written afterwards by write_indexes().

    A version folder already made from a different client (other exe or pigg hashes) is refused
    unless `overwrite_published`: share links made on that patch load it, so a run that forgot
    --game-version after a patch, or that points at another client copy, must not replace it. An
    existing folder's mids-map.json is kept unless `refresh_mids_map`: old Mids codes depend on it,
    and its contents aren't part of the version hash that busts browser caches.

    @param live The decoded client.
    @param version Game version id (the data folder name).
    @param frames_from Version to borrow enhancement frames from when the client has none.
    @param overwrite_published Replace a folder made from a different client.
    @param refresh_mids_map Replace an existing folder's mids-map.json.
    @param assets Write another server's icon files (--no-assets: names only).
    @param add_only_icons Write only icon files the server's folder lacks (an older version).
    @raise SystemExit When the folder was made from a different client and overwriting wasn't asked.
    """
    ex = Exporter(live)          # refuses to run if the ids file is gone while data exists
    out = ex.build()
    pets = ex.build_pets()       # beside the version folder; changes nothing build() made
    warnings: list[str] = forced_respec_warnings(live.classes, ex.class_cats, ex.cats, ex.sets)
    frames: dict | None = None
    if ex.report["no_frames"]:
        if frames_from:
            frames = borrow_frames(out["boosts"]["boosts"], out["boosts"]["sets"], frames_from)
            got = frames["by_name"] + frames["by_set"]
            left = len(frames["none"])
            # a same-server donor reads as it always did (older versions' committed reports)
            by_set = f" ({frames['by_set']} matched by set type)" if frames["cross"] else ""
            warnings.append(f"NOTE: this client has no enhancement frame data; {got} enhancements "
                            f"show {frames_from}'s frames{by_set}" + (f", {left} have none" if left else ""))
        else:
            warnings.append(f"WARNING: this client has no enhancement frame data; {ex.report['no_frames']} "
                            "enhancements have no frames (pass --frames-from <version> to borrow them)")
    elif frames_from:
        warnings.append(f"NOTE: --frames-from {frames_from} ignored: this client has its own frame data")
    icon_plan = None
    if not config.SERVER.shared_assets:
        # another server's data names its own icons "<server>:<name>": decided before anything is
        # hashed, written once the checks below pass
        from pipeline.assets import export_assets
        icon_plan = export_assets.plan_icon_overlay(out, config.SERVER.id)
    mids_text = None
    if not config.SERVER.mids:
        mids = {"none": True}  # no Mids database for this server: no map, and never another server's
    else:
        try:
            from pipeline import mids_map
            _m, mids = mids_map.prepare(live, ex)
            mids_text = mids.pop("text", None)
        except Exception as e:  # noqa: BLE001 -- Mids is an untrusted reference; never fail the run
            mids = {"skipped": f"Mids map failed: {type(e).__name__}: {e}"}
            warnings.append(f"WARNING: Mids map skipped ({type(e).__name__}: {e})")
        if mids.get("skipped") and not any("Mids map" in w for w in warnings):
            warnings.append(f"WARNING: Mids map skipped ({mids['skipped']})")

    root = config.DATA_OUT / version
    source = {"exe": sha1(config.EXE), "bin.pigg": sha1(config.BIN_PIGG),
              "bin_powers.pigg": sha1(config.POWERS_PIGG)}
    # nothing is written yet: a folder made from another client stops the run here
    old = None
    try:
        old = json.loads((root / "core.json").read_text(encoding="utf-8"))["manifest"]
    except (OSError, ValueError, KeyError):
        pass
    if old and old.get("source") and old["source"] != source:
        if not overwrite_published:
            raise SystemExit(
                f"error: {data_rel(version)} was made from a different client (exe or pigg hashes "
                "differ). A new patch needs a new --game-version; to replace this published folder "
                "on purpose, pass --overwrite-published. Nothing was written.")
        warnings.append(f"WARNING: {data_rel(version)} was made from a different client and was "
                        "replaced (--overwrite-published)")
    # the frame art a published folder shows is part of it: a re-run borrows from the same donor
    new_frames = frames_from if frames and frames["by_name"] + frames["by_set"] else None
    if old and old.get("framesFrom") != new_frames:
        was = old.get("framesFrom")
        flag = f"--frames-from {was}" if was else "no --frames-from"
        if not overwrite_published:
            raise SystemExit(
                f"error: {data_rel(version)} was published with "
                + (f"{was}'s enhancement frames" if was else "no borrowed enhancement frames")
                + "; this run would " + (f"use {new_frames}'s" if new_frames else "leave them out")
                + f". Re-run with {flag}, or pass --overwrite-published to change it on purpose. "
                "Nothing was written.")
        warnings.append(f"WARNING: {data_rel(version)}'s enhancement frames changed (was {flag}; "
                        "--overwrite-published)")

    ex.ids.save()                # ids first, so a crash later never loses allocations
    if icon_plan is not None:
        if assets:
            icon_plan["summary"]["written"] = export_assets.write_icon_overlay(icon_plan, add_only_icons)
        else:
            warnings.append("WARNING: --no-assets: this server's icon files were not written; its "
                            "data names them, so run again without --no-assets before committing")

    manifest = {
        "dataVersion": version,
        "generated": utc_now(),
        "source": source,
        "counts": {"archetypes": len(out["core"]["archetypes"]),
                   "powersets": len(out["powersets"]), "powers": len(out["powers"]),
                   "boosts": len(out["boosts"]["boosts"]),
                   "bonusPowers": len(out["boosts"]["bonusPowers"]),
                   "boostsets": len(out["boosts"]["sets"])},
        "files": ["core.json", "powersets.json", "powers.json", "boosts.json"],
    }
    if frames and frames["by_name"] + frames["by_set"]:
        manifest["framesFrom"] = frames_from  # enhancement frame art borrowed from that version
    out["core"]["manifest"] = manifest
    texts = {n: _dump(out[n]) for n in ("powersets", "powers", "boosts")}
    others = [texts["powersets"], texts["powers"], texts["boosts"]]
    # no churn: if the content hash matches what is on disk, keep its generated timestamp
    if old and old.get("generated"):
        manifest["generated"] = old["generated"]
        if old.get("hash") != content_hash(out["core"], others):
            manifest["generated"] = utc_now()
    manifest["hash"] = content_hash(out["core"], others)
    texts["core"] = _dump(out["core"])
    sizes = {}
    for name in ("core", "powersets", "powers", "boosts"):
        config.atomic_write(root / f"{name}.json", texts[name])
        sizes[name] = len(texts[name].encode("utf-8"))

    pets_summary = write_pets(pets, version)
    warnings += pet_warnings(pets_summary)
    info_summary = write_info(ex.build_info(info_powers(out), pets["powers"]), version)
    warnings += info_warnings(info_summary)

    mids_path = root / "mids-map.json"
    if not config.SERVER.mids:
        pass  # no Mids database for this server
    elif mids_text is not None and mids_path.exists() and not refresh_mids_map:
        if mids_path.read_text(encoding="utf-8") != mids_text:
            warnings.append(f"NOTE: kept {version}'s existing mids-map.json (the Mids data gives a "
                            "different map; pass --refresh-mids-map to replace it)")
    elif mids_text is not None:
        config.atomic_write(mids_path, mids_text)
    elif not mids_path.exists():
        prev = newest_mids_map(root)
        if prev is not None:
            config.atomic_write(mids_path, prev.read_bytes())
            mids["carried_from"] = prev.parent.name
            warnings.append(f"WARNING: mids-map.json was carried forward from {prev.parent.name}; "
                            "it may be stale")
        else:
            warnings.append("WARNING: no mids-map.json exists in any version folder; "
                            "Mids import/export will not work until the Mids map is built")
    return {"manifest": manifest, "sizes": sizes, "report": ex.report, "ids_added": ex.ids.added,
            "mids": mids, "warnings": warnings, "version": version, "root": root, "frames": frames,
            "icons": icon_plan["summary"] if icon_plan else None, "pets": pets_summary,
            "info": info_summary}


def write_pets(pets: dict, version: str) -> dict:
    """Write a version's pseudo-pet file, <server data>/pets/<version>.json (Exporter.build_pets).

    @param pets build_pets()'s result; its summary is taken out of it.
    @param version Game version id.
    @return The summary, with the file's size ("bytes").
    """
    summary = pets.pop("summary")
    text = _dump(pets)
    config.atomic_write(config.DATA_OUT / config.PETS_FOLDER / f"{version}.json", text)
    summary["bytes"] = len(text.encode("utf-8"))
    return summary


def write_info(info: dict, version: str) -> dict:
    """Write a version's power-info extras, <server data>/info/<version>.json (Exporter.build_info).

    @param info build_info()'s result; its summary is taken out of it.
    @param version Game version id.
    @return The summary, with the file's size ("bytes").
    """
    summary = info.pop("summary")
    text = _dump(info)
    config.atomic_write(config.DATA_OUT / config.INFO_FOLDER / f"{version}.json", text)
    summary["bytes"] = len(text.encode("utf-8"))
    return summary


def info_warnings(summary: dict) -> list[str]:
    """@return What a power-info export should tell the owner: powers whose groups differ from the
    version's files, so they got no notes."""
    bad = summary["mismatched"]
    if not bad:
        return []
    return [f"WARNING: {len(bad)} powers' groups differ from the version's files (pipeline changed since "
            f"it was made?); they get no notes: {', '.join(bad[:5])}{' ...' if len(bad) > 5 else ''}"]


def pet_warnings(summary: dict) -> list[str]:
    """What a pseudo-pet export should tell the owner about the client it read.

    The pet rules (config.Server.pet_extra, the engine's petDamage) come from reading each client's
    code, so a client exe no one has read gets a warning, as does an EntCreate param layout that
    reads none of the client's pet mods.

    @param summary build_pets()'s summary.
    @return Report lines.
    """
    out = []
    if summary["no_entcreate"]:
        out.append("WARNING: the client names no EntCreate attribute; no pseudo-pet damage")
    bad = summary["skipped"].get("no EntCreate params", 0)
    if bad:
        out.append(f"WARNING: {bad} EntCreate mods have Params this client's EntCreate param layout "
                   "doesn't read; their pets are left out (check LiveData.ent_create_layout)")
    exe = sha1(config.EXE)
    if exe not in config.SERVER.pet_checked:
        out.append(f"WARNING: no one has read this client's pseudo-pet rules (exe {exe}): check its "
                   "getTotalDamage and power_AddEffects (docs/game-rules.md, \"Pseudo-pet damage\"), "
                   "then add the hash to pet_checked (and pet_extra if it changed) in pipeline/config.py")
    return out


def write_indexes(version: str, label: str, content_hash_: str, make_default: bool, extra: dict | None = None) -> str:
    """Upsert this version into public/data/versions.json and refresh latest.json (written last).

    @param version Game version id (the data folder name).
    @param label Human-readable label.
    @param content_hash_ manifest.hash of this version.
    @param make_default Make this version the default even if versions.json already exists.
    @param extra More fields for this version's entry (an approximate version's patch and flag).
    @return The default version id.
    """
    vpath = config.DATA_OUT / "versions.json"
    try:
        idx = json.loads(vpath.read_text(encoding="utf-8"))
        if not isinstance(idx.get("versions"), list):
            raise ValueError("no versions list")
        new_file = False
    except OSError:
        idx, new_file = {"default": version, "versions": []}, True
    except ValueError as e:
        raise SystemExit(f"error: {data_rel('versions.json')} is unreadable ({e}); fix or remove it")
    entry = {"id": version, "label": label, "hash": content_hash_, **(extra or {})}
    for i, v in enumerate(idx["versions"]):
        if v.get("id") == version:
            idx["versions"][i] = entry
            break
    else:
        idx["versions"].append(entry)
    if new_file or make_default or not idx.get("default"):
        idx["default"] = version
    config.atomic_write(vpath, json.dumps({"default": idx["default"], "versions": idx["versions"]}, indent=2) + "\n")
    config.atomic_write(config.DATA_OUT / "latest.json", json.dumps({"dataVersion": idx["default"]}))
    return idx["default"]
