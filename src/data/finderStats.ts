/**
 * The build statistics the set finder reads (public/data/finder/stats.json).
 *
 * Made by the build research (`npm run research`, docs/pipeline.md) from a folder of community
 * builds: aggregates only. Everything is keyed by the game's internal names (the names
 * pipeline/ids.json keys its ids on), so the file reads the same against any game version, and the
 * finder uses it for every version of its server (finderProblem).
 */

import { heard } from './packed.ts';
import { ask, Watch } from './watch.ts';

/** Folder beside a server's version folders holding the build statistics (finder/stats.json). */
export const FINDER_FOLDER = 'finder';

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
  dataVersion: string; // the game version the builds were read against (the report names it; no build is refused by it)
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
 * Every number a search or the form reads is checked, not the top of the file alone: a group or a
 * need that is not what it should be would stop every search, or take the pane down with it. A
 * stat's unit and a need's typical amount are amounts, never under zero (a negative unit would
 * turn a gain into a loss).
 *
 * @param raw The parsed JSON.
 * @return The statistics, or null when it is not a statistics file this version of the app reads.
 */
export function checkFinderStats(raw: unknown): FinderStats | null {
  const s = raw as Partial<FinderStats> | null;
  const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
  const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
  const amount = (v: unknown): boolean => num(v) && v >= 0;
  const each = (v: unknown, ok: (x: unknown) => boolean): boolean => isObject(v) && Object.values(v).every(ok);
  if (!s || s.v !== 1 || typeof s.dataVersion !== 'string' || !amount(s.minGroup) || !amount(s.builds)) return null;
  const stat = (v: unknown): boolean => isObject(v) && amount(v.share) && num(v.lift) && amount(v.unit) && num(v.total) && num(v.bonus);
  const group = (v: unknown): boolean => isObject(v) && amount(v.n) && each(v.stats, stat);
  if (!each(s.groups, group) || !isObject(s.groups?.['all'])) return null;
  const need = (v: unknown): boolean => isObject(v) && amount(v.share) && amount(v.typical);
  if (!each(s.needs, (v) => each(v, need))) return null;
  const setUse = (v: unknown): boolean => isObject(v) && amount(v.builds) && Array.isArray(v.pieces) && v.pieces.every(amount) && each(v.at, amount);
  if (!each(s.sets, setUse) || !each(s.pieces, amount)) return null;
  return s as FinderStats;
}

/**
 * Download the build statistics.
 *
 * @param root The server's data folder as the site serves it (dataRoot), with its closing slash.
 * @param watch The watch on the download: a file that gets no answer is asked for again alongside
 *   (ask), and a download that stalls can be given up through it.
 * @return The statistics.
 * @raise Error when the file is missing or is not a statistics file.
 */
export async function loadFinderStats(root: string, watch: Watch = new Watch()): Promise<FinderStats> {
  const url = `${root}${FINDER_FOLDER}/stats.json`;
  const r = heard(await ask(url, watch, { cache: 'no-cache' }), watch, url);
  if (!r.ok) throw new Error(`the build statistics are missing (HTTP ${r.status})`);
  const stats = checkFinderStats(await r.json());
  if (!stats) throw new Error('the build statistics are not in a form this version reads');
  return stats;
}

/** A download of the statistics, under way or done. */
export interface StatsAsk {
  watch: Watch; // the watch on it: tells whether it has stalled, and gives it up
  stats: Promise<FinderStats>; // the statistics, once in
}

// the statistics asked for and not yet handed to the finder, by data folder
const asked = new Map<string, StatsAsk>();

/**
 * Ask for the build statistics, or join the download already under way.
 *
 * The page asks when the set finder's pane is opened, alongside the pane's own code (App.tsx), so
 * the two download together; the finder's state then joins the same download (prepare).
 *
 * @param root The server's data folder as the site serves it (dataRoot), with its closing slash.
 * @return The download. One that fails is forgotten: the next call asks afresh.
 */
export function askFinderStats(root: string): StatsAsk {
  const known = asked.get(root);
  if (known) return known;
  const watch = new Watch();
  const made: StatsAsk = { watch, stats: loadFinderStats(root, watch) };
  asked.set(root, made);
  made.stats.catch(() => {
    if (asked.get(root) === made) asked.delete(root);
  });
  return made;
}

/**
 * Forget a download of the statistics: the finder holds them now, or it gave the download up.
 *
 * @param root The data folder it was asked for.
 * @param made The download; another one asked for since is left alone.
 */
export function releaseFinderStats(root: string, made: StatsAsk): void {
  if (asked.get(root) === made) asked.delete(root);
}
