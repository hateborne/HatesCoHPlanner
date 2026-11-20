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
/** A power's info in a build: its stats rows as [label, text] and its numbers. */
function info(b: Build, power: string, enh: Map<number, number> | null = new Map(), d: GameData = gd) {
  const rules = new BuildRules(d, b);
  const pi = powerInfo(d, rules.at, d.powerByName.get(power.toLowerCase())!, L50, enh, undefined, damageBoost(d, rules, L50));
  return { rows: pi.stats.map((r) => [r.label, segText(r.value)] as const), numbers: pi.numbers };
}
const labels = (rows: readonly (readonly [string, string])[]) => rows.map(([l]) => l);

describe('damageBoost', () => {
  it('counts nothing for clicks left off', () => {
    const bo = boostOf(brute());
    expect(bo.str.get(SMASHING)).toBe(0);
    expect(bo.names).toEqual([]);
    expect(bo.tags).toEqual([]);
  });

  it('Build Up switched on adds its strength to every damage type and is named', () => {
    const bo = boostOf(brute(true));
    const want = gd.table(gd.archetypeByName.get('class_brute')!, 'Melee_Buff_Dmg', L50) * 8;
    expect(want).toBeCloseTo(0.8, 6);
    expect(bo.str.get(SMASHING)).toBeCloseTo(want, 6);
    expect(bo.str.get(FIRE)).toBeCloseTo(want, 6);
    expect(bo.names).toEqual(['Build Up']);
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
    expect(bo.names).toEqual([]);
  });

  it('Dominator Embrace of Fire is a plain damage buff: named, no tag', () => {
    const b = build(gd, 'Class_Dominator', 'Dominator_Control.Fire_Control', 'Dominator_Assault.Fiery_Assault');
    put(gd, b, 3, 'Dominator_Assault.Fiery_Assault.Fiery_Embrace', true);
    const bo = boostOf(b);
    expect(bo.tags).toEqual([]);
    expect(bo.names).toEqual(['Embrace of Fire']);
    expect(bo.str.get(FIRE)!).toBeGreaterThan(bo.str.get(SMASHING)!);
  });
});

describe('powerInfo with damage boosts', () => {
  const SCORCH = 'Brute_Melee.Fiery_Melee.Scorch';

  it('adds no rows when nothing boosts', () => {
    const plain = info(brute(), SCORCH);
    expect(labels(plain.rows).some((l) => l.startsWith('With '))).toBe(false);
    expect(plain.numbers.damageBoosted).toBeCloseTo(plain.numbers.damage.enh, 6);
  });

  it('Build Up on: a heading and the three damage rows again, at base x (1 + enhancement + 0.8)', () => {
    const enh = new Map([[FIRE, 0.95]]);
    const plain = info(brute(), SCORCH, enh);
    const up = info(brute(true), SCORCH, enh);
    // the rows above the block are untouched
    expect(up.rows.slice(0, 3)).toEqual(plain.rows.slice(0, 3));
    expect(labels(up.rows).slice(0, 7)).toEqual([
      'Average Damage:',
      'Damage Per Activation Time:',
      'Damage Per Cast Cycle:',
      'With Build Up:',
      'Average Damage:',
      'Damage Per Activation Time:',
      'Damage Per Cast Cycle:',
    ]);
    expect(up.rows[3]![1]).toBe('');
    const base = up.numbers.damage.base;
    expect(up.numbers.damage.enh).toBeCloseTo(base * 1.95, 4);
    expect(up.numbers.damageBoosted).toBeCloseTo(base * (1 + 0.95 + 0.8), 4);
    expect(up.rows[4]![1]).toBe(up.numbers.damageBoosted.toFixed(2));
  });

  it("holds the boosted damage under the archetype's cap", () => {
    const rules = new BuildRules(gd, brute(true));
    const bo = damageBoost(gd, rules, L50);
    for (const k of bo.str.keys()) bo.str.set(k, 20);
    const n = powerInfo(gd, rules.at, gd.powerByName.get(SCORCH.toLowerCase())!, L50, new Map(), undefined, bo).numbers;
    expect(n.damageBoosted).toBeCloseTo(n.damage.base * 7, 4);
  });

  it('Fiery Embrace on: its tagged damage counts in the damage rows, base and enhanced; no block', () => {
    const off = info(brute(), SCORCH);
    const on = info(brute(undefined, true), SCORCH);
    expect(on.numbers.damage.base).toBeGreaterThan(off.numbers.damage.base);
    expect(on.numbers.damage.enh).toBeCloseTo(on.numbers.damage.base, 6);
    expect(labels(on.rows).some((l) => l.startsWith('With '))).toBe(false);
  });

  it('Fiery Embrace and Build Up on: the block boosts the tagged damage too', () => {
    const fe = info(brute(undefined, true), SCORCH);
    const both = info(brute(true, true), SCORCH);
    expect(labels(both.rows)).toContain('With Build Up:');
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
    expect(labels(on.rows)).toContain('With Rage:');
    // a build without Rage keeps the client's rule: the Might group counts
    const none = build(gd, 'Class_Brute', 'Brute_Melee.Super_Strength', 'Brute_Defense.Fiery_Aura');
    put(gd, none, 0, KO);
    expect(info(none, KO).numbers.damage.base).toBeCloseTo(on.numbers.damage.base, 6);
  });

  it('the heading says so when other bonuses add damage beside the clicks', () => {
    const b = brute(true);
    put(gd, b, 5, 'Pool.Leadership.Assault');
    const bo = boostOf(b);
    expect(bo.other).toBe(true);
    expect(boostOf(brute(true)).other).toBe(false);
    expect(labels(info(b, SCORCH).rows)).toContain('With Build Up and damage bonuses:');
    const quiet = brute();
    put(gd, quiet, 5, 'Pool.Leadership.Assault');
    expect(labels(info(quiet, SCORCH).rows)).toContain('With damage bonuses:');
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
    expect(labels(a.stats.map((r) => [r.label, segText(r.value)] as const)).some((l) => l.startsWith('With '))).toBe(false);
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
    expect(bo.names).toEqual(['Build Up']);
    expect(bo.str.get(FIRE)!).toBeGreaterThan(0);
    const n = info(b, 'Brute_Melee.Fiery_Melee.Scorch', new Map(), ts).numbers;
    expect(n.damageBoosted).toBeCloseTo(n.damage.base * (1 + bo.str.get(FIRE)!), 4);
  });
});
