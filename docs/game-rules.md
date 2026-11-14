# Game rules the planner ports (from the engine source)

Source: `CityOfHeroes_OuroV2_Source` (the engine source checkout) (I24 engine; Homecoming data is
decoded from the live client). Paths below are relative to that root. All levels in data are
0-based (`Available[]`, schedules, `SpecializeAt`); the UI shows level + 1.

## Requirement expressions (BuyRequires, SetBuyRequires, SpecializeRequires)

Evaluator: `libs/UtilitiesLib/src/utils/eval.c` + `Common/entity/character_eval.c`
(`chareval_Eval`). Postfix (RPN) token arrays; the result is the top of the stack as an int.

- `@X` pushes the string X. `$X` pushes character property X (`$archetype` -> `Class_Blaster`,
  `$origin`, `$level` = level + 1, `$alignment` -> hero/vigilante/rogue/villain, `$type`).
- Any other token: int literal, float literal (only if it contains `.` and parses fully), else a
  string. Function names are case-insensitive.
- When an int is popped and the top is a string, the string is converted by "owns it?": a power
  full name -> owns that power; `Cat.Set` -> owns that powerset; unknown -> 0. So a bare
  `Pool.Flight.Fly` means "owns Fly", including as the final result.
- Operators: `&&` `||` `!` (logical), `>` `<` `>=` `<=` (numeric), `==` (case-insensitive string
  equality if both strings, else numeric), `eq` (string equality only), `+ - * / %`, `pow`,
  `negate`, `minmax`, `dup`, `drop`.
- Functions used by player data: `powerset?` (owns set), `ownPower?`, `owned?`/`Owned?`
  (badge -> false, except the Patron accolades: see "Patron Power Pools" below),
  `auth>` / `ProductOwned?` / `isVIP?` (account -> false),
  `char>`/`auto>` (property), `PowerBoostsSlotted>` (set-bonus requires), `level`.
- Popping an empty stack yields 0 (so `['!']` is true). `['0']` is false (never buyable).
- Unknown/runtime tokens (modes, tags, events, map state) evaluate as 0 in a planner.

## Picking powers

- Picks per level: `schedules.Power` (24 entries, 0-based levels). Free powers don't count.
- A power is pickable at level L when: picks used < picks allowed at L, `Available[i] <= L`,
  `BuyRequires` passes, not already owned, and (for specialization sets) the specialize gate
  passes. Level-up UI (`Game/src/UI/uiLevelPower.c` `drawPowerSet`) shows unpickable powers
  greyed.
- Level 1: exactly one primary and one secondary power with `Available == 0`. The UI locks the
  secondary column for the first pick and the primary column for the second.
- New sets: primary/secondary are fixed at creation. A pool set may be added when owned pool
  sets < count of `schedules.PoolPowerSet` entries <= L (max 4). An epic set when owned epic sets
  < count of `schedules.EpicPowerSet` entries <= L. Set allowed when `SetBuyRequires` passes and
  at least one of its powers passes Available + BuyRequires. Epic AT gating is via each power's
  `BuyRequires` (`$archetype`).
- Patron Power Pools (Leviathan, Mace, Mu and Soul Mastery) are epic sets like the others: one
  epic or Patron pool per build. Each pool's first two powers also ask for one of the Patron arcs'
  accolades (`SpidersKissPatron`, `TheStingerPatron`, `BloodInTheWaterPatron`, `MiragePatron`
  `Owned?`, or the beta server's `Beta_AutoLevel50`); any one opens all four pools, and the
  character keeps them after changing alignment. A plan takes the accolade as earned
  (`PLANNED_BADGES` in `src/engine/rules.ts`), so the pools are offered at level 35; every other
  badge counts as not earned. Arachnos Soldiers and Widows have no other epic pools. Patron arcs
  are villain content, so a Hero build choosing a Patron pool is told (once a visit to Choose an
  Epic Power Set) that the character has to switch to villain in game for the arc; the pools stay
  unlocked after switching back (`patronArcNote`; `isPatronSet` finds the pools from that
  accolade check).
- Specialization sets (`SpecializeAt != 0`, VEAT branches): offered alongside the trunk once
  `L >= SpecializeAt` and `SpecializeRequires` passes; only for sets in the class primary or
  secondary category. Branches exclude each other through their requires, so the first branch
  power taken chooses the path. `L` is the character's level, never the pick's
  (`character_IsAllowedToSpecializeInPowerSet`): the level-up screen passes the current level and
  a respec its pre-respec level (`uiReSpec.c` `respec.maxLevel`, `character_respec.c`
  `iExpLevel`). So a leveling build opens the branches at 24, while a Respec build at 24 or above
  may take branch powers from its first pick (`BuildRules.specLevel`); the branch powers keep their
  own levels. At level 1 the first two picks lock a column (category), so a branch in it may take
  that pick as its trunk may.

## Auto-issued powers

- Everything in the `Inherent` category is Free + AutoIssue. `Inherent.Inherent` and
  `Inherent.Fitness` are owned by every character.
- After every pick/slot: grant every power in an owned set with `AutoIssue`, `Available <= L`,
  not owned, and `BuyRequires` passing. Repeat to a fixpoint.
- `Available == -1`: granted when its set is added (if requires pass) and always passes the
  level test (e.g. `Pool.Flight.Fly_Boost` "Afterburner" with `BuyRequires Pool.Flight.Fly`).
- Level bought: `AutoIssueSaveLevel` -> level actually granted; otherwise `Available` (may be -1).
- AT inherents (Defiance, Fury, ...) are ordinary Inherent powers gated by `$archetype`.

## Enhancement slots

- Free slots on a power: `CountForLevel(charLevel - levelBought, FreeBoostSlotsOnPower)` (one free
  slot at the level bought), capped by `MaxBoosts` (default 6, includes the free slot). Powers
  without `BoostsAllowed` get no slots.
- Assignable slots: `schedules.AssignableBoost` (67 entries). A slot placed at level L must go on a
  power owned at L (`levelBought <= L`).
- Per power: at most 5 bought slots (`MAX_BOOSTS_BOUGHT`), and total <= `MaxBoosts`. No per-level
  cap: all slots granted at a level may go on one power. The UI says "Full" otherwise.
- `MinSlotLevel`/`MaxSlotLevel` are on the enhancement (Boost) power: the character-level range
  in which that enhancement may be slotted.

## Which piece may go where

- A power holds one of each set piece, whichever version (crafted, attuned, superior): a second
  piece from the same list goes in place of the first (`power_ValidBoostSlotRequired`, boost.c).
- A piece's `SlotRequires` is tested as it goes in (`power_BoostCheckRequires`, powers.c). In the
  live data it holds:
  - unique pieces: `Name BoostsSlotted> 0 <=` for the piece and its other versions.
    `BoostsSlotted>` counts every power of the character (`chareval_EntityBoostsSlotted`,
    character_eval.c). So very rare, archetype origin and winter pieces, Steadfast Protection B,
    Kismet E and the travel sets' stealth pieces (one group) go in once per build.
  - archetype origin pieces: `arch char> Class_X eq`.
  - very rare and superior pieces: `level char> 50 ==` (the character level, `iLevel + 1`; the
    planner tests the build's last level).
  - the developers' Omni Talisman: `accesslevel char> 9 >=` (players have access level 0).
  - `PowerBoostsSlotted>` counts in the power only (`power_sloteval_powerBoostsSlotted`); set bonus
    requirements use it.
- The power must take the piece at all: its origin (TO/DO/SO, HO-style pieces name their origins)
  and one of its enhancement types in the power's `BoostsAllowed`, and a set piece's set must list
  the power (`power_IsValidBoost`, boost.c).
- The piece must work at the character's level as it goes in (`boost_IsValidToSlotAtLevel`):
  `MinSlotLevel <= level <= MaxSlotLevel` and `boost_Effectiveness > 0`. An IO works from 3 levels
  below its own (the `BoostEffectivenessAbove` table has 4 entries, +0..+3); an attuned piece from
  its `MinSlotLevel`. The planner tests the build's last level (its stop level, else 50), and the
  picker offers IO levels up to that level + 3.
- An enhancement's own settings:
  - Enhancement Boosters go on `BoostBoostable` pieces only (crafted set pieces and common IOs, not
    procs, attuned or superior pieces), at most 5 (`boost_IsBoostable`: the
    `BoostEffectivenessBoosters` table has 6 entries).
  - TO/DO/SO-style pieces (`BoostCombinable`) are combined to raise their level. The Ouroboros
    source allows 2 combines (`BOOST_MAX_COMBINES`, boost.h). Homecoming's client refuses only a
    4th (`boost_IsValidCombination` compares `iNumCombines` with 3), so a level-50 SO reaches
    50+3. With the effectiveness tables (+3 above, -3 below) the relative level runs -3..+3.
  - An IO is made at its set's levels (a common IO from 10 to 50).
- The planner flags a piece that breaks any of these with the reason, and the picker leaves such
  pieces out. A value that isn't a whole number can't come from the app or an import, so
  `checkBuild` drops it.

## Starting sets (New Build)

- A primary or secondary is offered when its `SetRequires` and `SetBuyRequires` pass for a new
  character of the archetype at level 1, it has powers, and it is not a VEAT branch
  (`SpecializeAt`). The live data gives Wind Control (Controller and Dominator) `SetRequires 0`,
  so the game hides it, and so does New Build.

## Set bonuses

- A set's count in a power is its distinct pieces there that work at the combat level
  (`boost_Effectiveness > 0`) or always count (`BoostAlwaysCountForSet`, attuned pieces)
  (`boostset_FindBonuses`, boostset.c). A crafted and an attuned copy of one piece count once.
- A bonus applies while the count is within its `MinBoosts..MaxBoosts` and its requirement holds.
  `isPVPMap?` is false, so PvP-only bonuses never apply.
- Set bonuses start at two pieces. A unique piece's global effect (Luck of the Gambler's +7.5%
  recharge, the archetype origin procs) is stored as a bonus with `MinBoosts 1`, gated on that
  piece being in the power (`PowerBoostsSlotted>`). It applies like the others, rule of 5
  included, but it is the piece's own effect and not a set bonus. The game's enhancement info
  lists only the two-piece-and-up bonuses, and the totals panel shows the global in its stat under
  the piece's name, never as a "(1)" in Set Bonuses (`isPieceGlobal`, setbonus.ts).

## Current values (totals)

- Speeds, jump height, perception, regeneration and recovery: the class base times the summed
  mods, `attrCur = base x attrMod` with `attrMod` starting at 1 (`CalcCur`, character_attribs.c).
  Fly at 50 with Swift: 1.5 x (1 + 1.609 + 0.137) = 4.118.
- `attrMax` is the class maximum plus every Maximum-aspect mod (Super Speed +1.938 run, Fly +2.0475
  fly, Long Jump +1.65 jump), held under the class `MaxMax` (`ClampMax`). The current value is held
  under `attrMax` (`ClampCur`), both in character_mods.c. So a Blaster's regeneration (base 0.25,
  maximum 5) stops at +1900%, not at 5x.
- A slotted piece's own effects (its templates not flagged `BoostTemplate`) land on the character
  each time the power holding it applies, while the piece works at the character's real level
  (`boost_Effectiveness > 0` at `character_CalcExperienceLevel`, so exemplaring below the piece
  does not switch it off): `character_AccrueBoosts` (character_mods.c) sets `bBonusAttributes`,
  and `character_ApplyPower` (character_combat.c) attaches them. The Homecoming wiki calls these
  "Proc120s" and agrees: on in an auto or a running toggle, 120 s after a click, still working
  when exemplared below their level. So Miracle's
  +15% recovery, Numina's +20% regeneration / +10% recovery, Regenerative Tissue's and Impervious
  Skin's +25% regeneration, Kismet's +6% ToHit, Thrust's run speed, Launch's jump height, Warp's
  perception and the travel sets' stealth count while their power runs (an auto, a toggle that is
  on, or a click switched on in the totals). Their mods stack by replacement, so one piece in two
  running powers counts once. Chance and PPM procs are left out, and a "Null" mod only carries a
  number for help text (Luck of the Gambler's recharge comes from its set's global bonus).

## Grants (Kheldian forms etc.)

`kGrantPower`/`kGrantBoostedPower`/`kExecutePower` attribmods carry power names in their
`Params` (decoded by the pipeline into `pw` id lists). Granted powers go through the same
Available/BuyRequires checks; Temporary_Powers get `MaxBoosts = 0`.

## Respec order

Homecoming's live respec, checked in game (November 2026), differs from the I24 code in
`Game/src/UI/uiReSpec.c` and `MapServer/src/entity/character_respec.c`; the planner follows the
live game:

- Powers first, one "Choose a new power" screen per pick, in level order, with the usual
  availability rules (`respec_powerLevel`). At level 1 the **secondary** power comes first (the
  primary column is locked), then the primary: the I24 code did that only for VEATs
  (`pickingPrimary`) and otherwise auto-bought the first secondary power. A "Powers Bought /
  Powers Remaining" counter and Back / Next; Back removes the last pick.
- Then **one** "Choose All Enhancement Slots:" screen with every slot up to the respec level
  ("Slots Available: 67" at 50) and every power selectable: slots are free-for-all, any power can
  take any of them (Next unlocks when all are placed). I24 instead stepped through the slot
  levels (`respec_slotAdvanceLevel`), greyed out powers bought after each level
  (`iLevelBought <= iLevel`), and its server refused such slots (`respec_VerifyBoosts`).
  MidsReborn's Respec mode also still gives each slot the first free level at or after its
  power's level (`Character.SlotCheck`).
- "Current Respec Level: N" shows the character level as the game holds it, 0-based: 0 at the
  first pick, 49 on the slot screen of a level 50 respec. On the power screens it is drawn at
  (450, 30) scaled; on the slot screen at screen pixel (1000, 30) unscaled (tiny at 4K).
- Then the game places the character's existing enhancements (`respec_placement`); the planner
  goes to the build overview instead.
- The respec runs up to the character's level (`maxRespecLevel`); the planner asks for that
  level on New Build (50 by default). In the planner a respec's slots carry levels only for
  bookkeeping (each takes the lowest free slot level at or after its power's level); the "slot
  below the power level" check skips them. Reopening a slot level from the overview shows the
  slots booked at that level, and they may move to any power.

## Slot levels are not stored

The game keeps no level for an enhancement slot. `character_BuyBoostSlot`
(`Common/entity/character_base.c`) only counts the slot (`iNumBoostsBought`) and appends an empty
one. The database (`MapServer/src/container/containerloadsave.c`) keeps that count in the Powers
table (`NumBoostsBought`) and one Boosts row per slotted enhancement (`boost_line_desc`: its power,
slot index, level and combines); neither says when a slot was added. Nothing records whether the
current build came from a respec either (`RespecTokens` is the set of respec tokens earned). The
planner's slot levels are its own bookkeeping.

So a build read from the game (Homecoming's `/build_save` file, `src/io/buildtxt.ts`) can only be
told apart one way: `leveledSlotShortfall()` (`src/engine/schedule.ts`) checks from the top level
down that the added slots on powers taken at each level or later fit in the slot schedule from
that level on. A build that fails was made through a respec (a power taken at 49 with 6 slots
needs 5, and leveling gives 3 after 49); one that passes may have been either.
