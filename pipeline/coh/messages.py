"""Decoder for the live client message store (bin/clientmessages-en.bin).

Layout (little-endian, verified to parse to the exact last byte of the I28 file):
  u32 hash/version (unused), u32 nStrings, u32 stringBlockSize, stringBlock
      (nStrings NUL-terminated strings; index 0..nStrings-1)
  u32 nVars, u32 varBlockSize, varBlock (nVars NUL-terminated variable names)
  u32 nKeys, then per key:
      u32 keyLen, key bytes, u32 textIndex, u32 helpIndex, u32 nVarRefs, nVarRefs x u32 var index
Keys are either legacy `P<number>` IDs or Homecoming's 26-character keys.
"""
from __future__ import annotations

import struct


def decode_messages(data: bytes) -> dict[str, str]:
    """Map every message key to its English text.

    @param data Inflated bytes of clientmessages-en.bin.
    @return {key: text}.
    """
    up = struct.unpack_from
    _, n, size = up("<3I", data, 0)
    strings = data[12:12 + size].split(b"\x00")[:n]
    p = 12 + size
    _, vsize = up("<2I", data, p)
    p += 8 + vsize
    (nkeys,) = up("<I", data, p)
    p += 4
    out: dict[str, str] = {}
    for _ in range(nkeys):
        (klen,) = up("<I", data, p)
        p += 4
        key = data[p:p + klen].decode("latin-1")
        p += klen
        text_i, _help_i, nvars = up("<3I", data, p)
        p += 12 + 4 * nvars
        out[key] = strings[text_i].decode("cp1252", errors="replace")
    if p != len(data):
        raise ValueError(f"clientmessages parse ended at {p}, file is {len(data)} bytes")
    return out
