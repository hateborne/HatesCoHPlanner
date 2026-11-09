import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GameData } from '../../src/data/gamedata.ts';
import type { BoostsFile, Core, Power, Powerset } from '../../src/data/types.ts';

let cached: GameData | null = null;

/** Load the exported data set from public/data (same files the site serves). */
export function loadData(): GameData {
  if (cached) return cached;
  const root = join(process.cwd(), 'public', 'data');
  const { dataVersion } = JSON.parse(readFileSync(join(root, 'latest.json'), 'utf-8')) as {
    dataVersion: string;
  };
  const read = <T,>(f: string): T => JSON.parse(readFileSync(join(root, dataVersion, f), 'utf-8')) as T;
  cached = new GameData({
    core: read<Core>('core.json'),
    powersets: read<Powerset[]>('powersets.json'),
    powers: read<Power[]>('powers.json'),
    boosts: read<BoostsFile>('boosts.json'),
  });
  return cached;
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
