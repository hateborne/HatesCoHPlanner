import { LEGACY_GAME_VERSION, patchOrder, type MadeOn } from '../data/versions.ts';
import type { Mbd } from './mids.ts';

/**
 * Mids database versions whose game patch the owner has confirmed. A Mids build file records only
 * its database version (BuiltWith.DatabaseVersion), not the patch, so this table is how an import
 * tells which patch a build was made on. Add an entry only once the patch is confirmed.
 */
export const MIDS_DB_PATCHES: readonly { db: string; patch: string }[] = [
  { db: '2026.1.1242', patch: 'i28p3' }, // Mids Reborn 3.8.0 shows it as "Homecoming Issue 28, Page 3"
];

/** The app name the planner writes into the .mbd files it exports (BuiltWith.App). */
export const PLANNER_APP = "Hate's CoH Planner";

/** @return A Mids database version ("2026.1.1242") as numbers, or undefined when it isn't one. */
function dbOrder(db: string): number[] | undefined {
  if (!/^\d+(\.\d+){1,3}$/.test(db.trim())) return undefined;
  return db.trim().split('.').map(Number);
}

/** @return Negative, zero or positive as Mids database version a is older than, equal to or newer than b. */
function compareDb(a: number[], b: number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

/**
 * The patch a Mids database version belongs to. Database versions only go up, so a version the
 * table doesn't list is placed by number: between two listed versions it belongs to the patch of
 * the nearest one below it, one older than every listed version was made before the oldest listed
 * patch, and one newer than every listed version is unknown (it may be any later patch).
 *
 * @param db BuiltWith.DatabaseVersion of a Mids build.
 * @param table The confirmed versions (MIDS_DB_PATCHES; a parameter for tests).
 * @return Where the build was made, or undefined when the version is missing or malformed.
 */
export function midsDbPatch(db: string | undefined, table: readonly { db: string; patch: string }[] = MIDS_DB_PATCHES): MadeOn | undefined {
  const want = db ? dbOrder(db) : undefined;
  if (!want) return undefined;
  const known = table
    .map((e) => ({ ...e, o: dbOrder(e.db) }))
    .filter((e): e is { db: string; patch: string; o: number[] } => !!e.o && !!patchOrder(e.patch))
    .sort((a, b) => compareDb(a.o, b.o));
  if (!known.length) return undefined;
  // newer than every listed version: its patch is unknown (it may be any later one), so the import
  // opens on the default version, as before patches were told apart
  if (compareDb(want, known[known.length - 1]!.o) > 0) return undefined;
  const below = known.filter((e) => compareDb(e.o, want) <= 0).pop();
  return below ? { patch: below.patch } : { patch: known[0]!.patch, before: true };
}

/**
 * Where a Mids build was made: read from the planner's own exports (which name their game version),
 * else from the Mids database version.
 *
 * @param mbd The decoded build (undefined for the old |MxDz; codes, which record no version).
 * @return The patch, or undefined when it can't be told.
 */
export function midsMadeOn(mbd: Mbd | undefined): MadeOn | undefined {
  const bw = mbd?.BuiltWith;
  if (!bw) return undefined;
  if (bw.App === PLANNER_APP) {
    // exports made before game versions were recorded were all made on the legacy version's data
    const v = typeof bw.GameVersion === 'string' && bw.GameVersion ? bw.GameVersion : LEGACY_GAME_VERSION;
    return { patch: v.replace(/^(i\d+p\d+).*$/, '$1'), version: v };
  }
  return midsDbPatch(bw.DatabaseVersion);
}
