"""Mids <-> game name/ID map for importing and exporting MidsReborn builds.

Writes public/data/<version>/mids-map.json (loaded only when a Mids file or share code is used):
  dbVersion   Mids database version string (from I12.mhd), used in exported .mbd files
  renames     {mids power full name: game power full name} from CrypticPowerNames.mhd (kept as it
              always was: the planner reads its own older exports with it)
  names       {mids power full name: game power full name} for every Mids power matched to a game
              power of another name: CrypticPowerNames, the epic pools Mids names its own way, and
              powers matched by the name players see (see match_powers); "" for a Mids power the
              game has no counterpart of, whose name is the game's name for another power
  exportNames {game power full name: mids power full name} where an export writes another name
              than the game's own; "" where Mids has no such power and gives its name to another
  powers      [[mids StaticIndex, game power id], ...] for the legacy MxDz share format
  enh         [{si, uid, name, type, boost|normal}] for every Mids enhancement:
              boost  = game enhancement power id (set IOs, common IOs, HO/Hydra/Titan/D-Sync)
              normal = boost suffix for TO/DO/SO ("Accuracy"): the game piece depends on grade
                       and origin (Generic_<suffix> / <Origin>_<suffix>)

Run on its own, it rebuilds one published version's map from that version's own files and the
configured MidsReborn data, and writes nothing else but pipeline/report-mids.md:
    python -m pipeline.mids_map --game-version i28p4
"""
from __future__ import annotations

import argparse
import json
import re
from collections import defaultdict

from pipeline import config, mids_ref

config.use_tools()
from enhdb_decode import read_enh_set, read_enhancement  # noqa: E402
from mids_decode import CSReader  # noqa: E402

# Epic pools MidsReborn names its own way: (Mids set, game set). Kept in step with
# MIDS_EPIC_POOLS in src/io/mids.ts (tests/midsmap.test.ts compares them).
MIDS_EPIC_POOLS = (
    ("Epic.Dark_Mastery_Blaster", "Epic.Blaster_Dark_Mastery"),
    ("Epic.Dark_Mastery_Controller", "Epic.Controller_Dark_Mastery"),
    ("Epic.Dark_Mastery_Dominator", "Epic.Dominator_Dark_Mastery"),
    ("Epic.Dark_Mastery_Mastermind", "Epic.Mastermind_Dark_Mastery"),
    ("Epic.Dark_Mastery_TankBrute", "Epic.Tank_Dark_Mastery"),
    ("Epic.Ice_Mastery_DefCorr", "Epic.Defender_Ice_Mastery"),
    ("Epic.Ice_Mastery_ScrapStalk", "Epic.Scrapper_Ice_Mastery"),
    ("Epic.Psionic_Mastery_ScrapStalk", "Epic.Melee_Psionic_Mastery"),
    ("Epic.Psionic_Mastery_TankBrute", "Epic.Tank_Psionic_Mastery"),
)


def _renames() -> dict[str, str]:
    out = {}
    path = config.MIDS_DATA / "CrypticPowerNames.mhd"
    for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        line = line.split("#", 1)[0].strip()
        if "," not in line:
            continue
        a, b = (x.strip() for x in line.split(",", 1))
        if a and b:
            out[a] = b
    return out


def _db_version() -> str:
    data = (config.MIDS_DATA / "I12.mhd").read_bytes()
    r = CSReader(data)
    r.string()  # header
    return r.string()


def _seen(name: str) -> str:
    """@return A display name reduced to letters and digits, lower case ("Assassin's Blade" -> "assassinsblade")."""
    return re.sub(r"[^a-z0-9]", "", (name or "").lower())


def cryptic_renames(table: dict[str, str], game_names: dict[str, str]) -> dict[str, str]:
    """The CrypticPowerNames pairs that name a game power, as {mids name: game name}.

    The table lists "old, new" in either direction; the pair whose target exists in the game data
    and whose source doesn't is kept.

    @param table The pairs as read from CrypticPowerNames.mhd.
    @param game_names Game power names by lower-cased name.
    @return The renames.
    """
    renames = {}
    for a, b in table.items():
        if b.lower() in game_names and a.lower() not in game_names:
            renames[a] = game_names[b.lower()]
        elif a.lower() in game_names and b.lower() not in game_names:
            renames[b] = game_names[a.lower()]
    return renames


def match_powers(mids: list[dict], game: list[dict], renames: dict[str, str],
                 player_sets: set[str]) -> tuple[list, dict, dict]:
    """Match every Mids power to the game power it is.

    Mids and the game name some powers differently, and Homecoming has moved names around inside a
    set (its Stalker Shield Defense power named Deflection is the one players see as Battle
    Agility; Mids' Deflection is the one they see as Deflection). So the name players see decides:

    1. A Mids power whose set (its epic pool swapped to the game's name) is one players pick from
       and holds exactly one game power showing the same name (letters and digits, any case) is
       that power. Pets, set bonuses and temporary powers are left to step 2: their hidden
       variants share names (a Titan Weapons pet's Fast and Slow attacks).
    2. Otherwise its own name, through CrypticPowerNames and the epic pools, names it.
    3. A game power step 1 gave to a Mids power of another name is never also given by step 2:
       the Mids power that only shares its name is one the game doesn't show, and is left out.
       Two Mids copies of one game power (Mids keeps Mace Mastery for Scrappers and Stalkers)
       both still match it.

    @param mids Mids power records (FullName, StaticIndex, DisplayName).
    @param game Game powers ({n, id, dn}) of the published version.
    @param renames The CrypticPowerNames renames (cryptic_renames).
    @param player_sets The lower-cased names of the power sets players pick from (player_sets).
    @return ([[StaticIndex, game id]] with each game power's export name first, {mids name: game
        name} where they differ ("" for a Mids power left out), report; its "export" is
        {game name: Mids name} where an export writes another name, "" for none).
    """
    by_name = {g["n"].lower(): g for g in game}
    by_seen = defaultdict(list)
    for g in game:
        parts = g["n"].split(".")
        if len(parts) >= 3 and _seen(g.get("dn", "")) and ".".join(parts[:2]).lower() in player_sets:
            by_seen[(".".join(parts[:2]).lower(), _seen(g["dn"]))].append(g)
    epic = {m.lower(): g for m, g in MIDS_EPIC_POOLS}

    def by_own_name(fn: str) -> dict | None:
        name = renames.get(fn)
        if name is None:
            parts = fn.split(".")
            swapped = epic.get(".".join(parts[:2]).lower())
            name = ".".join([swapped, *parts[2:]]) if swapped else fn
        return by_name.get(name.lower())

    def by_seen_name(p: dict) -> dict | None:
        parts = p["FullName"].split(".")
        if len(parts) < 3 or not _seen(p.get("DisplayName", "")):
            return None
        group = ".".join(parts[:2])
        found = by_seen.get((epic.get(group.lower(), group).lower(), _seen(p["DisplayName"])), [])
        return found[0] if len(found) == 1 else None

    seen_match = {p["FullName"]: by_seen_name(p) for p in mids}
    taken = set()
    for p in mids:
        g = seen_match[p["FullName"]]
        own = by_own_name(p["FullName"])
        if g is not None and (own is None or own["id"] != g["id"]):
            taken.add(g["id"])
    names = {}
    rep = {"by_seen_name": [], "left_out": []}
    found = defaultdict(list)  # game id -> [(rank, Mids order, Mids name, StaticIndex)]
    for i, p in enumerate(mids):
        fn = p["FullName"]
        g = seen_match[fn]
        own = by_own_name(fn)
        if g is None:
            if own is not None and own["id"] in taken:
                rep["left_out"].append((fn, p.get("DisplayName", ""), own["n"]))
                names[fn] = ""  # no game power: its name is the game's name for another one
                continue
            g = own
        elif own is None or own["id"] != g["id"]:
            rep["by_seen_name"].append((fn, p.get("DisplayName", ""), g["n"], g.get("dn", ""),
                                        own["n"] if own else None))
        if g is None:
            continue
        # the name an export writes: the game's own name, else the one players see, else any
        rank = 0 if g["n"].lower() == fn.lower() else 1 if seen_match[fn] is g else 2
        found[g["id"]].append((rank, i, fn, p["StaticIndex"]))
        if g["n"].lower() != fn.lower():
            names[fn] = g["n"]
    by_id = {g["id"]: g for g in game}
    first, rest, export = [], [], {}
    for gid, hits in found.items():
        hits.sort()
        first.append((hits[0][1], [hits[0][3], gid]))
        rest += [(h[1], [h[3], gid]) for h in hits[1:]]
        if hits[0][2].lower() != by_id[gid]["n"].lower():
            export[by_id[gid]["n"]] = hits[0][2]
    # a game power Mids has no match for, whose name Mids gives another power: written as no name
    for fn, gname in names.items():
        mine = by_name.get(fn.lower())
        if mine is not None and mine["id"] not in found and mine["n"] not in export:
            export[mine["n"]] = ""
    # each game power's export name first: the MxDz writer takes the first index of a power
    powers = [x for _i, x in sorted(first)] + [x for _i, x in sorted(rest)]
    rep["export"] = export
    return powers, names, rep


def player_sets(core: dict, powersets: list[dict]) -> set[str]:
    """@return The lower-cased names of the power sets in the player categories (core.json's categories)."""
    ids = {i for v in core["categories"].values() for i in v}
    return {s["n"].lower() for s in powersets if s["id"] in ids}


def build_from(game: list[dict], sets: set[str]) -> tuple[dict, dict]:
    """Build the map from the game powers of one version.

    @param game Every exported game power ({n, id, dn}), enhancements included.
    @param sets The power sets players pick from (player_sets).
    @return (map, report).
    """
    game_names = {g["n"].lower(): g["n"] for g in game}
    ids = {g["n"]: g["id"] for g in game}
    rep: dict = {"unmapped_enh": []}

    renames = cryptic_renames(_renames(), game_names)
    rep["renames_used"] = len(renames)
    powers, names, rep["powers"] = match_powers(mids_ref.powers(), game, renames, sets)

    data = (config.MIDS_DATA / "EnhDB.mhd").read_bytes()
    r = CSReader(data)
    r.string()
    r.f32()
    n = r.i32()
    raw = [read_enhancement(r) for _ in range(n + 1)]
    nsets = r.i32()
    sets = [read_enh_set(r) for _ in range(nsets + 1)]
    enh = []
    for e in raw:
        uid = e.get("UID") or ""
        # Mids Enhancement.LongName: "<set>: <name>" (SetO), "Invention: <name>" (InventO), else name
        if e["TypeID"] == 4 and 0 <= e["nIDSet"] < len(sets):
            long = f"{sets[e['nIDSet']]['DisplayName']}: {e['Name']}"
        elif e["TypeID"] == 2:
            long = f"Invention: {e['Name']}"
        else:
            long = e["Name"]
        item = {"si": e["StaticIndex"], "uid": uid, "name": e["Name"], "long": long, "type": e["TypeID"]}
        if e["TypeID"] == 1:  # Normal TO/DO/SO: one record per boost class
            item["normal"] = re.sub(r"^(Magic|Mutation|Natural|Science|Technology|Generic)_", "", uid)
        else:
            real = game_names.get(f"boosts.{uid}.{uid}".lower())
            if real:
                item["boost"] = ids[real]
            else:
                rep["unmapped_enh"].append(f"{uid} ({e['Name']})")
        enh.append(item)
    m = {"dbVersion": _db_version(), "renames": renames, "names": names, "exportNames": rep["powers"].pop("export"),
         "powers": powers, "enh": enh}
    return m, rep


def build(live, exporter) -> tuple[dict, dict]:
    """Build the map during a pipeline run; returns (map, report)."""
    return build_from(exporter.exported_powers, exporter.player_sets)


def prepare(live, exporter) -> tuple[dict | None, dict]:
    """Build the map in memory without writing anything.

    @return (map, report); map is None (and report["skipped"] set) when no Mids data is configured.
    """
    if not config.mids_available():
        return None, {"skipped": f"no MidsReborn data at {config.MIDS_DATA}"}
    m, rep = build(live, exporter)
    text = json.dumps(m, separators=(",", ":"))
    rep["text"] = text
    rep["bytes"] = len(text.encode("utf-8"))
    rep["enh_total"] = len(m["enh"])
    rep["powers_total"] = len(m["powers"])
    return m, rep


# ---- the standalone command and its report ------------------------------------------------------

def _pickable(folder) -> dict[int, str]:
    """@return {power id: "<category kind> <set>"} for every power in a set an archetype can pick."""
    core = json.loads((folder / "core.json").read_text(encoding="utf-8"))
    sets = {s["id"]: s for s in json.loads((folder / "powersets.json").read_text(encoding="utf-8"))}
    out = {}
    for at in core["archetypes"]:
        for kind in ("pri", "sec", "pool", "epic"):
            for sid in core["categories"].get(at["cats"][kind], []):
                for pid in sets[sid]["p"]:
                    out[pid] = sets[sid]["n"]
    return out


def report(version: str, m: dict, rep: dict, folder) -> str:
    """The Mids report for one version: what the map matched by name, and what Mids lacks or reads otherwise.

    @param version The game version id.
    @param m The map.
    @param rep The report build_from returned.
    @param folder The version's data folder.
    @return Markdown.
    """
    powers = json.loads((folder / "powers.json").read_text(encoding="utf-8"))
    by_id = {p["id"]: p for p in powers}
    boosts = json.loads((folder / "boosts.json").read_text(encoding="utf-8"))
    mids = {p["FullName"]: p for p in mids_ref.powers()}
    mapped = {pid for _si, pid in m["powers"]}
    pick = _pickable(folder)
    L = [f"# MidsReborn and {version}", "",
         f"Made by `python -m pipeline.mids_map --game-version {version}` from Mids database "
         f"{m['dbVersion']}. Mids is a reference, never a source: this lists where import and export "
         "go through a different name, or can't go at all.", ""]

    seen = rep["powers"]["by_seen_name"]
    L += [f"## Powers matched by the name players see ({len(seen)})", "",
          "Mids' power and the game's power show the same name in the same set, under different "
          "internal names. Check a pair that looks wrong.", "",
          "| Mids power | Shown as | Game power | Its own name would give |", "|---|---|---|---|"]
    L += [f"| {fn} | {dn} | {gn} | {own or '(none)'} |" for fn, dn, gn, _gdn, own in sorted(seen)]

    left = rep["powers"]["left_out"]
    L += ["", f"## Mids powers left out ({len(left)})", "",
          "They share a name with a game power that another Mids power matches by the name players see.", ""]
    L += [f"- {fn} ({dn}): its name is the game's {gn}" for fn, dn, gn in sorted(left)]

    missing = defaultdict(list)
    for pid, s in pick.items():
        if pid not in mapped and pid in by_id:
            missing[s].append(by_id[pid])
    whole = sorted(s for s, ps in missing.items() if len(ps) == sum(1 for v in pick.values() if v == s))
    part = sorted(s for s in missing if s not in whole)
    L += ["", f"## Power sets Mids doesn't have ({len(whole)})", ""] + [f"- {s}" for s in whole]
    L += ["", f"## Powers Mids doesn't have, in sets it has ({sum(len(missing[s]) for s in part)})", ""]
    L += [f"- {p['n']} ({p['dn']})" for s in part for p in sorted(missing[s], key=lambda p: p["n"])]

    mapped_boosts = {e["boost"] for e in m["enh"] if "boost" in e}
    by_long = {e["long"].lower() for e in m["enh"] if "boost" not in e and not e.get("normal") and e.get("long")}
    normals = {e["normal"].lower() for e in m["enh"] if e.get("normal")}
    fixed = re.compile(r"^Crafted_[A-Za-z_]+_\d+$")
    origin = r"(Generic|Magic|Mutation|Natural|Science|Technology)_"
    kinds = {
        "attuned": ("Attuned pieces of sets Mids has only crafted", "the crafted piece at the top of the set's range"),
        "superior": ("Superior pieces of sets Mids has only crafted", "the crafted piece at the top of the set's range"),
        "synthetic": ("Synthetic Hamidon enhancements", "the Hamidon enhancement each copies"),
        "yins": ("Yin's talismans", "the Single Origin enhancement of its type"),
        "none": ("No Mids record and nothing near it", "an empty slot (the planner keeps the piece)"),
    }
    found = defaultdict(set)
    for b in boosts["boosts"]:
        inner = b["n"].split(".")[1] if b["n"].count(".") >= 2 else ""
        if b["id"] in mapped_boosts or not inner or fixed.match(inner):
            continue
        if b.get("dn", "").lower() in by_long and inner.startswith("Crafted_"):
            continue  # a set piece Mids keeps under another name (its Shrapnel is the game's Artillery)
        if re.sub(f"^({origin})+", "", inner).lower() in normals and re.match(f"^({origin})+", inner):
            continue  # a TO, DO or SO: Mids names them by type
        piece = re.match(r"^(Superior_Attuned|Superior|Attuned)_(.+?)(_[A-F])?$", inner)
        if piece:
            found["attuned" if piece.group(1) == "Attuned" else "superior"].add(piece.group(2))
        elif inner.startswith("Synthetic_"):
            found["synthetic"].add(inner)
        elif inner.startswith("Yins_") and re.sub(f"^Yins_({origin})*", "", inner).lower() in normals:
            found["yins"].add(inner)
        else:
            found["none"].add(f"{inner} ({b.get('dn', '')})")
    L += ["", "## Game enhancements with no Mids record", "",
          "The export writes the nearest Mids piece, and the planner's own record of the real one beside it.", ""]
    for k, (title, stand_in) in kinds.items():
        if found[k]:
            L += [f"- {title} ({len(found[k])}), as {stand_in}: {', '.join(sorted(found[k]))}"]

    # slotting: the IO set categories and enhancement types Mids allows, where it differs from the game
    midsets = {}
    data = (config.MIDS_DATA / "EnhDB.mhd").read_bytes()
    r = CSReader(data)
    r.string()
    r.f32()
    n = r.i32()
    raw = [read_enhancement(r) for _ in range(n + 1)]
    nsets = r.i32()
    msets = [read_enh_set(r) for _ in range(nsets + 1)]
    uid_set = {e.get("UID", "").lower(): msets[e["nIDSet"]] for e in raw if e["TypeID"] == 4 and 0 <= e["nIDSet"] < len(msets)}
    boost_mids = {e["boost"]: e["uid"] for e in m["enh"] if "boost" in e}
    for bs in boosts["sets"]:
        for piece in bs["slots"]:
            ms = next((uid_set.get(boost_mids.get(b, "").lower()) for b in piece if boost_mids.get(b, "").lower() in uid_set), None)
            if ms:
                midsets[bs["id"]] = ms
                break
    type_name = {}
    for bs in boosts["sets"]:
        if bs["id"] in midsets:
            type_name.setdefault(midsets[bs["id"]]["SetType"], bs["grp"])
    elig = defaultdict(set)
    for bs in boosts["sets"]:
        if bs["id"] in midsets:
            for pid in bs["elig"]:
                elig[pid].add(midsets[bs["id"]]["SetType"])
    boost_names = [x["n"] for x in json.loads((folder / "core.json").read_text(encoding="utf-8"))["attribNames"]["Boost"]]
    by_mids_name = {}
    for si, pid in m["powers"]:
        by_mids_name.setdefault(pid, si)
    mids_by_si = {p["StaticIndex"]: p for p in mids.values()}
    set_rows, type_rows = [], []
    for pid in sorted(pick, key=lambda i: by_id[i]["n"] if i in by_id else ""):
        p, mp = by_id.get(pid), mids_by_si.get(by_mids_name.get(pid, -1))
        if not p or not mp or not p.get("maxB"):
            continue
        ours, theirs = elig.get(pid, set()), set(mp.get("SetTypes") or [])
        if ours != theirs:
            name = lambda ts: ", ".join(sorted(type_name.get(t, f"type {t}") for t in ts)) or "-"  # noqa: E731
            set_rows.append(f"| {p['n']} | {name(ours - theirs)} | {name(theirs - ours)} |")
        ba = {boost_names[v - 5] for v in p.get("ba", []) if v >= 5 and v - 5 < len(boost_names)}
        mba = set(mp.get("BoostsAllowed") or [])
        if ba != mba:
            type_rows.append(f"| {p['n']} | {', '.join(sorted(ba - mba)) or '-'} | {', '.join(sorted(mba - ba)) or '-'} |")
    L += ["", f"## IO set categories that differ ({len(set_rows)})", "",
          "The game's own data is the spec; a piece only the game allows may be refused by Mids.", "",
          "| Power | Game only | Mids only |", "|---|---|---|"] + set_rows
    L += ["", f"## Enhancement types that differ ({len(type_rows)})", "",
          "| Power | Game only | Mids only |", "|---|---|---|"] + type_rows
    return "\n".join(L) + "\n"


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--server", choices=sorted(config.SERVERS), default=config.HOMECOMING.id,
                    help="game server (default homecoming)")
    ap.add_argument("--game-version", required=True, help="the published version id, e.g. i28p4")
    args = ap.parse_args()
    config.select_server(args.server)
    if not config.SERVER.mids:
        print(f"error: MidsReborn has no database for {config.SERVER.id}")
        return 2
    if not config.valid_version_id(args.game_version):
        print(f"error: invalid game version id {args.game_version!r}")
        return 2
    if not config.mids_available():
        print("error: no MidsReborn data configured (COH_MIDS or the mids path in pipeline/paths.local.json)")
        return 2
    folder = config.DATA_OUT / args.game_version
    try:
        # every power the run exported: powers.json, and the enhancements and set bonuses in boosts.json
        game = json.loads((folder / "powers.json").read_text(encoding="utf-8"))
        boosts = json.loads((folder / "boosts.json").read_text(encoding="utf-8"))
        game += boosts["boosts"] + boosts.get("bonusPowers", [])
    except (OSError, ValueError, KeyError):
        print(f"error: {args.game_version} is not a published version (no readable powers.json and boosts.json)")
        return 2
    core = json.loads((folder / "core.json").read_text(encoding="utf-8"))
    sets = json.loads((folder / "powersets.json").read_text(encoding="utf-8"))
    m, rep = build_from([{"n": p["n"], "id": p["id"], "dn": p.get("dn", "")} for p in game], player_sets(core, sets))
    config.atomic_write(folder / "mids-map.json", json.dumps(m, separators=(",", ":")))
    config.atomic_write(config.REPORT.parent / f"report-mids-{args.game_version}.md",
                        config.scrub(report(args.game_version, m, rep, folder)))
    print(f"{args.game_version}: {len(m['powers'])} powers, {len(m['names'])} names, "
          f"{len(rep['powers']['by_seen_name'])} matched by the name players see, "
          f"{len(rep['powers']['left_out'])} left out")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
