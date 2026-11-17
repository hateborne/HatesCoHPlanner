# Game rules the planner ports (from the engine source)

Source: `CityOfHeroes_OuroV2_Source` (the engine source checkout) (I24 engine; Homecoming data is
decoded from the live client). Paths below are relative to that root. All levels in data are
0-based (`Available[]`, schedules, `SpecializeAt`); the UI shows level + 1.

Thunderspy's data is decoded from its own client the same way, and the same rules apply to it
wherever its data doesn't decide them, except where its client's code is known to differ (see
"Thunderspy's client" below). @TODO check the rules taken from Homecoming's live client (one-screen
respec, three combines, the epic level gates) against Thunderspy's game.

## Thunderspy's client (Thunderspy.exe, compared with Homecoming's client)

Read from the two clients' compiled code (Ghidra, functions found from the boost table globals the
`defs/boost_effect_*.def` loaders fill). Homecoming's client matches the source for all of these.

- `boost_EffectivenessLevel` / `boost_Effectiveness`: the same in both. A TO/DO/SO-style piece
  works while its level is within the `BoostEffectivenessAbove` / `Below` tables' length of the
  character's, at the table's value. Thunderspy's tables are 50 entries of 1.0, so its TO/DO/SO
  pieces work at any level at full strength (Homecoming's: 3 levels either way, +5% a level above,
  -10% a level below).
- `power_MinBoostUseLevel` for `BoostIgnoreEffectiveness` pieces (IOs, set pieces) differs.
  Homecoming (and the source) take `MAX(MinSlotLevel, level - (above table length - 1))`, so an IO
  works from 3 levels below its own. Thunderspy's takes `MAX(MinSlotLevel, level)`: an IO works only
  at or above its own level. The planner takes this from the server entry (`ioLevelsAbove: 0` in
  `src/data/servers.ts`, read by `levelsAbove` in `src/engine/enhance.ts`).
- `power_MaxBoostUseLevel`: the same in both (`MaxSlotLevel` for IOs; for TO/DO/SO-style pieces
  `MIN(MaxSlotLevel, level) + below table length - 1`).
- Attribute names: Thunderspy's client calls Knock (offset 328) "Knockback", Homecoming's alias for
  it. The planner reads it as Knock (`ATTRIB_CANON` in `src/data/gamedata.ts`), so knockback
  protection counts.
- The power info's tag modes (getChanceModString, getChanceModValue) differ, and here Thunderspy's
  client is the one nearer the source: it reads a group's own first tag (0x1404d1f90, 0x1404d2720).
  Homecoming's also reads the group's parents' first tags and knows ASTeamCrit (0x1404de5c0,
  0x1404de9f0). The planner takes this from the server entry (`tagModes: 'ownTag'`); see "Tag modes
  (power info)" below.
- The power info's requirement check (requiresArchetypePvPEval) is the same in both, but
  Thunderspy's client reads an effect's own group's requirements only, for the check and the notes,
  Homecoming's every group above it too (`infoRequires: 'ownGroup'`); see "Requirements in the
  power info" below.
- @TODO not yet compared: Enhancement Diversification (`AggregateStrength`), attribute caps
  (`ClampMax`), combat level scaling (`combatmod_Get`) and the combine limit
  (`boost_IsValidCombination`). They have no strings or table globals of their own to find them
  by in a stripped client.

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
  `iExpLevel`). So a Respec build at 24 or above may take branch powers from its first pick
  (`BuildRules.specLevel`); the branch powers keep their own levels. At level 1 the first two
  picks lock a column (category), so a branch in it may take that pick as its trunk may.
- The level-up screen lists a branch only while the character owns a power from it or may still
  specialize in it (`uiLevelPower.c`, `character_WillBeAllowedToSpecializeInPowerSet`: the
  requires, not the level). Before 24 both branches show, greyed; once one is chosen the other is
  gone (`BuildRules.setOptions`).
- Forced respec on training (`LevelUpRespecs` on the class; Arachnos Soldier and Widow: 24):
  training to that level offers only "Respec and train up to next level"
  (`contactInteraction.c`, `class_IsRespecLevelUp` gives `TrainRespecNow` instead of `TrainNow`),
  and the respec runs to the new level (`uiReSpec.c`: `respec.maxLevel` is the level plus one),
  so the branches are open from its first pick. The planner therefore plans those archetypes as
  Respec builds only, to 24 at least (`startBuild`): New Build shows Respec ticked and Leveling
  greyed for them, and says why (`respecOnlyNote`) when Leveling was the choice; the /build_save
  import doesn't offer Leveling for them. A leveling build of one (a link or saved build from before
  that, or a Mids import) that holds a power picked at 24 or later has chosen its powers and slots
  up to 24 again in game, so it is judged as respecced there (`BuildRules.respecLevel`). One that
  stops before 24, and a leveling walk that hasn't got to 24 yet, keeps the branches shut. The
  export leaves `LevelUpRespecs` out; the planner takes it to be the level the specialization sets
  open at (`levelUpRespec`), and the pipeline warns if a client breaks that
  (`forced_respec_warnings`, `pipeline/forced_respec.py`).

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
  picker offers IO levels up to that level + 3. On Thunderspy an IO works only from its own level,
  so the picker offers none above the character's (see "Thunderspy's client").
- An enhancement's own settings:
  - Enhancement Boosters go on `BoostBoostable` pieces only (crafted set pieces and common IOs, not
    procs, attuned or superior pieces), at most 5 (`boost_IsBoostable`: the
    `BoostEffectivenessBoosters` table has 6 entries).
  - TO/DO/SO-style pieces (`BoostCombinable`) are combined to raise their level. The Ouroboros
    source allows 2 combines (`BOOST_MAX_COMBINES`, boost.h). Homecoming's client refuses only a
    4th (`boost_IsValidCombination` compares `iNumCombines` with 3), so a level-50 SO reaches
    50+3. With the effectiveness tables (+3 above, -3 below) the picker offers -3..+3. A piece the
    character has outleveled by 4 or more stays slotted in the game and gives nothing
    (effectiveness 0, its level drawn red); a `/build_save` can hold one, so it isn't flagged.
    Share links keep a relative level in one byte offset by 8, so one lower than -8 is kept at -8
    (`MIN_REL_LEVEL`), which gives nothing the same way.
  - An IO is made at its set's levels (a common IO from 10 to 50). The five Going Rogue pre-order
    pieces (Might of the Empire, Clockwork Efficiency, Resistance Tactics, Syndicate Techniques,
    Will of the Seers) are IOs that are handed out, not crafted: `/build_save` lists them at level
    1 and Homecoming's client hides their level (`BoostHideLevel`). So they have no level to
    choose, a new one is level 1, and it works from level 1 (`MinSlotLevel` 0).
- The planner flags a piece that breaks any of these with the reason, and the picker leaves such
  pieces out. A value that isn't a whole number can't come from the app or an import, so
  `checkBuild` drops it.

## Starting sets (New Build)

- A primary and a secondary may forbid each other through their powers' `BuyRequires`. On
  Homecoming, Shield Defense can't go with Claws, Dual Blades, Katana (Ninja Blade), Spines,
  Staff Fighting or Titan Weapons (Brutes, Scrappers, Stalkers and Tankers): with both owned,
  neither set has a level-1 power to buy. Issue 28, Page 3 also keeps Claws from Stone Armor
  (Brutes and Tankers); Page 4 dropped that. These are the only pairs either version forbids.
  The character creator buys the set chosen in one list before it lists the other, and greys every
  set the character could then not have, with "This power set is unavailable due to the selection
  of an incompatible power set." (`initPowerSetSelector` in `Game/src/UI/Hybrid/uiPower.c`, through
  `character_IsAllowedToHavePowerSetHypothetically` in `Common/entity/character_base.c`: the
  set's `SetBuyRequires` fails, or none of its powers available at the character's level passes
  its `BuyRequires`). Only the listed set's own
  requirements count, so a pair whose powers forbid each other one way only is greyed in one list
  only. Clicking a greyed set in the game chooses none, so it greys nothing in the other list.
  New Build greys the same sets, naming the set in the way (`setFitsWith` and `startingLocks` in
  `src/engine/rules.ts`, reading requirements as the level-up screens do, origin and alignment
  included); a greyed set takes no click, and a chosen set that is greyed (an older build's pair,
  or a one-way clash) greys nothing in the other list (when both clash, the secondary is the one
  greyed). Finish needs a pair where each set fits with the other (`setsGoTogether`), so level 1's
  two picks can always be made. Unlike the game's test, the planner's skips auto-issued powers, as
  level 1's picks can't take them (no Homecoming pair differs). A build that already holds such a
  pair (a link, a saved build, an import) still opens as it is, its level-1 picks flagged. Each time
  it opens (a reload too) an "Invalid power sets" message names the clash, its OK greyed and
  counting down from 5 (`warnInvalidPair` in `src/state/store.ts`; any dialog asked for meanwhile
  waits for it to close), and its overview title alternates with INVALID POWER SETS in red. Only a
  clash counts (`pairProblem`): a set that can't start a build on its own (a staff-only set, hidden
  by its powers' `BuyRequires`; no Homecoming set) fits with nothing, and gets no warning.
- A primary or secondary is offered when its `SetRequires` and `SetBuyRequires` pass for a new
  character of the archetype at level 1, it has powers, and it is not a VEAT branch
  (`SpecializeAt`). The live data gives Wind Control (Controller and Dominator) `SetRequires 0`,
  so the game hides it, and so does New Build.
- It also needs a level-1 power whose `BuyRequires` a player passes. Thunderspy's client has no
  `SetRequires`; its staff-only sets (Organic Armor) ask `accesslevel char> 0 >` of their powers
  instead, so no player can take them and New Build leaves them out. On Homecoming this changes no
  list.
- Thunderspy's data (ts9-6) forbids other pairs than Homecoming's: Shield Defense with Claws,
  Dual Blades, Katana, Staff Fighting or Titan Weapons for Scrappers and Brutes (Spines is
  allowed), and with Dual Blades, Staff Fighting, Titan Weapons or Pale Blade for Tankers (Pale
  Blade's Lash forbids it, and Fetid Presence needs Lash). Brute Claws and Stone Armor clash one
  way only: Claws' level-1 powers forbid Stone Armor, but Stone Armor keeps Stone Skin with
  Claws, so New Build greys Claws once Stone Armor is chosen and not the reverse; Finish stays
  locked for the pair all the same (`setsGoTogether`).

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

## Pseudo-pet damage (power info)

Powers such as Burn, Irradiated Ground, Rain of Fire and Lightning Rod deal their damage through a
pet their `EntCreate` mod (attribute 469) makes. The client's power info adds that pet's damage to
the power's "Average Damage" and the rows made from it (getTotalDamage), and lists the pet's effects
before the power's own (power_AddEffects' pet pass, power_AddPetEffects). The live clients do both
differently from the OuroV2 source's uiPowerInfo.c, so this follows their compiled code (Ghidra:
Homecoming i28p4's getTotalDamage at 0x1404e0ab0, power_AddEffects at 0x1404e37e0 and its pet pass
at 0x1404e5890; i28p3's the same; Thunderspy 9.6's getTotalDamage at 0x1404d6070 and
power_AddEffects at 0x1404da680). Each client exe read is listed in `pet_checked`
(`pipeline/config.py`); an export from another warns.

Which pets, and how they run:

- The mod's `Params` (param type 3) name the pet: a villain def (`EntityDef`) and/or a `Power`
  list. The struct's layout is the client's own (Homecoming's has a `CostumeEffect` word
  Thunderspy's lacks). Its powers are the def's `Power` refs, last first (`*` takes a whole set in
  order; a category, set or power the client lacks is skipped), then the mod's list, last first.
- The pet counts only when every one of those powers is Auto (`pet_IsAutoOnly`). Other pets (real
  pets: henchmen, Fire Imps) are left out here. The client lists them in a section of their own
  (`power_AddPets`), not ported.
- Its class: the caster's when the mod has `PseudoPet` (Burn on Homecoming), else the mod's
  `Class`, else the villain def's `Class` from `villain_classes.bin` (Irradiated Ground:
  `Class_Minion_Pets`). Its powers read their tables from that class, and `arch source.owner>` /
  `source.creator>` in their requirements read the caster's class.
- The client's template list holds a power's `Effect` groups, then its `ActivationEffect` groups,
  each group's sub-groups before its own mods. So activation effects count.

Its damage (getTotalDamage):

- Each pet power counts its own total (the same function, recursively) times
  `max(1, floor(mod Duration / its ActivatePeriod))`, or once when its period is 0. Thunderspy's
  client adds one: `max(1, floor(...) + 1)`. The division is single precision.
- A pet power's templates count by the client's rules: a DoT (its template's own Duration field is
  not 0) at its tick chance alone, anything else at its own group's chance alone (not its parents',
  not its tick chance), and HideFromInfo and PPM groups count too. So a hit in a group of chance 0
  adds nothing (Burn's Fiery Embrace groups), but a DoT there counts at its tick chance. The
  character's own powers count by the same rules (the same function, 0x1404e0ab0), apart from their
  HideFromInfo and PPM groups, which the planner leaves out (the owner's decision, November 17,
  2026; @TODO the client counts them: 43 Homecoming powers, Siren's Song, Frozen Aura, Laser Beam
  Eyes and others). Confirmed in game (the owner's screenshots, November 17, 2026, level 50):
  Executioner's Shot 337.18 (129.69 plus four Opportunity crits of tick chance 0 at their group's
  1), Thunder Strike 331.45 (its team-crit sub-groups whole, their 0.07 parent aside).
- Its enhanced damage takes the caster's enhancement strengths only with `CopyBoosts`; without it,
  the enhanced figure is the base.

What a power executes (getTotalDamage's ExecutePower branch, both clients), for the character's own
powers and pets' alike:

- Each power an `ExecutePower` mod names adds its own total, run by the same class, with its
  enhanced damage only when the mod has `CopyBoosts`. Every executing mod counts, whatever its
  group's chance, requirements or flags: the client reads the whole template list here. So Brawl
  adds the Plasmatic Taser and Friendly Fireworks it executes, Haymaker adds Unleash Might's Smash,
  and Storm Cell's pet adds a full lightning strike (both of its 0.5 energy groups) each second of
  its 60. Confirmed in game (the owner's screenshots, November 16, 2026): a level 50 Blaster's
  Brawl reads 122.83 (20.02 + the Taser's 102.81) and Storm Cell 3753.79 (60 x 2 x 31.28), with
  the rows made from them.
- The export drops PvP-only groups, so the executions they hold come from the pets file (`exec`,
  Exporter._pvp_executions): Whirling Axe and Victory Rush today, both executing powers without
  damage.
- Executions nest at most four deep (a counter the client checks before each).
- @TODO the client also lists an executed power's own effect lines (Storm Cell's "31.28 energy
  damage on target"); the planner doesn't yet.
- What a pet's powers execute goes in the pets file too (the pet runs it).

Its effect lines (the pet pass, then power_AddEffects for each pet power):

- Homecoming's client lists nothing of a pet whose `EntCreate` mod sits under a HideFromInfo group
  (its damage counts); Thunderspy's lists it (`pet_skip_hidden` in `pipeline/config.py`; the pets
  file marks such a pet `hid` only for a client that skips it).
- A pet's grant names its power; one the version's own data lacks has its display name in the
  pets file (`names`).
- A pet power's lines show enhanced values whenever the power's do for the villain def's powers,
  and only with `CopyBoosts` for the mod's own `Power` list.
- What the pet does to itself (target Caster) isn't listed.
- Its damage ticks for the pet's lifetime: `floor(Duration / its ActivatePeriod) + 1` ticks (both
  clients; this is not the total's count). An effect that doesn't suppress itself lasts the
  lifetime when it ticks, else as many of its own durations as fit in the lifetime plus one; every
  pet effect with a duration says how long.
- Its chance reads as its group's when its template's own Duration field is 0 (a duration taken
  from a table doesn't count: both clients read the field, Homecoming's at template offset 0x2c,
  Thunderspy's at 0x30), else its tick chance unless it `CancelOnMiss`.
- A group with a tag mode (Burn's Fiery Embrace groups, of chance 0) is listed as for the
  character's own powers ("Tag modes (power info)" below).

The pipeline writes each version's pets to `<server data>/pets/<version>.json`, beside the version
folders (Exporter.build_pets, `python -m pipeline.pets` for a version already published); the
engine parts are `petDamage` and `petLines` in `src/engine/powerinfo.ts`. Level 50 Brute: Burn
130.13 (12 ticks of 0.14 plus the 1.44 front hit at Melee_Damage 41.7087; its lines show 13 ticks),
Irradiated Ground 4.59 (one tick of 0.0825 at Class_Minion_Pets' 55.6599).

## Tag modes (power info)

The live clients' power info (power_AddEffects, with getChanceModString and getChanceModValue:
Homecoming i28p4 0x1404de5c0 and 0x1404de9f0, i28p3 the same; Thunderspy 0x1404d1f90 and
0x1404d2720) treats some tagged effect groups apart, for the character's own powers and pets alike
(`tagMode` in `src/engine/powerinfo.ts`):

- Only a group with tags has a mode. Its first tag picks one by substring, in any case, in the
  client's order: Lethal, LethalKB10/25/50/70, HailofBulletsKnockdown, HailofBulletsEndKnockback
  ("Only using Standard Ammo"); FireDamage, FireDamageDoT, HailofBulletsFire ("Only using Incendiary
  Ammo"); ColdDamage, HailofBulletsCold ("Only using Cryo Ammo"); ToxicDamage, HailofBulletsToxic
  ("Only using Chemical Ammo"); FieryEmbrace ("Only using Fiery Embrace"); and, on Homecoming only,
  ASTeamCrit ("Chance increases the more allies are nearby"). The notes are the client's messages.
- Homecoming's client then tries each parent group's first tag in turn, passing over parents
  without tags, so a Dual Pistols SentCrit group takes its ammo group's mode. Thunderspy's reads the
  group's own first tag only (`tagModes: 'ownTag'` in `src/data/servers.ts`).
- A group with a mode is listed whatever its chance (Fiery Embrace's and the ammo groups have chance
  0), the mode's note first among its notes. A tagged group with chance 0 and no mode isn't listed.
- It shows the mode's chance in place of its group's, found the same way from this table, tried in
  order: Lethal 1, FieryEmbrace 1, LethalKB10 0.1, LethalKB25 0.25, LethalKB50 0.5, LethalKB70 0.7,
  HailofBulletsKnockdown 0.05, HailofBulletsEndKnockback 0.4, FireDamage 1, FireDamageDoT 0.8,
  HailofBulletsFire 0.6, ColdDamage 1, HailofBulletsCold 0.6, ToxicDamage 1, HailofBulletsToxic
  0.6. So a LethalKB* tag reads 1 ("Lethal" comes first), FireDamageDoT reads 1, and ASTeamCrit,
  with no entry, reads 0 (Homecoming's Stalker crit lines say "0.00% chance").
- Its line reads that chance by the live client's rule, as every line does: the group's chance
  when the template's own Duration field is 0, else its tick chance unless it `CancelOnMiss` (Hail
  of Bullets' knockdown: 10%, its tick chance). Its parents' chances don't count.
- Damage totals keep each group's own chance: getTotalDamage reads no modes.
- The client walks its template list, where each group's sub-groups come before its own mods, so
  the lines do too (`templates`): Crushing Uppercut's knockup comes last, Executioner's Shot's
  defense debuff after its Standard Ammo hits.
- The client keeps the last mode's note in a variable it sets only for a tagged group and never
  clears within a power, so it repeats that note under the lines of untagged groups that follow
  (Thunder Strike's recovery, endurance, stun and knock read "Only using Fiery Embrace"). The planner
  doesn't copy this: the note would be false (the owner's decision, November 17, 2026).
- Confirmed in game (the owner's screenshots, November 17, 2026, level 50): Crushing Uppercut's
  "0.00% chance for 176.85 smashing damage", Executioner's Shot's "1.66 magnitude knock" with no
  chance, Hail of Bullets' 10%, 40% and 60% lines, Shadow Field's 5% and 20% holds (raw Duration
  rule), and Burn's three Fiery Embrace lines.
- Every line, the character's own and a pet's alike, reads its own group's chance by that rule (a
  parent group's never counts: Thunder Strike's team-crit lines show no "7.00% chance", as in game).
  A group with tags and chance 0 is left out unless it has a mode; a group without tags is listed
  at any chance (power_AddEffects, decompiled). A mod with a Duration field of its own reads its
  tick chance, not its group's: Homecoming's Blaster Charged Brawl (Electricity Manipulation) reads
  "-100.00% recovery rate for 2.00s on target", its group's 20% unshown.

## Requirements in the power info

The live client's power info doesn't run the game's requirement evaluator on an effect group. It
runs a cut-down check of its own, `requiresArchetypePvPEval` in the source's uiPowerInfo.c
(Homecoming i28p4 0x1404dfdd0, Thunderspy 9.6 0x1404d4cc0, decompiled, both as the source;
`infoRequires` in `src/engine/requires.ts`), for the lines (power_AddEffects) and the damage total
(getTotalDamage) alike. Homecoming's client checks the effect's group and every group above it (a
failing group hides its sub-groups) and writes notes from them all; Thunderspy's reads the effect's
own group only, for the check and the notes alike (getTotalDamage 0x1404d6070 builds its note string
from the group's own Requires; `infoRequires: 'ownGroup'` in `src/data/servers.ts`). So its Twilight
Shield and Quantum Shield list the effects under their "not in Nova form" parent group.

- It tells apart only the caster's archetype (`arch source>`), the creator's (`arch source.owner>`,
  `arch source.creator>`), a critter target from a player one (`enttype target>`, critter in PvE),
  and PvP maps (`isPVPMap?`, false in PvE).
- Everything else reads as true: values, comparisons, `source.ownPower?` (a `!` after it is
  skipped), `Source.Mode?`, `target.HasTag?`. So every Combo Level line and every "Only if hidden or
  target placated" line is listed (Crushing Uppercut and Thunder Strike, as in game, the owner's
  screenshots, November 17, 2026), and so are Bio Armor's adaptation variants.
- Its operators work on those 0/1 values, so `entref target> entref source> eq !` ("not on itself")
  reads false: such groups are neither listed nor counted (Liquid Nitrogen's pet).
- A group the check passes counts towards the damage total unless the client writes a requirement
  note for it (getRequiresString, `requiresNotes`). Each note looks for an exact run of tokens, as
  in the source. They don't match Homecoming's `kHitPoints%` and `kEndurance%` tokens, so Scourge
  and Charged Bolts' Zapping groups carry no note and count in full; nor Homecoming's own Containment
  groups, which open with `kTerrorized` where the note expects `kImmobilized ... kHeld ... || kSleep
  ... || kStunned ... ||`. Confirmed in game (the owner's checks, November 17, 2026, Homecoming,
  level 50): a Corruptor's Dark Blast 83.42 with two bare 41.71 lines, Blaster Charged Bolts 75.08,
  Liquid Nitrogen 423.02 (211.51 per activation), Brute Shadow Maul 97.88.
- Thunderspy's client adds one requirement note of its own, after the origin note (its
  getRequiresString, 0x1404d2f00, decompiled; `infoFriendNotes` in `src/data/servers.ts`): a
  requirement that names the target reads "Applies to enemies" when it holds `target.isFriend?!` or
  `enttypetarget>crittereq`, and "Applies to allies" otherwise, whatever else it tests. In game
  (the owner's screenshots, November 17, 2026, Thunderspy, level 50): Fire Blast's first hit
  "Applies to enemies"; Stygian Circle's heals, which test the target's rank, and Radiant Blast's
  Judgement heal "Applies to allies". Its power_AddEffects asks for the note and its getTotalDamage
  doesn't (a flag its two calls pass as 0 and 1), so the note never takes a hit out of the damage
  total (Fire Blast 84.72, in game).
- Thunderspy's power info doesn't test a group's PvE/PvP flags at all, so it lists PvP-only groups
  too (its Twilight Shield's second set of knock protections and 93.42% status resistances, in
  game). The export drops PvP-only groups, so the version's info file carries the groups of each
  power with one only its PVPOnly flag marks (`info_lists_pvp` in `pipeline/config.py`, `infoPvp:
  'listed'` in `src/data/servers.ts`): 7 Thunderspy powers, none with damage. A group requiring a
  player target is left out by the requirement check anyway.

## Power info wording

From the live clients' power_AddEffects and power_AddTargetInfo (Homecoming i28p4 0x1404e37e0 and
0x1404e26f0, Thunderspy 9.6 0x1404da680; decompiled), in `src/engine/powerinfo.ts`:

- A typed defense of aspect Current reads like a Strength one: "+9.75% strength to ranged defense"
  (Homecoming's Hail of Bullets, in game). Both clients do it.
- "All damage" and "all defense" (markAllTypes in the source; Homecoming 0x1404e1540 and
  Thunderspy 0x1404d6af0, which walk each effect's attribute list; `markAllTypes` in
  `src/engine/powerinfo.ts`). For each target, kind and aspect the client walks all the power's
  effects in order, hidden ones included: a damage type (offsets 0..79) or defense type (the 20
  typed defenses) of that aspect must carry the same Magnitude + Scale as the group's
  first, else the rest of that effect is passed over; each adds its type's bit, and whenever the mask
  holds exactly smashing, lethal, fire, cold, energy, negative energy, psionic and toxic (the first
  ten defense types) one more group counts and the value clears. On the lines, a group's first type
  reads "all damage" / "all defense" and the next seven (nine) of that kind, target and aspect are
  left out; after the last group every later one is. So Homecoming's Vulnerability lists "resistance
  to all damage" and none of its radiation, electrical, sonic or quantum resistance, and Evasive
  Maneuvers "+10.50% strength to all defense" without its toxic defense (both in game); a lone toxic
  defense (Invincibility) keeps its line, eight separate equal effects (Thunderspy's Piercing Beam)
  make one group, and a type outside the eight before the group is whole (Possess' healing) keeps
  every type apart. @TODO confirm in game: Homecoming's Stealth (Concealment) shows "+7.00% strength
  to all defense" but not its second, +1.75% effect, which the walk leaves out.
- The Effect Area row: Single Target, Cone, AoE (Sphere), Location, and "Chain -- 15.00 ft. jump
  distance" with its jump radius (Homecoming's Vulnerability, in game), each with "(N targets max)"
  when the power has a target cap. A Map power gets no row.
- From the version's info file (`public/data/info/<version>.json`, Exporter.build_info), when it
  has arrived:
  - each effect's own note (its Messages.DisplayInfo: "Within 20ft radius", "Main Target Only",
    "Opportunity", "Overpower", "Every 0.8 seconds for 10 seconds"), after the requirement notes and
    before "Ignores buffs and enhancements" and "unresistable" (the client's order); for a power the
    file gives notes, the planner's own "Overpower" from the tag gives way to them;
  - the attribute names as the client writes them, the message "Attr" + the field name (Homecoming's
    "knock", "defense debuff", "to hit"; Thunderspy's "knockback"), and the notes' own texts
    ("unresistable");
  - no "Grants power" line for a power the client keeps out of the inventory (ShowInInventory 0:
    Crushing Uppercut's Assassin's Focus, in game);
  - the "Aggro Type" row for AIReport 1 or 2 ("Enemies will not notice this attack", Vulnerability
    in game; Thunderspy's client reads "Enemies will not notice if this attack misses" for 2).
  Without the file the power info keeps the planner's own wording and grant lines.

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
