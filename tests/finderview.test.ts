import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { FinderStats } from '../src/data/finderStats.ts';
import { statAmount, statLabel, warningText } from '../src/engine/finder/labels.ts';
import type { RankedSwap } from '../src/engine/finder/search.ts';
import type { FinderQuery } from '../src/engine/finder/query.ts';
import { bonusChoices, bySet, fitQuery, setGroupsOf } from '../src/engine/finder/view.ts';
import { BuildRules } from '../src/engine/rules.ts';
import { importMidsText } from '../src/io/mids.ts';
import { loadData, loadMidsMapFile, pid } from './helpers/data.ts';

const gd = loadData();
const stats = JSON.parse(readFileSync(join(process.cwd(), 'public', 'data', 'finder', 'stats.json'), 'utf-8')) as FinderStats;

describe('finder: words', () => {
  it('names stats and writes amounts in the unit the totals use', () => {
    expect(statLabel(gd, 'def.00')).toBe('Ranged (Def)');
    expect(statLabel(gd, 'rech')).toBe('Recharge');
    expect(statAmount('rech', 0.075)).toBe('7.50%');
    expect(statAmount('rech', 0.075, /*signed=*/ true)).toBe('+7.50%');
    expect(statAmount('res.00', -0.125, /*signed=*/ true)).toBe('-12.5%');
    expect(statAmount('hp', 30.119, /*signed=*/ true)).toBe('+30.1');
    expect(statAmount('mezprot.Knock', 4)).toBe('4.00');
  });

  it('writes each warning as a plain sentence', () => {
    const gambler = pid(gd, 'Boosts.Crafted_Luck_of_the_Gambler_F.Crafted_Luck_of_the_Gambler_F');
    expect(warningText(gd, { kind: 'crippled', role: 'heal', aspect: 'out', lost: 0.4, only: true })).toBe("This power loses 40% of its healing. It is the build's only self heal.");
    expect(warningText(gd, { kind: 'crippled', role: 'st', aspect: 'acc', lost: 0.251, only: false })).toBe('This power loses 25% of its accuracy.');
    expect(warningText(gd, { kind: 'needDropped', stat: 'mezprot.Knock', before: 8, after: 4, typical: 7 })).toBe(
      'Knockback (Prot) falls from 8.00 to 4.00; builds like this one usually hold 7.00.',
    );
    expect(warningText(gd, { kind: 'globalLost', boost: gambler })).toContain(gd.power(gambler).dn);
    expect(warningText(gd, { kind: 'procLost', boost: gambler })).toMatch(/no numbers for procs/);
    expect(warningText(gd, { kind: 'overCap', stat: 'res.02' })).toBe('Fire (Res) is at its cap: part of this gain is lost.');
    expect(warningText(gd, { kind: 'overFive', bonus: -1 })).toMatch(/five times/);
  });
});

describe('finder: lists for the screens', () => {
  it('lists the bonuses a search can ask for, each kind once', () => {
    const sections = bonusChoices(gd, stats, 'Class_Blaster');
    expect(sections.map((s) => s.title)).toEqual(['Offense', 'Defense', 'Resistance', 'Health and endurance', 'Status', 'Movement']);
    const all = sections.flatMap((s) => s.stats);
    expect(new Set(all.map((c) => c.key)).size).toBe(all.length);
    const offense = sections[0]!.stats.map((c) => c.label);
    expect(offense).toEqual(expect.arrayContaining(['Recharge', 'Accuracy', 'Damage']));
    expect(offense.filter((l) => l === 'Damage')).toHaveLength(1);
    expect(all.find((c) => c.label === 'Healing')?.key).toBe('dmg.07');
    expect(all.find((c) => c.label === 'Knockback protection')?.key).toBe('mezprot.Knock');
    expect(all.filter((c) => c.key.startsWith('mezres.'))).toHaveLength(1);
    // every choice is a stat the statistics have a typical bonus size for
    for (const c of all) expect((stats.groups['Class_Blaster']!.stats[c.key]?.unit || stats.groups['all']!.stats[c.key]?.unit || 0) > 0, c.key).toBe(true);
    // an archetype with too few builds gets every build's list
    expect(bonusChoices(gd, stats, 'Class_Warshade').length).toBeGreaterThan(3);
  });

  it("lists the set categories a build's powers take", async () => {
    const text = readFileSync(join(process.cwd(), 'tests', 'fixtures', 'builds', 'symphony-dark-dominator.txt'), 'utf-8');
    const { build } = await importMidsText(gd, loadMidsMapFile(gd.core.manifest.dataVersion), text);
    const groups = setGroupsOf(gd, new BuildRules(gd, build).entries());
    expect(groups).toEqual(expect.arrayContaining(['Holds', 'Ranged Damage', 'Defense Sets', 'Dominator Archetype Sets']));
    expect(groups).not.toContain('Tanker Archetype Sets');
    expect(new Set(groups).size).toBe(groups.length);
  });

  it("cuts a search down to what another build's form can show", () => {
    const sections = bonusChoices(gd, stats, 'Class_Blaster');
    const q: FinderQuery = { goals: [{ goal: 'recharge', importance: 'high' }], tags: ['pvp'], extra: ['recov', 'no.such'], main: { stat: 'rech', depth: '4-6' }, groups: ['Holds', 'Ranged Damage'] };
    // everything the lists hold stays, and the search is the same object
    expect(fitQuery(q, sections, ['Holds', 'Ranged Damage'])).not.toBe(q);
    const whole: FinderQuery = { ...q, extra: ['recov'] };
    expect(fitQuery(whole, sections, ['Holds', 'Ranged Damage'])).toBe(whole);
    // a set type, a wanted bonus and an additional bonus the lists lack go; the goals and tags stay
    expect(fitQuery(q, sections, ['Ranged Damage'])).toEqual({ ...q, extra: ['recov'], groups: ['Ranged Damage'] });
    expect(fitQuery({ ...q, main: { stat: 'gone', depth: 'any' } }, sections, []).main).toBeUndefined();
    expect(fitQuery(q, sections, []).groups).toBeUndefined();
    expect(fitQuery(q, sections, []).goals).toBe(q.goals);
  });

  it('groups ranked swaps by set, best placement first', () => {
    const swap = (set: number, key: string, score: number) => ({ set, key, score }) as RankedSwap;
    const grouped = bySet([swap(7, 'pick:1', 9), swap(3, 'pick:2', 8), swap(7, 'pick:4', 5), swap(7, 'pick:5', 2)]);
    expect(grouped.map((g) => [g.set, g.best.key, g.others.map((o) => o.key)])).toEqual([
      [7, 'pick:1', ['pick:4', 'pick:5']],
      [3, 'pick:2', []],
    ]);
  });
});
