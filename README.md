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
`pipeline/` (run locally; it needs the decoder tools in `<COH_SOURCE>\tools` and a
Homecoming client install). MidsReborn's database is used only to validate the decode
(`pipeline/report.md`) and to map names for importing and exporting Mids build files.

Refreshing the data after a game patch:

1. `python -m pipeline.run` (add `--force` to ignore the decode cache)
2. Review `pipeline/report.md`
3. Commit `public/data/`, `public/assets/` and `pipeline/ids.json`

`pipeline/ids.json` holds the stable IDs that share links use; never delete or renumber it.

Engine notes: `docs/game-rules.md` (pick, auto-grant and slot rules) and `docs/exemplar-rules.md`
(exemplar rules, pending review).

## Development

```bash
npm install
npm run dev
npm test
npm run build
```

## License

The code is GPL-3.0 (see `LICENSE`); parts of the build rules are ported from
[MidsReborn](https://github.com/LoadedCamel/MidsReborn), which is also GPL-3.0.

Not affiliated with or endorsed by NCSoft or Homecoming. City of Heroes and all game data and art
are the property of their respective owners.
