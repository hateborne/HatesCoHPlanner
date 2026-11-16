# Pipeline report -- data thunderspy ts9-6

Generated 2026-11-15T04:56:38Z (UTC).

## Warnings

- NOTE: this client has no enhancement frame data; 2571 enhancements show homecoming/i28p4's frames (20 matched by set type)

## Decode health

| Bin | Records | Clean | Partial |
|---|---|---|---|
| bin/powers.bin | 20963 | 20963 | 0 |
| bin/powersets.bin | 6660 | 6660 | 0 |
| bin/powercats.bin | 187 | 187 | 0 |
| bin/classes.bin | 15 | 15 | 0 |
| bin/boostsets.bin | 214 | 214 | 0 |
| bin/dim_returns.bin | 8 | 8 | 0 |
| bin/attrib_names.bin | 1 | 1 | 0 |
| bin/boost_effect_above.bin | 1 | 1 | 0 |
| bin/boost_effect_below.bin | 1 | 1 | 0 |
| bin/boost_effect_boosters.bin | 1 | 1 | 0 |
| bin/exemplar_handicaps.bin | 1 | 1 | 0 |
| bin/schedules.bin | 1 | 1 | 0 |
| bin/origins.bin | 5 | 5 | 0 |
| bin/villaindef.bin | 7309 | 7309 | 0 |
| bin/villain_classes.bin | 45 | 45 | 0 |
| bin/clientmessages-en.bin | 81595 | 81595 | 0 |

**Gate: PASS** (0 partial records).

## Export

| Item | Count |
|---|---|
| archetypes | 15 |
| powersets | 388 |
| powers | 3828 |
| boosts | 2571 |
| bonusPowers | 255 |
| boostsets | 214 |

| File | Bytes |
|---|---|
| core.json | 893587 |
| powersets.json | 180742 |
| powers.json | 6918872 |
| boosts.json | 3808014 |

PvP-only effects dropped: 4799. Unresolved references: 1. New IDs: {'power': 0, 'powerset': 0, 'boostset': 0, 'archetype': 0, 'origin': 0}.

Names and descriptions written into the data as text rather than as message keys (shown as written, as the client does): 313.

## Pseudo-pets

248 powers create 285 pseudo-pets whose damage the power info totals (208 pet powers, 3 classes' tables, 242172 bytes in pets/ts9-6.json). EntCreate mods left out: not auto only (a real pet): 255.

## Enhancement frames

The client has no frame data. Borrowed by name: 2551; by set type (conversion group): 20; none (0): none

## Icons

Every icon this server shows is its own copy (public/assets/<server>/), so a later Homecoming redraw can't change it (this server's newest version sets the art for all its versions). 1611 are the same art as the shared icons (difference under 2 of 255) and copy the shared file; the rest:

- Redrawn powers (28; difference in brackets, under 8 is worth a look): BaneSpider_Placate (20.6), ChargeMastery_Thunderstrike (7.2), ElectricControl_JoltingChain (23.4), ElectricControl_SynapticOverload (23.4), ElectricMelee_TargetedChainInduction (22.4), Empathy_Resurrect (23.6), IceFormation_FlashFreeze (10.8), MartialAssault_TrickShot (19.1), MentalControl_Telekinesis (19.5), MissionTeleporter (51.6), MunitionsMastery_BodyArmor (34.5), MunitionsMastery_CryoFreezeRay (30.1), MunitionsMastery_LRMRocket (23.5), MunitionsMastery_SleepGrenade (21.8), MunitionsMastery_Surveillance (31.3), Poison_NoxiousGas (8.8), PowerPunch_Taunt (21.9), ShadowFighting_Taunt (22.6), StoneArmor_Rooted (20.7), StoneMelee_Taunt (16.6), Sword_Hack (7.8), Sword_Slash (7.8), TimeManipulation_FuturePain (37.0), TimeManipulation_TimeLord (38.2), TrickArrow_DebuffDefense (18.8), UmbralAura_ShadowSlip (71.0), UmbralBlast_StarlessStep (29.9), Veteran_TargetAoETeleportTeamToCaster (4.4)
- Redrawn enh (3; difference in brackets, under 8 is worth a look): E_ICON_AdjustedTargeting (26.3), E_ICON_Stagger (11.1), E_POG_BUFF_DEFENSE.tga (5.7)
- Not in the shared icons, powers (160): ArcticMastery_BlockOfIce, ArcticMastery_Chillblains, ArcticMastery_Shiver, AssaultWeapons_ARFlamethrowerIgnite, Awakened_MassLevitate, Awakened_MentalBlast, Awakened_PsionicCut, Awakened_PsionicDart, Awakened_PsionicLash, Awakened_PsionicSlash, Awakened_PsionicThrash, Awakened_PsychicBattery, Awakened_PsychicLash, BattleAxe_Cleave, BattleAxe_Pendulum, ChargeMastery_ElectricShackles, ColdMastery_FlashFreeze, ColdMastery_SnowStorm, DarkMastery_DarkEmbrace, DarkMastery_OppressiveGloom, DarkMastery_SoulTransfer, DarkMiasma_ChillOfTheNight, DarknessControl_SpiritHost, DomDPExecution, DomDPHailOfBullets, DomDPPistolWhip, DomDPPowerBoost, DomDPReactionTime, DualPistols_Aim, E_ICON_Summer_Event, ElectricArmor_SelfBuffRecovery, ElectricControl_ParalyzingBlast, Empathy_Empathize, Empathy_RevitalizationAura, FeralMight_BrutalSwipe, FeralMight_CalloftheWild, FeralMight_FeralBlow, FeralMight_HunterForm, FeralMight_HuntersHowl, FeralMight_NaturesBoon, FeralMight_PackFrenzy, FeralMight_Pounce, FeralMight_PrimalGuile, FeralMight_PrimalStrike, FeralMight_ProwlerForm, FeralMight_SavageBlow, FeralMight_Upheaval, FeralMight_ViciousStrike, ForceField_ForceBubble, IceMastery_FreezingRain, IceMastery_FrostBreath, IceMastery_IceBlast, IllusionMirage, InherentHide, InherentPlacate, Inherent_Resistance, Invisibility_Invisibility, KineticAssault_Coalescence, KineticAssault_CrushingBlast, KineticAssault_DisruptingTorrent, KineticAssault_EnergeticStrike, KineticAssault_ForcefulBlow, KineticAssault_Impulse, KineticAssault_KineticBolt, KineticAssault_KineticShockwave, KineticAssault_MassDriver, KineticAssault_Repulsion, Knights_CallArcher, Knights_CallKnight, Knights_Chop, Knights_Equip_Knights, Knights_Gash, Knights_MenAtArms, Knights_RallyTheMilitia, Knights_UpgradeEquipment, Knights_WhirlingAxe, MightyShockwave, ObedienceTraining_BackhandSlap, ObedienceTraining_DisciplineAllies, ObedienceTraining_IdentifyWeakness, ObedienceTraining_InspireBetrayal, ObedienceTraining_IntimidatingPresence, ObedienceTraining_MotivateAllies, ObedienceTraining_Praise, ObedienceTraining_PressOn, ObedienceTraining_ViciousMockery, PaleBlade_BuildUp, PaleBlade_FetidPresence, PaleBlade_Flay, PaleBlade_Khloros, PaleBlade_Lash, PaleBlade_PaleBlade, PaleBlade_PaleWind, PaleBlade_RendFlesh, PaleBlade_SunderBone, PaleBlade_Taunt, PetCommand_Action_Stay, PowerPunch_Stun, PrimalGifts_GraceofNature, PrimalGifts_Inexhaustible, PrimalGifts_NaturesBoon, PrimalGifts_PackMaster, PrimalGifts_PrimalHowl, PrimalGifts_PrimalWard, PrimalGifts_PrimalistsCloak, PrimalGifts_Rejuvenate, PrimalGifts_ShiftersShield, PrimalGifts_ThickHide, PrimalGifts_WildRoar, PrimalGifts_WilloftheWild, PsychicBlast_MentalDart, QuicksandRework, Robotics_Repair, SRBlock, SRReaction, SRRecovery, ShadowFighting_TouchOfFear, SpectralAura10, SpectralAura2, SpectralAura3, SpectralAura4, SpectralAura5, SpectralAura6, SpectralAura7, SpectralAura8, SpectralMelee1, SpectralMelee2, SpectralMelee3, SpectralMelee4, SpectralMelee5, SpectralMelee7, SpectralMelee8, SpectralMelee9, SpinningKickMA, StoneMastery_Fissure, StoneMastery_HurlBoulder, StoneMastery_SeismicSmash, TarantulaTeamwork_MindLink, TarantulaTeamwork_ReinforcedExoskeleton, TarantulaTeamwork_TarantulaConversion, TarantulaTraining_BuildUp, TarantulaTraining_Cocoon, TarantulaTraining_Pierce, TarantulaTraining_PlasmaCannon, TarantulaTraining_Shred, TarantulaTraining_VenomBolt, TarantulaTraining_VenomBurst, TarantulaTraining_WebSpitter, Teleportation_LongRangeTeleport, Temporary_CryoniteArmor, UtilityBelt_EnvenomedBarrage, WaterControl_Deluge, WaterControl_DrowningPool, WaterControl_GeyserBurst, WaterControl_Hypothermia, WaterControl_Riptide, WaterControl_Suffocate, WaterControl_TidalWave, WaterControl_TurbulentAura, WaterControl_WaterGolem
- Not in the shared icons, enh (3): E_ICON_PrimalistsNature, E_ICON_ViperStrike, e_icon_subaluwa
- Not in the shared icons, at (1): archetypeicon_primalist
- No texture of its own, a copy of the shared icon, enh (12): E_orgin_pvp_L, E_orgin_pvp_R, E_orgin_pvpattune_L, E_orgin_pvpattune_R, E_orgin_rare_L, E_orgin_rare_R, E_orgin_superior_L, E_orgin_superior_R, E_orgin_uncommon_L, E_orgin_uncommon_R, E_orgin_uncommonattune_L, E_orgin_uncommonattune_R
- No texture at all, powers (3): RadiationMelee_AssassinStrike, WaterControl_Drowning, otics_LaserRifleStunGrenade

## Differences from Homecoming

Against Homecoming i28p4, by internal name (ids, attribute offsets and per-server numbering normalised):

- Power sets (player categories): 469 HC, 386 TS; 123 only on HC, 40 only on TS; 339 of 346 shared differ in order, levels or requirements
- Powers in shared sets: 2784 compared, 2607 differ; 107 only on HC, 83 only on TS
- Archetypes: 14 shared, 1 only on HC, 1 only on TS; 236 archetype table differences, 74 modifier table differences
- Attribute names: 3 only on HC, 4 only on TS, 22 at a different offset
- Game rules differing: 4 (schedule, boost effect, exemplar, diminishing returns)
- Enhancement sets: 227 HC, 214 TS; 210 share a name, 210 of those differ; 203 of 246 shared set bonus powers differ

The full list, to spot-check in game, is pipeline/report-thunderspy-diff.md (`python -m pipeline.compare --server thunderspy`; committed data only).

## Mids map

None: MidsReborn has no database for this server.

