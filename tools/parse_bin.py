#!/usr/bin/env python3
"""Generic reader for Cryptic "Parse6"/"ParV23"/"Parse7" .bin data files.

This is a faithful port of the engine's parse-table-driven binary
deserializer (CityOfHeroes_OuroV2_Source/libs/UtilitiesLib/src/utils/
textparser.c ParserReadBinaryTable + the per-token readbin functions, and
structInternals.c g_tokentable/g_arraytable). Instead of a hand-written
decoder per file (see bin_decode.py, which only does experience.bin), this
drives off a transcribed ParseTable (see power_tables.py) so any bin whose
schema we transcribe decodes with the same code.

Binary format recap (little-endian throughout):
  header: "CrypticS", u32 parse-table CRC, pascal filetype ("Parse6" etc),
          pascal "Files1" + u32 chunkSize (file table, skipped)
  then ParserReadBinaryTable(topTable):
    u32 datasum  (byte length of everything the table's columns produce)
    for each column (in table order, skipping TOK_REDUNDANTNAME and any
      column whose minversion > file version):
        the column's value, framed per its storage class and base type

Storage class (from the type word): earray (TOK_EARRAY) reads u32 count then
count elements; fixed array (TOK_FIXED_ARRAY) reads `param` elements with no
count; otherwise a single value. Base types widen to 4 bytes on disk (U8/
INT16/BOOL/enum ints included); INT64 is 8; F32 is 4; strings are pascal
(u16 len + bytes, zero-padded so 2+len is a multiple of 4); structs recurse
into ParserReadBinaryTable, each with their own u32 datasum prefix.

Every struct is length-prefixed and the engine validates the byte count, so a
wrong field width desyncs immediately -- we assert the same datasum, which
doubles as a self-check on a transcribed table. In lenient mode (for a newer
file version that appended unknown fields) we instead skip to the struct's
declared end.

Pascal-string / header plumbing is shared with bin_decode.Reader/read_header.
"""

import struct

# ---- token base types (textparser.h enum StructTokenType) -----------------
(TOK_IGNORE, TOK_START, TOK_END,
 TOK_U8_X, TOK_INT16_X, TOK_INT_X, TOK_INT64_X, TOK_F32_X, TOK_DEGREES_X,
 TOK_STRING_X, TOK_CHAR_X, TOK_RAW_X, TOK_POINTER_X,
 TOK_CURRENTFILE_X, TOK_TIMESTAMP_X, TOK_LINENUM_X, TOK_USEDFIELD_X,
 TOK_BOOL_X, TOK_FLAGS_X, TOK_FLAGARRAY_X, TOK_BOOLFLAG_X,
 TOK_QUATPYR_X, TOK_MATPYR_X, TOK_CONDRGB_X, TOK_FILENAME_X,
 TOK_LINK_X, TOK_REFERENCE_X, TOK_FUNCTIONCALL_X, TOK_UNPARSED_X,
 TOK_STRUCT_X, TOK_STASHTABLE_X, TOK_BIT, TOK_DEPRECATED) = range(33)

# ---- option / storage flags (textparser.h) --------------------------------
TOK_TYPE_MASK    = (1 << 8) - 1
TOK_REDUNDANTNAME = 1 << 8
TOK_STRUCTPARAM   = 1 << 9
TOK_EARRAY        = 1 << 20
TOK_FIXED_ARRAY   = 1 << 21
TOK_INDIRECT      = 1 << 22
TOK_POOL_STRING   = 1 << 23


def tok_type(t):
    return t & TOK_TYPE_MASK


# ---- parse version numbers (serialize.c validParseTypes) ------------------
# {"Parse6", "ParV23"}; Homecoming appended "Parse7".
PARSE_VERSIONS = {"Parse6": 0, "ParV23": 1, "Parse7": 2}


class Column:
    """One row of a transcribed ParseTable (mirrors struct ParseTable).

    `param` is the default/size/fixed-count field; `subtable` points at a
    nested ParseTable for TOK_STRUCT_X. `enum` holds the StaticDefine name
    for labeling (unused while reading). `minversion` gates the field.
    """
    __slots__ = ("name", "type", "param", "subtable", "enum", "minversion")

    def __init__(self, name, type_, param=0, subtable=None, enum=None,
                 minversion=0):
        self.name = name
        self.type = type_
        self.param = param
        self.subtable = subtable
        self.enum = enum
        self.minversion = minversion


class BinReader:
    """Cursor over an inflated .bin body with datasum-checked table reads."""

    def __init__(self, data, version=0, lenient=False, pool=None):
        self.data = data
        self.pos = 0
        self.version = version
        # lenient: tolerate a struct being longer than our table knows about
        # (newer file version appended fields) by skipping to its declared end.
        self.lenient = lenient
        # Parse7 (Homecoming) stores strings as a u32 byte-offset into a shared
        # front-loaded string pool instead of inline pascal strings. When pool
        # is set, string-typed fields read 4 bytes and dereference the pool.
        self.pool = pool

    # -- low level ----------------------------------------------------------
    def _take(self, n):
        b = self.data[self.pos:self.pos + n]
        if len(b) != n:
            raise ValueError(f"truncated at {self.pos}: wanted {n}")
        self.pos += n
        return b

    def u16(self):
        return struct.unpack_from("<H", self._take(2))[0]

    def u32(self):
        return struct.unpack_from("<I", self._take(4))[0]

    def i32(self):
        return struct.unpack_from("<i", self._take(4))[0]

    def i64(self):
        return struct.unpack_from("<q", self._take(8))[0]

    def f32(self):
        return struct.unpack_from("<f", self._take(4))[0]

    def pascal(self):
        n = self.u16()
        s = self._take(n).decode("latin-1")
        pad = (4 - (n + 2) % 4) % 4
        self._take(pad)
        return s

    def pooled_string(self):
        """Parse7 string: u32 byte-offset into the shared string pool."""
        off = self.u32()
        end = self.pool.index(0, off)
        return self.pool[off:end].decode("latin-1")

    def read_string(self):
        return self.pooled_string() if self.pool is not None else self.pascal()

    # -- base-type readers (mirror *_readbin) -------------------------------
    def _read_scalar(self, col):
        t = tok_type(col.type)
        if t in (TOK_IGNORE, TOK_START, TOK_END, TOK_BIT, TOK_DEPRECATED,
                 TOK_STASHTABLE_X):
            return None                                     # readbin == 0
        if t == TOK_INT64_X:
            return self.i64()
        if t in (TOK_F32_X, TOK_DEGREES_X, TOK_QUATPYR_X):
            return self.f32()
        if t == TOK_MATPYR_X:                               # stored as pyr
            return [self.f32(), self.f32(), self.f32()]
        if t in (TOK_STRING_X, TOK_CURRENTFILE_X, TOK_FILENAME_X,
                 TOK_LINK_X, TOK_REFERENCE_X):
            return self.read_string()
        if t in (TOK_CHAR_X, TOK_RAW_X):                    # raw param bytes+pad
            size = col.param
            pad = ((size + 3) & ~3) - size
            b = self._take(size)
            if pad:
                self._take(pad)
            return b
        if t in (TOK_POINTER_X, TOK_USEDFIELD_X):           # u32 size + bytes
            size = self.u32()
            return self._take(size) if size else b""
        if t == TOK_FUNCTIONCALL_X:
            return self._read_functioncalls()
        if t == TOK_UNPARSED_X:
            return [self.pascal() for _ in range(self.u32())]
        if t == TOK_STRUCT_X:
            return self._read_struct_single(col)
        # everything else widens to a 4-byte int on disk
        # (U8/INT16/INT/BOOL/FLAGS/FLAGARRAY/BOOLFLAG/CONDRGB/TIMESTAMP/LINENUM)
        return self.i32()

    def _read_functioncalls(self):
        """ReadBinaryFunctionCalls: u32 count, per entry pascal + recurse."""
        n = self.u32()
        out = []
        for _ in range(n):
            name = self.pascal()
            if name:
                out.append({"function": name,
                            "params": self._read_functioncalls()})
            else:
                out.append({"function": "", "params": []})
        return out

    def _skip_struct(self):
        """Consume a struct by its u32 datasum without decoding its fields.
        Used when a subtable is None (opaque skip), e.g. to get past effect
        earrays whose schema isn't solved yet while the outer datasum validates."""
        want = self.u32()
        self.pos += want
        return None

    def _read_struct_single(self, col):
        """struct_readbin for a single (non-earray) struct column."""
        storage_indirect = bool(col.type & TOK_INDIRECT)
        earray = bool(col.type & TOK_EARRAY)
        if storage_indirect and not earray:                 # optional struct
            hassub = self.u32()
            if not hassub:
                return None
        if col.subtable is None:
            return self._skip_struct()
        return self.read_table(col.subtable)

    # -- storage-class dispatch (mirror g_arraytable) -----------------------
    def _read_column(self, col):
        t = tok_type(col.type)
        if col.type & TOK_EARRAY:
            if t == TOK_FUNCTIONCALL_X:                     # no outer count
                return self._read_scalar(col)
            n = self.u32()
            return [self._read_element(col) for _ in range(n)]
        if col.type & TOK_FIXED_ARRAY:
            if t == TOK_MATPYR_X:
                return self._read_scalar(col)
            return [self._read_element(col) for _ in range(col.param)]
        return self._read_scalar(col)

    def _read_element(self, col):
        """One element of an array: same base type, single-value framing."""
        if tok_type(col.type) == TOK_STRUCT_X:
            # array element struct: no INDIRECT_SINGLE hassub flag
            if col.subtable is None:
                return self._skip_struct()
            return self.read_table(col.subtable)
        return self._read_scalar(col)

    # -- table driver (mirror ParserReadBinaryTable) ------------------------
    def read_table(self, table):
        want = self.u32()                                   # datasum
        start = self.pos
        out = {}
        auto = 0
        for col in table:
            if col.type & TOK_REDUNDANTNAME:
                continue
            if col.minversion > self.version:
                continue
            t = tok_type(col.type)
            if t in (TOK_START, TOK_END, TOK_IGNORE, TOK_BIT, TOK_DEPRECATED,
                     TOK_STASHTABLE_X):
                # structural / no-op tokens consume nothing
                continue
            end_before = start + want
            if self.lenient and self.pos >= end_before:
                break                                       # nothing left
            val = self._read_column(col)
            key = col.name if col.name else f"_auto{auto}"
            if not col.name:
                auto += 1
            out[key] = val
        got = self.pos - start
        if got != want:
            if self.lenient and got < want:
                self.pos = start + want                     # skip appended data
            else:
                raise ValueError(
                    f"datasum mismatch in table: read {got}, expected {want} "
                    f"(at {start})")
        return out


def version_for(filetype):
    return PARSE_VERSIONS.get(filetype, max(PARSE_VERSIONS.values()))
