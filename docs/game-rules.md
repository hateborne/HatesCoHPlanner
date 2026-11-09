# Game rules the planner ports (from the engine source)

Source: `<COH_SOURCE>\CityOfHeroes_OuroV2_Source` (I24 engine; Homecoming data is
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
  (badge -> treat false), `auth>` / `ProductOwned?` / `isVIP?` (account -> false),
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
- Specialization sets (`SpecializeAt != 0`, VEAT branches): offered alongside the trunk once
  `L >= SpecializeAt` and `SpecializeRequires` passes; only for sets in the class primary or
  secondary category. Branches exclude each other through their requires.

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

## Grants (Kheldian forms etc.)

`kGrantPower`/`kGrantBoostedPower`/`kExecutePower` attribmods carry power names in their
`Params` (decoded by the pipeline into `pw` id lists). Granted powers go through the same
Available/BuyRequires checks; Temporary_Powers get `MaxBoosts = 0`.
