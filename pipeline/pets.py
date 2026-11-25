"""Write a published game version's pseudo-pet file, and nothing else.

The pseudo-pet file (<server data>/pets/<version>.json, Exporter.build_pets) sits beside the
version folders, so a published folder never changes. A version published before pet files existed
gets one from the client it was made from:

    python -m pipeline.pets                                  # the default version
    python -m pipeline.pets --game-version i28p3             # COH_CLIENT pointing at a copy of its client
    python -m pipeline.pets --server thunderspy --game-version ts9-6

The configured client must be the one the version was made from (the exe and pigg hashes in its
core.json manifest.source): any other client is refused, as only that one describes the version's
pets. The version folder, versions.json, the ids file, the reports and the assets are left alone.
pipeline.run writes the same file along with the rest of a version.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from pipeline import config  # noqa: E402
from pipeline.decode import live  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--server", choices=sorted(config.SERVERS), default=config.HOMECOMING.id,
                    help="game server whose client to read (default homecoming)")
    ap.add_argument("--game-version", help="the published version id (default: the server's default)")
    ap.add_argument("--force", action="store_true", help="ignore the decode cache")
    args = ap.parse_args()
    config.select_server(args.server)
    from pipeline import export, run

    try:
        default = (config.version_index(config.SERVER.id) or {}).get("default")
    except ValueError as e:
        if not args.game_version:
            print(f"error: {export.data_rel('versions.json')} is unreadable ({e}); pass --game-version")
            return 2
        default = None
    version = args.game_version or default or run.default_game_version()[0]
    if not version or not config.valid_version_id(version):
        print(f"error: no valid game version ({version!r}): pass --game-version")
        return 2
    rel = export.data_rel(version)
    try:
        made = json.loads((config.DATA_OUT / version / "core.json").read_text(encoding="utf-8"))["manifest"]
    except (OSError, ValueError, KeyError):
        print(f"error: {rel} is not a published version (no readable core.json); pipeline.run makes one")
        return 2
    if made.get("approximate"):
        print(f"error: {rel} is an approximate version: pipeline.overlay copies its base's pet file")
        return 2
    config.preflight()
    source = {"exe": live.sha1(config.EXE), "bin.pigg": live.sha1(config.BIN_PIGG),
              "bin_powers.pigg": live.sha1(config.POWERS_PIGG)}
    if made.get("source") != source:
        print(f"error: {rel} was made from a different client (exe or pigg hashes differ); point the "
              f"{config.SERVER.env} setting at a copy of the client it was made from. Nothing was written.")
        return 2

    data = live.load(force=args.force)
    bad = [k for k, v in data.health.items() if v["partial"]]
    if bad:
        print(f"error: decode health gate failed ({', '.join(bad)}); nothing was written")
        return 1
    ex = export.Exporter(data)
    ex.use_pvp_test(made.get("pvpTest", 1))  # the PvP-only test the version was made with
    powers = json.loads((config.DATA_OUT / version / "powers.json").read_text(encoding="utf-8"))
    if not ex.reproduces(powers):
        print(f"error: {rel}'s effect groups differ from what its PvP-only test makes now (the "
              "pipeline changed since it was made?); nothing was written")
        return 2
    ex.build()                   # what the version exports; its ids are never saved here
    summary = export.write_pets(ex.build_pets(), version)
    for w in export.pet_warnings(summary):
        print(w)
    print(f"wrote {export.data_rel(config.PETS_FOLDER, version + '.json')}: {summary['creators']} powers "
          f"create {summary['pets']} pseudo-pets ({summary['pet_powers']} pet powers, "
          f"{summary['powers'] - summary['pet_powers']} more carried for what powers execute, {summary['bytes']} "
          f"bytes); EntCreate mods left out: {summary['skipped'] or 'none'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
