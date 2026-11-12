import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { ByteWriter } from '../src/io/binary.ts';
import { newBuild, toAlignment, type Build } from '../src/engine/build.ts';
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
    alignment: 'Villain',
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

describe('alignment', () => {
  it('folds the game and Mids alignments into Hero / Villain / Praetorian', () => {
    expect(['Hero', 'Vigilante', 'Villain', 'Rogue', 'Loyalist', 'Resistance', 'Praetorian', undefined, 'x'].map(toAlignment)).toEqual([
      'Hero', 'Hero', 'Villain', 'Villain', 'Praetorian', 'Praetorian', 'Praetorian', 'Hero', 'Hero',
    ]);
  });

  it('round-trips a Praetorian build through the share URL and exports it to Mids as Loyalist', async () => {
    const b = { ...sample(), alignment: 'Praetorian' as const };
    expect((await decodeShare(await encodeShare(b))).alignment).toBe('Praetorian');
    expect(exportMbd(gd, map, b).mbd.Alignment).toBe('Loyalist');
    expect(importMbd(gd, map, { ...exportMbd(gd, map, b).mbd, Alignment: 'Resistance' }).build.alignment).toBe('Praetorian');
  });
});

describe('share URL', () => {
  it('round-trips a build', async () => {
    const b = sample();
    const code = await encodeShare(b);
    expect(code.length).toBeLessThan(300);
    expect(await decodeShare(code)).toEqual(b);
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

  it('reports an unknown MxDz power only when the build loses something, as the .mbd import does', async () => {
    const UNKNOWN = 999_999; // a Mids power index the map doesn't have
    const lotg = map.enh.find((e) => e.uid === 'Crafted_Luck_of_the_Gambler_F')!;
    const sets = ['Blaster_Ranged.Fire_Blast', 'Blaster_Support.Fire_Manipulation'];
    // buildToMxDz's layout: version 3.2, power indexes (not names), old sub-power fields
    const w = new ByteWriter();
    w.bytes(new Uint8Array([77, 120, 68, 12]));
    w.f32(3.2);
    w.bool(false);
    w.bool(true);
    for (const s of ['Class_Blaster', 'Magic']) w.netString(s);
    w.i32(0);
    w.netString('Gaps');
    w.i32(sets.length - 1);
    for (const s of sets) w.netString(s);
    w.i32(24); // last power
    w.i32(26 - 1); // power entries - 1: 24 picks and 2 more
    /** One power entry: an index (-1 for an empty pick) and the enhancement indexes of its slots. */
    const entry = (si: number, enh: number[]) => {
      w.i32(si);
      if (si >= 0) {
        w.i8(0); // level 1
        w.bool(true);
        w.bool(false);
        w.i32(0);
        w.i32(0);
        w.i8(-1); // no sub powers
      }
      w.i8(enh.length - 1);
      for (const e of enh) {
        w.i8(0);
        w.bool(false);
        w.i32(e);
        w.i8(49); // IO level 50
        w.i8(4); // relative level Even
        w.bool(false); // no flipped enhancement
      }
    };
    entry(UNKNOWN, []); // a pick: always reported
    for (let i = 1; i < 24; i++) entry(-1, []);
    entry(UNKNOWN, []); // past the picks, no enhancements: granted or out of scope, left out quietly
    entry(UNKNOWN, [lotg.si]); // past the picks with an enhancement: reported
    const raw = w.done();
    const hex = Buffer.from(deflateSync(raw)).toString('hex').toUpperCase();
    const text = `|MxDz;${raw.length};${hex.length / 2};${hex.length};HEX;|\n${hex}\n|-------------------------------------------------------------------|`;
    const { warnings } = await importMidsText(gd, map, text);
    expect(warnings).toEqual(["A power couldn't be identified, so it was left out", "A power couldn't be identified, so it was left out"]);
  });

  // a real Mids .mbd of a Fiery Aura / Fiery Melee Tanker on this machine (set HCP_MIDS_SAMPLE to
  // its path); skipped when unset, so no personal file names live in the repository
  const local = process.env.HCP_MIDS_SAMPLE ?? '';
  it.skipIf(!local || !existsSync(local))('imports a real Mids build (HCP_MIDS_SAMPLE)', () => {
    const mbd = JSON.parse(readFileSync(local, 'utf-8').replace(/^\uFEFF/, '')) as Mbd;
    const { build, warnings } = importMbd(gd, map, mbd);
    const picked = build.picks.filter(Boolean).length;
    expect(picked).toBeGreaterThanOrEqual(22);
    expect(warnings.length).toBeLessThan(6);
    const t = computeTotals(gd, new BuildRules(gd, build), build);
    expect(t.lines.get('res.02')?.capped ?? 0).toBeGreaterThan(0.5); // Fiery Aura fire resistance
  });
});
