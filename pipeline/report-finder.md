# Build research report -- data i28p4

Generated 2026-11-17T16:47:10Z (UTC) by `npm run research`. Aggregates only; the builds themselves stay on the machine that ran it.

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
| Farm builds (left out of the values) | 60 |
| **Builds counted** | **3016** |

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
| Tanker | 402 |  |
| Brute | 347 |  |
| Sentinel | 338 |  |
| Scrapper | 320 |  |
| Blaster | 290 |  |
| Controller | 257 |  |
| Stalker | 247 |  |
| Dominator | 243 |  |
| Corruptor | 219 |  |
| Defender | 188 |  |
| Mastermind | 134 |  |
| Arachnos Soldier | 12 | under 25: uses the all-archetype values |
| Peacebringer | 8 | under 25: uses the all-archetype values |
| Arachnos Widow | 7 | under 25: uses the all-archetype values |
| Warshade | 4 | under 25: uses the all-archetype values |

## Stat values, all archetypes

Share: the mean share of a build's set bonuses spent on the stat, counted in typical bonuses. Offered: the stat's share of every set bonus in the game. Lift = share / offered: over 1 means builds seek the stat out.

| Stat | Share | Offered | Lift |
|---|---|---|---|
| Max HP | 14.1% | 9.9% | 1.42 |
| Recharge | 12.3% | 7.9% | 1.56 |
| Damage resistance | 11.9% | 12.5% | 0.95 |
| Status resistance | 11.0% | 12.3% | 0.90 |
| Recovery | 9.5% | 9.2% | 1.03 |
| Defense | 9.4% | 19.4% | 0.48 |
| Accuracy | 6.8% | 5.5% | 1.23 |
| Regeneration | 6.2% | 5.4% | 1.16 |
| Damage | 5.0% | 7.0% | 0.71 |
| Debuff resistance | 4.7% | 2.1% | 2.17 |
| Endurance Reduction | 3.0% | 0.8% | 3.75 |
| Movement | 2.3% | 3.1% | 0.73 |
| Max Endurance | 2.3% | 3.6% | 0.63 |
| Range | 0.9% | 0.5% | 1.72 |
| Status protection | 0.8% | 0.7% | 1.09 |

### Defense, type by type

| Stat | Share | Lift | Typical bonus | Median total | Median from set bonuses |
|---|---|---|---|---|---|
| Smashing (Def) | 1.4% | 0.80 | 1.6% | 22.5% | 3.3% |
| Lethal (Def) | 1.4% | 0.80 | 1.6% | 22.6% | 3.3% |
| Melee (Def) | 1.3% | 0.87 | 2.0% | 22.2% | 5.0% |
| Energy (Def) | 1.1% | 0.50 | 1.6% | 22.1% | 1.9% |
| Negative Energy (Def) | 1.1% | 0.50 | 1.6% | 21.7% | 1.9% |
| Fire (Def) | 0.9% | 0.32 | 1.6% | 18.7% | 0.0% |
| Cold (Def) | 0.9% | 0.32 | 1.6% | 18.7% | 0.0% |
| Ranged (Def) | 0.8% | 0.43 | 2.5% | 19.5% | 2.5% |
| Area (Def) | 0.5% | 0.24 | 2.5% | 17.2% | 0.0% |
| Psionic (Def) | 0.2% | 0.20 | 3.1% | 16.9% | 0.0% |
| Toxic (Def) | 0.0% | 0.00 | 0.0% | 16.2% | 0.0% |

### Damage resistance, type by type

| Stat | Share | Lift | Typical bonus | Median total | Median from set bonuses |
|---|---|---|---|---|---|
| Fire (Res) | 2.2% | 1.24 | 3.0% | 35.0% | 17.3% |
| Cold (Res) | 2.2% | 1.24 | 3.0% | 32.8% | 17.3% |
| Smashing (Res) | 1.7% | 1.00 | 2.3% | 57.5% | 9.8% |
| Lethal (Res) | 1.7% | 1.00 | 2.3% | 57.1% | 9.8% |
| Energy (Res) | 1.6% | 1.48 | 2.7% | 32.0% | 9.8% |
| Negative Energy (Res) | 1.6% | 1.48 | 2.7% | 27.4% | 9.8% |
| Psionic (Res) | 0.4% | 0.24 | 3.8% | 18.9% | 3.0% |
| Toxic (Res) | 0.4% | 0.24 | 3.8% | 26.1% | 3.0% |

### Everything else

| Stat | Share | Lift | Typical bonus | Median total | Median from set bonuses |
|---|---|---|---|---|---|
| Max HP | 14.1% | 1.42 | 19.2 | 1466.8 | 158.1 |
| Recharge | 12.3% | 1.56 | 6.3% | 141.3% | 48.8% |
| Recovery | 9.5% | 1.03 | 2.1% | 83.4% | 12.5% |
| Accuracy | 6.8% | 1.23 | 9.0% | 39.0% | 38.0% |
| Regeneration | 6.2% | 1.16 | 10.0% | 124.4% | 38.0% |
| Endurance Reduction | 3.0% | 3.75 | 3.0% | 6.3% | 6.3% |
| Max Endurance | 2.3% | 0.63 | 1.80 | 3.60 | 2.25 |
| Confuse (Res) | 1.8% | 0.90 | 5.0% | 86.3% | 65.0% |
| Hold (Res) | 1.8% | 0.90 | 5.0% | 75.0% | 65.0% |
| Immobilize (Res) | 1.8% | 0.90 | 5.0% | 116.8% | 65.0% |
| Sleep (Res) | 1.8% | 0.90 | 5.0% | 127.2% | 65.0% |
| Stun (Res) | 1.8% | 0.90 | 5.0% | 73.8% | 65.0% |
| Terrorize (Res) | 1.8% | 0.90 | 5.0% | 86.3% | 65.0% |
| RechargeTime (Res) | 1.6% | 2.17 | 10.0% | 60.0% | 30.0% |
| SpeedFlying (Res) | 1.6% | 2.17 | 10.0% | 55.0% | 30.0% |
| SpeedRunning (Res) | 1.6% | 2.17 | 10.0% | 55.0% | 30.0% |
| Range | 0.9% | 1.72 | 5.9% | 0.0% | 0.0% |
| Fly Speed | 0.6% | 0.73 | 6.0% | 21.1% | 7.5% |
| Jump Height | 0.6% | 0.73 | 6.0% | 374.3% | 7.5% |
| Jump Speed | 0.6% | 0.73 | 6.0% | 133.0% | 7.5% |
| Run Speed | 0.6% | 0.73 | 6.0% | 57.5% | 7.5% |
| Knockback (Prot) | 0.4% | 1.09 | 3.00 | 9.00 | 0.00 |
| Knockup (Prot) | 0.4% | 1.09 | 3.00 | 9.00 | 0.00 |

## Stat values by archetype

Share of set-bonus spend by stat family, largest first (lift in brackets).

| Archetype | Builds | Top families |
|---|---|---|
| Tanker | 402 | Damage resistance 16.0% (1.23), Max HP 15.7% (1.59), Status resistance 15.3% (1.18), Recharge 9.8% (1.30), Recovery 7.7% (0.83), Regeneration 7.0% (1.25) |
| Brute | 347 | Damage resistance 16.4% (1.27), Status resistance 15.0% (1.17), Max HP 14.6% (1.47), Defense 9.9% (0.51), Recovery 8.6% (0.98), Recharge 8.1% (1.05) |
| Sentinel | 338 | Max HP 14.9% (1.49), Defense 12.3% (0.64), Recharge 11.9% (1.48), Damage resistance 10.8% (0.88), Status resistance 9.8% (0.82), Recovery 8.1% (0.86) |
| Scrapper | 320 | Max HP 15.9% (1.62), Damage resistance 13.4% (1.08), Status resistance 11.8% (0.99), Recharge 10.6% (1.33), Defense 10.4% (0.53), Recovery 9.8% (1.01) |
| Blaster | 290 | Recharge 13.1% (1.63), Max HP 13.0% (1.30), Defense 10.1% (0.52), Recovery 9.4% (1.00), Damage resistance 8.5% (0.70), Status resistance 7.9% (0.66) |
| Controller | 257 | Recharge 15.0% (1.93), Max HP 13.9% (1.38), Recovery 10.6% (1.20), Damage resistance 9.5% (0.76), Status resistance 8.8% (0.72), Defense 8.8% (0.44) |
| Stalker | 247 | Damage resistance 13.2% (1.07), Status resistance 11.8% (0.98), Max HP 11.7% (1.24), Defense 11.7% (0.59), Recharge 11.4% (1.43), Recovery 10.3% (1.06) |
| Dominator | 243 | Recharge 14.9% (1.92), Recovery 13.8% (1.56), Defense 10.5% (0.54), Accuracy 10.4% (1.83), Max HP 9.9% (0.98), Damage resistance 9.4% (0.74) |
| Corruptor | 219 | Recharge 14.9% (1.84), Max HP 14.6% (1.46), Recovery 9.8% (1.10), Defense 9.1% (0.47), Damage resistance 9.0% (0.74), Status resistance 8.6% (0.71) |
| Defender | 188 | Recharge 15.9% (1.98), Max HP 14.9% (1.50), Recovery 9.8% (1.04), Damage resistance 8.5% (0.70), Status resistance 8.0% (0.67), Defense 7.5% (0.39) |
| Mastermind | 134 | Recharge 15.7% (1.97), Max HP 14.8% (1.49), Damage resistance 11.5% (0.88), Status resistance 10.9% (0.84), Accuracy 7.8% (1.40), Recovery 7.5% (0.86) |
| Arachnos Soldier | 12 | Max HP 14.8% (1.43), Defense 13.9% (0.73), Recharge 10.5% (1.37), Damage resistance 9.8% (0.80), Status resistance 9.2% (0.77), Recovery 8.9% (0.96) |
| Peacebringer | 8 | Max HP 14.1% (1.42), Recharge 14.0% (1.76), Recovery 13.2% (1.41), Damage resistance 10.4% (0.83), Defense 10.2% (0.53), Status resistance 10.1% (0.82) |
| Arachnos Widow | 7 | Max HP 16.2% (1.56), Recharge 13.3% (1.74), Recovery 12.0% (1.29), Damage resistance 9.0% (0.73), Accuracy 8.8% (1.60), Damage 8.3% (1.36) |
| Warshade | 4 | Recharge 18.1% (2.26), Max HP 18.0% (1.82), Recovery 11.1% (1.19), Accuracy 8.7% (1.57), Damage resistance 8.3% (0.67), Status resistance 7.9% (0.64) |

## Needs: status protection added with enhancements

Share of a group's builds whose enhancements (set bonuses, globals or the pieces themselves) add protection, where at least half do.

| Group | Kind | Stat | Builds adding it | Typical amount |
|---|---|---|---|---|
| Defender | Archetype | Knockback (Prot) | 79.8% | 3.00 |
| Defender | Archetype | Knockup (Prot) | 79.8% | 3.00 |
| Corruptor | Archetype | Knockback (Prot) | 75.3% | 3.00 |
| Corruptor | Archetype | Knockup (Prot) | 75.3% | 3.00 |
| Blaster | Archetype | Knockback (Prot) | 71.4% | 3.00 |
| Blaster | Archetype | Knockup (Prot) | 71.4% | 3.00 |
| Controller | Archetype | Knockback (Prot) | 67.3% | 3.00 |
| Controller | Archetype | Knockup (Prot) | 67.3% | 3.00 |
| Mastermind | Archetype | Knockback (Prot) | 66.4% | 4.00 |
| Mastermind | Archetype | Knockup (Prot) | 66.4% | 4.00 |
| Dominator | Archetype | Knockback (Prot) | 63.4% | 3.00 |
| Dominator | Archetype | Knockup (Prot) | 63.4% | 3.00 |
| Fire Blast | Blaster Ranged | Knockback (Prot) | 78.1% | 3.00 |
| Fire Blast | Blaster Ranged | Knockup (Prot) | 78.1% | 3.00 |
| Dual Pistols | Blaster Ranged | Knockback (Prot) | 76.0% | 3.00 |
| Dual Pistols | Blaster Ranged | Knockup (Prot) | 76.0% | 3.00 |
| Fire Manipulation | Blaster Support | Knockback (Prot) | 75.0% | 3.00 |
| Fire Manipulation | Blaster Support | Knockup (Prot) | 75.0% | 3.00 |
| Devices | Blaster Support | Knockback (Prot) | 73.1% | 3.00 |
| Devices | Blaster Support | Knockup (Prot) | 73.1% | 3.00 |
| Dark Armor | Brute Defense | Knockback (Prot) | 100.0% | 7.00 |
| Dark Armor | Brute Defense | Knockup (Prot) | 100.0% | 7.00 |
| Fiery Aura | Brute Defense | Knockback (Prot) | 85.7% | 7.00 |
| Fiery Aura | Brute Defense | Knockup (Prot) | 85.7% | 7.00 |
| Darkness Affinity | Controller Buff | Knockback (Prot) | 68.0% | 4.00 |
| Darkness Affinity | Controller Buff | Knockup (Prot) | 68.0% | 4.00 |
| Gravity Control | Controller Control | Knockback (Prot) | 80.0% | 3.00 |
| Gravity Control | Controller Control | Knockup (Prot) | 80.0% | 3.00 |
| Illusion Control | Controller Control | Knockback (Prot) | 78.4% | 3.00 |
| Illusion Control | Controller Control | Knockup (Prot) | 78.4% | 3.00 |
| Pyrotechnic Control | Controller Control | Knockback (Prot) | 57.7% | 3.00 |
| Pyrotechnic Control | Controller Control | Knockup (Prot) | 57.7% | 3.00 |
| Water Blast | Corruptor Ranged | Knockback (Prot) | 85.2% | 3.00 |
| Water Blast | Corruptor Ranged | Knockup (Prot) | 85.2% | 3.00 |
| Savage Assault | Dominator Assault | Knockback (Prot) | 60.0% | 3.00 |
| Savage Assault | Dominator Assault | Knockup (Prot) | 60.0% | 3.00 |
| Darkness Control | Dominator Control | Knockback (Prot) | 76.0% | 3.00 |
| Darkness Control | Dominator Control | Knockup (Prot) | 76.0% | 3.00 |
| Dark Armor | Scrapper Defense | Knockback (Prot) | 96.0% | 9.00 |
| Dark Armor | Scrapper Defense | Knockup (Prot) | 96.0% | 9.00 |
| Fiery Aura | Sentinel Defense | Knockback (Prot) | 75.0% | 7.50 |
| Fiery Aura | Sentinel Defense | Knockup (Prot) | 75.0% | 7.50 |
| Dark Armor | Sentinel Defense | Knockback (Prot) | 69.2% | 7.50 |
| Dark Armor | Sentinel Defense | Knockup (Prot) | 69.2% | 7.50 |
| Dark Armor | Stalker Defense | Knockback (Prot) | 100.0% | 10.0 |
| Dark Armor | Stalker Defense | Knockup (Prot) | 100.0% | 10.0 |
| Dark Armor | Tanker Defense | Knockback (Prot) | 100.0% | 7.00 |
| Dark Armor | Tanker Defense | Knockup (Prot) | 100.0% | 7.00 |
| Fiery Aura | Tanker Defense | Knockback (Prot) | 86.7% | 7.50 |
| Fiery Aura | Tanker Defense | Knockup (Prot) | 86.7% | 7.50 |

## Sets

The 40 sets most often slotted for a bonus (2 or more pieces in one power).

| Set | Rarity | Category | Builds | x2 | x3 | x4 | x5 | x6 |
|---|---|---|---|---|---|---|---|---|
| Shield Wall | PvP | Defense Sets | 66.0% | 2 | 42 | 3028 | 1 | 2 |
| Preventive Medicine | Rare | Healing | 65.5% | 91 | 644 | 11 | 0 | 1490 |
| Unbreakable Guard | Rare | Resist Damage | 58.1% | 24 | 696 | 984 | 17 | 171 |
| Performance Shifter | Rare | Endurance Modification | 57.2% | 944 | 786 | 0 | 1 | 2 |
| Reactive Defenses | Rare | Defense Sets | 54.4% | 10 | 21 | 7 | 3 | 1607 |
| Apocalypse | Very Rare | Ranged Damage | 50.7% | 4 | 631 | 0 | 691 | 206 |
| Superior Avalanche | Superior Winter Pack | Melee AoE Damage | 50.4% | 1113 | 13 | 0 | 34 | 402 |
| Superior Blistering Cold | Superior Winter Pack | Melee Damage | 48.0% | 1243 | 0 | 1 | 9 | 268 |
| Armageddon | Very Rare | Melee AoE Damage | 43.4% | 5 | 44 | 3 | 969 | 289 |
| Superior Frozen Blast | Superior Winter Pack | Ranged AoE Damage | 41.3% | 1217 | 1 | 0 | 3 | 48 |
| Gladiator's Armor | PvP | Resist Damage | 39.1% | 80 | 718 | 504 | 38 | 23 |
| Titanium Coating | Uncommon | Resist Damage | 38.0% | 75 | 930 | 1017 | 0 | 8 |
| Superior Winter's Bite | Superior Winter Pack | Ranged Damage | 36.4% | 395 | 354 | 0 | 4 | 347 |
| Hecatomb | Very Rare | Melee Damage | 36.0% | 8 | 67 | 3 | 761 | 248 |
| Luck of the Gambler | Rare | Defense Sets | 31.3% | 259 | 1294 | 77 | 18 | 209 |
| Efficacy Adaptor | Uncommon | Endurance Modification | 27.4% | 2 | 938 | 0 | 0 | 1 |
| Ragnarok | Very Rare | Ranged AoE Damage | 23.7% | 4 | 6 | 1 | 700 | 5 |
| Panacea | PvP | Healing | 22.8% | 20 | 15 | 0 | 843 | 3 |
| Positron's Blast | Rare | Ranged AoE Damage | 21.2% | 18 | 76 | 1 | 618 | 39 |
| Synapse's Shock | Rare | Endurance Modification | 19.1% | 17 | 476 | 1 | 63 | 34 |
| Aegis | Rare | Resist Damage | 16.3% | 6 | 170 | 207 | 50 | 110 |
| Adjusted Targeting | Uncommon | To Hit Buff | 15.0% | 3 | 406 | 5 | 43 | 2 |
| Expedient Reinforcement | Rare | Recharge Intensive Pets | 14.2% | 2 | 4 | 259 | 0 | 200 |
| Scirocco's Dervish | Rare | Melee AoE Damage | 12.5% | 3 | 242 | 136 | 19 | 5 |
| Doctored Wounds | Uncommon | Healing | 12.4% | 2 | 454 | 0 | 11 | 71 |
| Ice Mistral's Torment | Rare | Slow Movement | 12.3% | 5 | 78 | 1 | 248 | 60 |
| Thunderstrike | Uncommon | Ranged Damage | 12.1% | 3 | 377 | 1 | 1 | 16 |
| Superior Gauntleted Fist | Superior Archetype Origin | Tanker Archetype Sets | 11.5% | 1 | 163 | 3 | 18 | 185 |
| Gladiator's Javelin | PvP | Ranged Damage | 11.2% | 372 | 1 | 0 | 0 | 0 |
| Superior Might of the Tanker | Superior Archetype Origin | Tanker Archetype Sets | 11.1% | 1 | 19 | 14 | 150 | 151 |
| Superior Unrelenting Fury | Superior Archetype Origin | Brute Archetype Sets | 11.0% | 0 | 0 | 0 | 0 | 333 |
| Superior Sentinel's Ward | Superior Archetype Origin | Sentinel Archetype Sets | 11.0% | 5 | 11 | 1 | 18 | 302 |
| Superior Brute's Fury | Superior Archetype Origin | Brute Archetype Sets | 10.8% | 52 | 5 | 0 | 1 | 270 |
| Sting of the Manticore | Rare | Sniper Attacks | 10.8% | 2 | 228 | 0 | 71 | 25 |
| Superior Scrapper's Strike | Superior Archetype Origin | Scrapper Archetype Sets | 10.5% | 0 | 0 | 0 | 5 | 312 |
| Red Fortune | Uncommon | Defense Sets | 10.0% | 30 | 126 | 5 | 10 | 265 |
| Bombardment | Rare | Ranged AoE Damage | 9.6% | 8 | 39 | 2 | 169 | 175 |
| Unbreakable Constraint | Very Rare | Holds | 9.6% | 26 | 2 | 0 | 259 | 3 |
| Impervious Skin | Rare | Resist Damage | 9.5% | 5 | 274 | 2 | 7 | 0 |
| Superior Defiant Barrage | Superior Archetype Origin | Blaster Archetype Sets | 9.4% | 1 | 0 | 0 | 142 | 141 |

Set placements by rarity:

| Rarity | Placements | Share |
|---|---|---|
| Rare | 17773 | 37.6% |
| Uncommon | 6767 | 14.3% |
| PvP | 5924 | 12.5% |
| Very Rare | 5717 | 12.1% |
| Superior Winter Pack | 5478 | 11.6% |
| Superior Archetype Origin | 5305 | 11.2% |
| Event | 242 | 0.5% |
| Archetype Origin | 25 | 0.1% |
| Winter Pack | 1 | 0.0% |

Sets no counted build slots for a bonus: 56 of 227.

## Unique pieces

Pieces whose own global effect a build earns, by share of builds.

| Piece | Builds |
|---|---|
| Luck of the Gambler: Defense/Increased Global Recharge Speed | 99.9% |
| Reactive Defenses: Scaling Damage Resistance | 95.8% |
| Steadfast Protection: Resistance/Defense | 88.8% |
| Gladiator's Armor: Teleportation Protection, +Def(All) | 88.4% |
| Shield Wall: Teleportation Protection, +Res(All) | 85.4% |
| Preventive Medicine: Absorb Proc | 82.1% |
| Unbreakable Guard: +7.5% Max HP | 67.4% |
| Winter's Gift: Slow Resistance (20%) | 63.8% |
| Synapse's Shock: Endurance Modification/Increased Run Speed | 43.6% |
| Aegis: Psionic/Status Resistance | 21.0% |
| Impervious Skin: Status Resistance/Regeneration | 16.1% |
| Expedient Reinforcement: Resist Bonus Aura for Pets | 11.6% |
| Superior Brute's Fury: Recharge/Fury Bonus | 10.8% |
| Impervium Armor: Psionic Resistance | 10.5% |
| Superior Scrapper's Strike: Recharge/Critical Hit Bonus | 10.5% |
| Steadfast Protection: Knockback Protection | 7.1% |
| Gift of the Ancients: Defense/Increased Run Speed | 6.3% |
| Blessing of the Zephyr: Knockback Reduction (4 points) | 5.8% |
| Sovereign Right: Resistance Bonus | 5.3% |
| Superior Mark of Supremacy: Endurance/Pet +Resist(All) and +Regen Aura (Mastermind) | 4.2% |
| Rectified Reticle: Increased Perception | 3.7% |
| Call to Arms: Defense Bonus Aura for Pets | 3.1% |
| Superior Command of the Mastermind: Recharge/Pet +AoE Defense Aura | 3.1% |
| Karma: Knockback Protection | 2.9% |
| Edict of the Master: Defense Bonus | 2.8% |
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
| Bonus copies lost to the rule of 5, per build (mean) | 0.05 |
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
