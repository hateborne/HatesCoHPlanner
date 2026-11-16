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
  `tests/buildtxt.test.ts`).
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
  Thunderspy's client has none either and borrows Homecoming's (`--frames-from homecoming/i28p4`):
  by internal name, and for a set piece Homecoming lacks, the pair Homecoming's set pieces use for
  its conversion group (attuned or not), which matches every Homecoming set piece it answers when
  tried on Homecoming's own sets one left out at a time (`borrow_frames` in `pipeline/export.py`).
- Code that touches Mids data must survive it being missing or malformed: warn and carry on.

**Stable IDs and old builds**
- `pipeline/ids.json` assigns the numeric IDs that share links and saved builds use; each other
  server has its own file (`pipeline/ids-thunderspy.json`), so one server's ids never move
  another's. They are append-only: never renumber, reuse, reorder or delete entries.
- Each game version's data lives in its own folder, `public/data/<id>/` (for example `i28p4` for
  Issue 28, Page 4), listed in `public/data/versions.json`. Never edit or delete a published
  version folder: links made on that patch load it. A new patch gets a new folder.
- Game servers (`SERVERS` in `src/data/servers.ts`) keep their `id` (stored in builds) and `path`
  (the address segment, `/HatesCoHPlanner/Homecoming/`) forever. A build, saved build or link that
  names no server is Homecoming's, and Homecoming's data stays in `public/data/`; another server gets
  its own data folder (`public/data/<server>/`, with its own `versions.json`). The share code carries
  no server: the link's address does. An address that names a server the site doesn't carry is
  refused, never opened as Homecoming. Anything that makes a build from a server's data (imports,
  `checkBuild`, `newBuild`) stamps that server on it.
- Every game version id names its server by its prefix: `versionPrefix` in `SERVERS` and
  `version_prefix` in `pipeline/config.py`, kept in step (Thunderspy's start with `ts`, release 9.6
  is `ts9-6`; Homecoming has none, and its ids are those no other prefix starts). The pipeline
  refuses an id with the wrong prefix, or one another server's `versions.json` lists. A share code
  names its version, so `shareServer` (`src/state/store.ts`, through `versionServer`) opens a bare
  code on the server its version belongs to and refuses a code whose version is another server's
  than the address names (`wrongServer`): a Thunderspy code is never read with Homecoming's ids.
  It downloads nothing to decide, so a link never fails because another server's files won't load.
  A new server gets a prefix no other starts with or is started by (`tests/shareserver.test.ts`).
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

```
src/
  main.tsx, App.tsx          entry; CrashGuard wraps the app; stage, toggles, dialogs, footer
  version.ts                 the planner's release version (stamped by the deploy)
  data/
    gamedata.ts              GameData: indexed game data + loadGameData(base, version)
    versions.ts              versions.json, LEGACY_GAME_VERSION, resolveVersion()
    servers.ts               game servers: ids, address paths, data folders, logos (SERVERS)
    types.ts                 shapes of the exported JSON
  engine/                    pure TypeScript build rules (no React, no DOM)
    build.ts                 Build / Pick / Slot model, newBuild()
    rules.ts                 BuildRules: availability, picks, auto-granted powers, slots, issues
    requires.ts              the game's RPN requirement evaluator
    schedule.ts              pick / slot / pool / epic level schedules
    enhance.ts               enhancement values, ED, origin and set validity, set rarity, help text
    setbonus.ts, totals.ts   set bonuses (rule of 5) and the totals panel
    powerinfo.ts             detailed power numbers (base vs enhanced)
    actions.ts               pure edits (setPick, addSlot, setEnh, ...) and pickHoldsEnhancements
    validate.ts              checkBuild(): check and repair builds from outside the app
    migrate.ts               fitToPatch(): swaps that fit an import moved to another patch
  io/
    share.ts                 #b= share links (bit-packed, deflated, base64url)
    mids.ts                  Mids .mbd and share codes (|MBD; and legacy |MxDz;)
    midsPatches.ts           which patch a Mids build was made on (Mids database version table)
    buildtxt.ts              Homecoming's /build_save file (build.txt) import
    importProblem.ts         import failures in plain words (ImportProblem), file reading
    library.ts               builds saved in the browser (IndexedDB)
    binary.ts                byte reader / writer helpers, size-capped decompression
    fileName.ts              safe names for downloaded files
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
public/data/thunderspy/      Thunderspy's data: its own versions.json and version folders (no mids-map)
public/assets/               icons, UI textures, fonts, sounds (generated, committed)
public/assets/thunderspy/    Thunderspy's copy of every icon it shows (generated)
public/servers/              game server logos (placed by hand, WebP; not pipeline output)
public/favicon.png           the site icon (placed by hand)
pipeline/                    Python data pipeline (runs on the owner's machine only)
  run.py                     entry point: python -m pipeline.run
  overlay.py                 approximate older-patch versions (python -m pipeline.overlay)
  watch.py                   a new release on a server's live manifest (python -m pipeline.watch)
  watch_test.py              its tests (python -m unittest pipeline.watch_test; run by CI)
  compare.py                 what another server's data does differently from Homecoming's
                             (python -m pipeline.compare --server thunderspy)
  compare_test.py            its tests (python -m unittest pipeline.compare_test; run by CI)
  config.py                  inputs, preflight checks, atomic writes
  ids.json                   stable IDs (append-only)
  ids-thunderspy.json        Thunderspy's stable IDs (append-only)
  check_ids.py               every ids file well formed and only appended to (run by CI)
  forced_respec.py           a class's forced level-up respec where the planner looks for it
                             (its test, forced_respec_test.py, is run by CI)
  patch-watch.json           per server: newest patch seen (Thunderspy: release and MD5 of its
                             tspy/bin.pigg); game version id and label
  inputs/fonts/              vendored game fonts (never change)
  report.md                  validation report of the last run
  report-<id>.md             report of a version that is not the default (pipeline.run), or what an
                             approximate version changed (overlay.py)
  report-thunderspy.md       Thunderspy's report (report-thunderspy-<id>.md for older versions)
  report-thunderspy-diff.md  every difference of Thunderspy's data from Homecoming's, by internal
                             name (pipeline.compare; to spot-check in game)
tools/                       standard-library Python decoders for client file formats
scripts/release-version.mjs  the version a deploy publishes (plain Node; run by pages.yml)
docs/game-rules.md           pick, auto-grant and slot rules ported from the engine source
docs/exemplar-rules.md       exemplar rules (pending the owner's review)
.github/workflows/           ci.yml (pull request checks), pages.yml (tag a release and deploy main,
                             started by hand)
```

## How it works

**Data pipeline.** `python -m pipeline.run` reads the client's `bin.pigg`, `bin_powers.pigg` and
the client executable (for parse-table layouts and enum names), decodes powers, sets,
archetypes, enhancements, tables and English text, and writes `public/data/<version>/`. That
folder holds `core.json`, `powersets.json`, `powers.json`, `boosts.json` and `mids-map.json`.

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

**Loading.** The app fetches its game server's `versions.json` (Homecoming's is
`public/data/versions.json`), then loads the game version the current build asks for (the default
for a new build), with `?v=<hash>` against stale caches. The New Build screen's version picker
switches versions; each version is fetched once per page.

**Servers and the address.** The page address names the game server:
`/HatesCoHPlanner/<path>/#b=<share code>` (`serverFromPath`, any case). The build step copies
`index.html` to `<path>/index.html` for each server (`serverPages` in `vite.config.ts`) so GitHub
Pages serves those addresses. It also writes `404.html` (`notFoundPage`): a server address in
another case or with more after it (`/HatesCoHPlanner/homecoming/x`) goes on to that server's page
with its `#b=` code (`notFoundRedirect`, written into the page and allowed by its hash in the page's
CSP); anything else gets a "not found" page linking to the planner, so an unknown server's link is
never opened as Homecoming. On load, a share link opens on the server its address names (none:
Homecoming; one the site doesn't carry: refused, `NamedServer.unknown`); a remembered build opens
unless the address names another server. After a long break (`RETURN_AFTER`, 4 hours without a
click, tap, key or wheel in any tab: `hcp.lastUsed`, `src/state/lastUsed.ts`; only a recorded time
counts, so none on record, a damaged one or blocked storage opens the build as before) the player's
own build doesn't reopen unannounced: the remembered build, or a link holding
its share code (a reloaded tab's address), opens the server list with a Continue button for it
(`askServer`'s `resume`, answered `CONTINUE_BUILD`), highlighted so Enter takes it, and its data
loads while the list is open. A tile starts New Build on its server instead; the build stays
remembered until a new one starts, and New Build's Finish asks first while it isn't open ("Start new"
or "Open it", `rememberedBuild`). A link someone else sent opens at once. With no build, New
Build opens on the server the address names; failing that, once `SERVERS` holds more than one, a
visit asks in the server list dialog (`askServer`). The server this browser last showed
(`hcp.server`, `src/state/lastServer.ts`), else the default, starts highlighted, so Enter, Space or OK
takes it, and its data starts loading while the list is open; hovering a tile doesn't move the
highlight. Otherwise New Build opens on the only server. The address is then rewritten in place to the build's
server (with no build, the server shown). The server logo (`ServerLogo`, in the desktop bottom bar
and at the top of the phone menu) shows on every screen, but only New Build makes it the selector: it
opens the same list there, and picking another server shows that server's data and clears the
archetype and both power sets (another server's ids mean other archetypes and sets); the origin
carries over by its internal name (`carryOrigin`). A build is never
moved to another server: a switch with a build in the background asks first (`askConfirm`), then
clears that build (this tab's storage and its share code in the address), and `selectServer` is
refused outside New Build. Import reads a pasted link's server
from its address (`serverInLink`); a bare code opens on the server its game version belongs to
(Homecoming's for a code from before servers). A share code left in the address by a link that
couldn't open is dropped once the address moves to another server.

What a server offers is in its `SERVERS` entry: `midsDb` (MidsReborn's name for its database; none
for Thunderspy) and `buildSave` (its client writes `/build_save` files; Thunderspy's doesn't). Without
them the build menu hides the Mids exports and the file button, and an import of Mids text or a
`build.txt` is refused in words (`midsUnavailable`, `noBuildSave`) that name the server it belongs to.
Thunderspy keeps the engine's rules (ported from Homecoming's client and the game source) wherever its
data doesn't decide them; its staff-only sets (Organic Armor) stay off New Build because no player
passes their powers' BuyRequires (`startingSets`).

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

A `/build_save` file (`build.txt`, `src/io/buildtxt.ts`) is the live client's dump of a
character, written with internal names, and opens on the default version. It holds no alignment
and no slot levels: the game never stores the level a slot was added at, nor whether the build
came from a respec. So the import asks for the alignment and the build type in the dialog
(`askChoices`). Leveling is offered only when `leveledSlotShortfall()` finds that the slots could
have come from leveling, and never for an archetype planned as Respec only (`respecOnlyNote`). Either way each added slot takes the lowest free slot level at or after
its power's level (`lowestFreeLevels()`, the respec screen's rule).

MidsReborn names 9 epic pools its own way (`Epic.Ice_Mastery_DefCorr` is the game's
`Epic.Defender_Ice_Mastery`), and its CrypticPowerNames.mhd doesn't list them, so
`MIDS_EPIC_POOLS` (`src/io/mids.ts`) maps them both ways; `tests/importproblems.test.ts` checks
every target exists and that the archetypes each name is for can take it.

**Text from outside** (a link's build name or game version, a file's names) is never repeated as
it came: build names go through `cleanName` (plain text, at most 40 characters), names from imported
files through `readable`, and a missing game version is named as its patch or not at all
(`missingVersionNote`). A crafted link must not make the planner's own notices say what it likes.
Every navigation goes to a fixed address written in the planner's code: on this site, or an outside
page opened in a new tab (the Support dialog's charities, the wiki page a dialog's `link` opens).
None takes its target from a link, a build or a file.

**Import failures** are told to the user in the dialog (`tell`), never as raw error text
(`src/io/importProblem.ts`). Something wrong with what they gave the planner (a code cut short, a
damaged file, a build for another server) is thrown as an `ImportProblem`: what is wrong and what
they can do about it, in plain words. Anything else (game data that won't load, a bug) gets one
calm generic message, with the details in the browser console. What an import couldn't bring over
(a power or enhancement the data lacks) is listed after the build opens ("Imported, with gaps").
New import code throws `ImportProblem` for every failure the user can fix.

**Import limits.** Everything imported comes from strangers, so no input may make the tab do
unbounded work. Decompression stops at a ceiling (`MAX_INFLATED` in `src/io/binary.ts` for share
links and `|MxDz;` codes, the 2 MB build-file size for `|MBD;` Brotli data), counts past any real
build's are refused (picks, slots, granted powers, Mids power entries and sets), pasted text and
files over 2 MB are refused, and a `.mbd` whose fields have the wrong types is reported as damaged
(`isMbd`). Downloaded file names are cleaned (`src/io/fileName.ts`). `tests/importlimits.test.ts`
covers these; new import code keeps to them. The published page also carries a
Content-Security-Policy (`vite.config.ts`, built pages only): everything is loaded from the site
itself, so a new outside resource needs the policy changed with it.

**Engine.** `BuildRules` (`src/engine/rules.ts`) answers every question the screens ask: what can
be picked at a level, what is auto-granted, where slots can go, what is wrong with the build.
`totals.ts` and `enhance.ts` do the math with the game's own tables: enhancement curves,
Enhancement Diversification, boosters and exemplar handicaps, set bonuses with the rule of 5,
and archetype caps. The engine is pure and synchronous; keep React and the DOM out of it.

What the totals count by default (`defaultsOf` in `totals.ts`; every power can be switched per
build): autos and toggles on, clicks off, except
- the inherent utility toggles (Rest, Walk, Sprint);
- emergency toggles (`isEmergencyToggle`): ones that make their user untouchable, intangible or
  able to affect only itself while they run (Hibernate, Icy Bastion, Geode, Phase Shift,
  Personal Force Field, Nebulous Form), found from their effects;
- toggles that switch each other off (`exclusiveGroups`: a shared GroupMembership, as the game's
  `character_ShutOffAllTogglePowersInSameGroup` does): only the earliest picked is on. Switching
  one on in the overview switches the others in its group off.

**Builds.** A `Build` (`src/engine/build.ts`) stores ids only:

- archetype, origin, alignment, primary and secondary;
- 24 picks with their slots and enhancements;
- auto-granted powers' slots and on/off switches;
- an optional stop level (`endLevel`) and the game version (`dataVersion`).

It is persisted per browser tab (sessionStorage, with a localStorage fallback for new tabs). It
is mirrored into the address bar as `#b=<share code>` with `history.replaceState`, so a reload or
a copied address brings back exactly that build. The tab title names a named build
("HCP: <name>", `src/state/tabTitle.ts`), so a bookmark carries the name too.

**Store and screens.** `src/state/store.ts` (zustand) holds the game data, the build and the
level-up flow. The flow is a wizard from level 1 to 50, or one level reopened from the overview
(`mode: 'edit'`, Cancel restores the original). A Respec build (New Build's Build Type,
`Build.respecTo`) walks its own order instead (`respecSteps()` in `src/engine/schedule.ts`):
every power first (level 1's secondary before its primary), then one slot screen where any power
may take any slot, as Homecoming's respec does (`docs/game-rules.md`, "Respec order"). An
Arachnos Soldier or Widow can only train to 24 through a respec, so their builds start as Respec
builds to 24 at least (`startBuild`, `respecOnlyNote`; New Build greys Leveling for them). Screens read the store with narrow
selectors (`useShallow`) and call its actions.

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
- Every pop-up closes with Escape (`useEscape`). The one exception, the owner's choice: a `tell`
  with `wait` (the "Invalid power sets" warning) takes neither OK nor Escape until its countdown
  ends, and a dialog asked for while it is up waits for it to close instead of replacing it.
- Questions use `askConfirm` (or `askChoices` for rows of options); messages with one OK button
  use `tell` (its optional `link` makes one phrase open a fixed https page in a new tab, as the
  hero Patron note links the wiki; its optional `wait` greys OK for that many seconds, counted down
  on the button); refusals use `notify` or `flashLocked`. The server list is `askServer`.
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
python -m pipeline.watch       # a new release on a server's live manifest (Thunderspy)
python -m pipeline.compare --server thunderspy   # report-thunderspy-diff.md: its data against Homecoming's
```

Before you hand back a change, run lint, typecheck and tests. Run the build for anything that
touches configuration or dependencies.

## Pull request checks (`.github/workflows/ci.yml`)

| Check | Runs |
|---|---|
| Web app (lint, types, tests, build) | `npm ci --ignore-scripts` (no dependency install scripts run), lint, typecheck, test, build |
| Dependency audit | `npm audit --omit=dev --audit-level=moderate` (shipped code), `npm audit --audit-level=high` (tools) |
| Data pipeline (Python compiles) | `python -m compileall pipeline tools`; `python -m unittest pipeline.watch_test pipeline.forced_respec_test pipeline.compare_test` (the release check, the forced respec check, the difference report); `pipeline/check_ids.py` (ids.json well formed, and every id the base branch has kept unchanged); every JSON file under `public/data` and in `pipeline/` parses |
| Privacy (no local paths or machine settings) | `pipeline/paths.local.json` untracked; no drive-letter, network-share or home-folder paths in tracked files |

Merging does not deploy. The owner starts a Pages deploy by hand (Actions -> "Deploy to GitHub
Pages" -> Run workflow, picking a version bump, or `gh workflow run pages.yml --ref main -f
bump=<patch|minor|major>`); it publishes `main` only and runs one at a time.

## Versions and releases

Every deploy is a release with a SemVer version, `vX.Y.Z`. The first public release (the site as
deployed on November 13, 2026) is `v1.0.0`. The owner's rules for the bump:

- **major**: massive feature changes or redesigns;
- **minor**: a new server, or medium-sized work;
- **patch**: fixes and small changes.

When you hand back a pull request, say which bump it calls for, so the owner can pick it at deploy.

- The git tags are the record. `package.json`'s `version` is not used.
- The deploy picks the version (`scripts/release-version.mjs`): the newest `vX.Y.Z` tag, bumped as
  picked. It refuses to run without a bump, and refuses before any version tag exists. A commit that
  already carries a version deploys again under it, with no new tag (re-running an older release's
  deploy puts that release back live). A new version goes only to main's newest commit, so re-running
  an old deploy that failed before it was tagged is refused once main has moved on: start a new one.
- The build gets the version from `HCP_VERSION` and the commit from `HCP_COMMIT`
  (`vite.config.ts`, read through `src/version.ts`). Builds outside a deploy (dev server, tests,
  pull request checks) are `dev`.
- Before the site goes live, the deploy's `release` job tags the commit and publishes a GitHub
  Release listing the pull requests merged since the last one, so a failed deploy can't let
  another build take the same number. If that job fails, nothing was deployed: re-run all jobs (a
  fresh build sees whether the tag was made, and reuses it if so; if main has moved on and no tag
  was made, start a new deploy).
- The footer names the version after the planner's name, as plain text. The crash page and the
  browser console name it with its commit, and Mids exports carry it in `BuiltWith.Version`
  (`0.0.0` from a dev build; imports ignore it). Each version's notes are on the repository's
  GitHub Releases page.

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

  `respeconly.spec.ts` drives New Build itself: an Arachnos archetype picked with Leveling ticked
  switches to Respec and says why, and Finish starts a Respec to 24 at least.

  They find elements by `data-testid` (`testId` on `CheckBar`, `SlotRing`, `PhoneTabs`); the shared
  driver is `e2e/player.ts`. Run them after changing the screens or the level-up flow.

**Commits and pull requests**
- Commit messages: a short imperative summary line, a blank line, then bullets on what changed
  and why.
- One topic per pull request. Describe the user-visible effect and how it was verified (tests,
  screenshots of the screens touched).
- Generated files (`public/data`, `public/assets`, `src/ui/skin/skinVariants.ts`,
  `pipeline/report.md`, `pipeline/report-<id>.md`, `pipeline/report-<server>-diff.md`, `pipeline/ids.json`) change only through a
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
