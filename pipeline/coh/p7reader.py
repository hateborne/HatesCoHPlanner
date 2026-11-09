"""Parse7 (Homecoming live) bin reader built on the U:\\ decoder tools.

Adds three Homecoming rules on top of parse_bin.BinReader + parse7_patch:

1. Columns whose type word has bit 18 set are NOT serialized into the .bin (e.g. BasePower's
   legacy `AttribMod` earray, classes' `_FinalAttr*`). Reading a phantom count for them shifts
   every later column one word, which is why tools/decode_live.py had to stop early.
2. Optionally, TOK_LINK strings are inline pascal strings instead of string-pool offsets
   (boostsets.bin).
3. Top-level framing helpers: earray-of-structs (most bins) and single-struct (schedules).

Records are read whole and must land exactly on their datasum end; a record that fails is
re-read leniently, flagged `_partial`, and counted so the pipeline can gate on zero.
"""
from __future__ import annotations

import struct
import zlib
from dataclasses import dataclass, field
from pathlib import Path

from pipeline import config

config.use_tools()
import coh_exe  # noqa: E402
import parse7_patch  # noqa: E402,F401  (patches parse_bin.BinReader on import)
import parse_bin as PB  # noqa: E402
import pigg_extract as pex  # noqa: E402
import powers_decode as pd  # noqa: E402

TOK_NOBIN = 1 << 18
_SKIP = (PB.TOK_START, PB.TOK_END, PB.TOK_IGNORE, PB.TOK_BIT, PB.TOK_DEPRECATED)
Column = PB.Column


class P7Reader(PB.BinReader):
    """BinReader with the Homecoming no-bin skip and optional inline link strings."""

    def __init__(self, data, pool, inline_links: bool = False):
        super().__init__(data, version=2, lenient=False, pool=pool)
        self.inline_links = inline_links

    def _read_scalar(self, col):
        t = PB.tok_type(col.type)
        if self.inline_links and t == PB.TOK_LINK_X:
            return self.pascal()
        if t == PB.TOK_STASHTABLE_X:
            return self._read_params()
        return super()._read_scalar(col)

    def _read_params(self):
        """Homecoming stash table (AttribMod `Params`): u32 count; if >0, u32 size + bytes.

        The bytes are a param struct whose strings are string-pool offsets. We keep the raw u32
        words plus, per word index, the pool string it would point at. For the power-list params
        (kGrantPower etc.) the layout is [type, 0, count, count x name offset, ...]; callers
        interpret by attribute.
        """
        n = self.u32()
        if not n:
            return None
        size = self.u32()
        raw = self.data[self.pos:self.pos + size]
        self.pos += size
        words = list(struct.unpack_from(f"<{size // 4}I", raw)) if size >= 4 else []
        strings = {}
        pool = self.pool
        if pool is not None:
            for i, w in enumerate(words):
                if 0 < w < len(pool) and pool[w - 1] == 0 and pool[w] != 0:
                    end = pool.find(b"\x00", w)
                    s = pool[w:end]
                    if 2 <= len(s) <= 160 and all(32 <= c < 127 for c in s):
                        strings[i] = s.decode("latin-1")
        return {"n": n, "words": words, "strings": strings}

    def read_table(self, table):
        want = self.u32()
        start = self.pos
        out = {}
        auto = 0
        for col in table:
            if col.type & (PB.TOK_REDUNDANTNAME | TOK_NOBIN):
                continue
            if col.minversion > self.version:
                continue
            if PB.tok_type(col.type) in _SKIP:
                continue
            if self.lenient and self.pos >= start + want:
                break
            val = self._read_column(col)
            key = col.name if col.name else f"_auto{auto}"
            if not col.name:
                auto += 1
            out[key] = val
        got = self.pos - start
        if got != want:
            if self.lenient and got < want:
                self.pos = start + want
            else:
                raise ValueError(f"datasum mismatch: read {got}, expected {want} (at {start})")
        return out


def param_power_names(params) -> list[str]:
    """Power names carried by a kGrantPower/kRevokePower/kExecutePower style Params block."""
    if not params:
        return []
    w = params["words"]
    if len(w) < 3:
        return []
    count = w[2]
    return [params["strings"][i] for i in range(3, 3 + count) if i in params["strings"]]


def load_member(pigg: Path, member: str) -> bytes:
    """Inflated bytes of `member` (e.g. 'bin/classes.bin') inside a .pigg."""
    with open(pigg, "rb") as f:
        e = next(x for x in pex.read_directory(f) if x["path"].replace("\\", "/") == member)
        f.seek(e["offset"])
        raw = f.read(e["packSize"]) if e["packSize"] else f.read(e["size"])
    return zlib.decompress(raw) if e["packSize"] else raw


@dataclass
class DecodeResult:
    """Records decoded from one bin plus per-record health."""

    records: list = field(default_factory=list)
    clean: int = 0
    partial: list = field(default_factory=list)  # (index, error) for records re-read leniently


def decode_earray(data: bytes, table, inline_links: bool = False, limit: int | None = None,
                  wrapper=None) -> DecodeResult:
    """Decode a bin whose top table is one earray of `table` structs.

    @param data Inflated bin bytes.
    @param table Element parse table (list[Column]).
    @param inline_links Read TOK_LINK strings as inline pascal strings.
    @param limit Stop after this many records (debugging).
    @param wrapper Optional callable(reader, table) used instead of read_table per element.
    @return DecodeResult with records in file order.
    """
    _, body, pool = pd.read_header(data)
    count = struct.unpack_from("<I", data, body + 4)[0]
    p = body + 8
    res = DecodeResult()
    for i in range(count if limit is None else min(count, limit)):
        ds = struct.unpack_from("<I", data, p)[0]
        end = p + 4 + ds
        r = P7Reader(data, pool, inline_links)
        r.pos = p
        try:
            rec = (wrapper or P7Reader.read_table)(r, table)
            if r.pos != end:
                raise ValueError(f"ended at {r.pos}, record end {end}")
            res.clean += 1
        except Exception as ex:  # noqa: BLE001 -- any desync is reported, record re-read leniently
            r = P7Reader(data, pool, inline_links)
            r.lenient = True
            r.pos = p
            try:
                rec = r.read_table(table)
            except Exception:  # noqa: BLE001
                rec = {}
            rec["_partial"] = str(ex)[:120]
            res.partial.append((i, str(ex)[:120]))
        res.records.append(rec)
        p = end
    return res


def decode_single(data: bytes, table, inline_links: bool = False) -> dict:
    """Decode a bin whose top table is a single struct (e.g. schedules.bin)."""
    _, body, pool = pd.read_header(data)
    r = P7Reader(data, pool, inline_links)
    r.pos = body
    return r.read_table(table)


# ---- exe parse-table lookup ------------------------------------------------------------------

_EXE = None


def exe():
    """Cached CohExe for the live client."""
    global _EXE
    if _EXE is None:
        _EXE = coh_exe.load(str(config.EXE))
    return _EXE


def field_entries(x, name: str) -> list[int]:
    """VAs of every parse-table entry named `name` (all string copies, exact matches only)."""
    d = x.d
    needle = name.encode() + b"\x00"
    hits = []
    s = 0
    while True:
        soff = d.find(needle, s)
        if soff < 0:
            break
        s = soff + 1
        if soff > 0 and d[soff - 1] != 0:
            continue  # suffix of a longer string
        sva = x.off2va(soff)
        if sva is None:
            continue
        ptr = struct.pack("<Q", sva)
        j = 0
        while True:
            j = d.find(ptr, j)
            if j < 0:
                break
            v = x.off2va(j)
            if v is not None:
                hits.append(v)
            j += 1
    return hits


def pick_table(anchor: str, must_have: set[str]):
    """The parse table containing a column named `anchor` and all names in `must_have`."""
    x = exe()
    seen = set()
    for va in field_entries(x, anchor):
        try:
            start = x.find_table_start(va)
        except Exception:  # noqa: BLE001 -- not a parse entry
            continue
        if start in seen:
            continue
        seen.add(start)
        cols = x.extract(start)
        if must_have <= {c.name for c in cols}:
            return cols
    raise RuntimeError(f"parse table with {sorted(must_have)} not found via {anchor!r}")


def enum_of(table, column: str) -> dict:
    """{value: name} StaticDefine for an enum-typed column, or {}."""
    c = next((c for c in table if c.name == column), None)
    return exe().extract_enum(c.enum) if c is not None and c.enum else {}


def describe(table, indent: int = 0, depth: int = 1) -> str:
    """Debug dump of a parse table: index, name, hex type, flags."""
    lines = []
    for i, c in enumerate(table):
        flags = []
        if c.type & PB.TOK_EARRAY:
            flags.append("earray")
        if c.type & PB.TOK_FIXED_ARRAY:
            flags.append(f"fixed[{c.param}]")
        if c.type & TOK_NOBIN:
            flags.append("NOBIN")
        if c.type & PB.TOK_REDUNDANTNAME:
            flags.append("redundant")
        lines.append(f"{' ' * indent}{i:3d} {c.name:32s} {c.type:#010x} base={PB.tok_type(c.type)} {' '.join(flags)}")
        if c.subtable and depth > 0:
            lines.append(describe(c.subtable, indent + 4, depth - 1))
    return "\n".join(lines)
