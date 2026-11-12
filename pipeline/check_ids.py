"""Check pipeline/ids.json: well formed, and only ever appended to.

Share links and saved builds store these ids, so an id that changes, disappears or is reused
breaks every link that holds it. CI runs this against the pull request's base branch.

Usage (from the repo root):
    python pipeline/check_ids.py                # the file is well formed
    python pipeline/check_ids.py origin/main    # ... and keeps every id origin/main has
"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

KINDS = ("power", "powerset", "boostset", "archetype", "origin")
REGISTRY = Path(__file__).resolve().parent / "ids.json"


def problems(data: object) -> list[str]:
    """Everything wrong with one registry's shape.

    @param data The parsed ids.json.
    @return One line per problem (empty when it is well formed): a kind missing or not an object,
        a key that isn't lower case, an id that isn't a positive whole number, an id used twice.
    """
    if not isinstance(data, dict):
        return ["ids.json is not an object"]
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


def main(argv: list[str]) -> int:
    new = json.loads(REGISTRY.read_text(encoding="utf-8"))
    bad = problems(new)
    if len(argv) > 1:
        shown = subprocess.run(["git", "show", f"{argv[1]}:pipeline/ids.json"], capture_output=True, text=True, encoding="utf-8")
        if shown.returncode != 0:
            print(f"error: can't read pipeline/ids.json at {argv[1]}: {shown.stderr.strip()}")
            return 2
        bad += changes(json.loads(shown.stdout), new)
    for line in bad:
        print(f"error: {line}")
    if not bad:
        print("pipeline/ids.json: well formed" + (f", only appended to since {argv[1]}" if len(argv) > 1 else ""))
    return 1 if bad else 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
