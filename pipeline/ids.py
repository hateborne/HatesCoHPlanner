"""Append-only stable integer IDs for exported entities.

Share URLs and saved builds store these IDs, so an ID is never reused or renumbered: new names get
the next free number, names that disappear from the game keep their reservation. Each game server
has its own committed registry (config.IDS_FILE): pipeline/ids.json for Homecoming,
pipeline/ids-<server>.json for another, so one server's ids never move another's.
"""
from __future__ import annotations

import json

from pipeline import check_ids, config

KINDS = ("power", "powerset", "boostset", "archetype", "origin")


def data_exists() -> bool:
    """@return Whether the selected server's data folder already holds an exported data set."""
    return config.DATA_OUT.is_dir() and any(config.DATA_OUT.glob("*/core.json"))


class IdRegistry:
    """Name -> id maps per entity kind, loaded from and saved to the selected server's ids file."""

    def __init__(self):
        self.path = config.IDS_FILE
        name = f"pipeline/{self.path.name}"
        self.maps: dict[str, dict[str, int]] = {k: {} for k in KINDS}
        if self.path.exists():
            data = json.loads(self.path.read_text(encoding="utf-8"))
            # a hand-edited or badly merged registry (an id used twice, a mixed-case key that
            # would never match) must stop the run before it hands out ids from it
            bad = check_ids.problems(data) if any(data.get(k) for k in KINDS) else []
            if bad:
                raise SystemExit(f"error: {name} is damaged -- " + "; ".join(bad[:5])
                                 + ". Restore it from version control.")
            for k in KINDS:
                self.maps[k] = {n: int(i) for n, i in data.get(k, {}).items()}
        if not any(self.maps.values()) and data_exists():
            raise SystemExit(f"error: {name} is missing or empty but the server's data folder already "
                             "holds data -- refusing to renumber the stable IDs. Restore it from "
                             "version control.")
        self.added = {k: 0 for k in KINDS}

    def get(self, kind: str, name: str) -> int:
        """ID for `name`, allocating the next number if it is new (keys are case-insensitive)."""
        m = self.maps[kind]
        key = name.lower()
        if key not in m:
            m[key] = (max(m.values()) + 1) if m else 1
            self.added[kind] += 1
        return m[key]

    def save(self) -> None:
        """Write the registry (sorted by id for readable diffs)."""
        out = {k: dict(sorted(self.maps[k].items(), key=lambda kv: kv[1])) for k in KINDS}
        config.atomic_write(self.path, json.dumps(out, indent=0))
