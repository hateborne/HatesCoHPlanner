import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GameData } from '../../src/data/gamedata.ts';
import type { BoostsFile, Core, Power, Powerset } from '../../src/data/types.ts';
import type { GameVersions } from '../../src/data/versions.ts';
import type { MidsMap } from '../../src/io/mids.ts';

const cached = new Map<string, GameData>();

/**
 * Load an exported data set from public/data (the same files the site serves).
 *
 * @param version Game version id (default: the default version, from latest.json).
 * @return That version's data (cached per version).
 */
export function loadData(version?: string): GameData {
  const root = join(process.cwd(), 'public', 'data');
  const id =
    version ??
    (JSON.parse(readFileSync(join(root, 'latest.json'), 'utf-8')) as {
      dataVersion: string;
    }).dataVersion;
  const hit = cached.get(id);
  if (hit) return hit;
  const read = <T,>(f: string): T => JSON.parse(readFileSync(join(root, id, f), 'utf-8')) as T;
  const gd = new GameData({
    core: read<Core>('core.json'),
    powersets: read<Powerset[]>('powersets.json'),
    powers: read<Power[]>('powers.json'),
    boosts: read<BoostsFile>('boosts.json'),
  });
  cached.set(id, gd);
  return gd;
}

/** @return public/data/versions.json as the site reads it. */
export function loadVersionIndex(): GameVersions {
  return JSON.parse(readFileSync(join(process.cwd(), 'public', 'data', 'versions.json'), 'utf-8')) as GameVersions;
}

/** @return A version's mids-map.json. */
export function loadMidsMapFile(version: string): MidsMap {
  return JSON.parse(readFileSync(join(process.cwd(), 'public', 'data', version, 'mids-map.json'), 'utf-8')) as MidsMap;
}

/** @return Power id by full name (throws when missing). */
export function pid(gd: GameData, name: string): number {
  const p = gd.powerByName.get(name.toLowerCase());
  if (!p) throw new Error(`no power ${name}`);
  return p.id;
}

/** @return Powerset id by full name (throws when missing). */
export function sid(gd: GameData, name: string): number {
  const s = gd.setByName.get(name.toLowerCase());
  if (!s) throw new Error(`no powerset ${name}`);
  return s.id;
}
