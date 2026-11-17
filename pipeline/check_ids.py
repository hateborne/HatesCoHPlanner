"""Check every game server's stable ids file (pipeline/ids.json, pipeline/ids-<server>.json): well
formed, only ever appended to, and never missing.

Share links and saved builds store these ids, so an id that changes, disappears or is reused
breaks every link that holds it. CI runs this against the pull request's base branch; a file the
base branch doesn't have yet (a new server's) is checked for its shape only. A file the base branch
has, or one whose server already has data, must still be there.

The files checked are the ones config.SERVERS names and every ids file the base branch holds, so a
branch that drops a server from config.SERVERS (or names another file for it) can't take that
server's ids out of the check with the same change.

Usage (from the repo root):
    python pipeline/check_ids.py                # the files are well formed
    python pipeline/check_ids.py origin/main    # ... and keep every id origin/main has
"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

KINDS = ("power", "powerset", "boostset", "archetype", "origin")
HERE = Path(__file__).resolve().parent
if str(HERE.parent) not in sys.path:
    sys.path.insert(0, str(HERE.parent))  # run as a script (CI): the repo root holds the pipeline package


def problems(data: object) -> list[str]:
    """Everything wrong with one registry's shape.

    @param data The parsed ids file.
    @return One line per problem (empty when it is well formed): a kind missing or not an object,
        a key that isn't lower case, an id that isn't a positive whole number, an id used twice.
    """
    if not isinstance(data, dict):
        return ["the file is not an object"]
    out = []
    for kind in KINDS:
        m = data.get(kind)
        if not isinstance(m, dict):
            out.append(f"{kind}: missing or not an object")
            continue
        seen: dict[int, str] = {}
        for name, i in m.items():
            if name != name.lower():
                out.append(f"{kind}: key {name!r} is not lower case (keys are matched lower-cased)")
            if not isinstance(i, int) or isinstance(i, bool) or i <= 0:
                out.append(f"{kind}: {name!r} has id {i!r}, not a positive whole number")
                continue
            if i in seen:
                out.append(f"{kind}: id {i} used by both {seen[i]!r} and {name!r}")
            seen[i] = name
    return out


def changes(old: dict, new: dict) -> list[str]:
    """Every id `old` holds that `new` drops or renumbers.

    @param old The base branch's registry.
    @param new This branch's registry.
    @return One line per change (empty when `new` only adds).
    """
    out = []
    for kind in KINDS:
        before, after = old.get(kind) or {}, new.get(kind) or {}
        for name, i in before.items():
            if name not in after:
                out.append(f"{kind}: {name!r} (id {i}) was removed")
            elif after[name] != i:
                out.append(f"{kind}: {name!r} was renumbered from {i} to {after[name]}")
    return out


def registries() -> list[tuple[Path, Path]]:
    """@return Every server's (ids file, data folder), Homecoming's first, as config.SERVERS names them."""
    from pipeline import config  # imported here: ids.py imports this module, and config is plain paths
    return [(HERE / s.ids, config.data_dir(s.id)) for s in config.SERVERS.values()]


def is_ids_file(name: str) -> bool:
    """Whether a file in pipeline/ is a stable ids file by its name.

    @param name The file's name (no folder).
    @return True for ids.json and ids-<server>.json.
    """
    return name == "ids.json" or (name.startswith("ids-") and name.endswith(".json") and len(name) > len("ids-.json"))


def base_registries(base: str) -> list[Path] | None:
    """The ids files the base branch holds, whatever this branch's config.SERVERS says.

    @param base The base commit.
    @return Their paths in this checkout, by name; None when the base's pipeline/ can't be listed.
    """
    listed = _git("ls-tree", "--name-only", f"{base}:pipeline")
    if listed.returncode != 0:
        return None
    return [HERE / n for n in sorted(listed.stdout.splitlines()) if is_ids_file(n)]


def _git(*args: str) -> subprocess.CompletedProcess:
    """@return The finished git command (output captured as text)."""
    return subprocess.run(["git", *args], capture_output=True, text=True, encoding="utf-8")


def main(argv: list[str]) -> int:
    base = argv[1] if len(argv) > 1 else None
    if base and _git("rev-parse", "--verify", "--quiet", base + "^{commit}").returncode != 0:
        print(f"error: can't read {base}: not a commit")
        return 2
    failed = False
    checked: list[tuple[Path, Path | None]] = list(registries())
    if base:
        held = base_registries(base)
        if held is None:
            print(f"error: can't list pipeline/ at {base}")
            return 2
        named = {reg.name for reg, _ in checked}
        # the base's ids files this branch's config no longer names: still checked (no data folder known)
        checked += [(reg, None) for reg in held if reg.name not in named]
    for reg, data in checked:
        name = f"pipeline/{reg.name}"
        at_base = bool(base) and _git("cat-file", "-e", f"{base}:{name}").returncode == 0
        if not reg.is_file():
            # a server with published data, or a file the base branch has, can't lose its ids
            if at_base:
                print(f"error: {name} was deleted (it exists on {base}); every link to that server needs it")
                failed = True
            elif data is not None and (data / "versions.json").is_file():
                print(f"error: {name} is missing while {data.relative_to(HERE.parent).as_posix()} holds data")
                failed = True
            else:
                print(f"{name}: none yet (no data for its server)")
            continue
        new = json.loads(reg.read_text(encoding="utf-8"))
        bad = problems(new)
        note = ""
        if base:
            if not at_base:
                note = f", new since {base}"  # a new server's file: nothing to keep yet
            else:
                shown = _git("show", f"{base}:{name}")
                if shown.returncode != 0:
                    print(f"error: can't read {name} at {base}: {shown.stderr.strip()}")
                    return 2
                bad += changes(json.loads(shown.stdout), new)
                note = f", only appended to since {base}"
        for line in bad:
            print(f"error: {name}: {line}")
        if not bad:
            print(f"{name}: well formed{note}")
        failed = failed or bool(bad)
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
