# Decoder tools

Python modules the data pipeline (`pipeline/`) uses to read City of Heroes client files. They
are plain standard-library Python (no dependencies) and are imported by the pipeline from this
folder; each one can also be run on its own (`python tools/<module>.py --help`).

| Module | Reads |
|---|---|
| `pigg_extract.py` | `.pigg` archives: directory, string table and (zlib) file entries. Format transcribed from the Piglet tool's `vfs.cpp`. |
| `parse_bin.py` | The engine's binary serializer (`.bin` files written by `ParserWriteBin`): column tables, strings, structs, earrays. |
| `parse7_patch.py` | Homecoming's `Parse7` additions to that serializer (stash tables, bound earrays), applied to `parse_bin` on import. |
| `power_tables.py` | The parse tables for powers, power sets and attribute modifiers, from the engine source's `powers_load.c` / `attribmod.h`. |
| `powers_decode.py` | `bin_powers.pigg` power records on top of the above. |
| `coh_exe.py` | Parse tables and enum name tables read straight out of the client executable (Homecoming inserts fields the older source doesn't have). |
| `mids_decode.py` | MidsReborn's `I12.mhd` power database (C# `BinaryWriter` layout). |
| `enhdb_decode.py` | MidsReborn's `EnhDB.mhd` enhancement database. |

The MidsReborn decoders exist only to read Mids data as a **reference** (the Mids import/export
name map and the validation report); Mids is never a source of truth for the planner's data. See
`pipeline/README` notes in the main README.
