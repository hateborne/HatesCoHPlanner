/**
 * Game versions the site carries data for (public/data/versions.json, written by the pipeline).
 * Each version keeps its own folder (public/data/<id>/), so a build or link made for one patch
 * keeps opening with that patch's data after newer ones are added.
 */

/** One published data set. */
export interface GameVersion {
  id: string; // folder name and the id builds and links carry, e.g. "i28p4"
  label: string; // shown in the version picker, e.g. "Issue 28, Page 4"
  hash: string; // content hash of the data files, used to bust stale browser caches
}

/** public/data/versions.json. */
export interface GameVersions {
  default: string; // id new builds start on
  versions: GameVersion[];
}

/** Builds and links made before game versions existed were all made on Issue 28, Page 4 data. */
export const LEGACY_GAME_VERSION = 'i28p4';

/** The pre-versioning data id format ("20261017-f94d0e09"), kept by older saved builds. */
const OLD_DATA_ID = /^\d{8}-[0-9a-f]{8}$/;

/**
 * Fetch and check the version index. Revalidated on every visit so a new patch shows up at once.
 *
 * @param base Site base URL (import.meta.env.BASE_URL).
 * @return The index; throws a readable error when it is missing or malformed.
 */
export async function loadVersions(base: string): Promise<GameVersions> {
  const r = await fetch(`${base}data/versions.json`, { cache: 'no-cache' });
  if (!r.ok) throw new Error(`the game version list is missing (HTTP ${r.status})`);
  const v = (await r.json()) as Partial<GameVersions>;
  const list = Array.isArray(v.versions) ? v.versions.filter((x) => x && typeof x.id === 'string' && /^[\w.-]+$/.test(x.id)) : [];
  if (!list.length) throw new Error('the game version list is empty');
  const def = list.some((x) => x.id === v.default) ? v.default! : list[0]!.id;
  return { default: def, versions: list.map((x) => ({ id: x.id, label: typeof x.label === 'string' ? x.label : x.id, hash: typeof x.hash === 'string' ? x.hash : '' })) };
}

/**
 * The game version a build or link asks for, with pre-versioning ids mapped to the version their
 * data was.
 *
 * @param id The build's dataVersion (undefined for links that carry none).
 * @return A version id (not checked against the index).
 */
export function normalizeVersion(id: string | undefined): string {
  return !id || OLD_DATA_ID.test(id) ? LEGACY_GAME_VERSION : id;
}

/**
 * Pick the version to open a build with.
 *
 * @param vs The version index.
 * @param id The build's dataVersion (undefined: a new build or an old link).
 * @return The version to load, and `missing` when the build asked for one this site no longer has.
 */
export function resolveVersion(vs: GameVersions, id: string | undefined): { version: GameVersion; missing?: string } {
  const want = id === undefined ? vs.default : normalizeVersion(id);
  const hit = vs.versions.find((v) => v.id === want);
  if (hit) return { version: hit };
  return { version: vs.versions.find((v) => v.id === vs.default)!, missing: want };
}
