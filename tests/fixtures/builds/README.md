# Forum builds

Builds posted by players on the Homecoming forums, kept as posted, all legal on the patch they were made on.
The browser tests (`e2e/`) recreate them through the planner's screens, and
`tests/buildfixtures.test.ts` checks that each one imports.

| File | Build | Source |
|---|---|---|
| `symphony-dark-dominator.txt` | Symphony Control / Dark Assault Dominator, level 50 (legacy Mids `\|MxDz;` chunk) | ["Symphony / Dark - Anyone got a good endgame build?"](https://forums.homecomingservers.com/topic/37772-symphony-dark-anyone-got-a-good-endgame-build) |
| `archery-traps-corruptor.txt` | Archery / Traps Corruptor, level 50 (Mids `\|MBD;` chunk) | ["Build - Archery/Traps corrupter, looking for a critique"](https://forums.homecomingservers.com/topic/51860-build-archerytraps-corrupter-looking-for-a-critique) |
| `elec-sonic-stalker-leveling.mbd` | Electrical Melee / Sonic Aura Stalker, a leveling build: each power and slot at the level it was taken (Mids `.mbd` file, Mids Reborn 3.8.6.1, Homecoming database 2026.10.8.3) | ["Electrical Melee + Sonic Aura"](https://forums.homecomingservers.com/topic/66234-electrical-melee-sonic-aura/), the attachment "Stalker (Electrical Melee - Sonic Aura)pre50 v2.1.mbd" |
| `infinitum-tanker-inv-ss.txt` | Infinitum, Invulnerability / Super Strength Tanker, level 50, made on Issue 28, Page 3 (Mids `\|MBD;` chunk, database 2026.1.1242); `tests/patches.test.ts` opens it on Page 3 and moves it to Page 4 | ["Infinitum Build Collection"](https://forums.homecomingservers.com/topic/20288-infinitum-build-collection/) |

The `.mbd` file is the attachment as downloaded, with line endings changed to LF (the repository
stores text that way).
