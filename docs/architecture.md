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
    finderStats.ts           the set finder's build statistics (public/data/finder/): their shape,
                             checkFinderStats, loadFinderStats
    recipes.ts               a version's recipes (public/data/recipes/<version>.json): their shape,
                             checkRecipes, loadRecipes
  engine/                    pure TypeScript build rules (no React, no DOM)
    build.ts                 Build / Pick / Slot model, newBuild()
    rules.ts                 BuildRules: availability, picks, auto-granted powers, slots, issues
    requires.ts              the game's RPN requirement evaluator
    schedule.ts              pick / slot / pool / epic level schedules
    enhance.ts               enhancement values, ED, origin and set validity, set rarity, help text
    setbonus.ts, totals.ts   set bonuses (rule of 5) and the totals panel
    powerinfo.ts             detailed power numbers (base vs enhanced)
    finder/                  the set finder's engine (see "Set finder" below)
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
      powerNumbers.ts        a power's own numbers with a slotting (slottedNumbers)
      bonusVec.ts, eligible.ts   bonus lines kept per search; the sets each power takes
      labels.ts, view.ts     words (stat names, amounts, warnings) and lists for the screens (the
                             bonuses to ask for, set types, results grouped by set)
      shopping.ts            the shopping list: recipes, salvage and enhancements to get, and the
                             auction house search lines (shoppingList, auctionLines)
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
    shopping.ts              the set finder's shopping list as the browser keeps it (localStorage)
  state/store.ts             zustand store: data, current build, level-up flow, dialogs
  state/finder.ts            the set finder's store: statistics, search, results, kept swaps,
                             the shopping list
  state/finderOpen.ts        whether its pane is open (apart, so the engine loads on demand)
  ui/
    screens/                 Setup (New Build), ChooseNewPower, ChoosePoolSet,
                             AddEnhancementSlot, Overview, EnhancementPicker, BuildMenu,
                             SetFinder (the set finder's pane, loaded on demand) and
                             FinderShopping (its shopping list)
    components/              game chrome (frames, bars, rings, scrollbars, text, tooltips);
                             FinderIcon (the set finder's button icon and name)
    skin/                    metrics.ts (virtual-screen maths), skin.ts (hero/villain/praetorian)
    hover.ts                 hover / tooltip state (kept out of the screens on purpose)
    escape.ts                Escape-key stack (useEscape)
    sound.ts                 game UI sounds and menu music
tests/                       vitest; tests/helpers/data.ts loads public/data like the site does
  fixtures/builds/           forum builds (Mids data chunks, .mbd files) the browser tests recreate
e2e/                         Playwright browser tests (playwright.config.ts; local only;
                             playwright.built.config.ts runs them on a production build)
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
public/data/thunderspy/      Thunderspy's data: its own versions.json and version folders (no mids-map)
public/data/pets/<version>.json  each version's pseudo-pets, beside the version folders (generated;
                             Thunderspy's in public/data/thunderspy/pets/)
public/data/info/<version>.json  each version's power-info extras, beside them (generated;
                             Thunderspy's in public/data/thunderspy/info/)
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
  report-finder.md           the build research's report: what was read, how the Mids import held
                             up, and the statistics in tables (npm run research)
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
nothing and open on the default version; their layout follows the save version they carry (a
power's ProcInclude from 3.10, the inherent-slot fields only from 3.20: `mxdzToMbd`). `importTarget()` (`src/data/versions.ts`) then opens the
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

**Set finder (engine).** `src/engine/finder/` ranks *swaps* for a Homecoming build: pieces of one
enhancement set into slots one power already has. It never moves a slot or changes a power. Its
screens are described under "Set finder (screens)" below. The parts:

- **A search** (`FinderQuery`, `query.ts`): one to three goals with an importance each (Low 0.5,
  Medium 1, High 2, Critical 8), the kinds of sets to add to uncommon and rare ones (PvP,
  seasonal, purple, archetype), an optional wanted bonus (a totals line key) with a depth (2 to 3
  pieces, 4 to 6, anywhere), up to two additional bonuses, set categories, crafted or attuned.
- **Units** (`goals.ts`): everything is counted in "typical bonuses". A stat's unit is the size of
  one typical set bonus in it, from the build statistics (`public/data/finder/stats.json`) for the
  build's archetype, or for every build when the archetype has too few. A goal is a bundle of
  stats and of *power channels* (what a power's own slotting does for its role: `st.out`,
  `heal.rech`). A chosen goal counts by its importance; what the search did not name counts a
  little when gained (`BASELINE`) and in full when given up (`LOSS_WEIGHT`). The statistics only
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
  each is emptied (empty slots first; a proc is given a set worth, as the planner has no proc
  numbers), a set's legal pieces by what each does for the power (procs last), and every piece
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
  endurance cost, recharge time with the build's global recharge).

**Set finder (screens).** The pane is `src/ui/screens/SetFinder.tsx`, over the build overview
like the enhancement picker (the whole screen on phones, with Search / Results / Kept / List tabs).

- **Opening.** An icon button (the invention tutorial's badge, from the client's art) right of the
  overview's origin and archetype label, and a row in the phone menu, both for Homecoming builds
  only. They set `finderOpen.ts`'s flag; `App.tsx`
  (`FinderPane`) then downloads the pane and the finder's engine as their own chunk, so neither
  is in the page's first download. A failed download closes the pane with a notice, and the next
  opening tries again. The notice says to check the connection and, if that is not it, to reload
  the page: a page left open across a deploy asks for the old release's file, which is gone.
  Leaving the overview closes the pane (`App.tsx`), so it never comes back on its own.
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
  new list names by another key of the same kind is carried over to that key).
- **Lists.** The kept swaps come first, each with its box ticked (untick to let it go), then the
  results: each set shows its best placement, the others folded under it. A line says so when the
  form, or the kept swaps (a ranking given up or failed), have changed since the list was made.
  Pointing at a swap (tapping it, on a phone) shows its net gains and losses from `buildDiff`:
  what a result would change on top of the kept swaps, or what a kept swap is adding. The hovered
  row is in `hover.ts` (`swap`, desktop only), so only the gains and losses pane redraws; ticking
  a box clears it, as the row moves to the other list with no mouseleave. The search's progress
  redraws only its own label. With nothing pointed at, the pane shows the kept swaps together
  against the build as it is. Figures are written as the totals pane writes them (mph, ft, per
  second).
- **Applying.** "Apply to this build" asks first (`askConfirm`, naming how many enhancements are
  replaced), then `setBuild`; if the kept swaps changed while the question was up, nothing is
  applied and the note says so. "Open as new build" is a plain link to the share link the store
  wrote (`target="_blank"`, the player's own click, an address the code built), so the build in
  hand is left alone and no pop-up blocker is involved.
- **Phones** have no hover text, so a long press stands in for it (`pressText`, `hover.ts`): on a
  swap it lists the pieces by name, on a tick box it shows the hint, on a shopping ring the piece's
  name and what a tap does, on a set's bar what a tap does. The pane draws its own `PhoneTipLayer`
  for these; the overview's is under the pane and is not drawn once the pane is (`up` in
  `finderOpen.ts`). While the pane's code downloads the overview is still the screen in view, so
  it keeps its own.
- Another server's build gets a plain sentence instead of a search (`finderProblem`). Every
  Homecoming game version is searched with the one statistics file. It is keyed by internal names,
  and a search reads only each archetype's stat values and the needs of the archetype and its two
  power sets from it; which sets exist and what a power takes come from the build's own game data.
  So a build on an older patch, or on a patch newer than the last research run, is searched like
  any other. An archetype the statistics never saw gets the all-builds values, and a power set
  they never saw has no needs.
- **Shopping list** (`FinderShopping.tsx`; the "Shopping List" button on desktop, the List tab on
  phones). It shows what the browser keeps (`src/io/shopping.ts`: localStorage `hcp.shopping`, one
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

The numbers marked `UNCONFIRMED` in the finder's source are defaults waiting for the owner's
ruling.

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
  `setfinder.spec.ts` uses the set finder on an imported build: a search for one priority, the
  first swap looked at and kept, the shopping list (a set marked owned; auction house lines on the
  desktop only; the recipes must have loaded), "Open as new build" in a new tab, "Apply to this
  build", then the stored list cleared. The build must hold the pieces the row named, at the
  levels and in the slots it named. On the phone, long presses are real touches (`hold`, through
  the browser's own touch input): on the row it must name the pieces and select nothing, on a tick
  box show its hint and tick nothing, on the shopping bar and a ring show theirs and mark nothing;
  a finger that slides shows no tooltip. Anything the page's Content-Security-Policy refused, in
  either tab, fails the test (only a built site has the policy: `npm run e2e:built`). A second
  test holds back the pane's code and then refuses it: meanwhile the phone's overview still shows
  a long press's tooltip, then the notice shows, and the next opening works. A third opens a
  Thunderspy build: no finder button and no row in the phone menu.

  They find elements by `data-testid` (`testId` on `CheckBar`, `SlotRing`, `PhoneTabs`); the shared
  driver is `e2e/player.ts`. Run them after changing the screens, the level-up flow or the set
  finder.
- `npm run e2e:built` (`playwright.built.config.ts`) runs the same tests on a production build
  served by `vite preview`. The dev server has no Content-Security-Policy, serves every module
  as its own file and answers any address, so only this run exercises the policy, the pieces
  downloaded on demand (the set finder's pane) and each server's own page. Run it before a
  deploy that changes the policy, what is downloaded on demand, or where a file is fetched from.
  (The preview server still answers a missing file with the page, where GitHub Pages answers
  404, so that difference is not covered.)
