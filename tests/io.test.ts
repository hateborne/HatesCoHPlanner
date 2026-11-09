import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { newBuild, type Build } from '../src/engine/build.ts';
import { BuildRules } from '../src/engine/rules.ts';
import { computeTotals } from '../src/engine/totals.ts';
import { exportMbd, importMbd, importMidsText, buildToMxDz, type Mbd, type MidsMap } from '../src/io/mids.ts';
import { decodeShare, encodeShare } from '../src/io/share.ts';
import { loadData, pid, sid } from './helpers/data.ts';

const gd = loadData();
const map = JSON.parse(
  readFileSync(join(process.cwd(), 'public', 'data', gd.core.manifest.dataVersion, 'mids-map.json'), 'utf-8'),
) as MidsMap;

function sample(): Build {
  const b = newBuild({
    dataVersion: gd.core.manifest.dataVersion,
    name: 'Round Trip',
    at: gd.archetypeByName.get('class_blaster')!.id,
    origin: gd.core.origins.find((o) => o.n === 'Magic')!.id,
    alignment: 'Rogue',
    primary: sid(gd, 'Blaster_Ranged.Fire_Blast'),
    secondary: sid(gd, 'Blaster_Support.Fire_Manipulation'),
    pickCount: 24,
  });
  const lotg = pid(gd, 'Boosts.Crafted_Luck_of_the_Gambler_F.Crafted_Luck_of_the_Gambler_F');
  b.picks[0] = { power: pid(gd, 'Blaster_Ranged.Fire_Blast.Flares'), level: 0, slots: [{ level: 0, enh: { boost: pid(gd, 'Boosts.Crafted_Damage.Crafted_Damage'), ioLevel: 49, boosters: 5 } }, { level: 2 }] };
  b.picks[1] = { power: pid(gd, 'Blaster_Support.Fire_Manipulation.Ring_of_Fire'), level: 0, slots: [{ level: 0, enh: { boost: pid(gd, 'Boosts.Magic_Accuracy.Magic_Accuracy'), rel: 3 } }] };
  b.picks[3] = { power: pid(gd, 'Pool.Leaping.Combat_Jumping'), level: 3, on: false, slots: [{ level: 3, enh: { boost: lotg, ioLevel: 49 } }] };
  b.granted[pid(gd, 'Inherent.Fitness.Health')] = { slots: [{ level: 0, enh: { boost: pid(gd, 'Boosts.Generic_Heal.Generic_Heal') } }, { level: 2 }] };
  return b;
}

describe('share URL', () => {
  it('round-trips a build', async () => {
    const b = sample();
    const code = await encodeShare(b);
    expect(code.length).toBeLessThan(300);
    expect(await decodeShare(code, b.dataVersion)).toEqual(b);
  });
});

describe('Mids interop', () => {
  it('round-trips through .mbd', () => {
    const b = sample();
    const { mbd, warnings } = exportMbd(gd, map, b);
    expect(warnings).toEqual([]);
    expect(mbd.PowerSets.slice(0, 2)).toEqual(['Blaster_Ranged.Fire_Blast', 'Blaster_Support.Fire_Manipulation']);
    const back = importMbd(gd, map, JSON.parse(JSON.stringify(mbd)) as Mbd);
    expect(back.warnings).toEqual([]);
    expect(back.build.picks[0]?.slots[0]?.enh).toEqual(b.picks[0]?.slots[0]?.enh);
    expect(back.build.picks[1]?.slots[0]?.enh?.boost).toBe(b.picks[1]?.slots[0]?.enh?.boost);
    expect(back.build.picks[3]?.slots[0]?.enh?.boost).toBe(b.picks[3]?.slots[0]?.enh?.boost);
  });

  it('round-trips the legacy MxDz chunk', async () => {
    const b = sample();
    const { text, warnings } = await buildToMxDz(gd, map, b);
    expect(text.startsWith('|MxDz;')).toBe(true);
    expect(warnings).toEqual([]);
    const back = await importMidsText(gd, map, text);
    expect(back.build.picks[0]?.power).toBe(b.picks[0]?.power);
    expect(back.build.picks[3]?.slots[0]?.enh?.boost).toBe(b.picks[3]?.slots[0]?.enh?.boost);
  });

  const local = join(process.env.USERPROFILE ?? '', 'Documents', 'Hero & Villain Builds', 'Sample - Tanker (Fiery Aura - Fiery Melee).mbd');
  it.skipIf(!existsSync(local))('imports a real Mids build (local file)', () => {
    const mbd = JSON.parse(readFileSync(local, 'utf-8').replace(/^﻿/, '')) as Mbd;
    const { build, warnings } = importMbd(gd, map, mbd);
    const picked = build.picks.filter(Boolean).length;
    expect(picked).toBeGreaterThanOrEqual(22);
    expect(warnings.length).toBeLessThan(6);
    const t = computeTotals(gd, new BuildRules(gd, build), build);
    expect(t.lines.get('res.02')?.capped ?? 0).toBeGreaterThan(0.5); // Fiery Aura fire resistance
  });
});
