"""Check each game server's live patch manifest for a data release the planner hasn't exported.

Thunderspy's download server keeps only the files its live manifest names, so a superseded release
can never be exported: this check says when a new one is live, while it still can be.

Usage (from the repo root):
    python -m pipeline.watch                       # every server whose patch-watch.json entry names a manifest
    python -m pipeline.watch --server thunderspy
    python -m pipeline.watch --record              # once the live release is exported as the default

For each server it fetches the manifest named in pipeline/patch-watch.json (one HTTPS request that
sends nothing about this machine) and checks:
  1. the release folder and MD5 the manifest gives the server's bin pigg against the entry's
     binRelease and binMd5: a new data release, to export while it is live;
  2. the installed client, when one is configured, against the manifest: the launcher must bring it
     up to date before an export;
  3. the installed client against the default version's source hashes: whether the published data
     was made from it.

--record writes the live release, its MD5 and the default version's id and label into
patch-watch.json, and only once the default version was made from the live bin pigg.

Exit status: 0 when nothing needs doing, 1 when something does, 2 when the check itself failed
(anything unexpected included, so a scheduled job never reads a crash as a new release).
Tests: python -m unittest pipeline.watch_test
"""
from __future__ import annotations

import argparse
import hashlib
import http.client
import json
import re
import sys
import textwrap
import time
import traceback
import urllib.request
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlsplit

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from pipeline import config  # noqa: E402

PATCH_WATCH = config.REPO / "pipeline" / "patch-watch.json"
MAX_MANIFEST = 2 << 20          # bytes a manifest may have (Thunderspy's is ~20 KB)
TIMEOUT = 30                    # seconds the whole manifest download may take
USER_AGENT = "patch-watch/1.0"  # generic: names nothing about the owner or this machine
_MD5 = re.compile(r"[0-9a-f]{32}")
_RELEASE = re.compile(r"\d{1,4}(?:\.\d{1,4}){0,3}")

OK, NOTE, TODO, CMD = "ok", "note", "todo", "cmd"  # CMD lines are commands, printed whole


class WatchError(Exception):
    """The check could not be made: the manifest is unreachable or malformed, or an input is missing."""


@dataclass(frozen=True)
class LiveFile:
    """One file the live manifest names."""

    md5: str      # lower-case hex
    url: str      # where the launcher downloads it
    release: str  # the release folder in its URL ("9.6"), "" when it names none


@dataclass(frozen=True)
class Published:
    """A server's default version, as its version folder records it."""

    id: str                  # game version id ("ts9-6")
    label: str               # its label ("Release 9.6")
    source: dict             # SHA-1 of the client files it was made from ("exe", "bin.pigg", ...)
    frames_from: str | None  # the version its enhancement frames were borrowed from
    ids: frozenset           # every version id the server has published


def fetch(url: str) -> bytes:
    """Download a manifest over HTTPS within TIMEOUT seconds, refusing a reply over MAX_MANIFEST bytes.

    @param url The manifest URL from patch-watch.json.
    @return The manifest's bytes.
    @raise WatchError When the URL (or a redirect) isn't https, the request fails or is too slow, or
        the reply is too large.
    """
    if urlsplit(url).scheme != "https":
        raise WatchError(f"the manifest URL must be https: {url}")
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    deadline = time.monotonic() + TIMEOUT
    data = bytearray()
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
            if urlsplit(r.geturl()).scheme != "https":
                raise WatchError(f"the manifest request was redirected off https ({r.geturl()})")
            while len(data) <= MAX_MANIFEST:
                chunk = r.read(1 << 16)
                if not chunk:
                    break
                data += chunk
                if time.monotonic() > deadline:
                    raise WatchError(f"the manifest at {url} took over {TIMEOUT} seconds to download")
    except (OSError, ValueError, http.client.HTTPException) as e:  # URLError, timeouts, cut-off replies
        raise WatchError(f"could not fetch {url} ({type(e).__name__}: {e})") from e
    if len(data) > MAX_MANIFEST:
        raise WatchError(f"the manifest at {url} is larger than {MAX_MANIFEST} bytes; refused")
    return bytes(data)


def release_of(url: str, name: str) -> str:
    """@return The release folder of a dist URL (https://<host>/<release>/<name>), or "" when it has none."""
    parts = urlsplit(url)
    if parts.scheme != "https" or not parts.path.endswith("/" + name):
        return ""
    rel = parts.path[1:-len(name) - 1]
    return rel if _RELEASE.fullmatch(rel) else ""


def parse_manifest(data: bytes) -> dict[str, LiveFile]:
    """Read the files a launcher manifest names.

    A manifest lists <filelist><file name="tspy/bin.pigg" md5="..."><url>https://<host>/9.6/tspy/bin.pigg
    </url></file>...</filelist>. It comes from outside, so it must be UTF-8 (an XML declaration may
    name no other encoding), and a DOCTYPE or entity declaration is refused before the XML is parsed.

    @param data The manifest's bytes.
    @return {file name: LiveFile}.
    @raise WatchError When the manifest is malformed or names a file twice.
    """
    try:
        text = data.decode("utf-8")
    except UnicodeDecodeError as e:
        raise WatchError("the manifest is not UTF-8; refused") from e
    decl = re.match(r"\ufeff?<\?xml[^>]*?encoding\s*=\s*[\"']([^\"']*)", text)
    if decl and decl.group(1).lower().replace("_", "-") not in ("utf-8", "utf8"):
        raise WatchError(f"the manifest declares encoding {decl.group(1)!r}; refused")
    if re.search(r"<!(?:DOCTYPE|ENTITY)", text, re.IGNORECASE):
        raise WatchError("the manifest declares a DOCTYPE or entities; refused")
    try:
        root = ET.fromstring(data)
    except ET.ParseError as e:
        raise WatchError(f"the manifest is not valid XML ({e})") from e
    files: dict[str, LiveFile] = {}
    for f in root.iterfind("filelist/file"):
        name, md5 = f.get("name") or "", (f.get("md5") or "").lower()
        url = (f.findtext("url") or "").strip()
        if not name or not _MD5.fullmatch(md5) or not url:
            raise WatchError(f"the manifest has a malformed file entry ({name or 'no name'})")
        if name in files:
            raise WatchError(f"the manifest names {name} twice")
        files[name] = LiveFile(md5, url, release_of(url, name))
    return files


def file_hashes(path: Path) -> tuple[str, str]:
    """@return (MD5, SHA-1) of a file in one read: manifests name MD5s, version folders SHA-1s."""
    md5, sha = hashlib.md5(usedforsecurity=False), hashlib.sha1(usedforsecurity=False)
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            md5.update(chunk)
            sha.update(chunk)
    return md5.hexdigest(), sha.hexdigest()


def installed(server: config.Server) -> dict[str, tuple[str, str]] | None:
    """Hash the installed client's exe and bin pigg.

    @param server The game server.
    @return {path in the install: (MD5, SHA-1)}, or None when no client is configured for the server.
    @raise WatchError When paths.local.json is damaged or an install file is missing or unreadable
        (the launcher may hold it while it patches).
    """
    if config.LOCAL_ERROR:
        raise WatchError(config.LOCAL_ERROR)
    root = config.client_setting(server)
    if not root:
        return None
    out = {}
    for rel in (server.exe, server.bin_pigg):
        p = Path(root) / rel
        if not p.is_file():
            raise WatchError(f"the configured {server.id} client ({server.env}) has no {rel}")
        try:
            out[rel] = file_hashes(p)
        except OSError as e:
            raise WatchError(f"the installed {rel} can't be read ({type(e).__name__}); is the launcher "
                             "updating it?") from e
    return out


def published_default(server_id: str) -> Published | None:
    """Read the server's default version from its versions.json and version folder.

    @param server_id A key of config.SERVERS.
    @return The default version, or None when the server has no versions.json.
    @raise WatchError When versions.json or the default version's core.json is damaged.
    """
    rel = config.data_dir(server_id).relative_to(config.REPO).as_posix()
    try:
        idx = config.version_index(server_id)
    except ValueError as e:
        raise WatchError(f"{rel}/versions.json is damaged ({e})") from e
    if idx is None:
        return None
    vid = idx.get("default")
    versions = [v for v in idx.get("versions") or [] if isinstance(v, dict)]
    if not isinstance(vid, str) or not config.valid_version_id(vid):
        raise WatchError(f"{rel}/versions.json names no valid default version")
    label = next((v.get("label") for v in versions if v.get("id") == vid), None) or vid
    try:
        man = json.loads((config.data_dir(server_id) / vid / "core.json").read_text(encoding="utf-8"))["manifest"]
        return Published(vid, str(label), dict(man["source"]), man.get("framesFrom"),
                         frozenset(v.get("id") for v in versions))
    except (OSError, ValueError, KeyError, TypeError) as e:
        raise WatchError(f"{rel}/{vid}/core.json has no readable manifest ({type(e).__name__})") from e


def suggested_id(server: config.Server, release: str, taken: frozenset) -> str:
    """@return The version id a release would get ("ts9-7"), or a placeholder when that id is taken or invalid."""
    vid = server.version_prefix + release.replace(".", "-")  # release 9.6 is ts9-6
    if not config.valid_version_id(vid):
        return "<new id>"
    return f"<new id; {vid} is published>" if vid in taken else vid


def assess(server: config.Server, entry: dict, live: dict[str, LiveFile],
           local: dict[str, tuple[str, str]] | None, published: Published | None) -> list[tuple[str, str]]:
    """Compare the live manifest with patch-watch.json, the installed client and the published data.

    A new data release is a TODO even when the install is current: the download server deletes it
    once the next release ships, so it must be exported while it is live.

    @param server The game server.
    @param entry Its patch-watch.json entry (binRelease, binMd5).
    @param live The live manifest's files.
    @param local The installed client's hashes (installed()), or None when none is configured.
    @param published The server's default version, or None when it has none.
    @return (level, message) lines; level is OK, NOTE, TODO or CMD (a command to run, after its TODO).
    @raise WatchError When the manifest lacks the server's exe or bin pigg, or the bin pigg's URL names no release.
    """
    bin_, exe = server.bin_pigg, server.exe
    for rel in (bin_, exe):
        if rel not in live:
            raise WatchError(f"the manifest names no {rel}")
    lb, lx = live[bin_], live[exe]
    if not lb.release:
        raise WatchError(f"no release folder in {bin_}'s URL ({lb.url})")
    out: list[tuple[str, str]] = []
    rec_rel = entry.get("binRelease") or None
    rec_md5 = str(entry.get("binMd5") or "").lower() or None  # a hand-written MD5 may be upper case
    if lb.release == rec_rel and lb.md5 == rec_md5:
        out.append((OK, f"no new data release: {bin_} is release {lb.release}, as recorded"))
    elif lb.release == rec_rel and not rec_md5:
        out.append((TODO, f"patch-watch.json records release {rec_rel} without its binMd5; record it with"))
        out.append((CMD, "python -m pipeline.watch --record"))
    else:
        what = (f"release {lb.release}" if lb.release != rec_rel
                else f"a different file in release folder {lb.release} (MD5 {lb.md5[:12]}, "
                     f"recorded {str(rec_md5)[:12]})")
        was = f"records release {rec_rel}" if rec_rel else "records no release"
        taken = published.ids if published else frozenset()
        frames = f" --frames-from {published.frames_from}" if published and published.frames_from else ""
        out.append((TODO, f"new data release live: {bin_} is {what}; patch-watch.json {was}. Export it "
                          "while it is live (the download server deletes superseded releases): update the "
                          "client with its launcher, run the first command, review the report, then run "
                          "the second"))
        out.append((CMD, f"python -m pipeline.run --server {server.id} --game-version "
                         f"{suggested_id(server, lb.release, taken)} --game-label \"Release {lb.release}\""
                         f"{frames} --make-default"))
        out.append((CMD, "python -m pipeline.watch --record"))
    if local is None:
        out.append((NOTE, f"no {server.id} client configured ({server.env}): installed-client checks skipped"))
        return out
    stale = [rel for rel in (bin_, exe) if local[rel][0] != live[rel].md5]
    if stale:
        out.append((TODO, f"the installed client is not the live one ({' and '.join(stale)} "
                          f"{'differs' if len(stale) == 1 else 'differ'}): update it with its launcher "
                          "before exporting"))
    else:
        out.append((OK, f"the installed client matches the live manifest ({bin_} release {lb.release}, "
                        f"{exe} release {lx.release or '?'})"))
    if published is None:
        out.append((TODO, f"{server.id} has no published default version"))
        return out
    same_bin = published.source.get("bin.pigg") == local[bin_][1]
    same_exe = published.source.get("exe") == local[exe][1]
    if same_bin and same_exe:
        out.append((OK, f'{published.id} ("{published.label}") was made from the installed client'))
    elif same_bin:
        out.append((NOTE, f"{published.id} was made from this {bin_} with an older {exe}: the data is the "
                          f"same release, but a re-run of {published.id} is refused as a different client "
                          "(--overwrite-published replaces it on purpose)"))
    else:
        level = NOTE if any(lv == TODO for lv, _ in out) else TODO
        out.append((level, f"{published.id} was not made from the installed {bin_}"))
    return out


def record(server: config.Server, entry: dict, live: dict[str, LiveFile],
           local: dict[str, tuple[str, str]] | None, published: Published | None) -> dict:
    """Record the live release as exported, once the default version was made from it.

    @param server The game server.
    @param entry Its patch-watch.json entry.
    @param live The live manifest's files.
    @param local The installed client's hashes, or None when none is configured.
    @param published The server's default version, or None.
    @return The entry with binRelease, binMd5, gameVersion and gameLabel set (other keys kept, in order).
    @raise WatchError When the installed client isn't the live one or the default version wasn't made from it.
    """
    bin_ = server.bin_pigg
    lb = live.get(bin_)
    if lb is None or not lb.release:
        raise WatchError(f"--record refused: the manifest gives {bin_} no release")
    if local is None:
        raise WatchError(f"--record refused: it needs the installed {server.id} client ({server.env})")
    md5, sha = local[bin_]
    if md5 != lb.md5:
        raise WatchError(f"--record refused: the installed {bin_} is not the live one; update the client "
                         "and export it first")
    if published is None or published.source.get("bin.pigg") != sha:
        raise WatchError(f"--record refused: the default version was not made from the live {bin_}; "
                         "export it with --make-default first")
    return {**entry, "binRelease": lb.release, "binMd5": lb.md5, "gameVersion": published.id,
            "gameLabel": published.label}


def check(server: config.Server, entry: object, do_record: bool) -> tuple[list[tuple[str, str]], dict | None]:
    """Run every check for one server, and --record when asked.

    @param server The game server.
    @param entry Its patch-watch.json entry.
    @param do_record Record the live release once the checks allow it.
    @return (level, message) lines, and the entry to save (None when unchanged).
    @raise WatchError When the check can't be made or --record is refused.
    """
    if not isinstance(entry, dict) or not isinstance(entry.get("manifest"), str):
        raise WatchError(f"patch-watch.json names no manifest for {server.id}")
    if server.powers_pigg != server.bin_pigg:
        raise WatchError(f"{server.id} keeps powers.bin in its own pigg; the watch reads one data pigg")
    live = parse_manifest(fetch(entry["manifest"]))
    local = installed(server)
    published = published_default(server.id)
    if not do_record:
        return assess(server, entry, live, local, published), None
    new = record(server, entry, live, local, published)
    changed = new != entry
    note = f"recorded release {new['binRelease']} as {new['gameVersion']}" if changed else "already recorded"
    return [(OK, note), *assess(server, new, live, local, published)], new if changed else None


def render(level: str, text: str) -> str:
    """@return One report line: messages wrapped at 100 columns, commands whole so they copy intact."""
    if level == CMD:
        return " " * 8 + text
    return textwrap.fill(text, width=100, initial_indent=f"  {level:<6}", subsequent_indent=" " * 8,
                         break_long_words=False, break_on_hyphens=False)


def main(argv: list[str] | None = None) -> int:
    """Check every server's live manifest (or one) and print what needs doing.

    @param argv Command-line arguments (sys.argv when None).
    @return 0 when nothing needs doing, 1 when something does, 2 when a check failed.
    """
    ap = argparse.ArgumentParser(description="Check each game server's live patch manifest for a new "
                                             "data release.")
    ap.add_argument("--server", choices=sorted(config.SERVERS),
                    help="check one server (default: every server whose patch-watch.json entry names a manifest)")
    ap.add_argument("--record", action="store_true",
                    help="record the live release in patch-watch.json once the default version was made from it")
    args = ap.parse_args(argv)
    try:
        watch = json.loads(PATCH_WATCH.read_text(encoding="utf-8"))
        if not isinstance(watch, dict):
            raise ValueError("top level is not an object")
    except (OSError, ValueError) as e:
        print(f"error: pipeline/patch-watch.json can't be read ({e})")
        return 2
    ids = [args.server] if args.server else [
        sid for sid in config.SERVERS if isinstance(watch.get(sid), dict) and watch[sid].get("manifest")]
    if not ids:
        print("error: no pipeline/patch-watch.json entry names a manifest")
        return 2
    status, changed = 0, False
    for sid in ids:
        print(f"{sid}:")
        try:
            lines, new = check(config.SERVERS[sid], watch.get(sid), args.record)
        except WatchError as e:
            lines, new, status = [("error", str(e))], None, 2
        if new is not None:
            watch[sid], changed = new, True
        for level, text in lines:
            print(render(level, text))
        if status < 2 and any(lv == TODO for lv, _ in lines):
            status = 1
    if changed:
        config.atomic_write(PATCH_WATCH, json.dumps(watch, indent=2) + "\n")
        print("wrote pipeline/patch-watch.json")
    return status


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception:  # noqa: BLE001 -- any crash is a failed check (2), never "something to do" (1)
        traceback.print_exc()
        sys.exit(2)
