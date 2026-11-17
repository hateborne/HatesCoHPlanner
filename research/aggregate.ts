/**
 * Turning measured builds into the statistics the set finder reads. Pure: facts in, numbers out.
 *
 * Stat values. A stat's unit is the typical size of one set bonus in it (Offer.unit). A build
 * "spends" on a stat as many units as its set bonuses add there, and a group's share for a stat is
 * the mean of its builds' spending shares. Dividing by the stat's share of what the game offers
 * gives the lift: a stat builds chase harder than the game hands it out scores over 1.
 */
import type { FinderGroup, FinderNeed, FinderSetUse, FinderStat } from '../src/data/finderStats.ts';
import { median, type BuildFacts, type Offer, type StatMap } from './measure.ts';

// a group with fewer builds is reported but too thin to use on its own
export const MIN_GROUP = 25;

// a need is kept when at least this share of a group's builds raise the stat with enhancements
export const NEED_SHARE = 0.25;

/** @return A number cut to 4 decimals, so a re-run writes the same file. */
export function round(v: number): number {
  return Math.round(v * 1e4) / 1e4;
}

/** @return The mean of a list (0 for an empty one). */
function mean(values: number[]): number {
  return values.length ? values.reduce((a, v) => a + v, 0) / values.length : 0;
}

/**
 * One build's set-bonus spending, as shares over the stats.
 *
 * @param spend The build's spend by stat, in typical bonuses (BuildFacts.spend).
 * @return Each stat's share of the build's spend (sums to 1), or null for a build with no bonuses.
 */
export function spendShares(spend: StatMap): StatMap | null {
  const all = Object.values(spend).reduce((a, v) => a + v, 0);
  if (!all) return null;
  const out: StatMap = {};
  for (const [key, v] of Object.entries(spend)) out[key] = v / all;
  return out;
}

/**
 * Summarise one group of builds.
 *
 * @param facts The group's builds.
 * @param offerOf The game's offer for an archetype id (measure.offerFor, cached by the caller).
 * @return The group's stat rows, for every stat a build totals or the game offers.
 */
export function summarize(facts: BuildFacts[], offerOf: (at: number) => Offer): FinderGroup {
  const keys = new Set<string>();
  for (const f of facts) {
    for (const k of Object.keys(f.totals)) keys.add(k);
    for (const k of Object.keys(offerOf(f.at).unit)) keys.add(k);
  }
  const shares = facts.map((f) => spendShares(f.spend)).filter((s): s is StatMap => s !== null);
  const stats: Record<string, FinderStat> = {};
  for (const key of [...keys].sort()) {
    const share = mean(shares.map((s) => s[key] ?? 0));
    const offered = mean(facts.map((f) => offerOf(f.at).share[key] ?? 0));
    stats[key] = {
      share: round(share),
      lift: round(offered ? share / offered : 0),
      unit: round(mean(facts.map((f) => offerOf(f.at).unit[key] ?? 0))),
      total: round(median(facts.map((f) => f.totals[key] ?? 0))),
      bonus: round(median(facts.map((f) => f.fromBonus[key] ?? 0))),
    };
  }
  return { n: facts.length, stats };
}

/**
 * The stats a group's builds raise with enhancements, whatever the kind: set bonuses, unique
 * pieces' globals and pieces' own effects (a knockback protection piece).
 *
 * @param facts The group's builds.
 * @param keep Which stat keys to look at.
 * @return By stat key: the share of builds that add to it and what those builds typically add,
 *   for stats at or over NEED_SHARE.
 */
export function needsOf(facts: BuildFacts[], keep: (key: string) => boolean): Record<string, FinderNeed> {
  const added = new Map<string, number[]>();
  for (const f of facts) {
    for (const [key, v] of Object.entries(f.fromIo)) {
      if (v > 0 && keep(key)) added.set(key, [...(added.get(key) ?? []), v]);
    }
  }
  const out: Record<string, FinderNeed> = {};
  for (const key of [...added.keys()].sort()) {
    const list = added.get(key)!;
    const share = list.length / facts.length;
    if (share >= NEED_SHARE) out[key] = { share: round(share), typical: round(median(list)) };
  }
  return out;
}

/**
 * How often each set is slotted for its bonuses.
 *
 * @param facts Every counted build.
 * @param setName A set's internal name by its id.
 * @param atName An archetype's internal name by its id.
 * @return By set name: the share of builds holding 2 or more pieces in one power, how often it is
 *   slotted at each piece count, and the share within each archetype. Sets no build uses that way
 *   are left out.
 */
export function setUsage(facts: BuildFacts[], setName: (id: number) => string, atName: (id: number) => string): Record<string, FinderSetUse> {
  const perAt = new Map<number, number>();
  for (const f of facts) perAt.set(f.at, (perAt.get(f.at) ?? 0) + 1);
  const acc = new Map<number, { builds: number; pieces: number[]; at: Map<number, number> }>();
  for (const f of facts) {
    const seen = new Set<number>();
    for (const u of f.sets) {
      if (u.pieces < 2) continue;
      let a = acc.get(u.set);
      if (!a) acc.set(u.set, (a = { builds: 0, pieces: [0, 0, 0, 0, 0], at: new Map() }));
      a.pieces[Math.min(u.pieces, 6) - 2]!++;
      if (seen.has(u.set)) continue;
      seen.add(u.set);
      a.builds++;
      a.at.set(f.at, (a.at.get(f.at) ?? 0) + 1);
    }
  }
  const out: Record<string, FinderSetUse> = {};
  for (const [id, a] of [...acc].sort((x, y) => setName(x[0]).localeCompare(setName(y[0]), 'en'))) {
    const at: Record<string, number> = {};
    for (const [atId, n] of [...a.at].sort((x, y) => atName(x[0]).localeCompare(atName(y[0]), 'en'))) at[atName(atId)] = round(n / perAt.get(atId)!);
    out[setName(id)] = { builds: round(a.builds / facts.length), pieces: a.pieces, at };
  }
  return out;
}

/**
 * How often each unique piece's global is earned.
 *
 * @param facts Every counted build.
 * @param boostName A boost's internal name by its id.
 * @return By boost name: the share of builds earning the piece's global.
 */
export function pieceUsage(facts: BuildFacts[], boostName: (id: number) => string): Record<string, number> {
  const n = new Map<number, number>();
  for (const f of facts) for (const id of f.globals) n.set(id, (n.get(id) ?? 0) + 1);
  const out: Record<string, number> = {};
  for (const [id, c] of [...n].sort((x, y) => boostName(x[0]).localeCompare(boostName(y[0]), 'en'))) out[boostName(id)] = round(c / facts.length);
  return out;
}

/**
 * Split builds into groups by a key.
 *
 * @param facts The builds.
 * @param keyOf The group keys a build belongs to.
 * @return The groups, in key order.
 */
export function groupBy(facts: BuildFacts[], keyOf: (f: BuildFacts) => string[]): Map<string, BuildFacts[]> {
  const out = new Map<string, BuildFacts[]>();
  for (const f of facts) for (const k of keyOf(f)) out.set(k, [...(out.get(k) ?? []), f]);
  return new Map([...out].sort((a, b) => a[0].localeCompare(b[0], 'en')));
}
