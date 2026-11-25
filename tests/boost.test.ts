/**
 * The power info's boosted damage: the damage strength the totals count (clicks switched on such
 * as Build Up, set bonuses, running toggles) added to an attack's own enhancements under the
 * archetype's cap, and Fiery Embrace's tagged damage counted while it is switched on.
 */
import { describe, expect, it } from 'vitest';
import type { GameData } from '../src/data/gamedata.ts';
import { newBuild, type Build } from '../src/engine/build.ts';
import { damageBoost } from '../src/engine/boost.ts';
import { powerInfo, segText } from '../src/engine/powerinfo.ts';
import { BuildRules } from '../src/engine/rules.ts';
import { loadData, pid, sid } from './helpers/data.ts';

const gd = loadData();
const L50 = 49;
const SMASHING = 0;
const FIRE = 8;

/** A new level-50 build of an archetype and its two sets. */
function build(d: GameData, at: string, primary: string, secondary: string): Build {
  return newBuild({
    dataVersion: d.core.manifest.dataVersion,
    at: d.archetypeByName.get(at.toLowerCase())!.id,
    origin: d.core.origins[0]!.id,
    alignment: 'Hero',
    primary: sid(d, primary),
    secondary: sid(d, secondary),
    pickCount: d.core.schedule.power.length,
  });
}
/** Put a power in pick i, unslotted, with its totals switch. */
function put(d: GameData, b: Build, i: number, power: string, on?: boolean): void {
  const level = d.core.schedule.power[i]!;
  b.picks[i] = { power: pid(d, power), level, slots: [{ level, enh: undefined }], on };
}
/** A Fire/Fire Brute with Scorch, Build Up and Fiery Embrace, the two clicks switched as given. */
function brute(buildUp?: boolean, embrace?: boolean): Build {
  const b = build(gd, 'Class_Brute', 'Brute_Melee.Fiery_Melee', 'Brute_Defense.Fiery_Aura');
  put(gd, b, 0, 'Brute_Melee.Fiery_Melee.Scorch');
  put(gd, b, 2, 'Brute_Melee.Fiery_Melee.Build_Up', buildUp);
  put(gd, b, 3, 'Brute_Defense.Fiery_Aura.Fiery_Embrace', embrace);
  return b;
}
const boostOf = (b: Build, d: GameData = gd) => damageBoost(d, new BuildRules(d, b), L50);
/** A power's info in a build: its stats rows as { label: text }, its effect lines and its numbers. */
function info(b: Build, power: string, enh: Map<number, number> | null = new Map(), d: GameData = gd) {
  const rules = new BuildRules(d, b);
  const pi = powerInfo(d, rules.at, d.powerByName.get(power.toLowerCase())!, L50, enh, undefined, damageBoost(d, rules, L50));
  return { rows: Object.fromEntries(pi.stats.map((r) => [r.label, segText(r.value)])), lines: pi.effects.map((e) => segText(e.line)), numbers: pi.numbers };
}
const f2 = (n: number) => n.toFixed(2);

describe('damageBoost', () => {
  it('counts nothing for clicks left off', () => {
    const bo = boostOf(brute());
    expect(bo.str.get(SMASHING)).toBe(0);
    expect(bo.tags).toEqual([]);
  });

  it('Build Up switched on adds its strength to every damage type', () => {
    const bo = boostOf(brute(true));
    const want = gd.table(gd.archetypeByName.get('class_brute')!, 'Melee_Buff_Dmg', L50) * 8;
    expect(want).toBeCloseTo(0.8, 6);
    expect(bo.str.get(SMASHING)).toBeCloseTo(want, 6);
    expect(bo.str.get(FIRE)).toBeCloseTo(want, 6);
    expect(bo.tags).toEqual([]);
  });

  it("reads the archetype's damage cap", () => {
    expect(boostOf(brute()).cap.get(SMASHING)).toBe(7);
    const scrapper = build(gd, 'Class_Scrapper', 'Scrapper_Melee.Fiery_Melee', 'Scrapper_Defense.Fiery_Aura');
    expect(boostOf(scrapper).cap.get(SMASHING)).toBe(5);
  });

  it('Fiery Embrace switched on raises its tag and adds no strength', () => {
    const bo = boostOf(brute(undefined, true));
    expect(bo.tags).toEqual(['fieryembrace']);
    expect(bo.str.get(FIRE)).toBe(0);
  });

  it('Dominator Embrace of Fire is a plain damage buff: strength, no tag', () => {
    const b = build(gd, 'Class_Dominator', 'Dominator_Control.Fire_Control', 'Dominator_Assault.Fiery_Assault');
    put(gd, b, 3, 'Dominator_Assault.Fiery_Assault.Fiery_Embrace', true);
    const bo = boostOf(b);
    expect(bo.tags).toEqual([]);
    expect(bo.str.get(FIRE)!).toBeGreaterThan(bo.str.get(SMASHING)!);
  });
});

describe('powerInfo with damage boosts', () => {
  const SCORCH = 'Brute_Melee.Fiery_Melee.Scorch';

  it('changes nothing when nothing boosts', () => {
    const enh = new Map([[FIRE, 0.95]]);
    const plain = info(brute(), SCORCH, enh);
    const rules = new BuildRules(gd, brute());
    const bare = powerInfo(gd, rules.at, gd.powerByName.get(SCORCH.toLowerCase())!, L50, enh);
    expect(plain.numbers.damageBoosted).toBeCloseTo(plain.numbers.damage.enh, 6);
    expect(plain.rows['Average Damage:']).toBe(`${f2(plain.numbers.damage.enh)} (${f2(plain.numbers.damage.base)})`);
    expect(plain.lines).toEqual(bare.effects.map((e) => segText(e.line)));
  });

  it('Build Up on: the damage rows and the damage lines read base x (1 + enhancement + 0.8)', () => {
    const enh = new Map([[FIRE, 0.95]]);
    const plain = info(brute(), SCORCH, enh);
    const up = info(brute(true), SCORCH, enh);
    const base = up.numbers.damage.base;
    expect(up.numbers.damage.enh).toBeCloseTo(base * 1.95, 4);
    expect(up.numbers.damageBoosted).toBeCloseTo(base * (1 + 0.95 + 0.8), 4);
    // the same rows, the boosted damage in place of the enhanced, and no row naming the boost
    expect(Object.keys(up.rows)).toEqual(Object.keys(plain.rows));
    expect(up.rows['Damage Includes:']).toBeUndefined();
    expect(up.rows['Average Damage:']).toBe(`${f2(base * 2.75)} (${f2(base)})`);
    expect(up.rows['Recharge Time:']).toBe(plain.rows['Recharge Time:']);
    expect(up.rows['Endurance Cost:']).toBe(plain.rows['Endurance Cost:']);
    expect(up.rows['Accuracy:']).toBe(plain.rows['Accuracy:']);
    // its main hit's line: enhanced x 2.75 / 1.95
    const hit = (ls: string[]) => Number(ls.find((l) => l.includes('fire damage on target') && !l.includes('Ticks'))!.split(' ')[0]);
    expect(hit(up.lines)).toBeCloseTo((hit(plain.lines) * 2.75) / 1.95, 1);
  });

  it("holds the boosted damage under the archetype's cap", () => {
    const rules = new BuildRules(gd, brute(true));
    const bo = damageBoost(gd, rules, L50);
    for (const k of bo.str.keys()) bo.str.set(k, 20);
    const n = powerInfo(gd, rules.at, gd.powerByName.get(SCORCH.toLowerCase())!, L50, new Map(), undefined, bo).numbers;
    expect(n.damageBoosted).toBeCloseTo(n.damage.base * 7, 4);
  });

  it('Fiery Embrace on: its tagged damage counts in the damage rows, base and enhanced', () => {
    const off = info(brute(), SCORCH);
    const on = info(brute(undefined, true), SCORCH);
    expect(on.numbers.damage.base).toBeGreaterThan(off.numbers.damage.base);
    expect(on.numbers.damage.enh).toBeCloseTo(on.numbers.damage.base, 6);
    expect(on.rows['Average Damage:']).toBe(f2(on.numbers.damage.base));
  });

  it('Fiery Embrace and Build Up on: the tagged damage is boosted too', () => {
    const fe = info(brute(undefined, true), SCORCH);
    const both = info(brute(true, true), SCORCH);
    expect(both.numbers.damage.base).toBeCloseTo(fe.numbers.damage.base, 6);
    expect(both.numbers.damageBoosted).toBeCloseTo(fe.numbers.damage.base * 1.8, 4);
  });

  it("Fiery Embrace off: its groups stay out, damage over time included; on, they count", () => {
    // Incinerate's Fiery Embrace group is damage over time, which the client's own total counts
    // at its tick chance whatever the mode; with the build's boosts it follows the switch
    const tanker = (embrace?: boolean): Build => {
      const b = build(gd, 'Class_Tanker', 'Tanker_Defense.Fiery_Aura', 'Tanker_Melee.Fiery_Melee');
      put(gd, b, 0, 'Tanker_Melee.Fiery_Melee.Incinerate');
      put(gd, b, 3, 'Tanker_Defense.Fiery_Aura.Fiery_Embrace', embrace);
      return b;
    };
    const INCINERATE = 'Tanker_Melee.Fiery_Melee.Incinerate';
    const p = gd.powerByName.get(INCINERATE.toLowerCase())!;
    const client = powerInfo(gd, gd.archetypeByName.get('class_tanker')!, p, L50, null).numbers.damage.base;
    const off = info(tanker(), INCINERATE).numbers.damage.base;
    const on = info(tanker(true), INCINERATE).numbers.damage.base;
    expect(on).toBeCloseTo(client, 6);
    expect(off).toBeLessThan(on);
    expect(off).toBeGreaterThan(0);
  });

  it("Rage: Super Strength's Might damage counts only while Rage is switched on", () => {
    const ss = (rage?: boolean): Build => {
      const b = build(gd, 'Class_Brute', 'Brute_Melee.Super_Strength', 'Brute_Defense.Fiery_Aura');
      put(gd, b, 0, 'Brute_Melee.Super_Strength.Knockout_Blow');
      put(gd, b, 2, 'Brute_Melee.Super_Strength.Rage', rage);
      return b;
    };
    const KO = 'Brute_Melee.Super_Strength.Knockout_Blow';
    const off = info(ss(), KO);
    const on = info(ss(true), KO);
    expect(boostOf(ss()).switchModes.has('unleashmight')).toBe(true);
    expect(boostOf(ss()).modes.has('unleashmight')).toBe(false);
    expect(boostOf(ss(true)).modes.has('unleashmight')).toBe(true);
    expect(on.numbers.damage.base).toBeGreaterThan(off.numbers.damage.base);
    expect(on.numbers.damageBoosted).toBeGreaterThan(on.numbers.damage.enh);
    // a build without Rage keeps the client's rule: the Might group counts
    const none = build(gd, 'Class_Brute', 'Brute_Melee.Super_Strength', 'Brute_Defense.Fiery_Aura');
    put(gd, none, 0, KO);
    expect(info(none, KO).numbers.damage.base).toBeCloseTo(on.numbers.damage.base, 6);
  });

  it('only damage is boosted: a heal, a shield and a power without damage read as before', () => {
    const b = build(gd, 'Class_Tanker', 'Tanker_Defense.Fiery_Aura', 'Tanker_Melee.Fiery_Melee');
    put(gd, b, 0, 'Tanker_Defense.Fiery_Aura.Healing_Flames');
    put(gd, b, 1, 'Tanker_Defense.Fiery_Aura.Fire_Shield');
    put(gd, b, 2, 'Tanker_Melee.Fiery_Melee.Build_Up', true);
    const at = gd.archetypeByName.get('class_tanker')!;
    for (const name of ['Tanker_Defense.Fiery_Aura.Healing_Flames', 'Tanker_Defense.Fiery_Aura.Fire_Shield', 'Tanker_Melee.Fiery_Melee.Build_Up']) {
      const boosted = info(b, name);
      const bare = powerInfo(gd, at, gd.powerByName.get(name.toLowerCase())!, L50, new Map());
      expect(boosted.lines, name).toEqual(bare.effects.map((e) => segText(e.line)));
      expect(boosted.rows, name).toEqual(Object.fromEntries(bare.stats.map((r) => [r.label, segText(r.value)])));
      expect(boosted.numbers.heal, name).toEqual(bare.numbers.heal);
    }
  });

  it("a pet that copies its creator's mods by its villain def takes the boost (Rain of Fire); one that doesn't takes none (Caltrops)", () => {
    const blaster = (aim?: boolean): Build => {
      const b = build(gd, 'Class_Blaster', 'Blaster_Ranged.Fire_Blast', 'Blaster_Support.Gadgets');
      put(gd, b, 2, 'Blaster_Ranged.Fire_Blast.Aim', aim);
      return b;
    };
    const aim = boostOf(blaster(true)).str.get(FIRE)!;
    expect(aim).toBeGreaterThan(0.3);
    const rain = info(blaster(true), 'Blaster_Ranged.Fire_Blast.Rain_of_Fire').numbers;
    expect(rain.damage.base).toBeGreaterThan(0);
    expect(rain.damageBoosted).toBeCloseTo(rain.damage.base * (1 + aim), 3);
    expect(info(blaster(), 'Blaster_Ranged.Fire_Blast.Rain_of_Fire').numbers.damageBoosted).toBeCloseTo(rain.damage.base, 6);
    const caltrops = info(blaster(true), 'Blaster_Support.Gadgets.Caltrops').numbers;
    expect(caltrops.damage.base).toBeGreaterThan(0);
    expect(caltrops.damageBoosted).toBeCloseTo(caltrops.damage.base, 6);
  });

  it("a strike-from-stealth bonus is not counted as always on (Mask Presence, Shinobi)", () => {
    const scrapper = build(gd, 'Class_Scrapper', 'Scrapper_Melee.Claws', 'Scrapper_Defense.Psionic_Armor');
    put(gd, scrapper, 5, 'Scrapper_Defense.Psionic_Armor.Mask_Presence');
    expect(boostOf(scrapper).str.get(SMASHING)).toBe(0);
    const blaster = build(gd, 'Class_Blaster', 'Blaster_Ranged.Fire_Blast', 'Blaster_Support.Ninja_Training');
    put(gd, blaster, 5, 'Blaster_Support.Ninja_Training.Kyokan');
    expect(boostOf(blaster).str.get(SMASHING)).toBe(0);
  });

  it("a foe debuff is not counted against its caster (Stalker Genetic Corruption's damage debuff)", () => {
    const b = build(gd, 'Class_Stalker', 'Stalker_Melee.Claws', 'Stalker_Defense.Bio_Organic_Armor');
    put(gd, b, 5, 'Stalker_Defense.Bio_Organic_Armor.Genetic_Corruption');
    expect(boostOf(b).str.get(SMASHING)).toBe(0);
  });

  it('a heal is a damage type too, and takes no damage boost even with strength on every type', () => {
    const rules = new BuildRules(gd, brute(true));
    const bo = { ...damageBoost(gd, rules, L50), str: new Map<number, number>() };
    for (let off = 0; off < 80; off += 4) bo.str.set(off, 0.8);
    const at = gd.archetypeByName.get('class_tanker')!;
    const p = gd.powerByName.get('tanker_defense.fiery_aura.healing_flames')!;
    const lines = (b?: typeof bo) => powerInfo(gd, at, p, L50, new Map(), undefined, b).effects.map((e) => segText(e.line));
    expect(lines(bo)).toEqual(lines());
    expect(lines().some((l) => l.includes('heal'))).toBe(true);
  });

  it("a pseudo-pet that copies its creator's mods takes the boost (Burn), by base x (1 + 0.7)", () => {
    const tanker = (buildUp?: boolean): Build => {
      const b = build(gd, 'Class_Tanker', 'Tanker_Defense.Fiery_Aura', 'Tanker_Melee.Fiery_Melee');
      put(gd, b, 1, 'Tanker_Defense.Fiery_Aura.Burn');
      put(gd, b, 2, 'Tanker_Melee.Fiery_Melee.Build_Up', buildUp);
      return b;
    };
    const BURN = 'Tanker_Defense.Fiery_Aura.Burn';
    const off = info(tanker(), BURN).numbers;
    const on = info(tanker(true), BURN).numbers;
    expect(off.damage.base).toBeGreaterThan(0);
    expect(off.damageBoosted).toBeCloseTo(off.damage.base, 6);
    expect(on.damageBoosted).toBeCloseTo(on.damage.base * 1.7, 3);
  });

  it('gives one answer per rules view and level', () => {
    const rules = new BuildRules(gd, brute(true));
    expect(damageBoost(gd, rules, L50)).toBe(damageBoost(gd, rules, L50));
    expect(damageBoost(gd, rules, 10)).not.toBe(damageBoost(gd, rules, L50));
  });

  it("without a boost argument the info keeps the client's rule", () => {
    const p = gd.powerByName.get(SCORCH.toLowerCase())!;
    const at = gd.archetypeByName.get('class_brute')!;
    const a = powerInfo(gd, at, p, L50, null);
    expect(a.numbers.damageBoosted).toBeCloseTo(a.numbers.damage.base, 6);
  });
});

describe('Thunderspy', () => {
  it('Build Up switched on boosts a Thunderspy build the same way', () => {
    const ts = loadData(undefined, 'thunderspy');
    const b = build(ts, 'Class_Brute', 'Brute_Melee.Fiery_Melee', 'Brute_Defense.Fiery_Aura');
    put(ts, b, 0, 'Brute_Melee.Fiery_Melee.Scorch');
    put(ts, b, 2, 'Brute_Melee.Fiery_Melee.Build_Up', true);
    const bo = boostOf(b, ts);
    expect(bo.str.get(FIRE)!).toBeGreaterThan(0);
    const n = info(b, 'Brute_Melee.Fiery_Melee.Scorch', new Map(), ts).numbers;
    expect(n.damageBoosted).toBeCloseTo(n.damage.base * (1 + bo.str.get(FIRE)!), 4);
  });
});
