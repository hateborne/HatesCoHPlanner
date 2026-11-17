/**
 * The build statistics the set finder reads (public/data/finder/stats.json).
 *
 * Made by the build research (`npm run research`, docs/pipeline.md) from a folder of community
 * builds: aggregates only. Everything is keyed by the game's internal names (the names
 * pipeline/ids.json keys its ids on), so the file reads the same against any game version.
 */

/** How builds of one group treat one stat. */
export interface FinderStat {
  share: number; // mean share of a build's set-bonus spend that goes to this stat (0..1)
  lift: number; // share / the stat's share of what the game offers: over 1 is sought after
  unit: number; // the typical size of one set bonus in this stat, in the totals line's unit
  total: number; // median build total for the stat, after caps
  bonus: number; // median amount the build's set bonuses add
}

/** One group of builds: every build, or one archetype's. */
export interface FinderGroup {
  n: number; // builds in the group
  stats: Record<string, FinderStat>; // by totals line key ('def.03', 'rech', 'mezprot.Knock')
}

/** A stat most builds of a group raise with enhancements. */
export interface FinderNeed {
  share: number; // share of the group's builds whose enhancements add to the stat (0..1)
  typical: number; // median amount those builds add
}

/** How often one enhancement set is slotted. */
export interface FinderSetUse {
  builds: number; // share of all builds holding 2 or more pieces of it in one power (0..1)
  pieces: number[]; // times slotted with 2, 3, 4, 5 and 6 pieces in one power
  at: Record<string, number>; // the same share within each archetype ('Class_Blaster'), zero left out
}

/** The whole statistics file. */
export interface FinderStats {
  v: 1;
  dataVersion: string; // the game version the builds were read against
  builds: number; // builds counted
  minGroup: number; // a group with fewer builds is too thin to use on its own: fall back to 'all'
  groups: Record<string, FinderGroup>; // 'all' and each archetype's internal name
  needs: Record<string, Record<string, FinderNeed>>; // archetype or powerset internal name -> stat key
  sets: Record<string, FinderSetUse>; // by set internal name ('Luck_of_the_Gambler')
  pieces: Record<string, number>; // unique pieces by boost name: share of builds earning their global
}

/**
 * Check that a downloaded statistics file has the shape the finder reads.
 *
 * @param raw The parsed JSON.
 * @return The statistics, or null when it is not a statistics file this version of the app reads.
 */
export function checkFinderStats(raw: unknown): FinderStats | null {
  const s = raw as Partial<FinderStats> | null;
  const isObject = (v: unknown) => !!v && typeof v === 'object' && !Array.isArray(v);
  if (!s || s.v !== 1 || typeof s.dataVersion !== 'string' || typeof s.minGroup !== 'number') return null;
  if (!isObject(s.groups) || !isObject(s.groups?.['all']?.stats) || !isObject(s.needs)) return null;
  return s as FinderStats;
}

/**
 * Download the build statistics.
 *
 * @param root The server's data folder as the site serves it (dataRoot), with its closing slash.
 * @return The statistics.
 * @raise Error when the file is missing or is not a statistics file.
 */
export async function loadFinderStats(root: string): Promise<FinderStats> {
  const r = await fetch(`${root}finder/stats.json`, { cache: 'no-cache' });
  if (!r.ok) throw new Error(`the build statistics are missing (HTTP ${r.status})`);
  const stats = checkFinderStats(await r.json());
  if (!stats) throw new Error('the build statistics are not in a form this version reads');
  return stats;
}
