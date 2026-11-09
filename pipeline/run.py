"""Run the whole data pipeline: decode -> export -> assets -> validate -> pipeline/report.md.

Usage (from the repo root):
    python -m pipeline.run            # uses the decode cache when the client is unchanged
    python -m pipeline.run --force    # re-decode everything
    python -m pipeline.run --no-assets
    python -m pipeline.run --game-version i28p4 --game-label "Issue 28, Page 4" [--make-default]

The game version id names the data folder public/data/<id>/. It defaults to "gameVersion" /
"gameLabel" under "homecoming" in pipeline/patch-watch.json.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from pipeline import config  # noqa: E402
from pipeline.decode import live  # noqa: E402


PATCH_WATCH = config.REPO / "pipeline" / "patch-watch.json"


def default_game_version() -> tuple[str | None, str | None]:
    """@return (gameVersion, gameLabel) from patch-watch.json's "homecoming" entry (None if absent)."""
    try:
        h = json.loads(PATCH_WATCH.read_text(encoding="utf-8")).get("homecoming", {})
    except (OSError, ValueError):
        return None, None
    return h.get("gameVersion"), h.get("gameLabel")


def render_failure(data, reason: str) -> str:
    """Report for a run that aborted before writing anything."""
    L = ["# Pipeline report -- FAILED\n", f"**{reason}**\n",
         "Nothing under public/ was written and pipeline/ids.json was not touched.\n",
         "## Decode health\n", "| Bin | Records | Clean | Partial |\n|---|---|---|---|"]
    for k, v in data.health.items():
        L.append(f"| {k} | {v['records']} | {v['clean']} | {v['partial']} |")
    for k, v in data.health.items():
        for ex in v.get("partial_examples") or []:
            L.append(f"\n- {k}: {str(ex)[:160]}")
    return "\n".join(L) + "\n"


def render_report(data, exp, assets, val, warnings=()) -> str:
    """Markdown summary of a pipeline run."""
    L = []
    m = exp["manifest"]
    L.append(f"# Pipeline report -- data {m['dataVersion']}\n")
    L.append(f"Generated {m['generated']} (UTC).\n")
    if warnings:
        L.append("## Warnings\n")
        L.extend(f"- {w}" for w in warnings)
        L.append("")
    L.append("## Decode health\n")
    L.append("| Bin | Records | Clean | Partial |\n|---|---|---|---|")
    total_partial = 0
    for k, v in data.health.items():
        L.append(f"| {k} | {v['records']} | {v['clean']} | {v['partial']} |")
        total_partial += v["partial"]
    L.append(f"\n**Gate: {'PASS' if total_partial == 0 else 'FAIL'}** "
             f"({total_partial} partial records).\n")
    L.append("## Export\n")
    L.append("| Item | Count |\n|---|---|")
    for k, v in m["counts"].items():
        L.append(f"| {k} | {v} |")
    L.append("\n| File | Bytes |\n|---|---|")
    for k, v in exp["sizes"].items():
        L.append(f"| {k}.json | {v} |")
    rep = exp["report"]
    L.append(f"\nPvP-only effects dropped: {rep['pvp_effects_dropped']}. "
             f"Unresolved references: {sum(rep['unresolved_refs'].values())}. "
             f"New IDs: {exp['ids_added']}.\n")
    mm = exp.get("mids")
    if mm and mm.get("skipped"):
        extra = (f" mids-map.json was carried forward from {mm['carried_from']} and may be stale."
                 if mm.get("carried_from") else "")
        L.append(f"## Mids map\n\nSkipped: {mm['skipped']}.{extra}\n")
    elif mm:
        L.append("## Mids map (MidsReborn is a reference, not a source of truth)\n")
        L.append(f"{mm['enh_total']} Mids enhancements, {mm['powers_total']} Mids powers mapped, "
                 f"{mm['renames_used']} power renames, {mm['bytes']} bytes. Unmapped enhancements "
                 f"({len(mm['unmapped_enh'])}): {', '.join(mm['unmapped_enh'][:40]) or 'none'}\n")
    if assets:
        L.append("## Assets\n")
        L.append(", ".join(f"{k}: {v}" for k, v in assets["counts"].items()) + "\n")
        for k, v in assets["missing"].items():
            if v:
                L.append(f"- Missing {k} ({len(v)}): {', '.join(v)}")
        L.append("")
    if val:
        L.append("## Validation vs MidsReborn (a reference: disagreements are evidence to check, "
                 "not errors in our data)\n")
        n = val["names"]
        L.append(f"Display names: {n['same']} of {n['in_both']} powers match; {n['different']} "
                 "differ (I28 renames, Mids typos, Mids-only conventions). First differences "
                 "(power, Mids, game):\n")
        for fn, a, b in n["examples"][:20]:
            L.append(f"- `{fn}`: Mids \"{a}\" -> game \"{b}\"")
        rows = val["attribs"]["rows"]
        low = [r for r in rows if r["agree"] < 0.99 and r["pairs"] >= 5]
        L.append(f"\nAttribute labels: {len(rows) - len(low)} of {len(rows)} offsets agree with "
                 f">= 99% of paired Mids effects. Unlabelled offsets: "
                 f"{val['attribs']['unlabelled'] or 'none'}. Offsets below 99% (needs review; "
                 "pairing is by table+scale, so ambiguous pairs and Mids conventions show here):\n")
        L.append("| Offset | Attribute | Pairs | Agree | Example (power, ours, aspect, Mids types) |")
        L.append("|---|---|---|---|---|")
        for r in low:
            ex = r["examples"][0] if r["examples"] else ""
            L.append(f"| {r['offset']} | {r['name']} | {r['pairs']} | {r['agree']:.3f} | {ex} |")
        L.append("\nArchetypes at level 50 (game vs Mids):\n")
        L.append("| AT | HP | HP cap | Res cap | Mids (HP, cap, res) | Match |\n|---|---|---|---|---|---|")
        for a in val["archetypes"]:
            L.append(f"| {a['at']} | {a['hp50']} | {a['hpcap50']} | {a['rescap50']} | {a['mids']} | "
                     f"{'yes' if a['match'] else 'NO'} |")
        e = val["enhance"]
        L.append(f"\nEnhancements: TO scale {e['grade']['TO']:.4f} (Mids .083), SO {e['grade']['SO']:.4f} "
                 f"(Mids .333); IO L25 A {e['io'][25]['A']:.4f} (Mids .320); IO L50 "
                 + ", ".join(f"{k} {v:.4f}" for k, v in e['io'][50].items())
                 + " (Mids A .424, B .255, C .509, D .764).")
        L.append(f"ED start thresholds by boost type: {e['ed']} (Mids A .7/.9/1.0, B .4/.5/.6, "
                 "C .8/1.0/1.2, D 1.2/1.5/1.8).\n")
    return "\n".join(L) + "\n"


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--force", action="store_true", help="ignore the decode cache")
    ap.add_argument("--no-assets", action="store_true")
    ap.add_argument("--no-validate", action="store_true")
    ap.add_argument("--game-version", help='game version id, e.g. "i28p4" (names the data folder)')
    ap.add_argument("--game-label", help='label shown in the app, e.g. "Issue 28, Page 4"')
    ap.add_argument("--make-default", action="store_true",
                    help="make this version the default in versions.json")
    args = ap.parse_args()

    dv, dl = default_game_version()
    version = args.game_version or dv
    label = args.game_label or (dl if not args.game_version else None) or version
    if not version:
        print("error: no game version: pass --game-version or set homecoming.gameVersion in "
              "pipeline/patch-watch.json")
        return 2
    if not all(c.isalnum() or c in "-_." for c in version) or version.startswith("."):
        print(f"error: invalid game version id {version!r}")
        return 2

    config.preflight()
    from pipeline import export
    from pipeline.ids import IdRegistry
    IdRegistry()  # refuses to run when ids.json is missing/empty but public/data holds data

    data = live.load(force=args.force)
    # health gate: decide before anything is written
    partial = sum(v["partial"] for v in data.health.values())
    if partial:
        bad = ", ".join(k for k, v in data.health.items() if v["partial"])
        msg = f"decode health gate FAILED: {partial} partial records ({bad}); nothing was written"
        config.atomic_write(config.REPORT, render_failure(data, msg))
        print(f"error: {msg}")
        return 1

    exp = export.write(data, version)
    warnings = list(exp["warnings"])
    root = exp["root"]
    assets = None
    if not args.no_assets:
        from pipeline.assets import export_assets
        assets = export_assets.run(root)
    val = None
    if not args.no_validate:
        if config.mids_available():
            try:
                from pipeline.validate import mids
                val = mids.run(data)
            except Exception as e:  # noqa: BLE001 -- Mids is an untrusted reference
                warnings.append(f"WARNING: Mids validation skipped ({type(e).__name__}: {e})")
        else:
            warnings.append(f"WARNING: Mids validation skipped (no MidsReborn data at {config.MIDS_DATA})")
    default = export.write_indexes(version, label, exp["manifest"]["hash"], args.make_default)
    text = render_report(data, exp, assets, val, warnings)
    config.atomic_write(config.REPORT, text)
    print(f"wrote {config.REPORT} (version {version}, hash {exp['manifest']['hash']}, default {default})")
    for w in warnings:
        print(w)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
