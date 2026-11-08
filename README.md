# Hate's CoH Planner

A City of Heroes (Homecoming) character build planner that looks and plays like the in-game
level-up screens: "Choose a New Power", "Choose a Pool Power Set" and "Add an Enhancement Slot",
followed by an Enhancement Management style overview. The build math (enhancements, Enhancement
Diversification, IO set bonuses, totals) is modeled on MidsReborn.

Live site: https://hateborne.github.io/HatesCoHPlanner/

## Data

All game data comes from the live Homecoming client files, decoded by the Python pipeline in
`pipeline/` (run locally; it needs the decoder tools in `<COH_SOURCE>\tools` and a
Homecoming client install). MidsReborn's database is used only to validate the decode and to map
names for importing and exporting Mids build files.

Refreshing the data after a game patch:

1. `python pipeline/run.py`
2. Review `pipeline/report.md`
3. Commit `public/data/` and `public/assets/`

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
