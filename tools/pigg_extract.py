#!/usr/bin/env python3
"""Headless .pigg archive extractor for City of Heroes data files.

A scriptable replacement for Piglet's (unimplemented) unattended mode. The
format is transcribed from Piglet source: CityOfHeroes_OuroV2_Piglet/src/vfs.cpp
(PigHeader / PigFileHeader / string pool / data pool structs, ~lines 14-322).

Layout of a .pigg file:
  PigHeader        (16 bytes): u32 flag=0x123, u16 creatorVer, u16 requiredVer,
                               u16 archiveHeaderSize, u16 fileHeaderSize, u32 numFiles
  PigFileHeader[n] (48 bytes): u32 flag=0x3456, i32 nameId, u32 size, u32 timestamp,
                               u32 offset, u32 reserved, i32 headerDataId,
                               u32 checksum[4] (MD5), u32 packSize
  PigStringPool    (12 bytes): u32 flag=0x6789, u32 numStrings, u32 poolSize
                   then per string: u32 byteLen, <byteLen> bytes (incl. trailing NUL)
                   -- the i-th string is the path of the i-th PigFileHeader
  PigDataPool      (12 bytes): u32 flag=0x9abc, u32 numEntries, u32 poolSize (unused)
  File data at each header's `offset`: packSize bytes of zlib stream if
  packSize != 0 (inflates to `size` bytes), otherwise `size` raw bytes.

Usage:
  python pigg_extract.py <archive.pigg> [more.pigg ...] -o <output_dir> [--list]

Each archive extracts into <output_dir>/<archive-stem>/<internal-path>.
"""

import argparse
import struct
import sys
import zlib
from pathlib import Path

PIG_HEADER_FLAG = 0x00000123
PIG_FILE_HEADER_FLAG = 0x00003456
PIG_STRING_POOL_FLAG = 0x00006789
PIG_DATA_POOL_FLAG = 0x00009ABC
PIG_VERSION = 2

PIG_HEADER = struct.Struct("<IHHHHI")        # 16 bytes
PIG_FILE_HEADER = struct.Struct("<IiIIIIi4II")  # 48 bytes


class PiggError(RuntimeError):
    pass


def read_exact(f, n):
    data = f.read(n)
    if len(data) != n:
        raise PiggError(f"Truncated read: wanted {n} bytes, got {len(data)}")
    return data


def read_directory(f):
    """Parse pigg header + file headers + string pool. Returns list of entries:
    dicts with path, size, packSize, offset, timestamp."""
    flag, creator_ver, required_ver, hdr_size, file_hdr_size, num_files = (
        PIG_HEADER.unpack(read_exact(f, PIG_HEADER.size)))
    if flag != PIG_HEADER_FLAG:
        raise PiggError(f"Not a pigg file (header flag 0x{flag:08x})")
    if required_ver > PIG_VERSION:
        raise PiggError(f"Unsupported pigg version {required_ver}")

    headers = []
    gap = file_hdr_size - PIG_FILE_HEADER.size
    for _ in range(num_files):
        raw = read_exact(f, PIG_FILE_HEADER.size)
        if gap > 0:
            read_exact(f, gap)  # skip unknown trailing header bytes
        (fflag, name_id, size, timestamp, offset, _reserved, _hdr_data_id,
         _c0, _c1, _c2, _c3, pack_size) = PIG_FILE_HEADER.unpack(raw)
        if fflag != PIG_FILE_HEADER_FLAG:
            raise PiggError(f"Bad file header flag 0x{fflag:08x}")
        headers.append({"nameId": name_id, "size": size, "timestamp": timestamp,
                        "offset": offset, "packSize": pack_size})

    sflag, num_strings, _pool_size = struct.unpack("<III", read_exact(f, 12))
    if sflag != PIG_STRING_POOL_FLAG:
        raise PiggError(f"Bad string pool flag 0x{sflag:08x}")

    # Piglet pairs string i with file header i (vfs.cpp:298-311).
    count = min(num_strings, len(headers))
    for i in range(count):
        (str_size,) = struct.unpack("<I", read_exact(f, 4))
        if str_size == 0:
            raise PiggError("Zero-length string pool entry")
        raw = read_exact(f, str_size)
        headers[i]["path"] = raw.rstrip(b"\x00").decode("utf-8", "replace")

    unnamed = [h for h in headers if "path" not in h]
    if unnamed:
        raise PiggError(f"{len(unnamed)} file headers without string pool names")
    return headers


def extract_entry(f, entry, out_root):
    rel = Path(entry["path"].replace("\\", "/"))
    if rel.is_absolute() or ".." in rel.parts:
        raise PiggError(f"Refusing suspicious path {entry['path']!r}")
    dest = out_root / rel
    dest.parent.mkdir(parents=True, exist_ok=True)

    f.seek(entry["offset"])
    if entry["packSize"]:
        data = zlib.decompress(read_exact(f, entry["packSize"]))
        if len(data) != entry["size"]:
            raise PiggError(
                f"{entry['path']}: inflated {len(data)} bytes, expected {entry['size']}")
    else:
        data = read_exact(f, entry["size"])
    dest.write_bytes(data)
    return len(data)


def process_archive(pigg_path, out_dir, list_only=False):
    pigg_path = Path(pigg_path)
    with pigg_path.open("rb") as f:
        entries = read_directory(f)
        print(f"{pigg_path.name}: {len(entries)} entries")
        if list_only:
            for e in entries:
                packed = f" (packed {e['packSize']})" if e["packSize"] else ""
                print(f"  {e['path']}  {e['size']} bytes{packed}")
            return len(entries), 0

        out_root = Path(out_dir) / pigg_path.stem
        total_bytes = 0
        for i, e in enumerate(entries, 1):
            total_bytes += extract_entry(f, e, out_root)
            if i % 500 == 0 or i == len(entries):
                print(f"  [{i}/{len(entries)}] {total_bytes / 1e6:.1f} MB written",
                      flush=True)
        print(f"{pigg_path.name}: extracted {len(entries)} files, "
              f"{total_bytes / 1e6:.1f} MB -> {out_root}")
        return len(entries), total_bytes


def main():
    ap = argparse.ArgumentParser(description="Extract City of Heroes .pigg archives")
    ap.add_argument("piggs", nargs="+", help=".pigg files to extract")
    ap.add_argument("-o", "--out", default="extracted", help="output directory")
    ap.add_argument("--list", action="store_true", help="list contents only")
    args = ap.parse_args()

    failures = 0
    for p in args.piggs:
        try:
            process_archive(p, args.out, args.list)
        except (PiggError, OSError) as exc:
            failures += 1
            print(f"ERROR: {p}: {exc}", file=sys.stderr)
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
