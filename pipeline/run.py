"""Run the whole data pipeline: decode -> export -> assets -> validate -> pipeline/report.md.

Usage (from the repo root):
    python -m pipeline.run            # uses the decode cache when the client is unchanged
    python -m pipeline.run --force    # re-decode everything
    python -m pipeline.run --no-assets
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from pipeline import config  # noqa: E402
from pipeline.decode import live  # noqa: E402


def render_report(data, exp, assets, val) -> str:
    """Markdown summary of a pipeline run."""
    L = []
    m = exp["manifest"]
    L.append(f"# Pipeline report -- data {m['dataVersion']}\n")
    L.append(f"Generated {m['generated']}.\n")
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
    if mm:
        L.append("## Mids map\n")
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
        L.append("## Validation vs MidsReborn (pre-I28 oracle)\n")
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
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--force", action="store_true", help="ignore the decode cache")
    ap.add_argument("--no-assets", action="store_true")
    ap.add_argument("--no-validate", action="store_true")
    args = ap.parse_args()

    from pipeline import export
    data = live.load(force=args.force)
    exp = export.write(data)
    root = config.DATA_OUT / exp["manifest"]["dataVersion"]
    assets = None
    if not args.no_assets:
        from pipeline.assets import export_assets
        assets = export_assets.run(root)
    val = None
    if not args.no_validate:
        from pipeline.validate import mids
        val = mids.run(data)
    text = render_report(data, exp, assets, val)
    config.out_path(config.REPORT).write_text(text, encoding="utf-8")
    print(f"wrote {config.REPORT}")
    partial = sum(v["partial"] for v in data.health.values())
    return 1 if partial else 0


if __name__ == "__main__":
    raise SystemExit(main())
