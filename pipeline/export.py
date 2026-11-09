"""Turn the raw live decode into the compact JSON the site loads.

Output: public/data/<gameVersion>/{core,powersets,powers,boosts,mids-map}.json, then
public/data/versions.json and latest.json (last).
Only player-reachable data is exported: the 15 archetypes' primary/secondary categories, Pool,
Epic and Inherent sets, every enhancement (Boosts.*) and IO set, the set-bonus powers they grant,
and anything those powers redirect to or grant. PvP-only effects are dropped (PvP is out of v1).
"""
from __future__ import annotations

import datetime as dt
import hashlib
import json
from pathlib import Path
from collections import Counter

from pipeline import config
from pipeline.coh.p7reader import param_power_names
from pipeline.decode.live import LiveData, sha1
from pipeline.ids import IdRegistry

GRANT_ATTRIBS = {481, 482, 486, 512}  # kGrantPower, kRevokePower, kGrantBoostedPower, kExecutePower
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
        self.report: dict = {"missing_text": Counter(), "unresolved_refs": Counter(),
                             "pvp_effects_dropped": 0}
        self.used_tables: set[str] = set()

    # ---- helpers ------------------------------------------------------------------------------
    def text(self, key: str) -> str:
        if not key:
            return ""
        t = self.M.get(key)
        if t is None:
            self.report["missing_text"][key[:1] if key.startswith("P") else "other"] += 1
            return ""
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
                if set(a["Attrib"]) & GRANT_ATTRIBS:
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
    def conv_mod(self, a) -> dict:
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
        if set(a["Attrib"]) & GRANT_ATTRIBS:
            names = param_power_names(a["Params"])
            o["pw"] = [self.ids.get("power", self.power_name(n)) for n in names
                       if self.power_name(n)]
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

    def conv_effects(self, effs) -> list:
        out = []
        for e in effs or []:
            req = e.get("Requires") or []
            eflags = self.effect_flags(e.get("Flags") or 0)
            pvp = "PVPOnly" in eflags or (contains_seq(req, PVP_ONLY)
                                          and not contains_seq(req, PVE_ONLY))
            if pvp:
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
            mods = [self.conv_mod(a) for a in e.get("AttribMod") or []]
            if mods:
                o["m"] = mods
            sub = self.conv_effects(e.get("Effect"))
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
            o["bf"] = [r["BoostFrameLeft"], r["BoostFrameRight"]]
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

    # ---- archetypes ---------------------------------------------------------------------------
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
    """@return The newest mids-map.json in a version folder other than `exclude`, or None."""
    found = [p for p in config.DATA_OUT.glob("*/mids-map.json") if p.parent.resolve() != exclude.resolve()]
    return max(found, key=lambda p: p.stat().st_mtime) if found else None


def write(live: LiveData, version: str) -> dict:
    """Export the data set for game version `version` and return a summary for the report.

    Order: build in memory (Mids map included, failures tolerated), save ids.json, then write the
    data files atomically. The version index files are written afterwards by write_indexes().
    """
    ex = Exporter(live)          # refuses to run if ids.json is gone while data exists
    out = ex.build()
    warnings: list[str] = []
    mids_text = None
    try:
        from pipeline import mids_map
        _m, mids = mids_map.prepare(live, ex)
        mids_text = mids.pop("text", None)
    except Exception as e:  # noqa: BLE001 -- Mids is an untrusted reference; never fail the run
        mids = {"skipped": f"Mids map failed: {type(e).__name__}: {e}"}
        warnings.append(f"WARNING: Mids map skipped ({type(e).__name__}: {e})")
    if mids.get("skipped") and not any("Mids map" in w for w in warnings):
        warnings.append(f"WARNING: Mids map skipped ({mids['skipped']})")

    ex.ids.save()                # ids first, so a crash later never loses allocations

    root = config.DATA_OUT / version
    manifest = {
        "dataVersion": version,
        "generated": utc_now(),
        "source": {"exe": sha1(config.EXE), "bin.pigg": sha1(config.BIN_PIGG),
                   "bin_powers.pigg": sha1(config.POWERS_PIGG)},
        "counts": {"archetypes": len(out["core"]["archetypes"]),
                   "powersets": len(out["powersets"]), "powers": len(out["powers"]),
                   "boosts": len(out["boosts"]["boosts"]),
                   "bonusPowers": len(out["boosts"]["bonusPowers"]),
                   "boostsets": len(out["boosts"]["sets"])},
        "files": ["core.json", "powersets.json", "powers.json", "boosts.json"],
    }
    out["core"]["manifest"] = manifest
    texts = {n: _dump(out[n]) for n in ("powersets", "powers", "boosts")}
    others = [texts["powersets"], texts["powers"], texts["boosts"]]
    # no churn: if the content hash matches what is on disk, keep its generated timestamp
    old = None
    try:
        old = json.loads((root / "core.json").read_text(encoding="utf-8"))["manifest"]
    except (OSError, ValueError, KeyError):
        pass
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

    mids_path = root / "mids-map.json"
    if mids_text is not None:
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
            "mids": mids, "warnings": warnings, "version": version, "root": root}


def write_indexes(version: str, label: str, content_hash_: str, make_default: bool) -> str:
    """Upsert this version into public/data/versions.json and refresh latest.json (written last).

    @param version Game version id (the data folder name).
    @param label Human-readable label.
    @param content_hash_ manifest.hash of this version.
    @param make_default Make this version the default even if versions.json already exists.
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
        raise SystemExit(f"error: public/data/versions.json is unreadable ({e}); fix or remove it")
    entry = {"id": version, "label": label, "hash": content_hash_}
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
