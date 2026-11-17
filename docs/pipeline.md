# Data pipeline

How the Python pipeline turns client files into `public/data` and `public/assets`. It runs on the
owner's machine only. The rules every change must keep are in `AGENTS.md`.

## MidsReborn exceptions (owner-approved)

- The one exception, approved by the owner: an **approximate version** for an older patch whose
  client files are gone (`python -m pipeline.overlay`, for example `i28p3m`, "Issue 28, Page 3
  (approximate)"). It is a published version's data with only each power's available level (and
  so each set's order) taken from Mids' database for that patch. Pool sets keep the base's levels.
  It is never the default, `versions.json` marks it `approx: true` with its `patch`, and the app
  says so when a build opens on it. If real client files for that patch turn up, they get their
  own folder beside it, and the approximate one is removed (as `i28p3m` was for `i28p3`).
- A second exception, also approved: an older client with no enhancement frame data (before the
  February 10, 2026 update) shows a newer version's frames (`--frames-from`, recorded as
  `framesFrom` in its manifest). Frames are artwork only; no number comes from the other version.
  Thunderspy's client has none either and borrows Homecoming's (`--frames-from homecoming/i28p4`):
  by internal name, and for a set piece Homecoming lacks, the pair Homecoming's set pieces use for
  its conversion group (attuned or not), which matches every Homecoming set piece it answers when
  tried on Homecoming's own sets one left out at a time (`borrow_frames` in `pipeline/export.py`).

**Data pipeline.** `python -m pipeline.run` reads the client's `bin.pigg`, `bin_powers.pigg` and
the client executable (for parse-table layouts and enum names), decodes powers, sets,
archetypes, enhancements, tables and English text, and writes `public/data/<version>/`. That
folder holds `core.json`, `powersets.json`, `powers.json`, `boosts.json` and `mids-map.json`.
Beside it the run writes the version's pseudo-pets, `public/data/pets/<version>.json`
(Exporter.build_pets): the pets whose damage the client's power info adds to the power that makes
them (Burn, Irradiated Ground, Rain of Fire, ...), with their powers, villain classes and the
tables they read (villaindef.bin and villain_classes.bin are decoded for it), what their powers
execute and the names of what they grant that the version lacks. It is not part of the
version hash. `python -m pipeline.pets [--server S] [--game-version V]` writes only that file, for
a version published before it existed, and refuses any client but the one the version was made
from (`COH_CLIENT` pointing at a copy of an older client for an older version). It also uses the
PvP-only test the version was made with (below), and refuses a version whose groups that test no
longer makes. The pet rules come from reading each client's code: an export from a client exe not
listed in its server's `pet_checked` (`pipeline/config.py`) warns until someone reads it and adds
its hash.

The export drops PvP-only effect groups (the planner models PvE): a group with the PVPOnly flag,
or one whose requirement tests for a player target (`enttype target> player eq`) and can never
hold in PvE, against a critter target off PvP maps (`pipeline/pvp.py`, `pvp_requires`: the game's
postfix evaluator over true / false / unknown, with eval.c's own value rules). A group that tests
for a player target among other things ("a boss or a player": Stygian Circle's 428.36 heal, in game
on Thunderspy) is kept. Each version's manifest records the test its groups were made with
(`pvpTest`, `pvp.PVP_TESTS`); a version without it (i28p4, i28p3, ts9-6, every one published before)
was made with the first, `pvp_requires_v1`, which dropped any group with a player test and no
critter test. A run from a published version's own client, and `pipeline.pets`, use that version's
test (`Exporter.use_pvp_test`), so they reproduce it, and warn or refuse when its groups no longer
come out the same (`Exporter.reproduces`); a new version gets the current test. @TODO the test
reads every target as a critter, as the first did, though an ally's or the caster's own target is a
player in PvE too (Empathy's Adrenaline Boost heal).

The run then exports icons, UI textures, fonts and sounds to `public/assets/` and writes
`pipeline/report.md`. Safety rails:

- It refuses to write anything if any record decodes partially, or if a bin's records don't fill
  it exactly (a wrong record count).
- It refuses to rewrite a version folder made from a different client (other exe or pigg hashes)
  unless given `--overwrite-published`: a run that forgot `--game-version` after a patch, or one
  pointed at another client copy, stops before writing anything. The same goes for a re-run whose
  `--frames-from` differs from the folder's `framesFrom` (a forgotten flag would strip every
  enhancement's frames).
- It keeps an existing folder's `mids-map.json` unless given `--refresh-mids-map` (old Mids codes
  depend on it, and it isn't part of the version hash).
- It refuses version ids other than lower-case letters, digits, `-` and `_`.
- It saves `ids.json` first, and refuses a damaged one (an id used twice, a mixed-case key).
- It refuses to shrink the asset set, and writes images atomically under names it checks.
- Reports are committed, so machine paths in them are replaced with placeholders.

Re-running on an unchanged client changes no files. After a patch:

1. Pick a new version id and label: `--game-version i29p1 --game-label "Issue 29, Page 1"`, plus
   `--make-default` once it is ready.
2. Review `report.md`.
3. Commit `public/data`, `public/assets` and `pipeline/ids.json` through a pull request.

An older patch whose client survives (a copy of an old install) gets its own version: point
`COH_CLIENT` at the copy and run `python -m pipeline.run --game-version <id> --game-label
"<label>" [--frames-from <newer id>]` without `--make-default`. A version that is not the default
writes `pipeline/report-<id>.md` instead of `report.md`, and its asset export only adds icons
`public/assets` lacks (it never overwrites, and leaves UI textures, fonts and sounds alone). Never
run anything from the old install itself: copy the files, read the copy.

**Thunderspy** (`--server thunderspy`) reads its own client (`COH_CLIENT_THUNDERSPY`, or
`servers.thunderspy.client` in `pipeline/paths.local.json`): `Thunderspy.exe`, every bin in
`tspy/bin.pigg`, base art in `piggs/`, its own art in `tspy/*.pigg`. Run
`python -m pipeline.run --server thunderspy --game-version ts<release> --game-label "Release <x.y>"
--frames-from homecoming/i28p4` (the release is the folder the live manifest,
https://thunderspy.net/manifest/live.xml, gives `tspy/bin.pigg`: `9.6` is `ts9-6`). It writes
`public/data/thunderspy/`, `pipeline/ids-thunderspy.json` and `pipeline/report-thunderspy.md`, no
Mids map (MidsReborn has no Thunderspy database), and never touches the shared assets: it keeps
its own copy of every icon it shows in `public/assets/thunderspy/icons/`, and the data names them
`thunderspy:<name>` (the app's `icon()` resolves the prefix). Where its art matches the shared icon
(`icon_difference`, a 32x32 comparison) the copy is the shared file's bytes, so the default art shows
and Git stores the file once; a later Homecoming redraw can't change what Thunderspy shows. A newer
Thunderspy release's default run does replace a redrawn icon for every Thunderspy version, as
Homecoming's newest version does for the shared icons; an older Thunderspy version only adds files
the folder lacks. Icons are decided before the run's checks and written after them
(`plan_icon_overlay`, `write_icon_overlay`): a name that can't be a file stops the run before
anything is written, a refused run writes nothing, and `--no-assets` writes no icon files. Every
`tspy/*.pigg` is read for art, the last by file name winning; the report names any texture two of
them draw differently (none in release 9.6), to check against the game.

Thunderspy's download server keeps only the files its live manifest names, so a superseded release
can't be fetched again: export each release while it is live, or keep a copy of its
`tspy/bin.pigg` and `Thunderspy.exe`. `python -m pipeline.watch` says when one is live: it compares
the release folder and MD5 the live manifest gives `tspy/bin.pigg` with `binRelease` and `binMd5` in
`pipeline/patch-watch.json`, the installed client with the manifest, and the installed client with
the default version's source hashes. It prints the export command for a new release and exits 1
when something needs doing (2 when it can't check, a crash included). Once the release is exported as the default
version, `python -m pipeline.watch --record` records it; it refuses unless the default version was
made from the live `tspy/bin.pigg`.

`python -m pipeline.compare --server thunderspy` writes `pipeline/report-thunderspy-diff.md`: where
Thunderspy's default version differs from Homecoming's default, by internal name (player powers, power
set orders and levels, archetype tables, the level schedule, boost effect, exemplar and diminishing
returns, enhancement sets and their bonuses). It reads committed data only (no client), resolves ids,
attribute offsets, damage and defense types, `Knock` / `Knockback` and power modes to names first so
numbering differences are not reported, and compares per-level tables over levels 1-50. Effects show
as counts only; `--effects N` writes `report-thunderspy-diff-full.md` (gitignored) with N differing
effect lines a side per power. The owner uses it to know what to spot-check in the Thunderspy client. A Thunderspy `pipeline.run` summarises it in
`report-thunderspy.md` ("Differences from Homecoming"); re-run it after a new release or a new
Homecoming default.
An older patch with no client files left can get an approximate version:
`python -m pipeline.overlay [--base i28p4]` copies the base version and takes each power's
available level from the configured Mids database (its header names the issue and page). Review
`pipeline/report-<id>.md`, then commit `public/data` and the report through a pull request.
