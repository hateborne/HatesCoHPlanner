"""Decode every live Homecoming bin the planner needs, with health stats and a local cache.

Result (`LiveData`) holds raw decoded records exactly as the client parse tables describe them;
labelling and trimming happen later in export.py. The cache key is the sha1 of the exe and the two
pigg inputs plus a sha1 over the decoder source, so a client patch or a decoder change forces a
fresh decode (file dates play no part).
"""
from __future__ import annotations

import hashlib
import os
import pickle
import time
from dataclasses import dataclass, field

from pipeline import config
from pipeline.coh import p7reader as P
from pipeline.coh.messages import decode_messages
from pipeline.label.attribs import all_attributes

CACHE_VERSION = 7


@dataclass
class LiveData:
    """Raw decoded client data."""

    powers: list
    powersets: list
    powercats: list
    classes: list
    boostsets: list
    origins: list
    attrib_names: dict
    dim_returns: list
    schedules: dict
    boost_effect: dict          # {"above": [...], "below": [...], "boosters": [...]}
    exemplar: dict              # {"Limits", "Weights", "PreClamp", "PostClamp"}
    messages: dict              # {key: English text}
    attribs: dict               # {offset: {"name", "aliases", "kind"}}
    enums: dict                 # {"power.Type": {int: name}, "mod.Aspect": {...}, ...}
    health: dict = field(default_factory=dict)
    fingerprint: dict = field(default_factory=dict)


_SHA_MEMO: dict[tuple, str] = {}


def sha1(path) -> str:
    """SHA-1 of a file (memoized per process so a run hashes each input once)."""
    key = str(path)
    if key not in _SHA_MEMO:
        h = hashlib.sha1()
        with open(path, "rb") as f:
            for chunk in iter(lambda: f.read(1 << 20), b""):
                h.update(chunk)
        _SHA_MEMO[key] = h.hexdigest()
    return _SHA_MEMO[key]


def decoder_hash() -> str:
    """@return SHA-1 over the decoder source: tools/*.py, pipeline/coh/*.py, pipeline/decode/*.py."""
    h = hashlib.sha1()
    for folder in (config.TOOLS_DIR, config.REPO / "pipeline" / "coh", config.REPO / "pipeline" / "decode"):
        for f in sorted(folder.glob("*.py")):
            h.update(f"{folder.name}/{f.name}\n".encode())
            h.update(f.read_bytes().replace(b"\r\n", b"\n"))  # line endings must not change the key
            h.update(b"\n--\n")
    return h.hexdigest()


def _fingerprint() -> dict:
    """@return The decode cache key: input file hashes plus the decoder source hash."""
    fp = {p.name: sha1(p) for p in (config.EXE, config.BIN_PIGG, config.POWERS_PIGG)}
    fp["decoder"] = decoder_hash()
    return fp


def _earray(member: str, table, pigg=None, inline_links=False, health=None):
    res = P.decode_earray(P.load_member(pigg or config.BIN_PIGG, member), table,
                          inline_links=inline_links)
    if health is not None:
        health[member] = {"records": len(res.records), "clean": res.clean,
                          "partial": len(res.partial), "partial_examples": res.partial[:5]}
    return res.records


def _single(member: str, table, wrapped=False, health=None):
    data = P.load_member(config.BIN_PIGG, member)
    _, body, pool = P.pd.read_header(data)
    r = P.P7Reader(data, pool)
    r.pos = body
    if wrapped:
        r.u32()  # outer single-struct datasum (schedules.bin)
    out = r.read_table(table)
    if health is not None:
        health[member] = {"records": 1, "clean": 1, "partial": 0, "end": r.pos, "size": len(data)}
    return out


def decode_all(verbose=True) -> LiveData:
    """Decode the live bins (no cache)."""
    import coh_exe  # from the repo tools/ folder via p7reader's path setup

    t0 = time.time()
    health: dict = {}
    x = P.exe()
    bp = coh_exe.basepower_table(x)
    am = coh_exe.attribmod_inner_table(x)
    enums = {
        "power.Type": P.enum_of(bp, "Type"),
        "power.EffectArea": P.enum_of(bp, "EffectArea"),
        "power.Target": P.enum_of(bp, "Target"),
        "power.TargetVisibility": P.enum_of(bp, "TargetVisibility"),
        "power.AttackTypes": P.enum_of(bp, "AttackTypes"),
        "power.EntsAffected": P.enum_of(bp, "EntsAffected"),
        "mod.Aspect": P.enum_of(am, "Aspect"),
        "mod.Type": P.enum_of(am, "Type"),
        "mod.Target": P.enum_of(am, "Target"),
        "mod.ApplicationType": P.enum_of(am, "ApplicationType"),
        "mod.StackType": P.enum_of(am, "StackType"),
        "mod.CasterStackType": P.enum_of(am, "CasterStackType"),
        "mod.Flags": P.enum_of(am, "Flags"),        # bit index -> name (2-word bit array)
        "effect.Flags": P.enum_of(next(c for c in bp if c.name == "Effect").subtable, "Flags"),
    }
    if verbose:
        print("decoding powers.bin ...", flush=True)
    powers = _earray("bin/powers.bin", bp, pigg=config.POWERS_PIGG, health=health)
    powersets = _earray("bin/powersets.bin", coh_exe.powerset_table(x), health=health)
    powercats = _earray("bin/powercats.bin", coh_exe.powercat_table(x), health=health)
    classes = _earray("bin/classes.bin",
                      P.pick_table("PrimaryCategory", {"Name", "PrimaryCategory", "ModTable"}),
                      health=health)
    boostsets = _earray("bin/boostsets.bin",
                        P.pick_table("ConversionGroups", {"Name", "DisplayName", "Powers"}),
                        inline_links=True, health=health)
    dim_returns = _earray("bin/dim_returns.bin",
                          P.pick_table("AttribReturnSet", {"Default", "Boost"}), health=health)
    attrib_names = _single("bin/attrib_names.bin",
                           P.pick_table("StackKey", {"Damage", "Defense", "Boost"}), health=health)
    eff = P.pick_table("Effectiveness", {"Effectiveness"})
    boost_effect = {k: _single(f"bin/boost_effect_{k}.bin", eff, health=health)["Effectiveness"]
                    for k in ("above", "below", "boosters")}
    exemplar = _single("bin/exemplar_handicaps.bin",
                       P.pick_table("PreClamp", {"Limits", "Weights"}), health=health)
    schedules = _single("bin/schedules.bin",
                        P.pick_table("AssignableBoost", {"Power", "AssignableBoost"}),
                        wrapped=True, health=health)
    origins = _origins(health)
    messages = decode_messages(P.load_member(config.BIN_PIGG, "bin/clientmessages-en.bin"))
    health["bin/clientmessages-en.bin"] = {"records": len(messages), "clean": len(messages),
                                           "partial": 0}
    attribs = all_attributes()
    if verbose:
        print(f"decoded in {time.time() - t0:.1f}s", flush=True)
    return LiveData(powers=powers, powersets=powersets, powercats=powercats, classes=classes,
                    boostsets=boostsets, origins=origins, attrib_names=attrib_names,
                    dim_returns=dim_returns, schedules=schedules, boost_effect=boost_effect,
                    exemplar=exemplar, messages=messages, attribs=attribs, enums=enums,
                    health=health)


def _origins(health) -> list:
    """origins.bin (Name, DisplayName, DisplayHelp, DisplayShortHelp, Icon per origin). Several
    small tables share those column names, so accept the first one that decodes cleanly."""
    data = P.load_member(config.BIN_PIGG, "bin/origins.bin")
    want = {"Name", "DisplayName", "DisplayHelp", "DisplayShortHelp", "Icon"}
    tried = set()
    x = P.exe()
    for va in P.field_entries(x, "DisplayShortHelp"):
        try:
            start = x.find_table_start(va)
        except Exception:  # noqa: BLE001
            continue
        if start in tried:
            continue
        tried.add(start)
        cols = x.extract(start)
        if not want <= {c.name for c in cols} or len(cols) > 12:
            continue
        try:
            res = P.decode_earray(data, cols)
        except Exception:  # noqa: BLE001
            continue
        if res.records and not res.partial:
            health["bin/origins.bin"] = {"records": len(res.records), "clean": res.clean,
                                         "partial": 0}
            return res.records
    health["bin/origins.bin"] = {"records": 0, "clean": 0, "partial": 1,
                                 "partial_examples": ["origins table not found"]}
    return []


def load(force=False, verbose=True) -> LiveData:
    """Decode with a pickle cache under pipeline/.cache keyed by input and decoder hashes."""
    fp = _fingerprint()
    cache = config.CACHE_DIR / "live.pickle"
    if cache.exists() and not force:
        try:
            with open(cache, "rb") as f:
                ver, cfp, data = pickle.load(f)
            if ver == CACHE_VERSION and cfp == fp:
                if verbose:
                    print("using cached live decode", flush=True)
                return data
        except Exception:  # noqa: BLE001 -- stale/corrupt cache, just redecode
            pass
    data = decode_all(verbose)
    data.fingerprint = fp
    out = config.out_path(cache)
    tmp = out.with_name(out.name + ".tmp")
    with open(tmp, "wb") as f:
        pickle.dump((CACHE_VERSION, fp, data), f, protocol=pickle.HIGHEST_PROTOCOL)
    os.replace(tmp, out)
    return data
