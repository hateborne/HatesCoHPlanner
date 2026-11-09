"""Parse7/Homecoming adjustments to parse_bin.BinReader, applied by import.

Homecoming's binary serializer (vs the leaked OuroV2 one) differs in two ways
that matter for reading the live .bin files:

  * TOK_STASHTABLE_X is actually serialized: u32 count; if count>0 then u32
    bytesize followed by that many bytes. (OuroV2 never wrote stash tables, so
    parse_bin skipped them.) The AttribMod `Params` field uses this.
  * A desynced decode can read a garbage earray count and loop ~forever; we cap
    counts so a mistake raises instead of hanging.

Import this module after parse_bin to patch BinReader in place. Idempotent.
"""
import struct
import parse_bin as PB
from parse_bin import tok_type

up = struct.unpack_from
_SKIP = (PB.TOK_START, PB.TOK_END, PB.TOK_IGNORE, PB.TOK_BIT, PB.TOK_DEPRECATED)

if not getattr(PB.BinReader, "_parse7_patched", False):

    def _read_stash(self):
        n = self.u32()
        if n:
            size = self.u32()
            self.pos += size
        return n

    _orig_scalar = PB.BinReader._read_scalar

    def _read_scalar(self, col):
        if tok_type(col.type) == PB.TOK_STASHTABLE_X:
            return _read_stash(self)
        return _orig_scalar(self, col)
    PB.BinReader._read_scalar = _read_scalar

    _orig_rc = PB.BinReader._read_column

    def _read_column(self, col):
        if col.type & PB.TOK_EARRAY and tok_type(col.type) != PB.TOK_FUNCTIONCALL_X:
            if up("<I", self.data, self.pos)[0] > 100000:
                raise ValueError("insane earray count")
        return _orig_rc(self, col)
    PB.BinReader._read_column = _read_column

    def _read_table(self, table):
        want = self.u32()
        start = self.pos
        out = {}
        auto = 0
        for col in table:
            if col.type & PB.TOK_REDUNDANTNAME:
                continue
            if col.minversion > self.version:
                continue
            if tok_type(col.type) in _SKIP:          # STASHTABLE no longer skipped
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
                raise ValueError(f"datasum mismatch in table: read {got}, "
                                 f"expected {want} (at {start})")
        return out
    PB.BinReader.read_table = _read_table
    PB.BinReader._parse7_patched = True
