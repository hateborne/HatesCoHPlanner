"""Difference report: where another server's exported game data differs from Homecoming's.

    python -m pipeline.compare --server thunderspy

reads two exported version folders (Homecoming's default and the server's default; committed data
only, no client needed) and writes pipeline/report-<server>-diff.md: every difference by internal
name, for the owner to spot-check in game. Standard library only.

Ids are per server and some tables are keyed by numbers that mean different things on each, so
both sides are normalised to names before anything is compared:

- power, set, archetype and boost ids become their internal names (ids never meet);
- attribute byte offsets (mod `a`, power `atk`, dimReturns) become attribute names through
  core.attribs, because 35 names sit at other offsets on the two servers (everything after
  Homecoming's TimeToRoot shifts by 4); the generic DamageTypeNN, DefenseTypeNN and ElusivityNN
  become the type's own name (core.attribNames), since the types are numbered per server;
- `Knock` (Homecoming) and `Knockback` (Thunderspy) at offset 328 are one attribute (ALIASES);
- power modes (modr, modd, SetMode's mag) become names through core.attribNames.Mode;
- enhancement boost types (ba, bma) are origin indexes or core.attribNames.Boost names;
- per-level tables are compared over levels 1-50 only (Homecoming's hold 105 levels);
- icons are skipped (Thunderspy's carry a "thunderspy:" prefix).

Levels written in this report are the game's 1-based levels (the data is 0-based).
"""
from __future__ import annotations

import argparse
import json
import math
import re
import unicodedata
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path

from pipeline import config

LEVELS = 50  # per-level tables are compared over the first 50 levels
CAP = 0      # effect lines shown per side for one power (the rest are counted); --effects sets it

# Short report tags of the servers.
TAGS = {"homecoming": "HC", "thunderspy": "TS"}

# One attribute under two names: offset 328 is `Knock` on Homecoming, `Knockback` on Thunderspy.
ALIASES = {"Knock": "Knockback"}
# Generic attribute names that stand for "one per damage type" (the type's list is in core.attribNames).
GENERIC = {"DamageType": "Damage", "DefenseType": "Defense", "Elusivity": "Elusivity"}
_GENERIC_RE = re.compile(r"^(DamageType|DefenseType|Elusivity)(\d\d)$")

# Power fields that are not compared: text, icons, ids, and the effects (compared separately).
SKIP_POWER_FIELDS = frozenset({"id", "n", "dn", "sh", "lh", "icon", "eff", "act"})
# Readable names of the power fields that change most.
FIELD_NAMES = {"acc": "accuracy", "rech": "recharge", "end": "endurance", "cast": "cast time",
               "rng": "range", "rng2": "range2", "rad": "radius", "arc": "arc", "area": "area",
               "maxT": "max targets", "tgt": "target", "ea": "affects", "type": "type",
               "ap": "activation period", "intr": "interrupt time", "na": "uses allowed",
               "maxB": "max boosts", "ba": "boosts allowed", "atk": "attack types",
               "modr": "recharge modes", "modd": "damage modes", "slot": "slot levels",
               "maxBL": "max boost level", "auto": "auto-granted", "free": "free", "sm": "shown in Manage",
               "br": "buy requires", "actr": "activation requires", "slr": "slot requires",
               "gm": "group membership", "rg": "requires group", "redir": "redirects"}


@dataclass
class Side:
    """One server's exported data, indexed by name.

    Built from the four exported JSON files (core, powersets, powers, boosts) of one version folder.
    Every id lookup falls back to a placeholder ("#123") so malformed data still compares.
    """

    label: str   # short tag used in the report ("HC", "TS")
    server: str  # server id
    version: str # game version id
    core: dict
    powersets: list
    powers: list
    boosts: dict
    names: dict = field(default_factory=dict)       # power / enhancement / bonus power id -> name
    sets_by_id: dict = field(default_factory=dict)  # powerset id -> powerset
    power_by_name: dict = field(default_factory=dict)
    power_by_lower: dict = field(default_factory=dict)  # lower-cased name -> power (the servers differ in case)
    bonus_by_name: dict = field(default_factory=dict)

    def __post_init__(self) -> None:
        for p in self.powers:
            self.names[p["id"]] = p["n"]
            self.power_by_name[p["n"]] = p
            self.power_by_lower[p["n"].lower()] = p
        for p in self.boosts.get("boosts", []):
            self.names[p["id"]] = p["n"]
        for p in self.boosts.get("bonusPowers", []):
            self.names[p["id"]] = p["n"]
            self.bonus_by_name[p["n"]] = p
        for s in self.powersets:
            self.sets_by_id[s["id"]] = s

    def power_name(self, pid: int) -> str:
        """@return The internal name of a power, enhancement or bonus power id."""
        return self.names.get(pid, f"#{pid}")

    def attrib(self, off: int) -> str:
        """The canonical name of the attribute at a byte offset (see the module docstring).

        @param off The attribute byte offset.
        @return Its name, with generic per-type names resolved and aliases merged.
        """
        ent = self.core.get("attribs", {}).get(str(off))
        return self.resolve_name(ent["name"]) if ent else f"@{off}"

    def resolve_name(self, raw: str) -> str:
        """The canonical form of an attribute or table column name.

        @param raw A name as the export wrote it ("DamageType05", "Knock", "ToHit").
        @return "DamageType.Fire" style names for the per-type generics, the merged name for aliases,
                else the name unchanged.
        """
        m = _GENERIC_RE.match(raw)
        if m:
            lst = self.core.get("attribNames", {}).get(GENERIC[m.group(1)], [])
            i = int(m.group(2))
            return f"{m.group(1)}.{lst[i]['n']}" if i < len(lst) else f"{m.group(1)}.#{i}"
        return ALIASES.get(raw, raw)

    def attribs(self, offs: list) -> list:
        """@return The sorted canonical names of a list of attribute offsets (duplicates kept)."""
        return sorted(self.attrib(o) for o in offs)

    def mode(self, i: int) -> str:
        """@return The name of a power mode index (core.attribNames.Mode)."""
        lst = self.core.get("attribNames", {}).get("Mode", [])
        return lst[i]["n"] if isinstance(i, int) and 0 <= i < len(lst) else f"mode#{i}"

    def boost_type(self, v: int) -> str:
        """@return The boost type for a BoostsAllowed value: an origin index (below 5) or a Boost name."""
        if v < 5:
            return f"Origin{v}"
        lst = self.core.get("attribNames", {}).get("Boost", [])
        return lst[v - 5]["n"] if v - 5 < len(lst) else f"boost#{v}"


def load_side(folder: Path, label: str, server: str, version: str) -> Side:
    """Read an exported version folder.

    @param folder A public/data/.../<version> folder.
    @param label Short tag for the report.
    @param server Server id.
    @param version Game version id.
    @return The indexed side.
    @raise FileNotFoundError When the folder lacks one of the four JSON files.
    """
    def rd(name: str):
        return json.loads((folder / name).read_text(encoding="utf-8"))
    return Side(label, server, version, rd("core.json"), rd("powersets.json"), rd("powers.json"),
                rd("boosts.json"))


# ---------------------------------------------------------------- formatting

def fmt(v) -> str:
    """@return A value as short text: whole floats without ".0", lists in brackets, None as "-"."""
    if v is None:
        return "-"
    if isinstance(v, bool):
        return str(v).lower()
    if isinstance(v, float):
        if math.isfinite(v) and v == int(v) and abs(v) < 1e15:
            return str(int(v))
        return f"{v:.6g}"
    if isinstance(v, (list, tuple)):
        return "[" + ", ".join(fmt(x) for x in v) + "]"
    return str(v)


def fmt_arr(v) -> str:
    """@return A list as text with runs of 4 or more equal values collapsed ("1 x50"); else fmt()."""
    if not isinstance(v, list):
        return fmt(v)
    out, i = [], 0
    while i < len(v):
        j = i
        while j < len(v) and v[j] == v[i]:
            j += 1
        out.append(f"{fmt(v[i])} x{j - i}" if j - i >= 4 else ", ".join(fmt(x) for x in v[i:j]))
        i = j
    return "[" + ", ".join(out) + "]"


def ascii_text(s: str) -> str:
    """@return The text as ASCII: common punctuation mapped, anything else written as \\uXXXX."""
    s = s.translate({0x2018: "'", 0x2019: "'", 0x201C: '"', 0x201D: '"', 0x2013: "-", 0x2014: "-",
                     0x2026: "...", 0xA0: " "})
    s = unicodedata.normalize("NFC", s)
    return s.encode("ascii", "backslashreplace").decode("ascii")


def short(name: str) -> str:
    """@return The last dotted segment of an internal name."""
    return name.rsplit(".", 1)[-1]


def level_text(v: int) -> str:
    """@return A 0-based available level as the game's level: "L1", or "granted" for -1."""
    return "granted" if v < 0 else f"L{v + 1}"


def array_diff(a, b) -> str | None:
    """Describe how two per-level values differ over levels 1-50.

    A scalar stands for the same value at every level. Arrays are cut to LEVELS entries, so
    Homecoming's 105-level tables compare with Thunderspy's 50.

    @param a Base value (number or list).
    @param b Other value.
    @return None when equal, else a short description.
    """
    la, lb = isinstance(a, list), isinstance(b, list)
    if not la and not lb:
        return None if a == b else f"{fmt(a)} -> {fmt(b)}"
    if la and not lb:
        a = a[:LEVELS]
        b = [b] * len(a)
    elif lb and not la:
        b = b[:LEVELS]
        a = [a] * len(b)
    else:
        a, b = a[:LEVELS], b[:LEVELS]
    n = min(len(a), len(b))
    idx = [i for i in range(n) if a[i] != b[i]]
    parts = []
    if idx:
        i, j = idx[0], idx[-1]
        parts.append(f"{len(idx)} of {n} levels differ; level {i + 1}: {fmt(a[i])} -> {fmt(b[i])}"
                     + (f"; level {j + 1}: {fmt(a[j])} -> {fmt(b[j])}" if j != i else ""))
    if len(a) != len(b):
        parts.append(f"length {len(a)} -> {len(b)}")
    return "; ".join(parts) or None


# ---------------------------------------------------------------- effects

def mod_parts(side: Side, m: dict) -> tuple:
    """One attribute mod, normalised.

    @param side The data the mod belongs to.
    @param m The mod.
    @return (attribute names, the rest of the mod as text): offsets, modes and power ids resolved to
            names, table names lower-cased (the two servers differ in case only).
    """
    names = side.attribs(m.get("a", []))
    parts = [m.get("asp", ""), m.get("t", ""), f"tg={m.get('tg', '')}", f"tbl={m.get('tbl', '').lower()}",
             f"sc={fmt(m.get('sc', 0))}"]
    for k in ("app", "dur", "mag", "del", "per", "tc", "stk", "stkL", "stkK"):
        v = m.get(k)
        if v is None:
            continue
        if k == "mag" and "SetMode" in names:
            v = "mode:" + side.mode(int(v))
        parts.append(f"{k}={fmt(v)}")
    for k in ("dx", "mx", "dreq"):
        if m.get(k):
            parts.append(f"{k}=" + " ".join(map(str, m[k])))
    if m.get("sup") is not None:
        parts.append("sup=" + json.dumps(m["sup"], sort_keys=True))
    if m.get("fl"):
        parts.append("fl=" + ",".join(sorted(m["fl"])))
    if m.get("bma") is not None:
        parts.append("bma=" + side.boost_type(m["bma"]))
    if m.get("pw"):
        parts.append("pw=" + ",".join(sorted(side.power_name(i) for i in m["pw"])))
    return names, " ".join(parts)


def effect_items(side: Side, effs: list, inherited: tuple = ()) -> list:
    """Flatten an effect tree into (conditions, attribute names, mod text) triples.

    The conditions are those of the mod's own group and every group above it (chance, requirements,
    flags), as a sorted tuple: the two servers nest the same conditions differently. Tags are
    metadata and are not compared.

    @param side The data the effects belong to.
    @param effs A list of effects (power `eff` or `act`).
    @param inherited The conditions of the enclosing groups.
    @return The triples.
    """
    out = []
    for e in effs:
        ctx = list(inherited)
        for k in ("ch", "ppm", "del", "ef"):
            if e.get(k) is not None:
                ctx.append(f"{k}={fmt(e[k])}")
        if e.get("req"):
            ctx.append("req=" + " ".join(map(str, e["req"])))
        if e.get("fl"):
            ctx.append("fl=" + ",".join(sorted(e["fl"])))
        here = tuple(sorted(ctx))
        mods = e.get("m", [])
        for m in mods:
            names, text = mod_parts(side, m)
            out.append((here, names, text))
        if not mods and not e.get("sub"):
            out.append((here, [], "(no mods)"))
        out.extend(effect_items(side, e.get("sub", []), here))
    return out


def effect_lines(side: Side, effs: list) -> list:
    """Normalised lines for a power's effects, comparable as multisets.

    Mods that differ only in their attributes are merged into one line (one servers writes
    "Lethal+Smashing" where the other writes two mods), and nesting is flattened.

    @param side The data the effects belong to.
    @param effs A list of effects (power `eff` or `act`).
    @return One line per distinct (conditions, mod) pair.
    """
    merged: dict = {}
    for ctx, names, text in effect_items(side, effs):
        merged.setdefault((ctx, text), set()).update(names)
    out = []
    for (ctx, text), names in merged.items():
        out.append((("{" + " ".join(ctx) + "} ") if ctx else "") + ("+".join(sorted(names)) or "-") + " " + text)
    return sorted(out)


def power_view(side: Side, p: dict) -> dict:
    """The comparable fields of a power, normalised.

    @param side The data the power belongs to.
    @param p The power.
    @return Field -> normalised value (ids and offsets resolved to names, string lists sorted),
            with the effects as "eff" and "act" line lists.
    """
    v = {"acc": p.get("acc", 1)}
    for k, x in p.items():
        if k in SKIP_POWER_FIELDS or k == "acc":
            continue
        if k == "ba":
            x = sorted(side.boost_type(i) for i in x)
        elif k == "atk":
            x = side.attribs(x)
        elif k in ("modr", "modd"):
            x = sorted(side.mode(i) for i in x)
        elif k == "redir":
            x = sorted(f"{side.power_name(r['p'])} if {' '.join(r.get('req', []))}" for r in x)
        elif isinstance(x, list) and all(isinstance(i, str) for i in x):
            x = sorted(x)
        v[k] = x
    v["eff"] = effect_lines(side, p.get("eff", []))
    v["act"] = effect_lines(side, p.get("act", []))
    return v


def capped(lines: list, tag: str, indent: str = "  ") -> list:
    """@return Bullet lines for a list of effect lines, at most CAP shown, tagged with the side."""
    if CAP <= 0:
        return []  # the committed report gives effect counts only (on the power's line)
    out = [f"{indent}- {tag}: `{x if len(x) <= 220 else x[:217] + '...'}`" for x in lines[:CAP]]
    if len(lines) > CAP:
        out.append(f"{indent}- {tag}: ... and {len(lines) - CAP} more")
    return out


def diff_power(base: Side, other: Side, pa: dict, pb: dict) -> tuple:
    """Compare one power on both servers.

    @param base The base side (Homecoming).
    @param other The other side.
    @param pa The power on the base side.
    @param pb The power on the other side.
    @return (field texts, effect bullet lines, fields that differ); all empty when equal.
    """
    va, vb = power_view(base, pa), power_view(other, pb)
    texts, fields = [], []
    for k in sorted(set(va) | set(vb), key=lambda k: (k in ("eff", "act"), list(FIELD_NAMES).index(k)
                                                      if k in FIELD_NAMES else 99, k)):
        if k in ("eff", "act"):
            continue
        a, b = va.get(k), vb.get(k)
        if a != b:
            fields.append(k)
            texts.append(f"{FIELD_NAMES.get(k, k)} {fmt(a)} -> {fmt(b)}")
    bullets = []
    for k in ("eff", "act"):
        ca, cb = Counter(va[k]), Counter(vb[k])
        ra, rb = sorted((ca - cb).elements()), sorted((cb - ca).elements())
        if ra or rb:
            fields.append(k)
            label = "effects" if k == "eff" else "activation effects"
            texts.append(f"{label}: {len(ra)} only on {base.label}, {len(rb)} only on {other.label}")
            bullets += capped(ra, base.label) + capped(rb, other.label)
    return texts, bullets, fields


# ---------------------------------------------------------------- result

@dataclass
class Result:
    """Everything a comparison found: counts for the summary and the report's sections."""

    base: Side
    other: Side
    counts: Counter = field(default_factory=Counter)
    fields: Counter = field(default_factory=Counter)  # power field -> powers differing in it
    sections: list = field(default_factory=list)       # (title, markdown lines)

    def section(self, title: str, lines: list) -> None:
        """Add a section when it has content."""
        if lines:
            self.sections.append((title, lines))

    def summary_lines(self) -> list:
        """@return Short bullet lines with the counts (also used by the run report)."""
        c, b, o = self.counts, self.base.label, self.other.label
        return [
            f"Power sets (player categories): {c['sets_base']} {b}, {c['sets_other']} {o}; "
            f"{c['sets_only_base']} only on {b}, {c['sets_only_other']} only on {o}; "
            f"{c['sets_differ']} of {c['sets_both']} shared differ in order, levels or requirements",
            f"Powers in shared sets: {c['powers_compared']} compared, {c['powers_differ']} differ; "
            f"{c['powers_only_base']} only on {b}, {c['powers_only_other']} only on {o}",
            f"Archetypes: {c['at_both']} shared, {c['at_only_base']} only on {b}, "
            f"{c['at_only_other']} only on {o}; {c['at_table_diffs']} archetype table differences, "
            f"{c['mod_table_diffs']} modifier table differences",
            f"Attribute names: {c['attr_only_base']} only on {b}, {c['attr_only_other']} only on {o}, "
            f"{c['attr_moved']} at a different offset",
            f"Game rules differing: {c['core_diffs']} (schedule, boost effect, exemplar, "
            f"diminishing returns)",
            f"Enhancement sets: {c['bsets_base']} {b}, {c['bsets_other']} {o}; {c['bsets_both']} share a "
            f"name, {c['bsets_differ']} of those differ; {c['bonus_differ']} of {c['bonus_both']} shared "
            f"set bonus powers differ",
        ]


def scope_sets(side: Side) -> dict:
    """The player power sets: those in an archetype's primary, secondary, pool and epic categories.

    @param side The data.
    @return Powerset name -> (powerset, category name).
    """
    cats = {}
    for at in side.core.get("archetypes", []):
        for k in ("pri", "sec", "pool", "epic"):
            c = at.get("cats", {}).get(k)
            if c:
                cats[c] = True
    out = {}
    for c in cats:
        for sid in side.core.get("categories", {}).get(c, []):
            s = side.sets_by_id.get(sid)
            if s:
                out[s["n"]] = (s, c)
    return out


def bonus_key(name: str) -> str:
    """The name a set bonus power is matched by across servers.

    Homecoming files bonus powers under Set_Bonus.Global_Bonus, Thunderspy's under
    Set_Bonus.Set_Bonus, so they are matched by their last segment, with the PvP ones kept apart.

    @param name A bonus power's internal name.
    @return "Aegis", or "PVP.Increased_Range_2" for the PvP set bonuses.
    """
    parts = name.split(".")
    return ("PVP." if len(parts) > 1 and "pvp" in parts[1].lower() else "") + parts[-1]


def bonus_index(side: Side) -> dict:
    """@return Bonus power key (lower case) -> power; a key two powers share falls back to the full name."""
    keys = Counter(bonus_key(n).lower() for n in side.bonus_by_name)
    return {(bonus_key(n).lower() if keys[bonus_key(n).lower()] == 1 else n.lower()): p
            for n, p in side.bonus_by_name.items()}


def names_line(label: str, names: list) -> str:
    """@return A bullet listing names, or "" when there are none."""
    return f"- {label} ({len(names)}): " + ", ".join(names) if names else ""


# ---------------------------------------------------------------- sections

def compare_attribs(r: Result) -> None:
    """Attribute names that exist on one server only, or sit at different offsets."""
    b, o = r.base, r.other
    def table(s: Side) -> dict:
        d = {}
        for off, ent in s.core.get("attribs", {}).items():
            d.setdefault(s.resolve_name(ent["name"]), []).append(int(off))
        return d
    ta, tb = table(b), table(o)
    only_a = sorted(n for n in ta if n not in tb and not n.startswith(tuple(k + "." for k in GENERIC)))
    only_b = sorted(n for n in tb if n not in ta and not n.startswith(tuple(k + "." for k in GENERIC)))
    moved = sorted((n, ta[n], tb[n]) for n in ta if n in tb and ta[n] != tb[n])
    r.counts.update(attr_only_base=len(only_a), attr_only_other=len(only_b), attr_moved=len(moved))
    lines = [f"Names are resolved through each server's own offsets, so a moved offset alone is not a "
             f"difference. `{'`, `'.join(f'{k}' for k in ALIASES)}` is merged with its alias "
             f"`{'`, `'.join(ALIASES.values())}` (one attribute, two names).", ""]
    for lab, names in ((f"Only on {b.label}", only_a), (f"Only on {o.label}", only_b)):
        if names:
            lines.append(names_line(lab, names))
    if moved:
        lines.append(f"- At a different offset ({len(moved)}): "
                     + ", ".join(f"{n} ({fmt(x)} -> {fmt(y)})" for n, x, y in moved))
    for kind, lst in (("Damage", "damage types"), ("Defense", "defense types"),
                      ("Elusivity", "elusivity types")):
        na = [e["n"] for e in b.core.get("attribNames", {}).get(kind, [])]
        nb = [e["n"] for e in o.core.get("attribNames", {}).get(kind, [])]
        if na != nb:
            lines.append(f"- {lst.capitalize()}: {len(na)} on {b.label}, {len(nb)} on {o.label}; "
                         f"only on {b.label}: {', '.join(x for x in na if x not in nb) or 'none'}; "
                         f"only on {o.label}: {', '.join(x for x in nb if x not in na) or 'none'}")
    ma = [e["n"] for e in b.core.get("attribNames", {}).get("Mode", [])]
    mb = [e["n"] for e in o.core.get("attribNames", {}).get("Mode", [])]
    if ma != mb:
        lines.append(f"- Power modes: {len(ma)} on {b.label}, {len(mb)} on {o.label}; only on "
                     f"{b.label} ({len([x for x in ma if x not in mb])}), only on {o.label} "
                     f"({len([x for x in mb if x not in ma])}); modes are compared by name")
    r.section("Attribute names", lines)


def compare_rules(r: Result) -> None:
    """Level schedule, boost effect, exemplar limits and diminishing returns."""
    b, o = r.base, r.other
    ca, cb = b.core, o.core
    lines = []
    sa, sb = ca.get("schedule", {}), cb.get("schedule", {})
    for k in sorted(set(sa) | set(sb)):
        x, y = sa.get(k), sb.get(k)
        if x != y:
            extra = f" ({len(x)} entries -> {len(y)})" if isinstance(x, list) and len(x) != len(y or []) else ""
            lines.append(f"- schedule.{k}{extra}: {b.label} {fmt_arr(_levels_1(k, x))} -> "
                         f"{o.label} {fmt_arr(_levels_1(k, y))}")
    ba, bb = ca.get("boostEffect", {}), cb.get("boostEffect", {})
    for k in sorted(set(ba) | set(bb)):
        if ba.get(k) != bb.get(k):
            lines.append(f"- boostEffect.{k} ({len(ba.get(k) or [])} entries -> {len(bb.get(k) or [])}): "
                         f"{b.label} {fmt_arr(ba.get(k))} -> {o.label} {fmt_arr(bb.get(k))}")
    ea, eb = ca.get("exemplar", {}), cb.get("exemplar", {})
    for k in sorted(set(ea) | set(eb)):
        d = array_diff(ea.get(k), eb.get(k))
        if d:
            lines.append(f"- exemplar.{k}: {d}")
    # dimReturns: matched by the attributes they cover (resolved to names)
    def flat(s: Side) -> dict:
        d = {}
        for top in s.core.get("dimReturns", []):
            for st in top.get("sets", []):
                key = "+".join(s.attribs(st.get("a", []))) or "(none)"
                n = 2
                while key in d:
                    key, n = key.split(" #")[0] + f" #{n}", n + 1
                d[key] = {"top default": top.get("default"), "top boost": top.get("boost"),
                          "default": st.get("default"), "returns": st.get("ret")}
        return d
    da, db = flat(b), flat(o)
    for k in sorted(set(da) | set(db)):
        x, y = da.get(k), db.get(k)
        if x is None or y is None:
            lines.append(f"- dimReturns {k}: only on {b.label if y is None else o.label}")
        elif x != y:
            what = [f"{f} {fmt(x[f])} -> {fmt(y[f])}" for f in x if x[f] != y[f]]
            lines.append(f"- dimReturns {k}: " + "; ".join(what))
    r.counts["core_diffs"] = len(lines)
    r.section("Game rules (schedule, boost effect, exemplar, diminishing returns)",
              ["Level lists are the game's 1-based levels (0 in a list is level 1)."] + [""] + lines if lines else [])


def _levels_1(key: str, v):
    """@return A schedule list as 1-based game levels (the data is 0-based), others unchanged."""
    return [x + 1 for x in v] if isinstance(v, list) and key != "freeSlots" else v


def compare_archetypes(r: Result) -> None:
    """Archetype base, cap and modifier tables, grouped so one change across archetypes is one line."""
    b, o = r.base, r.other
    aa = {a["n"]: a for a in b.core.get("archetypes", [])}
    ab = {a["n"]: a for a in o.core.get("archetypes", [])}
    both = sorted(set(aa) & set(ab))
    only_a, only_b = sorted(set(aa) - set(ab)), sorted(set(ab) - set(aa))
    r.counts.update(at_both=len(both), at_only_base=len(only_a), at_only_other=len(only_b))
    lines = []
    for lab, names in ((f"Only on {b.label}", only_a), (f"Only on {o.label}", only_b)):
        if names:
            lines.append(names_line(lab, names))
    for n in both:
        for k in ("pri", "sec", "pool", "epic", "inherent"):
            x, y = aa[n].get("cats", {}).get(k), ab[n].get("cats", {}).get(k)
            if x != y:
                lines.append(f"- {n} category {k}: {x} -> {y}")
    cols: dict = {}
    only_cols: dict = {}
    for n in both:
        for t in ("base", "min", "max", "maxMax", "strMin", "strMax", "resMin", "resMax"):
            ca = {b.resolve_name(c): v for c, v in aa[n].get(t, {}).items()}
            cb = {o.resolve_name(c): v for c, v in ab[n].get(t, {}).items()}
            for c in sorted(set(ca) | set(cb)):
                if c not in cb or c not in ca:
                    only_cols.setdefault((t, c, b.label if c in ca else o.label), []).append(n)
                    continue
                d = array_diff(ca[c], cb[c])
                if d:
                    cols.setdefault((t, c, d), []).append(n)
    tables: dict = {}
    only_tables: dict = {}
    for n in both:
        ma = {k: aa[n]["mod"][k] for k in aa[n].get("mod", {})}
        mb = {k: ab[n]["mod"][k] for k in ab[n].get("mod", {})}
        for t in sorted(set(ma) | set(mb)):
            if t not in ma or t not in mb:
                only_tables.setdefault((t, b.label if t in ma else o.label), []).append(n)
                continue
            d = array_diff(b.core["modTables"][ma[t]], o.core["modTables"][mb[t]])
            if d:
                tables.setdefault((t, d), []).append(n)
    total = len(both)
    def who(ns: list) -> str:
        return f"all {total} archetypes" if len(ns) == total else ", ".join(x.removeprefix("Class_") for x in ns)
    def cols_text(cs: list) -> str:
        return cs[0] if len(cs) == 1 else "{" + ", ".join(cs) + "}"
    r.counts["at_table_diffs"] = len(cols) + len(only_cols)
    r.counts["mod_table_diffs"] = len(tables) + len(only_tables)
    body = []
    # columns with the same change in the same archetypes are one line
    grouped: dict = {}
    for (t, c, d), ns in sorted(cols.items()):
        grouped.setdefault((t, d, tuple(ns)), []).append(c)
    for (t, d, ns), cs in sorted(grouped.items()):
        body.append(f"- {t}.{cols_text(cs)}: {d} ({who(list(ns))})")
    grouped = {}
    for (t, c, side), ns in sorted(only_cols.items()):
        grouped.setdefault((t, side, tuple(ns)), []).append(c)
    for (t, side, ns), cs in sorted(grouped.items()):
        body.append(f"- {t}.{cols_text(cs)}: only on {side} ({who(list(ns))})")
    if body:
        lines += ["", "### Archetype tables (base, min, max, maxMax, strMin, strMax, resMin, resMax)", "",
                  "Columns are named by attribute (damage, defense and elusivity types by their own "
                  "names). Levels are the game's 1-based levels; only levels 1-50 are compared.", ""] + body
    body = [f"- {t}: {d} ({who(ns)})" for (t, d), ns in sorted(tables.items())]
    body += [f"- {t}: only on {side} ({who(ns)})" for (t, side), ns in sorted(only_tables.items())]
    if body:
        lines += ["", "### Modifier tables (archetype `mod`: table name -> per-level values)", ""] + body
    r.section("Archetypes", lines)


def compare_sets_and_powers(r: Result) -> None:
    """Power sets (membership, order, levels) and the powers in them, grouped by set."""
    b, o = r.base, r.other
    sa, sb = scope_sets(b), scope_sets(o)
    both = sorted(set(sa) & set(sb))
    only_a, only_b = sorted(set(sa) - set(sb)), sorted(set(sb) - set(sa))
    r.counts.update(sets_base=len(sa), sets_other=len(sb), sets_both=len(both),
                    sets_only_base=len(only_a), sets_only_other=len(only_b))
    lines = []
    for lab, names, side, sets in ((f"Power sets only on {b.label}", only_a, b, sa),
                                   (f"Power sets only on {o.label}", only_b, o, sb)):
        if names:
            lines.append(f"- {lab} ({len(names)}): " + ", ".join(
                f"{n} ({len(sets[n][0]['p'])} powers)" for n in names))
    r.section("Power sets on one server only", lines)

    groups = []
    c = r.counts
    for n in both:
        (a, _), (bb, _) = sa[n], sb[n]
        pa, pb = [b.power_name(i) for i in a["p"]], [o.power_name(i) for i in bb["p"]]
        # powers are matched ignoring case (Tough_hide / Tough_Hide is one power)
        la, lb = [x.lower() for x in pa], [x.lower() for x in pb]
        seta, setb = set(la), set(lb)
        head: list = []
        only_pa = [x for x, k in zip(pa, la) if k not in setb]
        only_pb = [x for x, k in zip(pb, lb) if k not in seta]
        c["powers_only_base"] += len(only_pa)
        c["powers_only_other"] += len(only_pb)
        lv_a, lv_b = dict(zip(la, a.get("av", []))), dict(zip(lb, bb.get("av", [])))
        if only_pa:
            head.append(f"- Powers only on {b.label}: " + ", ".join(
                f"{short(x)} ({level_text(lv_a[x.lower()])})" if x.lower() in lv_a else short(x) for x in only_pa))
        if only_pb:
            head.append(f"- Powers only on {o.label}: " + ", ".join(
                f"{short(x)} ({level_text(lv_b[x.lower()])})" if x.lower() in lv_b else short(x) for x in only_pb))
        oa, ob = [k for k in la if k in setb], [k for k in lb if k in seta]
        shown = {k: short(x) for k, x in zip(la, pa)}
        if oa != ob:
            head.append(f"- Order: {b.label} {', '.join(shown[k] for k in oa)} -> {o.label} "
                        f"{', '.join(shown[k] for k in ob)}")
        moved = [f"{shown[k]} {level_text(lv_a[k])} -> {level_text(lv_b[k])}"
                 for k in oa if k in lv_b and lv_a.get(k) != lv_b.get(k)]
        if moved:
            head.append("- Available level: " + "; ".join(moved))
        for k, lab in (("sbr", "set buy requires"), ("sbrt", "set buy requires text"),
                       ("sr", "set requires"), ("spr", "set power requires"), ("spa", "specialize at")):
            x, y = a.get(k), bb.get(k)
            if x != y:
                head.append(f"- {lab}: {fmt(x)} -> {fmt(y)}")
        bullets = []
        for k in oa:
            pw_a, pw_b = b.power_by_lower.get(k), o.power_by_lower.get(k)
            if pw_a is None or pw_b is None:
                continue
            c["powers_compared"] += 1
            texts, eff, fields = diff_power(b, o, pw_a, pw_b)
            if texts:
                c["powers_differ"] += 1
                r.fields.update(set(fields))
                bullets.append(f"- {shown[k]}: " + "; ".join(texts))
                bullets += eff
        if head or bullets:
            c["sets_differ"] += 1 if head else 0
            groups.append((n, head + bullets))
    for n, ls in groups:
        r.section(f"Powers: {n}", ls)


def compare_boost_sets(r: Result) -> None:
    """Enhancement sets (by name) and the set bonus powers."""
    b, o = r.base, r.other
    sa = {s["n"]: s for s in b.boosts.get("sets", [])}
    sb = {s["n"]: s for s in o.boosts.get("sets", [])}
    both = sorted(set(sa) & set(sb))
    only_a, only_b = sorted(set(sa) - set(sb)), sorted(set(sb) - set(sa))
    r.counts.update(bsets_base=len(sa), bsets_other=len(sb), bsets_both=len(both))
    lines = []
    for lab, names in ((f"Enhancement sets only on {b.label}", only_a),
                       (f"Enhancement sets only on {o.label}", only_b)):
        if names:
            lines.append(names_line(lab, names))
    in_both_powers = set(b.power_by_name) & set(o.power_by_name)

    def bon(s: Side, x: dict) -> str:
        t = f"{x.get('min')}-{x.get('max')} pieces: " + ", ".join(
            bonus_key(s.power_name(i)) for i in x.get("auto", []))
        for k in ("req", "bp", "txt"):
            if x.get(k):
                t += f" {k}={fmt(x[k])}"
        return t

    differ = 0
    for n in both:
        x, y = sa[n], sb[n]
        d = []
        for k, lab in (("grp", "group"), ("conv", "conversion"), ("minL", "min level"), ("maxL", "max level")):
            if x.get(k) != y.get(k):
                d.append(f"{lab} {fmt(x.get(k))} -> {fmt(y.get(k))}")
        pa = [[b.power_name(i) for i in piece] for piece in x.get("slots", [])]
        pb = [[o.power_name(i) for i in piece] for piece in y.get("slots", [])]
        if len(pa) != len(pb):
            d.append(f"pieces {len(pa)} -> {len(pb)}")
        elif pa != pb:
            d.append("piece enhancements differ")
        ea = {b.power_name(i) for i in x.get("elig", [])} & in_both_powers
        eb = {o.power_name(i) for i in y.get("elig", [])} & in_both_powers
        if ea != eb:
            d.append(f"eligible powers (shared powers only): {len(ea - eb)} only on {b.label}"
                     f"{' (' + ', '.join(sorted(ea - eb)[:4]) + (', ...' if len(ea - eb) > 4 else '') + ')' if ea - eb else ''}"
                     f", {len(eb - ea)} only on {o.label}"
                     f"{' (' + ', '.join(sorted(eb - ea)[:4]) + (', ...' if len(eb - ea) > 4 else '') + ')' if eb - ea else ''}")
        ba = [bon(b, t) for t in x.get("bon", [])]
        bb = [bon(o, t) for t in y.get("bon", [])]
        bullets = []
        if ba != bb:
            ra, rb = sorted((Counter(ba) - Counter(bb)).elements()), sorted((Counter(bb) - Counter(ba)).elements())
            d.append(f"bonuses: {len(ra)} only on {b.label}, {len(rb)} only on {o.label}")
            bullets = [f"  - {b.label}: {t}" for t in ra] + [f"  - {o.label}: {t}" for t in rb]
        d = [t for t in d if t]
        if d:
            differ += 1
            lines.append(f"- {n}: " + "; ".join(d))
            lines += bullets
    r.counts["bsets_differ"] = differ
    r.section("Enhancement sets", lines)

    pa, pb = bonus_index(b), bonus_index(o)
    both_p = sorted(set(pa) & set(pb))
    r.counts["bonus_both"] = len(both_p)
    lines = ["Set bonus powers are matched by their last name segment (Homecoming's are in "
             "Set_Bonus.Global_Bonus, Thunderspy's in Set_Bonus.Set_Bonus), PvP ones apart.", ""]
    for lab, keys, idx in ((f"Set bonus powers only on {b.label}", sorted(set(pa) - set(pb)), pa),
                           (f"Set bonus powers only on {o.label}", sorted(set(pb) - set(pa)), pb)):
        if keys:
            lines.append(names_line(lab, [idx[k]["n"] for k in keys]))
    nd = 0
    for k in both_p:
        texts, eff, _ = diff_power(b, o, pa[k], pb[k])
        if texts:
            nd += 1
            lines.append(f"- {bonus_key(pa[k]['n'])}: " + "; ".join(texts))
            lines += eff
    r.counts["bonus_differ"] = nd
    r.section("Set bonus powers", lines)


def compare(base: Side, other: Side) -> Result:
    """Compare two servers' exported data by name.

    @param base The base side (Homecoming).
    @param other The side compared against it.
    @return The counts and the report sections.
    """
    r = Result(base, other)
    compare_attribs(r)
    compare_rules(r)
    compare_archetypes(r)
    compare_sets_and_powers(r)
    compare_boost_sets(r)
    return r


def compare_folders(base_dir: Path, other_dir: Path, base_ids: tuple = ("homecoming", "i28p4"),
                    other_ids: tuple = ("thunderspy", "ts9-6")) -> Result:
    """Load two exported version folders and compare them.

    @param base_dir Homecoming's version folder.
    @param other_dir The other server's version folder.
    @param base_ids (server id, version id) of the base.
    @param other_ids (server id, version id) of the other.
    @return The comparison.
    """
    base = load_side(base_dir, "HC", *base_ids)
    other = load_side(other_dir, TAGS.get(other_ids[0], other_ids[0][:2].upper()), *other_ids)
    return compare(base, other)


# ---------------------------------------------------------------- rendering

def render(r: Result) -> str:
    """@return The markdown report (ASCII; the caller applies config.scrub before writing)."""
    b, o = r.base, r.other
    L = [f"# Differences from Homecoming -- {o.server} {o.version} against {b.server} {b.version}\n",
         f"Everything below is a difference between the committed exported data of the two servers, by "
         f"internal name. {b.label} = {b.server} {b.version}; {o.label} = {o.server} {o.version}. Values read "
         f"\"{b.label} -> {o.label}\". Use it to know what to spot-check in the {o.server} client. Generated by "
         f"`python -m pipeline.compare --server {o.server}`; do not edit by hand.\n",
         "## Summary\n"]
    L += [f"- {x}" for x in r.summary_lines()]
    if r.fields:
        L.append("")
        L.append("Powers differing, by field (a power counts once per field): "
                 + ", ".join(f"{FIELD_NAMES.get(k, k)} {n}" for k, n in r.fields.most_common()))
    L += ["", "How the data was normalised: ids became internal names; attribute offsets became attribute "
          "names (35 names sit at other offsets on the two servers); damage, defense and elusivity types "
          "became their own names (Homecoming has 17 damage types, Thunderspy 15; 18 defense types against "
          "11); `Knock` and `Knockback` count as one attribute; power modes were compared by name; per-level "
          "tables were compared over levels 1-50. Effects are compared as sets of lines, so their order "
          + (f"is ignored; at most {CAP} lines per side are shown for a power. " if CAP > 0 else
             "is ignored; only their counts are shown (`--effects N` writes a -full report with N lines a side). ")
          + "Icons and text are not "
          "compared. Levels are the game's 1-based levels.\n"]
    by_set = False
    for title, lines in r.sections:
        if title.startswith("Powers: "):
            if not by_set:
                L.append("## Powers by set\n")
                L.append("Each set lists its order and level changes first, then each power that differs "
                         "(powers are matched ignoring case; effect lines merge mods that differ only in "
                         "their attributes, and flatten nesting).\n")
                by_set = True
            L.append(f"### {title[len('Powers: '):]}\n")
        else:
            L.append(f"## {title}\n")
        L.extend(lines)
        L.append("")
    return ascii_text("\n".join(L)) + "\n"


def report_section(server_id: str, version: str, folder: Path) -> list:
    """The "Differences from Homecoming" section of a pipeline run's report.

    Never raises: a missing or unreadable Homecoming folder is said in the section, so a run on a
    checkout without it still writes its report.

    @param server_id The server the run exported.
    @param version The game version id it exported.
    @param folder The exported version folder.
    @return Markdown lines.
    """
    out = ["## Differences from Homecoming\n"]
    cmd = f"python -m pipeline.compare --server {server_id}"
    try:
        idx = config.version_index("homecoming")
        base = idx.get("default") if idx else None
        bdir = config.data_dir("homecoming") / base if base else None
        if bdir is None or not (bdir / "core.json").is_file():
            out.append("Not compared: Homecoming's default version is not in public/data.\n")
            return out
        res = compare_folders(bdir, Path(folder), ("homecoming", base), (server_id, version))
    except Exception as e:  # noqa: BLE001 -- a comparison problem must not lose the run's report
        out.append(f"Not compared ({type(e).__name__}: {e}).\n")
        return out
    out.append(f"Against Homecoming {base}, by internal name (ids, attribute offsets and per-server "
               "numbering normalised):\n")
    out += [f"- {x}" for x in res.summary_lines()]
    s = config.SERVERS[server_id]
    out.append(f"\nThe full list, to spot-check in game, is pipeline/{s.report}-diff.md (`{cmd}`; "
               "committed data only).\n")
    return out


def default_dir(server_id: str, version: str | None = None) -> tuple:
    """@return (folder, version id) of a server's version (its default when none is named).

    @param server_id A key of config.SERVERS.
    @param version A version id, or None for the server's default.
    @raise SystemExit When the server has no versions.json or the folder is missing.
    """
    idx = config.version_index(server_id)
    if not idx or not idx.get("default"):
        raise SystemExit(f"error: {server_id} has no exported version (no versions.json)")
    v = version or idx["default"]
    d = config.data_dir(server_id) / v
    if not (d / "core.json").is_file():
        raise SystemExit(f"error: no exported data for {server_id} {v} at public/data")
    return d, v


def main(argv: list | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--server", default="thunderspy", choices=sorted(s for s in config.SERVERS if s != "homecoming"),
                    help="the server to compare with Homecoming (default thunderspy)")
    ap.add_argument("--version", help="the server's game version (default: its default)")
    ap.add_argument("--base-version", help="Homecoming's game version (default: its default)")
    ap.add_argument("--effects", type=int, default=0, metavar="N",
                    help="show up to N differing effect lines a side for each power, in a -full report that "
                         "is not committed (default 0: the committed report, effect counts only)")
    args = ap.parse_args(argv)
    global CAP
    CAP = max(0, args.effects)
    try:
        bdir, bv = default_dir("homecoming", args.base_version)
        odir, ov = default_dir(args.server, args.version)
        res = compare_folders(bdir, odir, ("homecoming", bv), (args.server, ov))
    except (OSError, ValueError, KeyError) as e:
        print(f"error: {config.scrub(str(e))}")
        return 2
    s = config.SERVERS[args.server]
    default = (config.version_index(args.server) or {}).get("default")
    name = f"{s.report}-diff.md" if ov == default else f"{s.report}-{ov}-diff.md"
    if CAP > 0:
        name = name.replace("-diff.md", "-diff-full.md")  # gitignored: too large to keep
    out = config.REPO / "pipeline" / name
    changed = config.atomic_write(out, config.scrub(render(res)))
    print(f"{'wrote' if changed else 'unchanged'} {out.relative_to(config.REPO).as_posix()}")
    for x in res.summary_lines():
        print(f"- {x}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
