"""Paths and safety rails for the local data pipeline.

The pipeline reads from the Homecoming client install, the OuroV2 source/data repos and the
existing decoder tools under <COH_SOURCE>\\tools (imported by path, never edited), and
writes ONLY inside this repository. Every path can be overridden with an environment variable.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]

# External inputs (read-only).
TOOLS_DIR = Path(os.environ.get("COH_TOOLS", r"<COH_SOURCE>\tools"))
CLIENT_DIR = Path(os.environ.get("COH_CLIENT", r"<HOMECOMING_DIR>"))
SOURCE_ROOT = Path(os.environ.get("COH_SOURCE", r"<COH_SOURCE>"))
MIDS_DIR = Path(os.environ.get("COH_MIDS", str(CLIENT_DIR / "MidsReborn")))

EXE = CLIENT_DIR / "bin" / "win64" / "live" / "cityofheroes.exe"
LIVE_ASSETS = CLIENT_DIR / "assets" / "live"
I24_ASSETS = CLIENT_DIR / "assets" / "issue24"
BIN_PIGG = LIVE_ASSETS / "bin.pigg"
POWERS_PIGG = LIVE_ASSETS / "bin_powers.pigg"
OURO_DATA = SOURCE_ROOT / "CityOfHeroes_OuroV2_Data"
OURO_SOURCE = SOURCE_ROOT / "CityOfHeroes_OuroV2_Source"
DECODED_DIR = SOURCE_ROOT / "extracted" / "decoded"
MIDS_DATA = MIDS_DIR / "Data" / "Homecoming"

# Outputs (inside the repo only).
CACHE_DIR = REPO / "pipeline" / ".cache"
DATA_OUT = REPO / "public" / "data"
ASSETS_OUT = REPO / "public" / "assets"
REPORT = REPO / "pipeline" / "report.md"


def out_path(path: Path | str) -> Path:
    """Resolve an output path and refuse anything outside the repository.

    @param path Path to be written.
    @return The resolved path, guaranteed to be inside REPO.
    """
    p = Path(path).resolve()
    if REPO not in p.parents and p != REPO:
        raise RuntimeError(f"refusing to write outside the repo: {p}")
    p.parent.mkdir(parents=True, exist_ok=True)
    return p


def use_tools() -> None:
    """Put the U:\\ decoder tools on sys.path (idempotent)."""
    t = str(TOOLS_DIR)
    if t not in sys.path:
        sys.path.insert(0, t)
