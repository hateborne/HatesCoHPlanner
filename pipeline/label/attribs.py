"""Label raw AttribMod `Attrib` byte offsets using tables compiled into cityofheroes.exe.

* Offsets 0..464 come from the CharacterAttributes parse table (one float per attribute; the
  storeoffset IS the byte offset an AttribMod stores). Homecoming inserted Absorb at 84, so
  everything after 80 differs from the I24 headers.
* Offsets 468+ are the special attributes from the power-system StaticDefine that contains
  `kGrantPower` (kTranslucency 468 ... kExecutePower 512, kPowerRedirect 1468).
"""
from __future__ import annotations

import struct

from pipeline.coh import p7reader as P

REDUNDANT = 1 << 8


def character_attributes() -> dict[int, dict]:
    """{offset: {"name", "aliases"}} for the CharacterAttributes struct."""
    x = P.exe()
    for va in P.field_entries(x, "DamageType00"):
        start = x.find_table_start(va)
        off = x.va2off(start)
        rows = []
        for i in range(400):
            eo = off + i * 48
            name = x._str_at(struct.unpack_from("<Q", x.d, eo)[0])
            if name is None:
                break
            typ = struct.unpack_from("<I", x.d, eo + 8)[0]
            so = struct.unpack_from("<Q", x.d, eo + 16)[0]
            rows.append((name, typ, so))
        names = {r[0] for r in rows}
        # The CharacterAttributes table is the one with 4-byte float stride ending at Gravity.
        if "Gravity" not in names or "Absorb" not in names:
            continue
        if next(so for n, _, so in rows if n == "DamageType01") != 4:
            continue
        out: dict[int, dict] = {}
        for name, typ, so in rows:
            if (typ & 0xFF) != 7:  # F32 columns only (skip '{' / '}')
                continue
            if typ & REDUNDANT:
                out.setdefault(so, {"name": name, "aliases": []})["aliases"].append(name)
            else:
                out.setdefault(so, {"name": name, "aliases": []})["name"] = name
        return out
    raise RuntimeError("CharacterAttributes parse table not found in exe")


def special_attributes() -> dict[int, dict]:
    """{offset: {"name", "aliases"}} for the special (non-float) attributes, k-prefix stripped."""
    x = P.exe()
    va = P.field_entries(x, "kGrantPower")[0]
    o = x.va2off(va)
    while x._str_at(struct.unpack_from("<Q", x.d, o - 24)[0]) is not None:
        o -= 24
    out: dict[int, dict] = {}
    while True:
        name = x._str_at(struct.unpack_from("<Q", x.d, o)[0])
        if name is None:
            break
        val = struct.unpack_from("<q", x.d, o + 8)[0]
        nm = name[1:] if name.startswith("k") else name
        if val in out:
            out[val]["aliases"].append(nm)
        else:
            out[val] = {"name": nm, "aliases": []}
        o += 24
    return out


def all_attributes() -> dict[int, dict]:
    """Every labelled attribute offset, each tagged kind 'float' or 'special'."""
    out = {k: {**v, "kind": "float"} for k, v in character_attributes().items()}
    for k, v in special_attributes().items():
        out.setdefault(k, {**v, "kind": "special"})
    return out
