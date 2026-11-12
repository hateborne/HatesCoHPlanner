"""MidsReborn as a reference input -- evidence to cross-check against, never a source of truth.

Mids' database is maintained separately from the game and lags (or contradicts) the live client,
so nothing the planner ships is taken from it. It is read for two things only: the name map that
lets the planner import and export Mids files, and the validation report's comparisons. Both are
skipped (the existing map is kept) when no Mids data folder is configured (config.COH_MIDS).
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

from pipeline import config

config.use_tools()
import mids_decode as md  # noqa: E402


def powers() -> list[dict]:
    """Every power in Mids' I12.mhd, decoded with tools/mids_decode.py and cached by file hash.

    @return Power records (FullName, StaticIndex, DisplayName, Effects, ...).
    """
    data = (config.MIDS_DATA / "I12.mhd").read_bytes()
    # keyed by the file and by the decoder, so a decoder fix never reads a stale decode
    key = hashlib.sha1(data + Path(md.__file__).read_bytes().replace(b"\r\n", b"\n")).hexdigest()[:12]
    cache = config.CACHE_DIR / f"mids-powers-{key}.json"
    if cache.exists():
        return json.loads(cache.read_text(encoding="utf-8"))
    r = md.CSReader(data, md.find_section(data, "BEGIN:POWERS"))
    count = r.i32()
    if count <= 0:
        raise ValueError(f"I12.mhd lists {count} powers: not a database this decoder reads")
    out = []
    bad = 0
    for _ in range(count):
        p = md.read_power(r)
        fn = p["FullName"]
        # the decoder's alignment self-check: FullName must look like Group.Set.Power
        if not (fn and "." in fn and p["GroupName"] and p["GroupName"] in fn):
            bad += 1
            if bad > 20:
                # out of step with the file: nothing after this point can be trusted, and a
                # partial list must never be cached or used (overlay.py builds data from it)
                raise ValueError(f"I12.mhd: the decoder lost its place after {len(out)} of {count} powers")
        out.append(p)
    config.atomic_write(cache, json.dumps(out, ensure_ascii=False))
    return out
