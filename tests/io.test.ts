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

  it('keeps a relative level lower than -8 at -8 instead of wrapping it, and opens links made before as they were', async () => {
    const b = sample();
    b.picks[1]!.slots[0]!.enh!.rel = -10;
    expect((await decodeShare(await encodeShare(b))).picks[1]!.slots[0]!.enh!.rel).toBe(-8);
    // made by the encoder before this change: an SO at -3, -8 and -10 (the byte wrapped to +246)
    const old = await decodeShare('eJxjZGRm4pbk9c9JUQj2V_BJLUvNKWaQYLhpzcDAzLCAjYmVaQEbEwOI-MeAA7BmGlkUmDAAAM2BCk8');
    expect(old.name).toBe('Old SO Levels');
    expect(old.picks[1]!.slots.map((s) => s.enh?.rel)).toEqual([-3, -8, 246]);
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

  it('exports an outleveled SO at -3, the lowest Mids has, and says so', () => {
    const b = sample();
    b.picks[1]!.slots[0]!.enh!.rel = -8;
    const { mbd, warnings } = exportMbd(gd, map, b);
    const ring = mbd.PowerEntries.find((p) => p.PowerName.endsWith('Ring_of_Fire'));
    expect(ring?.SlotEntries[0]?.Enhancement?.RelativeLevel).toBe('MinusThree');
    expect(warnings).toEqual([expect.stringMatching(/outleveled.*below -3/)]);
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

  /** A legacy chunk of a Fire Blast / Fire Manipulation Blaster whose pick 0 has a Mids index the map lacks, and `head` above it. */
  async function unknownPickChunk(head: string) {
    const sets = ['Blaster_Ranged.Fire_Blast', 'Blaster_Support.Fire_Manipulation'];
    const w = new ByteWriter();
    w.bytes(new Uint8Array([77, 120, 68, 12]));
    w.f32(3.2);
    w.bool(false);
    w.bool(true);
    for (const s of ['Class_Blaster', 'Magic']) w.netString(s);
    w.i32(0);
    w.netString('Plan');
    w.i32(sets.length - 1);
    for (const s of sets) w.netString(s);
    w.i32(0);
    w.i32(23); // 24 power entries
    for (let i = 0; i < 24; i++) {
      w.i32(i === 0 ? 999_999 : -1);
      if (i === 0) {
        w.i8(0); // level 1
        w.bool(true);
        w.bool(false);
        w.i32(0);
        w.i32(0);
        w.i8(-1);
      }
      w.i8(-1); // no slots
    }
    const raw = w.done();
    const hex = Buffer.from(deflateSync(raw)).toString('hex').toUpperCase();
    return importMidsText(gd, map, `${head}|MxDz;${raw.length};${hex.length / 2};${hex.length};HEX;|\n${hex}\n|----|`);
  }

  it("names a power the chunk's index can't identify from the Hero Plan text above it", async () => {
    const plan = ["Hero Plan by Mids' Hero Designer 1.955", '', 'Hero Profile:', '', 'Level 1: Flares -- Acc-I:50(A)', '', 'Level 2: Ring of Fire -- Acc-I:50(A)', '', ''].join('\n');
    const named = await unknownPickChunk(plan);
    expect(named.warnings).toEqual([]);
    expect(named.build.picks[0]?.power).toBe(pid(gd, 'Blaster_Ranged.Fire_Blast.Flares'));
    // without the plan text the pick is lost and said so
    const bare = await unknownPickChunk('');
    expect(bare.warnings).toEqual(["A power couldn't be identified, so it was left out"]);
    expect(bare.build.picks[0]).toBeNull();
    // a name that matches nothing, a name at another level, or a power from a set the chunk lacks, leaves it lost
    // (two powers it could be, since both are plan lines at that level: left lost, not guessed)
    for (const head of ['Level 1: Nothing Like It -- x\n', 'Level 2: Flares -- x\n', 'Level 1: Ice Bolt -- x\n', 'Level 1: Flares -- x\nLevel 1: Ring of Fire -- x\n']) {
      expect((await unknownPickChunk(head)).warnings, head).toHaveLength(1);
    }
  });

  /**
   * A legacy |MxDz; code of one small build, as a Mids of one save version wrote it.
   *
   * Mids added fields to the format as it went (its MidsCharacterFileFormat: PriorVersion 3.10,
   * ThisVersion 3.20): a power's ProcInclude from 3.10, a power's InherentSlotsUsed and a slot's
   * IsInherent only from 3.20.
   *
   * @param version The save version the code says it is.
   * @param qualified Powers and enhancements by name instead of by Mids index.
   * @return The code as posted.
   */
  function legacyCode(version: number, qualified: boolean): string {
    const proc = version >= 3.1 - 1e-4;
    const inherent = version >= 3.2 - 1e-4;
    const siOf = (name: string) => map.powers.find(([, id]) => id === pid(gd, name))![0];
    const enhSi = (uid: string) => map.enh.find((e) => e.uid === uid)!.si;
    const sets = ['Blaster_Ranged.Fire_Blast', 'Blaster_Support.Fire_Manipulation'];
    // by pick: the power, its 0-based level, and each slot's enhancement with its two value bytes
    // (an IO: level, relative level; an SO: relative level, grade)
    const picks: Record<number, { power: string; level: number; enh: ([uid: string, a: number, b: number] | null)[] }> = {
      0: { power: 'Blaster_Ranged.Fire_Blast.Flares', level: 0, enh: [['Crafted_Damage', 49, 4], null] },
      1: { power: 'Blaster_Support.Fire_Manipulation.Ring_of_Fire', level: 0, enh: [['Magic_Accuracy', 4, 3]] },
      3: { power: 'Pool.Leaping.Combat_Jumping', level: 3, enh: [['Crafted_Luck_of_the_Gambler_F', 49, 4]] },
    };
    const w = new ByteWriter();
    w.bytes(new Uint8Array([77, 120, 68, 12]));
    w.f32(version);
    w.bool(qualified);
    w.bool(true); // sub-power fields
    for (const s of ['Class_Blaster', 'Magic']) w.netString(s);
    w.i32(0); // Hero
    w.netString('Legacy');
    w.i32(sets.length - 1);
    for (const s of sets) w.netString(s);
    w.i32(24); // last power
    w.i32(24 - 1); // power entries - 1
    for (let i = 0; i < 24; i++) {
      const p = picks[i];
      if (qualified) w.netString(p?.power ?? '');
      else w.i32(p ? siOf(p.power) : -1);
      if (p) {
        w.i8(p.level);
        w.bool(true); // StatInclude
        if (proc) w.bool(false); // ProcInclude
        w.i32(0); // VariableValue
        if (inherent) w.i32(0); // InherentSlotsUsed
        w.i8(-1); // no sub powers
      }
      const enh = p?.enh ?? [];
      w.i8(enh.length - 1);
      for (const e of enh) {
        w.i8(p!.level);
        if (inherent) w.bool(false); // IsInherent
        if (qualified) w.netString(e?.[0] ?? '');
        else w.i32(e ? enhSi(e[0]) : -1);
        if (e) {
          w.i8(e[1]);
          w.i8(e[2]);
        }
        w.bool(false); // no flipped enhancement
      }
    }
    const raw = w.done();
    const hex = Buffer.from(deflateSync(raw)).toString('hex').toUpperCase();
    return `|MxDz;${raw.length};${hex.length / 2};${hex.length};HEX;|\n${hex}\n|-------------------------------------------------------------------|`;
  }

  it('reads a legacy code of every save version: 3.10 has ProcInclude but not the inherent-slot fields of 3.20', async () => {
    const want = (await importMidsText(gd, map, legacyCode(3.2, /*qualified=*/ false))).build;
    expect(want.name).toBe('Legacy');
    expect(want.picks.filter(Boolean)).toHaveLength(3);
    expect(want.picks[0]?.power).toBe(pid(gd, 'Blaster_Ranged.Fire_Blast.Flares'));
    expect(want.picks[0]?.slots.map((s) => s.enh)).toEqual([{ boost: pid(gd, 'Boosts.Crafted_Damage.Crafted_Damage'), ioLevel: 49 }, undefined]);
    expect(want.picks[1]?.slots[0]?.enh?.boost).toBe(pid(gd, 'Boosts.Magic_Accuracy.Magic_Accuracy'));
    expect(want.picks[3]?.power).toBe(pid(gd, 'Pool.Leaping.Combat_Jumping'));
    expect(want.picks[3]?.slots[0]?.enh).toEqual({ boost: pid(gd, 'Boosts.Crafted_Luck_of_the_Gambler_F.Crafted_Luck_of_the_Gambler_F'), ioLevel: 49 });
    // every version, by index and by name, is the same build
    for (const version of [1.01, 3.1, 3.2]) {
      for (const qualified of [false, true]) {
        const res = await importMidsText(gd, map, legacyCode(version, qualified));
        expect(res.warnings, `version ${version}, qualified ${qualified}`).toEqual([]);
        expect(res.build, `version ${version}, qualified ${qualified}`).toEqual(want);
      }
    }
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
