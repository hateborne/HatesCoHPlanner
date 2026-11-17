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
- They **share** builds as links (`/HatesCoHPlanner/Homecoming/#b=...`), keep builds in the
  browser, and move builds to and from MidsReborn (`.mbd` files and Mids share codes).
- The **owner** refreshes the game data after each Homecoming patch with the Python pipeline.

Goals, in priority order:

1. **Correct numbers from the live game.** All game data is decoded from the Homecoming client
   files. The build math is ported from the game engine's source (and, where the engine is
   silent, from MidsReborn's GPL code).
2. **Fidelity to the in-game screens.** Layout, sizes, fonts, colours, textures and sounds come
   from the client and its UI source. They are ported, not hand-tuned.
3. **Builds never break.** The planner is in production (since November 14, 2026). Share links,
   saved builds and Mids exports made today must still open, as the same build, after every
   future change and patch.
4. **Privacy.** Nothing that identifies the owner or their machine goes into the repository.

It is a non-profit fan tool, GPL-3.0, and not affiliated with NCSoft or Homecoming.

## Hard rules

Breaking any of these is a bug, whatever else the change does.

**In production: links never break** (the owner's rule from November 14, 2026, for the life of
the project)
- The planner is in production. No change may break a link or change what it opens. A link that
  opens today keeps opening the same build (the same server, game version, archetype, power sets,
  picks, slots and enhancements) for as long as the project lives.
- Links are share links (`#b=` codes, with or without a game version or a server in the address)
  and the site's addresses (the root and every server's `/HatesCoHPlanner/<Server>/`, in any case).
  What they open with is covered too: the ids files, the published version folders, `SERVERS`, the
  decoder (`src/io/share.ts`), version and server resolution (`src/data/versions.ts`,
  `src/data/servers.ts`, `shareServer`) and the load flow in `src/state/store.ts`.
- A link must not fail where it opened before, in any condition: a slow or failed download of
  another server's files included.
- A change that touches any of the above shows that links made before it still open the same
  build: tests that decode links made before the change, plus a check in the preview.
- Never change what an old link opens, even to fix a bug in old data or ids. Corrections go into a
  new game version. If a change seems to need it, stop and ask the owner.

**Privacy**
- Never commit personal data: real names, e-mail addresses (commits use the GitHub noreply
  address), local file system paths (drive-letter paths into user folders, game install
  folders or source checkouts), or names of personal files.
- Machine paths live only in `pipeline/paths.local.json` (gitignored; template
  `pipeline/paths.example.json`) or in the `COH_CLIENT` / `COH_SOURCE` / `COH_MIDS` environment
  variables.
- Tests that need a personal file read its path from an environment variable and skip when it
  is unset (for example `HCP_MIDS_SAMPLE` in `tests/io.test.ts`, `HCP_BUILDTXT_SAMPLE` in
  `tests/buildtxt.test.ts`). The build research reads its folder of builds the same way
  (`HCP_BUILD_CORPUS`) and writes aggregates only: no file names, build names or paths.
- The CI "Privacy" check fails on drive-letter paths in tracked files.

**Local-only material**
- `IGNORE/` holds the owner's in-game reference screenshots. It is gitignored. Read it, never
  commit it, never move its contents into tracked folders.

**MidsReborn is an untrusted reference**
- Use it to cross-check numbers (`pipeline/report.md`) and to map names for Mids import/export.
- Never copy game data from it into the planner, and never "fix" our data to match it.
  Disagreements are evidence to investigate; I28 changes are real differences.
- Two exceptions, approved by the owner and described in `docs/pipeline.md`: an **approximate
  version** for an older patch whose client files are gone (`python -m pipeline.overlay`; never
  the default, marked `approx: true` in `versions.json`, and the app says so), and enhancement
  frames borrowed from another version or server (`--frames-from`; artwork only, no numbers).
- Code that touches Mids data must survive it being missing or malformed: warn and carry on.

**Stable IDs and old builds**
- `pipeline/ids.json` assigns the numeric IDs that share links and saved builds use; each other
  server has its own file (`pipeline/ids-thunderspy.json`), so one server's ids never move
  another's. They are append-only: never renumber, reuse, reorder or delete entries.
- Each game version's data lives in its own folder, `public/data/<id>/` (for example `i28p4` for
  Issue 28, Page 4), listed in `public/data/versions.json`. Never edit or delete a published
  version folder: links made on that patch load it. A new patch gets a new folder.
- A version's pseudo-pet file sits beside its folder, in the server's `pets/` folder
  (`public/data/pets/<id>.json`, `public/data/thunderspy/pets/<id>.json`; the owner's choice, so a
  published folder never changes). It only adds pet damage and effects to the power info and
  changes no build, so a published version may get one, made by `python -m pipeline.pets` from the
  very client the version was made from. It is optional: the app never waits for it, and without
  it a power shows no pet damage. `pets` is never a version id.
- Beside it, a version's power-info extras file (`public/data/info/<id>.json`,
  `public/data/thunderspy/info/<id>.json`) carries what the client's power info reads from fields
  the version's own files don't hold: each effect's own note ("Within 20ft radius"), the client's
  attribute names and note texts, the grants it doesn't list, the "Aggro Type" row, and Thunderspy's
  PvP-only groups. Like the pets file it changes no build, may be added to a published version
  (`python -m pipeline.info`, from the version's own client, after its pets file), and is optional:
  without it the power info keeps the planner's own wording. `info` is never a version id.
- Game servers (`SERVERS` in `src/data/servers.ts`) keep their `id` (stored in builds) and `path`
  (the address segment) forever. A build or link that names no server is Homecoming's, and
  Homecoming's data stays in `public/data/`; another server gets `public/data/<server>/`. The
  link's address names the server, not the share code. An address naming a server the site
  doesn't carry is refused, never opened as Homecoming. Anything that makes a build from a
  server's data (imports, `checkBuild`, `newBuild`) stamps that server on it.
- Every game version id names its server by its prefix (`versionPrefix` in `SERVERS` and
  `version_prefix` in `pipeline/config.py`, kept in step; Thunderspy's start with `ts`). A new
  server gets a prefix no other starts with or is started by. A code is never read with another
  server's ids (`shareServer`, `wrongServer`), and deciding that downloads nothing. Details:
  `docs/architecture.md`, "Servers and versions".
- The share-link format (`src/io/share.ts`) may only grow by optional trailing fields, and old
  links must keep decoding. Links without a version open as `LEGACY_GAME_VERSION` (`i28p4`).
- Builds from outside the app (links, browser storage, saved builds, imports) always pass
  through `checkBuild` (`src/engine/validate.ts`) against their own version's data before use.
- A Mids import opens on the patch it was made on (`docs/architecture.md`, "Imports and
  patches"). The table of Mids database versions (`MIDS_DB_PATCHES` in `src/io/midsPatches.ts`)
  only gets entries the owner has confirmed.

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
- `main` is protected: every change goes through a pull request, all CI checks must pass on a
  branch that is up to date with `main` (update it, then let CI run again, before merging), and
  pull requests need the owner's approval (CODEOWNERS); the owner may approve their own.
- Never force-push `main`, rewrite its history, or change repository settings, rulesets or
  secrets.
- Commit, push or open a pull request only when the owner asks for it. The same goes for starting
  a Pages deploy.
- Exception, standing permission for this repository: on a pull request you opened, watching its
  CI and committing and pushing fixes to that pull request's branch (failing checks, merge
  conflicts, review comments that ask for a real fix) is always allowed without asking. In Claude
  Code, turn Auto-fix on for every pull request you open here instead of offering it.

**Ask, don't assume**
- When a request is ambiguous or a fact can't be found in the code, the data or these docs, ask
  the owner. Do not fill the gap with a guess.

## Repository layout

The full map, file by file, is in `docs/architecture.md`.

```
src/data/       game data loading, versions.ts, servers.ts (SERVERS), types.ts
src/engine/     pure build rules: rules.ts (BuildRules), totals.ts, enhance.ts, setbonus.ts,
                requires.ts (RPN), validate.ts (checkBuild), schedule.ts, actions.ts, migrate.ts
src/io/         share.ts (#b= links), mids.ts, midsPatches.ts, buildtxt.ts, importProblem.ts,
                library.ts (IndexedDB), binary.ts, fileName.ts
src/state/      store.ts (zustand: data, build, level-up flow, dialogs)
src/ui/         screens/, components/ (game chrome), skin/metrics.ts, hover.ts, escape.ts
tests/          vitest (helpers/data.ts loads public/data); fixtures/builds/ for the e2e tests
e2e/            Playwright browser tests (local only)
research/       the build research (owner's machine only): community builds -> set finder statistics
public/data/    generated game data per version, versions.json; <server>/ for other servers;
                pets/ for each version's pseudo-pets, info/ for its power-info extras (beside the
                version folders); finder/ for the set finder's build statistics
public/assets/  generated icons, textures, fonts, sounds; thunderspy/ for its icons
pipeline/       Python data pipeline (owner's machine only); ids*.json (append-only), report*.md
tools/          standard-library Python decoders for client file formats
docs/           architecture.md, pipeline.md, releases.md, game-rules.md, exemplar-rules.md
```

## How it works

Read the doc for the area you are changing:

- `docs/architecture.md`: loading, servers and the address (the load flow, the server list, the
  4-hour return), imports and patches, text from outside, import failures and limits, the engine
  and what the totals count by default, builds and storage, store and screens, the stage,
  pop-ups and hovers, browser tests.
- `docs/pipeline.md`: the data pipeline and its safety rails, new and older patches, Thunderspy's
  export, `pipeline.watch`, `pipeline.compare`, approximate versions, borrowed frames, the build
  research.
- `docs/releases.md`: how a deploy picks, tags and stamps a version, and the players' changelog.
- `docs/game-rules.md`: the engine rules already ported, with the source each comes from.

Rules from those areas that hold for every change:

- The engine (`src/engine/`) is pure and synchronous; keep React and the DOM out of it.
- A build is never moved to another server. Only New Build switches servers, and it clears the
  archetype and power sets when it does.
- Text from outside (a link's build name or version, a file's names, an unknown server name) is
  never repeated as it came (`cleanName`, `readable`). Every navigation goes to a fixed address
  written in the code, never one taken from a link, a build or a file.
- Import failures the user can fix throw an `ImportProblem` in plain words, never raw error text;
  anything else gets one calm generic message, details in the console.
- No input may make the tab do unbounded work: new import code keeps to the import limits
  (`MAX_INFLATED`, 2 MB files and pasted text, count caps; `tests/importlimits.test.ts`). A new
  outside resource needs the page's Content-Security-Policy (`vite.config.ts`) changed with it.
- Every pop-up closes with Escape (`useEscape`), except a `tell` with `wait`. Questions use
  `askConfirm` / `askChoices` / `askThreeWay`; one-button messages use `tell`; refusals use
  `notify` or `flashLocked`.
- Hover state (tooltips, glows) lives in `src/ui/hover.ts`, so a hover redraws only the piece it
  affects, never a whole screen.
- The desktop stage is 2000x1125; narrow or portrait windows get the phone layout
  (`src/ui/stageLayout.ts`, `src/ui/components/Phone.tsx`). Phones have no hover: a long press
  shows the tooltip.
- Pipeline: never run anything from an old install (copy the files, read the copy), and export
  each Thunderspy release while it is live (a superseded one can't be fetched again).

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
npm run research     # the build research (owner's machine; needs HCP_BUILD_CORPUS, else skipped)
python -m pipeline.run --help
python -m pipeline.watch       # a new release on a server's live manifest (Thunderspy)
python -m pipeline.compare --server thunderspy   # report-thunderspy-diff.md: its data against Homecoming's
python -m pipeline.pets --game-version i28p3     # a published version's pseudo-pet file (its own client)
python -m pipeline.info --game-version i28p3     # its power-info extras file (its own client, after pets)
```

Before you hand back a change, run lint, typecheck and tests. Run the build for anything that
touches configuration or dependencies.

## Pull request checks (`.github/workflows/ci.yml`)

| Check | Runs |
|---|---|
| Web app (lint, types, tests, build) | `npm ci --ignore-scripts` (no dependency install scripts run), lint, typecheck, test, build |
| Dependency audit | `npm audit --omit=dev --audit-level=moderate` (shipped code), `node scripts/audit-dev.mjs` (tools: high and critical advisories, except the few its `ALLOWED` lets through, each with its reason, until a fixed release exists) |
| Data pipeline (Python compiles) | `python -m compileall pipeline tools`; `python -m unittest pipeline.watch_test pipeline.forced_respec_test pipeline.compare_test pipeline.pets_test pipeline.info_test pipeline.pvp_test` (the release check, the forced respec check, the difference report, the pseudo-pet export, the power-info extras export, the PvP-only test); `pipeline/check_ids.py` (ids.json well formed, and every id the base branch has kept unchanged); every JSON file under `public/data` and in `pipeline/` parses |
| Privacy (no local paths or machine settings) | `pipeline/paths.local.json` untracked; no drive-letter, network-share or home-folder paths in tracked files |

Merging does not deploy. The owner starts a Pages deploy by hand (Actions -> "Deploy to GitHub
Pages" -> Run workflow, picking a version bump, or `gh workflow run pages.yml --ref main -f
bump=<patch|minor|major>`); it publishes `main` only and runs one at a time.

## Versions and releases

Every deploy is a SemVer release, `vX.Y.Z` (the first public one, November 13, 2026, is
`v1.0.0`). The owner's bump rules: **major** for massive feature changes or redesigns, **minor**
for a new server or medium-sized work, **patch** for fixes and small changes. When you hand back
a pull request, say which bump it calls for. The git tags are the record; `package.json`'s
`version` is not used. How a deploy tags and stamps it: `docs/releases.md`.

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
- Browser tests (`e2e/`, `npm run e2e`) recreate forum builds from `tests/fixtures/builds/`
  through the screens (desktop clicks, phone taps) and compare the result with the import. Run
  them after changing the screens or the level-up flow (specs: `docs/architecture.md`).

**Commits and pull requests**
- Commit messages: a short imperative summary line, a blank line, then bullets on what changed
  and why.
- One topic per pull request. Describe the user-visible effect and how it was verified (tests,
  screenshots of the screens touched).
- A change players can see adds one line to `CHANGELOG.md` under `## Unreleased`: one sentence in
  plain words for players, with no internals (file names, pull request numbers, engine terms). The
  deploy puts the new lines at the top of the release's notes (`docs/releases.md`, "The changelog").
- Generated files (`public/data`, `public/assets`, `src/ui/skin/skinVariants.ts`,
  `pipeline/report.md`, `pipeline/report-<id>.md`, `pipeline/report-<server>-diff.md`, `pipeline/ids.json`) change only through a
  pipeline run, never by hand. The same goes for the build research's `public/data/finder/stats.json`
  and `pipeline/report-finder.md` (`npm run research`).

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
