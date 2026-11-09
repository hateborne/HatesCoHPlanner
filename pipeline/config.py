"""Paths and safety rails for the data pipeline.

The decoder modules live in this repository's tools/ folder. The inputs live on the machine that
runs the pipeline and are never committed: set them in pipeline/paths.local.json (gitignored; see
pipeline/paths.example.json) or in environment variables, which win over the file:

  COH_CLIENT  the Homecoming client install (bin/win64/live/cityofheroes.exe, assets/live/*.pigg)
  COH_SOURCE  optional: the folder holding the CityOfHeroes_OuroV2_Data checkout (loose sounds
              and textures; without it they come from the client piggs. Fonts are vendored in
              pipeline/inputs/fonts)
  COH_MIDS    optional: a MidsReborn data folder (I12.mhd, EnhDB.mhd, CrypticPowerNames.mhd).
              Mids is a REFERENCE only -- it feeds the Mids import/export name map and the
              validation report, never the planner's data. Without it the pipeline keeps the
              existing map and skips validation.

Everything the pipeline writes stays inside the repository (out_path enforces it).
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
TOOLS_DIR = REPO / "tools"
LOCAL_PATHS = REPO / "pipeline" / "paths.local.json"


LOCAL_ERROR: str | None = None  # set when paths.local.json exists but is not valid JSON


def _load_local() -> dict:
    """@return The parsed paths.local.json ({} when absent); an invalid file sets LOCAL_ERROR."""
    global LOCAL_ERROR
    try:
        text = LOCAL_PATHS.read_text(encoding="utf-8-sig")
    except OSError:
        return {}
    try:
        data = json.loads(text)
        if not isinstance(data, dict):
            raise ValueError("top level is not an object")
        return data
    except ValueError as e:
        LOCAL_ERROR = f"pipeline/paths.local.json is not valid JSON ({e})"
        return {}


_LOCAL = _load_local()


def _setting(env: str, key: str) -> str | None:
    """@return An input path from the environment, else from paths.local.json, else None."""
    if os.environ.get(env):
        return os.environ[env]
    return _LOCAL.get(key) or None


def _path(env: str, key: str) -> Path:
    """@return The configured path, or a placeholder that names the missing setting."""
    v = _setting(env, key)
    return Path(v) if v else Path(f"<set {env} or '{key}' in pipeline/paths.local.json>")


# External inputs (read-only).
CLIENT_DIR = _path("COH_CLIENT", "client")
_src = _setting("COH_SOURCE", "source")
SOURCE_ROOT = Path(_src) if _src else None  # optional
MIDS_DATA = _path("COH_MIDS", "mids")

EXE = CLIENT_DIR / "bin" / "win64" / "live" / "cityofheroes.exe"
LIVE_ASSETS = CLIENT_DIR / "assets" / "live"
I24_ASSETS = CLIENT_DIR / "assets" / "issue24"
BIN_PIGG = LIVE_ASSETS / "bin.pigg"
POWERS_PIGG = LIVE_ASSETS / "bin_powers.pigg"
# Optional loose OuroV2 files (textures, sounds); None when COH_SOURCE is unset.
OURO_DATA = SOURCE_ROOT / "CityOfHeroes_OuroV2_Data" if SOURCE_ROOT else None

# Outputs (inside the repo only).
CACHE_DIR = REPO / "pipeline" / ".cache"
DATA_OUT = REPO / "public" / "data"
ASSETS_OUT = REPO / "public" / "assets"
REPORT = REPO / "pipeline" / "report.md"
FONTS_DIR = REPO / "pipeline" / "inputs" / "fonts"  # vendored game fonts (committed)


def mids_available() -> bool:
    """@return Whether a MidsReborn reference data folder is configured and readable."""
    return all((MIDS_DATA / f).is_file() for f in ("I12.mhd", "EnhDB.mhd", "CrypticPowerNames.mhd"))


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
    """Put the repository's tools/ decoders on sys.path (idempotent)."""
    t = str(TOOLS_DIR)
    if t not in sys.path:
        sys.path.insert(0, t)


def preflight() -> None:
    """Check the configured inputs before any work.

    @raise SystemExit With a one-line message naming the missing setting.
    """
    if LOCAL_ERROR:
        raise SystemExit(f"error: {LOCAL_ERROR}")
    if _setting("COH_CLIENT", "client") is None:
        raise SystemExit("error: COH_CLIENT is not set (set it or 'client' in pipeline/paths.local.json)")
    for p in (EXE, BIN_PIGG, POWERS_PIGG):
        if not p.is_file():
            raise SystemExit(f"error: missing input {p} -- check COH_CLIENT "
                             "(or 'client' in pipeline/paths.local.json)")


def atomic_write(path: Path | str, data: str | bytes) -> bool:
    """Write a file atomically (temp file + os.replace); text is written with LF newlines.

    @param path Destination (must be inside the repo).
    @param data Text (UTF-8) or bytes.
    @return True if the file changed, False if it already held exactly this content.
    """
    p = out_path(path)
    raw = data.encode("utf-8") if isinstance(data, str) else data
    try:
        if p.read_bytes() == raw:
            return False
    except OSError:
        pass
    tmp = p.with_name(p.name + ".tmp")
    tmp.write_bytes(raw)
    os.replace(tmp, p)
    return True
