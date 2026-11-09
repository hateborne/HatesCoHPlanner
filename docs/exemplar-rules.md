# Exemplar rules (for sign-off before any code)

Source root: `<COH_SOURCE>\CityOfHeroes_OuroV2_Source` (I24 engine), abbreviated `SRC`.
Data: `<COH_SOURCE>\CityOfHeroes_OuroV2_Data\bin\serverdata\Defs\exemplar_handicaps.def` and the
live Homecoming values in `public\data\20261017-f94d0e09\core.json` ("exemplar", "boostEffect").
All levels below are 0-based (character level 1 = 0) unless written "level N". E = exemplar combat
level (0-based). X = the character's real/XP level (0-based; 49 for a level-50 build).

Everything below is proven by the I24 source unless tagged UNVERIFIED (not in I24 source).

## 0. The two levels (the key fact)

The engine carries two different levels and uses a DIFFERENT one in each rule:

- `Character::iCombatLevel` = E. Set by `character_CalcCombatLevel`
  (`SRC/Common/entity/character_level.c` ~660-700; the exemplar branch is in
  `SRC/MapServer/src/entity/buddy_server.c:60-135`: `else if(character_IsExemplar(p,0)) p->iCombatLevel = character_TeamLevel(p);`).
- `Character::iLevel` = real level X (`character_GetLevel`, character_level.c:47). Slot counts, bought levels use this.
- "iLevelEff" in `character_AccrueBoosts` = `character_CalcExperienceLevel(p)` (character_mods.c:363) = the
  XP level X, NOT the combat level. So enhancement strength is computed at X, then handicapped down to E.
- Set-bonus eligibility uses E (`boostset.c:136`: `int iEffLevel = c->iCombatLevel;`).

NOTE for the planner: `enhance.ts` / `totals.ts` / `setbonus.ts` currently pass a single `level` (= E) into
effectiveness, boostLevel, attuned lookup, slot filtering and bonus filtering. That conflates X and E and is wrong
for several rules below (see "Proposed planner behavior").

## 1. Which powers stay usable at E

`SRC/Common/entity/character_base.c:1663-1678`:

```c
bool character_AtLevelCanUsePower(Character *p, Power* ppow) {
    if( ppow->ppowBase->bIgnoreLevelBought ) return 1;
    if( ppow->psetParent && ... pcatParent &&
        (stricmp(pcatParent->pchName,"Temporary_Powers") != 0 || stricmp(psetBase->pchName,"Accolades") == 0)) {
        if (ppow->iLevelBought > MIN(p->iCombatLevel + EXEMPLAR_GRACE_LEVELS, p->iLevel)) return 0;
    }
    return 1;
}
```

- `EXEMPLAR_GRACE_LEVELS` = 5 (`SRC/Common/entity/buddy.h:51`).
- A power is UNUSABLE iff `iLevelBought > MIN(E + 5, X)`. Usable iff `iLevelBought <= E + 5` (X only matters if
  E+5 > X, i.e. never when exemplared below X-5; it is just a safety cap).
  Example: exemplar to level 20 (E=19) keeps every power bought at 0-based level <= 24 (level <= 25).
- `iLevelBought` is the level the power was picked (`character_base.c:1094`; or `BasePower::iForceLevelBought`
  when >= 0; set members use `psetBase->piAvailable[i]` for auto-issue, line 1105). In the planner this is the
  build entry's `level`.
- `bIgnoreLevelBought` (token `IgnoreLevelBought`, powers_load.c:2120) always usable. In decoded data this is
  `ilb` on the power: 42 `Redirects.*`, 7 `Pool.*` (e.g. `Pool.Speed.SpeedPhase`), Seismic Blast `Shockwaves`
  (4 ATs), and `Temporary_Powers.*.Street_Cred_Monitor`. `flb` (ForceLevelBought, 71 powers, all `Prestige.*`
  in current data) overrides the stored level bought.
- Temporary_Powers (except the Accolades set) are exempt from the check (first `if` fails -> returns 1).
- Auto-issued / inherent powers: the SAME check applies; they have no special exemption. Their `iLevelBought` is
  the grant level (`AutoIssueSaveLevel` else `Available`); free powers granted at level 1 have 0 and are always
  usable. Set-bonus auto powers are forced to `iLevelBought = 0` (boostset.c:100) and the activation gate skips
  category `Set_Bonus` (character_combat.c:4016), so bonus powers are never level-gated.
- Where it is enforced: activation gate `character_AllowedToActivatePower` (MapServer/.../character_combat.c:4016,
  message "PowerCannotUseLevel"), per-tick for running toggles/autos (`character_tick.c:1287`), tray grey-out
  (`Game/src/UI/uiTray.c:1021`). Pets: `character_pet.c:453,1093` use the same `+5` rule against the creator.
- I24 does NOT remove the power or its enhancements from the character; it only blocks activation. Powers that
  fail the check contribute no active effects (autos/toggles stop). Enhancement-strength accrual
  (`PowerStrength_Tick`, character_tick.c:1513-1535) still runs for every owned power regardless of the check.
- UNVERIFIED (not in I24 source): Homecoming's actual grace value (I24 = 5). Confirm against live behavior.

## 2. Enhancement slots at E

- No exemplar logic exists for slot counts. Slot count is
  `iNumBoostsBought + CountForLevel(X - iLevelBought, FreeBoostSchedule)`, capped at `iMaxBoosts`
  (`SRC/Common/entity/powers.c:1110-1111`, `power_LevelFinalize`). It uses `character_GetLevel` = X, not E.
- Therefore every slot the character has stays physically present at E, including slots "gained above E".
  There is no rule that disables a slot because it was bought/assigned at a level > E.
- A slotted enhancement in a usable power still works (subject to section 3). In an unusable power
  (section 1) the power cannot fire, so its strength does nothing, but see section 4 for set bonuses.
- The only slot-level rule is `boost_IsValidToSlotAtLevel` (boost.c:276): `MinSlotLevel <= level <= MaxSlotLevel`
  and effectiveness > 0 at the character's level. It runs when slotting/moving (character_net_server.c:1102,
  at X) and does not re-run on exemplar.
- The planner's current filter `s.level > level` (totals.ts:168, setbonus.ts:38) is NOT a source rule; it should
  be dropped for slots (keep it only if the user wants a "what did I have at level N while leveling" view,
  which is a different feature from exemplaring).

## 3. Enhancement strength at E

Per-enhancement flow in `character_AccrueBoosts` (`SRC/Common/entity/character_mods.c:363-470`):

1. `iLevelEff = X` (line 363).
2. `fEff = boost_Effectiveness(boost, ent, iLevelEff, ...)` (line 395) -- evaluated at X.
3. `iLevelBoost = boost->iLevel + iNumCombines`; if `bBoostBoostable` -> `boost->iLevel`; else if
   `bBoostUsePlayerLevel` (attuned, `bup`) -> `MIN(iLevelEff, iMaxBoostLevel - 1)` (lines 396-403). Again X.
4. `fMagnitude = table[iLevelBoost] * scale`.
5. If `p->iCombatLevel < iLevelEff` (E < X, line 433): `fMagnitude = boost_HandicapExemplar(E, X, fMagnitude)`.
6. `fMagnitude *= fEff`, then `* combatmod_Magnitude(..)` at `(iLevelEff, iLevelEff)`, then summed and run
   through ED (`AggregateStrength`, line ~640). So the handicap is applied per enhancement BEFORE effectiveness
   and BEFORE ED. Global boosts (line 491-537) use the identical code.

### 3a. Handicap math (`SRC/Common/entity/boost.c:760-806`, `boost_HandicapExemplar(E, X, mag)`)

```c
if (mag > PreClamp[min(E,o)])          mag = PreClamp[min(E,o)];
if (mag >= Limits[min(E,n)])           mag *= Handicaps[min(E,m)] / Handicaps[min(X,m)];   /* Weights */
if (mag > PostClamp[min(E,p)])         mag = PostClamp[min(E,p)];
```

- Arrays have 50 entries (index = 0-based level); index is clamped to the last entry.
- PreClamp: 0.4167 for E = 0..44, 1.0 for E = 45..49 (core.json "exemplar".PreClamp). So at E <= 44 any single
  enhancement value above 41.67% is cut to 41.67% (this is why a 42.4% IO shows 41.67% in exemplar).
- Limits: 0.05 (E 0-9), 0.10 (E 10-19), 0.20 (E 20+). Compared AFTER PreClamp, per enhancement value
  (so small values, e.g. 0.15 at E >= 20, are NOT weighted down). Comparison is `>=`.
- Weights: 0.022 * (E+1) roughly rising to 0.978 at E=30, then 1.000 for E >= 31 (level 32+). Ratio is
  `Weights[E] / Weights[X]`; with X = 49 the divisor is 1.000.
- PostClamp: 1.0 everywhere (no effect on real values).
- Exemplaring to level >= 32 therefore only applies the 41.67% PreClamp (until level 46, where PreClamp = 1.0).
- Worked values at X = 49 (level 50): E=9 (lvl 10): 0.3333 -> 0.0820, 0.4244 -> 0.1025, 0.15 -> 0.0369,
  0.05 -> 0.0123 (all >= 0.05 weighted by 0.246); E=24 (lvl 25): 0.3333 -> 0.2443, 0.4244 -> 0.3054,
  0.15 -> 0.15 (below the 0.20 limit, untouched); E=44 (lvl 45): 0.4244 -> 0.4167.

### 3b. Which level, per enhancement kind

| Kind | Flags | Effectiveness `fEff` (at X) | Table level `iLevelBoost` | Notes |
|---|---|---|---|---|
| TO/DO/SO (generic, non-IO) | `bie`=0 | `boost_EffectivenessLevel(iLevel+combines, X)` = relative-level table: `above` [1,1.05,1.1,1.15], `below` [1,0.9,0.8,0.7], 0 beyond (boost.c:196-220) | `iLevel + combines` (its own level) | Relative level is vs X, so exemplaring does NOT change TO/DO/SO effectiveness; only the handicap (3a) applies. |
| Crafted IO / set IO | `bie`=1, `bup`=0 | 1.0 iff `power_MinBoostUseLevel <= X <= power_MaxBoostUseLevel`, else 0 (boost.c:244-265); `bb` -> booster table | the IO's `iLevel` (+combines if boostable) | At level 50 the range is satisfied, so strength is unchanged except the handicap. |
| Attuned | `bie`=1, `bup`=1 | same range check, but range = `[MinSlotLevel, MaxSlotLevel]` only (boost.c:287-323) | `MIN(X, maxBL - 1)` (character_mods.c:402) | Table lookup uses X, not E. Then handicap to E. |

- IO "minimum usable level" (non-attuned, `bie`): `power_MinBoostUseLevel = MAX(MinSlotLevel, iLevel - (len(above) - 1))`
  = `MAX(slot[0], ioLevel - 3)` with the current table (len 4). Max = `slot[1]`. (boost.c:287-323; the
  commented-out `MIN(iMaxSlotLevel,iBoostLevel) + below` is dead code for `bie`.)
- IMPORTANT: for STRENGTH this range is tested against X (character_mods.c:395), so it never fails for a
  level-50 build and exemplaring does not turn off IO strength. It is the SET BONUS path that tests against E
  (section 4).
- TO/DO/SO table values are looked up at the enhancement's own level, not E; E only enters through step 5.

## 4. IO set bonuses at E (I24 engine)

`boostset_FindBonuses` (`SRC/Common/entity/boostset.c:132-206`), called from `character_AccrueBoosts` via
`boostset_RecompileBonuses` (character_mods.c:580):

```c
int iEffLevel = c->iCombatLevel;                                   // E, line 136
... for each slotted boost j in the power:
   if (ppBoosts[j] && (ppBoosts[j]->ppowBase->bBoostAlwaysCountForSet ||
        boost_Effectiveness(ppBoosts[j], ent, iEffLevel, owner) > 0.0f)
       && ppBoosts[j]->ppowBase->pBoostSetMember == pSet)  -> count its piece (unique piece list)   // 150-155
if (num == 0) continue;
for each bonus: if (num >= iMinBoosts && (!iMaxBoosts || num <= iMaxBoosts)) [and requires pass] -> bonus active   // 177-
```

Proven rules:
- A set piece counts toward the bonus ONLY IF its effectiveness at E is > 0 (or the piece has
  `BoostAlwaysCountForSet`; no such flag is surfaced in the decoded data, so treat as false).
- For `bie` pieces that means `E >= MinBoostUseLevel` and `E <= slot[1]`:
  - Crafted (non-attuned) set IO: `E >= MAX(slot[0], ioLevel - 3)`. So a level-50 IO (ioLevel 49) needs
    E >= 46 (level 47+); a level-30 IO (ioLevel 29) needs E >= 26 (level 27+). This is the "within 3 levels" rule.
  - Attuned set IO: `E >= slot[0]` (its own MinSlotLevel, which tracks the set's minimum level; e.g. `slot` [6,49] for
    a set with minL 7). Attuned pieces are not penalised by IO level.
- Counting is per power (set pieces slotted in that power) and by unique piece (BoostList), same as at level 50.
  Bonus tiers use the surviving piece count, so dropping one piece can drop tiers (`min..max` windows).
- The set's own `MinLevel`/`MaxLevel` (boostsets minL/maxL, 1-based in the bin) are NOT used for bonus activation
  in I24. In `boostset.c:470-476,657` they are used only for conversion validity (`checkBoostSetValidConversion`).
  Per-piece usability is governed by each piece's MinSlotLevel/MaxSlotLevel.
- There is NO check that the power holding the pieces is usable at E. `boostset_FindBonuses` never calls
  `character_AtLevelCanUsePower`, and `PowerStrength_Tick` accrues bonuses for every owned power
  (character_tick.c:1513-1535). The Set_Bonus auto powers have `iLevelBought = 0` and bypass the level gate.
  So in I24, bonuses from pieces slotted in a power the character cannot use at E (section 1) still apply.
- Bonuses are not reduced by the handicap. `character_mods.c:583-630` (bonus loop) has no `boost_HandicapExemplar`
  call, `fEff = 1.0` ("Bonuses don't vary with level"), and strength-type bonus templates look up their table at
  X (line 604). Almost all bonus templates use `Melee_Ones` (flat, level-independent; 326 of the template uses in
  decoded `bonusPowers`), plus pet-share and a few `Melee_*` tables; non-boost templates of the bonus power go
  through normal `mod_Fill` and use the table at E (section 5).
- Rule of 5 is unchanged by exemplaring (it is an effect-stacking limit in the engine/Mids, not level based).
- Bonus effects remain conditional on `bIgnoreBoosts` (taskforce/flashback "enhancements off"): then no bonuses
  (boostset.c:232-236). Not part of the slider.

UNVERIFIED (not in I24 source) -- do not treat as fact:
- Whether Homecoming changed set-bonus activation under exemplar (for example, requiring the set's MinLevel, or
  removing the "ioLevel - 3" requirement, or tying activation to the powers being usable).
- Whether Homecoming's attuned pieces use a different floor than `MinSlotLevel`.
- Whether Homecoming still keeps bonuses from powers locked by the +5 rule.
- The decoded `slot` for attuned pieces matching the set MinLevel exactly (it matches in the samples I checked,
  e.g. [6,49] <-> minL 7, [16,49] <-> minL 17; not audited for all 2739 boosts).

## 5. Power effect magnitudes at E

- Effect magnitudes/durations from a power's own templates use the caster's combat level:
  `mod_Fill` (`SRC/Common/entity/attribmod.c:~944-966`): normal attack/buff path sets
  `iEffCombatLevel = pSrc->iCombatLevel` (= E) and reads `class_GetNamedTableValue(pclass, table, iEffCombatLevel)`.
  Then `combatmod_Get(...)` scales by the combat-mod tables at that level (lines 1086-1100).
- So all damage/heal/buff/debuff/def/res base magnitudes use the class mod table at E (planner: `gd.table(at, tbl, E)`,
  already what totals.ts does with `level`).
- Class caps also index by combat level: `pattrMax[iCombatLevel]` (character_mods.c:87; max HP, endurance, etc.),
  `pattrMaxMax[E]` (character_attribs.c:365), `pattrResistanceMax[E]` (line 565), `pattrStrengthMax[E]` (line 582).
  Base attributes (HP, regen, recovery) come from the class `base` tables at E as well.
- Enhancement strength applied to a power (section 3) is a fraction multiplying these E-level magnitudes;
  it is not itself looked up at E (except via the handicap).
- Target-side special cases (`bIgnoreCombatMods`, level shift) in mod_Fill do not apply to a plain player buff/attack.

## 6. Proposed planner behavior

Introduce two inputs: `xpLevel` (X, default 49) and `combatLevel` (E, the slider). With E = X the output must equal today's.

| Rule | Planner action at slider E (< X) |
|---|---|
| Usable power | Mark an entry inactive if `entry.level > E + 5` and `!power.ilb` and not Temporary_Powers (Accolades kept). Hide its active effects; keep showing its slots greyed. Inherent/auto powers follow the same rule via their grant level. |
| Slots | Do not drop slots. Remove the `s.level > level` slot filter. |
| Enhancement strength | `effectiveness()` and `boostLevel()` take X (not E). After computing each raw per-mod table value (before `eff`, before ED) apply `handicap(E, X, v)` per section 3a, then `* eff`, then ED as today. |
| Attuned | `boostLevel = min(X, maxBL - 1)` then handicap (not `min(E, ...)`). |
| TO/DO/SO | `rel` effectiveness vs X (unchanged), then handicap. |
| Set bonuses | Count a piece only if `effectiveness(piece, E) > 0` using the E-level range test: crafted `E >= max(slot[0], ioLevel - 3) && E <= slot[1]`; attuned `E >= slot[0] && E <= slot[1]`. Do not filter by power usability or slot level (matching I24). Bonus magnitudes unchanged (no handicap). |
| Power magnitudes / caps | `gd.table(at, tbl, E)` and class max/maxMax/res/str-max at E (as today). |
| Display | Show a note "Exemplar: level E+1" and flag which powers are locked, which set pieces fell below the E threshold, and the per-enhancement handicap factor. |

## 7. Open questions for the user

1. Homecoming grace: is `EXEMPLAR_GRACE_LEVELS` still 5 in live Homecoming? (It is 5 in I24; the user may know the
   live in-game behavior or can test one power picked at exactly E+5 and E+6.)
2. Set bonuses from powers locked by the +5 rule: I24 keeps them. Should the planner follow I24 or the live game
   (if the user has observed otherwise)?
3. Homecoming set-bonus activation under exemplar: does live play use the same "piece effectiveness at E > 0"
   rule, the set MinLevel, or something else (e.g. the "within 3 levels" floor for crafted IOs)? Source cannot say.
4. What is X for the slider build: always the build's top level (49), or should the planner allow a build capped
   below 50 (e.g. a level-40 build exemplared to 25)? The handicap uses the Weights[X] divisor, so this matters.
5. XP level vs bought level for IO levels: the planner's `ioLevel` for crafted IOs is user-chosen (default = set maxL).
   Confirm that is the number the user wants compared to E (engine compares `iLevel`, the crafted level).
6. Set-bonus power templates with non-boost effects (Set_Bonus defense/resistance/regen): they flow through `mod_Fill`
   at E in I24 and almost all use flat `Melee_Ones`. Confirm flat treatment is acceptable (no per-E scaling).
7. Should the slider also model sidekick/team-level effects (`character_IsSidekick`, TF level clamp)? Out of scope
   here; only the pure "pick E < X" exemplar was analysed.
8. Do we keep the old "what did I have while leveling at level N" view (slots/powers gated by their own level)
   as a separate mode? It is not an exemplar rule.
