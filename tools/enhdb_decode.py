#!/usr/bin/env python3
"""Decode MidsReborn's EnhDB.mhd (enhancement + invention-set database).

Same C# BinaryWriter format as I12.mhd. Layout:
  header string, ReadSingle version, int32 enhCount (loop enhCount+1),
  then int32 setCount (loop setCount+1) of EnhancementSet records.

Field order transcribed from MidsReborn source (Core/Enhancement.cs,
Core/EnhancementSet.cs). Each set carries LevelMin/LevelMax, SetType, and a
Bonus[] list where each bonus has `Slotted` (pieces required) and a Name[] of
`Set_Bonus.*` pseudo-power references -- resolved against the decoded powers
DB (powers-live-mids.json) to get the actual bonus magnitudes.

The MidsReborn array convention (int32 = length-1, then length elements; empty
== -1) is shared with mids_decode.read_arr.
"""

import argparse
import json
import sys
from pathlib import Path

from mids_decode import CSReader, read_effect, read_arr


def read_enhancement(r):
    """Core/Enhancement.cs BinaryReader ctor (we mostly skip past these)."""
    e = {}
    e["StaticIndex"] = r.i32()
    e["Name"] = r.string()
    e["ShortName"] = r.string()
    e["Desc"] = r.string()
    e["TypeID"] = r.i32()
    e["SubTypeID"] = r.i32()
    e["ClassID"] = read_arr(r, r.i32)
    e["Image"] = r.string()
    e["nIDSet"] = r.i32()
    e["UIDSet"] = r.string()
    e["EffectChance"] = r.f32()
    e["LevelMin"] = r.i32()
    e["LevelMax"] = r.i32()
    e["Unique"] = r.boolean()
    e["MutExID"] = r.i32()
    e["BuffMode"] = r.i32()
    n = r.i32()                                    # Effect array (length-1)
    effs = []
    for _ in range(n + 1):
        ef = {"Mode": r.i32(), "BuffMode": r.i32(), "EnhanceID": r.i32(),
              "EnhanceSubID": r.i32(), "Schedule": r.i32(), "Multiplier": r.f32()}
        if r.boolean():                            # FX present -> nested Effect
            ef["FX"] = read_effect(r)
        effs.append(ef)
    e["Effects"] = effs
    e["UID"] = r.string()
    e["RecipeName"] = r.string()
    e["Superior"] = r.boolean()
    e["IsProc"] = r.boolean()
    e["IsScalable"] = r.boolean()
    return e


def read_bonus(r):
    b = {"Special": r.i32(), "AltString": r.string(), "PvMode": r.i32(),
         "Slotted": r.i32()}
    n = r.i32()
    b["Names"] = [r.string() for _ in range(n + 1)]
    # Index list is interleaved with names in the source; re-read correctly:
    return b


def read_bonus_correct(r):
    """Bonus: Special, AltString, PvMode, Slotted, then Name[]/Index[] pairs."""
    b = {"Special": r.i32(), "AltString": r.string(), "PvMode": r.i32(),
         "Slotted": r.i32()}
    n = r.i32()
    names = []
    for _ in range(n + 1):
        names.append({"Name": r.string(), "Index": r.i32()})
    b["Names"] = names
    return b


def read_special_bonus(r):
    b = {"Special": r.i32(), "AltString": r.string()}
    n = r.i32()
    names = []
    for _ in range(n + 1):
        names.append({"Name": r.string(), "Index": r.i32()})
    b["Names"] = names
    return b


def read_enh_set(r):
    s = {}
    s["DisplayName"] = r.string()
    s["ShortName"] = r.string()
    s["Uid"] = r.string()
    s["Desc"] = r.string()
    s["SetType"] = r.i32()
    s["Image"] = r.string()
    s["LevelMin"] = r.i32()
    s["LevelMax"] = r.i32()
    n = r.i32()
    s["Enhancements"] = [r.i32() for _ in range(n + 1)]
    n = r.i32()
    s["Bonus"] = [read_bonus_correct(r) for _ in range(n + 1)]
    n = r.i32()
    s["SpecialBonus"] = [read_special_bonus(r) for _ in range(n + 1)]
    return s


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("mhd")
    ap.add_argument("-o", "--out")
    args = ap.parse_args()
    data = Path(args.mhd).read_bytes()
    r = CSReader(data)
    header = r.string()
    version = r.f32()
    ecount = r.i32()
    print(f"header={header!r} version={version} enhCount={ecount}", file=sys.stderr)
    for _ in range(ecount + 1):
        read_enhancement(r)
    print(f"after enhancements: cursor {r.i}/{len(data)}", file=sys.stderr)
    scount = r.i32()
    print(f"setCount={scount}", file=sys.stderr)
    sets = []
    bad = 0
    for idx in range(scount + 1):
        before = r.i
        try:
            s = read_enh_set(r)
        except Exception as ex:
            print(f"  set decode error @{idx} off {before}: {ex}", file=sys.stderr)
            break
        if not s["DisplayName"]:
            bad += 1
        sets.append(s)
    print(f"decoded {len(sets)} sets, {bad} blank; cursor {r.i}/{len(data)}",
          file=sys.stderr)
    out = {"count": len(sets), "sets": sets}
    text = json.dumps(out, indent=1, ensure_ascii=False)
    if args.out:
        Path(args.out).write_text(text, encoding="utf-8")
        print(f"wrote {args.out} ({len(text)} bytes)", file=sys.stderr)
    else:
        # print a few sample sets
        for s in sets[:3]:
            print(json.dumps(s, ensure_ascii=False)[:400])


if __name__ == "__main__":
    main()
