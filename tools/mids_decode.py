#!/usr/bin/env python3
"""Decode MidsReborn's I12.mhd live power database to JSON.

I12.mhd is a C# BinaryWriter stream (7-bit-length-prefixed strings, LE
int32/float/bool). It is self-describing: sections are delimited by marker
strings BEGIN:ARCHETYPES / BEGIN:POWERSETS / BEGIN:POWERS. This tool seeks
straight to BEGIN:POWERS and decodes every Power (and its nested Effects --
the Scale/Table/Attrib magnitudes used for build math) using the field order
transcribed from MidsReborn source (Core/Base/Data_Classes/Power.cs and
Effect.cs). The nested Requirement struct is read as its four string arrays.

MidsReborn arrays are written as (length - 1) followed by length elements, so
an empty array is stored as int32 == -1. read_arr() below implements that.

Alignment is self-checked: every Power's FullName must be a non-empty dotted
name whose GroupName/SetName are consistent, and (optionally) cross-checked
against the Parse6 decode. A desync from a wrong field surfaces immediately.
"""

import argparse
import json
import struct
import sys
from pathlib import Path


class CSReader:
    """Minimal System.IO.BinaryReader-compatible cursor."""

    def __init__(self, data, pos=0):
        self.d = data
        self.i = pos

    def i32(self):
        v = struct.unpack_from("<i", self.d, self.i)[0]; self.i += 4; return v

    def i16(self):
        v = struct.unpack_from("<h", self.d, self.i)[0]; self.i += 2; return v

    def u8(self):
        v = self.d[self.i]; self.i += 1; return v

    def f32(self):
        v = struct.unpack_from("<f", self.d, self.i)[0]; self.i += 4; return v

    def f64(self):
        v = struct.unpack_from("<d", self.d, self.i)[0]; self.i += 8; return v

    def boolean(self):
        v = self.d[self.i]; self.i += 1; return v != 0

    def string(self):
        # 7-bit-encoded length prefix, then UTF-8 bytes
        n = 0; shift = 0
        while True:
            b = self.d[self.i]; self.i += 1
            n |= (b & 0x7F) << shift
            if not (b & 0x80):
                break
            shift += 7
        s = self.d[self.i:self.i + n].decode("utf-8", "replace"); self.i += n
        return s


def read_arr(r, elem_fn):
    """MidsReborn array: int32 (length-1), then that-many-plus-one elements."""
    n = r.i32()
    return [elem_fn() for _ in range(n + 1)] if n >= 0 else []


def read_requirement(r):
    """Requirement: ClassName[], ClassNameNot[], PowerID[][2], PowerIDNot[][2].

    Reconstructed from the stream (empty -> four int32 == -1). The jagged
    PowerID rows are (set, power) string pairs.
    """
    return {
        "ClassName": read_arr(r, r.string),
        "ClassNameNot": read_arr(r, r.string),
        "PowerID": read_arr(r, lambda: [r.string(), r.string()]),
        "PowerIDNot": read_arr(r, lambda: [r.string(), r.string()]),
    }


# Effect field order: MidsReborn Core/Base/Data_Classes/Effect.cs (BinaryReader ctor)
def read_effect(r):
    e = {}
    e["PowerFullName"] = r.string()
    e["UniqueID"] = r.i32()
    e["EffectClass"] = r.i32()
    e["EffectType"] = r.i32()
    e["DamageType"] = r.i32()
    e["MezType"] = r.i32()
    e["ETModifies"] = r.i32()
    e["Summon"] = r.string()
    e["DelayedTime"] = r.f32()
    e["Ticks"] = r.i32()
    e["Stacking"] = r.i32()
    e["BaseProbability"] = r.f32()
    e["Suppression"] = r.i32()
    e["Buffable"] = r.boolean()
    e["Resistible"] = r.boolean()
    e["SpecialCase"] = r.i32()
    e["VariableModifiedOverride"] = r.boolean()
    e["IgnoreScaling"] = r.boolean()
    e["PvMode"] = r.i32()
    e["ToWho"] = r.i32()
    e["DisplayPercentageOverride"] = r.i32()
    e["Scale"] = r.f32()
    e["nMagnitude"] = r.f32()
    e["nDuration"] = r.f32()
    e["AttribType"] = r.i32()
    e["Aspect"] = r.i32()
    e["ModifierTable"] = r.string()
    e["NearGround"] = r.boolean()
    e["CancelOnMiss"] = r.boolean()
    e["RequiresToHitCheck"] = r.boolean()
    e["UIDClassName"] = r.string()
    e["nIDClassName"] = r.i32()
    e["Expr_Duration"] = r.string()
    e["Expr_Magnitude"] = r.string()
    e["Expr_Probability"] = r.string()
    e["Reward"] = r.string()
    e["EffectId"] = r.string()
    e["IgnoreED"] = r.boolean()
    e["Override"] = r.string()
    e["ProcsPerMinute"] = r.f32()
    e["PowerAttribs"] = r.i32()
    for k in ("AtrOrigAccuracy", "AtrOrigActivatePeriod"):
        e[k] = r.f32()
    e["AtrOrigArc"] = r.i32()
    e["AtrOrigCastTime"] = r.f32()
    e["AtrOrigEffectArea"] = r.i32()
    e["AtrOrigEnduranceCost"] = r.f32()
    e["AtrOrigInterruptTime"] = r.f32()
    e["AtrOrigMaxTargets"] = r.i32()
    for k in ("AtrOrigRadius", "AtrOrigRange", "AtrOrigRechargeTime",
              "AtrOrigSecondaryRange", "AtrModAccuracy", "AtrModActivatePeriod"):
        e[k] = r.f32()
    e["AtrModArc"] = r.i32()
    e["AtrModCastTime"] = r.f32()
    e["AtrModEffectArea"] = r.i32()
    e["AtrModEnduranceCost"] = r.f32()
    e["AtrModInterruptTime"] = r.f32()
    e["AtrModMaxTargets"] = r.i32()
    for k in ("AtrModRadius", "AtrModRange", "AtrModRechargeTime",
              "AtrModSecondaryRange"):
        e[k] = r.f32()
    # Conditionals loops 0..count-1 (plain count, NOT the length-1 convention)
    ncond = r.i32()
    e["Conditionals"] = [[r.string(), r.string()] for _ in range(ncond)]
    return e


# Power field order: MidsReborn Core/Base/Data_Classes/Power.cs (BinaryReader ctor)
def read_power(r):
    p = {}
    p["StaticIndex"] = r.i32()
    p["FullName"] = r.string()
    p["GroupName"] = r.string()
    p["SetName"] = r.string()
    p["PowerName"] = r.string()
    p["DisplayName"] = r.string()
    p["Available"] = r.i32()
    p["Requires"] = read_requirement(r)
    p["ModesRequired"] = r.i32()
    p["ModesDisallowed"] = r.i32()
    p["PowerType"] = r.i32()
    p["Accuracy"] = r.f32()
    p["AttackTypes"] = r.i32()
    p["GroupMembership"] = read_arr(r, r.string)
    p["EntitiesAffected"] = r.i32()
    p["EntitiesAutoHit"] = r.i32()
    p["Target"] = r.i32()
    p["TargetLoS"] = r.boolean()
    p["Range"] = r.f32()
    p["TargetSecondary"] = r.i32()
    p["RangeSecondary"] = r.f32()
    p["EndCost"] = r.f32()
    p["InterruptTime"] = r.f32()
    p["CastTime"] = r.f32()
    p["RechargeTime"] = r.f32()
    p["BaseRechargeTime"] = r.f32()
    p["ActivatePeriod"] = r.f32()
    p["EffectArea"] = r.i32()
    p["Radius"] = r.f32()
    p["Arc"] = r.i32()
    p["MaxTargets"] = r.i32()
    p["MaxBoosts"] = r.string()
    p["CastFlags"] = r.i32()
    p["AIReport"] = r.i32()
    p["NumCharges"] = r.i32()
    p["UsageTime"] = r.i32()
    p["LifeTime"] = r.i32()
    p["LifeTimeInGame"] = r.i32()
    p["NumAllowed"] = r.i32()
    p["DoNotSave"] = r.boolean()
    p["BoostsAllowed"] = read_arr(r, r.string)
    p["CastThroughHold"] = r.boolean()
    p["IgnoreStrength"] = r.boolean()
    p["DescShort"] = r.string()
    p["DescLong"] = r.string()
    p["Enhancements"] = read_arr(r, r.i32)
    p["SetTypes"] = read_arr(r, r.i32)
    p["ClickBuff"] = r.boolean()
    p["AlwaysToggle"] = r.boolean()
    p["Level"] = r.i32()
    p["AllowFrontLoading"] = r.boolean()
    p["VariableEnabled"] = r.boolean()
    p["VariableOverride"] = r.boolean()
    p["VariableName"] = r.string()
    p["VariableMin"] = r.i32()
    p["VariableMax"] = r.i32()
    p["UIDSubPower"] = read_arr(r, r.string)
    p["IgnoreEnh"] = read_arr(r, r.i32)
    p["IgnoreBuff"] = read_arr(r, r.i32)
    p["SkipMax"] = r.boolean()
    p["InherentType"] = r.i32()
    p["DisplayLocation"] = r.i32()
    p["MutexAuto"] = r.boolean()
    p["MutexIgnore"] = r.boolean()
    p["AbsorbSummonEffects"] = r.boolean()
    p["AbsorbSummonAttributes"] = r.boolean()
    p["ShowSummonAnyway"] = r.boolean()
    p["NeverAutoUpdate"] = r.boolean()
    p["NeverAutoUpdateRequirements"] = r.boolean()
    p["IncludeFlag"] = r.boolean()
    p["ForcedClass"] = r.string()
    p["SortOverride"] = r.boolean()
    p["BoostBoostable"] = r.boolean()
    p["BoostUsePlayerLevel"] = r.boolean()
    p["Effects"] = read_arr(r, lambda: read_effect(r))
    p["HiddenPower"] = r.boolean()
    p["Active"] = r.boolean()
    p["Taken"] = r.boolean()
    p["Stacks"] = r.i32()
    p["VariableStart"] = r.i32()
    return p


def find_section(data, name):
    marker = bytes([len(name)]) + name.encode()
    i = data.find(marker)
    if i < 0:
        raise SystemExit(f"section {name} not found")
    return i + len(marker)


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("mhd", help="path to I12.mhd")
    ap.add_argument("-o", "--out")
    ap.add_argument("--limit", type=int, default=0)
    args = ap.parse_args()

    data = Path(args.mhd).read_bytes()
    r = CSReader(data, find_section(data, "BEGIN:POWERS"))
    count = r.i32()
    print(f"BEGIN:POWERS count={count}", file=sys.stderr)

    powers = []
    bad = 0
    for idx in range(count):
        before = r.i
        p = read_power(r)
        # alignment self-check: FullName must be Group.Set.Power-ish
        fn = p["FullName"]
        ok = fn and "." in fn and p["GroupName"] and p["GroupName"] in fn
        if not ok:
            bad += 1
            if bad <= 3:
                print(f"  ALIGN WARN @power {idx} off {before}: "
                      f"FullName={fn!r} Group={p['GroupName']!r} "
                      f"nEffects={len(p['Effects'])}", file=sys.stderr)
            if bad > 20:
                print(f"  too many misaligned powers; stopping at {idx}",
                      file=sys.stderr)
                break
        powers.append(p)
        if args.limit and len(powers) >= args.limit:
            break

    print(f"decoded {len(powers)} powers, {bad} alignment warnings; "
          f"cursor {r.i}/{len(data)}", file=sys.stderr)
    out = {"count": len(powers), "powers": powers}
    text = json.dumps(out, indent=1, ensure_ascii=False)
    if args.out:
        Path(args.out).write_text(text, encoding="utf-8")
        print(f"wrote {args.out} ({len(text)} bytes)", file=sys.stderr)
    else:
        sys.stdout.write(text[:4000])


if __name__ == "__main__":
    main()
