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
    packed.ts                fetchJson: a data file's download, watched (watch.ts); and brotli
                             copies of the data files for GitHub Pages, switched off
    versions.ts              versions.json, LEGACY_GAME_VERSION, resolveVersion()
    watch.ts                 Watch: when a download last received anything, and a way to give it
                             up (Try again); ask: a file with no answer is asked for again alongside
    servers.ts               game servers: ids, address paths, data folders, logos (SERVERS)
    pets.ts                  the shape check of a version's pseudo-pet file (readPetsFile)
    henchmen.ts              the shape check of a version's real pets file (readHenchmenFile)
    info.ts                  the shape check of a version's power-info extras file (readInfoFile)
    types.ts                 shapes of the exported JSON
    finderStats.ts           the set finder's build statistics (public/data/finder/): their shape,
                             checkFinderStats, loadFinderStats
    recipes.ts               a version's recipes (public/data/recipes/<version>.json): their shape,
                             checkRecipes, loadRecipes
  engine/                    pure TypeScript build rules (no React, no DOM)
    build.ts                 Build / Pick / Slot model, newBuild()
    rules.ts                 BuildRules: availability, picks, auto-granted powers, slots, issues
    requires.ts              the game's RPN requirement evaluator
    context.ts               the contexts it evaluates with, built from parts (aimedAt: the target, whole)
    combat.ts                in combat or out of it: each version's power events, a fight's events,
                             the suppressions it starts (combatHooks; the Out of Combat switch)
    schedule.ts              pick / slot / pool / epic level schedules
    enhance.ts               enhancement values, ED, origin and set validity, set rarity, help text
    setbonus.ts, totals.ts   set bonuses (rule of 5) and the totals panel
    powerinfo.ts             detailed power numbers (base vs enhanced)
    boost.ts                 the build's damage boosts, for the damage a power info shows
    placing.ts               where the enhancement picker's Place puts the pieces chosen
    petcards.ts              the totals' Pets and Minions rows and cards (petEntries, makesPets)
    petstats.ts              a pet's stats for its pane: what lands on it (petStats, petPowerOn)
    finder/                  the set finder's engine (see "Set finder (engine)" below)
      query.ts               a search: goals and importance, set tags, wanted bonus and depth
      goals.ts               what each stat and power channel is worth to a search (weightsFor)
      roles.ts               what a power is for: attack, self heal, control, other (rolesOf)
      core.ts                FinderBase: the build read once, and the quick totals change of a re-slot
      score.ts               Scorer: a re-slot's worth, gutted powers, needs
      candidates.ts          which sets and pieces may be offered; piece kinds; wanted-bonus options
      search.ts              searchSwaps / findSwaps: the ranked swaps, legal ones only
      warnings.ts            what a swap costs that the player should see
      pending.ts             kept swaps and the build they make (applySwaps, keepSwap)
      diff.ts                buildDiff: exact gains and losses from two full totals
      dealt.ts               the damage types a build's own powers deal (damageTypesDealt)
      procs.ts               a damage proc's chance, rate and damage a minute (procChance, procFigures)
      powerNumbers.ts        a power's own numbers with a slotting (slottedNumbers)
      bonusVec.ts, eligible.ts   bonus lines kept per search; the sets each power takes
      labels.ts, view.ts     words (stat names, amounts, warnings) and lists for the screens (the
                             bonuses to ask for, set types, results grouped by set)
      shopping.ts            the shopping list: recipes, salvage and enhancements to get, and the
                             auction house search lines (shoppingList, auctionLines)
    actions.ts               pure edits (setPick, addSlot, setEnh, ...), swapPick and raiseToCap
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
    limits.ts                IMPORT_LIMITS: every limit an import keeps to, by format
    fileName.ts              safe names for downloaded files
    shopping.ts              the set finder's shopping list as the browser keeps it (localStorage)
  state/store.ts             zustand store: data, current build, level-up flow, dialogs
  state/finder.ts            the set finder's store: statistics, search, results, kept swaps,
                             the shopping list
  state/finderOpen.ts        whether its pane is open (apart, so the engine loads on demand)
  state/combat.ts            the totals' Out of Combat switch (in memory only: off on every visit)
  state/lastServer.ts        the server last shown in this browser (the server list starts on it)
  state/lastUsed.ts          when this browser last used the planner (the 4-hour return)
  state/tabTitle.ts          the browser tab's title, which follows the build's name
  ui/
    screens/                 Setup (New Build), ChooseNewPower, ChoosePoolSet,
                             AddEnhancementSlot, Overview, EnhancementPicker, BuildMenu,
                             SetFinder (the set finder's pane, loaded on demand) and
                             FinderShopping (its shopping list)
    components/              game chrome (frames, bars, rings, scrollbars, text, tooltips);
                             FinderIcon (the set finder's button icon and working name);
                             PetCard (the Pets and Minions rows, the pet pane, usePetCards)
    skin/                    metrics.ts (virtual-screen maths), skin.ts (hero/villain/praetorian)
    hover.ts                 hover / tooltip state (kept out of the screens on purpose)
    floating.ts              where hover tooltips go (pure placement maths)
    press.ts                 press-and-hold on touch screens, Enter / Space / Delete for keyboards
    stageLayout.ts           which layout a window gets and its stage size (pure)
    flags.ts                 SET_FINDER: whether the unfinished set finder's button shows
    escape.ts                Escape-key stack (useEscape)
    sound.ts                 game UI sounds and menu music (both off until switched on; see below)
tests/                       vitest; tests/helpers/data.ts loads public/data like the site does
  fixtures/builds/           forum builds (Mids data chunks, .mbd files) the browser tests recreate
e2e/                         Playwright browser tests (playwright.config.ts; local only)
research/                    the build research (npm run research; owner's machine only): reads a
                             folder of community builds and writes the set finder's statistics
  builds.research.ts         the run: import every build, measure, aggregate, write
  corpus.ts                  reading the folder: .mbd files, share codes in text files and pages
  measure.ts                 one build's facts; what the game's set bonuses offer an archetype
  aggregate.ts               stat values, needs, set and piece usage
  report.ts                  pipeline/report-finder.md
public/data/<version>/       exported game data per game version (generated, committed)
public/data/finder/          the set finder's build statistics, stats.json (generated by the build
                             research, committed; no link reads it)
public/data/versions.json    version index {default, versions: [{id, label, hash, patch?, approx?}]}
public/data/latest.json      {dataVersion}: the default version, for older clients (written last)
public/data/thunderspy/      Thunderspy's data: its own versions.json and version folders (no mids-map)
public/data/pets/<version>.json  each version's pseudo-pets, beside the version folders (generated;
                             Thunderspy's in public/data/thunderspy/pets/)
public/data/info/<version>.json  each version's power-info extras, beside them (generated;
                             Thunderspy's in public/data/thunderspy/info/)
public/data/henchmen/<version>.json  each version's real pets, beside them (generated;
                             Thunderspy's in public/data/thunderspy/henchmen/; the totals' Pets
                             and Minions section and the pet pane read it)
public/data/recipes/<version>.json  each version's dropped recipes and their salvage, beside the
                             version folders (generated; the set finder's shopping list reads it)
public/assets/               icons, UI textures, fonts, sounds (generated, committed)
public/assets/thunderspy/    Thunderspy's copy of every icon it shows (generated)
public/servers/              game server logos (placed by hand, WebP; not pipeline output)
public/favicon.png           the site icon (placed by hand)
pipeline/                    Python data pipeline (runs on the owner's machine only)
  run.py                     entry point: python -m pipeline.run
  overlay.py                 approximate older-patch versions (python -m pipeline.overlay)
  pets.py                    a published version's pseudo-pet file only (python -m pipeline.pets)
  pets_test.py               the pseudo-pet export's tests (python -m unittest pipeline.pets_test; run by CI)
  henchmen.py                a published version's real pets file only (python -m pipeline.henchmen)
  henchmen_test.py           its export's tests (python -m unittest pipeline.henchmen_test; run by CI)
  info.py                    a published version's power-info extras file only (python -m pipeline.info)
  info_test.py               its export's tests (python -m unittest pipeline.info_test; run by CI)
  watch.py                   a new release on a server's live manifest (python -m pipeline.watch)
  watch_test.py              its tests (python -m unittest pipeline.watch_test; run by CI)
  compare.py                 what another server's data does differently from Homecoming's
                             (python -m pipeline.compare --server thunderspy)
  compare_test.py            its tests (python -m unittest pipeline.compare_test; run by CI)
  recipes.py                 a published version's recipes and salvage (python -m pipeline.recipes;
                             its test, recipes_test.py, is run by CI)
  pvp.py                     which effect groups only apply in PvP (its test, pvp_test.py, is run by CI)
  export.py                  the decoded client -> the JSON the site loads
  patch-history.json         the patch timeline (docs/patch-history.md; patch_history_test.py,
                             run by CI, checks it)
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
  report-finder.md           the build research's report: what was read, how the Mids import held
                             up, and the statistics in tables (npm run research)
tools/                       standard-library Python decoders for client file formats
scripts/release-version.mjs  the version a deploy publishes (plain Node; run by pages.yml)
scripts/precompress.mjs      pre-compressed copies of a built site's text files (run by pages.yml
                             on the build for the site's own domain)
scripts/deploy-report.mjs    what a deploy did for each target, GitHub Pages and the domain (run by
                             pages.yml's last job)
scripts/release-notes.mjs    a release's notes: the changelog's lines new since the last (pages.yml)
scripts/changelog-stamp.mjs  moves a release's lines under its version's heading on main (pages.yml's
                             stamp-changelog job)
scripts/audit-dev.mjs        the CI dependency audit's check of the build and test tools
hosting/                     the site's own domain (docs/hosting.md): Caddyfile, planner-update.sh
                             and its systemd service and timer
docs/game-rules.md           pick, auto-grant and slot rules ported from the engine source
docs/exemplar-rules.md       exemplar rules (pending the owner's review)
docs/releases.md             versions, the deploy's stages, the changelog, main's rules
docs/hosting.md              the site on its own domain and its host
docs/pipeline.md             the data pipeline
docs/patch-history.md        the patch timeline, to tell which patch an old client is
.github/workflows/           ci.yml (pull request checks, always main's copy), pages.yml (started
                             by hand: picks and tags a version, stamps the changelog on main,
                             deploys GitHub Pages, and builds, signs and attaches the domain's
                             site file)
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
refused); without it the power info shows no effect notes and keeps the planner's own wording. The
version's real pets file is fetched only once a build has a power that may make a real pet
(`makesPets`: more EntCreate mods than the pets file lists pseudo-pets for it, decided once the pets
file's fetch has ended, `GameData.petsSettled`; `GameData.requestHenchmen`, called by the totals'
hosts through `usePetCards`; once per version),
taken through `GameData.setHenchmen` (`src/data/henchmen.ts`) and heard through
`subscribeHenchmen`; a fetch the network fails is asked for again on the build's next change (a
missing file is not), and without the file the totals show no Pets and Minions section.

**Brotli copies on GitHub Pages (switched off).** GitHub Pages sends a file gzip-compressed and
nothing smaller. The planner can get around that: a build marked `HCP_BROTLI=1` asks for a brotli
copy of each of a version's four files (`name.json.br`, about a third of what gzip makes of it,
made by `node scripts/precompress.mjs dist/data br`) and unpacks it in the page, in a browser whose
`DecompressionStream` takes brotli (`fetchJson` and `viaCopy` in `src/data/packed.ts`); any other
browser, and any copy that is missing, stalls (`COPY_STALL_MS`) or won't unpack or parse, gets the
file itself. The deploy does not use it (the owner's decision, November 20, 2026), because it trades
certainty for size:

- It reaches few visitors. Every browser unpacks brotli that a web server sends (as the site's own
  domain does, `docs/hosting.md`), but only Firefox 147+ and Safari 18.4+ unpack it in a page;
  Chrome does not.
- The visitor's browser decides, not a release: the day Chrome's `DecompressionStream` takes
  brotli, most visitors would move to the copies with no deploy and no test.
- It was never seen on GitHub Pages itself (how the host serves a `.br` file can't be tried before
  a deploy), nor in Safari.
- A copy that stalls is only given up for the file after `COPY_STALL_MS` (30 seconds), longer than
  a visitor waits.

Before switching it on again, settle those: a short stall limit, a browser list the site chooses,
and a trial on the real host. The code and its tests (`tests/packed.test.ts`) are kept for that.

**Servers and the address.** The page address names the game server:
`/HatesCoHPlanner/<path>/#b=<share code>` (`serverFromPath`, any case). The build step copies
`index.html` to `<path>/index.html` for each server (`serverPages` in `vite.config.ts`) so GitHub
Pages serves those addresses. It also writes `404.html` (`notFoundPage`): a server address in
another case or with more after it (`/HatesCoHPlanner/homecoming/x`) goes on to that server's page
with its `#b=` code (`notFoundRedirect`, written into the page and allowed by its hash in the page's
CSP); anything else gets a "not found" page linking to the planner, so an unknown server's link is
never opened as Homecoming. The site base is GitHub Pages' `/HatesCoHPlanner/` (`PAGES_BASE`)
unless the build is told another (`HCP_BASE`, `siteBase` in `vite.config.ts`): the deploy's second
build, for the site's own domain, has `/`, so its addresses are `/<path>/#b=<share code>`. There a
link made on GitHub Pages still opens: its 404 page sends `/HatesCoHPlanner/<path>/` on to
`/<path>/`, and a pasted one is read the same (`onThisSite`); on GitHub Pages both do exactly
what they did (`docs/hosting.md`). On load, a share link opens on the server its address names (none:
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
over with it, and one pasted while the load is still downloading is read when that load is done, as
a link pasted into an open planner (`readPastedLink`). With no build, New Build opens on the server the address names; failing that, a link
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

When a download fails or stalls: a link whose server's version list won't load stops on the error
screen (one fixed sentence, `LOAD_FAILED`; the details go to the console), and so does a build the
player just asked to continue. Any other remembered build whose server's version list or data won't
load is passed over, and so is one `checkBuild` can't read at all (said in a dialog): the next
candidate, then New Build or the server list, so one server's files being down never keeps the
player from the others, and a stored build can't hold every later load on the error screen. Nothing
is removed from storage.

A download that stalls is told from one that is slow by what it receives. The downloads behind
each thing the load waits for are watched together (`Watch` in `src/data/watch.ts`): a version
list, or a version's four files as one, since a slow connection may deliver them one after another
and a file waiting its turn looks just like one that stalled. Nothing begun or received for 5
seconds (`STALLED_MS`) counts as stalled; a download still receiving, however little, never does.
Two rules keep a slow connection from being punished for being slow:

- **Nothing is cancelled by itself.** While a file has no answer and its watch has stalled, the
  file is asked for a second time alongside the first, past the browser's cache, at most twice
  more and 5 seconds apart (`ask`, `EXTRA_ASKS`). An extra ask is no sign of life for the watch,
  so every file with no answer is asked for again at the same pace, and Try again can still tell
  that nothing is coming. Whichever ask answers first is used and the others are let go of,
  so a request that is only slow to answer loses nothing, not even its place in line. Once the
  answer has come the download is its body, which is never asked for again by itself: a body that
  stalls part way is left as it is, so a connection that only paused picks it up where it was.
- **A download that is receiving is never given up**, not even by the player. Try again is offered
  on the loading screen after 10 seconds with no question on screen (`LoadingScreen` in
  `src/App.tsx`); `retryLoad` gives up the downloads that have stalled, keeps those still coming
  in (the new load waits for them too), fetches everything else afresh and starts the load again.
  New Build has no Try again: there, picking the server or version again does the same for its
  download (`kept` in the store, asked with `retry`). When one of a version's four files fails,
  the load has failed, and the other three are given up with it (`loadGameData`).

Giving a download up (`Watch.cancel`) cancels its requests and marks the files still under way, so
that each is next asked for past the browser's cache (`asAgain`, `cache: 'reload'`). Both matter:
when a download of an address is under way, a browser gives a new request for that address the
same download (seen in Chrome), so a stalled file could otherwise only be fetched again by
reloading the page. A browser
that can't hand a body over in parts (no `TransformStream`) can't tell the watch what arrives;
while such a body is being read its watch is never called stalled (`Watch.unheard`), since it may
be arriving all along.

A page whose script
never arrives has no loading screen at all (right after a release a browser may still hold the page
from before it, naming a script file that is gone): `index.html` itself then says to reload, in a
note of plain HTML and CSS that shows once `#root` has stayed empty for 10 seconds
(`#not-started`; `tests/notstarted.test.ts`). Only the newest `load()` shows what it loaded
(`loadSeq`), and of two quick picks of a version or server on New Build the last one wins
(`serverSeq`). `tests/loadfallbacks.test.ts` covers these.

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
nothing and open on the default version; their layout follows the save version they carry (a
power's ProcInclude from 3.10, the inherent-slot fields only from 3.20: `mxdzToMbd`). A code
posted from the original game's Mids (1.9x) may hold a power index today's map lacks; when the
"Hero Plan" text above it is pasted too, `parseHeroPlan` reads its `Level N: name` lines (within
`IMPORT_LIMITS.mids.plan`, hidden characters stripped) and `planNames` names such a power from the
line at its level, by display name, else by the last part of its internal name (Afterburner), only
when exactly one pickable power of the build's sets matches; a name is never shown. `importTarget()` (`src/data/versions.ts`) then opens the
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

**Names between Mids and the game.** Mids names some powers its own way, and Homecoming has moved
names around inside a set (its Stalker Shield Defense power named Deflection is the one players see
as Battle Agility). `mids-map.json` matches each Mids power by the name players see within its set,
else by its own name (`pipeline/mids_map.py`, `match_powers`): `names` reads a Mids name ("" for a
Mids power the game lacks), `exportNames` gives the Mids name an export writes ("" where Mids has
none), and `powers` gives the legacy `|MxDz;` indexes, each power's export name first. `renames`
stays the CrypticPowerNames table it always was.

**The planner's own exports.** Mids export is best effort, and the menu says so with every
export. The `.mbd` and `|MBD;` exports put the build's share link in the build comment, which Mids
shows and keeps when it saves the file, and the game version alone on the comment's last line
(`i28p4`), which `midsMadeOn` reads to open a file Mids saved again (Mids writes its own
`BuiltWith`) on the version it was made on. On import (`importParsed`), `linkedBuild` decodes the
first link after the planner's label that is for the file's game version and passes `checkBuild`
(a link a player pasted in is not read), and `importMbd` compares the file with what the planner
would export for that build, matching picks by their Mids name and level, so an entry Mids leaves
out moves nothing. Every power entry and slot the file still holds as exported comes back exactly
from the link: attuned pieces, base slot levels, powers without slots of their own and the
powers' on/off switches (MidsReborn 3.8 turns every StatInclude on when it saves, and writes an
SO's unused IoLevel as 1, so neither counts as a change). The comment's lines end in CR LF, which
Mids' comment box shows as line breaks. Picks Mids
has no record of come back where their place is still free. The respec and level settings come
from the link only while every pick is the link's. Whatever was changed in Mids is read from the
file. A link is never followed. A file whose link is missing, damaged, for another game version or
for other power sets is read from its Mids fields alone. Exports made before the link
(they name the planner in `BuiltWith.App` and have no link) wrote the game's power names, and are
read through `renames` alone, as they always were. A `|MxDz;` code has no comment and is read as
Mids means it.

**Pieces and powers Mids lacks.** Mids has no attuned version of ordinary sets, no superior
purples, Synthetic Hamidon enhancements or Yin's talismans: the export writes the nearest piece (the
crafted piece at the top of the set's range, the Hamidon enhancement, the Single Origin piece of the
type) and one warning per set or kind; a piece with nothing near it (the pre-order pieces) leaves
the Mids slot empty. Two-origin pieces go as DOs, and a Mids DO comes back as the first two-origin
piece of its type the build's origin can use. A power or power set Mids has no record of is named
in a warning. Set pieces Mids keeps under another internal name (its Shrapnel is the game's
Artillery) are matched by their full name both ways (`Translator.boostByLongName`).
`tests/midsmap.test.ts` sends every power and enhancement a player can pick through the map and
lists what Mids lacks; `pipeline/report-mids-<version>.md` says where Mids reads otherwise.

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
unbounded work. Every limit is in one table, by format (`IMPORT_LIMITS` in `src/io/limits.ts`).
Decompression stops at a ceiling (`inflated` for share links and `|MxDz;` codes, the 2 MB
build-file size, `text`, for `|MBD;` Brotli data), counts past any real
build's are refused (picks, slots, granted powers, Mids power entries and sets; a `/build_save`
file's powers, slots and the lines its reader can't place), pasted text and files over 2 MB are
refused, and a `.mbd` whose fields have the wrong types is reported as damaged (`isMbd`). Downloaded file names are cleaned (`src/io/fileName.ts`). `tests/importlimits.test.ts`
covers these; new import code keeps to them. The published page also carries a
Content-Security-Policy (`vite.config.ts`, built pages only): everything is loaded from the site
itself, so a new outside resource needs the policy changed with it.

**Sound and music.** Both switches start off and stay off until switched on (`startsMuted` in the
store; Music reads as any switch does), so a first visit downloads no sound at all: the menu music
is the largest file the site has (2 to 5 MB a track) and used to start on the first click. While
Sound is on, the 59 interface sounds (1.5 MB together) are fetched ahead of their first play, a few
at a time, so none lags (`loadSounds` in `src/ui/sound.ts`): at once when Sound is switched on, and
once the page is up for a visitor who left it on. Switched off part way, no further download
starts (the few under way finish), and the rest are taken up when it is on again; a sound heard
before its turn is not fetched a second time. They are kept as object URLs and played from
memory (hence `blob:` in the policy's `media-src`). The list of their names is read from
`public/assets/sounds/` at build time (`__HCP_UI_SOUNDS__` in `vite.config.ts`), so it can't fall
out of step with the files; a browser that can't play Ogg Vorbis fetches none. The music has
a track for each alignment's skin, and each is fetched when it first plays (so up to three, as the
alignment on screen changes). `tests/sound.test.ts` covers
these.

**Engine.** `BuildRules` (`src/engine/rules.ts`) answers every question the screens ask: what can
be picked at a level, what is auto-granted, where slots can go, what is wrong with the build.
`totals.ts` and `enhance.ts` do the math with the game's own tables: enhancement curves,
Enhancement Diversification, boosters and exemplar handicaps, set bonuses with the rule of 5,
and archetype caps. The power info (`powerinfo.ts`) adds the damage of the pseudo-pets a power
makes and of the powers it executes, and lists the pets' effects, as the live clients do
(`docs/game-rules.md`, "Pseudo-pet damage"). It lists Fiery Embrace's and Dual Pistols' ammo
groups and Homecoming's Stalker team crits with the client's notes and chances
(`docs/game-rules.md`, "Tag modes"). Given a build's damage boosts (`damageBoost`, `boost.ts`: what
the totals count, clicks switched on included), its damage rows and damage lines read the boosted damage, and it counts
Fiery Embrace's groups while it is switched on (`docs/game-rules.md`, "Boosted damage"); every
Advanced tooltip passes them (`AdvancedInfo`'s `rules`).
`petcards.ts` makes the totals' Pets and Minions rows (`petEntries`): each kind of real pet the
build's powers make at the totals' level and how many, with its card worked out only when first
shown (`PetEntry.card`): its stats and its attacks and other powers through the power info, run as
the pet (`powerInfo`'s `runAs`), with the build's upgrades applied (`docs/game-rules.md`, "Real
pets"). Pets of one name, class and powers other than attacks share a row (Gang War's posse).
`petstats.ts` works a pet's stats out as the totals work a character's (`attribLines`, `lineBook`
and `finishTotals` in `totals.ts`, against the pet class's base values and caps): its own powers,
the other pets' and the creator's that reach it, and the build's pet aura IOs, each source named
with its owner ("Maneuvers (yours)", "Maneuvers (Enforcers x2)"). A pet power counts when its
switch says so (`petPowerOn`: `Build.petOn`, else `petPowerDefault`: autos, toggles and a click
buff that lasts at least its recharge on).
The totals list the pets (`PetRow`, `src/ui/components/PetCard.tsx`); a click opens the pet pane
(`usePetPane`, `PetPaneLayer`, drawn by the overview and the side totals; on the desktop it pops out
of the row, to its left, `placePopOut`): the stats in the totals' own panel (`TotalsPanel` with
`nonZero`, only the rows that aren't zero, and a Powers section first, under a line per making
power: "Battle Drones: x3 (Level 19)"), and a switch on each power that can move a stat
(`buffsPets`, drawn with the overview's `OnSwitch`; the overview's pane only), every other power one
that does nothing, drawn like the rest so the names line up and greyed out under the pointer.
Attacks and other powers read alike: the name, then the power info's effect lines. A power's name
shows its power info on hover or keyboard focus (`useHover.petPower`), a long press on a phone
(`PhoneTipLayer`); a card cut short takes every wheel turn while it shows, at its end too
(`Floating`'s `lock`, `lockedTurn`), so the pane under it never scrolls away, and one that fits lets
the pane scroll. The pane closes on Escape or a click outside it, its pet's row included; the dimmed
backdrop takes the click, and the wheel, hovers and touches, so a click outside only closes it (the
owner's choice, as the enhancement picker's). A double-click's second click is ignored. It holds the
keyboard focus while open, and stays open
when the window crosses between the phone and desktop layouts. A pet's name in
the totals glows under the pointer. A heading's lettering (`TitleText`) lets clicks through to the
line under it, which its fill reaches over.
The engine is pure and synchronous; keep React and the DOM out of it.

The totals show the character in combat: what a fight stops (Hide's and pool Stealth's extra
defense, a travel power's speed) is left out until the Out of Combat switch at the totals' top is
turned on (`src/state/combat.ts`, in memory only: off on every visit, never in a build or a link).
The set finder reads its own state, in combat with travel and stealth counted. The rules:
`docs/game-rules.md`, "Combat state".

What the totals count by default (`defaultsOf` in `totals.ts`; every power can be switched per
build): autos and toggles on, clicks off, except
- the inherent utility toggles (Rest, Walk, Sprint);
- emergency toggles (`isEmergencyToggle`): ones that make their user untouchable, intangible or
  able to affect only itself while they run (Hibernate, Icy Bastion, Geode, Phase Shift,
  Personal Force Field, Nebulous Form), found from their effects;
- toggles that switch each other off (`exclusiveGroups`: a shared GroupMembership, as the game's
  `character_ShutOffAllTogglePowersInSameGroup` does): only the earliest picked is on. Switching
  one on in the overview switches the others in its group off;
- pet upgrades (`isPetUpgrade`: Equip Robot, Train Ninjas, ...) are on, though clicks: switched off,
  no pet gets them. A Mids import leaves them at that default (Mids leaves clicks out of its stats).

**Set finder (engine).** `src/engine/finder/` ranks *swaps* for a Homecoming build: pieces of one
enhancement set into slots one power already has. It never moves a slot or changes a power. Its
screens are described under "Set finder (screens)" below. The parts:

- **A search** (`FinderQuery`, `query.ts`): three priority rows, each a goal with an importance
  (Low 0.5, Medium 1, High 2, Critical 8). A row may hold an importance and no goal: it is not
  searched for (`chosenGoals`, which everything that reads the goals goes through), so one to
  three goals count. Picking a goal another row holds moves it there and empties that row, which
  keeps its importance (`setGoalAt`). Then the kinds of sets to add to uncommon and rare ones
  (PvP, seasonal, purple, archetype), an optional wanted bonus (a totals line key) with a depth
  (2 to 3 pieces, 4 to 6, anywhere), up to two additional bonuses, set categories or the powers
  to keep to (`powers`: entry key and power id, so another build's entry of the same key is not
  taken for it), crafted or attuned.
- **Units** (`goals.ts`): everything is counted in "typical bonuses". A stat's unit is the size of
  one typical set bonus in it, from the build statistics (`public/data/finder/stats.json`) for the
  build's archetype, or for every build when the archetype has too few. A goal is a bundle of
  stats and of *power channels* (what a power's own slotting does for its role: `st.out`,
  `heal.rech`). A chosen goal counts by its importance; what the search did not name counts a
  little when gained (`BASELINE`) and in full when given up (`LOSS_WEIGHT`). The part of a worth
  the search itself names (its goals and bonuses, without `BASELINE`) is kept apart (`asked`):
  without a wanted bonus a swap is listed only when it is a gain by that part alone
  (`Scored.asked`), so a Damage Resistance search never lists a swap that gives resistance up
  for regeneration or status resistance; what was not named only orders the list. The statistics only
  set units, the weight of each defense and resistance type within its goal, and the needs: they
  never decide which goal matters.
- **Quick figures** (`core.ts`): the full totals take milliseconds, too slow for every candidate.
  A re-slot of one power only moves what that power adds while it runs (`runningLines`), the
  bonuses its slots earn (`earnedBonuses`, then the rule of five against the rest of the build)
  and the running toggles' cost, so `FinderBase.delta` works those out with the totals' own
  functions and reads the rest from one `computeTotals`. A test holds the two equal line by line.
  A piece with an effect of its own counts once however many running powers hold it, as in the
  totals. Everything is worked out at the build's last level (its stop level, else 50), whatever
  exemplar level the build is set to show: sets are bought for the whole build.
  Gains past a cap count for nothing (`cappedChange`: the archetype caps and the 45% defense soft
  cap, `docs/game-rules.md`).
- **A power's own job** (`roles.ts`, `score.ts`): its roles come from the enhancement types it
  accepts and what its effects do. A change in its enhancement strength counts as the global
  bonus that would do the same for the build: the change times the power's share of the build's
  damage (or healing) per second in that role. A swap that leaves a power's output, accuracy or
  recharge multiplier a fifth lower or worse is marked down and carries a warning ("crippled"),
  whatever the goals are. A running power's buffs on its own user are in the totals lines already;
  the strength of one aimed at enemies or allies (a debuff toggle) moves no line and counts here.
  Only a click's recharge counts.
- **Needs** (`needsFor`): stats nearly every build of the archetype or power set holds (knockback
  protection). Falling under the typical amount is marked down and warned about.
- **The search** (`search.ts`): per power, its slots are ordered by what the build loses when
  each is emptied (empty slots first; a proc is given a set worth in the ranking, `PROC_VALUE`),
  a set's legal pieces by what each does for the power (procs last), and every piece
  count the search allows is tried. Pieces go in crafted at the highest level that works at the
  build's last level (set top, or build level plus the levels an IO works above the character),
  or attuned. A single piece is offered only for a unique piece's global. At 50 a Superior set
  stands in for its plain version. With a wanted bonus, a swap counts only when the stat rises
  under its cap through a bonus of the asked depth that the swap newly earns and the rule of five
  still counts. The best count per power and set is kept, the list is sorted, and what the game
  would refuse (`enhRefusal`) on the build with every kept swap and the new one in is dropped.
  `searchSwaps` is a generator that yields after each power, so a screen can spread the work.
- **Kept swaps** (`pending.ts`): a list beside the build, one per power; the build the planner
  holds is never changed by a search. A search given kept swaps ranks against the build with them
  in; a power that has one is searched from its own slots, so a new swap replaces the kept one.
  A swap records the power's slots as it found them (`before`): one made for another build, or
  before the player changed that power's slots, is left out and named in the result (`stale`).
- **Gains and losses** (`diff.ts`): for a hovered swap or the summary, `buildDiff` compares two
  full totals and the changed powers' own numbers (`slottedNumbers`: damage, heal, accuracy,
  endurance cost, recharge time with the build's global recharge). A figure past its cap also
  carries what it holds before the cap (`rawBefore`, `rawAfter`), a row is kept when only that
  moves, and `atCap` marks a stat at its cap (defense: the 45% soft cap, which has no cap to
  show; max HP glows standing at its cap, regeneration and recovery only past theirs). A damage
  bonus of a type none of the build's own powers deal is marked `unused` (`dealt.ts`: the powers'
  effects, the powers they execute and their pseudo-pets; not Brawl, not slotted procs). A pet's
  damage is in files the app never waits for, and a real pet's attacks are not read: with a power
  that makes a pet whose powers are not at hand nothing is marked. Each damage proc a changed
  power holds on either side is a row of its own: its damage a minute, named with its rate
  (`procs.ts`, `docs/game-rules.md`; two of one proc and type in a power are one row). A click
  power whose slots stay is listed too when the build's recharge moves and it holds a damage
  proc.
- **Warnings** (`warnings.ts`): a need dropped ("below the N suggested for this build": the
  amount is the research statistics' median, or 8 for knockback protection, `KNOCKBACK_NEED`;
  the sentence does not speak of other players' builds), a gutted power (its output or accuracy; a power slotted for less recharge is marked
  down in the ranking but is the player's choice, so it is no warning, and its recharge time is
  in the gains and losses), a unique piece's global taken out, a proc without numbers taken out (a damage proc shows in the gains and losses), a bonus
  past the rule of five, and a stat that was at its cap (defense: the soft cap) and falls under
  it (`capLost`). A gain past a cap is no warning: the list shows it as "cap (actual)".

**Set finder (screens).** The pane is `src/ui/screens/SetFinder.tsx`, over the build overview
like the enhancement picker (the whole screen on phones, with Search / Results / Kept / List tabs). It is
still being built: its button shows only where `SET_FINDER` is true (`src/ui/flags.ts`: a dev
server, or a build made with `HCP_SET_FINDER=1`), so a deploy does not show it.

- **Opening.** An icon button right of the overview's origin and archetype label, and a row in the
  phone menu, both for Homecoming builds only. They set `finderOpen.ts`'s flag; `App.tsx`
  (`FinderPane`) then downloads the pane and the finder's engine as their own chunk, so neither
  is in the page's first download. A failed download closes the pane with a notice and the next
  opening tries again. Leaving the overview closes the pane (`App.tsx`), so it never comes back
  on its own.
- **State** (`src/state/finder.ts`, not saved, never in a link): the statistics
  (`loadFinderStats`, fetched once from the data folder and shape-checked), the search as the form
  holds it, the last result, the kept swaps, and a share link to the build with them in. A search
  runs the engine's generator in slices of about 12 ms on timers, so the page keeps responding,
  and a newer search makes an older one give up; so does closing the pane. Keeping or letting go
  of a swap ranks the list again (`rerank`), for the search the list was made with, or the one
  being worked on while a search runs; with no list yet, nothing is ranked. The form may have
  changed since, even to one that can't be searched, and only Search takes the form. A list
  names the search and the kept swaps it was made with (`searched`, `searchedKept`) only once it
  is shown, so a search given up or failed leaves the old list marked out of date. While a search
  runs the list on screen is the old one, so nothing in it can be kept, and a swap is only kept
  when the game would take every kept swap together (`swapsLegal`); a refusal, a search that
  failed (details in the console; the pane never stays "Searching"), or a link that could not be
  written shows as a red line in the pane (`note`). Any change to the build (an edit, another
  build, the swaps applied) clears the results and the kept swaps: they belonged to the build as
  it was. The form is kept, less what the new build's lists can't show (`fitQuery`; a bonus the
  new list names by another key of the same kind is carried over to that key, and picked powers
  the build no longer has in the same place are dropped). The lists' order (`sort`) is kept too.
- **Priorities.** Three rows of native selects. A goal another row holds is still offered, tinted
  and named with its row ("Defense (priority 2)"): picking it moves it.
- **Powers to consider.** "Select powers..." at the top of the Set type box puts the pane out of
  the way (`finderOpen.ts`: `picking`, `picked`; the pane stays mounted, so a search is not
  lost) and shows "Select Powers to Consider" in a box drawn like the slot screen's Slots
  Available (red until a power is picked, then green) with Done beside it: over the Origin /
  Alignment and Continue Leveling buttons on desktop, in the place of New Build and Save / Share
  on phones. On the overview a click on the bar of a power a set can go into picks it or lets it
  go (a gold ring marks it); any other bar is refused (`flashLocked`, "Takes No Sets", with that
  refusal's sound alone). Nothing else on the overview answers meanwhile (`PickGuard` in
  `Overview.tsx`: a click, a right click, Enter or Space reaches only the power bars and the
  phone's row of tabs), since a changed build drops the finder's kept swaps and results and
  another screen would leave the picking behind: the level orbs, the title's rename, New Build,
  Save / Share, Origin / Alignment, the slot rings, the on/off switches, the exclusive toggles'
  boxes and the pet pane's switches do nothing, and the phone's menu stays shut (`Settings.tsx`).
  Scrolling, hover texts and long presses stay.
  The build's name stops short of the box (`pickBox`, `finderPick.ts`). Done or Escape brings the pane back with the picked
  powers as the search's `powers` (none picked: every power again); the box then reads "N powers
  selected" with a line under it saying only those are searched, and picking a set type or every
  set type clears them. Closing the pane ends the picking, and so does any change to the build.
- **Lists.** The kept swaps come first, each with its box ticked (untick to let it go), then the
  results: each set shows its best placement, the others folded under it. A row is the set, its
  piece count, its levels and "into <power>" on one line, with the pieces' icons under it. The label at the top
  right steps the order (`nextSort`, `sortSwaps`): Default (a dash), by the power's name A to Z
  and Z to A, by the fewest and the most pieces (the list's "x4"), with the scroll bars' arrow
  for the direction; in any order but the default every placement is a row of its own, and the
  kept swaps are ordered the same way (the phone's Kept tab too). A line says so when the
  form, or the kept swaps (a ranking given up or failed), have changed since the list was made.
  Pointing at a swap (tapping it, on a phone) shows its net gains and losses from `buildDiff`:
  what a result would change on top of the kept swaps, or what a kept swap is adding. The hovered
  row is in `hover.ts` (`swap`, desktop only), so only the gains and losses pane redraws; ticking
  a box clears it, as the row moves to the other list with no mouseleave. The search's progress
  redraws only its own label. With nothing pointed at, the pane shows the kept swaps together
  against the build as it is. Figures are written as the totals pane writes them (mph, ft, per
  second). The powers the change re-slots come first, each under its bar as the overview draws it
  (`PowerHead`: a `CheckBar` with the power's icon, a picture only), with its own
  figures (the better ones, then the worse); the totals' Net Gains and Net Losses follow, and a
  power the change only reaches through the build's recharge (`PowerDiff.slotted` false: its
  procs fire more or less often) is listed inside them under its name. A figure standing
  at its cap glows amber (`atCap`, `wasAtCap`), or purple at defense's soft cap (`softCap`), and a stat past its cap is written as the
  character sheet writes it, "cap (actual)": into the cap `old -> cap (new)`, staying past it
  `cap (old -> new)`, out of it `cap (old) -> new`. Damage bonuses marked unused fold into one
  greyed "Unused Damage" row that opens on a click (closed again for the next swap shown). A
  damage type is used when one of the build's powers deals it (`damageTypesDealt`, `dealt.ts`):
  its own effects, the powers it executes or redirects to (a Titan Weapons attack, a snipe's
  quick form), and its pets, pseudo-pets and real ones; inherent powers and procs don't count.
  A pet's powers are in the pets files, which the app never waits for: until they are at hand
  nothing is called unused, the pane asks for the real pets file when a build needs it
  (`requestHenchmen`) and reads again when a file arrives. What a swap takes out is said in short
  (`replacedLines`, `labels.ts`): a whole set as its count ("Crushing Impact: 6/6"), two or more
  pieces of a set by their short names on a line of their own ("Power Transfer: EndMod,
  Dmg/Rech"), everything else on one last line ("IO: Rech, Lockdown: Acc/Rech"). A proc's row has a tooltip saying which figure is
  its rate and which its damage a minute.
- **Applying.** "Apply to this build" asks first (`askConfirm`, naming how many enhancements are
  replaced), then `setBuild`; if the kept swaps changed while the question was up, nothing is
  applied and the note says so. "Open as new build" is a plain link to the share link the store
  wrote (`target="_blank"`, the player's own click, an address the code built), so the build in
  hand is left alone and no pop-up blocker is involved.
- A build whose game version has no statistics, or another server's build, gets a plain sentence
  instead of a search (`finderProblem`).
- **Shopping list** (`FinderShopping.tsx`; the "Shopping List" button on desktop, the List tab on
  phones; both are off until there is something to list: a kept swap, or items the browser keeps
  from swaps applied before). It shows what the browser keeps (`src/io/shopping.ts`: localStorage `hcp.shopping`, one
  list per server, enhancement ids with a level and an owned mark, at most 600 items, every entry
  checked when read) and, after it, the pieces the kept swaps would bring in (`swapItems`: a piece
  going into a slot that already holds that enhancement is not one). A kept swap's pieces are only
  shown: they join the stored list when the swap is applied or the changed build is opened in a
  new tab, once (`settled`), so a swap let go leaves nothing behind. The list is never part of a
  build, a saved build or a link, and stays until "Clear list" (which asks first; the kept swaps'
  pieces then show again as not stored yet). Opening the changed build means a click or a middle
  click on "Open as new build": a build opened from the link's right-click menu, or by a long
  press on a phone, adds nothing to the list.
  - Tabs share the stored list. A change made in another tab is shown at once (the `storage`
    event, `shoppingChangedElsewhere`), and marking a piece reads the stored list first: what
    another tab added is kept, and when the list is no longer the one shown, nothing is marked and
    a line says so. If the browser refuses to store the list, a line says so and that server's
    list lasts as long as the tab (`unsavedFor`): until a write works again it is the tab's own
    and other tabs' changes are not taken in. When that happens on Apply, which closes the pane,
    the planner's own notice says it (`notify`); a refused "Clear list" says the stored list will
    be back.
  - On desktop, Escape in the shopping list goes back to the search; a second Escape closes the
    pane.
  - Each set is a bar with its pieces as rings, like a power on the overview. Clicking a ring marks
    that piece owned (greyed out); clicking the bar marks them all, or none when all were.
  - What is still needed comes from the version's recipe file (`src/data/recipes.ts`, downloaded
    when the list first shows, shape-checked, and used only with its own game version's data): a
    crafted piece needs the dropped recipe of its level and that recipe's salvage, added up; a
    piece no recipe makes (attuned, winter and archetype sets) is listed as an enhancement to buy.
    A version the site has no recipe file for (an approximate one) lists every piece that way and
    is not asked for again; after a download that failed, the next opening asks again. A recipe's
    row shows its set's round icon alone, an enhancement's row the framed piece.
  - Desktop only: the auction house lines (`auctionLines`) join names with commas into lines of at
    most 128 characters, the search box's limit; the search lists every item whose name holds one
    of the words (`uiAuction.c` `setSearchText`). A recipe's name goes without its "(Recipe)"
    ending, and its level is the player's to set in the auction house. Phones show no lines: text
    can't be pasted from a phone into the game. The limit is from the game's source; on
    Homecoming the owner got 8 names (123 characters) into the box and no further one
    (checked in game, November 17, 2026).
  - Desktop only: with the pointer over an enhancement of the list (a piece's ring, or a row
    under Recipes or Enhancements; `hover.ts`: `shop`), the browser's copy (Ctrl+C, Cmd+C)
    copies the search for that enhancement alone (`itemSearch`): its recipe and that recipe's
    salvage as one auction house line, or its own name when no recipe makes it. The list answers
    the page's `copy` event (`useCopyHovered`), so no clipboard permission is asked; text the
    player has selected is copied as usual. A line under the sets says what was copied.
  - The same on the build overview (`src/ui/copyEnh.ts`, `useCopyHoveredSlot`; desktop, and only
    where the set finder shows: `SET_FINDER`): with the pointer over a filled slot (`ringTip`),
    the copy keys copy that enhancement's search, at the level it is slotted at. The recipes are
    downloaded when a filled slot is first pointed at, apart from the finder's own copy of them
    (the finder's code is not loaded for this); keys pressed before they are in write the text
    when they arrive, and a download that failed copies nothing and is tried again. An
    enhancement in no set (a common IO, an SO) has no list and keeps the browser's own copy.
    Nothing is heard under the enhancement picker or while the finder's powers are picked.

The numbers marked `UNCONFIRMED` in the finder's source are defaults waiting for the owner's
ruling.

**Builds.** A `Build` (`src/engine/build.ts`) stores ids only:

- archetype, origin, alignment, primary and secondary;
- 24 picks with their slots and enhancements;
- auto-granted powers' slots and on/off switches;
- an optional stop level (`endLevel`) and the game version (`dataVersion`);
- the pet pane's switches (`petOn`: pet power full name -> on), only those changed from their
  default. A share code carries them in an optional field at its end, written only when there are
  any, so every other build's code is what it was; `checkBuild` keeps the well-formed ones (a dotted
  name, a boolean, at most 64).

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

**Swapping a power.** Any pick can be reopened from the overview, enhancements or not, from its
power bar (one flagged in red too, so the rule it breaks can be fixed: `CheckBar`'s `fixable`) or
its level orb, which reopens every pick of the level in turn (level 1: its primary power, then its
secondary, or the other way round on a Respec build, as its respec asks them; `LevelCtx.then`, carried through a swap's question and freed-slot screen; Cancel stops
there, keeping the picks already finished). Finish swaps it (`swapPick` in `src/engine/actions.ts`,
called by the store's `finishSwap`): the pick keeps its slots and the enhancements the new power
takes; the rest are dropped, slots past the new power's maximum (all of them for a power that takes
none) are freed, and powers the old one granted go with their slots. When that drops or frees
anything the store asks first (`askConfirm` with `sections` listing what is dropped and kept, and
the power names in the game's yellow through `highlight`); Cancel stays on the power screen. Freed
slots are placed on one slot screen holding just them (`LevelCtx.freed`, a one-step `flow`), each
keeping its level: a slot can only go on a power owned by its level (outside a respec), and Cancel
there undoes the whole swap.

A power the build takes at a later pick (one the overview shows: not past its stop level) is
offered on a reopened earlier one when it could be taken there with that later pick empty
(`earlierOption`; otherwise it stays greyed, the reason in its tooltip). Taking it
(`takeEarlierFlow` in the store) depends on where the later pick is:

- **Outside a Respec build's respec** (a leveling build, or a Respec build's picks past its respec
  level, `inRespec`): the earlier pick's power moves up to the later pick (`moveLater`), keeping the
  slots gained at that level or after (or in a respec), and so do the powers it grants; the earlier
  ones are freed. When it can't be taken there, the swap is refused with the reason (`tell`).
- **Within the respec (or an earlier pick that held nothing):** the later pick is emptied
  (`takeEarlier`), the old power's enhancements are dropped, and the player chooses that pick again
  (the old power offered first, `LevelCtx.chain`), then places its freed slots. Advanced Respec
  skips the question and says how many enhancements were dropped (`notify`). The pick chosen again
  may itself take a power the build has later still: the move starts from the swap so far, the
  chain goes on to that pick, and the freed slots gather until they are placed.

Within a Respec build's respec, where the planner picks slot levels itself (the respec's slot
screen, a swap's freed slots), the respec's empty slots are booked again afterwards
(`rebookRespecSlots`), so a slot sits at or after its power's level whenever the respec's levels
allow it; a slot holding an enhancement keeps its level, and a slot level reopened from its orb
keeps the level the player placed. Such screens reopened from the overview carry the respec's own
title and "Current Respec Level" line.

Every swap question also lists the picks the swap leaves breaking a rule (`newlyFlagged`: they are
flagged in red, never changed), and asks for that alone. The power screen's Totals show the build
Finish would make (`previewBuild`). Once a swap is confirmed, the screens after it (choosing a pick
again, freed slots) say "Undo Swap" where they'd say Cancel; Finish with freed slots no power can
take asks first. Advanced Respec ignores a click within `AUTO_GAP_MS` of the last one it moved on
from (`autoAdvanceReady`), so a double-click doesn't also take a power on the next screen.

**Advanced Respec** is a browser setting (`advancedRespec`, localStorage `hcp.advancedRespec`),
not part of the build: the tray's "Respec: Normal / Advanced" button (phones: the menu pane)
switches it, and so does a second click on New Build's ticked Respec bar (a double-click switches
once). While it is on, New Build's Respec box crackles (`BulbSpark`, the slot screen's
`ElectricFlash` looping), and switching it on from the tray there ticks Respec. For a Respec build
it makes a click on a power (or a pool power) take it and move on, and swaps ask nothing.

**Placing enhancements.** The picker's "Max Slot/Build Level" is a browser setting too
(`enhAtCap`, `hcp.enhAtCap`): pieces go in at `capLevel` (the set's top, or the build's last level
plus `levelsAbove`, whichever is lower), and on reaching the overview from leveling (the end of
the walk or View Build) every crafted piece below its cap is raised to it (`raiseToCap`; none is
ever lowered). Its frames, tabs and level box follow the build's skin. Ctrl+Click (phones: Select several) chooses several pieces, up to the clicked slot
plus the power's empty slots; Place fills those slots left to right in the list's order, so no
piece already slotted elsewhere in the power is replaced. On a phone a long press on a piece ticks
Select several with that piece in (with a single slot to fill it just chooses the piece). A set's name shows the set's bonuses (`SetDetails`): beside the
pointer on the desktop (`useHover.setTip`, `SetTipLayer`; not while tooltips are Disabled), in a
long-press box on a phone (`PressTip` kind `set`, `PhoneSetTipLayer`, drawn inside the picker
because the picker covers the overview's own layer). The bonuses light up as the totals would count them (`setBonusLines` in
`engine/setbonus.ts`: distinct pieces that work at the level, the rule of five) for the power as it
is and as it would be once the chosen pieces are placed where Place puts them (`placements` in
`engine/placing.ts`, which Place itself uses): one it already earns glows green, one the chosen
pieces would newly earn is lighter and glows stronger, and one it would lose reads as not earned
(`BonusLines`). Phones also get the categories as one row that scrolls sideways
(`PhoneTabStrip`), the set names in a rounded box of their own (as tall as its list, up to 45% of
the list area), and details without the piece's icon and name.

**Slotted bonuses.** `powerInfo` marks each stat row and effect line that the power's own
enhancements change with their strength after ED (`InfoRow.bonus`, `InfoEffect.bonus`), set where
the row is written from the same strength. A damage line's is its own enhancement, never the
build's damage boosts; the Average Damage row's is read back from the damage (enhanced over base),
so it is lower than the lines' when part of the damage takes no enhancement (a pet's). The Advanced tooltip and the phone's long-press info print it at the right
end of its row, with no label (`AdvancedInfo`, `InfoBlocks`' `bonus`); a power with nothing slotted
has no such column, nor one whose enhancements change no number.

**Stage.** Every screen draws on a fixed stage scaled to the window with CSS zoom:

- Desktop is 2000x1125, for landscape windows at least 768px wide.
- Narrower or portrait windows (phones, upright tablets) get a one-panel-at-a-time phone layout.
  Its stage is 667 wide and shaped like the window, at least 1067 tall (`src/ui/stageLayout.ts`):
  1.5x the size of the original 1000-wide phone canvas, so the game's bars are about 33px on a
  phone. Phone screens lay out from
  `src/ui/components/Phone.tsx` (`phoneGeom`, `phonePanel`, `phoneDesc`, `PhoneTabs`). Tabs are
  always one row: up to three share it, more (the overview's four, the set finder's, New Build's)
  slide sideways as the enhancement picker's categories do (`PhoneTabStrip`), each tab as wide as
  three and a third fit, so the cut-off one shows there is more.
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
  Patron note links the wiki; its optional `wait` greys OK for that many seconds, counted down
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
  `phonepicker.spec.ts` (phone only) long presses a slotted power (its info shows the slotted
  bonuses), then in the enhancement picker reaches the last category in the scrolling row, long presses a
  set's name (its bonuses close without closing the picker) and a piece (ticks Select several).
  `combat.spec.ts` opens a link and turns on the totals' Out of Combat switch: the totals change,
  the link and the saved build don't, and a reload opens with it off.

  They find elements by `data-testid` (`testId` on `CheckBar`, `SlotRing`, `PhoneTabs`); the shared
  driver is `e2e/player.ts`. Run them after changing the screens or the level-up flow.
