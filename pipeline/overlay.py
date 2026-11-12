"""Approximate game versions: a published version's data with each power's level taken from Mids.

This is the one place the planner takes game data from MidsReborn (AGENTS.md, "MidsReborn is an
untrusted reference"). When no client files exist for an older patch, builds made on it can still
open on rules close to that patch's. Only the level at which each power becomes available (and so
the order of each set's powers) comes from Mids' database for that patch. Everything else, every
number included, is the base version's.

Usage (from the repo root):
    python -m pipeline.overlay                  # base = the default version in versions.json
    python -m pipeline.overlay --base i28p4 [--id i28p3m]

The patch is read from the Mids database header (its issue and page). The new version is
"i<issue>p<page>m", labelled "Issue <issue>, Page <page> (approximate)", and is never made the
default. Pool sets keep the base's levels: Mids writes their first powers at level 4, where the
planner gates pools by the pool schedule instead. Published versions never change, so an existing
folder with different content is refused (pass a new --id).
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from pipeline import config  # noqa: E402

config.use_tools()
from mids_decode import CSReader  # noqa: E402

PATCH_ID = "i{issue}p{page}"


def mids_header() -> dict:
    """Read the Mids database header (MidsReborn DatabaseAPI.LoadMainDatabase order).

    @return {"version", "issue", "page"} of the configured I12.mhd.
    @raise SystemExit When the header is not a Mids powers database or names no issue and page.
    """
    r = CSReader((config.MIDS_DATA / "I12.mhd").read_bytes())
    if "Powers Database" not in r.string():
        raise SystemExit("error: I12.mhd is not a Mids powers database")
    version = r.string()
    year = r.i32()
    if year > 0:   # an old header stores year, month, day
        r.i32()
        r.i32()
    else:          # newer headers store DateTime.ToBinary()
        r.i += 8
    issue, page = r.i32(), r.i32()
    if not (0 < issue < 1000 and 0 <= page < 100):
        raise SystemExit(f"error: the Mids database header names no usable issue/page ({issue}, {page})")
    return {"version": version, "issue": issue, "page": page}


def patch_order(vid: str) -> tuple[int, int] | None:
    """@return (issue, page) of a version id like "i28p4" or "i28p3m", or None."""
    m = re.fullmatch(r"i(\d+)p(\d+)\w*", vid)
    return (int(m.group(1)), int(m.group(2))) if m else None


def overlay_sets(powersets: list, powers: list, mids: list, renames: dict) -> tuple[list, list, int]:
    """Replace each power's available level with Mids', then re-sort the changed sets by level.

    Powers granted with their set (level -1) keep their place; the others are sorted by level in
    the slots they held, stable, so ties keep the base order.

    @param powersets Base powersets.json (not modified).
    @param powers Base powers.json, for display names in the report.
    @param mids Mids power records (tools/mids_decode.py read_power).
    @param renames Base mids-map.json "renames" (Mids full name -> game full name).
    @return (new powersets, report rows, powers with no single Mids level).
    """
    levels: dict[str, set[int]] = {}
    for p in mids:
        name = renames.get(p["FullName"], p["FullName"]).lower()
        levels.setdefault(name, set()).add(p["Level"] - 1)
    names = {p["id"]: p for p in powers}
    out, rows, unmatched = [], [], 0
    for s in powersets:
        s = dict(s)
        if s["n"].startswith("Pool."):
            out.append(s)
            continue
        av = list(s["av"])
        changed = False
        for i, pid in enumerate(s["p"]):
            lv = levels.get(names[pid]["n"].lower()) if pid in names else None
            if not lv or len(lv) != 1:
                unmatched += 1
                continue
            m = next(iter(lv))
            if av[i] < 0 or m < 0 or m == av[i]:
                continue
            short = names[pid]["n"].rsplit(".", 1)[-1]
            rows.append((s["n"], f'{names[pid].get("dn") or short} ({short})', av[i] + 1, m + 1))
            av[i] = m
            changed = True
        if changed:
            slots = [i for i, a in enumerate(av) if a >= 0]
            order = sorted(slots, key=lambda i: av[i])
            p_new, av_new = list(s["p"]), list(av)
            for dst, src in zip(slots, order):
                p_new[dst], av_new[dst] = s["p"][src], av[src]
            s["p"], s["av"] = p_new, av_new
        out.append(s)
    return out, rows, unmatched


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--base", help="version id whose data is copied (default: the default version)")
    ap.add_argument("--id", help="new version id (default: i<issue>p<page>m from the Mids header)")
    args = ap.parse_args()

    if not config.mids_available():
        print("error: no MidsReborn data folder is configured (COH_MIDS or 'mids' in pipeline/paths.local.json)")
        return 2
    from pipeline import export, mids_ref

    idx = json.loads((config.DATA_OUT / "versions.json").read_text(encoding="utf-8"))
    base = args.base or idx["default"]
    entry = next((v for v in idx["versions"] if v["id"] == base), None)
    if entry is None or entry.get("approx"):
        print(f"error: {base!r} is not a published, exact version")
        return 2
    head = mids_header()
    patch = PATCH_ID.format(**head)
    vid = args.id or f"{patch}m"
    if not all(c.isalnum() or c in "-_." for c in vid) or vid == base:
        print(f"error: invalid version id {vid!r}")
        return 2
    if (patch_order(patch) or (0, 0)) >= (patch_order(entry.get("patch", base)) or (0, 0)):
        print(f"error: the Mids database is {patch}, which is not older than {base}")
        return 2

    src = config.DATA_OUT / base
    text = {f: (src / f).read_text(encoding="utf-8") for f in
            ("core.json", "powersets.json", "powers.json", "boosts.json", "mids-map.json")}
    mids_map = json.loads(text["mids-map.json"])
    sets, rows, unmatched = overlay_sets(json.loads(text["powersets.json"]), json.loads(text["powers.json"]),
                                         mids_ref.powers(), mids_map.get("renames", {}))
    sets_text = export._dump(sets)
    core = json.loads(text["core.json"])
    m = dict(core["manifest"])
    m.pop("hash", None)
    m["dataVersion"] = vid
    m["approximate"] = {"base": base, "patch": patch, "midsDb": head["version"],
                        "from": "power levels from Mids' database; everything else from the base"}
    core["manifest"] = m
    others = [sets_text, text["powers.json"], text["boosts.json"]]
    m["hash"] = export.content_hash(core, others)

    dst = config.DATA_OUT / vid
    if (dst / "core.json").exists():
        old = json.loads((dst / "core.json").read_text(encoding="utf-8"))["manifest"]
        if old.get("hash") != m["hash"]:
            print(f"error: public/data/{vid} already exists with different data; published versions "
                  "never change, so pass a new --id")
            return 2
        m["generated"] = old.get("generated", m.get("generated"))
    label = f"Issue {head['issue']}, Page {head['page']} (approximate)"
    for name, body in (("core.json", export._dump(core)), ("powersets.json", sets_text),
                       ("powers.json", text["powers.json"]), ("boosts.json", text["boosts.json"]),
                       ("mids-map.json", text["mids-map.json"])):
        config.atomic_write(dst / name, body)
    export.write_indexes(vid, label, m["hash"], False, {"patch": patch, "approx": True})

    L = [f"# Approximate version {vid} -- {label}\n",
         f"Base data: {base}. Mids database {head['version']} (Issue {head['issue']}, Page {head['page']}).",
         "Only the level each power becomes available comes from Mids; pool sets keep the base's levels.\n",
         f"Powers with no single Mids level (kept as in {base}): {unmatched}.\n",
         f"## Levels changed ({len(rows)})\n", f"| Set | Power | {base} | Mids |", "|---|---|---|---|"]
    L += [f"| {s} | {p} | {a} | {b} |" for s, p, a, b in rows]
    report = config.REPO / "pipeline" / f"report-{vid}.md"
    config.atomic_write(report, "\n".join(L) + "\n")
    print(f"wrote public/data/{vid} ({len(rows)} levels changed, hash {m['hash']}) and {report.name}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
