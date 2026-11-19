/**
 * The Pets and Minions cards (engine/petcards.ts) from the version's real pets file
 * (henchmen/<version>.json): which pets a build's powers make at a level, what upgrades give them,
 * the summon's slotting and the build's pet aura IOs, and the file's own shape check and fetch.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GameData, HENCHMEN_FOLDER, loadGameData } from '../src/data/gamedata.ts';
import { serverById } from '../src/data/servers.ts';
import { readHenchmenFile } from '../src/data/henchmen.ts';
import { newBuild, type Build } from '../src/engine/build.ts';
import { makesPets, petCards, petEntries, type PetCard } from '../src/engine/petcards.ts';
import { buffsPets } from '../src/engine/petstats.ts';
import { setPetOn } from '../src/engine/actions.ts';
import { evalRequires } from '../src/engine/requires.ts';
import { BuildRules } from '../src/engine/rules.ts';
import { petCount } from '../src/ui/components/PetCard.tsx';
import { dataDir, loadData, loadVersionIndex, pid, sid, withHenchmen } from './helpers/data.ts';

const gd = withHenchmen(loadData());
const P = gd.core.schedule.power;
const raw = (): Record<string, unknown> =>
  JSON.parse(readFileSync(join(dataDir(), 'henchmen', `${gd.core.manifest.dataVersion}.json`), 'utf-8')) as Record<string, unknown>;

/** A Mastermind with every power of its primary picked as early as allowed (both upgrades included). */
function mastermind(primary: string, skip: readonly string[] = []): Build {
  const pri = gd.setByName.get(`mastermind_summon.${primary.toLowerCase()}`)!;
  const b = newBuild({
    dataVersion: gd.core.manifest.dataVersion,
    at: gd.archetypeByName.get('class_mastermind')!.id,
    origin: gd.core.origins[0]!.id,
    alignment: 'Villain',
    primary: pri.id,
    secondary: sid(gd, 'Mastermind_Buff.Force_Field'),
    pickCount: P.length,
  });
  let i = 0;
  pri.p.forEach((id, k) => {
    if (skip.includes(gd.power(id).n)) return;
    while (P[i]! < (pri.av[k] ?? 0)) i++;
    b.picks[i] = { power: id, level: P[i]!, slots: [{ level: P[i]! }] };
    i++;
  });
  return b;
}

/** @return The version's data without its pets or real pets files (as the site has it before they come). */
const bareData = () =>
  new GameData({ core: gd.core, powersets: [...gd.setById.values()], powers: [...gd.powerById.values()].filter((p) => p.type !== 'Boost'), boosts: { boosts: gd.boosts, bonusPowers: gd.bonusPowers, sets: gd.boostSets } });

const cards = (b: Build, level = 49) => petCards(gd, new BuildRules(gd, b), b, level);
const card = (cs: readonly PetCard[], name: string) => cs.find((c) => c.name === name)!;
const attack = (c: PetCard, name: string) => c.attacks.find((a) => a.name === name);
const pickOf = (b: Build, power: string) => b.picks.find((p) => p?.power === pid(gd, power))!;
/** @return The build with the Mastermind's Supremacy switched off. */
function noSupremacy(b: Build): Build {
  b.granted[pid(gd, 'Inherent.Inherent.Supremacy')] = { slots: [], on: false };
  return b;
}
/** @return A henchman minion's maximum hit points at level 50, from its class. */
const minionHp = () => GameData.attrAt(gd.henchmen!.classes['Class_Henchman_Minion']!.max!, 'HitPoints', 49);
/** @return A card's defense line of a type ("Melee"). */
const defLine = (c: PetCard, label: string) => [...c.stats.lines.values()].find((l) => l.key.startsWith('def.') && l.label === label);
/** @return The damage types a card has resistance to, in the totals' order. */
const resTypes = (c: PetCard) =>
  [...c.stats.lines.values()]
    .filter((l) => /^res\.\d+$/.test(l.key) && l.value !== 0)
    .sort((a, b) => a.key.localeCompare(b.key))
    .map((l) => l.label);
/** @return Every source of a card's stats with a name. */
const sourcesNamed = (c: PetCard, name: string) => [...c.stats.lines.values()].flatMap((l) => l.sources.filter((s) => s.name === name));
/** @return The names of every source of a card's stats line. */
const sourceNames = (c: PetCard, key: string) => (c.stats.lines.get(key)?.sources ?? []).map((s) => s.name);

describe('which pets a build makes', () => {
  it('spawns as many as the combat level allows (Battle Drones: 1, 2 from level 6, 3 from 18)', () => {
    const b = mastermind('Robotics');
    const drones = (level: number) => card(cards(b, level), 'Battle Drone').sources[0]!.count;
    expect(drones(0)).toBe(1);
    expect(drones(4)).toBe(1);
    expect(drones(5)).toBe(2);
    expect(drones(16)).toBe(2);
    expect(drones(17)).toBe(3);
    expect(drones(49)).toBe(3);
  });

  it('lists every henchman of the seven primaries at level 50, each with an attack that hurts', () => {
    const want: Record<string, string[]> = {
      Robotics: ['Battle Drone', 'Protector Bot', 'Maintenance Drone', 'Assault Bot'],
      Ninjas: ['Genin', 'Jounin', 'Oni'],
      Mercenaries: ['Soldier', 'Medic', 'Spec Ops', 'Commando'],
      Necromancy: ['Zombie', 'Grave Knight', 'Lich'],
      Demon_Summoning: ['Fiery Demonling', 'Cold Demonling', 'Hellfire Demonling', 'Ember Demon', 'Hellfire Gargoyle', 'Demon Prince'],
      Thugs: ['Punk', 'Arsonist', 'Enforcers', 'Bruiser'],
      Beast_Mastery: ['Howler Wolf', 'Alpha Howler Wolf', 'Lioness', 'Dire Wolf'],
    };
    for (const [primary, names] of Object.entries(want)) {
      const cs = cards(mastermind(primary));
      for (const n of names) {
        const c = card(cs, n);
        expect(c, `${primary}: ${n}`).toBeDefined();
        expect(c.stats.hpMax, n).toBeGreaterThan(500);
        expect(c.attacks.some((a) => a.damage.base > 0), n).toBe(true);
      }
    }
  });

  it('runs a henchman at its creator\'s level, on its class\'s tables', () => {
    const drone = card(cards(mastermind('Robotics')), 'Battle Drone');
    expect(drone.level).toBe(49);
    expect(drone.stats.hpMax).toBeCloseTo(minionHp(), 3);
    expect(drone.stats.hpMax).toBeCloseTo(578.28, 2);
    // Laser Burst: 0.334 x Ranged_Damage, ticking every 0.25 s over 0.51 s (three ticks)
    const tbl = -gd.classTable('Class_Henchman_Minion', 'Ranged_Damage', 49);
    expect(attack(drone, 'Laser Burst')!.damage.base).toBeCloseTo(3 * 0.334 * tbl, 2);
  });

  it('asks for the real pets file only for a build that makes a pet', () => {
    const rules = (b: Build) => new BuildRules(gd, b).entries();
    expect(makesPets(gd, rules(mastermind('Robotics')))).toBe(true);
    const scrapper = newBuild({
      dataVersion: gd.core.manifest.dataVersion,
      at: gd.archetypeByName.get('class_scrapper')!.id,
      origin: gd.core.origins[0]!.id,
      alignment: 'Hero',
      primary: sid(gd, 'Scrapper_Melee.Broad_Sword'),
      secondary: sid(gd, 'Scrapper_Defense.Super_Reflexes'),
      pickCount: P.length,
    });
    expect(makesPets(gd, rules(scrapper))).toBe(false);
    expect(petCards(gd, new BuildRules(gd, scrapper), scrapper, 49)).toEqual([]);
    // Rain of Fire's only pet is a pseudo-pet the pets file lists: no real pets file for it
    const blaster = newBuild({
      dataVersion: gd.core.manifest.dataVersion,
      at: gd.archetypeByName.get('class_blaster')!.id,
      origin: gd.core.origins[0]!.id,
      alignment: 'Hero',
      primary: sid(gd, 'Blaster_Ranged.Fire_Blast'),
      secondary: sid(gd, 'Blaster_Support.Fire_Manipulation'),
      pickCount: P.length,
    });
    blaster.picks[20] = { power: pid(gd, 'Blaster_Ranged.Fire_Blast.Rain_of_Fire'), level: P[20]!, slots: [{ level: P[20]! }] };
    expect(makesPets(gd, rules(blaster))).toBe(false);
    // without the pets file to tell them apart, any power that makes a pet counts
    const bare = bareData();
    expect(makesPets(bare, new BuildRules(bare, blaster).entries())).toBe(true);
  });
});

describe('upgrades follow the build', () => {
  it('gives a henchman what Equip and Upgrade grant only once the build has them', () => {
    // Supremacy switched off: it gives every pet resistance too
    const full = card(cards(noSupremacy(mastermind('Robotics'))), 'Battle Drone');
    expect(attack(full, 'Heavy Laser Burst')).toBeDefined(); // Equip Robot
    expect(attack(full, 'Full Auto Laser')).toBeDefined(); // Upgrade Robot
    expect(resTypes(full)).toEqual(['Lethal', 'Cold', 'Psionic']); // Equip Robot's Resistance
    const bare = card(cards(noSupremacy(mastermind('Robotics', ['Mastermind_Summon.Robotics.Equip_Robot', 'Mastermind_Summon.Robotics.Upgrade_Robot']))), 'Battle Drone');
    expect(attack(bare, 'Heavy Laser Burst')).toBeUndefined();
    expect(attack(bare, 'Full Auto Laser')).toBeUndefined();
    expect(resTypes(bare)).toEqual([]);
    // at a level before Upgrade Robot is taken, only Equip Robot's attacks
    const b = mastermind('Robotics');
    const at20 = card(cards(b, pickOf(b, 'Mastermind_Summon.Robotics.Upgrade_Robot').level - 1), 'Battle Drone');
    expect(attack(at20, 'Heavy Laser Burst')).toBeDefined();
    expect(attack(at20, 'Full Auto Laser')).toBeUndefined();
  });

  it('takes away what an upgrade revokes (Equip Thugs trades the Punk\'s Pistol for Pistols)', () => {
    const punk = card(cards(mastermind('Thugs')), 'Punk');
    expect(attack(punk, 'Pistols')).toBeDefined();
    expect(attack(punk, 'Pistol')).toBeUndefined();
    const raw = card(cards(mastermind('Thugs', ['Mastermind_Summon.Thugs.Equip_Thugs', 'Mastermind_Summon.Thugs.Upgrade_Equipment'])), 'Punk');
    expect(attack(raw, 'Pistol')).toBeDefined();
  });
});

describe('what a card counts', () => {
  it('enhances every pet power, upgrades\' included, by the summon\'s slotting', () => {
    const b = mastermind('Robotics');
    const so = gd.powerByName.get('boosts.generic_damage.generic_damage')!;
    pickOf(b, 'Mastermind_Summon.Robotics.Battle_Drones').slots = [{ level: 0, enh: { boost: so.id, rel: 0 } }];
    const drone = card(cards(b), 'Battle Drone');
    for (const n of ['Laser Burst', 'Heavy Laser Burst', 'Full Auto Laser']) {
      const a = attack(drone, n)!;
      expect(a.damage.enh, n).toBeGreaterThan(a.damage.base);
    }
  });

  it('adds a pet aura IO slotted anywhere to every pet\'s defense', () => {
    const b = mastermind('Robotics');
    const edict = gd.powerByName.get('boosts.crafted_edict_of_the_master_f.crafted_edict_of_the_master_f')!;
    pickOf(b, 'Mastermind_Summon.Robotics.Battle_Drones').slots = [{ level: 0, enh: { boost: edict.id, ioLevel: 49 } }];
    for (const c of cards(b)) {
      expect(defLine(c, 'Melee')?.sources.find((s) => s.name === 'Edict of the Master')?.value, c.name).toBeCloseTo(0.05, 6);
    }
  });

  it('leaves out a spawn shield and counts a heal for a friend as no attack', () => {
    const cs = cards(mastermind('Robotics'));
    // Materialization's 100% defense lasts 15 s after the drone spawns
    expect(sourcesNamed(card(cs, 'Battle Drone'), 'Materialization')).toEqual([]);
    // the Maintenance Drone's Repair takes its own hit points to heal a friend
    const drone = card(cs, 'Maintenance Drone');
    expect(attack(drone, 'Repair')).toBeUndefined();
    expect(drone.powers.map((p) => p.name)).toContain('Repair');
  });

  it('shares one card among pets of one name and numbers, each source and weapon counted', () => {
    const posse = card(cards(mastermind('Thugs')), 'Posse');
    const gangWar = posse.sources.find((s) => s.from === 'Gang War')!;
    expect(gangWar).toMatchObject({ count: 6, extra: 7, dur: 60 });
    // each posse member carries one weapon: an attack says how many have it
    expect(posse.attacks.every((a) => a.users !== undefined && a.users > 0)).toBe(true);
    expect(cards(mastermind('Thugs')).filter((c) => c.name === 'Posse')).toHaveLength(1);
  });
});

describe('the real pets file', () => {
  it('takes the published file whole', () => {
    const f = readHenchmenFile(raw())!;
    expect(f).not.toBeNull();
    expect(f.pets['MastermindPets_Droid']!.dn).toBe('Battle Drone');
    // its powers become Power records the power info can run (no id: no build names them)
    expect(f.powers['Mastermind_Pets.Droid.Laser_Burst']).toMatchObject({ id: -1, n: 'Mastermind_Pets.Droid.Laser_Burst', type: 'Click' });
    // a name like "constructor" finds nothing
    expect(f.makes['constructor']).toBeUndefined();
  });

  it('refuses a file with any part malformed or naming what it lacks', () => {
    const bad = (edit: (r: Record<string, unknown>) => void) => {
      const r = raw();
      edit(r);
      return readHenchmenFile(r);
    };
    expect(readHenchmenFile(null)).toBeNull();
    expect(readHenchmenFile([])).toBeNull();
    expect(bad((r) => delete r.makes)).toBeNull();
    expect(bad((r) => ((r.pets as Record<string, { p: unknown }>)['MastermindPets_Droid']!.p = 'x'))).toBeNull();
    expect(bad((r) => ((r.pets as Record<string, { p: string[] }>)['MastermindPets_Droid']!.p = ['Nowhere.Power']))).toBeNull();
    expect(bad((r) => ((r.makes as Record<string, unknown>)['Mastermind_Summon.Robotics.Battle_Drones'] = [{ pet: 'Nobody' }]))).toBeNull();
    expect(bad((r) => ((r.powers as Record<string, { type: unknown }>)['Mastermind_Pets.Droid.Laser_Burst']!.type = 3))).toBeNull();
    expect(bad((r) => ((r.classes as Record<string, { mod: Record<string, number> }>)['Class_Henchman_Minion']!.mod['ranged_damage'] = 1e9))).toBeNull();
    expect(bad((r) => ((r.classes as Record<string, { resMax: unknown }>)['Class_Henchman_Minion']!.resMax = { DamageType00: 'x' }))).toBeNull();
    expect(bad((r) => (r.collective = { 'Mastermind_Pets.Protector.Force_Shield': ['0'] }))).toBeNull();
    expect(bad((r) => ((r.pets as Record<string, { grp: unknown }>)['MastermindPets_Droid']!.grp = 7))).toBeNull();
  });

  it('is fetched once, only when asked for, and a bad one shows no cards', async () => {
    const fresh = bareData();
    const load = vi.fn(() => void fresh.setHenchmen({ makes: 'broken' }));
    fresh.setHenchmenLoader(load);
    expect(load).not.toHaveBeenCalled();
    fresh.requestHenchmen();
    fresh.requestHenchmen();
    expect(load).toHaveBeenCalledTimes(1);
    expect(fresh.henchmen).toBeNull();
    const heard = vi.fn();
    fresh.subscribeHenchmen(heard);
    expect(fresh.setHenchmen(raw())).toBe(true);
    expect(heard).toHaveBeenCalledTimes(1);
  });

  it('reads a henchman class\'s tables after the pets file\'s', () => {
    expect(gd.classTable('Class_Henchman_Boss', 'Ranged_Damage', 49)).toBeLessThan(0);
    expect(gd.classTable('Class_Blaster', 'Ranged_Damage', 49)).toBe(gd.table(gd.archetypeByName.get('class_blaster')!, 'Ranged_Damage', 49));
  });
});

describe('target.VillainName>', () => {
  it('tests the target\'s villain def, and answers 0 without one', () => {
    const tokens = ['MastermindPets_Droid', 'target.VillainName>'];
    const base = { ownsPower: () => false, ownsSet: () => false, prop: () => 0 };
    expect(evalRequires(tokens, base)).toBe(false);
    expect(evalRequires(tokens, { ...base, targetVillain: (n) => n === 'MastermindPets_Droid' })).toBe(true);
    expect(evalRequires(tokens, { ...base, targetVillain: (n) => n === 'MastermindPets_Assault_Bot' })).toBe(false);
  });
});

describe('what the wiki check found (Homecoming i28p4)', () => {
  it("keeps a power an upgrade revokes and grants back (Upgrade Equipment: the Enforcer's Maneuvers)", () => {
    const enforcer = card(cards(mastermind('Thugs')), 'Enforcers');
    const melee = defLine(enforcer, 'Melee');
    expect(melee?.sources.map((s) => s.name)).toContain('Maneuvers');
    expect(melee!.value).toBeGreaterThan(0);
  });

  it("counts the max hit points a pet's own powers give or take", () => {
    const zombies = (skip: string[] = []) => card(cards(mastermind('Necromancy', skip)), 'Zombie').stats.hpMax;
    const base = minionHp();
    expect(zombies(['Mastermind_Summon.Necromancy.Enchant_Undead', 'Mastermind_Summon.Necromancy.Dark_Empowerment'])).toBeCloseTo(base, 2);
    expect(zombies()).toBeGreaterThan(base); // Dark Empowerment's extra hit points
    expect(card(cards(mastermind('Thugs')), 'Posse').stats.hpMax).toBeLessThan(base); // the posse's -MaxHP
  });

  it("shows a grant that needs a meter, with its condition (a Grave Knight's Disembowel)", () => {
    const knight = card(cards(mastermind('Necromancy')), 'Grave Knight');
    expect(attack(knight, 'Disembowel')?.when).toMatch(/Rage is above 0\.5/);
    expect(attack(knight, 'Head Splitter')?.when).toBeUndefined();
  });

  it("says what a pet's own summon makes (Upgrade Robot's Seeker Drones)", () => {
    const bot = card(cards(mastermind('Robotics')), 'Protector Bot');
    const seekers = bot.powers.find((p) => p.name === 'Seeker Drones');
    expect(seekers?.lines.map((l) => l.line.map((x) => x.text).join(''))).toEqual(['Summons 2 Seeker Drone for 4m 0s']);
  });

  it('names the henchman Soul Extraction must be used on, and spreads Hell on Earth over 90 s', () => {
    const ghosts = cards(mastermind('Necromancy')).filter((c) => c.sources[0]!.from === 'Soul Extraction');
    expect(ghosts.map((c) => [c.name, c.sources[0]!.on, c.sources[0]!.count])).toEqual([
      ['Wraith', 'Lich', 1],
      ['Tortured Soul', 'Grave Knight', 1],
      ['Spirit', 'Zombie', 1],
    ]);
    const hellfire = card(cards(mastermind('Demon_Summoning')), 'Living Hellfire').sources[0]!;
    expect(hellfire).toMatchObject({ from: 'Hell on Earth', count: 4, extra: 6, over: 90 });
    // a summon's own short spawn delays (Battle Drones' 2 to 4 s) spread nothing
    expect(card(cards(mastermind('Robotics')), 'Battle Drone').sources[0]!.over).toBeUndefined();
  });

  it('leaves a spawn shield out of the other powers', () => {
    expect(card(cards(mastermind('Robotics')), 'Battle Drone').powers.map((p) => p.name)).not.toContain('Materialization');
  });

  it("works a row's card out only when it is first asked for, and once", () => {
    const b = mastermind('Robotics');
    const rows = petEntries(gd, new BuildRules(gd, b), b, 49);
    expect(rows.map((r) => [r.name, petCount(r.sources)])).toEqual([
      ['Battle Drone', 'x3'],
      ['Protector Bot', 'x2'],
      ['Maintenance Drone', 'x1'],
      ['Assault Bot', 'x1'],
    ]);
    const first = rows[0]!.card();
    expect(rows[0]!.card()).toBe(first);
    expect(petCount([{ from: 'X', count: 0, extra: 2 }])).toBe('up to 2');
    expect(petCount([{ from: 'X', count: 6, extra: 7 }])).toBe('x6 (+7)');
  });
});

describe('fetching the real pets file', () => {
  const server = serverById('homecoming')!;
  const version = loadVersionIndex().versions.find((v) => v.id === 'i28p4')!;
  afterEach(() => vi.unstubAllGlobals());

  it('asks again after a network failure, and not after a missing file', async () => {
    const cases: [() => Promise<Response>, boolean][] = [
      [() => Promise.reject(new Error('offline')), true],
      [async () => new Response('nope', { status: 404 }), false],
    ];
    for (const [first, retried] of cases) {
      let asked = 0;
      vi.stubGlobal('fetch', async (url: string) => {
        const path = String(url).split('?')[0]!.replace(/^.*?\/data\//, '');
        if (!path.startsWith(`${HENCHMEN_FOLDER}/`)) return new Response(readFileSync(join(dataDir(), path)));
        asked++;
        return asked === 1 ? first() : new Response(readFileSync(join(dataDir(), path)));
      });
      const fresh = await loadGameData(server, '/x/', version);
      expect(asked).toBe(0); // not before a build asks
      fresh.requestHenchmen();
      await new Promise((r) => setTimeout(r, 0));
      fresh.requestHenchmen();
      await vi.waitFor(() => expect(asked).toBe(retried ? 2 : 1));
      if (retried) await vi.waitFor(() => expect(fresh.henchmen).not.toBeNull());
      else expect(fresh.henchmen).toBeNull();
    }
  });
});

/** @return The build with a power picked in its first free pick (switched on or off when given). */
function withPick(b: Build, power: string, on?: boolean): Build {
  const i = b.picks.findIndex((p) => !p);
  b.picks[i] = { power: pid(gd, power), level: P[i]!, slots: [{ level: P[i]! }], ...(on === undefined ? {} : { on }) };
  return b;
}

describe("what lands on a pet (the pet pane's stats)", () => {
  it("reads its base values and caps from its class, as a character's from its archetype", () => {
    const drone = card(cards(mastermind('Robotics')), 'Battle Drone');
    expect(drone.stats.regenPerSec).toBeGreaterThan(0);
    expect(drone.stats.speeds.run).toBeGreaterThan(0);
    expect(drone.stats.endMax).toBe(100);
    // a resistance line is capped by its class (ResistanceMax)
    const cap = drone.stats.lines.get('res.01')!.cap!;
    expect(cap).toBeCloseTo(GameData.attrAt(gd.henchmen!.classes['Class_Henchman_Minion']!.resMax!, 'DamageType01', 49), 6);
  });

  it("counts the Mastermind's Supremacy, unless it is switched off", () => {
    const b = mastermind('Robotics');
    expect(sourceNames(card(cards(b), 'Battle Drone'), 'dmg.00')).toContain('Supremacy (yours)');
    expect(sourceNames(card(cards(b), 'Battle Drone'), 'tohit')).toContain('Supremacy (yours)');
    b.granted[pid(gd, 'Inherent.Inherent.Supremacy')] = { slots: [], on: false };
    expect(sourceNames(card(cards(b), 'Battle Drone'), 'dmg.00')).not.toContain('Supremacy (yours)');
  });

  it("counts the Mastermind's toggles that reach its pets, and a click only once switched on", () => {
    const b = withPick(mastermind('Robotics'), 'Pool.Leadership.Defense');
    const drone = () => card(cards(b), 'Battle Drone');
    expect(defLine(drone(), 'Melee')?.sources.map((s) => s.name)).toContain('Maneuvers (yours)');
    withPick(b, 'Mastermind_Buff.Force_Field.Deflection_Shield');
    expect(sourcesNamed(drone(), 'Deflection Shield (yours)')).toEqual([]);
    b.picks.find((p) => p?.power === pid(gd, 'Mastermind_Buff.Force_Field.Deflection_Shield'))!.on = true;
    expect(defLine(drone(), 'Melee')?.sources.find((s) => s.name === 'Deflection Shield (yours)')?.value).toBeGreaterThan(0);
  });

  it("counts another pet's aura once for each pet that runs it (two Enforcers' Maneuvers)", () => {
    const cs = cards(mastermind('Thugs'));
    const punk = defLine(card(cs, 'Punk'), 'Melee')!;
    const theirs = punk.sources.find((s) => s.name === 'Maneuvers (Enforcers x2)')!;
    const own = defLine(card(cs, 'Enforcers'), 'Melee')!.sources;
    // an Enforcer has its own, and the other Enforcer's
    expect(own.map((s) => s.name)).toEqual(expect.arrayContaining(['Maneuvers', 'Maneuvers (Enforcers)']));
    expect(theirs.value).toBeCloseTo(2 * own.find((s) => s.name === 'Maneuvers')!.value, 6);
  });

  it("counts a pet's click buff it can keep up until switched off, and a collective one once whoever casts it", () => {
    const b = mastermind('Robotics');
    const named = (c: PetCard) => sourcesNamed(c, 'Force Shield (Protector Bot)').length + sourcesNamed(c, 'Force Shield (Protector Bot x2)').length;
    expect(named(card(cards(setPetOn(b, 'Mastermind_Pets.Protector.Force_Shield', false)), 'Battle Drone'))).toBe(0);
    const cs = cards(b);
    // two Protector Bots cast it; its defense stacks once whoever casts it (CasterStackType Collective)
    const melee = defLine(card(cs, 'Battle Drone'), 'Melee')!.sources;
    expect(melee.filter((s) => s.name.startsWith('Force Shield')).map((s) => s.name)).toEqual(['Force Shield (Protector Bot)']);
    // a Protector Bot has its own, and no second copy from the other
    const bot = defLine(card(cs, 'Protector Bot'), 'Melee')!.sources;
    expect(bot.filter((s) => s.name.startsWith('Force Shield')).map((s) => s.name)).toEqual(['Force Shield']);
  });

  it('applies no upgrade switched off in the overview', () => {
    const b = mastermind('Robotics');
    pickOf(b, 'Mastermind_Summon.Robotics.Equip_Robot').on = false;
    const drone = card(cards(b), 'Battle Drone');
    expect(attack(drone, 'Heavy Laser Burst')).toBeUndefined();
    expect(attack(drone, 'Full Auto Laser')).toBeDefined(); // Upgrade Robot is still on
  });

  it("holds regeneration at the class minimum (the Maintenance Drone can't regenerate)", () => {
    const drone = card(cards(mastermind('Robotics')), 'Maintenance Drone');
    expect(drone.stats.lines.get('regen')!.value).toBeLessThan(-1000); // its -999999 sentinel
    expect(drone.stats.regenPerSec).toBe(0);
    expect(drone.stats.regenPerSecRaw).toBeLessThan(0); // shown as no loss, not as a cap passed
  });

  it('counts every earned copy of a set bonus that reaches pets (Decimation in two attacks)', () => {
    const b = noSupremacy(mastermind('Robotics'));
    const set = gd.boostSets.find((x) => x.n === 'Decimation')!;
    const pieces = [set.slots[0]![0]!, set.slots[1]![0]!];
    for (const power of ['Mastermind_Summon.Robotics.Pulse_Rifle_Blast', 'Mastermind_Summon.Robotics.Pulse_Rifle_Burst']) {
      const pick = pickOf(b, power);
      pick.slots = pieces.map((boost, i) => ({ level: pick.level + i, enh: { boost, ioLevel: 49 } }));
    }
    const named = sourcesNamed(card(cards(b), 'Battle Drone'), 'Decimation (2)');
    expect(named.length).toBeGreaterThan(0);
    // each line it reaches has two copies, one per power that earns it
    const perLine = new Map<number, number>();
    for (const l of card(cards(b), 'Battle Drone').stats.lines.values()) {
      const n = l.sources.filter((x) => x.name === 'Decimation (2)').length;
      if (n) perLine.set(n, (perLine.get(n) ?? 0) + 1);
    }
    expect([...perLine.keys()]).toEqual([2]);
  });

  it("says which powers can move a stat (the pane's switches)", () => {
    const drone = card(cards(mastermind('Robotics')), 'Battle Drone');
    expect(buffsPets(gd, attack(drone, 'Laser Burst')!.power)).toBe(false);
    expect(buffsPets(gd, gd.henchmen!.powers['Mastermind_Pets.Thug_Lt.Maneuvers']!)).toBe(true);
    expect(buffsPets(gd, gd.henchmen!.powers['Mastermind_Pets.Protector.Force_Shield']!)).toBe(true);
  });
});

describe('Thunderspy', () => {
  it('shows a Mastermind\'s henchmen from its own data, upgrades included', () => {
    const ts = withHenchmen(loadData(undefined, 'thunderspy'), 'thunderspy');
    const pri = ts.setByName.get('mastermind_summon.robotics')!;
    const TP = ts.core.schedule.power;
    const b = newBuild({
      server: 'thunderspy',
      dataVersion: ts.core.manifest.dataVersion,
      at: ts.archetypeByName.get('class_mastermind')!.id,
      origin: ts.core.origins[0]!.id,
      alignment: 'Villain',
      primary: pri.id,
      secondary: ts.setByName.get('mastermind_buff.force_field')!.id,
      pickCount: TP.length,
    });
    let i = 0;
    pri.p.forEach((id, k) => {
      while (TP[i]! < (pri.av[k] ?? 0)) i++;
      b.picks[i] = { power: id, level: TP[i]!, slots: [{ level: TP[i]! }] };
      i++;
    });
    const cs = petCards(ts, new BuildRules(ts, b), b, 49);
    const drone = cs.find((c) => c.name === 'Battle Drone')!;
    expect(drone.sources[0]!.count).toBe(3);
    expect(drone.stats.hpMax).toBeGreaterThan(500);
    expect(drone.attacks.some((a) => a.damage.base > 0)).toBe(true);
    expect(cs.map((c) => c.name)).toEqual(expect.arrayContaining(['Protector Bot', 'Assault Bot']));
  });
});
