# Patch history: Issue 24 to Issue 28

A timeline of City of Heroes patches from the last NCSoft build (the Issue 24 beta, 2012) to
Homecoming's Issue 28, Page 4 (2026). It exists to tell which patch an old client is, and what
changed in the data the planner reads between two patches, when older clients turn up.

The catalogue is `pipeline/patch-history.json`: one entry per patch, in date order. It was
built on 2026-11-18 from the homecoming.wiki patch-note pages listed under "Sources". Entries
summarise the notes in our own words; they do not copy them (the wiki states no licence). Each
entry links back to its section of the wiki. Every `planner` and `markers` line was checked
against its section of the notes in a second pass. `pipeline/patch_history_test.py` (run by CI)
checks the fields below, the date order and that the file is ASCII.

| Field | Meaning |
|---|---|
| `date` | Live date (beta build date for Issue 24) |
| `issue`, `page` | Issue number; Homecoming page number, or null |
| `server` | `Retail beta` (Issue 24), `SCoRE` (Issue 25), `Homecoming` |
| `label` | The heading as the wiki writes it |
| `kind` | `beta`, `live`, `hotfix`, `server-side` or `rolled-back` |
| `build` | Client build id, when the notes give one in full (the first beta's partial id is in its `note`) |
| `source` | The wiki section |
| `sections` | The patch's own sub-headings |
| `planner` | Changes to data the planner reads: archetypes, power sets, powers, pools, epics, inherents, enhancements, IO sets, set bonuses, procs, slotting and exemplar rules |
| `markers` | Facts visible in decoded client data that tell this patch apart from the one before |
| `note` | Any doubt: an inferred year, a date taken from the text, a page with no notes |

## Eras

| Era | Dates | Entries | What the wiki has |
|---|---|---|---|
| Issue 24 beta (NCSoft) | 2012-08-08 to 2012-08-23 | 3 | Three VIP open-beta builds, each with notes. Issue 24 never went live: the game shut down on 2012-11-30. |
| Issue 25 (SCoRE) | 2013-01-22 to 2018-12-14 | 65 | One consolidated list for everything up to 2014-01-19 (catalogued on the 2013-05-21 client launch; its markers hold by 2014-01-19, so a client from earlier in 2013 may lack some), dated notes for 2014, and only patch dates for 2015-2018 (the wiki has no pages for those). |
| Issue 26 (Homecoming) | 2019-04-28 to 2020-11-17 | 42 | Pages 1-5, every patch dated. |
| Issue 27 | 2020-11-24 to 2024-07-02 | 46 | Pages 1-7, every patch dated. |
| Issue 28 | 2024-07-23 to 2026-10-20 | 25 | Page 1 by patch; Pages 2-4 as one release each, plus dated updates. |

Releases that start a Homecoming page (the main release carries most of the power changes):

| Page | Release | Page | Release |
|---|---|---|---|
| I26 P1 | 2019-04-28 | I27 P3 | 2021-11-26 |
| I26 P2 | 2019-08-22 | I27 P4 | 2022-08-23 |
| I26 P3 | 2019-10-01 | I27 P5 | 2022-10-18 |
| I26 P4 | 2020-01-23 | I27 P6 | 2023-04-25 |
| I26 P5 | 2020-03-31 | I27 P7 | 2024-02-20 |
| I27 P1 | 2020-11-24 | I28 P1 | 2024-07-23 |
| I27 P2 | 2021-04-20 | I28 P2 | 2025-06-17 |
| | | I28 P3 | 2025-11-25 |
| | | I28 P4 | 2026-10-06 |

Issue 28 Page 3 then had updates on 2025-12-01, 12-02 (hotfix), 12-16, 2026-02-10 (Panel 2),
03-11, 03-31, 06-23 (Panel 3) and 07-07. Panel 2 and Panel 3 changed many powers.

## Telling which patch a client is

1. `version.ini` (`[Settings] Version=`) holds the build id on NCSoft-era clients
   (`2400.<yyyymmddhhmm>.<n>`). Compare it with `build` in the catalogue.
2. The PE timestamp of the game exe and the newest file timestamp inside the piggs
   (`tools/pigg_extract.py` reads each entry's timestamp) give the build date.
3. Homecoming build ids in the notes look like `26.5.3224a`, `27.1.3537`, `28.3.7372.3` and
   `28.4.8623`. Few patches give one.
4. Otherwise, decode the client and check the `markers` of the patches around its date: the first
   patch whose markers don't all hold is after it.

Known clients:

- **The owner's Issue 24 backup** is the third and last Issue 24 beta build,
  `2400.201208211101.1` (notes dated 2012-08-23). Its `version.ini` matches the build id the wiki
  gives, and the exe and every pigg file are dated 2012-08-21. It is not a live retail build
  (Issue 24 never went live) and not SCoRE. City of Heroes Resurgence (2013-01-07) and Paragon
  Chat were built on it.
- **`i28p3`** ("Issue 28, Page 3 (Dec 16 update)") was made from a client between the 2025-12-16
  update and Panel 2 (2026-02-10). It has Sonic Melee and Psionic Armor, but not Boomerang Slice,
  which arrived with Panel 2.
- **`i28p4`** has Light Affinity, Sonic Aura and Shrapnel Grenade, which arrived with Page 4
  (2026-10-06).

## Milestones for the planner

- **2012-08-08, Issue 24 beta:**
  - Martial Combat (Blaster) and Martial Assault (Dominator).
  - A fifth power in every non-travel pool.
  - Renamed Blaster secondary powers.
  - Snipe, nuke and tier 3 blast changes.
  - Four new IO sets (Annihilation, Unbreakable Guard, Reactive Defenses, Preventive Medicine).
  - Procs per minute and reworked set bonuses.
- **2012-08-23, Issue 24 beta:** the Sorcery pool, and the epic archetype nukes standardised.
- **2013-05-21, SCoRE Issue 25:**
  - The Sentinel archetype.
  - Atomic Manipulation, Ninja Training, Radiation Armor, Radiation Melee, Radioactive Assault,
    Tactical Arrow and Temporal Manipulation.
  - Proliferation of existing sets to more archetypes.
  - Enhancement Catalysts and attuned IOs.
  - Sudden Acceleration (a new Knockback set).
  - Mighty Judgement.
- **2014, SCoRE:**
  - The Sentinel inherent becomes Opportunity.
  - Kheldian form attacks move into the main sets.
- **2019-10-01:** the Force of Will origin pool.
- **2020-01-23:** the Tanker and Brute rework: damage modifiers, buff caps, target caps and the
  Tanker's bigger areas.
- **2020-03-31:**
  - Electrical Affinity.
  - The Experimentation origin pool.
  - Five new IO sets.
- **2020-11-24:**
  - Sonic Manipulation for Blasters.
  - Revamps of Energy Melee (proliferated to Scrappers), Titan Weapons and Trick Arrow.
  - The new Teleportation pool.
  - Enhancement combining up to level 53.
- **2021-04-20:**
  - The travel pool overhaul: Concealment becomes a travel pool, Afterburner and Evasive
    Maneuvers.
  - The Sorcery overhaul.
- **2021-11-26:**
  - Seismic Blast and Earth Manipulation.
  - Stone Melee and Stone Armor for Scrappers.
  - Five new IO sets.
- **2022-08-23:**
  - Symphony Control and Sonic Assault.
  - Positional and typed defense on every attack.
- **2022-10-18:**
  - The Sentinel revamp.
  - The level availability pass, which moved many powers to earlier levels.
  - Mastermind revamps.
- **2023-04-25:** Storm Blast.
- **2024-02-20:**
  - Arsenal Control and Arsenal Assault.
  - Dark, Ice and Psionic Mastery.
  - Epic pools merged and renamed (Fire Mastery, Arsenal Mastery).
- **2024-07-23:** Marine Affinity.
- **2025-06-17:**
  - Pyrotechnic Control and Psionic Armor.
  - Energy Aura for Tankers.
- **2025-11-25:**
  - Sonic Melee.
  - Set bonuses extended to pets.
- **2026-02-10 (Panel 2):**
  - Recipe rarities realigned.
  - Boomerang Slice.
  - Many blast set reworks.
- **2026-10-06:**
  - Light Affinity and Sonic Aura.
  - The Super Strength rework.
  - Damage cap changes.

## Sources

homecoming.wiki pages, read on 2026-11-18 (normal page views, a few seconds apart):

- Issue 24, and its three beta notes: Patch Notes/2012-08-08 Beta, Patch Notes/2012-08-14 Beta
  and Patch Notes/2012-08-23 Beta.
- Issue 25, and Issue 25 - Patch Notes for 2014, 2015, 2016, 2017 and 2018. Issue 25 (Paragon
  Studios) is the cancelled NCSoft issue and has no patches.
- Issue 26 and Issue 26 Page 1-5.
- Issue 27 and Issue 27 Page 1-7.
- Issue 28, Issue 28 Page 1-4 and Issue 28 Page 4/Patches.

Gaps:

- Single 2013 patch dates: the wiki gives Issue 25 up to 2014-01-19 as one list.
- 2015-2018 SCoRE notes: the wiki has dates only.
- Most Homecoming build ids.

Small Homecoming follow-up patches are marked `live` or `hotfix` according to how the wiki heads
them.
