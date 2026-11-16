import { readFileSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { groupBy, needsOf, pieceUsage, setUsage, spendShares, summarize } from '../research/aggregate.ts';
import { corpusPaths, htmlToText, shareCodes, tagsOf } from '../research/corpus.ts';
import { bonusContext, bonusSpend, family, measure, median, offerFor, setsFor, signature, type BuildFacts, type Offer } from '../research/measure.ts';
import { statLabel, warningKind } from '../research/report.ts';
import { BuildRules } from '../src/engine/rules.ts';
import { bonusLines, computeTotals } from '../src/engine/totals.ts';
import { importMidsText } from '../src/io/mids.ts';
import { loadData, loadMidsMapFile } from './helpers/data.ts';

const gd = loadData();
const map = loadMidsMapFile(gd.core.manifest.dataVersion);
const fixture = (name: string) => readFileSync(join(process.cwd(), 'tests', 'fixtures', 'builds', name), 'utf-8');

/** A build's facts with everything empty but what a test sets. */
function facts(over: Partial<BuildFacts>): BuildFacts {
  return {
    at: 1,
    primary: 1,
    secondary: 2,
    picks: 24,
    slots: 90,
    filled: 90,
    totals: {},
    fromBonus: {},
    spend: {},
    fromGlobal: {},
    fromIo: {},
    sets: [],
    globals: [],
    procs: [],
    over5: 0,
    kinds: {},
    attuned: 0,
    crafted: 0,
    boosted: 0,
    ioLevels: {},
    issues: [],
    signature: '',
    ...over,
  };
}

describe('reading the build folder', () => {
  it('splits the setting like PATH and drops empty entries', () => {
    expect(corpusPaths(undefined)).toEqual([]);
    expect(corpusPaths(` one ${delimiter}${delimiter} two`)).toEqual(['one', 'two']);
  });

  it('tags specialised builds by file name', () => {
    expect(tagsOf('Brute (Radiation Melee - Fiery Aura) Fire Farm.mbd')).toEqual(['farm']);
    expect(tagsOf('4-star_RadBioFire_Tanker.mbd')).toEqual(['hard mode']);
    expect(tagsOf('Tanker (Shield - Mace) HM Cheap.mbd')).toEqual(['hard mode', 'cheap']);
    expect(tagsOf('Blaster (Archery - Devices).mbd')).toEqual([]);
    // 'hm' inside a word is not the hard mode tag
    expect(tagsOf('Ohm Resistor.mbd')).toEqual([]);
  });

  it('finds every share code in a saved forum page', () => {
    const page = '<p>| Copy &amp; Paste |<br>\n|MxDz;10;8;16;HEX;|<br>\n|78DA0102|<br>\n|-----|<br></p><p>second<br>|MBD;5;4;8;BASE64;|<br>|QUJD|</p>';
    const codes = shareCodes(htmlToText(page));
    expect(codes).toHaveLength(2);
    expect(codes[0]!.startsWith('|MxDz;10;8;16;HEX;|')).toBe(true);
    expect(codes[0]).toContain('|78DA0102|');
    expect(codes[0]).not.toContain('MBD;');
    expect(codes[1]!.startsWith('|MBD;5;4;8;BASE64;|')).toBe(true);
    expect(shareCodes('no codes here')).toEqual([]);
  });
});

describe('what set bonuses add', () => {
  it('a bonus adds what computeTotals files under its set, line by line', async () => {
    const { build } = await importMidsText(gd, map, fixture('symphony-dark-dominator.txt'));
    const rules = new BuildRules(gd, build);
    const t = computeTotals(gd, rules, build);
    const ctx = bonusContext(rules, t.level);
    const want = new Map<string, number>();
    const labels = new Set<string>();
    for (const bn of t.bonuses) {
      if (bn.suppressed || bn.global) continue;
      labels.add(`${bn.set.dn} (${bn.slotted})`);
      for (const l of bonusLines(gd, rules.at, bn, t.level, ctx)) want.set(l.key, (want.get(l.key) ?? 0) + l.value);
    }
    expect(labels.size).toBeGreaterThan(5);
    const got = new Map<string, number>();
    for (const l of t.lines.values()) {
      if (l.key === 'def.base') continue;
      const v = l.sources.filter((s) => labels.has(s.name)).reduce((a, s) => a + s.value, 0);
      if (v) got.set(l.key, v);
    }
    expect([...want.keys()].sort()).toEqual([...got.keys()].sort());
    for (const [key, v] of want) expect(got.get(key)).toBeCloseTo(v, 9);
  });

  it('measures a build: bonuses are part of what its enhancements add, and the same build signs the same', async () => {
    const { build } = await importMidsText(gd, map, fixture('symphony-dark-dominator.txt'));
    const f = measure(gd, build, offerFor(gd, gd.archetype(build.at)));
    expect(f.picks).toBe(24);
    expect(f.filled).toBeGreaterThan(60);
    expect(Object.keys(f.fromBonus).length).toBeGreaterThan(3);
    for (const [key, v] of Object.entries(f.fromBonus)) expect(f.fromIo[key] ?? 0).toBeGreaterThanOrEqual(v + (f.fromGlobal[key] ?? 0) - 1e-9);
    expect(f.sets.some((s) => s.pieces >= 2)).toBe(true);
    expect(f.signature).toBe(signature({ ...build, name: 'another name' }));
    expect(signature({ ...build, picks: [...build.picks.slice(0, 5), null, ...build.picks.slice(6)] })).not.toBe(f.signature);
  });
});

describe('the game\'s offer', () => {
  const at = gd.archetypeByName.get('class_blaster')!;
  const offer = offerFor(gd, at);

  it('has a typical bonus size for the common stats and shares that sum to 1', () => {
    expect(offer.unit.rech).toBeGreaterThan(0.02);
    expect(offer.unit.rech).toBeLessThan(0.11);
    expect(offer.unit.acc).toBeGreaterThan(0);
    expect(offer.unit['mezprot.Knock']).toBeGreaterThan(0);
    expect(Object.values(offer.share).reduce((a, v) => a + v, 0)).toBeCloseTo(1, 9);
  });

  it("offers an archetype every open set and its own archetype sets, not another archetype's", () => {
    const names = (n: string) => setsFor(gd, gd.archetypeByName.get(n)!).map((s) => s.n);
    const blaster = names('class_blaster');
    expect(blaster).toEqual(expect.arrayContaining(['Luck_of_the_Gambler', 'Hecatomb', 'Blasters_Wrath', 'Superior_Blasters_Wrath', 'Shield_Wall']));
    expect(blaster).not.toContain('Brutes_Fury');
    expect(blaster).not.toContain('Superior_Kheldians_Grace');
    // a set shared by two archetypes is open to both
    expect(names('class_peacebringer')).toContain('Kheldians_Grace');
    expect(names('class_warshade')).toContain('Kheldians_Grace');
    // every archetype has 4 sets of its own (2, and their Superior versions) out of 52
    expect(blaster).toHaveLength(gd.boostSets.length - 48);
  });

  it('counts a typical bonus as 1, shared between its families and then the types it covers', () => {
    const unit = { 'dmg.00': 0.02, 'dmg.01': 0.02, rech: 0.05, 'res.00': 0.03 };
    // one family: a damage bonus of typical size over two types is 1 in all
    expect(
      bonusSpend(
        [
          { key: 'dmg.00', value: 0.02 },
          { key: 'dmg.01', value: 0.02 },
        ],
        unit,
      ),
    ).toEqual({ 'dmg.00': 0.5, 'dmg.01': 0.5 });
    // two families: half each; the damage half is twice the typical size, and a stat with no
    // typical size is neither counted nor a family
    expect(
      bonusSpend(
        [
          { key: 'dmg.00', value: 0.04 },
          { key: 'dmg.01', value: 0.04 },
          { key: 'rech', value: 0.05 },
          { key: 'nounit', value: 1 },
        ],
        unit,
      ),
    ).toEqual({ 'dmg.00': 0.5, 'dmg.01': 0.5, rech: 0.5 });
    expect(family('def.03')).toBe('def');
    expect(family('rech')).toBe('rech');
    expect(['run', 'fly', 'jumpspd', 'jumph'].map(family)).toEqual(['move', 'move', 'move', 'move']);
  });

  it('takes the middle value', () => {
    expect(median([])).toBe(0);
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
  });
});

describe('aggregating builds', () => {
  const offer: Offer = { unit: { rech: 0.05, acc: 0.09 }, share: { rech: 0.25, acc: 0.75 } };
  const offerOf = () => offer;

  it('turns spend into shares and lift', () => {
    expect(spendShares({})).toBeNull();
    expect(spendShares({ rech: 3, acc: 1 })).toEqual({ rech: 0.75, acc: 0.25 });
    const g = summarize(
      [
        facts({ spend: { rech: 3, acc: 1 }, totals: { rech: 0.7 }, fromBonus: { rech: 0.15, acc: 0.09 } }),
        facts({ spend: { rech: 1, acc: 3 }, totals: { rech: 0.5 }, fromBonus: { rech: 0.05, acc: 0.27 } }),
        facts({}), // no set bonuses: counts for the medians, not for the shares
      ],
      offerOf,
    );
    expect(g.n).toBe(3);
    expect(g.stats.rech).toEqual({ share: 0.5, lift: 2, unit: 0.05, total: 0.5, bonus: 0.05 });
    expect(g.stats.acc!.lift).toBeCloseTo(0.6667, 4);
  });

  it('lists what a group raises with enhancements, at a quarter of its builds and up', () => {
    const list = [facts({ fromIo: { 'mezprot.Knock': 4, rech: 0.1 } }), facts({ fromIo: { 'mezprot.Knock': 8 } }), facts({}), facts({ fromIo: { 'mezprot.Held': 1 } }), facts({})];
    expect(needsOf(list, (k) => k.startsWith('mezprot.'))).toEqual({ 'mezprot.Knock': { share: 0.4, typical: 6 } });
  });

  it('counts sets slotted for a bonus and unique pieces, as shares of builds', () => {
    const list = [
      facts({ at: 1, sets: [{ set: 7, pieces: 6 }, { set: 7, pieces: 2 }, { set: 9, pieces: 1 }], globals: [100] }),
      facts({ at: 2, sets: [{ set: 7, pieces: 2 }], globals: [100, 200] }),
      facts({ at: 2 }),
      facts({ at: 2 }),
    ];
    const sets = setUsage(list, (id) => `Set_${id}`, (id) => `Class_${id}`);
    expect(sets).toEqual({ Set_7: { builds: 0.5, pieces: [2, 0, 0, 0, 1], at: { Class_1: 1, Class_2: 0.3333 } } });
    expect(pieceUsage(list, (id) => `Boost_${id}`)).toEqual({ Boost_100: 0.5, Boost_200: 0.25 });
    expect([...groupBy(list, (f) => [`at${f.at}`])].map(([k, v]) => [k, v.length])).toEqual([
      ['at1', 1],
      ['at2', 3],
    ]);
  });
});

describe('the report', () => {
  it('sorts import warnings by what they are about', () => {
    expect(warningKind("Hasten: an enhancement (Crafted_Foo_A) isn't in the planner's game data, so its slot is empty")).toEqual({
      category: 'an enhancement is not in the game data',
      item: 'Crafted_Foo_A',
    });
    expect(warningKind("Pool.Flight.Afterburner isn't in the planner's game data, so it was left out").item).toBe('Pool.Flight.Afterburner');
    expect(warningKind('Hasten was taken at level 51, which has no free power pick, so it was left out').item).toBe('Hasten');
    expect(warningKind("A power couldn't be identified (Fast Snipe), so it was left out").item).toBe('Fast Snipe');
    expect(warningKind('something 12 new')).toEqual({ category: 'other', item: 'something N new' });
  });

  it('names stats the way the totals do', () => {
    expect(statLabel(gd, 'res.00')).toBe('Smashing (Res)');
    expect(statLabel(gd, 'mezprot.Knock')).toBe('Knockback (Prot)');
    expect(statLabel(gd, 'rech')).toBe('Recharge');
  });
});
