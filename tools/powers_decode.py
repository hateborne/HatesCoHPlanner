#!/usr/bin/env python3
"""Decode City of Heroes power dictionary bins to JSON.

Pulls a compiled bin straight out of a .pigg (in memory, via pigg_extract),
reads the CrypticS/Files1 header, then drives parse_bin.BinReader with the
transcribed tables in power_tables. With no external oracle needed: every
struct is length-prefixed and datasum-validated, so a clean full parse to EOF
is strong evidence the transcription is byte-correct.

Usage:
  powers_decode.py <pigg> <bin/path.bin> <cat|set|power> [-o out.json]
                                                          [--lenient] [--limit N]
"""

import argparse
import io
import json
import struct
import sys
import zlib
from pathlib import Path

import pigg_extract as pe
import parse_bin
import power_tables as pt

TABLES = {
    "cat": ("ParsePowerCatDictionary", pt.ParsePowerCatDictionary),
    "set": ("ParsePowerSetDictionary", pt.ParsePowerSetDictionary),
    "power": ("ParsePowerDictionary", pt.ParsePowerDictionary),
}


def load_bin_from_pigg(pigg_path, member):
    """Return the inflated bytes of `member` inside `pigg_path`."""
    with open(pigg_path, "rb") as f:
        entries = pe.read_directory(f)
        want = member.replace("\\", "/")
        e = next((x for x in entries if x["path"].replace("\\", "/") == want),
                 None)
        if not e:
            raise SystemExit(f"{member!r} not in {pigg_path}")
        f.seek(e["offset"])
        raw = f.read(e["packSize"]) if e["packSize"] else f.read(e["size"])
    return zlib.decompress(raw) if member and e["packSize"] else raw


def read_header(data):
    """Consume the bin header; return (filetype, body_pos, string_pool).

    Parse6/ParV23: CrypticS + crc + pascal filetype + "Files1" file-table
    chunk, then the record blob. string_pool is None (strings are inline).

    Parse7 (Homecoming): CrypticS + crc + pascal filetype + u32 pool-size +
    the string pool, then the record blob. Strings in records are u32 byte
    offsets into that pool, so we return it for the reader to dereference.
    """
    if data[:8] != b"CrypticS":
        raise SystemExit("not a CrypticS bin")
    pos = 8
    pos += 4                                            # parse-table CRC
    (ln,) = struct.unpack_from("<H", data, pos); pos += 2
    filetype = data[pos:pos + ln].decode("latin-1"); pos += ln
    pos += (4 - (ln + 2) % 4) % 4                       # pascal padding

    if filetype == "Parse7":
        (poolsize,) = struct.unpack_from("<I", data, pos); pos += 4
        pool = data[pos:pos + poolsize]; pos += poolsize
        pos = (pos + 3) & ~3    # record blob is 4-byte aligned after the pool
        return filetype, pos, pool

    (ln,) = struct.unpack_from("<H", data, pos); pos += 2
    name = data[pos:pos + ln].decode("latin-1"); pos += ln
    pos += (4 - (ln + 2) % 4) % 4
    if name != "Files1":
        raise SystemExit(f"expected Files1, got {name!r}")
    (size,) = struct.unpack_from("<I", data, pos); pos += 4
    pos += size                                         # skip file table
    return filetype, pos, None


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("pigg")
    ap.add_argument("member")
    ap.add_argument("kind", choices=list(TABLES))
    ap.add_argument("-o", "--out")
    ap.add_argument("--lenient", action="store_true",
                    help="skip unknown appended fields (newer file version)")
    ap.add_argument("--limit", type=int, default=0,
                    help="only keep first N top-level entries in output")
    args = ap.parse_args()

    data = load_bin_from_pigg(args.pigg, args.member)
    filetype, body, pool = read_header(data)
    version = parse_bin.version_for(filetype)
    _, table = TABLES[args.kind]

    r = parse_bin.BinReader(data, version=version, lenient=args.lenient,
                            pool=pool)
    r.pos = body
    top = r.read_table(table)
    if r.pos != len(data):
        print(f"WARNING: {len(data) - r.pos} trailing bytes after top table",
              file=sys.stderr)

    # top table has one struct-earray column; unwrap it
    (col_name, entries), = top.items()
    print(f"{filetype} (v{version}): {col_name} -> {len(entries)} entries; "
          f"parsed to byte {r.pos}/{len(data)}", file=sys.stderr)

    if args.limit:
        entries = entries[:args.limit]
    out = {"filetype": filetype, "member": args.member,
           "column": col_name, "count": len(entries), "entries": entries}
    text = json.dumps(out, indent=1, ensure_ascii=False)
    if args.out:
        Path(args.out).write_text(text, encoding="utf-8")
        print(f"wrote {args.out} ({len(text)} bytes)", file=sys.stderr)
    else:
        sys.stdout.write(text)


if __name__ == "__main__":
    main()
