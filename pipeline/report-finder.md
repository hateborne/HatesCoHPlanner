# Build research report -- data i28p4

Generated 2026-11-18T13:51:11Z (UTC) by `npm run research`. Aggregates only; the builds themselves stay on the machine that ran it.

## What was read

| Item | Count |
|---|---|
| .mbd files | 3030 |
| Share codes in text files and saved pages | 74 |
| Files over the size limit (left out) | 0 |
| Text files and pages with no share code | 0 |
| Other files (left alone) | 0 |
| Made on another server's Mids database (left out) | 3 |
| Could not be imported | 0 |
| Imported | 3101 |
| Imported without a picked power that could not be placed (counted without it) | 422 |
| Too empty to count (under 12 powers or 20 enhancements) | 0 |
| Copies of another build (left out) | 25 |
| **Builds counted** | **3076** |

Builds by file-name tag (a build can carry several):

| Tag | Builds |
|---|---|
| farm | 60 |
| cheap | 30 |
| hard mode | 23 |

Builds by Mids database year:

| Year | Builds |
|---|---|
| 2023 | 189 |
| 2024 | 853 |
| 2025 | 1174 |
| 2026 | 811 |
| legacy share code | 74 |

## Import check

Every build was imported against i28p4 with the planner's own Mids importer. 2701 of 3101 imported with no warning.

### Builds that could not be imported

_None._

### Warning: a power is not in the game data (479)

| Item | Times |
|---|---|
| Psychokinetic Barrier (Psionic Armor) | 117 |
| Reactive Regeneration (Regeneration) | 74 |
| Power of the Depths (Marine Affinity) | 68 |
| Multipurpose Missiles (Pyrotechnic Control) | 46 |
| Sparkling Chain (Pyrotechnic Control) | 45 |
| Tri Cannon (Arsenal Control) | 27 |
| Conserve Power (Energy Aura) | 19 |
| Power Armor (Energy Aura) | 19 |
| Smoke Canister (Arsenal Control) | 13 |
| Sound Booster (Sonic Melee) | 9 |
| Umbral Torrent (Dark Mastery Controller) | 9 |
| Elbow Strike (Arsenal Assault) | 8 |
| Rime (Ice Armor) | 6 |
| FRT Fate Sealed (Fortunata Teamwork) | 4 |
| Assassins Whisper (Sonic Melee) | 3 |
| Bo Ryaku Clone (Ninjitsu) | 3 |
| Build Up (Ice Mastery DefCorr) | 3 |
| NW Pain Tolerance (Widow Teamwork) | 2 |
| Umbral Torrent (Dark Mastery Dominator) | 2 |
| Quantum Acceleration (Inherent) | 1 |
| Up to the Challenge Clone (Willpower) | 1 |

### Repairs by checkBuild

| Repair | Times |
|---|---|
| unfinished build: stopped at level N | 422 |
| Explosive Blast: dropped a bad slot | 4 |

### Rule issues the planner flags (615 builds)

A Mids build can break a game rule Mids does not check, so these are leads to look into, not proven planner faults.

| Issue | Builds |
|---|---|
| Level N has N slots placed but grants N | 316 |
| This power can't take it | 192 |
| Available at level N | 157 |
| Not available to this archetype | 19 |
| Not allowed at this level | 17 |
| Choose a secondary power now | 14 |
| Slot is below the power level | 12 |
| Choose a primary power now | 6 |
| Requirements not met | 2 |
| Made at levels N to N | 1 |
| No powers available yet | 1 |
| Relative level goes up to +N | 1 |

## Builds counted, by archetype

| Archetype | Builds | Note |
|---|---|---|
| Tanker | 424 |  |
| Brute | 369 |  |
| Sentinel | 338 |  |
| Scrapper | 320 |  |
| Blaster | 297 |  |
| Controller | 258 |  |
| Stalker | 247 |  |
| Dominator | 243 |  |
| Corruptor | 224 |  |
| Defender | 189 |  |
| Mastermind | 136 |  |
| Arachnos Soldier | 12 | under 25: uses the all-archetype values |
| Peacebringer | 8 | under 25: uses the all-archetype values |
| Arachnos Widow | 7 | under 25: uses the all-archetype values |
| Warshade | 4 | under 25: uses the all-archetype values |

## Stat values, all archetypes

Share: the mean share of a build's set bonuses spent on the stat, counted in typical bonuses. Offered: the stat's share of every set bonus in the game. Lift = share / offered: over 1 means builds seek the stat out.

| Stat | Share | Offered | Lift |
|---|---|---|---|
| Max HP | 14.0% | 9.9% | 1.41 |
| Recharge | 12.2% | 7.9% | 1.54 |
| Damage resistance | 11.9% | 12.5% | 0.95 |
| Status resistance | 11.0% | 12.3% | 0.89 |
| Defense | 9.7% | 19.3% | 0.50 |
| Recovery | 9.6% | 9.2% | 1.04 |
| Accuracy | 6.7% | 5.5% | 1.22 |
| Regeneration | 6.2% | 5.4% | 1.15 |
| Damage | 4.9% | 7.0% | 0.70 |
| Debuff resistance | 4.7% | 2.1% | 2.18 |
| Endurance Reduction | 3.0% | 0.8% | 3.70 |
| Movement | 2.4% | 3.1% | 0.75 |
| Max Endurance | 2.3% | 3.6% | 0.62 |
| Range | 0.9% | 0.5% | 1.70 |
| Status protection | 0.7% | 0.7% | 1.07 |

### Defense, type by type

| Stat | Share | Lift | Typical bonus | Median total | Median from set bonuses |
|---|---|---|---|---|---|
| Smashing (Def) | 1.4% | 0.80 | 1.6% | 22.7% | 3.8% |
| Lethal (Def) | 1.4% | 0.80 | 1.6% | 22.7% | 3.8% |
| Melee (Def) | 1.3% | 0.87 | 2.0% | 22.3% | 5.0% |
| Energy (Def) | 1.1% | 0.50 | 1.6% | 22.1% | 1.9% |
| Negative Energy (Def) | 1.1% | 0.50 | 1.6% | 21.7% | 1.9% |
| Fire (Def) | 1.0% | 0.37 | 1.6% | 19.2% | 0.0% |
| Cold (Def) | 1.0% | 0.37 | 1.6% | 19.2% | 0.0% |
| Ranged (Def) | 0.7% | 0.43 | 2.5% | 19.7% | 2.5% |
| Area (Def) | 0.5% | 0.27 | 2.5% | 17.2% | 0.0% |
| Psionic (Def) | 0.2% | 0.20 | 3.1% | 16.9% | 0.0% |
| Toxic (Def) | 0.0% | 0.00 | 0.0% | 16.2% | 0.0% |

### Damage resistance, type by type

| Stat | Share | Lift | Typical bonus | Median total | Median from set bonuses |
|---|---|---|---|---|---|
| Fire (Res) | 2.3% | 1.26 | 3.0% | 35.3% | 17.3% |
| Cold (Res) | 2.3% | 1.26 | 3.0% | 33.3% | 17.3% |
| Smashing (Res) | 1.7% | 1.00 | 2.3% | 57.5% | 9.8% |
| Lethal (Res) | 1.7% | 1.00 | 2.3% | 56.6% | 9.8% |
| Energy (Res) | 1.6% | 1.45 | 2.7% | 31.4% | 9.8% |
| Negative Energy (Res) | 1.6% | 1.45 | 2.7% | 26.8% | 9.8% |
| Psionic (Res) | 0.4% | 0.23 | 3.8% | 18.9% | 3.0% |
| Toxic (Res) | 0.4% | 0.23 | 3.8% | 26.2% | 3.0% |

### Everything else

| Stat | Share | Lift | Typical bonus | Median total | Median from set bonuses |
|---|---|---|---|---|---|
| Max HP | 14.0% | 1.41 | 19.3 | 1472.7 | 158.1 |
| Recharge | 12.2% | 1.54 | 6.3% | 141.3% | 48.8% |
| Recovery | 9.6% | 1.04 | 2.1% | 83.1% | 12.5% |
| Accuracy | 6.7% | 1.22 | 9.0% | 38.0% | 37.0% |
| Regeneration | 6.2% | 1.15 | 10.0% | 126.0% | 38.0% |
| Endurance Reduction | 3.0% | 3.70 | 3.0% | 6.3% | 6.3% |
| Max Endurance | 2.3% | 0.62 | 1.80 | 3.60 | 2.25 |
| Confuse (Res) | 1.8% | 0.89 | 5.0% | 86.3% | 65.0% |
| Hold (Res) | 1.8% | 0.89 | 5.0% | 75.0% | 65.0% |
| Immobilize (Res) | 1.8% | 0.89 | 5.0% | 117.2% | 65.0% |
| Sleep (Res) | 1.8% | 0.89 | 5.0% | 127.2% | 65.0% |
| Stun (Res) | 1.8% | 0.89 | 5.0% | 73.8% | 65.0% |
| Terrorize (Res) | 1.8% | 0.89 | 5.0% | 87.5% | 65.0% |
| RechargeTime (Res) | 1.6% | 2.18 | 10.0% | 60.0% | 30.0% |
| SpeedFlying (Res) | 1.6% | 2.18 | 10.0% | 55.0% | 30.0% |
| SpeedRunning (Res) | 1.6% | 2.18 | 10.0% | 55.0% | 30.0% |
| Range | 0.9% | 1.70 | 5.9% | 0.0% | 0.0% |
| Fly Speed | 0.6% | 0.75 | 6.0% | 21.1% | 7.5% |
| Jump Height | 0.6% | 0.75 | 6.0% | 374.3% | 7.5% |
| Jump Speed | 0.6% | 0.75 | 6.0% | 133.0% | 7.5% |
| Run Speed | 0.6% | 0.75 | 6.0% | 57.5% | 7.5% |
| Knockback (Prot) | 0.4% | 1.07 | 3.00 | 9.00 | 0.00 |
| Knockup (Prot) | 0.4% | 1.07 | 3.00 | 9.00 | 0.00 |

## Stat values by archetype

Share of set-bonus spend by stat family, largest first (lift in brackets).

| Archetype | Builds | Top families |
|---|---|---|
| Tanker | 424 | Damage resistance 15.8% (1.22), Max HP 15.2% (1.54), Status resistance 15.1% (1.17), Recharge 9.6% (1.27), Recovery 8.0% (0.86), Regeneration 6.8% (1.22) |
| Brute | 369 | Damage resistance 16.1% (1.24), Status resistance 14.7% (1.15), Max HP 14.1% (1.42), Defense 11.1% (0.57), Recovery 8.8% (1.00), Recharge 7.9% (1.03) |
| Sentinel | 338 | Max HP 14.9% (1.49), Defense 12.3% (0.64), Recharge 11.9% (1.48), Damage resistance 10.8% (0.88), Status resistance 9.8% (0.82), Recovery 8.1% (0.86) |
| Scrapper | 320 | Max HP 15.9% (1.62), Damage resistance 13.4% (1.08), Status resistance 11.8% (0.99), Recharge 10.6% (1.33), Defense 10.4% (0.53), Recovery 9.8% (1.01) |
| Blaster | 297 | Recharge 12.9% (1.61), Max HP 12.8% (1.28), Defense 10.5% (0.54), Recovery 9.7% (1.03), Damage resistance 8.5% (0.70), Status resistance 8.0% (0.67) |
| Controller | 258 | Recharge 15.0% (1.92), Max HP 13.9% (1.37), Recovery 10.6% (1.20), Damage resistance 9.6% (0.76), Status resistance 8.9% (0.72), Defense 8.8% (0.45) |
| Stalker | 247 | Damage resistance 13.2% (1.07), Status resistance 11.8% (0.98), Max HP 11.7% (1.24), Defense 11.7% (0.59), Recharge 11.4% (1.43), Recovery 10.3% (1.06) |
| Dominator | 243 | Recharge 14.9% (1.92), Recovery 13.8% (1.56), Defense 10.5% (0.54), Accuracy 10.4% (1.83), Max HP 9.9% (0.98), Damage resistance 9.4% (0.74) |
| Corruptor | 224 | Recharge 14.7% (1.82), Max HP 14.5% (1.44), Recovery 9.9% (1.12), Defense 9.5% (0.49), Damage resistance 9.0% (0.74), Status resistance 8.6% (0.71) |
| Defender | 189 | Recharge 15.8% (1.98), Max HP 14.9% (1.50), Recovery 9.8% (1.05), Damage resistance 8.5% (0.70), Status resistance 8.0% (0.67), Defense 7.7% (0.40) |
| Mastermind | 136 | Recharge 15.6% (1.95), Max HP 14.7% (1.48), Damage resistance 11.4% (0.88), Status resistance 10.9% (0.83), Accuracy 7.8% (1.39), Defense 7.6% (0.40) |
| Arachnos Soldier | 12 | Max HP 14.8% (1.43), Defense 13.9% (0.73), Recharge 10.5% (1.37), Damage resistance 9.8% (0.80), Status resistance 9.2% (0.77), Recovery 8.9% (0.96) |
| Peacebringer | 8 | Max HP 14.1% (1.42), Recharge 14.0% (1.76), Recovery 13.2% (1.41), Damage resistance 10.4% (0.83), Defense 10.2% (0.53), Status resistance 10.1% (0.82) |
| Arachnos Widow | 7 | Max HP 16.2% (1.56), Recharge 13.3% (1.74), Recovery 12.0% (1.29), Damage resistance 9.0% (0.73), Accuracy 8.8% (1.60), Damage 8.3% (1.36) |
| Warshade | 4 | Recharge 18.1% (2.26), Max HP 18.0% (1.82), Recovery 11.1% (1.19), Accuracy 8.7% (1.57), Damage resistance 8.3% (0.67), Status resistance 7.9% (0.64) |

## Needs: status protection added with enhancements

Share of a group's builds whose enhancements (set bonuses, globals or the pieces themselves) add protection, where at least half do.

| Group | Kind | Stat | Builds adding it | Typical amount |
|---|---|---|---|---|
| Defender | Archetype | Knockback (Prot) | 79.9% | 3.00 |
| Defender | Archetype | Knockup (Prot) | 79.9% | 3.00 |
| Corruptor | Archetype | Knockback (Prot) | 73.7% | 3.00 |
| Corruptor | Archetype | Knockup (Prot) | 73.7% | 3.00 |
| Blaster | Archetype | Knockback (Prot) | 70.0% | 3.00 |
| Blaster | Archetype | Knockup (Prot) | 70.0% | 3.00 |
| Controller | Archetype | Knockback (Prot) | 67.4% | 3.00 |
| Controller | Archetype | Knockup (Prot) | 67.4% | 3.00 |
| Mastermind | Archetype | Knockback (Prot) | 65.4% | 4.00 |
| Mastermind | Archetype | Knockup (Prot) | 65.4% | 4.00 |
| Dominator | Archetype | Knockback (Prot) | 63.4% | 3.00 |
| Dominator | Archetype | Knockup (Prot) | 63.4% | 3.00 |
| Dual Pistols | Blaster Ranged | Knockback (Prot) | 76.0% | 3.00 |
| Dual Pistols | Blaster Ranged | Knockup (Prot) | 76.0% | 3.00 |
| Fire Blast | Blaster Ranged | Knockback (Prot) | 75.8% | 3.00 |
| Fire Blast | Blaster Ranged | Knockup (Prot) | 75.8% | 3.00 |
| Electrical Blast | Blaster Ranged | Knockback (Prot) | 65.4% | 3.00 |
| Electrical Blast | Blaster Ranged | Knockup (Prot) | 65.4% | 3.00 |
| Devices | Blaster Support | Knockback (Prot) | 73.1% | 3.00 |
| Devices | Blaster Support | Knockup (Prot) | 73.1% | 3.00 |
| Fire Manipulation | Blaster Support | Knockback (Prot) | 72.7% | 3.00 |
| Fire Manipulation | Blaster Support | Knockup (Prot) | 72.7% | 3.00 |
| Energy Manipulation | Blaster Support | Knockback (Prot) | 72.0% | 3.00 |
| Energy Manipulation | Blaster Support | Knockup (Prot) | 72.0% | 3.00 |
| Dark Armor | Brute Defense | Knockback (Prot) | 100.0% | 7.00 |
| Dark Armor | Brute Defense | Knockup (Prot) | 100.0% | 7.00 |
| Fiery Aura | Brute Defense | Knockback (Prot) | 79.0% | 7.00 |
| Fiery Aura | Brute Defense | Knockup (Prot) | 79.0% | 7.00 |
| Darkness Affinity | Controller Buff | Knockback (Prot) | 68.0% | 4.00 |
| Darkness Affinity | Controller Buff | Knockup (Prot) | 68.0% | 4.00 |
| Gravity Control | Controller Control | Knockback (Prot) | 80.0% | 3.00 |
| Gravity Control | Controller Control | Knockup (Prot) | 80.0% | 3.00 |
| Illusion Control | Controller Control | Knockback (Prot) | 78.4% | 3.00 |
| Illusion Control | Controller Control | Knockup (Prot) | 78.4% | 3.00 |
| Pyrotechnic Control | Controller Control | Knockback (Prot) | 57.7% | 3.00 |
| Pyrotechnic Control | Controller Control | Knockup (Prot) | 57.7% | 3.00 |
| Water Blast | Corruptor Ranged | Knockback (Prot) | 82.1% | 3.00 |
| Water Blast | Corruptor Ranged | Knockup (Prot) | 82.1% | 3.00 |
| Savage Assault | Dominator Assault | Knockback (Prot) | 60.0% | 3.00 |
| Savage Assault | Dominator Assault | Knockup (Prot) | 60.0% | 3.00 |
| Darkness Control | Dominator Control | Knockback (Prot) | 76.0% | 3.00 |
| Darkness Control | Dominator Control | Knockup (Prot) | 76.0% | 3.00 |
| Demon Summoning | Mastermind Summon | Knockback (Prot) | 69.2% | 5.00 |
| Demon Summoning | Mastermind Summon | Knockup (Prot) | 69.2% | 5.00 |
| Dark Armor | Scrapper Defense | Knockback (Prot) | 96.0% | 9.00 |
| Dark Armor | Scrapper Defense | Knockup (Prot) | 96.0% | 9.00 |
| Fiery Aura | Sentinel Defense | Knockback (Prot) | 75.0% | 7.50 |
| Fiery Aura | Sentinel Defense | Knockup (Prot) | 75.0% | 7.50 |
| Dark Armor | Sentinel Defense | Knockback (Prot) | 69.2% | 7.50 |
| Dark Armor | Sentinel Defense | Knockup (Prot) | 69.2% | 7.50 |
| Dark Armor | Stalker Defense | Knockback (Prot) | 100.0% | 10.0 |
| Dark Armor | Stalker Defense | Knockup (Prot) | 100.0% | 10.0 |
| Dark Armor | Tanker Defense | Knockback (Prot) | 97.4% | 7.00 |
| Dark Armor | Tanker Defense | Knockup (Prot) | 97.4% | 7.00 |
| Fiery Aura | Tanker Defense | Knockback (Prot) | 71.8% | 7.50 |
| Fiery Aura | Tanker Defense | Knockup (Prot) | 71.8% | 7.50 |

## Sets

The 40 sets most often slotted for a bonus (2 or more pieces in one power).

| Set | Rarity | Category | Builds | x2 | x3 | x4 | x5 | x6 |
|---|---|---|---|---|---|---|---|---|
| Preventive Medicine | Rare | Healing | 65.2% | 91 | 648 | 38 | 0 | 1507 |
| Shield Wall | PvP | Defense Sets | 64.8% | 2 | 43 | 3029 | 1 | 2 |
| Unbreakable Guard | Rare | Resist Damage | 57.0% | 25 | 696 | 988 | 17 | 171 |
| Performance Shifter | Rare | Endurance Modification | 57.0% | 960 | 797 | 0 | 1 | 3 |
| Reactive Defenses | Rare | Defense Sets | 53.7% | 12 | 21 | 9 | 3 | 1614 |
| Superior Avalanche | Superior Winter Pack | Melee AoE Damage | 50.9% | 1113 | 17 | 0 | 35 | 442 |
| Apocalypse | Very Rare | Ranged Damage | 50.2% | 4 | 635 | 0 | 701 | 206 |
| Superior Blistering Cold | Superior Winter Pack | Melee Damage | 48.2% | 1244 | 0 | 1 | 11 | 298 |
| Armageddon | Very Rare | Melee AoE Damage | 43.3% | 6 | 52 | 3 | 982 | 289 |
| Superior Frozen Blast | Superior Winter Pack | Ranged AoE Damage | 41.8% | 1217 | 2 | 0 | 4 | 87 |
| Gladiator's Armor | PvP | Resist Damage | 38.3% | 80 | 719 | 504 | 38 | 23 |
| Titanium Coating | Uncommon | Resist Damage | 37.3% | 75 | 930 | 1017 | 0 | 8 |
| Superior Winter's Bite | Superior Winter Pack | Ranged Damage | 36.5% | 395 | 354 | 0 | 5 | 370 |
| Hecatomb | Very Rare | Melee Damage | 36.1% | 10 | 72 | 5 | 778 | 248 |
| Luck of the Gambler | Rare | Defense Sets | 31.6% | 275 | 1304 | 104 | 24 | 209 |
| Efficacy Adaptor | Uncommon | Endurance Modification | 26.9% | 2 | 938 | 0 | 0 | 1 |
| Ragnarok | Very Rare | Ranged AoE Damage | 23.7% | 5 | 9 | 1 | 709 | 5 |
| Panacea | PvP | Healing | 22.5% | 20 | 15 | 0 | 849 | 3 |
| Positron's Blast | Rare | Ranged AoE Damage | 21.5% | 32 | 95 | 1 | 624 | 39 |
| Synapse's Shock | Rare | Endurance Modification | 18.8% | 18 | 478 | 1 | 63 | 34 |
| Aegis | Rare | Resist Damage | 17.8% | 6 | 253 | 210 | 98 | 110 |
| Adjusted Targeting | Uncommon | To Hit Buff | 15.0% | 5 | 407 | 5 | 49 | 2 |
| Expedient Reinforcement | Rare | Recharge Intensive Pets | 13.9% | 2 | 4 | 260 | 0 | 200 |
| Scirocco's Dervish | Rare | Melee AoE Damage | 12.7% | 6 | 244 | 137 | 37 | 5 |
| Doctored Wounds | Uncommon | Healing | 12.2% | 2 | 454 | 0 | 11 | 71 |
| Ice Mistral's Torment | Rare | Slow Movement | 12.2% | 5 | 78 | 1 | 250 | 60 |
| Thunderstrike | Uncommon | Ranged Damage | 11.9% | 4 | 378 | 1 | 1 | 16 |
| Superior Gauntleted Fist | Superior Archetype Origin | Tanker Archetype Sets | 11.4% | 2 | 163 | 3 | 18 | 186 |
| Gladiator's Javelin | PvP | Ranged Damage | 11.2% | 378 | 1 | 0 | 0 | 0 |
| Superior Might of the Tanker | Superior Archetype Origin | Tanker Archetype Sets | 11.1% | 1 | 19 | 18 | 150 | 152 |
| Superior Unrelenting Fury | Superior Archetype Origin | Brute Archetype Sets | 10.9% | 3 | 0 | 0 | 0 | 333 |
| Superior Sentinel's Ward | Superior Archetype Origin | Sentinel Archetype Sets | 10.8% | 5 | 11 | 1 | 18 | 302 |
| Superior Brute's Fury | Superior Archetype Origin | Brute Archetype Sets | 10.7% | 52 | 5 | 0 | 3 | 270 |
| Sting of the Manticore | Rare | Sniper Attacks | 10.7% | 2 | 230 | 0 | 71 | 25 |
| Superior Scrapper's Strike | Superior Archetype Origin | Scrapper Archetype Sets | 10.3% | 0 | 0 | 0 | 5 | 312 |
| Red Fortune | Uncommon | Defense Sets | 10.1% | 30 | 126 | 6 | 18 | 266 |
| Bombardment | Rare | Ranged AoE Damage | 9.5% | 11 | 40 | 2 | 170 | 175 |
| Unbreakable Constraint | Very Rare | Holds | 9.5% | 26 | 2 | 0 | 261 | 3 |
| Annihilation | Rare | Ranged AoE Damage | 9.4% | 33 | 251 | 0 | 1 | 13 |
| Impervious Skin | Rare | Resist Damage | 9.3% | 5 | 274 | 2 | 7 | 0 |

Set placements by rarity:

| Rarity | Placements | Share |
|---|---|---|
| Rare | 18278 | 38.0% |
| Uncommon | 6844 | 14.2% |
| PvP | 5974 | 12.4% |
| Very Rare | 5815 | 12.1% |
| Superior Winter Pack | 5623 | 11.7% |
| Superior Archetype Origin | 5330 | 11.1% |
| Event | 245 | 0.5% |
| Archetype Origin | 25 | 0.1% |
| Winter Pack | 1 | 0.0% |

Sets no counted build slots for a bonus: 54 of 227.

## Unique pieces

Pieces whose own global effect a build earns, by share of builds.

| Piece | Builds |
|---|---|
| Luck of the Gambler: Defense/Increased Global Recharge Speed | 99.9% |
| Reactive Defenses: Scaling Damage Resistance | 94.8% |
| Steadfast Protection: Resistance/Defense | 88.9% |
| Gladiator's Armor: Teleportation Protection, +Def(All) | 88.4% |
| Shield Wall: Teleportation Protection, +Res(All) | 84.8% |
| Preventive Medicine: Absorb Proc | 82.3% |
| Unbreakable Guard: +7.5% Max HP | 67.1% |
| Winter's Gift: Slow Resistance (20%) | 63.1% |
| Synapse's Shock: Endurance Modification/Increased Run Speed | 43.0% |
| Aegis: Psionic/Status Resistance | 20.7% |
| Impervious Skin: Status Resistance/Regeneration | 16.0% |
| Expedient Reinforcement: Resist Bonus Aura for Pets | 11.5% |
| Superior Brute's Fury: Recharge/Fury Bonus | 10.7% |
| Impervium Armor: Psionic Resistance | 10.3% |
| Superior Scrapper's Strike: Recharge/Critical Hit Bonus | 10.3% |
| Steadfast Protection: Knockback Protection | 7.0% |
| Gift of the Ancients: Defense/Increased Run Speed | 6.5% |
| Blessing of the Zephyr: Knockback Reduction (4 points) | 5.8% |
| Sovereign Right: Resistance Bonus | 5.2% |
| Superior Mark of Supremacy: Endurance/Pet +Resist(All) and +Regen Aura (Mastermind) | 4.1% |
| Rectified Reticle: Increased Perception | 3.7% |
| Karma: Knockback Protection | 3.2% |
| Call to Arms: Defense Bonus Aura for Pets | 3.1% |
| Superior Command of the Mastermind: Recharge/Pet +AoE Defense Aura | 3.1% |
| Edict of the Master: Defense Bonus | 2.7% |
| Superior Spider's Bite: Recharge/Global Chance for Toxic DMG (Soldier of Arachnos) | 0.6% |
| Superior Kheldian's Grace: Recharge/Form Empowerment | 0.3% |
| Brute's Fury: Recharge/Fury Bonus | 0.1% |
| Command of the Mastermind: Recharge/Pet +AoE Defense Aura | 0.0% |
| Mark of Supremacy: Endurance/Pet +Resist(All) and +Regen Aura (Mastermind) | 0.0% |

## Slotting habits

| Measure | Value |
|---|---|
| Slots per build (mean) | 97.0 |
| Slots left empty | 5.4% |
| Set pieces that are attuned | 17.7% |
| Enhancements carrying boosters | 10.7% |
| Bonus copies lost to the rule of 5, per build (mean) | 0.06 |
| Builds slotting at least one proc | 100.0% |
| Procs per build (mean) | 15.9 |

Enhancements by family:

| Family | Share |
|---|---|
| Set | 95.4% |
| Invention | 4.1% |
| Hamidon | 0.3% |
| DSync | 0.2% |

Crafted set pieces by level (the 8 most used):

| Level | Share |
|---|---|
| 50 | 86.7% |
| 30 | 7.8% |
| 40 | 4.0% |
| 20 | 1.4% |
| 35 | 0.1% |
| 21 | 0.0% |
| 25 | 0.0% |
