"""Write a published game version's power-info extras file, and nothing else.

The extras file (<server data>/info/<version>.json, Exporter.build_info) sits beside the version
folders, so a published folder never changes. It holds what the client's power info reads from
fields the version's own files don't carry: each effect's own note ("Within 20ft radius", "Main
Target Only"), the granted powers it lists no grant for, the "Aggro Type" row, the attribute names
and note texts of the client's messages, and, where the client lists PvP-only groups (Thunderspy),
those powers' groups. A version published before extras files existed gets one from the client it
was made from:

    python -m pipeline.info                                  # the default version
    python -m pipeline.info --game-version i28p3             # COH_CLIENT pointing at a copy of its client
    python -m pipeline.info --server thunderspy --game-version ts9-6

The configured client must be the one the version was made from (the exe and pigg hashes in its
core.json manifest.source), and its pets file must exist: the notes are laid out on the groups of
the version's own files, which are checked against the client's. The version folder, versions.json,
the ids file, the reports and the assets are left alone. pipeline.run writes the same file along
with the rest of a version.
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
    folder = config.DATA_OUT / version
    try:
        made = json.loads((folder / "core.json").read_text(encoding="utf-8"))["manifest"]
        powers = json.loads((folder / "powers.json").read_text(encoding="utf-8"))
        boosts = json.loads((folder / "boosts.json").read_text(encoding="utf-8"))
    except (OSError, ValueError, KeyError):
        print(f"error: {rel} is not a published version (no readable core.json, powers.json and "
              "boosts.json); pipeline.run makes one")
        return 2
    if made.get("approximate"):
        print(f"error: {rel} is an approximate version: it has no client of its own to read")
        return 2
    pets_rel = export.data_rel(config.PETS_FOLDER, version + ".json")
    try:
        pets = json.loads((config.DATA_OUT / config.PETS_FOLDER / f"{version}.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        print(f"error: {pets_rel} is missing or unreadable; python -m pipeline.pets makes it first")
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
    ex.build()                   # what the version exports; its ids are never saved here
    shown = export.info_powers({"powers": powers, "boosts": boosts})
    summary = export.write_info(ex.build_info(shown, pets.get("powers") or {}, version), version)
    for w in export.info_warnings(summary):
        print(w)
    print(f"wrote {export.data_rel(config.INFO_FOLDER, version + '.json')}: notes for {summary['notes']} powers, "
          f"{summary['hidden_grants']} hidden grants, {summary['aggro']} aggro rows, {summary['groups']} powers' "
          f"PvP-listing groups ({summary['bytes']} bytes)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
