# Pipeline report -- data 20261017-f94d0e09

Generated 2026-11-08T19:06:53.

## Decode health

| Bin | Records | Clean | Partial |
|---|---|---|---|
| bin/powers.bin | 26737 | 26737 | 0 |
| bin/powersets.bin | 7630 | 7630 | 0 |
| bin/powercats.bin | 204 | 204 | 0 |
| bin/classes.bin | 15 | 15 | 0 |
| bin/boostsets.bin | 227 | 227 | 0 |
| bin/dim_returns.bin | 8 | 8 | 0 |
| bin/attrib_names.bin | 1 | 1 | 0 |
| bin/boost_effect_above.bin | 1 | 1 | 0 |
| bin/boost_effect_below.bin | 1 | 1 | 0 |
| bin/boost_effect_boosters.bin | 1 | 1 | 0 |
| bin/exemplar_handicaps.bin | 1 | 1 | 0 |
| bin/schedules.bin | 1 | 1 | 0 |
| bin/origins.bin | 5 | 5 | 0 |
| bin/clientmessages-en.bin | 97883 | 97883 | 0 |

**Gate: PASS** (0 partial records).

## Export

| Item | Count |
|---|---|
| archetypes | 15 |
| powersets | 471 |
| powers | 4919 |
| boosts | 2739 |
| bonusPowers | 256 |
| boostsets | 227 |

| File | Bytes |
|---|---|
| core.json | 1843682 |
| powersets.json | 214946 |
| powers.json | 7022816 |
| boosts.json | 3249625 |

PvP-only effects dropped: 3490. Unresolved references: 0. New IDs: {'power': 0, 'powerset': 0, 'boostset': 0, 'archetype': 0, 'origin': 0}.

## Assets

powers: 1726, enh: 368, at: 15, origin: 5, ui: 270, fonts: 4

- Missing powers (4): RadiationMelee_AssassinStrike, Spring_Attack_Spring_Attack_pow, Staff_Mastery, UtilityBelt_EnvenomedBarrage

## Validation vs MidsReborn (pre-I28 oracle)

Display names: 9723 of 10043 powers match; 320 differ (I28 renames, Mids typos, Mids-only conventions). First differences (power, Mids, game):

- `Blaster_Support.Electricity_Manipulation.Lightning_Clap`: Mids "Force of Thunder" -> game "Dynamo"
- `Blaster_Support.Electricity_Manipulation.Lightning_Field`: Mids "Dynamo" -> game "Force of Thunder"
- `Blaster_Support.Tactical_Arrow.Gymnastics`: Mids "Gymnastics" -> game "Oil Slick Arrow"
- `Boosts.Attuned_Adjusted_Targeting_D.Attuned_Adjusted_Targeting_D`: Mids "Adjusted Targeting:  Recharge/Endurance Reduction" -> game "Adjusted Targeting: Recharge/Endurance Reduction"
- `Boosts.Attuned_Adjusted_Targeting_E.Attuned_Adjusted_Targeting_E`: Mids "Adjusted Targeting:  To Hit Buff/Endurance Reduction" -> game "Adjusted Targeting: To Hit Buff/Endurance Reduction"
- `Boosts.Attuned_Adjusted_Targeting_F.Attuned_Adjusted_Targeting_F`: Mids "Adjusted Targeting:  Recharge" -> game "Adjusted Targeting: Recharge"
- `Boosts.Attuned_Annihilation_E.Attuned_Annihilation_E`: Mids "Annihilation:  Accuracy/Damage/Recharge/Endurance" -> game "Annihilation: Accuracy/Damage/Recharge/Endurance"
- `Boosts.Attuned_Annoyance_A.Attuned_Annoyance_A`: Mids "Annoyance: Taunt" -> game "Annoyance: Taunt/Placate"
- `Boosts.Attuned_Annoyance_B.Attuned_Annoyance_B`: Mids "Annoyance: Taunt/Recharge" -> game "Annoyance: Taunt/Placate/Recharge"
- `Boosts.Attuned_Annoyance_C.Attuned_Annoyance_C`: Mids "Annoyance: Taunt/Recharge/Range" -> game "Annoyance: Taunt/Placate/Recharge/Range"
- `Boosts.Attuned_Ascendency_of_the_Dominator_B.Attuned_Ascendency_of_the_Dominator_B`: Mids "Ascendency of the Dominator: Control Duration/Recharge" -> game "Ascendancy of the Dominator: Control Duration/Recharge"
- `Boosts.Attuned_Ascendency_of_the_Dominator_C.Attuned_Ascendency_of_the_Dominator_C`: Mids "Ascendency of the Dominator: Endurance/Recharge" -> game "Ascendancy of the Dominator: Endurance/Recharge"
- `Boosts.Attuned_Ascendency_of_the_Dominator_E.Attuned_Ascendency_of_the_Dominator_E`: Mids "Ascendency of the Dominator: Accuracy/Control Duration/Endurance/Recharge" -> game "Ascendancy of the Dominator: Accuracy/Control Duration/Endurance/Recharge"
- `Boosts.Attuned_Ascendency_of_the_Dominator_F.Attuned_Ascendency_of_the_Dominator_F`: Mids "Ascendency of the Dominator: Recharge/Chance for +Damage" -> game "Ascendancy of the Dominator: Recharge/Chance for +Damage"
- `Boosts.Attuned_Blistering_Cold_E.Attuned_Blistering_Cold_E`: Mids "Blistering Cold:  Accuracy/Damage/Endurance/Recharge" -> game "Blistering Cold: Accuracy/Damage/Endurance/Recharge"
- `Boosts.Attuned_Blood_Mandate_D.Attuned_Blood_Mandate_D`: Mids "Blood Mandate:  Accuracy/Damage/Endurance" -> game "Blood Mandate: Accuracy/Damage/Endurance"
- `Boosts.Attuned_Blood_Mandate_F.Attuned_Blood_Mandate_F`: Mids "Blood Mandate:  Damage" -> game "Blood Mandate: Damage"
- `Boosts.Attuned_Brilliant_Leadership_D.Attuned_Brilliant_Leadership_D`: Mids "Brilliant Leadership:  Accuracy/Damage/Endurance" -> game "Brilliant Leadership: Accuracy/Damage/Endurance"
- `Boosts.Attuned_Brilliant_Leadership_F.Attuned_Brilliant_Leadership_F`: Mids "Brilliant Leadership:  Damage" -> game "Brilliant Leadership: Damage"
- `Boosts.Attuned_Call_to_Arms_F.Attuned_Call_to_Arms_F`: Mids "Call to Arms:  Defense Bonus Aura for Pets" -> game "Call to Arms: Defense Bonus Aura for Pets"

Attribute labels: 93 of 115 offsets agree with >= 99% of paired Mids effects. Unlabelled offsets: none. Offsets below 99% (needs review; pairing is by table+scale, so ambiguous pairs and Mids conventions show here):

| Offset | Attribute | Pairs | Agree | Example (power, ours, aspect, Mids types) |
|---|---|---|---|---|
| 28 | DamageType07 | 555 | 0.856 | ('Controller_Buff.Empathy.Absorb_Pain', 'DamageType07', 'kResistance', ['ResEffect']) |
| 84 | Absorb | 182 | 0.890 | ('Brute_Defense.Bio_Organic_Armor.Ablative_Carapace', 'Absorb', 'kMaximum', ['Regeneration']) |
| 236 | Recovery | 639 | 0.978 | ('Brute_Defense.Radiation_Armor.Gamma_Boost', 'Recovery', 'kCurrent', ['Regeneration']) |
| 324 | Knockup | 661 | 0.985 | ('Brute_Defense.Regeneration.Moment_of_Glory', 'Knockup', 'kResistance', ['Recovery']) |
| 332 | Repel | 248 | 0.960 | ('Brute_Defense.Regeneration.Moment_of_Glory', 'Repel', 'kResistance', ['Recovery']) |
| 408 | Elusivity07 | 15 | 0.667 | ('Brute_Defense.Stone_Armor.Crystal_Armor', 'Elusivity07', 'kStrength', ['Recovery']) |
| 412 | Elusivity08 | 15 | 0.667 | ('Brute_Defense.Stone_Armor.Crystal_Armor', 'Elusivity08', 'kStrength', ['Recovery']) |
| 460 | ElusivityBase | 6 | 0.000 | ('Controller_Buff.Force_Field.Personal_Force_Field', 'ElusivityBase', 'kStrength', ['Enhancement']) |
| 469 | EntCreate | 702 | 0.984 | ('Blaster_Support.Martial_Manipulation.Burst_of_Speed', 'EntCreate', 'kCurrent', ['GlobalChanceMod']) |
| 471 | SilentKill | 73 | 0.986 | ('Temporary_Powers.Temporary_Powers.Remote_Camera', 'SilentKill', 'kCurrent', ['SetMode']) |
| 473 | SetMode | 401 | 0.785 | ('Blaster_Ranged.Dual_Pistols.Chemical_Ammunition', 'SetMode', 'kCurrent', ['GlobalChanceMod']) |
| 474 | SetCostume | 80 | 0.988 | ('Temporary_Powers.Temporary_Powers.Remote_Camera', 'SetCostume', 'kCurrent', ['SetMode']) |
| 476 | Null | 500 | 0.934 | ('Blaster_Ranged.Storm_Blast.Storm_Cell', 'Null', 'kCurrent', ['DamageBuff', 'EntCreate', 'ExecutePower']) |
| 481 | GrantPower | 1179 | 0.956 | ('Blaster_Ranged.Assault_Rifle.Ignite', 'GrantPower', 'kAbsolute', ['DamageBuff']) |
| 482 | RevokePower | 1230 | 0.911 | ('Blaster_Support.Ninja_Training.Kyokan', 'RevokePower', 'kAbsolute', ['GrantPower']) |
| 484 | GlobalChanceMod | 517 | 0.965 | ('Brute_Defense.Stone_Armor.Granite_Armor', 'GlobalChanceMod', 'kCurrent', ['SetCostume']) |
| 491 | Phase | 44 | 0.000 | ('Controller_Buff.Darkness_Affinity.Black_Hole', 'Phase', 'kCurrent', ['CombatPhase', 'Mez']) |
| 492 | CombatModShift | 59 | 0.000 | ('Incarnate.Alpha.Agility_Core_Paragon', 'CombatModShift', 'kCurrent', ['GrantPower', 'LevelShift', 'RevokePower', 'SetMode']) |
| 493 | RechargePower | 6 | 0.500 | ('Pool.Experimentation.Jaunt', 'RechargePower', 'kCurrent', ['Mez']) |
| 499 | DesignerStatus | 48 | 0.646 | ('Brute_Defense.Energy_Aura.Overload', 'DesignerStatus', 'kAbsolute', ['Endurance']) |
| 511 | CancelMods | 106 | 0.000 | ('Brute_Melee.Dual_Blades.AoE_Bridge', 'CancelMods', 'kStrength', ['UnsetMode']) |
| 512 | ExecutePower | 8 | 0.000 | ('Brute_Defense.Electric_Armor.Power_Surge', 'ExecutePower', 'kStrength', ['Translucency']) |

Archetypes at level 50 (game vs Mids):

| AT | HP | HP cap | Res cap | Mids (HP, cap, res) | Match |
|---|---|---|---|---|---|
| Class_Blaster | 1204.76 | 1847.3 | 0.75 | (1205, 1847.3, 0.75) | yes |
| Class_Brute | 1606.35 | 3212.69 | 0.9 | (1499, 3212.7, 0.9) | NO |
| Class_Controller | 1017.35 | 1606.35 | 0.75 | (1017, 1606.3, 0.75) | yes |
| Class_Corruptor | 1070.9 | 1606.35 | 0.75 | (1071, 1606.3, 0.75) | yes |
| Class_Defender | 1017.35 | 1606.35 | 0.75 | (1017, 1606.3, 0.75) | yes |
| Class_Dominator | 1017.35 | 1606.35 | 0.75 | (1017, 1606.3, 0.75) | yes |
| Class_Mastermind | 803.17 | 1606.35 | 0.75 | (803, 1606.3, 0.75) | yes |
| Class_Scrapper | 1338.62 | 2409.52 | 0.75 | (1339, 2409.5, 0.75) | yes |
| Class_Sentinel | 1204.76 | 2088.25 | 0.75 | (1205, 2088.3, 0.75) | yes |
| Class_Stalker | 1204.76 | 2088.25 | 0.75 | (1204, 2088.25, 0.75) | yes |
| Class_Tanker | 1874.07 | 3533.96 | 0.9 | (1874, 3534, 0.9) | yes |
| Class_Arachnos_Soldier | 1070.9 | 2409.52 | 0.85 | (1071, 2409.5, 0.85) | yes |
| Class_Arachnos_Widow | 1070.9 | 2409.52 | 0.85 | (1071, 2409.5, 0.85) | yes |
| Class_Peacebringer | 1070.9 | 2409.52 | 0.85 | (1071, 2409.5, 0.85) | yes |
| Class_Warshade | 1070.9 | 2409.52 | 0.85 | (1071, 2409.5, 0.85) | yes |

Enhancements: TO scale 0.0833 (Mids .083), SO 0.3333 (Mids .333); IO L25 A 0.3202 (Mids .320); IO L50 A 0.4238, B 0.2545, C 0.5091, D 0.7636 (Mids A .424, B .255, C .509, D .764).
ED start thresholds by boost type: {'(22,)': (0.4, 0.5, 0.6), '(6,)': (0.4, 0.5, 0.6), '(35,)': (0.4, 0.5, 0.6), '(7,)': (0.4, 0.5, 0.6), '(11,)': (0.4, 0.5, 0.6), '(32,)': (0.8, 1.0, 1.2), '(17,)': (1.2, 1.5, 1.8), "('default',)": (0.7, 0.9, 1.0)} (Mids A .7/.9/1.0, B .4/.5/.6, C .8/1.0/1.2, D 1.2/1.5/1.8).

