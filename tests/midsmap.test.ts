/**
 * Every power and enhancement a Homecoming player can pick goes to Mids and comes back as itself,
 * or is one Mids has no record of, listed here. A new patch or Mids database that opens a new gap
 * fails here, so the gap is seen (pipeline/report-mids-<version>.md says why) before players find it.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { GameData } from '../src/data/gamedata.ts';
import { newBuild, type Build } from '../src/engine/build.ts';
import { isLegacyDuplicate } from '../src/engine/enhance.ts';
import { startingSets } from '../src/engine/rules.ts';
import { exportMbd, importMbd, linkedBuild, MIDS_EPIC_POOLS, type Mbd, type MidsMap } from '../src/io/mids.ts';
import { encodeShare } from '../src/io/share.ts';
import { loadData, loadMidsMapFile } from './helpers/data.ts';

const SLOW = 120_000; // a few hundred exports per version

/** @return Every power set a player can pick a power from: each archetype's starting sets, pools and epics. */
function pickable(gd: GameData): Map<string, number[]> {
  const out = new Map<string, number[]>();
  for (const at of gd.core.archetypes) {
    const sets = [...startingSets(gd, at.cats.pri, at), ...startingSets(gd, at.cats.sec, at), ...gd.setsInCategory(at.cats.pool), ...gd.setsInCategory(at.cats.epic)];
    for (const s of sets) out.set(s.n, s.p);
  }
  return out;
}

/** @return The powers Mids has no record of, as their set's name and ".*" when it has none of a set. */
function midsLacks(gd: GameData, map: MidsMap): string[] {
  const has = new Set(map.powers.map(([, p]) => p));
  const out: string[] = [];
  for (const [set, powers] of pickable(gd)) {
    const gone = powers.filter((p) => !has.has(p));
    if (gone.length === powers.length) out.push(`${set}.*`);
    else out.push(...gone.map((p) => gd.power(p).n));
  }
  return out.sort();
}

/** @return An empty Blaster build of an origin, to export powers and pieces in. */
function blank(gd: GameData, origin = gd.core.origins[0]!.id): Build {
  const at = gd.archetypeByName.get('class_blaster')!;
  return newBuild({ dataVersion: gd.core.manifest.dataVersion, at: at.id, origin, alignment: 'Hero', primary: gd.setsInCategory(at.cats.pri)[0]!.id, secondary: gd.setsInCategory(at.cats.sec)[0]!.id, pickCount: gd.core.schedule.power.length });
}

/** @return The .mbd as a Mids user without the planner's link would have it: no comment, no planner app name. */
function asMids(m: Mbd): Mbd {
  const c = JSON.parse(JSON.stringify(m)) as Mbd;
  delete c.BuiltWith;
  delete c.Comment;
  return c;
}

/** @return `xs` in runs of `n`. */
const runs = <T,>(xs: T[], n: number): T[][] => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));

// what Mids (database 2025.12.1240) has no record of: powers in sets players pick, and enhancements
const KHELDIAN_FORMS = [
  'Peacebringer_Defensive.Luminous_Aura.Combat_Flight',
  'Peacebringer_Defensive.Luminous_Aura.Energy_Flight',
  'Peacebringer_Defensive.Luminous_Aura.Quantum_Boost',
  'Peacebringer_Defensive.Luminous_Aura.White_Dwarf_Antagonize',
  'Peacebringer_Defensive.Luminous_Aura.White_Dwarf_Flare',
  'Peacebringer_Defensive.Luminous_Aura.White_Dwarf_Smite',
  'Peacebringer_Defensive.Luminous_Aura.White_Dwarf_Step',
  'Peacebringer_Defensive.Luminous_Aura.White_Dwarf_Strike',
  'Peacebringer_Defensive.Luminous_Aura.White_Dwarf_Sublimation',
  'Peacebringer_Offensive.Luminous_Blast.Bright_Nova_Blast',
  'Peacebringer_Offensive.Luminous_Blast.Bright_Nova_Bolt',
  'Peacebringer_Offensive.Luminous_Blast.Bright_Nova_Detonation',
  'Peacebringer_Offensive.Luminous_Blast.Bright_Nova_Scatter',
  'Warshade_Defensive.Umbral_Aura.Black_Dwarf_Antagonize',
  'Warshade_Defensive.Umbral_Aura.Black_Dwarf_Drain',
  'Warshade_Defensive.Umbral_Aura.Black_Dwarf_Mire',
  'Warshade_Defensive.Umbral_Aura.Black_Dwarf_Smite',
  'Warshade_Defensive.Umbral_Aura.Black_Dwarf_Step',
  'Warshade_Defensive.Umbral_Aura.Black_Dwarf_Strike',
  'Warshade_Defensive.Umbral_Aura.Shadow_Recall',
  'Warshade_Defensive.Umbral_Aura.Shadow_Step',
  'Warshade_Offensive.Umbral_Blast.Dark_Nova_Blast',
  'Warshade_Offensive.Umbral_Blast.Dark_Nova_Bolt',
  'Warshade_Offensive.Umbral_Blast.Dark_Nova_Detonation',
  'Warshade_Offensive.Umbral_Blast.Dark_Nova_Emanation',
];
const BOTH = [
  ...KHELDIAN_FORMS,
  'Controller_Control.Pyrotechnic_Control.Glitz',
  'Dominator_Control.Pyrotechnic_Control.Glitz',
  'Pool.Fitness.*',
  'Pool.Flight.Fly_Boost',
  'Pool.Force_of_Will.Stomp',
  'Pool.Gadgetry.*',
  'Pool.Leaping.Double_Jump',
  'Pool.Sorcery.Arcane_Proc',
  'Pool.Speed.SpeedPhase',
  'Pool.Utility_Belt.*',
  'Widow_Training.Widow_Training.Confront',
];
const LACKS: Record<string, { powers: string[]; enh: string[] }> = {
  i28p3: {
    powers: [
      ...BOTH,
      ...['Brute', 'Scrapper', 'Sentinel', 'Stalker', 'Tanker'].map((a) => `${a}_Defense.Fiery_Aura.Phoenix_Rising`),
    ].sort(),
    enh: [],
  },
  i28p4: {
    powers: [
      ...BOTH,
      ...['Brute', 'Scrapper', 'Sentinel', 'Stalker', 'Tanker'].map((a) => `${a}_Defense.Sonic_Aura.*`),
      ...['Controller', 'Corruptor', 'Defender', 'Mastermind'].map((a) => `${a}_Buff.Light_Affinity.*`),
      ...['Brute', 'Scrapper', 'Stalker', 'Tanker'].map((a) => `${a}_Melee.Broad_Sword.Boomerang_Slice`),
      'Stalker_Defense.Ninjitsu.Smoke_Flash', // shown as Bo Ryaku
      'Stalker_Defense.Willpower.Resurgence', // shown as Up to the Challenge
    ].sort(),
    enh: [],
  },
};
const NO_MIDS_ENH = [
  'Boosts.Crafted_Decreased_Regeneration.Crafted_Decreased_Regeneration',
  'Boosts.Generic_Clockwork_Efficiency.Generic_Clockwork_Efficiency',
  'Boosts.Generic_Might_of_the_Empire.Generic_Might_of_the_Empire',
  'Boosts.Generic_Resistance_Tactics.Generic_Resistance_Tactics',
  'Boosts.Generic_Syndicate_Techniques.Generic_Syndicate_Techniques',
  'Boosts.Generic_Will_of_the_Seers.Generic_Will_of_the_Seers',
  'Boosts.Yins_Omni.Yins_Omni',
];
for (const v of Object.values(LACKS)) v.enh = NO_MIDS_ENH;

describe.each(Object.keys(LACKS))('Mids map %s', (version) => {
  const gd = loadData(version);
  const map = loadMidsMapFile(version);
  const has = new Set(map.powers.map(([, p]) => p));

  it('sends every power Mids has to its Mids name and back', { timeout: SLOW }, () => {
    const bySi = new Map(map.powers);
    const firstSi = new Map<number, number>();
    for (const [si, p] of map.powers) if (!firstSi.has(p)) firstSi.set(p, si);
    const powers = [...new Set([...pickable(gd).values()].flat())].filter((p) => has.has(p));
    const wrong: string[] = [];
    for (const p of powers) if (bySi.get(firstSi.get(p)!) !== p) wrong.push(`${gd.power(p).n}: its first Mids index is another power's`);
    const sched = gd.core.schedule.power;
    for (const run of runs(powers, sched.length)) {
      const b = blank(gd);
      run.forEach((p, i) => (b.picks[i] = { power: p, level: sched[i]!, slots: [{ level: sched[i]! }] }));
      const { mbd } = exportMbd(gd, map, b);
      const back = importMbd(gd, map, asMids(mbd)).build;
      run.forEach((p, i) => {
        const got = back.picks[i]?.power;
        if (got !== p) wrong.push(`${gd.power(p).n}: exported as ${mbd.PowerEntries[i]!.PowerName || '(no name)'}, read back as ${got === undefined ? 'nothing' : gd.power(got).n}`);
      });
    }
    expect(wrong).toEqual([]);
  });

  it('lists the powers Mids has no record of', () => {
    expect(midsLacks(gd, map)).toEqual(LACKS[version]!.powers);
  });

  it('sends every enhancement to Mids or a stand-in, and the planner reopens it exactly', { timeout: SLOW }, async () => {
    const none: string[] = [];
    const wrong: string[] = [];
    // each origin's pieces in a build of that origin (a Magic SO comes back as the build's origin's)
    const byOrigin = new Map<number, number[]>();
    for (const b of gd.boosts) {
      if (isLegacyDuplicate(gd, b)) continue;
      const o = gd.core.origins.find((x) => b.n.split('.')[1]!.startsWith(`${x.n}_`)) ?? gd.core.origins[0]!;
      byOrigin.set(o.id, [...(byOrigin.get(o.id) ?? []), b.id]);
    }
    const sched = gd.core.schedule.power;
    for (const [origin, boosts] of byOrigin) {
      for (const run of runs(boosts, sched.length * 6)) {
        const b = blank(gd, origin);
        const pri = gd.powerset(b.primary).p;
        runs(run, 6).forEach((pieces, i) => {
          b.picks[i] = {
            power: pri[i % pri.length]!,
            level: sched[i]!,
            slots: pieces.map((id) => {
              const bp = gd.power(id);
              return { level: sched[i]!, enh: { boost: id, ...(bp.bie && !bp.bup ? { ioLevel: 49 } : {}) } };
            }),
          };
        });
        const { mbd } = exportMbd(gd, map, b, `#b=${await encodeShare(b)}`);
        const back = importMbd(gd, map, mbd, { link: await linkedBuild(gd, mbd) }).build;
        runs(run, 6).forEach((pieces, i) =>
          pieces.forEach((id, k) => {
            if (!mbd.PowerEntries[i]!.SlotEntries[k]!.Enhancement) none.push(gd.power(id).n);
            const got = back.picks[i]?.slots[k]?.enh?.boost;
            if (got !== id) wrong.push(`${gd.power(id).n}: reopens as ${got === undefined ? 'nothing' : gd.power(got).n}`);
          }),
        );
      }
    }
    expect(wrong).toEqual([]);
    expect(none.sort()).toEqual(LACKS[version]!.enh);
  });
});

it("keeps the pipeline's epic pool table in step with the app's", () => {
  const py = readFileSync('pipeline/mids_map.py', 'utf8');
  const table = /MIDS_EPIC_POOLS = \(([\s\S]*?)\n\)/.exec(py)![1]!;
  const pairs = [...table.matchAll(/\("([^"]+)", "([^"]+)"\)/g)].map((m) => [m[1], m[2]]);
  expect(pairs).toEqual(MIDS_EPIC_POOLS.map(([a, b]) => [a, b]));
});
