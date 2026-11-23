import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { FinderStats } from '../src/data/finderStats.ts';
import { newBuild, type Build, type Slot } from '../src/engine/build.ts';
import { FinderBase } from '../src/engine/finder/core.ts';
import { damageTypesDealt } from '../src/engine/finder/dealt.ts';
import { buildDiff, type DiffRow } from '../src/engine/finder/diff.ts';
import { weightsFor } from '../src/engine/finder/goals.ts';
import { replacedLines, shortPiece, statLabel, warningText } from '../src/engine/finder/labels.ts';
import { applySwap } from '../src/engine/finder/pending.ts';
import { slottedNumbers } from '../src/engine/finder/powerNumbers.ts';
import { areaFactor, isDamageProc, procChance, procFigures } from '../src/engine/finder/procs.ts';
import { chosenGoals, GOALS, MAX_GOALS, queryProblem, setGoalAt, type FinderQuery, type GoalPick } from '../src/engine/finder/query.ts';
import { KNOCKBACK_NEED, needsFor, Scorer, type Scored } from '../src/engine/finder/score.ts';
import { findSwaps, type RankedSwap } from '../src/engine/finder/search.ts';
import { fitQuery, nextSort, pickablePowers, sortSwaps, type FinderSort } from '../src/engine/finder/view.ts';
import { warningsOf } from '../src/engine/finder/warnings.ts';
import { BuildRules } from '../src/engine/rules.ts';
import { closeSetFinder, openSetFinder, startPickingPowers, stopPickingPowers, togglePickedPower, useFinderOpen } from '../src/state/finderOpen.ts';
import { computeTotals } from '../src/engine/totals.ts';
import { importMidsText } from '../src/io/mids.ts';
import { loadData, loadMidsMapFile, pid, sid, withHenchmen } from './helpers/data.ts';

const gd = loadData();
const stats = JSON.parse(readFileSync(join(process.cwd(), 'public', 'data', 'finder', 'stats.json'), 'utf-8')) as FinderStats;
const power = (name: string) => gd.power(pid(gd, name));
const boost = (short: string) => pid(gd, `Boosts.${short}.${short}`);
const query = (q: Partial<FinderQuery>): FinderQuery => ({ goals: [{ goal: 'resistance', importance: 'high' }], tags: [], extra: [], ...q });

/** @return The Symphony / Dark Dominator forum build: a finished level 50 build full of sets and procs. */
async function dominator(): Promise<Build> {
  const text = readFileSync(join(process.cwd(), 'tests', 'fixtures', 'builds', 'symphony-dark-dominator.txt'), 'utf-8');
  return (await importMidsText(gd, loadMidsMapFile(gd.core.manifest.dataVersion), text)).build;
}

/**
 * A small Fiery Aura / Fiery Melee Tanker: two armors that resist fire (30% each before
 * enhancements, against the Tanker's 90% cap), each with `res` common resistance IOs, and two
 * attacks. (Not a legal leveling order; the finder only reads slots.)
 */
function tanker(res: number): Build {
  const b = newBuild({
    dataVersion: gd.core.manifest.dataVersion,
    at: gd.archetypeByName.get('class_tanker')!.id,
    origin: gd.core.origins[0]!.id,
    alignment: 'Hero',
    primary: sid(gd, 'Tanker_Defense.Fiery_Aura'),
    secondary: sid(gd, 'Tanker_Melee.Fiery_Melee'),
    pickCount: gd.core.schedule.power.length,
  });
  const put = (i: number, name: string, pieces: string[]) => {
    const level = gd.core.schedule.power[i]!;
    b.picks[i] = { power: pid(gd, name), level, slots: pieces.map((p): Slot => ({ level, enh: { boost: boost(p), ioLevel: 49 } })) };
  };
  const armor = Array.from({ length: res }, () => 'Crafted_Res_Damage');
  put(0, 'Tanker_Defense.Fiery_Aura.Fire_Shield', armor);
  put(1, 'Tanker_Melee.Fiery_Melee.Scorch', ['Crafted_Damage', 'Crafted_Accuracy', 'Crafted_Obliteration_F']);
  put(2, 'Tanker_Defense.Fiery_Aura.Plasma_Sheild', armor);
  put(4, 'Tanker_Melee.Fiery_Melee.Fire_Sword_Circle', ['Crafted_Damage', 'Crafted_Accuracy']);
  return b;
}

describe('finder: priorities', () => {
  it('names the damage resistance priority for what it counts', () => {
    expect(GOALS.find((g) => g.id === 'resistance')!.name).toBe('Damage Resistance');
    const w = weightsFor(gd, stats, 'Class_Tanker', query({}));
    // only damage resistance is asked for: status and debuff resistance are not part of it
    expect([...w.asked.keys()].length).toBeGreaterThan(0);
    for (const key of w.asked.keys()) expect(key.startsWith('res.'), key).toBe(true);
  });

  it('moves a goal picked in another row, and leaves an emptied row where it is', () => {
    const rows: GoalPick[] = [
      { goal: 'resistance', importance: 'critical' },
      { goal: 'defense', importance: 'high' },
      { goal: 'aoeDamage', importance: 'low' },
    ];
    // area damage picked for row 2: row 3 is emptied and keeps its importance
    const moved = setGoalAt(rows, 1, { goal: 'aoeDamage' });
    expect(moved).toEqual([{ goal: 'resistance', importance: 'critical' }, { goal: 'aoeDamage', importance: 'high' }, { importance: 'low' }]);
    // then defense for row 3: the two have traded places in two picks
    expect(setGoalAt(moved, 2, { goal: 'defense' })[2]).toEqual({ goal: 'defense', importance: 'low' });
    // an emptied row stays put, and a short list is filled out to every row
    expect(setGoalAt(rows, 0, { goal: null })).toEqual([{ importance: 'critical' }, rows[1], rows[2]]);
    expect(setGoalAt([], 1, { importance: 'high' })).toEqual([{ importance: 'medium' }, { importance: 'high' }, { importance: 'medium' }]);
    expect(setGoalAt([], 0, { goal: 'recharge' })).toHaveLength(MAX_GOALS);
  });

  it('searches for nothing in a row without a goal, whatever its importance', async () => {
    const b = await dominator();
    const plain = query({ goals: [{ goal: 'recharge', importance: 'high' }] });
    const padded = query({ goals: [{ importance: 'critical' }, { goal: 'recharge', importance: 'high' }, { importance: 'high' }] });
    expect(chosenGoals(padded)).toEqual(plain.goals);
    expect(queryProblem(padded)).toBeNull();
    expect(queryProblem(query({ goals: [{ importance: 'high' }] }))).toMatch(/at least one/);
    expect(weightsFor(gd, stats, 'Class_Dominator', padded)).toEqual(weightsFor(gd, stats, 'Class_Dominator', plain));
    expect(findSwaps({ gd, stats, build: b, query: padded })).toEqual(findSwaps({ gd, stats, build: b, query: plain }));
  });

  it('offers only swaps that are a gain in what the search names', async () => {
    const b = await dominator();
    const found = findSwaps({ gd, stats, build: b, query: query({}), limit: 500 }).swaps;
    expect(found.length).toBeGreaterThan(0);
    // a damage resistance search: every result raises some damage resistance
    for (const s of found) expect(s.lines.some(([key, change]) => key.startsWith('res.') && change > 0), gd.boostSetById.get(s.set)!.dn).toBe(true);
    // the scorer finds swaps worth something that give no resistance (endurance, recovery): a search
    // for those lists them, the resistance search does not
    const other = findSwaps({ gd, stats, build: b, query: query({ goals: [{ goal: 'endurance', importance: 'high' }] }), limit: 500 }).swaps;
    const noRes = other.filter((s) => !s.lines.some(([key, change]) => key.startsWith('res.') && change > 0));
    expect(noRes.length).toBeGreaterThan(0);
    const ids = new Set(found.map((s) => `${s.key}|${s.set}|${s.count}`));
    for (const s of noRes) expect(ids.has(`${s.key}|${s.set}|${s.count}`)).toBe(false);
  });
});

describe('finder: labels of the gains and losses', () => {
  it('tells damage, status and debuff resistance apart', () => {
    expect(statLabel(gd, 'res.02')).toBe('Fire (Dmg Res)');
    expect(statLabel(gd, 'mezres.Held')).toBe('Hold (Status Res)');
    expect(statLabel(gd, 'mezprot.Knock')).toBe('Knockback (Status Prot)');
    // a debuff resistance is named in words, never by the attribute's internal name
    expect(statLabel(gd, 'resx.RechargeTime')).toBe('Recharge (Debuff Res)');
    expect(statLabel(gd, 'resx.SpeedRunning')).toBe('Run Speed (Debuff Res)');
    expect(statLabel(gd, 'resx.PerceptionRadius')).toBe('Perception (Debuff Res)');
    expect(statLabel(gd, 'resx.JumpHeight')).toBe('Jump Height (Debuff Res)');
    expect(statLabel(gd, 'resx.Endurance')).toBe('Endurance (Debuff Res)');
    // every debuff resistance the statistics know reads as words
    const keys = new Set(Object.values(stats.needs).flatMap((n) => Object.keys(n)));
    for (const key of JSON.stringify(stats).match(/resx\.[A-Za-z0-9]+/g) ?? []) keys.add(key);
    const debuffs = [...keys].filter((k) => k.startsWith('resx.'));
    expect(debuffs.length).toBeGreaterThan(5);
    for (const key of debuffs) expect(statLabel(gd, key), key).toMatch(/^[A-Z][A-Za-z]*( [A-Z][A-Za-z]*)* \(Debuff Res\)$/);
  });
});

describe('finder: caps in the gains and losses', () => {
  const fire = (rows: DiffRow[]) => rows.find((r) => r.key === 'res.02');

  it('carries what a stat holds past its cap, into, above and out of the cap', () => {
    const none = tanker(0);
    const some = tanker(3);
    const full = tanker(4);
    const cap = computeTotals(gd, new BuildRules(gd, full), full).lines.get('res.02')!.cap!;
    const value = (b: Build) => computeTotals(gd, new BuildRules(gd, b), b).lines.get('res.02')!.value;
    // the fixture must straddle the Tanker's cap for the three cases below
    expect(value(none)).toBeLessThan(cap);
    expect(value(some)).toBeGreaterThan(cap);
    expect(value(full)).toBeGreaterThan(value(some));

    // into the cap: the old value, then the cap with the new value past it
    const into = fire(buildDiff(gd, new BuildRules(gd, none), full).gains)!;
    expect(into).toMatchObject({ before: value(none), after: cap, rawAfter: value(full), atCap: true, wasAtCap: false });
    expect(into.rawBefore).toBeUndefined();
    // above the cap on both sides: the capped figures are equal, and the row is still listed
    const above = fire(buildDiff(gd, new BuildRules(gd, some), full).gains)!;
    expect(above).toMatchObject({ before: cap, after: cap, rawBefore: value(some), rawAfter: value(full), atCap: true, wasAtCap: true });
    const less = fire(buildDiff(gd, new BuildRules(gd, full), some).losses)!;
    expect(less).toMatchObject({ before: cap, after: cap, atCap: true });
    // out of the cap
    const out = fire(buildDiff(gd, new BuildRules(gd, full), none).losses)!;
    expect(out).toMatchObject({ before: cap, rawBefore: value(full), after: value(none), atCap: false, wasAtCap: true });
    expect(out.rawAfter).toBeUndefined();
  });

  it('warns when a stat falls out of its cap, and no longer when a gain goes past it', () => {
    const full = tanker(3);
    const base = new FinderBase(gd, new BuildRules(gd, full), full);
    const scorer = new Scorer(base, weightsFor(gd, stats, base.at.n, query({})), needsFor(stats.needs, [base.at.n]));
    const cap = base.cap('res.02')!;
    const armors = base.st.entries.filter((x) => x.slots.length === 3 && x.power.n.includes('Fiery_Aura'));
    expect(armors).toHaveLength(2);
    // 60% from the two armors, 93.6% with three IOs in each: past the Tanker's 90%
    expect(cap).toBeCloseTo(0.9, 9);
    expect(base.value('res.02')).toBeGreaterThan(0.93);
    for (const e of armors) {
      // one armor emptied leaves 30% + 46.8%: out of the cap, and the warning says so
      const bare = e.slots.map((s): Slot => ({ level: s.level }));
      const scored = scorer.score(e, base.state(e, e.slots), base.state(e, bare));
      expect(base.value('res.02') + scored.lines.get('res.02')!).toBeLessThan(0.8);
      expect(scored.capLost).toContain('res.02');
      expect(warningsOf(gd, scored, []).some((w) => w.kind === 'capLost' && w.stat === 'res.02')).toBe(true);
    }
    // a gain that goes past the cap is no warning: the list shows it as "cap (actual)"
    const lone = tanker(2);
    const loneBase = new FinderBase(gd, new BuildRules(gd, lone), lone);
    expect(loneBase.value('res.02')).toBeLessThan(cap);
    const shield = loneBase.st.entries.find((x) => x.power.n.endsWith('Fire_Shield'))!;
    const more = [...shield.slots, ...shield.slots].map((s): Slot => ({ ...s }));
    const gain = new Scorer(loneBase, weightsFor(gd, stats, loneBase.at.n, query({})), needsFor(stats.needs, [loneBase.at.n])).score(shield, loneBase.state(shield, shield.slots), loneBase.state(shield, more));
    expect(loneBase.value('res.02') + gain.lines.get('res.02')!).toBeGreaterThan(cap);
    expect(warningsOf(gd, gain, [])).toEqual([]);
    // the sentences: a real cap, and defense's soft cap
    const lost = { needs: [], crippled: [], wasted: [], capLost: ['res.02', 'def.03'] } as unknown as Scored;
    expect(warningsOf(gd, lost, []).map((w) => warningText(gd, w))).toEqual(['Fire (Dmg Res) drops below its cap.', `${statLabel(gd, 'def.03')} drops below the 45% soft cap.`]);
  });

  it('marks defense as a soft cap, and resistance as a cap', () => {
    const b = tanker(3);
    const rules = new BuildRules(gd, b);
    // four Kinetic Combat pieces into Scorch: a defense set bonus, on a build far under 45%
    const scorch = b.picks.findIndex((x) => x?.power === pid(gd, 'Tanker_Melee.Fiery_Melee.Scorch'));
    const level = b.picks[scorch]!.level;
    const withDef: Build = { ...b, picks: b.picks.map((x, i) => (x && i === scorch ? { ...x, slots: ['A', 'B', 'C', 'D'].map((l): Slot => ({ level, enh: { boost: boost(`Crafted_Kinetic_Combat_${l}`), ioLevel: 34 } })) } : x)) };
    const d = buildDiff(gd, rules, withDef);
    const def = [...d.gains, ...d.losses].filter((r) => r.key.startsWith('def.'));
    expect(def.length).toBeGreaterThan(0);
    for (const r of def) expect(r).toMatchObject({ softCap: true, atCap: false, wasAtCap: false });
    for (const r of [...d.gains, ...d.losses].filter((x) => !x.key.startsWith('def.'))) expect(r.softCap, r.key).toBeUndefined();
  });

  it("lists a proc whose rate the build's recharge moves, though its power's slots stay", () => {
    const b = tanker(1);
    const scorch = new BuildRules(gd, b).entries().find((e) => e.power.n === 'Tanker_Melee.Fiery_Melee.Scorch')!;
    const circle = b.picks.findIndex((p) => p?.power === pid(gd, 'Tanker_Melee.Fiery_Melee.Fire_Sword_Circle'));
    // five Obliteration pieces into Fire Sword Circle's (emptied) slots: a recharge set bonus for the build
    const level = b.picks[circle]!.level;
    const withSlots = (slots: Slot[]): Build => ({ ...b, picks: b.picks.map((p, i) => (p && i === circle ? { ...p, slots } : p)) });
    const empty = withSlots(Array.from({ length: 5 }, (): Slot => ({ level })));
    const filled = withSlots(['A', 'B', 'C', 'D', 'E'].map((l): Slot => ({ level, enh: { boost: boost(`Crafted_Obliteration_${l}`), ioLevel: 49 } })));
    const d = buildDiff(gd, new BuildRules(gd, empty), filled);
    const rech = d.gains.find((r) => r.key === 'rech')!;
    expect(rech.after).toBeGreaterThan(rech.before);
    // Scorch holds the same pieces on both sides, yet its proc now fires more often: a row of its own, and only that
    const own = d.powers.find((x) => x.key === scorch.key)!;
    // it is marked as not re-slotted, so the screen lists it under the gains, not with the swap's own power
    expect(own.slotted).toBe(false);
    expect(d.powers.filter((x) => x.slotted).map((x) => x.power)).toEqual([pid(gd, 'Tanker_Melee.Fiery_Melee.Fire_Sword_Circle')]);
    expect(own.losses).toEqual([]);
    expect(own.gains.map((r) => r.key.split(':')[0])).toEqual(['proc']);
    expect(own.gains[0]!.after).toBeGreaterThan(own.gains[0]!.before);
    // with the build's recharge as it was, an untouched power is not listed
    expect(buildDiff(gd, new BuildRules(gd, empty), empty).powers).toEqual([]);
  });
});

describe('finder: damage types a build deals', () => {
  const type = (name: string) => gd.core.attribNames.Damage.findIndex((d) => d.dn === name);

  it("reads them from the build's own powers", () => {
    // Scorch and Fire Sword Circle: fire, nothing else (Brawl is everyone's and does not count)
    const dealt = damageTypesDealt(gd, new BuildRules(gd, tanker(1)));
    expect(dealt && [...dealt]).toEqual([type('Fire')]);
  });

  it("gives no answer when a pet's damage can't be read", () => {
    // Burn deals its damage through a patch it makes: without the pets file the patch can't be read
    const b = tanker(1);
    const level = gd.core.schedule.power[5]!;
    b.picks[5] = { power: pid(gd, 'Tanker_Defense.Fiery_Aura.Burn'), level, slots: [{ level }] };
    const bare = Object.create(gd, { pets: { value: null }, henchmen: { value: null } }) as typeof gd;
    expect(damageTypesDealt(bare, new BuildRules(bare, b))).toBeNull();
  });

  it('marks a damage bonus of a type the build does not deal, and none when it cannot tell', async () => {
    const b = await dominator();
    const rules = new BuildRules(gd, b);
    const found = findSwaps({ gd, stats, build: b, query: query({ goals: [{ goal: 'stDamage', importance: 'high' }] }), limit: 200 }).swaps;
    // the first swap that moves the attack damage bonuses
    const attack = (rows: DiffRow[]) => rows.filter((r) => r.key.startsWith('dmg.') && r.key !== 'dmg.07' && !/^(special|unique)/i.test(gd.core.attribNames.Damage[Number(r.key.slice(4))]?.dn ?? ''));
    const swap = found.find((s) => {
      const d = buildDiff(gd, rules, applySwap(b, s));
      return attack([...d.gains, ...d.losses]).length > 0;
    })!;
    expect(swap).toBeDefined();
    // the build's pets are all in the pets file, so there is an answer
    const mine = damageTypesDealt(gd, rules)!;
    expect(mine).not.toBeNull();
    const d = buildDiff(gd, rules, applySwap(b, swap));
    const rows = attack([...d.gains, ...d.losses]);
    // a Symphony / Dark Dominator deals no fire damage: that bonus is set aside, a type it deals is not
    for (const r of rows) expect(!!r.unused, r.key).toBe(!mine.has(Number(r.key.slice(4))));
    expect(mine.has(type('Fire'))).toBe(false);
    expect(rows.some((r) => r.unused)).toBe(true);
    expect(rows.some((r) => !r.unused)).toBe(true);
    // the types handed in (the screen reads them once) give the same rows
    expect(buildDiff(gd, rules, applySwap(b, swap), mine)).toEqual(d);
    // with no answer nothing is called unused
    const blind = buildDiff(gd, rules, applySwap(b, swap), null);
    for (const r of attack([...blind.gains, ...blind.losses])) expect(r.unused, r.key).toBeUndefined();
  });

  /** @return A bare build of an archetype with these powers, one empty slot each. */
  const bare = (at: string, primary: string, secondary: string, powers: string[]): Build => {
    const b = newBuild({
      dataVersion: gd.core.manifest.dataVersion,
      at: gd.archetypeByName.get(at)!.id,
      origin: gd.core.origins[0]!.id,
      alignment: 'Hero',
      primary: sid(gd, primary),
      secondary: sid(gd, secondary),
      pickCount: gd.core.schedule.power.length,
    });
    powers.forEach((name, i) => {
      const level = gd.core.schedule.power[i]!;
      b.picks[i] = { power: pid(gd, name), level, slots: [{ level }] };
    });
    return b;
  };

  it('follows a power to the ones it redirects to', () => {
    // a Titan Weapons attack is a redirect: its damage is in the slow and the quick power it stands for
    const blow = power('Tanker_Melee.Titan_Weapons.Crushing_Blow');
    expect(blow.redir?.length).toBeGreaterThan(0);
    const b = bare('class_tanker', 'Tanker_Defense.Fiery_Aura', 'Tanker_Melee.Titan_Weapons', ['Tanker_Melee.Titan_Weapons.Crushing_Blow']);
    const dealt = damageTypesDealt(gd, new BuildRules(gd, b));
    // (the attacks also hold the fire damage Fiery Embrace adds, which counts as dealt)
    expect(dealt?.has(type('Smashing'))).toBe(true);
    expect(dealt?.has(type('Cold'))).toBe(false);
  });

  it("reads a real pet's attacks once the real pets file is there, and gives no answer before", () => {
    const b = bare('class_mastermind', 'Mastermind_Summon.Robotics', 'Mastermind_Buff.Force_Field', ['Mastermind_Summon.Robotics.Battle_Drones']);
    // the file is fetched only for a build that needs it: until it comes, the drones' lasers can't be read
    const before = Object.create(gd, { henchmen: { value: null } }) as typeof gd;
    expect(damageTypesDealt(before, new BuildRules(before, b))).toBeNull();
    const full = withHenchmen(gd);
    const dealt = damageTypesDealt(full, new BuildRules(full, b));
    expect(dealt).not.toBeNull();
    expect(dealt!.has(type('Energy'))).toBe(true);
    expect(dealt!.has(type('Fire'))).toBe(false);
  });
});

describe('finder: procs', () => {
  const zinger = gd.power(boost('Crafted_Obliteration_F'));

  it("works out a proc's chance as the game does", () => {
    const circle = power('Tanker_Melee.Fiery_Melee.Fire_Sword_Circle'); // sphere, 15 ft
    const breath = power('Tanker_Melee.Fiery_Melee.Breath_of_Fire'); // cone, 15 ft, 40 degrees
    const scorch = power('Tanker_Melee.Fiery_Melee.Scorch'); // single target
    const aura = power('Tanker_Defense.Fiery_Aura.Blazing_Aura'); // a toggle, sphere, 12 ft
    expect(areaFactor(scorch)).toBe(1);
    expect(areaFactor(circle)).toBeCloseTo((1 + 15 * 0.15) * 0.75 + 0.25, 9);
    expect(areaFactor(breath)).toBeCloseTo((1 + 15 * 0.15 - 15 * 0.00036667 * (360 - 40)) * 0.75 + 0.25, 4);
    // a click: PPM x (recharge with its own slotting + cast time) / (60 x area factor)
    expect(procChance(3.5, circle, zinger, 20)).toBeCloseTo((3.5 * (20 + circle.cast!)) / (60 * areaFactor(circle)), 9);
    expect(procChance(3.5, circle, zinger, 10)).toBeLessThan(procChance(3.5, circle, zinger, 20));
    // never under 5% + 1.5% per PPM, never over 90%
    expect(procChance(3.5, scorch, zinger, 0)).toBeCloseTo(Math.max(0.05 + 0.015 * 3.5, (3.5 * scorch.cast!) / 60), 9);
    expect(procChance(3.5, scorch, zinger, 0.1)).toBeGreaterThanOrEqual(0.1025);
    expect(procChance(3.5, scorch, zinger, 600)).toBe(0.9);
    // a toggle rolls once every period of the enhancement (10 seconds)
    expect(procChance(3.5, aura, zinger, 0)).toBeCloseTo((3.5 * 10) / (60 * areaFactor(aura)), 9);
    // the same by hand. Fire Sword Circle: area factor (1 + 2.25) x 0.75 + 0.25 = 2.6875, and
    // 3.5 x (20 + 2.67) / (60 x 2.6875) = 0.4921. Breath of Fire: (3.25 - 1.76) x 0.75 + 0.25 = 1.3675.
    // Blazing Aura: (1 + 1.8) x 0.75 + 0.25 = 2.35, and 3.5 x 10 / (60 x 2.35) = 0.2482
    expect([circle.rad, circle.cast, breath.rad, aura.rad]).toEqual([15, 2.67, 15, 12]);
    expect(areaFactor(circle)).toBeCloseTo(2.6875, 6);
    expect(procChance(3.5, circle, zinger, 20)).toBeCloseTo(0.4921, 4);
    expect(areaFactor(breath)).toBeCloseTo(1.3675, 4);
    expect(areaFactor(aura)).toBeCloseTo(2.35, 6);
    expect(procChance(3.5, aura, zinger, 0)).toBeCloseTo(0.2482, 4);
    expect(procChance(3.5, scorch, zinger, 0.1)).toBeCloseTo(0.1025, 6);
  });

  it('lists a damage proc taken out as damage a minute lost, with no warning', () => {
    const b = tanker(1);
    const rules = new BuildRules(gd, b);
    const scorch = rules.entries().find((e) => e.power.n === 'Tanker_Melee.Fiery_Melee.Scorch')!;
    expect(isDamageProc(gd, zinger)).toBe(true);
    expect(isDamageProc(gd, gd.power(boost('Crafted_Damage')))).toBe(false);
    const at = gd.archetypeByName.get('class_tanker')!;
    const figures = procFigures(gd, at, scorch.power, scorch.slots, 49, slottedNumbers(gd, at, scorch.power, scorch.slots, 49, 0));
    expect(figures).toHaveLength(1);
    // by hand. Scorch recharges in 3 s and takes 1 s (no recharge slotted): the chance is
    // 3.5 x (3 + 1) / 60 = 0.2333, it is used 60 / (3 + 1) = 15 times a minute, so the proc
    // fires 3.5 times a minute: a single-target click used on cooldown gets its PPM
    expect([scorch.power.rech, scorch.power.cast]).toEqual([3, 1]);
    expect(procChance(3.5, scorch.power, zinger, 3)).toBeCloseTo(0.2333, 4);
    expect(figures[0]!.perMin).toBeCloseTo(3.5, 9);
    expect(figures[0]!.damage).toBeGreaterThan(figures[0]!.perMin);
    // a proc that heals or gives endurance is no damage proc: it has no row, and losing it still warns
    for (const short of ['Crafted_Panacea_F', 'Crafted_Entropic_Chaos_E', 'Crafted_Performance_Shifter_F']) {
      const piece = gd.power(boost(short));
      expect(isDamageProc(gd, piece), short).toBe(false);
      expect(procFigures(gd, at, scorch.power, [{ level: 0, enh: { boost: piece.id, ioLevel: 49 } }], 49, slottedNumbers(gd, at, scorch.power, scorch.slots, 49, 0))).toEqual([]);
    }
    const quiet = { needs: [], crippled: [], wasted: [], capLost: [] } as unknown as Scored;
    expect(warningsOf(gd, quiet, [{ level: 0, enh: { boost: boost('Crafted_Performance_Shifter_F'), ioLevel: 49 } }]).map((w) => w.kind)).toEqual(['procLost']);

    // the proc swapped for a damage IO
    const picks = b.picks.map((p) => (p && p.power === scorch.power.id ? { ...p, slots: p.slots.map((s, i) => (i === 2 ? { level: s.level, enh: { boost: boost('Crafted_Damage'), ioLevel: 49 } } : s)) } : p));
    const d = buildDiff(gd, rules, { ...b, picks });
    const own = d.powers.find((x) => x.key === scorch.key)!;
    const lost = own.losses.find((r) => r.key.startsWith('proc:'))!;
    expect(lost.key).toBe(`proc:${zinger.id}:${figures[0]!.type}`);
    expect(lost.label).toMatch(/^Smashing Damage \(Proc, \d+\.\d\/min\)$/);
    expect(lost.before).toBeCloseTo(figures[0]!.damage, 6);
    expect(lost.after).toBe(0);
    // two of the same proc in the power are one row, worth twice as much
    const twice = b.picks.map((p) => (p && p.power === scorch.power.id ? { ...p, slots: p.slots.map((s, i) => (i === 0 ? { level: s.level, enh: p.slots[2]!.enh } : s)) } : p));
    const both = buildDiff(gd, rules, { ...b, picks: twice }).powers.find((x) => x.key === scorch.key)!;
    const doubled = both.gains.filter((r) => r.key.startsWith('proc:'));
    expect(doubled).toHaveLength(1);
    expect(doubled[0]!.before).toBeCloseTo(figures[0]!.damage, 6);
    expect(doubled[0]!.after).toBeGreaterThan(1.9 * figures[0]!.damage);
    // a damage proc is in the list above, so its loss is no warning
    const scored = { needs: [], crippled: [], wasted: [], capLost: [] } as unknown as Scored;
    expect(warningsOf(gd, scored, [scorch.slots[2]!])).toEqual([]);
  });
});

describe('finder: the order of the lists', () => {
  const swap = (name: string, pieces: number, score: number) => ({ power: power(name).id, count: pieces, score }) as unknown as RankedSwap;
  const ranked = [
    swap('Tanker_Melee.Fiery_Melee.Scorch', 3, 9),
    swap('Tanker_Defense.Fiery_Aura.Fire_Shield', 2, 8),
    swap('Tanker_Melee.Fiery_Melee.Fire_Sword_Circle', 5, 7),
    swap('Tanker_Defense.Fiery_Aura.Fire_Shield', 4, 6),
  ];
  const scores = (sort: FinderSort) => sortSwaps(gd, ranked, sort).map((s) => s.score);

  it('steps Default, Power up and down, Slots up and down, and back', () => {
    const steps: FinderSort[] = [];
    let sort: FinderSort = { by: 'default' };
    for (let i = 0; i < 5; i++) steps.push((sort = nextSort(sort)));
    expect(steps).toEqual([{ by: 'power', desc: false }, { by: 'power', desc: true }, { by: 'slots', desc: false }, { by: 'slots', desc: true }, { by: 'default' }]);
  });

  it('orders by power name or by slots filled, ties in rank order', () => {
    expect(scores({ by: 'default' })).toEqual([9, 8, 7, 6]);
    // Fire Shield, Fire Shield, Fire Sword Circle, Scorch
    expect(scores({ by: 'power', desc: false })).toEqual([8, 6, 7, 9]);
    expect(scores({ by: 'power', desc: true })).toEqual([9, 7, 8, 6]);
    expect(scores({ by: 'slots', desc: false })).toEqual([8, 9, 6, 7]);
    expect(scores({ by: 'slots', desc: true })).toEqual([7, 6, 9, 8]);
    // the list handed in is left as it was
    expect(ranked.map((s) => s.score)).toEqual([9, 8, 7, 6]);
  });
});

describe('finder: powers to consider', () => {
  it('keeps a search to the powers it names', async () => {
    const b = await dominator();
    const rules = new BuildRules(gd, b);
    const all = findSwaps({ gd, stats, build: b, query: query({ goals: [{ goal: 'endurance', importance: 'high' }] }), limit: 500 }).swaps;
    const keys = [...new Set(all.map((s) => s.key))];
    expect(keys.length).toBeGreaterThan(2);
    const entry = rules.entries().find((e) => e.key === keys[1])!;
    const only = findSwaps({ gd, stats, build: b, query: query({ goals: [{ goal: 'endurance', importance: 'high' }], powers: [{ key: entry.key, power: entry.power.id }] }), limit: 500 }).swaps;
    expect(only.length).toBeGreaterThan(0);
    expect(new Set(only.map((s) => s.key))).toEqual(new Set([entry.key]));
    // the same key naming another power (another build's) matches nothing
    expect(findSwaps({ gd, stats, build: b, query: query({ powers: [{ key: entry.key, power: -1 }] }) }).swaps).toEqual([]);
    // a list naming no power is every power, never an empty search
    const none = findSwaps({ gd, stats, build: b, query: query({ goals: [{ goal: 'endurance', importance: 'high' }], powers: [] }), limit: 500 }).swaps;
    expect(none).toEqual(all);
  });

  it('lists the powers a set could go into, and drops picked ones another build lacks', async () => {
    const b = await dominator();
    const rules = new BuildRules(gd, b);
    const pickable = pickablePowers(rules.entries(), (p) => rules.slottable(p), rules.lastLevel());
    expect(pickable.length).toBeGreaterThan(10);
    for (const p of pickable) expect(rules.entries().find((e) => e.key === p.key)!.slots.length).toBeGreaterThan(0);
    const q = query({ powers: [pickable[0]!, { key: 'pick:99', power: 1 }, { key: pickable[1]!.key, power: -5 }] });
    expect(fitQuery(q, [], [], pickable).powers).toEqual([pickable[0]]);
    expect(fitQuery(query({ powers: [{ key: 'pick:99', power: 1 }] }), [], [], pickable).powers).toBeUndefined();
    const whole = query({ powers: [pickable[0]!] });
    expect(fitQuery(whole, [], [], pickable)).toBe(whole);
    // without the build's powers the picked ones are left alone
    expect(fitQuery(q, [], []).powers).toBe(q.powers);
  });
});

describe('finder: picking powers on the overview', () => {
  it('picks and lets go, keeps what was picked when the pane comes back, and forgets it when the pane closes', () => {
    const a = { key: 'pick:0', power: 11 };
    const b = { key: 'pick:3', power: 12 };
    openSetFinder();
    startPickingPowers([a]);
    expect(useFinderOpen.getState()).toMatchObject({ open: true, picking: true, picked: [a] });
    togglePickedPower(b);
    togglePickedPower(a);
    expect(useFinderOpen.getState().picked).toEqual([b]);
    // the same key with another power is another pick
    togglePickedPower({ key: 'pick:3', power: 99 });
    expect(useFinderOpen.getState().picked).toHaveLength(2);
    stopPickingPowers();
    expect(useFinderOpen.getState()).toMatchObject({ open: true, picking: false });
    expect(useFinderOpen.getState().picked).toHaveLength(2);
    startPickingPowers([]);
    closeSetFinder();
    expect(useFinderOpen.getState()).toEqual({ open: false, picking: false, picked: [] });
  });
});

describe('finder: what a swap replaces, in short', () => {
  const ids = (shorts: string[]) => shorts.map(boost);
  const impact = ['A', 'B', 'C', 'D', 'E', 'F'].map((l) => `Crafted_Crushing_Impact_${l}`);

  it('cuts a piece down to what it enhances', () => {
    expect(shortPiece('Accuracy/Damage/Endurance')).toBe('Acc/Dmg/End Cost');
    expect(shortPiece('Endurance Modification/Recharge')).toBe('EndMod/Rech');
    expect(shortPiece('Recharge (Tanker)')).toBe('Rech');
    expect(shortPiece('Accuracy/Hold Duration')).toBe('Acc/Hold');
    // a part with no short form stays as it is
    expect(shortPiece('Chance for Smashing Damage')).toBe('Chance for Smashing Damage');
  });

  it('names a whole set by its count, part of a set by its pieces, and the rest on one line', () => {
    // every piece of a set
    expect(replacedLines(gd, ids(impact))).toEqual(['Crushing Impact: 6/6']);
    // some pieces of a set, in slot order, then the single ones together
    const mixed = replacedLines(gd, ids([impact[0]!, impact[1]!, 'Crafted_Recharge', 'Crafted_Accuracy', 'Crafted_Obliteration_F']));
    expect(mixed).toHaveLength(2);
    expect(mixed[0]).toMatch(/^Crushing Impact: [A-Za-z /]+, [A-Za-z /]+$/);
    expect(mixed[0]).not.toMatch(/Accuracy|Damage\b|Recharge/);
    expect(mixed[1]).toBe('IO: Rech, IO: Acc, Obliteration: Chance for Smashing Damage');
    // two sets in part: a line each
    const two = replacedLines(gd, ids([impact[0]!, impact[1]!, 'Crafted_Obliteration_A', 'Crafted_Obliteration_B']));
    expect(two.map((l) => l.split(':')[0])).toEqual(['Crushing Impact', 'Obliteration']);
    // an id the data lacks is still said
    expect(replacedLines(gd, [-1])).toEqual(['an enhancement']);
    // a Hamidon piece has a short kind; a special piece with none is named in full, never by an internal kind
    expect(replacedLines(gd, ids(['Hamidon_Damage_Accuracy']))).toEqual(['HO: Acc/Dam']);
    expect(replacedLines(gd, ids(['DSync_Damage_Accuracy', 'Generic_Clockwork_Efficiency']))).toEqual(['D-Sync Empowerment (Acc/Dam), Clockwork Efficiency: Damage/Recharge/Chance for Energy Damage']);
    expect(replacedLines(gd, [])).toEqual([]);
  });
});

describe('finder: what is a warning', () => {
  it('does not warn about a power slotted for less recharge', () => {
    const scored = (aspect: 'out' | 'rech' | 'acc') => ({ needs: [], wasted: [], capLost: [], crippled: [{ role: 'st', aspect, lost: 0.23, only: false }] }) as unknown as Scored;
    expect(warningsOf(gd, scored('rech'), [])).toEqual([]);
    expect(warningsOf(gd, scored('out'), []).map((w) => w.kind)).toEqual(['crippled']);
    expect(warningsOf(gd, scored('acc'), []).map((w) => w.kind)).toEqual(['crippled']);
  });
});

describe('finder: the knockback protection a build is held to', () => {
  it('is 8 wherever the statistics name knockback protection, and nothing where they do not', () => {
    expect(KNOCKBACK_NEED).toBe(8);
    // the statistics give these groups other amounts (a Blaster 3, Fiery Aura 7.5): all are held to 8
    expect(stats.needs['Class_Blaster']!['mezprot.Knock']!.typical).not.toBe(8);
    expect(needsFor(stats.needs, ['Class_Blaster']).get('mezprot.Knock')).toBe(8);
    expect(needsFor(stats.needs, ['Class_Tanker', 'Tanker_Defense.Fiery_Aura']).get('mezprot.Knock')).toBe(8);
    expect(needsFor(stats.needs, ['Class_Tanker', 'Tanker_Defense.Fiery_Aura']).has('mezprot.Knockup')).toBe(false);
    // a group the statistics name no knockback need for gets none
    expect(needsFor(stats.needs, ['No_Such_Group']).has('mezprot.Knock')).toBe(false);
    expect(warningText(gd, { kind: 'needDropped', stat: 'mezprot.Knock', before: 12, after: 4, typical: KNOCKBACK_NEED })).toBe(
      'Knockback (Status Prot) falls from 12.0 to 4.00, below the 8.00 suggested for this build.',
    );
  });
});
