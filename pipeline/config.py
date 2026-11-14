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
  COH_CLIENT_THUNDERSPY  the Thunderspy client install (Thunderspy.exe, tspy/bin.pigg, piggs/);
              in the file: "servers": {"thunderspy": {"client": ...}}

The paths above are Homecoming's until select_server() picks another game server (run.py's
--server): each server has its own client layout, data folder, ids file and reports (SERVERS).

Everything the pipeline writes stays inside the repository (out_path enforces it).
"""
from __future__ import annotations

import json
import os
import re
import sys
from dataclasses import dataclass
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


@dataclass(frozen=True)
class Server:
    """One game server's client layout and where its pipeline output goes.

    Homecoming came first: its data stays in public/data and its ids in pipeline/ids.json. Another
    server gets public/data/<id>/, pipeline/ids-<id>.json and its own reports, and its own copy of
    every icon it shows (public/assets/<id>/; the shared file itself where the art is the same).
    """

    id: str
    env: str                 # environment variable naming the client install
    local: tuple             # key path of the client install in paths.local.json
    exe: str                 # client executable, relative to the install
    bin_pigg: str            # the pigg holding the bins
    powers_pigg: str         # the pigg holding bin/powers.bin (the same file on some clients)
    base_assets: str         # folder of the base art piggs (texGui1, stage1b, stage2, stage3)
    live_assets: str         # folder of the live overlay piggs
    live_tex: tuple | None   # texture piggs in live_assets; None = every pigg there
    data: str                # data folder under public/data ("" = public/data itself)
    ids: str                 # stable ids file under pipeline/
    report: str              # report name under pipeline/ (report-<version> for older versions)
    mids: bool               # a MidsReborn database exists for it (Mids map and validation)
    shared_assets: bool      # its default version exports the shared public/assets (Homecoming only)


HOMECOMING = Server("homecoming", "COH_CLIENT", ("client",), "bin/win64/live/cityofheroes.exe",
                    "assets/live/bin.pigg", "assets/live/bin_powers.pigg", "assets/issue24",
                    "assets/live", ("texture_gui.pigg", "texture_library.pigg"), "", "ids.json",
                    "report", True, True)
# Thunderspy keeps every bin, powers.bin included, in tspy/bin.pigg; its own art is in tspy/*.pigg
THUNDERSPY = Server("thunderspy", "COH_CLIENT_THUNDERSPY", ("servers", "thunderspy", "client"),
                    "Thunderspy.exe", "tspy/bin.pigg", "tspy/bin.pigg", "piggs", "tspy", None,
                    "thunderspy", "ids-thunderspy.json", "report-thunderspy", False, False)
SERVERS = {s.id: s for s in (HOMECOMING, THUNDERSPY)}
# Folder names under public/data that hold a server's data, never a game version (Rebirth's is
# reserved for when its data comes).
SERVER_FOLDERS = frozenset({s.data for s in SERVERS.values() if s.data} | {"rebirth"})


def _local(keys: tuple) -> str | None:
    """@return The string at a key path in paths.local.json, or None."""
    v: object = _LOCAL
    for k in keys:
        v = v.get(k) if isinstance(v, dict) else None
    return v if isinstance(v, str) and v else None


def client_setting(s: Server) -> str | None:
    """@return A server's client install from the environment, else paths.local.json, else None."""
    return os.environ.get(s.env) or _local(s.local)


def data_dir(server_id: str) -> Path:
    """@return The data folder of a server (public/data or public/data/<id>)."""
    s = SERVERS[server_id]
    return REPO / "public" / "data" / s.data if s.data else REPO / "public" / "data"


# Outputs (inside the repo only).
CACHE_DIR = REPO / "pipeline" / ".cache"
ASSETS_OUT = REPO / "public" / "assets"
FONTS_DIR = REPO / "pipeline" / "inputs" / "fonts"  # vendored game fonts (committed)

_src = _setting("COH_SOURCE", "source")
SOURCE_ROOT = Path(_src) if _src else None  # optional


def select_server(server_id: str) -> None:
    """Point every input and output path at one game server (Homecoming until called).

    Modules read these names at call time (config.EXE, config.DATA_OUT, ...), so this must run
    before any decoding or writing.

    @param server_id A key of SERVERS.
    """
    global SERVER, CLIENT_DIR, EXE, LIVE_ASSETS, I24_ASSETS, BIN_PIGG, POWERS_PIGG, OURO_DATA, \
        MIDS_DATA, DATA_OUT, REPORT, IDS_FILE, CACHE_FILE, BASE_TEX_PIGGS, LIVE_TEX_PIGGS
    s = SERVER = SERVERS[server_id]
    v = client_setting(s)
    hint = f"set {s.env} or {'.'.join(repr(k) for k in s.local)} in pipeline/paths.local.json"
    CLIENT_DIR = Path(v) if v else Path(f"<{hint}>")
    EXE = CLIENT_DIR / s.exe
    LIVE_ASSETS = CLIENT_DIR / s.live_assets
    I24_ASSETS = CLIENT_DIR / s.base_assets
    BIN_PIGG = CLIENT_DIR / s.bin_pigg
    POWERS_PIGG = CLIENT_DIR / s.powers_pigg
    # loose OuroV2 files (textures, sounds) are Homecoming's base layer only; None when unset
    OURO_DATA = SOURCE_ROOT / "CityOfHeroes_OuroV2_Data" if SOURCE_ROOT and s.shared_assets else None
    MIDS_DATA = _path("COH_MIDS", "mids") if s.mids else Path(f"<no Mids database for {s.id}>")
    DATA_OUT = data_dir(s.id)
    REPORT = REPO / "pipeline" / f"{s.report}.md"
    IDS_FILE = REPO / "pipeline" / s.ids
    CACHE_FILE = CACHE_DIR / ("live.pickle" if s is HOMECOMING else f"live-{s.id}.pickle")
    BASE_TEX_PIGGS = [I24_ASSETS / n for n in ("texGui1.pigg", "stage1b.pigg", "stage2.pigg", "stage3.pigg")]
    if s.live_tex is None:
        LIVE_TEX_PIGGS = sorted(p for p in LIVE_ASSETS.glob("*.pigg") if p != BIN_PIGG)
    else:
        LIVE_TEX_PIGGS = [LIVE_ASSETS / n for n in s.live_tex]


def version_folders() -> list[Path]:
    """@return Every exported version folder (one holding core.json) of every server."""
    out: list[Path] = []
    for sid in SERVERS:
        d = data_dir(sid)
        if d.is_dir():
            out += sorted(p for p in d.iterdir() if p.is_dir() and (p / "core.json").is_file())
    return out


def report_path(version: str, is_default: bool) -> Path:
    """@return The report a run writes: the server's report for its default version, else one per version."""
    return REPORT if is_default else REPO / "pipeline" / f"{SERVER.report}-{version}.md"


select_server(HOMECOMING.id)


# Names Windows reserves for devices: a folder with one of these names can't be made or is a device.
_RESERVED = {"con", "prn", "aux", "nul", *(f"com{i}" for i in range(1, 10)), *(f"lpt{i}" for i in range(1, 10))}


def valid_version_id(v: str) -> bool:
    """Whether a game version id is safe as a data folder name on every system.

    Lower-case letters, digits, "-" and "_" only, starting with a letter or digit, at most 32
    characters, and not a Windows device name or a server's data folder. Lower case only, because
    Windows folders ignore case: "I28P4" would write into "i28p4" while versions.json treated them
    as two versions. No dots either: Windows drops a trailing one, so "i28p4." would also land in
    "i28p4" (Thunderspy's release 9.6 is "ts9-6").

    @param v The id.
    @return True when it may name a folder under public/data.
    """
    return bool(re.fullmatch(r"[a-z0-9][a-z0-9_-]{0,31}", v)) and v not in _RESERVED and v not in SERVER_FOLDERS


def scrub(text: str) -> str:
    """Replace machine paths in text bound for a committed file (a report) with placeholders.

    The configured inputs become <COH_CLIENT>, <COH_SOURCE>, <COH_MIDS>, the repository <repo> and
    the user's home folder <home>; any other drive-letter, network-share or home-folder path left
    over (from an exception message, say) becomes <path>.

    @param text The text.
    @return The text without machine paths.
    """
    named = [(CLIENT_DIR, "<COH_CLIENT>"), (SOURCE_ROOT, "<COH_SOURCE>"), (MIDS_DATA, "<COH_MIDS>"),
             (REPO, "<repo>"), (Path.home(), "<home>")]
    for p, tag in sorted(((p, t) for p, t in named if p is not None and str(p).strip("<")),
                         key=lambda pt: -len(str(pt[0]))):
        for form in {str(p), p.as_posix()}:
            if len(form) > 3:  # never a bare drive root
                text = re.sub(re.escape(form), tag, text, flags=re.IGNORECASE)
    stop = r"[^\s'\"<>|,;)\]]"
    text = re.sub(rf"(?<![A-Za-z0-9])[A-Za-z]:[\\/]{stop}*", "<path>", text)
    text = re.sub(rf"\\\\{stop}+", "<path>", text)
    return re.sub(rf"(?<![A-Za-z0-9.])/(?:home|Users)/{stop}+", "<path>", text)


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
    where = f"{SERVER.env} (or {'.'.join(repr(k) for k in SERVER.local)} in pipeline/paths.local.json)"
    if client_setting(SERVER) is None:
        raise SystemExit(f"error: the {SERVER.id} client is not set: set {where}")
    for p in (EXE, BIN_PIGG, POWERS_PIGG):
        if not p.is_file():
            raise SystemExit(f"error: missing input {p} -- check {where}")


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
