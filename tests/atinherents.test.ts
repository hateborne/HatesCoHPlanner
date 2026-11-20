/**
 * Each archetype's inherent (Defiance, Fury, Assassination, ...): listed once in the overview's
 * Inherent section, always counted in the totals, and never stored in a build or its link.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { GameData } from '../src/data/gamedata.ts';
import { newBuild, type Build } from '../src/engine/build.ts';
import { BuildRules, isArchetypeInherent, startingSets } from '../src/engine/rules.ts';
import { computeTotals } from '../src/engine/totals.ts';
import { checkBuild } from '../src/engine/validate.ts';
import { exportMbd, importMbd, type MidsMap } from '../src/io/mids.ts';
import { decodeShare, encodeShare } from '../src/io/share.ts';
import { loadData, pid } from './helpers/data.ts';

const gd = loadData();

/** A new build of an archetype with its first starting sets and their first level 1 powers. */
function build(data: GameData, atName: string): Build {
  const at = data.archetypeByName.get(atName.toLowerCase())!;
  const pri = startingSets(data, at.cats.pri, at)[0]!;
  const sec = startingSets(data, at.cats.sec, at)[0]!;
  const b = newBuild({
    dataVersion: data.core.manifest.dataVersion,
    at: at.id,
    origin: data.core.origins[0]!.id,
    alignment: 'Hero',
    primary: pri.id,
    secondary: sec.id,
    pickCount: data.core.schedule.power.length,
  });
  b.picks[0] = { power: pri.p[pri.av.indexOf(0)]!, level: 0, slots: [{ level: 0 }] };
  b.picks[1] = { power: sec.p[sec.av.indexOf(0)]!, level: 0, slots: [{ level: 0 }] };
  return b;
}

/** @return The names the Inherent section lists for the archetype's own inherent. */
const shown = (data: GameData, b: Build) => {
  const r = new BuildRules(data, b);
  const keys = r.inherentShown();
  return r.entries().filter((e) => keys.has(e.key)).map((e) => e.power.dn);
};

describe('archetype inherents', () => {
  it('lists one inherent per Homecoming archetype', () => {
    const want: Record<string, string> = {
      Class_Blaster: 'Defiance',
      Class_Brute: 'Fury',
      Class_Controller: 'Containment',
      Class_Corruptor: 'Scourge',
      Class_Defender: 'Vigilance',
      Class_Dominator: 'Domination',
      Class_Mastermind: 'Supremacy',
      Class_Scrapper: 'Critical Hit',
      Class_Sentinel: 'Opportunity',
      Class_Stalker: 'Assassination',
      Class_Tanker: 'Gauntlet',
      Class_Arachnos_Soldier: 'Conditioning',
      Class_Arachnos_Widow: 'Conditioning',
      Class_Peacebringer: 'Cosmic Balance',
      Class_Warshade: 'Dark Sustenance',
    };
    for (const at of gd.core.archetypes) expect([at.n, shown(gd, build(gd, at.n))]).toEqual([at.n, [want[at.n]]]);
  });

  it('lists one inherent per Thunderspy archetype', () => {
    const ts = loadData(undefined, 'thunderspy');
    for (const at of ts.core.archetypes) expect([at.n, shown(ts, build(ts, at.n)).length]).toEqual([at.n, 1]);
  });

  it('counts the inherent whatever switch an older link stores, and leaves the switch out of new links', async () => {
    const b = build(gd, 'Class_Brute');
    const fury = pid(gd, 'Inherent.Inherent.Rage');
    expect(isArchetypeInherent(gd, gd.archetype(b.at), gd.power(fury))).toBe(true);
    const plain = await encodeShare(b);
    // an older link may carry a switch for it (a Mids import's StatInclude)
    b.granted[fury] = { slots: [], on: false };
    const code = await encodeShare(b);
    expect(code).not.toBe(plain);
    // it still decodes as it did
    const raw = await decodeShare(code);
    expect(raw.granted[fury]?.on).toBe(false);
    // counted all the same: the same totals as with no switch stored
    const lines = (x: Build) => JSON.stringify([...computeTotals(gd, new BuildRules(gd, x), x).lines]);
    expect(new BuildRules(gd, raw).entries().find((x) => x.key === `grant:${fury}`)?.on).toBe(true);
    expect(lines(raw)).toBe(lines(build(gd, 'Class_Brute')));
    // opened, it is the same build less the switch, and shares as the plain code
    const opened = checkBuild(gd, raw).build!;
    const plainOpened = checkBuild(gd, await decodeShare(plain)).build!;
    expect(opened.granted[fury]?.on).toBeUndefined();
    expect(await encodeShare(opened)).toBe(await encodeShare(plainOpened));
    expect(lines(opened)).toBe(lines(plainOpened));
  });

  it('keeps the switch of a granted power that is not the inherent', async () => {
    const b = build(gd, 'Class_Brute');
    const sprint = pid(gd, 'Inherent.Inherent.Sprint');
    b.granted[sprint] = { slots: [], on: true };
    expect(checkBuild(gd, await decodeShare(await encodeShare(b))).build!.granted[sprint]?.on).toBe(true);
  });

  it('leaves a new build and its link as they were', async () => {
    const b = build(gd, 'Class_Stalker');
    const before = JSON.stringify(b);
    new BuildRules(gd, b).entries();
    expect(JSON.stringify(b)).toBe(before);
    expect(Object.keys(b.granted)).toEqual([]);
    expect(await encodeShare(await decodeShare(await encodeShare(b)))).toBe(await encodeShare(b));
  });

  it('stores no switch from a Mids import and exports the inherent as counted', () => {
    const map = JSON.parse(readFileSync(join(process.cwd(), 'public', 'data', gd.core.manifest.dataVersion, 'mids-map.json'), 'utf-8')) as MidsMap;
    const b = build(gd, 'Class_Blaster');
    const defiance = pid(gd, 'Inherent.Inherent.Defiance');
    const { mbd } = exportMbd(gd, map, b);
    const row = mbd.PowerEntries.find((p) => /\.Defiance$/i.test(p.PowerName));
    expect(row?.StatInclude).toBe(true);
    row!.StatInclude = false;
    const back = importMbd(gd, map, mbd);
    expect(back.build.granted[defiance]?.on).toBeUndefined();
  });
});
