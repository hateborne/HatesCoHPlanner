"""Extract the compiled-in parse tables and StaticDefine enums from the live
Homecoming client executable (cityofheroes.exe).

This is the authoritative source of the Parse7 struct layouts: the client reads
the .bin files with these very tables, so recovering them removes all guesswork
about Homecoming's field order / inserts (which differ from the leaked OuroV2
parse tables).

A ParseTable in the exe is an array of 48-byte entries:
    +0  const char* name        (pointer into .rdata)
    +8  u32         type         (engine token word: base | flags)
    +16 u64         storeoffset  (byte offset into the in-memory struct)
    +24 s64         param        (fixed-array count / size)
    +32 ParseTable* subtable     (nested struct table, or a StaticDefine for enums)
    +40 ...
The array ends at a "}" entry (TOK_END) or a non-string name pointer.

Token word = engine `StructTokenType` in the low byte, OR'd with flag bits
(see parse_bin: EARRAY 1<<20, FIXED_ARRAY 1<<21, INDIRECT 1<<22, REDUNDANTNAME
1<<8, SERVER_ONLY 1<<16, CLIENT_ONLY 1<<17, PERSIST 1<<18, NO_TRANSACT 1<<19).
parse_bin.BinReader consumes a column straight from this word.

A StaticDefineInt table is a 3-qword header then stride-24 {char* name, s64
value, pad} entries, terminated by a null/!string name.
"""
import struct
import os
from parse_bin import Column

# the client executable: pass a path, or set COH_EXE (the pipeline passes its configured path)
DEFAULT_EXE = os.environ.get("COH_EXE", "cityofheroes.exe")
STRIDE = 48
TOK_END = 0x02
TOK_STRUCT = 0x1d


class CohExe:
    """PE image of cityofheroes.exe with parse-table / enum extraction."""

    def __init__(self, path=DEFAULT_EXE):
        self.path = path
        self.d = open(path, "rb").read()
        self.imgbase, self.secs = self._parse_pe()
        self._tbl_cache = {}

    # -- PE plumbing --------------------------------------------------------
    def _parse_pe(self):
        d = self.d
        pe = struct.unpack_from("<I", d, 0x3c)[0]
        assert d[pe:pe + 4] == b"PE\x00\x00", "not a PE"
        nsec = struct.unpack_from("<H", d, pe + 6)[0]
        optsz = struct.unpack_from("<H", d, pe + 20)[0]
        magic = struct.unpack_from("<H", d, pe + 24)[0]
        imgbase = (struct.unpack_from("<Q", d, pe + 24 + 24)[0] if magic == 0x20b
                   else struct.unpack_from("<I", d, pe + 24 + 28)[0])
        secbase = pe + 24 + optsz
        secs = []
        for i in range(nsec):
            o = secbase + i * 40
            vsz, va, rsz, ptr = struct.unpack_from("<IIII", d, o + 8)
            secs.append((va, vsz, ptr, rsz))
        return imgbase, secs

    def va2off(self, va):
        r = va - self.imgbase
        for va0, vsz, ptr, rsz in self.secs:
            if va0 <= r < va0 + vsz:
                foff = ptr + (r - va0)
                return foff if foff < ptr + rsz else None
        return None

    def off2va(self, off):
        for va0, vsz, ptr, rsz in self.secs:
            if ptr <= off < ptr + rsz:
                return self.imgbase + va0 + (off - ptr)
        return None

    def cstr(self, off):
        return self.d[off:self.d.index(0, off)].decode("latin1")

    def _str_at(self, va):
        if not (self.imgbase <= va < self.imgbase + 0x1000000):
            return None
        so = self.va2off(va)
        if so is None:
            return None
        try:
            s = self.cstr(so)
        except Exception:
            return None
        return s if 1 <= len(s) <= 48 and all(32 <= ord(c) < 127 for c in s) else None

    def _q(self, va):
        return struct.unpack_from("<Q", self.d, self.va2off(va))[0]

    # -- parse table extraction --------------------------------------------
    def _entry_base(self, va):
        """Token base type of the entry at va, or None if it isn't a parse
        entry (name pointer doesn't resolve to a string)."""
        if self._str_at(self._q(va)) is None:
            return None
        return struct.unpack_from("<Q", self.d, self.va2off(va) + 8)[0] & 0xff

    TOK_START = 0x01

    def find_table_start(self, any_entry_va):
        """Scan back to the first entry of the table. Stops at a table boundary
        (previous entry is TOK_END '}' or not a parse entry). Cryptic tables
        open with a TOK_START '{' marker; if one sits just inside the boundary
        it is the true first column, so we land on it and skip any stray
        metadata entry before it."""
        va = any_entry_va
        while True:
            prev = self._entry_base(va - STRIDE)
            if prev is None or prev == TOK_END:
                break
            va -= STRIDE
        # seek forward to the '{' opener if there is one in the first few entries
        probe = va
        for _ in range(3):
            if self._entry_base(probe) == self.TOK_START:
                return probe
            probe += STRIDE
        return va

    def entry_va_for_field(self, field_name, lo=None, hi=None):
        """VA(s) of parse-table entries whose name is field_name."""
        d = self.d
        soff = d.find(field_name.encode() + b"\x00")
        if soff < 0:
            return []
        sva = self.off2va(soff)
        needle = struct.pack("<Q", sva)
        hits = []
        s = 0
        while True:
            j = d.find(needle, s)
            if j < 0:
                break
            v = self.off2va(j)
            if v is not None and (lo is None or lo <= v < hi):
                hits.append(v)
            s = j + 1
        return hits

    def extract(self, table_va, depth=0):
        """table_va -> list[Column]; follows struct subtables, caches by VA."""
        if table_va in self._tbl_cache:
            return self._tbl_cache[table_va]
        cols = []
        self._tbl_cache[table_va] = cols            # break cycles
        d = self.d
        for i in range(500):
            eoff = self.va2off(table_va) + i * STRIDE
            nm = self._str_at(struct.unpack_from("<Q", d, eoff)[0])
            if nm is None:
                break
            typ = struct.unpack_from("<Q", d, eoff + 8)[0] & 0xffffffff
            param = struct.unpack_from("<q", d, eoff + 24)[0]
            subva = struct.unpack_from("<Q", d, eoff + 32)[0]
            base = typ & 0xff
            if base == TOK_END:
                break
            sub = enum = None
            if base == TOK_STRUCT and self.imgbase <= subva < self.imgbase + 0x1000000:
                sub = self.extract(subva, depth + 1)
            elif self.imgbase <= subva < self.imgbase + 0x1000000:
                enum = subva
            cols.append(Column(nm, typ, param if param > 0 else 0, subtable=sub, enum=enum))
        return cols

    # -- StaticDefine enum extraction --------------------------------------
    def extract_enum(self, va, maxn=400):
        """StaticDefineInt table va -> {value: name}."""
        off = self.va2off(va)
        if off is None:
            return {}
        d = self.d
        base = None
        for i in range(8):
            if self._str_at(struct.unpack_from("<Q", d, off + i * 8)[0]) is not None:
                base = off + i * 8
                break
        if base is None:
            return {}
        out = {}
        for i in range(maxn):
            o = base + i * 24
            nm = self._str_at(struct.unpack_from("<Q", d, o)[0])
            if nm is None:
                break
            val = struct.unpack_from("<q", d, o + 8)[0]
            out.setdefault(val, nm)
        return out


# Known table anchors in the current I28 build (field names resolve the VA, so
# these survive address shifts across patches as long as the fields exist).
def load(path=DEFAULT_EXE):
    return CohExe(path)


def basepower_table(exe):
    """The BasePower parse table (the one with the Effect/AttribMod structs)."""
    for va in exe.entry_va_for_field("FullName"):
        cols = exe.extract(exe.find_table_start(va))
        if any(c.name == "Effect" and (c.type & 0xff) == TOK_STRUCT for c in cols):
            return cols
    raise RuntimeError("BasePower table not found")


def attribmod_inner_table(exe):
    bp = basepower_table(exe)
    eff = next(c for c in bp if c.name == "Effect").subtable
    return next(c for c in eff if c.name == "AttribMod").subtable


def _pick_table(exe, field, must_have):
    for va in exe.entry_va_for_field(field):
        cols = exe.extract(exe.find_table_start(va))
        names = {c.name for c in cols}
        if must_have <= names:
            return cols
    raise RuntimeError(f"table with {must_have} not found via {field}")


def powerset_table(exe):
    return _pick_table(exe, "SetBuyRequires", {"FullName", "Name", "Powers"})


def powercat_table(exe):
    return _pick_table(exe, "PowerSets", {"Name", "PowerSets"})


if __name__ == "__main__":
    exe = load()
    bp = basepower_table(exe)
    print(f"BasePower: {len(bp)} columns; struct earrays:",
          [c.name for c in bp if (c.type & 0xff) == TOK_STRUCT])
    am = attribmod_inner_table(exe)
    print(f"inner AttribMod: {len(am)} columns")
