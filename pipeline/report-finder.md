# Build research report -- data i28p4

Generated 2026-11-16T23:03:36Z (UTC) by `npm run research`. Aggregates only; the builds themselves stay on the machine that ran it.

## What was read

| Item | Count |
|---|---|
| .mbd files | 2200 |
| Share codes in text files and saved pages | 74 |
| Files over the size limit (left out) | 0 |
| Text files and pages with no share code | 0 |
| Other files (left alone) | 0 |
| Made on another server's Mids database (left out) | 3 |
| Could not be imported | 71 |
| Imported | 2200 |
| Imported without a picked power that could not be placed (counted without it) | 304 |
| Too empty to count (under 12 powers or 20 enhancements) | 0 |
| Copies of another build (left out) | 2 |
| Farm builds (left out of the values) | 60 |
| **Builds counted** | **2138** |

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
| 2024 | 450 |
| 2025 | 747 |
| 2026 | 811 |
| legacy share code | 3 |

## Import check

Every build was imported against i28p4 with the planner's own Mids importer. 1915 of 2200 imported with no warning.

### Builds that could not be imported

| Reason | Builds |
|---|---|
| the Mids share code is damaged | 71 |

### Warning: a power is not in the game data (333)

| Item | Times |
|---|---|
| Psychokinetic Barrier (Psionic Armor) | 87 |
| Reactive Regeneration (Regeneration) | 54 |
| Power of the Depths (Marine Affinity) | 47 |
| Multipurpose Missiles (Pyrotechnic Control) | 27 |
| Sparkling Chain (Pyrotechnic Control) | 25 |
| Conserve Power (Energy Aura) | 15 |
| Power Armor (Energy Aura) | 15 |
| Tri Cannon (Arsenal Control) | 15 |
| Sound Booster (Sonic Melee) | 9 |
| Umbral Torrent (Dark Mastery Controller) | 9 |
| Elbow Strike (Arsenal Assault) | 7 |
| Smoke Canister (Arsenal Control) | 6 |
| Assassins Whisper (Sonic Melee) | 3 |
| Bo Ryaku Clone (Ninjitsu) | 3 |
| FRT Fate Sealed (Fortunata Teamwork) | 3 |
| Build Up (Ice Mastery DefCorr) | 2 |
| Umbral Torrent (Dark Mastery Dominator) | 2 |
| NW Pain Tolerance (Widow Teamwork) | 1 |
| Quantum Acceleration (Inherent) | 1 |
| Rime (Ice Armor) | 1 |
| Up to the Challenge Clone (Willpower) | 1 |

### Repairs by checkBuild

| Repair | Times |
|---|---|
| unfinished build: stopped at level N | 304 |
| Explosive Blast: dropped a bad slot | 4 |

### Rule issues the planner flags (502 builds)

A Mids build can break a game rule Mids does not check, so these are leads to look into, not proven planner faults.

| Issue | Builds |
|---|---|
| Level N has N slots placed but grants N | 316 |
| This power can't take it | 126 |
| Available at level N | 109 |
| Not allowed at this level | 13 |
| Slot is below the power level | 10 |
| Not available to this archetype | 9 |
| Choose a secondary power now | 4 |
| Choose a primary power now | 2 |
| Made at levels N to N | 1 |
| Relative level goes up to +N | 1 |
| Requirements not met | 1 |

## Builds counted, by archetype

| Archetype | Builds | Note |
|---|---|---|
| Tanker | 326 |  |
| Brute | 270 |  |
| Scrapper | 256 |  |
| Blaster | 206 |  |
| Controller | 176 |  |
| Stalker | 168 |  |
| Corruptor | 163 |  |
| Dominator | 158 |  |
| Defender | 157 |  |
| Sentinel | 153 |  |
| Mastermind | 87 |  |
| Peacebringer | 6 | under 25: uses the all-archetype values |
| Arachnos Widow | 5 | under 25: uses the all-archetype values |
| Arachnos Soldier | 4 | under 25: uses the all-archetype values |
| Warshade | 3 | under 25: uses the all-archetype values |

## Stat values, all archetypes

Share: the mean share of a build's set bonuses spent on the stat, counted in typical bonuses. Offered: the stat's share of every set bonus in the game. Lift = share / offered: over 1 means builds seek the stat out.

| Stat | Share | Offered | Lift |
|---|---|---|---|
| Max HP | 15.2% | 9.9% | 1.53 |
| Recharge | 12.9% | 7.9% | 1.64 |
| Damage resistance | 11.9% | 12.5% | 0.96 |
| Status resistance | 11.0% | 12.3% | 0.89 |
| Recovery | 9.5% | 9.2% | 1.03 |
| Accuracy | 6.9% | 5.5% | 1.26 |
| Regeneration | 6.8% | 5.4% | 1.26 |
| Defense | 5.7% | 19.6% | 0.29 |
| Debuff resistance | 5.6% | 2.1% | 2.60 |
| Damage | 4.5% | 6.9% | 0.66 |
| Endurance Reduction | 3.3% | 0.8% | 4.08 |
| Movement | 2.8% | 3.2% | 0.90 |
| Max Endurance | 2.1% | 3.6% | 0.59 |
| Status protection | 1.1% | 0.7% | 1.52 |
| Range | 0.7% | 0.5% | 1.31 |

### Defense, type by type

| Stat | Share | Lift | Typical bonus | Median total | Median from set bonuses |
|---|---|---|---|---|---|
| Smashing (Def) | 1.1% | 0.61 | 1.6% | 20.6% | 1.6% |
| Lethal (Def) | 1.1% | 0.61 | 1.6% | 20.6% | 1.6% |
| Melee (Def) | 1.0% | 0.66 | 2.0% | 20.4% | 3.1% |
| Energy (Def) | 0.6% | 0.29 | 1.6% | 20.1% | 0.0% |
| Negative Energy (Def) | 0.6% | 0.29 | 1.6% | 19.7% | 0.0% |
| Ranged (Def) | 0.5% | 0.29 | 2.5% | 18.4% | 0.0% |
| Fire (Def) | 0.3% | 0.11 | 1.6% | 17.2% | 0.0% |
| Cold (Def) | 0.3% | 0.11 | 1.6% | 17.2% | 0.0% |
| Area (Def) | 0.2% | 0.09 | 2.5% | 16.9% | 0.0% |
| Psionic (Def) | 0.0% | 0.02 | 3.1% | 17.0% | 0.0% |
| Toxic (Def) | 0.0% | 0.00 | 0.0% | 16.3% | 0.0% |

### Damage resistance, type by type

| Stat | Share | Lift | Typical bonus | Median total | Median from set bonuses |
|---|---|---|---|---|---|
| Fire (Res) | 2.3% | 1.25 | 3.0% | 35.0% | 15.0% |
| Cold (Res) | 2.3% | 1.25 | 3.0% | 33.0% | 15.0% |
| Energy (Res) | 1.9% | 1.74 | 2.7% | 36.5% | 11.3% |
| Negative Energy (Res) | 1.9% | 1.74 | 2.7% | 29.9% | 11.3% |
| Smashing (Res) | 1.6% | 0.91 | 2.3% | 59.5% | 6.8% |
| Lethal (Res) | 1.6% | 0.91 | 2.3% | 58.3% | 6.8% |
| Psionic (Res) | 0.3% | 0.15 | 3.8% | 16.3% | 0.0% |
| Toxic (Res) | 0.3% | 0.15 | 3.8% | 24.3% | 0.0% |

### Everything else

| Stat | Share | Lift | Typical bonus | Median total | Median from set bonuses |
|---|---|---|---|---|---|
| Max HP | 15.2% | 1.53 | 19.5 | 1504.0 | 162.6 |
| Recharge | 12.9% | 1.64 | 6.3% | 152.5% | 47.5% |
| Recovery | 9.5% | 1.03 | 2.1% | 78.2% | 11.5% |
| Accuracy | 6.9% | 1.26 | 9.0% | 33.0% | 31.0% |
| Regeneration | 6.8% | 1.26 | 10.0% | 106.0% | 38.0% |
| Endurance Reduction | 3.3% | 4.08 | 3.0% | 6.3% | 6.3% |
| Max Endurance | 2.1% | 0.59 | 1.80 | 1.80 | 1.57 |
| RechargeTime (Res) | 1.9% | 2.60 | 10.0% | 65.0% | 30.0% |
| SpeedFlying (Res) | 1.9% | 2.60 | 10.0% | 65.0% | 30.0% |
| SpeedRunning (Res) | 1.9% | 2.60 | 10.0% | 65.0% | 30.0% |
| Confuse (Res) | 1.8% | 0.89 | 5.0% | 83.8% | 60.0% |
| Hold (Res) | 1.8% | 0.89 | 5.0% | 65.0% | 60.0% |
| Immobilize (Res) | 1.8% | 0.89 | 5.0% | 113.4% | 60.0% |
| Sleep (Res) | 1.8% | 0.89 | 5.0% | 120.9% | 60.0% |
| Stun (Res) | 1.8% | 0.89 | 5.0% | 67.5% | 60.0% |
| Terrorize (Res) | 1.8% | 0.89 | 5.0% | 84.9% | 60.0% |
| Fly Speed | 0.7% | 0.90 | 6.0% | 21.1% | 7.5% |
| Jump Height | 0.7% | 0.90 | 6.0% | 374.3% | 7.5% |
| Jump Speed | 0.7% | 0.90 | 6.0% | 133.0% | 7.5% |
| Run Speed | 0.7% | 0.90 | 6.0% | 57.5% | 7.5% |
| Range | 0.7% | 1.31 | 5.8% | 0.0% | 0.0% |
| Knockback (Prot) | 0.5% | 1.52 | 3.00 | 8.00 | 3.00 |
| Knockup (Prot) | 0.5% | 1.52 | 3.00 | 8.00 | 3.00 |

## Stat values by archetype

Share of set-bonus spend by stat family, largest first (lift in brackets).

| Archetype | Builds | Top families |
|---|---|---|
| Tanker | 326 | Max HP 16.8% (1.70), Damage resistance 15.7% (1.20), Status resistance 15.0% (1.16), Recharge 10.0% (1.32), Recovery 7.6% (0.81), Regeneration 7.4% (1.33) |
| Brute | 270 | Damage resistance 16.4% (1.29), Max HP 15.6% (1.57), Status resistance 14.9% (1.16), Regeneration 8.4% (1.49), Defense 8.3% (0.43), Recovery 8.2% (0.94) |
| Scrapper | 256 | Max HP 17.0% (1.73), Damage resistance 13.6% (1.09), Status resistance 11.8% (0.98), Recharge 10.6% (1.32), Recovery 9.4% (0.97), Defense 8.7% (0.44) |
| Blaster | 206 | Max HP 14.4% (1.44), Recharge 13.9% (1.73), Recovery 9.5% (1.02), Damage resistance 8.5% (0.70), Accuracy 8.4% (1.51), Status resistance 7.9% (0.67) |
| Controller | 176 | Recharge 17.2% (2.21), Max HP 14.0% (1.39), Recovery 11.3% (1.28), Accuracy 9.4% (1.67), Damage resistance 9.4% (0.75), Status resistance 8.9% (0.73) |
| Stalker | 168 | Damage resistance 13.0% (1.06), Max HP 12.5% (1.32), Status resistance 11.3% (0.94), Recharge 11.2% (1.40), Defense 10.2% (0.51), Recovery 10.0% (1.03) |
| Corruptor | 163 | Recharge 16.0% (1.98), Max HP 15.8% (1.57), Recovery 9.5% (1.08), Damage resistance 9.0% (0.73), Status resistance 8.6% (0.71), Accuracy 7.5% (1.32) |
| Dominator | 158 | Recharge 17.3% (2.22), Recovery 14.8% (1.67), Accuracy 12.8% (2.27), Max HP 9.5% (0.94), Damage resistance 9.2% (0.73), Status resistance 8.8% (0.72) |
| Defender | 157 | Recharge 16.8% (2.09), Max HP 15.5% (1.56), Recovery 10.1% (1.08), Damage resistance 8.5% (0.70), Status resistance 8.0% (0.67), Regeneration 6.4% (1.21) |
| Sentinel | 153 | Max HP 17.2% (1.72), Recharge 11.9% (1.48), Damage resistance 11.4% (0.94), Status resistance 10.1% (0.85), Recovery 7.6% (0.81), Defense 7.3% (0.38) |
| Mastermind | 87 | Recharge 18.6% (2.33), Max HP 16.9% (1.70), Damage resistance 9.1% (0.70), Status resistance 8.8% (0.68), Accuracy 8.8% (1.58), Recovery 7.7% (0.88) |
| Peacebringer | 6 | Recovery 15.9% (1.71), Recharge 15.6% (1.95), Max HP 12.7% (1.28), Defense 10.9% (0.59), Damage resistance 8.0% (0.64), Accuracy 7.9% (1.43) |
| Arachnos Widow | 5 | Max HP 16.4% (1.58), Recovery 14.4% (1.54), Recharge 14.3% (1.87), Accuracy 10.2% (1.85), Damage resistance 9.4% (1.06), Status resistance 8.5% (0.70) |
| Arachnos Soldier | 4 | Max HP 16.0% (1.55), Recharge 12.5% (1.64), Defense 10.4% (0.58), Damage resistance 9.9% (0.81), Damage 9.6% (1.58), Status resistance 9.0% (0.75) |
| Warshade | 3 | Recharge 19.7% (2.47), Max HP 17.1% (1.72), Recovery 13.6% (1.46), Accuracy 10.0% (1.81), Damage resistance 7.8% (0.86), Status resistance 7.3% (0.59) |

## Needs: status protection added with enhancements

Share of a group's builds whose enhancements (set bonuses, globals or the pieces themselves) add protection, where at least half do.

| Group | Kind | Stat | Builds adding it | Typical amount |
|---|---|---|---|---|
| Corruptor | Archetype | Knockback (Prot) | 100.0% | 3.00 |
| Corruptor | Archetype | Knockup (Prot) | 100.0% | 3.00 |
| Mastermind | Archetype | Knockback (Prot) | 100.0% | 4.00 |
| Mastermind | Archetype | Knockup (Prot) | 100.0% | 4.00 |
| Blaster | Archetype | Knockback (Prot) | 99.0% | 3.00 |
| Blaster | Archetype | Knockup (Prot) | 99.0% | 3.00 |
| Dominator | Archetype | Knockback (Prot) | 96.8% | 3.00 |
| Dominator | Archetype | Knockup (Prot) | 96.8% | 3.00 |
| Controller | Archetype | Knockback (Prot) | 96.0% | 3.00 |
| Controller | Archetype | Knockup (Prot) | 96.0% | 3.00 |
| Defender | Archetype | Knockback (Prot) | 94.9% | 3.00 |
| Defender | Archetype | Knockup (Prot) | 94.9% | 3.00 |
| Fire Blast | Blaster Ranged | Knockback (Prot) | 100.0% | 3.00 |
| Fire Blast | Blaster Ranged | Knockup (Prot) | 100.0% | 3.00 |
| Fiery Aura | Brute Defense | Knockback (Prot) | 84.4% | 7.00 |
| Fiery Aura | Brute Defense | Knockup (Prot) | 84.4% | 7.00 |
| Illusion Control | Controller Control | Knockback (Prot) | 96.7% | 3.00 |
| Illusion Control | Controller Control | Knockup (Prot) | 96.7% | 3.00 |
| Dark Armor | Tanker Defense | Knockback (Prot) | 100.0% | 6.00 |
| Dark Armor | Tanker Defense | Knockup (Prot) | 100.0% | 6.00 |
| Fiery Aura | Tanker Defense | Knockback (Prot) | 84.0% | 7.00 |
| Fiery Aura | Tanker Defense | Knockup (Prot) | 84.0% | 7.00 |

## Sets

The 40 sets most often slotted for a bonus (2 or more pieces in one power).

| Set | Rarity | Category | Builds | x2 | x3 | x4 | x5 | x6 |
|---|---|---|---|---|---|---|---|---|
| Shield Wall | PvP | Defense Sets | 91.7% | 2 | 39 | 2987 | 0 | 1 |
| Performance Shifter | Rare | Endurance Modification | 80.5% | 940 | 786 | 0 | 0 | 2 |
| Unbreakable Guard | Rare | Resist Damage | 73.5% | 24 | 691 | 929 | 16 | 21 |
| Preventive Medicine | Rare | Healing | 71.7% | 87 | 641 | 10 | 0 | 1051 |
| Apocalypse | Very Rare | Ranged Damage | 59.5% | 4 | 629 | 0 | 641 | 0 |
| Superior Frozen Blast | Superior Winter Pack | Ranged AoE Damage | 56.4% | 1216 | 1 | 0 | 2 | 10 |
| Superior Blistering Cold | Superior Winter Pack | Melee Damage | 55.3% | 1241 | 0 | 1 | 6 | 6 |
| Gladiator's Armor | PvP | Resist Damage | 55.0% | 80 | 709 | 504 | 38 | 23 |
| Superior Avalanche | Superior Winter Pack | Melee AoE Damage | 53.3% | 1111 | 13 | 0 | 27 | 30 |
| Reactive Defenses | Rare | Defense Sets | 50.1% | 9 | 18 | 7 | 1 | 1040 |
| Armageddon | Very Rare | Melee AoE Damage | 44.5% | 2 | 42 | 2 | 903 | 2 |
| Hecatomb | Very Rare | Melee Damage | 39.2% | 8 | 67 | 3 | 756 | 5 |
| Titanium Coating | Uncommon | Resist Damage | 39.2% | 74 | 295 | 1014 | 0 | 0 |
| Superior Winter's Bite | Superior Winter Pack | Ranged Damage | 35.4% | 395 | 354 | 0 | 1 | 7 |
| Ragnarok | Very Rare | Ranged AoE Damage | 32.2% | 4 | 6 | 1 | 676 | 2 |
| Panacea | PvP | Healing | 30.8% | 18 | 12 | 0 | 819 | 1 |
| Synapse's Shock | Rare | Endurance Modification | 26.3% | 16 | 473 | 1 | 63 | 24 |
| Positron's Blast | Rare | Ranged AoE Damage | 17.8% | 16 | 64 | 0 | 321 | 0 |
| Scirocco's Dervish | Rare | Melee AoE Damage | 16.5% | 2 | 235 | 133 | 11 | 0 |
| Adjusted Targeting | Uncommon | To Hit Buff | 15.8% | 1 | 291 | 5 | 42 | 0 |
| Gladiator's Javelin | PvP | Ranged Damage | 15.3% | 362 | 1 | 0 | 0 | 0 |
| Sting of the Manticore | Rare | Sniper Attacks | 14.1% | 2 | 228 | 0 | 71 | 0 |
| Luck of the Gambler | Rare | Defense Sets | 13.8% | 246 | 114 | 64 | 14 | 0 |
| Aegis | Rare | Resist Damage | 13.2% | 6 | 72 | 205 | 50 | 0 |
| Ice Mistral's Torment | Rare | Slow Movement | 12.9% | 5 | 33 | 1 | 246 | 0 |
| Superior Gauntleted Fist | Superior Archetype Origin | Tanker Archetype Sets | 12.8% | 1 | 163 | 3 | 18 | 110 |
| Unbreakable Constraint | Very Rare | Holds | 12.3% | 3 | 1 | 0 | 259 | 0 |
| Superior Might of the Tanker | Superior Archetype Origin | Tanker Archetype Sets | 12.1% | 1 | 19 | 14 | 150 | 75 |
| Annihilation | Rare | Ranged AoE Damage | 12.1% | 27 | 239 | 0 | 0 | 0 |
| Superior Unrelenting Fury | Superior Archetype Origin | Brute Archetype Sets | 12.0% | 0 | 0 | 0 | 0 | 256 |
| Superior Scrapper's Strike | Superior Archetype Origin | Scrapper Archetype Sets | 11.8% | 0 | 0 | 0 | 5 | 248 |
| Superior Brute's Fury | Superior Archetype Origin | Brute Archetype Sets | 11.7% | 52 | 5 | 0 | 1 | 194 |
| Thunderstrike | Uncommon | Ranged Damage | 10.9% | 3 | 246 | 0 | 0 | 4 |
| Expedient Reinforcement | Rare | Recharge Intensive Pets | 10.4% | 2 | 0 | 256 | 0 | 3 |
| Soulbound Allegiance | Very Rare | Pet Damage | 10.1% | 77 | 141 | 0 | 0 | 0 |
| Touch of the Nictus | Rare | Accurate Healing | 9.6% | 1 | 207 | 0 | 0 | 0 |
| Superior Defiant Barrage | Superior Archetype Origin | Blaster Archetype Sets | 9.4% | 1 | 0 | 0 | 142 | 58 |
| Crushing Impact | Uncommon | Melee Damage | 9.3% | 198 | 2 | 2 | 15 | 1 |
| Reactive Armor | Uncommon | Resist Damage | 8.8% | 1 | 40 | 181 | 2 | 0 |
| Touch of Death | Rare | Melee Damage | 8.8% | 188 | 6 | 0 | 0 | 14 |

Set placements by rarity:

| Rarity | Placements | Share |
|---|---|---|
| Rare | 11476 | 34.5% |
| PvP | 5827 | 17.5% |
| Very Rare | 4750 | 14.3% |
| Superior Winter Pack | 4442 | 13.3% |
| Superior Archetype Origin | 3620 | 10.9% |
| Uncommon | 3034 | 9.1% |
| Event | 106 | 0.3% |
| Archetype Origin | 25 | 0.1% |

Sets no counted build slots for a bonus: 83 of 227.

## Unique pieces

Pieces whose own global effect a build earns, by share of builds.

| Piece | Builds |
|---|---|
| Luck of the Gambler: Defense/Increased Global Recharge Speed | 100.0% |
| Shield Wall: Teleportation Protection, +Res(All) | 97.6% |
| Reactive Defenses: Scaling Damage Resistance | 96.9% |
| Steadfast Protection: Resistance/Defense | 96.8% |
| Gladiator's Armor: Teleportation Protection, +Def(All) | 96.8% |
| Preventive Medicine: Absorb Proc | 94.1% |
| Winter's Gift: Slow Resistance (20%) | 89.8% |
| Unbreakable Guard: +7.5% Max HP | 86.3% |
| Synapse's Shock: Endurance Modification/Increased Run Speed | 48.5% |
| Aegis: Psionic/Status Resistance | 17.6% |
| Superior Scrapper's Strike: Recharge/Critical Hit Bonus | 11.8% |
| Superior Brute's Fury: Recharge/Fury Bonus | 11.7% |
| Impervium Armor: Psionic Resistance | 11.4% |
| Blessing of the Zephyr: Knockback Reduction (4 points) | 7.6% |
| Expedient Reinforcement: Resist Bonus Aura for Pets | 7.0% |
| Rectified Reticle: Increased Perception | 5.1% |
| Steadfast Protection: Knockback Protection | 4.9% |
| Call to Arms: Defense Bonus Aura for Pets | 3.9% |
| Edict of the Master: Defense Bonus | 3.9% |
| Superior Mark of Supremacy: Endurance/Pet +Resist(All) and +Regen Aura (Mastermind) | 3.8% |
| Sovereign Right: Resistance Bonus | 3.8% |
| Superior Command of the Mastermind: Recharge/Pet +AoE Defense Aura | 3.7% |
| Karma: Knockback Protection | 2.7% |
| Superior Spider's Bite: Recharge/Global Chance for Toxic DMG (Soldier of Arachnos) | 0.4% |
| Impervious Skin: Status Resistance/Regeneration | 0.4% |
| Superior Kheldian's Grace: Recharge/Form Empowerment | 0.4% |
| Gift of the Ancients: Defense/Increased Run Speed | 0.2% |
| Brute's Fury: Recharge/Fury Bonus | 0.1% |
| Command of the Mastermind: Recharge/Pet +AoE Defense Aura | 0.1% |
| Mark of Supremacy: Endurance/Pet +Resist(All) and +Regen Aura (Mastermind) | 0.1% |

## Slotting habits

| Measure | Value |
|---|---|
| Slots per build (mean) | 97.0 |
| Slots left empty | 6.0% |
| Set pieces that are attuned | 15.9% |
| Enhancements carrying boosters | 14.6% |
| Bonus copies lost to the rule of 5, per build (mean) | 0.03 |
| Builds slotting at least one proc | 100.0% |
| Procs per build (mean) | 19.1 |

Enhancements by family:

| Family | Share |
|---|---|
| Set | 95.4% |
| Invention | 3.8% |
| Hamidon | 0.4% |
| DSync | 0.3% |

Crafted set pieces by level (the 8 most used):

| Level | Share |
|---|---|
| 50 | 87.1% |
| 30 | 6.6% |
| 40 | 4.4% |
| 20 | 1.9% |
| 35 | 0.0% |
| 21 | 0.0% |
