import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { brotliDecompressSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { importTarget, madeOnLabel, patchLabel, patchOrder, type GameVersions } from '../src/data/versions.ts';
import { fitToPatch } from '../src/engine/migrate.ts';
import { BuildRules } from '../src/engine/rules.ts';
import { exportMbd, importMbd, type Mbd } from '../src/io/mids.ts';
import { midsDbPatch, midsMadeOn, PLANNER_APP } from '../src/io/midsPatches.ts';
import { loadData, loadMidsMapFile, loadVersionIndex, pid } from './helpers/data.ts';

/** @return The .mbd JSON inside a |MBD; chunk (Brotli + Base64), decoded with Node's own Brotli. */
function mbdFromChunk(text: string): Mbd {
  const lines = text.split('\n').map((l) => l.trim());
  const head = lines.findIndex((l) => l.startsWith('|MBD;'));
  const b64 = lines
    .slice(head + 1)
    .filter((l) => /^\|[A-Za-z0-9+/=]+\|$/.test(l))
    .map((l) => l.slice(1, -1))
    .join('');
  return JSON.parse(brotliDecompressSync(Buffer.from(b64, 'base64')).toString('utf-8')) as Mbd;
}

// Infinitum (Invulnerability / Super Strength Tanker), made in Mids on Issue 28, Page 3 data
const infinitum = mbdFromChunk(readFileSync(join(process.cwd(), 'tests', 'fixtures', 'builds', 'infinitum-tanker-inv-ss.txt'), 'utf-8'));

const VS: GameVersions = {
  default: 'i28p4',
  versions: [
    { id: 'i28p4', label: 'Issue 28, Page 4', hash: '' },
    { id: 'i28p3', label: 'Issue 28, Page 3 (Dec 16 update)', hash: '' },
  ],
};

describe('game patches', () => {
  it('orders and names patch ids', () => {
    expect(patchOrder('i28p4')).toEqual([28, 4]);
    expect(patchOrder('i28p3m')).toEqual([28, 3]);
    expect(patchOrder('20261017-f94d0e09')).toBeUndefined();
    expect(patchLabel('i28p3')).toBe('Issue 28, Page 3');
    expect(madeOnLabel({ patch: 'i28p3', before: true })).toBe('a patch before Issue 28, Page 3');
  });

  it('opens a build on its own patch, else offers the nearest newer one, else the newest', () => {
    const t = (m: Parameters<typeof importTarget>[1]) => {
      const r = importTarget(VS, m);
      return [r.version.id, r.move];
    };
    expect(t(undefined)).toEqual(['i28p4', false]); // patch unknown: the default, as before
    expect(t({ patch: 'i28p4' })).toEqual(['i28p4', false]);
    expect(t({ patch: 'i28p3' })).toEqual(['i28p3', false]); // carried
    expect(t({ patch: 'i28p2' })).toEqual(['i28p3', true]); // next newer
    expect(t({ patch: 'i28p3', before: true })).toEqual(['i28p3', true]); // first carried at or after
    expect(t({ patch: 'i28p5' })).toEqual(['i28p4', true]); // nothing newer: the newest
    expect(t({ patch: 'i28p4', version: 'i28p3' })).toEqual(['i28p3', false]); // the planner's own export
    // exact data for a patch wins over approximate data for it, in either order
    const approx = { id: 'i28p3m', label: 'Issue 28, Page 3 (approximate)', hash: '', patch: 'i28p3', approx: true };
    for (const versions of [[approx, ...VS.versions], [...VS.versions, approx]]) {
      expect(importTarget({ ...VS, versions }, { patch: 'i28p3' }).version.id).toBe('i28p3');
      expect(importTarget({ ...VS, versions }, { patch: 'i28p2' }).version.id).toBe('i28p3');
    }
    // approximate data still serves a patch with no exact data
    const onlyApprox: GameVersions = { ...VS, versions: [VS.versions[0]!, approx] };
    expect(importTarget(onlyApprox, { patch: 'i28p3' }).version.id).toBe('i28p3m');
  });

  it('places Mids database versions by number', () => {
    expect(midsDbPatch('2026.1.1242')).toEqual({ patch: 'i28p3' });
    expect(midsDbPatch('2024.5.759')).toEqual({ patch: 'i28p3', before: true }); // older than every listed version
    // newer than every listed version: unknown, so it opens on the default version
    expect(midsDbPatch('2026.2.1300')).toBeUndefined();
    expect(midsDbPatch(undefined)).toBeUndefined();
    expect(midsDbPatch('not a version')).toBeUndefined();
    const table = [
      { db: '2025.6.1000', patch: 'i28p1' },
      { db: '2026.1.1242', patch: 'i28p3' },
    ];
    expect(midsDbPatch('2025.10.1100', table)).toEqual({ patch: 'i28p1' });
    expect(midsDbPatch('2025.6.1000', table)).toEqual({ patch: 'i28p1' });
    expect(midsDbPatch('2026.1.1243', table)).toBeUndefined();
  });

  it('opens a current Page 4 Mids build on the default version, not on older data', () => {
    const stalker = JSON.parse(readFileSync(join(process.cwd(), 'tests', 'fixtures', 'builds', 'elec-sonic-stalker-leveling.mbd'), 'utf-8')) as Mbd;
    expect(stalker.BuiltWith?.DatabaseVersion).toBe('2026.10.8.3');
    expect(importTarget(loadVersionIndex(), midsMadeOn(stalker))).toMatchObject({ version: { id: 'i28p4' }, move: false });
  });

  it('reads the game version from the planner\'s own Mids exports', () => {
    expect(midsMadeOn({ ...infinitum, BuiltWith: { App: PLANNER_APP, DatabaseVersion: '2025.12.1240', GameVersion: 'i28p3' } })).toEqual({ patch: 'i28p3', version: 'i28p3' });
    // exports from before versions were recorded were all made on Issue 28, Page 4
    expect(midsMadeOn({ ...infinitum, BuiltWith: { App: PLANNER_APP, DatabaseVersion: '2025.12.1240' } })).toEqual({ patch: 'i28p4', version: 'i28p4' });
    expect(midsMadeOn(infinitum)).toEqual({ patch: 'i28p3' });
    expect(midsMadeOn(undefined)).toBeUndefined();
  });
});

describe('Issue 28, Page 3 data (the December 16, 2025 client)', () => {
  const p4 = loadData('i28p4');
  const p3 = loadData('i28p3');

  it('is listed with its update, exact (not approximate), and never the default', () => {
    const vs = loadVersionIndex();
    expect(vs.default).toBe('i28p4');
    const v = vs.versions.find((x) => x.id === 'i28p3')!;
    expect(v.label).toBe('Issue 28, Page 3 (Dec 16 update)');
    expect(v.approx).toBeUndefined();
    expect(p3.core.manifest.dataVersion).toBe('i28p3');
  });

  it('has no Page 4 sets, and Tanker Super Strength in its Page 3 order', () => {
    expect(p3.setByName.has('stalker_defense.sonic_aura')).toBe(false);
    expect(p4.setByName.has('stalker_defense.sonic_aura')).toBe(true);
    const s = p3.setByName.get('tanker_melee.super_strength')!;
    const at = (n: string) => s.av[s.p.indexOf(pid(p3, `Tanker_Melee.Super_Strength.${n}`))]! + 1;
    expect([at('Hand_Clap'), at('Knockout_Blow'), at('Rage')]).toEqual([16, 20, 24]);
  });

  it("shows Page 4's enhancement frames (the December client has none)", () => {
    expect(p3.core.manifest.framesFrom).toBe('i28p4');
    for (const b of p3.boosts) expect(b.bf).toEqual(p4.power(b.id).bf);
  });
});

describe('Infinitum, a Page 3 build', () => {
  it('opens on its own patch with nothing flagged', () => {
    const made = midsMadeOn(infinitum);
    const { version, move } = importTarget(loadVersionIndex(), made);
    expect([version.id, move]).toEqual(['i28p3', false]);
    const gd = loadData('i28p3');
    const { build, warnings } = importMbd(gd, loadMidsMapFile('i28p3'), infinitum);
    expect(warnings).toEqual([]);
    expect(build.dataVersion).toBe('i28p3');
    expect(new BuildRules(gd, build).issues()).toEqual([]);
    // the planner's own export names the version, so it reopens there
    const { mbd } = exportMbd(gd, loadMidsMapFile('i28p3'), build);
    expect(importTarget(loadVersionIndex(), midsMadeOn(mbd)).version.id).toBe('i28p3');
  });

  it('moves to Page 4 by trading Knockout Blow and Rage, slots and enhancements going along', () => {
    const gd = loadData('i28p4');
    const { build } = importMbd(gd, loadMidsMapFile('i28p4'), infinitum);
    expect(new BuildRules(gd, build).issues().map((i) => i.key)).toEqual(['pick:11']);
    const fit = fitToPatch(gd, build);
    expect(fit.remaining).toEqual([]);
    expect(fit.changes.slice(0, 2)).toEqual(['Rage: level 24 -> 20', 'Knockout Blow: level 20 -> 24']);
    const ko = pid(gd, 'Tanker_Melee.Super_Strength.Knockout_Blow');
    const before = build.picks.find((p) => p?.power === ko)!;
    const after = fit.build.picks.find((p) => p?.power === ko)!;
    expect(after.level).toBe(23);
    expect(after.slots.map((s) => s.enh)).toEqual(before.slots.map((s) => s.enh));
    // every slot level still grants exactly what it did
    const count = (b: typeof build) => new BuildRules(gd, b).entries().flatMap((e) => e.slots.slice(1).map((s) => s.level)).sort((a, b) => a - b);
    expect(count(fit.build)).toEqual(count(build));
    // the input is left as it was
    expect(build.picks[11]?.power).toBe(ko);
  });
});
