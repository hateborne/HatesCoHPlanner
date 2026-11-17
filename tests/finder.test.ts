import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { brotliDecompressSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import type { FinderStats } from '../src/data/finderStats.ts';
import { truncateAbove } from '../src/engine/actions.ts';
import { newBuild, type Build, type Slot } from '../src/engine/build.ts';
import { setRarity } from '../src/engine/enhance.ts';
import { pieceKind } from '../src/engine/finder/candidates.ts';
import { DEFENSE_SOFT_CAP, FinderBase } from '../src/engine/finder/core.ts';
import { buildDiff } from '../src/engine/finder/diff.ts';
import { BASELINE, groupFor, LOSS_WEIGHT, MAIN_WEIGHT, weightsFor } from '../src/engine/finder/goals.ts';
import { applySwap, applySwaps, dropSwap, isStale, keepSwap, slotIds, type Swap } from '../src/engine/finder/pending.ts';
import { slottedNumbers } from '../src/engine/finder/powerNumbers.ts';
import { queryProblem, type FinderQuery } from '../src/engine/finder/query.ts';
import { isSelfHeal, rolesOf } from '../src/engine/finder/roles.ts';
import { needsFor, Scorer } from '../src/engine/finder/score.ts';
import { finderProblem, findSwaps, searchSwaps } from '../src/engine/finder/search.ts';
import { powerInfo, segText } from '../src/engine/powerinfo.ts';
import { BuildRules, type BuildEntry } from '../src/engine/rules.ts';
import { computeTotals } from '../src/engine/totals.ts';
import { importMbd, importMidsText, type Mbd } from '../src/io/mids.ts';
import { loadData, loadMidsMapFile, pid, sid } from './helpers/data.ts';

const gd = loadData();
const stats = JSON.parse(readFileSync(join(process.cwd(), 'public', 'data', 'finder', 'stats.json'), 'utf-8')) as FinderStats;
const map = loadMidsMapFile(gd.core.manifest.dataVersion);
const fixture = (name: string) => readFileSync(join(process.cwd(), 'tests', 'fixtures', 'builds', name), 'utf-8');
const power = (name: string) => gd.power(pid(gd, name));
const boost = (short: string) => pid(gd, `Boosts.${short}.${short}`);

/** @return The Symphony / Dark Dominator forum build: a finished level 50 build full of sets and procs. */
async function dominator(): Promise<Build> {
  return (await importMidsText(gd, map, fixture('symphony-dark-dominator.txt'))).build;
}

/** @return The Archery / Traps Corruptor forum build (a |MBD; chunk, decoded with Node's own Brotli). */
function corruptor(): Build {
  const lines = fixture('archery-traps-corruptor.txt')
    .split(/\r?\n/)
    .map((l) => l.trim());
  const b64 = lines
    .slice(lines.findIndex((l) => l.startsWith('|MBD;')) + 1)
    .filter((l) => /^\|[A-Za-z0-9+/=]+\|$/.test(l))
    .map((l) => l.slice(1, -1))
    .join('');
  return importMbd(gd, map, JSON.parse(brotliDecompressSync(Buffer.from(b64, 'base64')).toString('utf-8')) as Mbd).build;
}

/**
 * A small Radiation Melee / Fiery Aura Brute slotted with common IOs: an attack, an armor toggle,
 * Healing Flames (its only self heal) and Weave. (Its picks and slot levels are not a legal
 * leveling order; the finder only refills slots.)
 */
function brute(): Build {
  const b = newBuild({
    dataVersion: gd.core.manifest.dataVersion,
    at: gd.archetypeByName.get('class_brute')!.id,
    origin: gd.core.origins[0]!.id,
    alignment: 'Hero',
    primary: sid(gd, 'Brute_Melee.Radiation_Melee'),
    secondary: sid(gd, 'Brute_Defense.Fiery_Aura'),
    pickCount: gd.core.schedule.power.length,
  });
  const put = (i: number, name: string, pieces: string[]) => {
    const level = gd.core.schedule.power[i]!;
    b.picks[i] = { power: pid(gd, name), level, slots: pieces.map((p): Slot => ({ level, enh: { boost: boost(p), ioLevel: 49 } })) };
  };
  put(0, 'Brute_Melee.Radiation_Melee.Contaminated_Strike', ['Crafted_Damage', 'Crafted_Damage', 'Crafted_Damage', 'Crafted_Accuracy']);
  put(1, 'Brute_Defense.Fiery_Aura.Fire_Shield', ['Crafted_Res_Damage', 'Crafted_Res_Damage', 'Crafted_Res_Damage']);
  put(4, 'Brute_Defense.Fiery_Aura.Healing_Flames', ['Crafted_Heal', 'Crafted_Heal', 'Crafted_Recharge', 'Crafted_Recharge']);
  put(15, 'Pool.Fighting.Weave', ['Crafted_Defense_Buff', 'Crafted_Endurance_Discount']);
  return b;
}

/** @return A build's rule issues as text, to tell which ones a change adds. */
const issuesOf = (rules: BuildRules): Set<string> => new Set(rules.issues().map((i) => `${i.key}|${i.slot ?? ''}|${i.message}`));

/** Expect a change to add no rule issue (one fixed while another appears would still fail). */
function expectNoNewIssue(before: Set<string>, rules: BuildRules): void {
  expect([...issuesOf(rules)].filter((i) => !before.has(i))).toEqual([]);
}

/** Expect quick line changes to equal the difference of two full totals, line by line. */
function expectExact(b: Build, rules: BuildRules, after: Build, quick: Map<string, number>, what: string): void {
  const level = rules.lastLevel();
  const t0 = computeTotals(gd, rules, b, level);
  const t1 = computeTotals(gd, rules.reslotted(after), after, level);
  for (const key of new Set([...t0.lines.keys(), ...t1.lines.keys(), ...quick.keys()])) {
    if (key === 'def.base') continue;
    const exact = (t1.lines.get(key)?.value ?? 0) - (t0.lines.get(key)?.value ?? 0);
    expect(quick.get(key) ?? 0, `${what}: ${key}`).toBeCloseTo(exact, 9);
  }
}

const query = (q: Partial<FinderQuery>): FinderQuery => ({ goals: [{ goal: 'recharge', importance: 'high' }], tags: [], extra: [], ...q });
const ALL_TAGS: FinderQuery['tags'] = ['pvp', 'seasonal', 'purple', 'archetype'];
const setOf = (s: Swap) => gd.boostSetById.get(s.set)!;

describe('finder: what a power is for', () => {
  it('reads roles from the enhancements a power accepts and what it does', () => {
    const role = (name: string) => rolesOf(gd, power(name)).roles.map((r) => r.role);
    expect(role('Sentinel_Ranged.Fire_Blast.Fire_Ball')).toEqual(['aoe']);
    expect(role('Sentinel_Ranged.Fire_Blast.Blaze')).toEqual(['st']);
    expect(role('Brute_Defense.Fiery_Aura.Healing_Flames')).toEqual(['heal']);
    expect(role('Pool.Fighting.Weave')).toEqual(['other']);
    // a hold that also does damage has both jobs
    expect(role('Dominator_Control.Symphony_Control.Hymn_of_Dissonance')).toEqual(['st', 'ctrl']);
    expect(isSelfHeal(gd, power('Brute_Defense.Fiery_Aura.Healing_Flames'))).toBe(true);
    expect(isSelfHeal(gd, power('Pool.Fighting.Weave'))).toBe(false);
    // a toggle on its own user against one aimed at enemies; only a click's recharge is worth a slot
    expect(rolesOf(gd, power('Pool.Fighting.Weave'))).toMatchObject({ onSelf: true, rech: false });
    expect(rolesOf(gd, power('Defender_Buff.Radiation_Emission.Radiation_Infection')).onSelf).toBe(false);
    expect(rolesOf(gd, power('Brute_Defense.Fiery_Aura.Healing_Flames')).rech).toBe(true);
  });

  it("tells a unique piece's global and a proc from a plain piece", () => {
    const kind = (short: string) => pieceKind(gd, gd.power(boost(short)));
    expect(kind('Crafted_Luck_of_the_Gambler_F')).toBe('global'); // +7.5% recharge, named by its set's global entry
    expect(kind('Crafted_Miracle_F')).toBe('global'); // +recovery, an effect of its own
    expect(kind('Crafted_Gladiators_Javelin_F')).toBe('proc');
    expect(kind('Crafted_Thunderstrike_A')).toBe('plain');
  });

  it('gives the numbers the power info is written from', () => {
    const at = gd.archetypeByName.get('class_brute')!;
    const flames = power('Brute_Defense.Fiery_Aura.Healing_Flames');
    const slots: Slot[] = ['Crafted_Heal', 'Crafted_Recharge'].map((p) => ({ level: 0, enh: { boost: boost(p), ioLevel: 49 } }));
    const bare = slottedNumbers(gd, at, flames, [], 49, 0);
    const slotted = slottedNumbers(gd, at, flames, slots, 49, 0.5);
    expect(bare.heal.base).toBeGreaterThan(0);
    expect(bare.heal.enh).toBe(bare.heal.base);
    expect(slotted.heal.enh).toBeGreaterThan(slotted.heal.base);
    expect(slotted.recharge.enh).toBeLessThan(slotted.recharge.base);
    // the build's global recharge adds to the slotted recharge
    expect(slotted.rechargeGlobal).toBeLessThan(slotted.recharge.enh);
    // the damage number is the one the "Average Damage" row prints
    const strike = power('Brute_Melee.Radiation_Melee.Contaminated_Strike');
    const info = powerInfo(gd, at, strike, 49, null);
    expect(segText(info.stats[0]!.value)).toBe(info.numbers.damage.base.toFixed(2));
  });
});

describe('finder: weights', () => {
  it('counts a chosen goal by its importance, the rest a little, and a loss in full', () => {
    const w = weightsFor(gd, stats, 'Class_Blaster', query({}));
    const unchosen = weightsFor(gd, stats, 'Class_Blaster', query({ goals: [{ goal: 'movement', importance: 'low' }] }));
    expect(w.stat.get('rech')!).toBeGreaterThan(unchosen.stat.get('rech')!);
    expect(unchosen.stat.get('rech')).toBeCloseTo(BASELINE);
    expect(unchosen.statLoss.get('rech')).toBeCloseTo(LOSS_WEIGHT);
    for (const [key, gain] of w.stat) expect(w.statLoss.get(key)!).toBeGreaterThanOrEqual(gain);
    // the wanted bonus and the additional ones raise their own stat
    const main = weightsFor(gd, stats, 'Class_Blaster', query({ main: { stat: 'acc', depth: 'any' }, extra: ['recov'] }));
    expect(main.stat.get('acc')! - w.stat.get('acc')!).toBeCloseTo(MAIN_WEIGHT);
    expect(main.stat.get('recov')!).toBeGreaterThan(w.stat.get('recov')!);
  });

  it('counts an "all damage" bonus once, and the healing bonus as sustain', () => {
    const w = weightsFor(gd, stats, 'Class_Blaster', query({ goals: [{ goal: 'stDamage', importance: 'medium' }] }));
    const attack = [...w.stat.keys()].filter((k) => k.startsWith('dmg.') && k !== 'dmg.07');
    expect(attack.length).toBeGreaterThan(5);
    // every attack damage type together is worth what the goal gives damage: 1 x Medium, plus the baseline
    expect(attack.reduce((n, k) => n + w.stat.get(k)!, 0)).toBeCloseTo(1 + BASELINE);
    const sustain = weightsFor(gd, stats, 'Class_Blaster', query({ goals: [{ goal: 'sustain', importance: 'high' }] }));
    expect(sustain.stat.get('dmg.07')!).toBeGreaterThan(w.stat.get('dmg.07')!);
  });

  it("uses every build's statistics for an archetype with too few builds", () => {
    expect(groupFor(stats, 'Class_Warshade')).toBe(stats.groups['all']);
    expect(groupFor(stats, 'Class_Blaster')).toBe(stats.groups['Class_Blaster']);
    expect(needsFor(stats.needs, ['Class_Blaster']).get('mezprot.Knock')).toBeGreaterThan(0);
    expect(needsFor(stats.needs, ['Class_Blaster']).has('mezprot.Knockup')).toBe(false);
  });
});

describe('finder: search', () => {
  it('ranks with figures that equal the full totals, and offers only legal swaps', async () => {
    for (const b of [await dominator(), corruptor()]) {
      const rules = new BuildRules(gd, b);
      const issues = issuesOf(rules);
      const found = [
        ...findSwaps({ gd, stats, build: b, query: query({ tags: ALL_TAGS }), limit: 40 }).swaps,
        ...findSwaps({ gd, stats, build: b, query: query({ goals: [{ goal: 'endurance', importance: 'high' }], attuned: true }), limit: 40 }).swaps,
      ];
      expect(found.length).toBeGreaterThan(20);
      for (const [i, s] of found.entries()) {
        const after = applySwap(b, s);
        // the rule check is slow: every fifth swap
        if (i % 5 === 0) expectNoNewIssue(issues, rules.reslotted(after));
        expectExact(b, rules, after, new Map(s.lines), `${setOf(s).n} into ${s.key}`);
        expect(isStale(s, rules.entries().find((e) => e.key === s.key)!.slots)).toBe(false);
      }
    }
  }, 60000);

  it('looks at uncommon and rare sets unless a tag lets more in', () => {
    const b = corruptor();
    const kinds = (tags: FinderQuery['tags']) => new Set(findSwaps({ gd, stats, build: b, query: query({ tags }), limit: 500 }).swaps.map((s) => setRarity(setOf(s))?.kind));
    expect([...kinds([])].sort()).toEqual(['rare', 'uncommon']);
    const all = kinds(ALL_TAGS);
    expect(all.has('veryRare') || all.has('pvp') || all.has('superiorArchetype') || all.has('superiorWinter')).toBe(true);
    // at level 50 the Superior version stands in for the plain archetype and winter sets
    expect(all.has('archetype')).toBe(false);
    expect(all.has('winter')).toBe(false);
  });

  it('keeps to the wanted bonus and its depth', () => {
    const b = brute();
    const run = (stat: string, depth: '2-3' | '4-6' | 'any') => findSwaps({ gd, stats, build: b, query: query({ main: { stat, depth } }), limit: 500 }).swaps;
    const shallow = run('recov', '2-3');
    const deep = run('recov', '4-6');
    expect(shallow.length).toBeGreaterThan(0);
    expect(deep.length).toBeGreaterThan(0);
    for (const s of shallow) expect(s.count).toBeLessThanOrEqual(3);
    for (const s of deep) expect(s.count).toBeGreaterThanOrEqual(4);
    for (const s of [...shallow, ...deep]) expect(new Map(s.lines).get('recov') ?? 0).toBeGreaterThan(0);
    // the recovery comes from a bonus of the asked depth, not from a shallower one on the way there
    const base = new FinderBase(gd, new BuildRules(gd, b), b);
    const givesRecovery = (s: Swap, lo: number, hi: number) =>
      setOf(s).bon.some((x) => x.min >= lo && x.min <= hi && x.min <= s.count && x.auto.some((id) => base.vecs.of(gd.power(id), /*global=*/ false).some((l) => l.key === 'recov' && l.value > 0)));
    for (const s of shallow) expect(givesRecovery(s, 2, 3), setOf(s).n).toBe(true);
    for (const s of deep) expect(givesRecovery(s, 4, 6), setOf(s).n).toBe(true);
    // "anywhere" also reaches a unique piece's global: Luck of the Gambler's recharge, one piece
    const anywhere = run('rech', 'any');
    for (const s of anywhere) expect(new Map(s.lines).get('rech') ?? 0).toBeGreaterThan(0);
    const gambler = anywhere.find((s) => setOf(s).n === 'Luck_of_the_Gambler' && s.count === 1)!;
    expect(gd.power(gambler.power).n).toBe('Pool.Fighting.Weave');
    expect(gambler.pieces.map((p) => gd.power(p.enh.boost).n)).toEqual(['Boosts.Crafted_Luck_of_the_Gambler_F.Crafted_Luck_of_the_Gambler_F']);
  });

  it('keeps to the set categories asked for', () => {
    const q = query({ goals: [{ goal: 'resistance', importance: 'high' }], groups: ['Resist Damage'] });
    const found = findSwaps({ gd, stats, build: brute(), query: q, limit: 500 }).swaps;
    expect(found.length).toBeGreaterThan(0);
    for (const s of found) expect(setOf(s).grp).toBe('Resist Damage');
  });

  it('places crafted pieces at the highest level that works, or attuned ones when asked', () => {
    const b = corruptor();
    for (const s of findSwaps({ gd, stats, build: b, query: query({}) }).swaps) {
      for (const p of s.pieces) expect(p.enh.ioLevel).toBe(Math.min(setOf(s).maxL - 1, 49 + 3));
    }
    const attuned = findSwaps({ gd, stats, build: b, query: query({ attuned: true }) }).swaps;
    expect(attuned.length).toBeGreaterThan(0);
    for (const s of attuned) for (const p of s.pieces) expect(gd.power(p.enh.boost).bup, gd.power(p.enh.boost).n).toBeTruthy();
  });

  it('offers a level 35 build sets it can use: pieces up to level 38, no level 50 sets', () => {
    const b: Build = { ...truncateAbove(corruptor(), 34), endLevel: 34 };
    const rules = new BuildRules(gd, b);
    const issues = issuesOf(rules);
    const found = findSwaps({ gd, stats, build: b, query: query({ tags: ALL_TAGS }), limit: 500 }).swaps;
    expect(found.length).toBeGreaterThan(10);
    for (const [i, s] of found.entries()) {
      expect(setRarity(setOf(s))?.kind).not.toBe('veryRare');
      expect(setOf(s).n.startsWith('Superior_')).toBe(false);
      for (const p of s.pieces) expect(p.enh.ioLevel ?? 0).toBeLessThanOrEqual(37); // 0-based: level 38
      // the rule check is slow: every tenth swap
      if (i % 10 === 0) expectNoNewIssue(issues, rules.reslotted(applySwap(b, s)));
    }
    // sets whose pieces start above the build's reach are left out
    expect(found.some((s) => setOf(s).minL > 38)).toBe(false);
  }, 60000);

  it('ranks again after each kept swap until the wanted bonus has no room left', () => {
    const b = corruptor();
    const rules = new BuildRules(gd, b);
    const issues = issuesOf(rules);
    const rech = (x: Build) => computeTotals(gd, rules.reslotted(x), x).lines.get('rech')?.value ?? 0;
    let kept: Swap[] = [];
    let total = rech(b);
    for (let i = 0; i < 40; i++) {
      const top = findSwaps({ gd, stats, build: b, kept, query: query({ main: { stat: 'rech', depth: 'any' } }), limit: 1 }).swaps[0];
      if (!top) break;
      kept = keepSwap(kept, top);
      const now = rech(applySwaps(b, kept));
      // every kept swap adds recharge the totals really count (the rule of five and unique pieces respected)
      expect(now).toBeGreaterThan(total + 1e-9);
      total = now;
    }
    expect(kept.length).toBeGreaterThan(2);
    expect(kept.length).toBeLessThan(40);
    expect(new Set(kept.map((k) => k.key)).size).toBe(kept.length);
    expectNoNewIssue(issues, rules.reslotted(applySwaps(b, kept)));
    expect(b).toEqual(corruptor()); // the build itself is never touched
  }, 60000);

  it('marks down and warns about a swap that guts the only self heal', () => {
    const b = brute();
    const rules = new BuildRules(gd, b);
    const base = new FinderBase(gd, rules, b);
    const q = query({ goals: [{ goal: 'resistance', importance: 'critical' }] });
    const scorer = new Scorer(base, weightsFor(gd, stats, base.at.n, q), new Map());
    const flames = rules.entries().find((e) => e.power.n === 'Brute_Defense.Fiery_Aura.Healing_Flames')!;
    expect(scorer.roleCount('heal')).toBe(1);
    const gutted: Slot[] = flames.slots.map((s) => ({ level: s.level, enh: { boost: boost('Crafted_Res_Damage'), ioLevel: 49 } }));
    const scored = scorer.score(flames, base.state(flames, flames.slots), base.state(flames, gutted));
    expect(scored.crippled).toContainEqual(expect.objectContaining({ role: 'heal', aspect: 'out', only: true }));
    expect(scored.crippled).toContainEqual(expect.objectContaining({ role: 'heal', aspect: 'rech' }));
    expect(scored.score).toBeLessThan(0);
    // and no search result guts it without saying so
    for (const s of findSwaps({ gd, stats, build: b, query: q, limit: 500 }).swaps.filter((x) => x.key === flames.key)) {
      const heal = scorer.score(flames, base.state(flames, flames.slots), base.state(flames, rules.reslotted(applySwap(b, s)).entries().find((e) => e.key === flames.key)!.slots));
      expect(s.warnings.filter((w) => w.kind === 'crippled')).toHaveLength(heal.crippled.length);
    }
  });

  it('counts nothing past a cap', () => {
    const b = brute();
    const base = new FinderBase(gd, new BuildRules(gd, b), b);
    expect(base.cap('def.03')).toBe(DEFENSE_SOFT_CAP);
    expect(base.cappedChange('def.03', 1)).toBeCloseTo(DEFENSE_SOFT_CAP - base.value('def.03'));
    const cap = base.cap('res.02')!; // fire resistance: Fire Shield alone is far from the Brute cap
    expect(base.cappedChange('res.02', 5)).toBeCloseTo(cap - Math.min(cap, base.value('res.02')));
    expect(base.cappedChange('recov', 0.5)).toBe(0.5);
  });

  it('says why it cannot search', () => {
    const b = corruptor();
    expect(queryProblem(query({ goals: [] }))).toMatch(/at least one/);
    expect(findSwaps({ gd, stats, build: b, query: query({ goals: [] }) })).toEqual({ swaps: [], considered: 0, stale: [], problem: 'Pick at least one priority.' });
    expect(finderProblem(gd, b, stats)).toBeNull();
    expect(finderProblem(gd, { ...b, dataVersion: 'i28p3' }, stats)).toMatch(/game version/);
    expect(finderProblem(gd, b, null)).toMatch(/game version/);
    expect(finderProblem(loadData(undefined, 'thunderspy'), b, stats)).toMatch(/Homecoming builds only/);
  });

  it('reports its progress power by power, and stays fast', async () => {
    const b = await dominator();
    findSwaps({ gd, stats, build: b, query: query({}) }); // warm up
    const started = performance.now();
    const run = searchSwaps({ gd, stats, build: b, query: query({ tags: ALL_TAGS }) });
    const steps: number[] = [];
    let step = run.next();
    while (!step.done) {
      steps.push(step.value);
      step = run.next();
    }
    const took = performance.now() - started;
    expect(steps.length).toBeGreaterThan(20);
    expect(steps).toEqual([...steps].sort((x, y) => x - y));
    expect(steps[steps.length - 1]).toBe(1);
    expect(step.value.swaps.length).toBeGreaterThan(0);
    // about 0.2 s on a desktop; the limit only guards against a change that makes it many times slower
    expect(took).toBeLessThan(5000);
  }, 60000);
});

describe('finder: review fixes', () => {
  const entryOf = (rules: BuildRules, name: string): BuildEntry => rules.entries().find((e) => e.power.n === name)!;

  it('counts a piece held by two running powers once, as the totals do', () => {
    const b = brute();
    const level = gd.core.schedule.power[9]!;
    const skin = (): Slot => ({ level, enh: { boost: boost('Crafted_Impervious_Skin_E'), ioLevel: 29 } });
    b.picks[1]!.slots.push(skin()); // Fire Shield
    b.picks[9] = { power: pid(gd, 'Brute_Defense.Fiery_Aura.Plasma_Shield'), level, slots: [{ level, enh: { boost: boost('Crafted_Res_Damage'), ioLevel: 49 } }, skin()] };
    const rules = new BuildRules(gd, b);
    const base = new FinderBase(gd, rules, b);
    // its regeneration is in the totals once
    expect(base.totals.lines.get('regen')!.sources.filter((x) => /Impervious Skin/.test(x.name))).toHaveLength(1);
    for (const name of ['Brute_Defense.Fiery_Aura.Fire_Shield', 'Brute_Defense.Fiery_Aura.Plasma_Shield']) {
      const e = entryOf(rules, name);
      const at = e.slots.findIndex((x) => x.enh?.boost === boost('Crafted_Impervious_Skin_E'));
      // take the piece out of one power: the other still gives its effects
      const emptied = e.slots.map((x, i) => (i === at ? { level: x.level } : x));
      const out = base.delta(e, base.state(e, e.slots), base.state(e, emptied)).lines;
      expect(out.get('regen') ?? 0, name).toBeCloseTo(0, 9);
      const pick = Number(e.key.split(':')[1]);
      const after: Build = { ...b, picks: b.picks.map((p, i) => (i === pick && p ? { ...p, slots: emptied } : p)) };
      expectExact(b, rules, after, out, `emptying ${name}`);
    }
    // and putting it into a third running power changes nothing either
    const weave = entryOf(rules, 'Pool.Fighting.Weave');
    const added = weave.slots.map((x, i): Slot => (i === 1 ? { level: x.level, enh: skin().enh } : x));
    const into = base.delta(weave, base.state(weave, weave.slots), base.state(weave, added)).lines;
    expect(into.get('regen') ?? 0).toBeCloseTo(0, 9);
  });

  it("works at the build's last level, whatever exemplar level the build shows", () => {
    const b = corruptor();
    const low: Build = { ...b, exemplar: 19 };
    const q = query({ tags: ALL_TAGS });
    expect(findSwaps({ gd, stats, build: low, query: q, limit: 30 })).toEqual(findSwaps({ gd, stats, build: b, query: q, limit: 30 }));
    const swap = findSwaps({ gd, stats, build: b, query: q, limit: 1 }).swaps[0]!;
    expect(buildDiff(gd, new BuildRules(gd, low), applySwap(low, swap))).toEqual(buildDiff(gd, new BuildRules(gd, b), applySwap(b, swap)));
  });

  it('counts the strength of a running toggle aimed at enemies, which no totals line shows', () => {
    const b = newBuild({
      dataVersion: gd.core.manifest.dataVersion,
      at: gd.archetypeByName.get('class_defender')!.id,
      origin: gd.core.origins[0]!.id,
      alignment: 'Hero',
      primary: sid(gd, 'Defender_Buff.Radiation_Emission'),
      secondary: sid(gd, 'Defender_Ranged.Radiation_Blast'),
      pickCount: gd.core.schedule.power.length,
    });
    const debuff = (): Slot => ({ level: 0, enh: { boost: boost('Crafted_Defense_DeBuff'), ioLevel: 49 } });
    b.picks[0] = { power: pid(gd, 'Defender_Buff.Radiation_Emission.Radiation_Infection'), level: 0, slots: [debuff(), debuff(), debuff()], on: true };
    const rules = new BuildRules(gd, b);
    const base = new FinderBase(gd, rules, b);
    const scorer = new Scorer(base, weightsFor(gd, stats, base.at.n, query({})), new Map());
    const e = rules.entries().find((x) => x.key === 'pick:0')!;
    expect(base.st.isOn(e)).toBe(true);
    const stripped = e.slots.map((x) => ({ level: x.level }));
    const scored = scorer.score(e, base.state(e, e.slots), base.state(e, stripped));
    expect([...scored.lines.keys()].filter((k) => k !== 'enduse')).toEqual([]);
    expect(scored.crippled).toContainEqual(expect.objectContaining({ role: 'other', aspect: 'out' }));
    expect(scored.score).toBeLessThan(0);
    // a running toggle on its own user loses its lines instead, and is not counted twice
    const own = brute();
    const ownRules = new BuildRules(gd, own);
    const ownBase = new FinderBase(gd, ownRules, own);
    const weave = entryOf(ownRules, 'Pool.Fighting.Weave');
    const bare = new Scorer(ownBase, weightsFor(gd, stats, ownBase.at.n, query({})), new Map()).score(weave, ownBase.state(weave, weave.slots), ownBase.state(weave, weave.slots.map((x) => ({ level: x.level }))));
    expect(bare.crippled.some((c) => c.aspect === 'out')).toBe(false);
    expect([...bare.lines.keys()].some((k) => k.startsWith('def.'))).toBe(true);
  });

  it('leaves a set piece in a slot the build does not have yet out of the count', () => {
    // Healing Flames holds two Miracle pieces, the second in a slot gained after the stop level
    const b: Build = { ...brute(), endLevel: 20 };
    const flames = b.picks[4]!;
    for (const s of flames.slots) s.enh!.ioLevel = 23; // common IOs a level 21 character can use
    flames.slots[0] = { level: flames.level, enh: { boost: boost('Crafted_Miracle_A'), ioLevel: 23 } };
    flames.slots[3] = { level: 40, enh: { boost: boost('Crafted_Miracle_B'), ioLevel: 23 } };
    const set = gd.boostSets.find((x) => x.n === 'Miracle')!.id;
    const found = findSwaps({ gd, stats, build: b, query: query({ goals: [{ goal: 'sustain', importance: 'high' }] }), limit: 500 }).swaps.filter((x) => x.key === 'pick:4' && x.set === set);
    expect(found.length).toBe(1);
    // the count is what the build holds at its stop level: piece A and the new ones, not piece B
    expect(found[0]!.count).toBe(1 + found[0]!.pieces.length);
    expect(found[0]!.pieces.some((p) => p.enh.boost === boost('Crafted_Miracle_B'))).toBe(false);
    expect(found[0]!.pieces.every((p) => p.slot !== 3)).toBe(true);
  });
});

describe('finder: kept swaps', () => {
  it('holds one swap per power and leaves the build alone', () => {
    const b = corruptor();
    const found = findSwaps({ gd, stats, build: b, query: query({}), limit: 200 }).swaps;
    const first = found[0]!;
    const other = found.find((s) => s.key !== first.key)!;
    const again = found.find((s) => s.key === first.key && s.set !== first.set)!;
    expect(again).toBeDefined();
    let kept = keepSwap([], first);
    kept = keepSwap(kept, other);
    kept = keepSwap(kept, again);
    expect(kept.map((k) => k.key)).toEqual([other.key, first.key]);
    expect(kept[1]!.set).toBe(again.set);
    expect(dropSwap(kept, other.key).map((k) => k.key)).toEqual([first.key]);
    const copy = corruptor();
    const after = applySwaps(b, kept);
    expect(b).toEqual(copy);
    const entry = new BuildRules(gd, after).entries().find((e) => e.key === first.key)!;
    for (const p of again.pieces) expect(entry.slots[p.slot]!.enh).toEqual(p.enh);
  });

  it('offers a power with a kept swap a replacement worked out from its own slots', () => {
    const b = corruptor();
    const rules = new BuildRules(gd, b);
    const first = findSwaps({ gd, stats, build: b, query: query({}), limit: 1 }).swaps[0]!;
    const next = findSwaps({ gd, stats, build: b, kept: [first], query: query({}), limit: 500 }).swaps;
    // the kept swap itself is not offered again, and a kept swap made for another build is ignored
    expect(next.some((s) => s.key === first.key && s.set === first.set && s.count === first.count)).toBe(false);
    const other = findSwaps({ gd, stats, build: b, kept: [{ ...first, power: -1 }], query: query({}), limit: 1 });
    expect(other.swaps[0]).toEqual(first);
    expect(other.stale).toEqual([first.key]);
    // so is one made before the player changed the power's slots
    const edited = findSwaps({ gd, stats, build: b, kept: [{ ...first, before: first.before.map(() => null) }], query: query({}), limit: 1 });
    expect(edited.swaps[0]).toEqual(first);
    expect(edited.stale).toEqual([first.key]);
    expect(first.before).toEqual(slotIds(rules.entries().find((e) => e.key === first.key)!.slots));
    const issues = issuesOf(rules);
    for (const s of next.filter((x) => x.key === first.key)) {
      expectNoNewIssue(issues, rules.reslotted(applySwaps(b, keepSwap([first], s))));
    }
    // with kept swaps in several powers, every offer is legal with all of them in
    const second = next.find((s) => s.key !== first.key)!;
    const both = [first, second];
    const more = findSwaps({ gd, stats, build: b, kept: both, query: query({ tags: ALL_TAGS }), limit: 30 }).swaps;
    expect(more.length).toBeGreaterThan(0);
    for (const [i, s] of more.entries()) if (i % 3 === 0) expectNoNewIssue(issues, rules.reslotted(applySwaps(b, keepSwap(both, s))));
  }, 60000);
});

describe('finder: gains and losses', () => {
  it('lists what the full totals and the changed power gain and lose', () => {
    const b = brute();
    const rules = new BuildRules(gd, b);
    const flames = rules.entries().find((e) => e.power.n === 'Brute_Defense.Fiery_Aura.Healing_Flames')!;
    // four Miracle pieces over its heal and recharge enhancements: recovery, max HP and a healing bonus
    const after = applySwap(b, {
      key: flames.key,
      power: flames.power.id,
      freeLevel: flames.level,
      set: gd.boostSets.find((s) => s.n === 'Miracle')!.id,
      count: 4,
      pieces: ['A', 'B', 'C', 'D'].map((l, slot) => ({ slot, enh: { boost: boost(`Crafted_Miracle_${l}`), ioLevel: 39 } })),
      before: slotIds(flames.slots),
    });
    const d = buildDiff(gd, rules, after);
    const t0 = computeTotals(gd, rules, b);
    const t1 = computeTotals(gd, rules.reslotted(after), after);
    const rows = [...d.gains, ...d.losses];
    for (const r of rows) expect(r.before).not.toBeCloseTo(r.after, 9);
    // a plain line is the totals' capped value on each side
    const plain = rows.filter((r) => /^(res|mezres|def|dmg)\./.test(r.key) || r.key === 'rech');
    expect(plain.length).toBeGreaterThan(0);
    for (const r of plain) expect([r.before, r.after]).toEqual([t0.lines.get(r.key)?.capped ?? 0, t1.lines.get(r.key)?.capped ?? 0]);
    // max HP is the figure the totals panel shows, not the line's added hit points
    expect(t1.hpMax).not.toBe(t0.hpMax);
    expect(rows.find((r) => r.key === 'hp')).toMatchObject({ before: t0.hpMax, after: t1.hpMax });
    expect(d.powers).toHaveLength(1);
    expect(d.powers[0]!.key).toBe(flames.key);
    const own = [...d.powers[0]!.gains, ...d.powers[0]!.losses];
    expect(own.map((r) => r.key)).toEqual(expect.arrayContaining(['heal', 'recharge']));
    const recharge = own.find((r) => r.key === 'recharge')!;
    expect(recharge.lowerIsBetter).toBe(true);
    expect(d.powers[0]!.gains.includes(recharge)).toBe(recharge.after < recharge.before);
    // nothing changed: nothing listed
    expect(buildDiff(gd, rules, b)).toEqual({ gains: [], losses: [], powers: [] });
  });
});
