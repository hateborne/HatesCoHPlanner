# Hate's CoH Planner

A City of Heroes (Homecoming) character build planner that looks and plays like the in-game
level-up screens: "Choose a New Power", "Choose a Pool Power Set" and "Add an Enhancement Slot",
followed by a build overview with enhancements, IO set bonuses and totals. The build math
(enhancement values, Enhancement Diversification, set bonuses with the rule of 5, totals) is
ported from the game engine's own code and from MidsReborn.

Live site: https://hateborne.github.io/HatesCoHPlanner/

## Features

- Level-up wizard, level 1 to 50, game-strict (Finish unlocks when the level is complete) with Back.
- Pool and epic pool picker, VEAT branches at the level the game offers them, Kheldians.
- Build overview: reopen any level's screen from the level strip, place enhancements, per-power
  totals switches, rule violations flagged in red (never auto-fixed).
- Enhancement picker: Training, origin, invention (with level and boosters), IO sets (attuned
  and superior), Hamidon / Hydra / Titan / D-Sync / Synthetic / Talismans.
- Totals with expandable sources; a totals side tab during the wizard.
- Share links (`#b=...`), builds saved in the browser, MidsReborn `.mbd` import/export, Mids share
  codes (`|MBD;` and legacy `|MxDz;`).
- Hero, villain and Praetorian skins by alignment; the game's UI sounds (with a mute switch);
  a one-panel-at-a-time layout on phones.

## Data

All game data comes from the live Homecoming client files, decoded by the Python pipeline in
`pipeline/` with the decoders in `tools/`. MidsReborn's database is a **reference only**, never a
source of truth: it backs up or questions our numbers in the validation report
(`pipeline/report.md`) and maps names for importing and exporting Mids build files. Without it the
pipeline carries the newest existing Mids map forward and skips that report section.

The pipeline's inputs live on your machine and are never committed: copy
`pipeline/paths.example.json` to `pipeline/paths.local.json` (gitignored) and fill in the
Homecoming client folder (`client`), and optionally the folder holding the
`CityOfHeroes_OuroV2_Data` checkout (`source`: loose textures and sounds; without it they come from
the client piggs) and a MidsReborn data folder (`mids`). The `COH_CLIENT`, `COH_SOURCE` and
`COH_MIDS` environment variables override the file. The game fonts are vendored in
`pipeline/inputs/fonts/` (they never change), so they need no input. The run checks its inputs
first and names any missing setting.

`pipeline/patch-watch.json` records the newest Homecoming patch-notes post the data was checked
against (for a scheduled job that notices new patches) and the game version the next run exports
(`homecoming.gameVersion`, e.g. `i28p4`, and `gameLabel`, e.g. `Issue 28, Page 4`).

Each game version lives in its own folder, `public/data/<id>/` (`core`, `powersets`, `powers`,
`boosts`, `mids-map`). `public/data/versions.json` lists them (`{"default", "versions": [{id,
label, hash}]}`, where `hash` is `manifest.hash` for cache busting) and `latest.json` names the
default for older clients. Both are written last.

Refreshing the data after a game patch:

1. `python -m pipeline.run` (add `--force` to ignore the decode cache). Options:
   `--game-version <id> --game-label "<label>"` override patch-watch.json for a new version
   (for example `--game-version i29p1 --game-label "Issue 29, Page 1"`), `--make-default` makes
   it the default in `versions.json` (a new `versions.json` defaults to the first version run),
   `--no-assets`, `--no-validate`.
2. Review `pipeline/report.md`
3. Commit `public/data/`, `public/assets/` and `pipeline/ids.json`

Safety rails: the run aborts before writing anything if any bin decodes with partial records, and
refuses to run if `pipeline/ids.json` is missing or empty while `public/data` holds data
(`pipeline/ids.json` holds the stable IDs that share links use; never delete or renumber it). It
also fails if an asset class ends up smaller than `public/assets/manifest.json` lists. A broken or
missing MidsReborn folder only adds a warning to the report (the newest existing `mids-map.json`
is carried forward, possibly stale). Re-running with no game change produces no file changes.
The decode cache (`pipeline/.cache`) is keyed by the sha1 of the client files and the decoder
source.

Engine notes: `docs/game-rules.md` (pick, auto-grant and slot rules) and `docs/exemplar-rules.md`
(exemplar rules, pending review).

## Development

```bash
npm install
npm run dev
npm test
npm run build
npm run e2e   # browser tests (Playwright, with the installed Google Chrome)
```

## License

The code is GPL-3.0 (see `LICENSE`); parts of the build rules are ported from
[MidsReborn](https://github.com/LoadedCamel/MidsReborn), which is also GPL-3.0.

Not affiliated with or endorsed by NCSoft or Homecoming. City of Heroes and all game data and art
are the property of their respective owners.
