"""Mids <-> game name/ID map for importing and exporting MidsReborn builds.

Writes public/data/<version>/mids-map.json (loaded only when a Mids file or share code is used):
  dbVersion   Mids database version string (from I12.mhd), used in exported .mbd files
  renames     {mids power full name: game power full name} from CrypticPowerNames.mhd
  powers      [[mids StaticIndex, game power id], ...] for the legacy MxDz share format
  enh         [{si, uid, name, type, boost|normal}] for every Mids enhancement:
              boost  = game enhancement power id (set IOs, common IOs, HO/Hydra/Titan/D-Sync)
              normal = boost suffix for TO/DO/SO ("Accuracy"): the game piece depends on grade
                       and origin (Generic_<suffix> / <Origin>_<suffix>)
"""
from __future__ import annotations

import json
import re

from pipeline import config

config.use_tools()
from enhdb_decode import read_enh_set, read_enhancement  # noqa: E402
from mids_decode import CSReader  # noqa: E402


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


def build(live, exporter) -> tuple[dict, dict]:
    """Build the map; returns (map, report)."""
    ids = exporter.ids
    # only map onto powers the site actually ships
    game_names = {n.lower(): n for n in exporter.exported_names}
    rep: dict = {"unmapped_enh": [], "renames_used": 0}

    renames = {}
    for a, b in _renames().items():
        # The table is "old (Mids), new" in either direction; keep the pair whose target exists.
        if b.lower() in game_names and a.lower() not in game_names:
            renames[a] = game_names[b.lower()]
        elif a.lower() in game_names and b.lower() not in game_names:
            renames[b] = game_names[a.lower()]
    rep["renames_used"] = len(renames)

    mids = json.loads((config.DECODED_DIR / "powers-live-mids.json").read_text(encoding="utf-8"))["powers"]
    powers = []
    for p in mids:
        name = renames.get(p["FullName"], p["FullName"])
        real = game_names.get(name.lower())
        if real:
            powers.append([p["StaticIndex"], ids.get("power", real)])

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
                item["boost"] = ids.get("power", real)
            else:
                rep["unmapped_enh"].append(f"{uid} ({e['Name']})")
        enh.append(item)
    return {"dbVersion": _db_version(), "renames": renames, "powers": powers, "enh": enh}, rep


def write(live, exporter, root) -> dict:
    """Write mids-map.json next to the other data files."""
    m, rep = build(live, exporter)
    out = config.out_path(root / "mids-map.json")
    out.write_text(json.dumps(m, separators=(",", ":")), encoding="utf-8")
    rep["bytes"] = out.stat().st_size
    rep["enh_total"] = len(m["enh"])
    rep["powers_total"] = len(m["powers"])
    return rep
