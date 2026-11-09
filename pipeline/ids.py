"""Append-only stable integer IDs for exported entities.

Share URLs and saved builds store these IDs, so an ID is never reused or renumbered: new names get
the next free number, names that disappear from the game keep their reservation. The registry is
committed at pipeline/ids.json.
"""
from __future__ import annotations

import json

from pipeline import config

REGISTRY = config.REPO / "pipeline" / "ids.json"
KINDS = ("power", "powerset", "boostset", "archetype", "origin")


class IdRegistry:
    """Name -> id maps per entity kind, loaded from and saved to pipeline/ids.json."""

    def __init__(self):
        self.maps: dict[str, dict[str, int]] = {k: {} for k in KINDS}
        if REGISTRY.exists():
            data = json.loads(REGISTRY.read_text(encoding="utf-8"))
            for k in KINDS:
                self.maps[k] = {n: int(i) for n, i in data.get(k, {}).items()}
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
        config.out_path(REGISTRY).write_text(json.dumps(out, indent=0), encoding="utf-8")
