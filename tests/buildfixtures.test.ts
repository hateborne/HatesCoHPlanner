import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { brotliDecompressSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { BuildRules } from '../src/engine/rules.ts';
import { importMbd, importMidsText, type Mbd, type MidsMap } from '../src/io/mids.ts';
import { loadData, pid } from './helpers/data.ts';

/**
 * The forum builds the browser recreation tests (e2e/) rebuild, all legal on the current patch: each
 * fixture imports here first, so a broken fixture or importer shows up in `npm test` and not only in
 * the browser run.
 */
const gd = loadData();
const map = JSON.parse(readFileSync(join(process.cwd(), 'public', 'data', gd.core.manifest.dataVersion, 'mids-map.json'), 'utf-8')) as MidsMap;
const fixture = (name: string) => readFileSync(join(process.cwd(), 'tests', 'fixtures', 'builds', name), 'utf-8');

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

describe('forum build fixtures import', () => {
  it('Symphony / Dark Dominator (legacy |MxDz; chunk)', async () => {
    const { build, warnings } = await importMidsText(gd, map, fixture('symphony-dark-dominator.txt'));
    expect(gd.archetype(build.at).n).toBe('Class_Dominator');
    expect(gd.powerset(build.primary).n).toBe('Dominator_Control.Symphony_Control');
    expect(gd.powerset(build.secondary).n).toBe('Dominator_Assault.Dark_Assault');
    expect(build.picks.filter(Boolean)).toHaveLength(24);
    expect(build.picks[22]?.power).toBe(pid(gd, 'Epic.Ice_Mastery_Dominator.Ice_Storm'));
    // the chunk is from an older Mids database: four of its power indexes (granted powers) are not
    // in the map the planner ships, and are reported rather than guessed
    expect(warnings.length).toBeLessThanOrEqual(4);
    expect(warnings.every((w) => w.startsWith("A power couldn't be identified"))).toBe(true);
    expect(new BuildRules(gd, build).issues()).toEqual([]);
  });

  it('Archery / Traps Corruptor (|MBD; chunk), including a set Mids names differently', () => {
    const { build, warnings } = importMbd(gd, map, mbdFromChunk(fixture('archery-traps-corruptor.txt')));
    expect(gd.archetype(build.at).n).toBe('Class_Corruptor');
    expect(gd.powerset(build.primary).n).toBe('Corruptor_Ranged.Archery');
    expect(gd.powerset(build.secondary).n).toBe('Corruptor_Buff.Traps');
    expect(build.picks.filter(Boolean)).toHaveLength(24);
    expect(warnings).toEqual([]);
    // Mids calls the Artillery set Crafted_Shrapnel: found by its full name instead
    const fistful = build.picks.find((p) => p?.power === pid(gd, 'Corruptor_Ranged.Archery.Fistful_of_Arrows'));
    expect(fistful?.slots.map((s) => (s.enh ? gd.power(s.enh.boost).n : null))).toEqual(
      ['A', 'C', 'E', 'F', 'D', 'B'].map((l) => `Boosts.Crafted_Artillery_${l}.Crafted_Artillery_${l}`),
    );
    expect(new BuildRules(gd, build).issues()).toEqual([]);
  });

  it('Electrical Melee / Sonic Aura Stalker (.mbd file), a leveling build that keeps its slot levels', () => {
    const { build, warnings } = importMbd(gd, map, JSON.parse(fixture('elec-sonic-stalker-leveling.mbd')) as Mbd);
    expect(gd.archetype(build.at).n).toBe('Class_Stalker');
    expect(gd.powerset(build.primary).n).toBe('Stalker_Melee.Electrical_Melee');
    expect(gd.powerset(build.secondary).n).toBe('Stalker_Defense.Sonic_Aura');
    expect(build.picks.filter(Boolean)).toHaveLength(24);
    expect(build.respecTo).toBeUndefined();
    expect(warnings).toEqual([]); // its three accolades are out of scope and left out without a warning
    // each slot at the level it was gained (1-based): Havoc Punch is slotted from level 1 to 7
    const havoc = build.picks.find((p) => p?.power === pid(gd, 'Stalker_Melee.Electrical_Melee.Havoc_Punch'));
    expect(havoc?.slots.map((s) => s.level + 1)).toEqual([1, 3, 3, 5, 5, 7]);
    expect(new BuildRules(gd, build).issues()).toEqual([]);
  });
});
