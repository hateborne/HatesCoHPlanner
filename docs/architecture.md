# Architecture and app behaviour

How the planner works, area by area. The rules every change must keep are in `AGENTS.md`; this
file explains the mechanisms behind them. Read the section for the area you are changing.

## Repository layout

```
src/
  main.tsx, App.tsx          entry; CrashGuard wraps the app; stage, toggles, dialogs, footer
  version.ts                 the planner's release version (stamped by the deploy)
  data/
    gamedata.ts              GameData: indexed game data + loadGameData(base, version)
    versions.ts              versions.json, LEGACY_GAME_VERSION, resolveVersion()
    servers.ts               game servers: ids, address paths, data folders, logos (SERVERS)
    pets.ts                  the shape check of a version's pseudo-pet file (readPetsFile)
    info.ts                  the shape check of a version's power-info extras file (readInfoFile)
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
public/data/pets/<version>.json  each version's pseudo-pets, beside the version folders (generated;
                             Thunderspy's in public/data/thunderspy/pets/)
public/data/info/<version>.json  each version's power-info extras, beside them (generated;
                             Thunderspy's in public/data/thunderspy/info/)
public/assets/               icons, UI textures, fonts, sounds (generated, committed)
public/assets/thunderspy/    Thunderspy's copy of every icon it shows (generated)
public/servers/              game server logos (placed by hand, WebP; not pipeline output)
public/favicon.png           the site icon (placed by hand)
pipeline/                    Python data pipeline (runs on the owner's machine only)
  run.py                     entry point: python -m pipeline.run
  overlay.py                 approximate older-patch versions (python -m pipeline.overlay)
  pets.py                    a published version's pseudo-pet file only (python -m pipeline.pets)
  pets_test.py               the pseudo-pet export's tests (python -m unittest pipeline.pets_test; run by CI)
  info.py                    a published version's power-info extras file only (python -m pipeline.info)
  info_test.py               its export's tests (python -m unittest pipeline.info_test; run by CI)
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

## Servers and versions

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

## How it works

**Loading.** The app fetches its game server's `versions.json` (Homecoming's is
`public/data/versions.json`), then loads the game version the current build asks for (the default
for a new build), with `?v=<hash>` against stale caches. The New Build screen's version picker
switches versions; each version is fetched once per page. The version's pseudo-pet file is fetched
once those files have arrived and is never waited for (`loadGameData`): it is attached when it
arrives (`GameData.setPets`, which takes it only when every part is well formed,
`src/data/pets.ts`), an open power info panel then shows its pets (`subscribePets`), and a missing,
damaged or slow one only leaves pet damage out. The version's power-info extras file is fetched the
same way (`GameData.setInfo`, `src/data/info.ts`, `subscribeInfo`; a file naming another version is
refused); without it the power info shows no effect notes and keeps the planner's own wording.

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
remembered until something replaces it, and whatever would while it isn't open (New Build's Finish,
an import, a saved build, a link pasted into the address bar) asks first: go ahead, "Open it", or
Cancel, which Escape and Enter take (`askOverRemembered`, `askThreeWay`). A link someone else sent
opens at once; one pasted into the address bar while the load's server list is open starts the load
over with it. With no build, New Build opens on the server the address names; failing that, a link
refused for what it holds (damaged, a build `checkBuild` refuses) opens New Build on its own server
(the default for a damaged code, as every link at the site root did before servers) and says why;
failing that, once `SERVERS` holds more than one, a visit asks in the server list dialog
(`askServer`). The server this browser last showed
(`hcp.server`, `src/state/lastServer.ts`), else the default, starts highlighted, so Enter, Space or OK
takes it, and its data starts loading while the list is open; hovering a tile doesn't move the
highlight. Otherwise New Build opens on the only server. The address is then rewritten in place to the build's
server (with no build, the server shown). The server logo (`ServerLogo`, in the desktop bottom bar
and at the top of the phone menu) shows on every screen, but only New Build makes it the selector: it
opens the same list there, and picking another server shows that server's data and clears the
archetype and both power sets (another server's ids mean other archetypes and sets); the origin
carries over by its internal name (`carryOrigin`). A build is never
moved to another server: a switch with a build in the background asks first (`askConfirm`; a build
with no work in it, `hasWork`, is cleared without asking), then clears that build (this tab's storage
and its share code in the address), and `selectServer` is refused outside New Build; the list closes
if a build opens behind it or a dialog opens over it. New Build only starts a build on the data its choices were made on
(`startBuild` refuses ids the shown data lacks). Import reads a pasted link's server
from its address (`serverInLink`); a bare code opens on the server its game version belongs to
(Homecoming's for a code from before servers). A share code left in the address by a link that
couldn't open is dropped once the address moves to another server, and the error screen leaves the
address as it was, so Try again and a reload read the same link.

What a server offers is in its `SERVERS` entry: `midsDb` (MidsReborn's name for its database; none
for Thunderspy) and `buildSave` (its client writes `/build_save` files; Thunderspy's doesn't). Without
them the build menu hides the Mids exports and the file button, and an import of Mids text or a
`build.txt` is refused in words (`midsUnavailable`, `noBuildSave`) that name the server it belongs to;
other text is refused naming only what that server reads (`notReadableOn`, `readableOn`).
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
files and a pasted link's unknown server name (`unknownServer`) through `readable`, and a missing game
version is named as its patch or not at all (`missingVersionNote`). A crafted link must not make the planner's own notices say what it likes.
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
and archetype caps. The power info (`powerinfo.ts`) adds the damage of the pseudo-pets a power
makes and of the powers it executes, and lists the pets' effects, as the live clients do
(`docs/game-rules.md`, "Pseudo-pet damage"). It lists Fiery Embrace's and Dual Pistols' ammo
groups and Homecoming's Stalker team crits with the client's notes and chances
(`docs/game-rules.md`, "Tag modes").
The engine is pure and synchronous; keep React and the DOM out of it.

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
- Questions use `askConfirm` (or `askChoices` for rows of options, `askThreeWay` for two ways
  forward and Cancel; Cancel has the keyboard focus, so Escape and Enter stay); messages with one OK button
  use `tell` (its optional `link` makes one phrase open a fixed https page in a new tab, as the
  hero Patron note links the wiki; its optional `wait` greys OK for that many seconds, counted down
  on the button); refusals use `notify` or `flashLocked`. The server list is `askServer`.
- Hover state (tooltips, glows) lives in `src/ui/hover.ts`, so a hover redraws only the piece it
  affects, never a whole screen. Keep it that way.
- A desktop tooltip taller than the stage (Spotlight's Advanced tooltip) is cut to the room above
  the Back / Finish bar and scrolls with the mouse wheel and Page Up / Page Down while it is shown.
  A wheel gesture stays with what it started on until the wheel rests, as browsers latch one: one
  that starts on the tooltip stops at its end, and one that starts on the list (or past the
  tooltip's end) keeps scrolling the list as tall tooltips come and go under the pointer. With two
  tooltips up, the newest cut short takes the wheel; with a pop-up open, none does. Its scrollbar
  only shows there is more (a hover box can't be dragged); the box widens for it (and pads its
  right side for a scrollbar that floats over the text) so its text doesn't rewrap (`Floating` and `useTallWheel` in
  `src/ui/components/PowerTip.tsx`; `floatingRoom`, `routeWheel` and `scrollRoom` in
  `src/ui/floating.ts`). The phone's long-press tooltip scrolls by touch.

## Browser tests

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
  `tooltipwheel.spec.ts` (desktop only) hovers a tall Advanced tooltip (Hail of Bullets) and turns
  the wheel: the gesture stays on it to its end, a turn after a rest goes to the screen, and Page
  Up / Page Down scroll it.

  They find elements by `data-testid` (`testId` on `CheckBar`, `SlotRing`, `PhoneTabs`); the shared
  driver is `e2e/player.ts`. Run them after changing the screens or the level-up flow.
