# AGENTS.md

Guidance for AI coding agents and tool-kits (Claude Code, Cursor, Codex and the like) working in
this repository. Read it before changing anything. Where this file and a request from the
repository owner disagree, ask the owner.

## What this project is

**Hate's CoH Planner** is a City of Heroes (Homecoming) character build planner that looks and
plays like the game's own level-up screens. It is a static web app (Vite + React + TypeScript)
published on GitHub Pages: https://hateborne.github.io/HatesCoHPlanner/

Who uses it and for what:

- **Players** plan a character from level 1 to 50 in screens that copy the game ("Choose a New
  Power", "Choose a Pool Power Set", "Add an Enhancement Slot"), then place enhancements on a
  build overview and read totals, set bonuses and detailed power numbers.
- They **share** builds as links (`#b=...`), keep builds in the browser, and move builds to and
  from MidsReborn (`.mbd` files and Mids share codes).
- The **owner** refreshes the game data after each Homecoming patch with the Python pipeline.

Goals, in priority order:

1. **Correct numbers from the live game.** All game data is decoded from the Homecoming client
   files. The build math is ported from the game engine's source (and, where the engine is
   silent, from MidsReborn's GPL code).
2. **Fidelity to the in-game screens.** Layout, sizes, fonts, colours, textures and sounds come
   from the client and its UI source. They are ported, not hand-tuned.
3. **Builds never break.** Share links, saved builds and Mids exports made today must still open
   after future patches.
4. **Privacy.** Nothing that identifies the owner or their machine goes into the repository.

It is a non-profit fan tool, GPL-3.0, and not affiliated with NCSoft or Homecoming.

## Hard rules

Breaking any of these is a bug, whatever else the change does.

**Privacy**
- Never commit personal data: real names, e-mail addresses (commits use the GitHub noreply
  address), local file system paths (drive-letter paths into user folders, game install
  folders or source checkouts), or names of personal files.
- Machine paths live only in `pipeline/paths.local.json` (gitignored; template
  `pipeline/paths.example.json`) or in the `COH_CLIENT` / `COH_SOURCE` / `COH_MIDS` environment
  variables.
- Tests that need a personal file read its path from an environment variable and skip when it
  is unset (for example `HCP_MIDS_SAMPLE` in `tests/io.test.ts`).
- The CI "Privacy" check fails on drive-letter paths in tracked files.

**Local-only material**
- `IGNORE/` holds the owner's in-game reference screenshots. It is gitignored. Read it, never
  commit it, never move its contents into tracked folders.

**MidsReborn is an untrusted reference**
- Use it to cross-check numbers (`pipeline/report.md`) and to map names for Mids import/export.
- Never copy game data from it into the planner, and never "fix" our data to match it.
  Disagreements are evidence to investigate; I28 changes are real differences.
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
- Code that touches Mids data must survive it being missing or malformed: warn and carry on.

**Stable IDs and old builds**
- `pipeline/ids.json` assigns the numeric IDs that share links and saved builds use. It is
  append-only: never renumber, reuse, reorder or delete entries.
- Each game version's data lives in its own folder, `public/data/<id>/` (for example `i28p4` for
  Issue 28, Page 4), listed in `public/data/versions.json`. Never edit or delete a published
  version folder: links made on that patch load it. A new patch gets a new folder.
- The share-link format (`src/io/share.ts`) may only grow by optional trailing fields, and old
  links must keep decoding. Links without a version open as `LEGACY_GAME_VERSION` (`i28p4`).
- Builds from outside the app (links, browser storage, saved builds, imports) always pass
  through `checkBuild` (`src/engine/validate.ts`) against their own version's data before use.
- A Mids import opens on the patch it was made on (see "Imports and patches" below). The table
  of Mids database versions (`MIDS_DB_PATCHES` in `src/io/midsPatches.ts`) only gets entries the
  owner has confirmed.

**Rules are flagged, not silently fixed**
- A build that breaks a game rule (a missing prerequisite, a slot an enhancement can't go in) is
  shown in red with the reason. The planner never removes the user's choices on its own.
- Changes that would discard the user's enhancements are refused with a visible message, or
  confirmed first through the in-app dialog (`askConfirm`).

**Text**
- Use ASCII only in everything you author: code, comments, docs, commit messages, PR text and
  chat. Write `>=`, `<=`, `->`, `x` or `*`, `-`, `~` and `+/-`, never the single-glyph Unicode
  forms. (Game text decoded from the client is data and is left as it is.)

**Git and GitHub**
- `main` is protected: every change goes through a pull request, all CI checks must pass, and
  pull requests need the owner's approval (CODEOWNERS); the owner may approve their own.
- Never force-push `main`, rewrite its history, or change repository settings, rulesets or
  secrets.
- Commit, push or open a pull request only when the owner asks for it.
- Exception, standing permission for this repository: on a pull request you opened, watching its
  CI and committing and pushing fixes to that pull request's branch (failing checks, merge
  conflicts, review comments that ask for a real fix) is always allowed without asking. In Claude
  Code, turn Auto-fix on for every pull request you open here instead of offering it.

**Ask, don't assume**
- When a request is ambiguous or a fact can't be found in the code, the data or these docs, ask
  the owner. Do not fill the gap with a guess.

## Repository layout

```
src/
  main.tsx, App.tsx          entry; CrashGuard wraps the app; stage, toggles, dialogs
  data/
    gamedata.ts              GameData: indexed game data + loadGameData(base, version)
    versions.ts              versions.json, LEGACY_GAME_VERSION, resolveVersion()
    types.ts                 shapes of the exported JSON
  engine/                    pure TypeScript build rules (no React, no DOM)
    build.ts                 Build / Pick / Slot model, newBuild()
    rules.ts                 BuildRules: availability, picks, auto-granted powers, slots, issues
    requires.ts              the game's RPN requirement evaluator
    schedule.ts              pick / slot / pool / epic level schedules
    enhance.ts               enhancement values, ED, origin and set validity, help text
    setbonus.ts, totals.ts   set bonuses (rule of 5) and the totals panel
    powerinfo.ts             detailed power numbers (base vs enhanced)
    actions.ts               pure edits (setPick, addSlot, setEnh, ...) and pickHoldsEnhancements
    validate.ts              checkBuild(): check and repair builds from outside the app
    migrate.ts               fitToPatch(): swaps that fit an import moved to another patch
  io/
    share.ts                 #b= share links (bit-packed, deflated, base64url)
    mids.ts                  Mids .mbd and share codes (|MBD; and legacy |MxDz;)
    midsPatches.ts           which patch a Mids build was made on (Mids database version table)
    library.ts               builds saved in the browser (IndexedDB)
    binary.ts                byte reader / writer helpers
  state/store.ts             zustand store: data, current build, level-up flow, dialogs
  ui/
    screens/                 Setup (New Build), ChooseNewPower, ChoosePoolSet,
                             AddEnhancementSlot, Overview, EnhancementPicker, BuildMenu
    components/              game chrome (frames, bars, rings, scrollbars, text, tooltips)
    skin/                    metrics.ts (virtual-screen maths), skin.ts (hero/villain/praetorian)
    hover.ts                 hover / tooltip state (kept out of the screens on purpose)
    escape.ts                Escape-key stack (useEscape)
    sound.ts                 game UI sounds and menu music
tests/                       vitest; tests/helpers/data.ts loads public/data like the site does
  fixtures/builds/           forum builds (Mids data chunks, .mbd files) the browser tests recreate
e2e/                         Playwright browser tests (playwright.config.ts; local only)
public/data/<version>/       exported game data per game version (generated, committed)
public/data/versions.json    version index {default, versions: [{id, label, hash, patch?, approx?}]}
public/assets/               icons, UI textures, fonts, sounds (generated, committed)
pipeline/                    Python data pipeline (runs on the owner's machine only)
  run.py                     entry point: python -m pipeline.run
  overlay.py                 approximate older-patch versions (python -m pipeline.overlay)
  config.py                  inputs, preflight checks, atomic writes
  ids.json                   stable IDs (append-only)
  patch-watch.json           newest patch-notes post seen; game version id and label
  inputs/fonts/              vendored game fonts (never change)
  report.md                  validation report of the last run
  report-<id>.md             report of a version that is not the default (pipeline.run), or what an
                             approximate version changed (overlay.py)
tools/                       standard-library Python decoders for client file formats
docs/game-rules.md           pick, auto-grant and slot rules ported from the engine source
docs/exemplar-rules.md       exemplar rules (pending the owner's review)
.github/workflows/           ci.yml (pull request checks), pages.yml (deploy on main)
```

## How it works

**Data pipeline.** `python -m pipeline.run` reads the client's `bin.pigg`, `bin_powers.pigg` and
the client executable (for parse-table layouts and enum names), decodes powers, sets,
archetypes, enhancements, tables and English text, and writes `public/data/<version>/`. That
folder holds `core.json`, `powersets.json`, `powers.json`, `boosts.json` and `mids-map.json`.

The run then exports icons, UI textures, fonts and sounds to `public/assets/` and writes
`pipeline/report.md`. Safety rails:

- It refuses to write anything if any record decodes partially.
- It saves `ids.json` first.
- It refuses to shrink the asset set.

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

An older patch with no client files left can get an approximate version:
`python -m pipeline.overlay [--base i28p4]` copies the base version and takes each power's
available level from the configured Mids database (its header names the issue and page). Review
`pipeline/report-<id>.md`, then commit `public/data` and the report through a pull request.

**Loading.** The app fetches `public/data/versions.json`, then loads the game version the current
build asks for (the default for a new build), with `?v=<hash>` against stale caches. The New
Build screen's version picker switches versions; each version is fetched once per page.

**Imports and patches.** A Mids build records only its Mids database version, so
`midsMadeOn()` (`src/io/midsPatches.ts`) looks it up in the owner-confirmed table. An unlisted
version is placed by number: between two listed versions it belongs to the nearest one below it,
one older than every listed version was made before the oldest listed patch, and one newer than
every listed version is unknown and opens on the default version (it may be any later patch, so
today's Mids builds never land on older data). The planner's own exports
name their game version (`BuiltWith.GameVersion`, which Mids ignores). Old `|MxDz;` codes record
nothing and open on the default version. `importTarget()` (`src/data/versions.ts`) then opens the
build on its own patch when the site carries it, exact data before approximate. Otherwise it
offers the nearest newer patch, or the newest. A move first lists the swaps `fitToPatch()` makes
in the confirm dialog: picks trade places, slots trade the levels they were gained at, nothing is
removed. The overview then keeps that list ("Changes for ...", `PatchNotes`) until it is
dismissed.

**Engine.** `BuildRules` (`src/engine/rules.ts`) answers every question the screens ask: what can
be picked at a level, what is auto-granted, where slots can go, what is wrong with the build.
`totals.ts` and `enhance.ts` do the math with the game's own tables: enhancement curves,
Enhancement Diversification, boosters and exemplar handicaps, set bonuses with the rule of 5,
and archetype caps. The engine is pure and synchronous; keep React and the DOM out of it.

**Builds.** A `Build` (`src/engine/build.ts`) stores ids only:

- archetype, origin, alignment, primary and secondary;
- 24 picks with their slots and enhancements;
- auto-granted powers' slots and on/off switches;
- an optional stop level (`endLevel`) and the game version (`dataVersion`).

It is persisted per browser tab (sessionStorage, with a localStorage fallback for new tabs). It
is mirrored into the address bar as `#b=<share code>` with `history.replaceState`, so a reload or
a copied address brings back exactly that build.

**Store and screens.** `src/state/store.ts` (zustand) holds the game data, the build and the
level-up flow. The flow is a wizard from level 1 to 50, or one level reopened from the overview
(`mode: 'edit'`, Cancel restores the original). A Respec build (New Build's Build Type,
`Build.respecTo`) walks its own order instead (`respecSteps()` in `src/engine/schedule.ts`):
every power first (level 1's secondary before its primary), then one slot screen where any power
may take any slot, as Homecoming's respec does (`docs/game-rules.md`, "Respec order"). Screens
read the store with narrow selectors (`useShallow`) and call its actions.

**Stage.** Every screen draws on a fixed stage scaled to the window with CSS zoom:

- Desktop is 2000x1125, for landscape windows at least 768px wide.
- Narrower or portrait windows (phones, upright tablets) get a one-panel-at-a-time phone layout.
  Its stage is 667 wide and shaped like the window, at least 1067 tall (`src/ui/stageLayout.ts`):
  1.5x the size of the original 1000-wide phone canvas, so the game's bars are about 33px on a
  phone. Phone screens lay out from
  `src/ui/components/Phone.tsx` (`phoneGeom`, `phonePanel`, `phoneDesc`, `PhoneTabs`).
- A touch screen held sideways and shorter than 500px shows a "turn your phone upright" message.
- Phones have no hover: a long press (`longPress` in `src/ui/press.ts`) shows the tooltip
  instead. Clickable chrome takes `pressKeys` for keyboard access.
- Positions come from the client's virtual 1024x768 layout through `vx` / `vy` / `vs` in
  `src/ui/skin/metrics.ts`. Comments cite the client source each number comes from (for example
  `uiLevelPower.c`, `uiLevelSpec.c`, `uiPowers.c`).
- The owner compares visuals with in-game screenshots taken at 3840x2160 (in `IGNORE/`).

**Pop-ups and hovers.**
- Every pop-up closes with Escape (`useEscape`).
- Questions use `askConfirm`; refusals use `notify` or `flashLocked`.
- Hover state (tooltips, glows) lives in `src/ui/hover.ts`, so a hover redraws only the piece it
  affects, never a whole screen. Keep it that way.

## Commands

The web app needs Node 20 or newer (CI uses Node 22). The pipeline needs Python 3.12 and the
owner's local inputs.

```bash
npm ci               # install exactly what package-lock.json pins
npm run dev          # dev server at http://localhost:5173/HatesCoHPlanner/
npm run lint         # ESLint
npm run typecheck    # tsc -b
npm test             # vitest
npm run e2e          # Playwright browser tests (local only; uses the installed Google Chrome)
npm run build        # type check + production build into dist/
python -m pipeline.run --help
```

Before you hand back a change, run lint, typecheck and tests. Run the build for anything that
touches configuration or dependencies.

## Pull request checks (`.github/workflows/ci.yml`)

| Check | Runs |
|---|---|
| Web app (lint, types, tests, build) | `npm ci`, lint, typecheck, test, build |
| Dependency audit | `npm audit --omit=dev --audit-level=moderate` (shipped code), `npm audit --audit-level=high` (tools) |
| Data pipeline (Python compiles) | `python -m compileall pipeline tools`; every JSON file under `public/data` and in `pipeline/` parses |
| Privacy (no local paths or machine settings) | `pipeline/paths.local.json` untracked; no drive-letter paths in tracked files |

Pages deploys run from `main` after a merge, one at a time.

## Coding standards

**TypeScript and React**
- `strict`, `noUnusedLocals` and `noUnusedParameters` are on; ESLint must pass with no warnings
  you have not justified in a comment.
- Prefer pure functions in `src/engine/` with tests over logic inside components or the store.
- Select store fields with `useShallow` (or single-field selectors); a bare `useStore()`
  re-renders on every store change.
- Don't put pointer-hover or per-frame state in a screen's own state. Use `useHover` and small
  subscribing components.
- Reuse the game chrome components (`CheckBar`, `MenuFrame`, `SetFrame`, `SlotRing`,
  `NextButton`, `GameText`, `GameScroll`, ...) instead of new HTML styling.
- Sizes and positions come from the client source through `metrics.ts`. Add a short comment
  naming the client function or file a number comes from.

**Dependencies**
- Exact versions only (`--save-exact`).
- Pick releases at least two weeks old; `npm install --before=<date>` helps.
- Explain any new runtime dependency in the pull request. Shipped code must have no audit
  advisories.

**Documentation style.** Applies to TypeScript and Python alike.
- **Types** (interfaces, classes) get a `/** ... */` block: what it is for and, where relevant,
  how it differs from a related type.
- **Fields and member variables** get a single-line `//` comment, never a doc block.
- **Non-trivial functions** get a doc block on the declaration in up to three bands, separated by
  a blank `*` line:
  1. a one-line summary of what it does;
  2. *(optional)* the load-bearing "why", a non-obvious ordering, or numbered algorithm steps
     (omit when the summary says it all);
  3. `@param` for each parameter and `@return` when it returns something.
- **Simple getters:** a one-line `/** @return X. */`.
- **Inline comments** stay terse one-liners stating what or why. Keep multi-line blocks for
  genuinely complex logic.
- **Bare boolean arguments** get the parameter name at the call site: `/*keepEnhanced=*/ true`.
- Use `@TODO` for known gaps.
- Python follows the same bands in docstrings (`@param`, `@return`, `@raise`).

**Tests**
- Engine, I/O and pipeline-facing changes come with vitest tests (`tests/*.test.ts`). Tests load
  the committed data through `tests/helpers/data.ts`.
- Name game objects by their full internal names (`pid(gd, 'Pool.Leaping.Combat_Jumping')`)
  rather than by numeric ids.
- Share links, Mids formats and `checkBuild` changes need round-trip or backward-compatibility
  tests. Old links must keep decoding.
- Browser tests (`e2e/`, `npm run e2e`) import forum builds from `tests/fixtures/builds/` (sources
  in its README), recreate them through the screens (desktop clicks, phone taps) and compare the
  result with the import:
  - `recreate.spec.ts`: each level-50 build as a Respec;
  - `leveling.spec.ts`: a leveling build (`.mbd` file) walked through the level-up wizard from 1
    to 50, slot levels compared too;
  - `boosted.spec.ts`: a build with its sets boosted, attuned, or boosted then attuned at random.
    It prints its seed; `HCP_E2E_SEED=<seed>` repeats a run.

  They find elements by `data-testid` (`testId` on `CheckBar`, `SlotRing`, `PhoneTabs`); the shared
  driver is `e2e/player.ts`. Run them after changing the screens or the level-up flow.

**Commits and pull requests**
- Commit messages: a short imperative summary line, a blank line, then bullets on what changed
  and why.
- One topic per pull request. Describe the user-visible effect and how it was verified (tests,
  screenshots of the screens touched).
- Generated files (`public/data`, `public/assets`, `src/ui/skin/skinVariants.ts`,
  `pipeline/report.md`, `pipeline/report-<id>.md`, `pipeline/ids.json`) change only through a
  pipeline run, never by hand.

## Game-data notes for agents

- Levels in data are 0-based (`Available[]`, schedules, `SpecializeAt`); the UI shows level + 1.
- Requirement strings (`BuyRequires`, set requirements) are the engine's RPN expressions. Use
  `src/engine/requires.ts`; don't re-implement them.
- Auto-granted powers (Fitness, Brawl, Sprint, archetype inherents, Kheldian form attacks, Bio
  Armor adaptations, Dual Pistols ammo, ...) come from the data and `BuildRules.granted()`. They
  are not hard-coded.
- PvP-only effects are dropped by the pipeline. Incarnates, accolades and temporary powers are
  out of scope for now.
- `docs/game-rules.md` lists the engine rules already ported, with the source file each comes
  from. Add to it when you port another rule.
