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
  patch?: string; // the game patch it stands for, when not its own id (an approximate version)
  approx?: boolean; // approximate: power levels from Mids' database for that patch (pipeline/overlay.py)
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
 * Fetch and check a server's version index. Revalidated on every visit so a new patch shows up at once.
 *
 * @param root URL of the server's data folder (dataRoot in servers.ts).
 * @return The index; throws a readable error when it is missing or malformed.
 */
export async function loadVersions(root: string): Promise<GameVersions> {
  const r = await fetch(`${root}versions.json`, { cache: 'no-cache' });
  if (!r.ok) throw new Error(`the game version list is missing (HTTP ${r.status})`);
  const v = (await r.json()) as Partial<GameVersions>;
  const list = Array.isArray(v.versions) ? v.versions.filter((x) => x && typeof x.id === 'string' && /^[\w.-]+$/.test(x.id)) : [];
  if (!list.length) throw new Error('the game version list is empty');
  const def = list.some((x) => x.id === v.default) ? v.default! : list[0]!.id;
  return {
    default: def,
    versions: list.map((x) => ({
      id: x.id,
      label: typeof x.label === 'string' ? x.label : x.id,
      hash: typeof x.hash === 'string' ? x.hash : '',
      ...(typeof x.patch === 'string' && x.patch ? { patch: x.patch } : {}),
      ...(x.approx === true ? { approx: true } : {}),
    })),
  };
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

/** @return The game patch a version stands for ("i28p3" for the approximate "i28p3m"). */
export function patchOf(v: GameVersion): string {
  return v.patch ?? v.id;
}

/**
 * Where a patch sits in the game's history.
 *
 * @param patch A patch or version id ("i28p4", "i28p3m").
 * @return [issue, page], or undefined when the id names no issue and page.
 */
export function patchOrder(patch: string): [number, number] | undefined {
  const m = /^i(\d+)p(\d+)/.exec(patch);
  return m ? [Number(m[1]), Number(m[2])] : undefined;
}

/** @return Negative, zero or positive as patch a is older than, the same as or newer than b. */
function comparePatch(a: [number, number], b: [number, number]): number {
  return a[0] - b[0] || a[1] - b[1];
}

/**
 * The notice for a build opened on another version than it asked for, which the site doesn't
 * have. It never repeats the version as the build or link wrote it: a crafted link could make that
 * text read as anything, in the planner's own words. A patch-shaped id is named as its patch.
 *
 * @param missing The version the build asked for.
 * @param used The version it was opened with.
 * @return The notice.
 */
export function missingVersionNote(missing: string, used: GameVersion): string {
  const o = patchOrder(missing);
  const what = o && o[0] < 1000 && o[1] < 1000 ? `Issue ${o[0]}, Page ${o[1]}` : 'a game version';
  return `This build was made for ${what}, which the planner no longer has; it was opened with ${used.label}.`;
}

/** @return A patch's name for messages ("Issue 28, Page 3"), or the id itself. */
export function patchLabel(patch: string): string {
  const o = patchOrder(patch);
  return o ? `Issue ${o[0]}, Page ${o[1]}` : patch;
}

/**
 * The patch a build was made on, as far as it can be told.
 * `before` means only that it was made before `patch` (an older Mids database the table doesn't list).
 */
export interface MadeOn {
  patch: string; // a patch id ("i28p3")
  before?: boolean; // made on some patch older than `patch`
  version?: string; // the exact game version id, when known (the planner's own exports)
}

/** @return How a MadeOn reads in messages ("Issue 28, Page 3", "a patch before Issue 28, Page 3"). */
export function madeOnLabel(m: MadeOn): string {
  return m.before ? `a patch before ${patchLabel(m.patch)}` : patchLabel(m.patch);
}

/** Exact data first, then approximate; the index order breaks ties. */
function preferExact(a: GameVersion, b: GameVersion): number {
  return (a.approx ? 1 : 0) - (b.approx ? 1 : 0);
}

/**
 * Pick the game version an imported build opens on.
 *
 * 1. Made on a version or patch the site carries: that version, else that patch's data (exact
 *    data before approximate).
 * 2. Otherwise the nearest newer patch the site carries; for "made before patch P", the first
 *    carried patch at or after P (the only ones sure to be newer). The build has to be moved.
 * 3. Nothing newer: the newest patch the site carries, also a move.
 * 4. Patch unknown (no MadeOn): the default version, as before game versions were told apart.
 *
 * @param vs The version index.
 * @param made Where the build was made, or undefined when it can't be told.
 * @return The version to open on, and whether that moves the build to another patch.
 */
export function importTarget(vs: GameVersions, made: MadeOn | undefined): { version: GameVersion; move: boolean } {
  const def = vs.versions.find((v) => v.id === vs.default)!;
  const own = made?.version && vs.versions.find((v) => v.id === made.version);
  if (own) return { version: own, move: false };
  const want = made && patchOrder(made.patch);
  if (!made || !want) return { version: def, move: false };
  const ordered = vs.versions
    .map((v) => ({ v, o: patchOrder(patchOf(v)) }))
    .filter((x): x is { v: GameVersion; o: [number, number] } => !!x.o)
    .sort((a, b) => comparePatch(a.o, b.o) || preferExact(a.v, b.v));
  if (!made.before) {
    const same = ordered.find((x) => comparePatch(x.o, want) === 0);
    if (same) return { version: same.v, move: false };
  }
  const newer = ordered.find((x) => (made.before ? comparePatch(x.o, want) >= 0 : comparePatch(x.o, want) > 0));
  if (newer) return { version: newer.v, move: true };
  const newest = ordered[ordered.length - 1];
  if (!newest) return { version: def, move: false };
  const top = ordered.filter((x) => comparePatch(x.o, newest.o) === 0).sort((a, b) => preferExact(a.v, b.v))[0]!;
  return { version: top.v, move: true };
}
