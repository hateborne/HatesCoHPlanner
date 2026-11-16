import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GameData } from '../../src/data/gamedata.ts';
import { DEFAULT_SERVER, serverById } from '../../src/data/servers.ts';
import type { BoostsFile, Core, Power, Powerset } from '../../src/data/types.ts';
import type { GameVersions } from '../../src/data/versions.ts';
import type { MidsMap } from '../../src/io/mids.ts';

const cached = new Map<string, GameData>();

/** @return A server's data folder on disk (public/data, or public/data/<server>/), as the site serves it. */
export function dataDir(server: string = DEFAULT_SERVER): string {
  const s = serverById(server);
  if (!s) throw new Error(`no server ${server}`);
  return join(process.cwd(), 'public', s.data);
}

/**
 * Load an exported data set (the same files the site serves).
 *
 * @param version Game version id (default: the server's default version, from its latest.json).
 * @param server Game server id (default: Homecoming).
 * @return That version's data (cached per server and version).
 */
export function loadData(version?: string, server: string = DEFAULT_SERVER): GameData {
  const root = dataDir(server);
  const id =
    version ??
    (JSON.parse(readFileSync(join(root, 'latest.json'), 'utf-8')) as {
      dataVersion: string;
    }).dataVersion;
  const key = `${server}/${id}`;
  const hit = cached.get(key);
  if (hit) return hit;
  const read = <T,>(f: string): T => JSON.parse(readFileSync(join(root, id, f), 'utf-8')) as T;
  const gd = new GameData(
    {
      core: read<Core>('core.json'),
      powersets: read<Powerset[]>('powersets.json'),
      powers: read<Power[]>('powers.json'),
      boosts: read<BoostsFile>('boosts.json'),
    },
    server,
  );
  cached.set(key, gd);
  return gd;
}

/** @return A server's versions.json as the site reads it (default: Homecoming's public/data/versions.json). */
export function loadVersionIndex(server: string = DEFAULT_SERVER): GameVersions {
  return JSON.parse(readFileSync(join(dataDir(server), 'versions.json'), 'utf-8')) as GameVersions;
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
