/**
 * The set finder's search: every swap of pieces of one set into the slots one power already has,
 * ranked by what it is worth to the search.
 *
 * Slots are only refilled: no slot moves and no power changes. A swap is legal as the game would
 * judge it (the power takes the pieces, unique pieces stay unique, the pieces work at the build's
 * level), and the list is ranked again from scratch for each build it is asked about, so a kept
 * swap changes what the next search finds (the rule of five, caps, unique pieces). Everything is
 * judged at the build's last level, whatever exemplar level it is set to show (FinderBase).
 */
import type { GameData } from '../../data/gamedata.ts';
import type { FinderStats } from '../../data/finderStats.ts';
import { DEFAULT_SERVER } from '../../data/servers.ts';
import type { BoostSet, Power } from '../../data/types.ts';
import type { Build, Slot, SlottedEnh } from '../build.ts';
import { canSlot } from '../enhance.ts';
import { BuildRules, type BuildEntry } from '../rules.ts';
import { costOf, enhFor, mainOptions, pieceFor, pieceKind, setWanted, superiorOf, type MainOption, type PieceKind } from './candidates.ts';
import { FinderBase, type EntryState } from './core.ts';
import { setsOfPower } from './eligible.ts';
import { weightsFor } from './goals.ts';
import { applySwaps, isStale, slotIds, type Swap, type SwapPiece } from './pending.ts';
import { depthRange, queryProblem, type FinderQuery } from './query.ts';
import { needsFor, Scorer, type Scored } from './score.ts';
import { warningsOf, type Warning } from './warnings.ts';

// what a proc is taken to be worth when a swap would take it out: the planner has no proc numbers,
// so without this a proc would always look free to replace
// UNCONFIRMED default, in typical bonuses
export const PROC_VALUE = 1.5;
// extra reluctance to take out a unique piece's global, on top of what the totals lose
export const GLOBAL_KEEP = 0.5;
// what one step of a set's cost rank takes off a swap's score: enough to order two swaps worth
// about the same, never enough to hide a better one
export const COST_STEP = 0.05;
// swaps a search returns unless told otherwise
export const DEFAULT_LIMIT = 50;

/** A swap with its rank. */
export interface RankedSwap extends Swap {
  score: number; // in typical bonuses; higher is better
  lines: [string, number][]; // what it changes in the totals lines, before caps (the quick figures, not the full totals)
  warnings: Warning[]; // what it costs that the player should see
  displaced: number[]; // ids of the enhancements it takes out
}

/** What a search found. */
export interface FinderResult {
  swaps: RankedSwap[]; // best first
  considered: number; // power and set pairs a swap was worked out for, before the last legality check and the limit
  stale: string[]; // entry keys of kept swaps left out: made for another build, or the power's slots changed since
  problem?: string; // why nothing was searched
}

/** A search's inputs. */
export interface FinderInput {
  gd: GameData; // the build's game data
  stats: FinderStats; // the build statistics
  build: Build; // the build as the planner holds it
  kept?: readonly Swap[]; // swaps kept so far: the search ranks against the build with them in
  query: FinderQuery; // what to look for
  limit?: number; // most swaps to return (default DEFAULT_LIMIT)
}

/**
 * Why the finder can't work on a build, if it can't.
 *
 * @param gd The build's game data.
 * @param build The build.
 * @param stats The build statistics, or null when they did not load.
 * @return Null when it can, else a sentence for the player.
 */
export function finderProblem(gd: GameData, build: Build, stats: FinderStats | null): string | null {
  if (gd.server !== DEFAULT_SERVER) return 'The set finder covers Homecoming builds only for now.';
  if (!stats || stats.dataVersion !== build.dataVersion) return "The set finder has no build statistics for this build's game version yet.";
  return null;
}

/**
 * Whether the game would take every piece of a set of swaps on the build with all of them in.
 *
 * Swaps are each found legal against the build as it stood, but two of them can still clash (the
 * same unique piece into two powers), and one that replaces another can free or crowd a piece a
 * third relies on: only the finished build tells.
 *
 * @param gd Game data.
 * @param build The build as the planner holds it.
 * @param swaps The swaps, one per power.
 * @param rules The build's rules, when the caller has them already.
 * @return True when no piece of any of them is refused.
 */
export function swapsLegal(gd: GameData, build: Build, swaps: readonly Swap[], rules: BuildRules = new BuildRules(gd, build)): boolean {
  const r = rules.reslotted(applySwaps(build, swaps));
  const entries = new Map(r.entries().map((x) => [x.key, x]));
  return swaps.every((s) => {
    const entry = entries.get(s.key);
    return !!entry && entry.power.id === s.power && s.pieces.every((p) => r.enhRefusal(entry, p.slot, p.enh) === null);
  });
}

/** A piece a swap may place. */
interface Offer {
  letter: number; // the piece's index in its set
  enh: SlottedEnh; // how it goes in: its version and level
  kind: PieceKind; // plain, a unique piece's global, or a proc
}

/** The best swap of one set into one power. */
interface Found {
  entry: BuildEntry; // the power
  set: BoostSet; // the set
  count: number; // pieces of the set the power holds afterwards
  pieces: SwapPiece[]; // what goes where
  displaced: Slot[]; // the slots it empties first, as they were
  before: (number | null)[]; // the power's slots as the swap found them
  scored: Scored; // its score and what that was made from
  score: number; // the score less what the displaced pieces and the set's cost take off
}

/**
 * Search, a power at a time.
 *
 * 1. Read the build with the kept swaps in (FinderBase) and weigh the stats for the search.
 * 2. For each power: order its slots by what the build loses when each is emptied, least first
 *    (empty slots lead; a power with a kept swap starts from its own slots, so a new swap for it
 *    replaces the kept one).
 * 3. For each set the power takes and the search lets in: order the set's legal pieces by what
 *    each does for the power, then try every piece count the search allows, the new pieces going
 *    into the slots that cost least. Keep the best count: the best of those that gain what the
 *    search names, when any does.
 * 4. Rank everything found, drop what the game would refuse on the build with every kept swap and
 *    the new one in, and return the top of the list with its warnings.
 *
 * @param input The search's inputs.
 * @return A generator: it yields the share of the powers done (0..1) after each power, so a
 *   screen can spread the work over frames, and returns the result.
 */
export function* searchSwaps(input: FinderInput): Generator<number, FinderResult, void> {
  const { gd, stats, build, query: q } = input;
  const problem = finderProblem(gd, build, stats) ?? queryProblem(q);
  if (problem) return { swaps: [], considered: 0, stale: [], problem };

  const ownRules = new BuildRules(gd, build);
  const ownEntries = new Map(ownRules.entries().map((e) => [e.key, e]));
  // a kept swap counts only for the power and the slots it was made for
  const fits = (k: Swap): boolean => {
    const entry = ownEntries.get(k.key);
    return !!entry && entry.power.id === k.power && !isStale(k, entry.slots);
  };
  const kept = (input.kept ?? []).filter(fits);
  const stale = (input.kept ?? []).filter((k) => !fits(k)).map((k) => k.key);
  const keptKeys = new Set(kept.map((k) => k.key));
  const pending = applySwaps(build, kept);
  const rules = kept.length ? ownRules.reslotted(pending) : ownRules;
  const base = new FinderBase(gd, rules, pending);
  const weights = weightsFor(gd, stats, base.at.n, q);
  const scorer = new Scorer(base, weights, needsFor(stats.needs, [base.at.n, gd.powerset(build.primary).n, gd.powerset(build.secondary).n]));
  const origin = gd.core.origins.findIndex((o) => o.id === build.origin);
  const [lo, hi] = depthRange(q.main?.depth);
  const attuned = !!q.attuned;

  const kinds = new Map<number, PieceKind>();
  const kindOf = (boost: Power): PieceKind => {
    let k = kinds.get(boost.id);
    if (!k) kinds.set(boost.id, (k = pieceKind(gd, boost)));
    return k;
  };
  // what a swap pays for taking a slot's enhancement out, beyond what the totals lose
  const keepValue = (s: Slot): number => {
    const boost = s.enh ? gd.powerById.get(s.enh.boost) : undefined;
    const kind = boost ? kindOf(boost) : 'plain';
    return kind === 'proc' ? PROC_VALUE : kind === 'global' ? GLOBAL_KEEP : 0;
  };
  const mains = new Map<number, MainOption[]>();
  const mainsOf = (set: BoostSet): MainOption[] => {
    let m = mains.get(set.id);
    if (!m) mains.set(set.id, (m = q.main ? mainOptions(gd, set, base.vecs, q.main) : []));
    return m;
  };
  const superiors = new Map<number, BoostSet | null>();
  const wanted = (set: BoostSet): boolean => {
    if (!setWanted(set, q)) return false;
    // at 50 the Superior version of an archetype or winter set stands in for the plain one
    let superior = superiors.get(set.id);
    if (superior === undefined) superiors.set(set.id, (superior = superiorOf(gd, set) ?? null));
    if (base.last >= 49 && superior && setWanted(superior, q)) return false;
    return !q.main || mainsOf(set).length > 0;
  };
  // the rules a power's offers are tested against: for a power with a kept swap, the build with
  // every other kept swap in and this power as it was, since a new swap replaces the kept one
  const probes = new Map<string, BuildRules>();
  const rulesFor = (key: string): BuildRules => {
    if (!keptKeys.has(key)) return rules;
    let r = probes.get(key);
    if (!r) probes.set(key, (r = ownRules.reslotted(applySwaps(build, kept.filter((k) => k.key !== key)))));
    return r;
  };
  const emptied = (s: Slot): Slot => ({ level: s.level });

  /** @return The usable slots in the order a swap takes them: empty ones, then by what emptying each loses, least first. */
  const removalOrder = (e: BuildEntry, from: Slot[], usable: number[], now: EntryState): number[] => {
    const order = usable.filter((i) => !from[i]!.enh);
    let left = usable.filter((i) => !!from[i]!.enh);
    const cur = from.slice();
    while (left.length > 1) {
      let best = left[0]!;
      let bestScore = -Infinity;
      for (const i of left) {
        const trial = cur.slice();
        trial[i] = emptied(cur[i]!);
        const sc = scorer.score(e, now, base.state(e, trial)).score - keepValue(from[i]!);
        if (sc > bestScore) {
          bestScore = sc;
          best = i;
        }
      }
      order.push(best);
      cur[best] = emptied(cur[best]!);
      left = left.filter((i) => i !== best);
    }
    return [...order, ...left];
  };

  /** @return The offers in the order a swap places them: what does most for the power first, procs last. */
  const orderOffers = (e: BuildEntry, from: Slot[], free: number[], offers: Offer[], most: number, now: EntryState, prefer: Set<number>): Offer[] => {
    const bare = from.slice();
    for (const i of free) bare[i] = emptied(from[i]!);
    const chosen: Offer[] = [];
    let rest = offers.slice();
    while (chosen.length < most && rest.length > 1) {
      let best = rest[0]!;
      let bestScore = -Infinity;
      for (const o of rest) {
        const trial = bare.slice();
        [...chosen, o].forEach((c, j) => (trial[free[j]!] = { level: from[free[j]!]!.level, enh: c.enh }));
        let sc = scorer.score(e, now, base.state(e, trial)).score;
        if (o.kind === 'proc') sc -= 1000;
        if (prefer.has(o.letter)) sc += 1000;
        if (sc > bestScore) {
          bestScore = sc;
          best = o;
        }
      }
      chosen.push(best);
      rest = rest.filter((o) => o !== best);
    }
    return [...chosen, ...rest];
  };

  /** @return The best swap of a set into a power, or undefined when none is legal or wanted. */
  const bestOf = (e: BuildEntry, from: Slot[], usable: number[], order: number[], now: EntryState, set: BoostSet): Found | undefined => {
    // the set's pieces the power holds in slots it has at the build's last level: letter -> slot
    // (a piece in a later slot earns nothing yet; the game still refuses a second copy of it)
    const have = new Map<number, number>();
    for (const i of usable) {
      const enh = from[i]!.enh;
      const ref = enh ? gd.boostSetOf.get(enh.boost) : undefined;
      if (ref && ref.set.id === set.id) have.set(ref.letter, i);
    }
    const probe: BuildEntry = { ...e, slots: from };
    const tester = rulesFor(e.key);
    const offers: Offer[] = [];
    for (let letter = 0; letter < set.slots.length; letter++) {
      const boost = have.has(letter) ? undefined : pieceFor(gd, set, letter, attuned);
      if (!boost || !canSlot(gd, e.power, boost, origin)) continue;
      const enh = enhFor(gd, boost, base.last);
      // no slot is named: the piece may not already be in the power, nor a unique piece in the build
      if (tester.slotRefusal(probe, -1, boost, enh.ioLevel) !== null) continue;
      offers.push({ letter, enh, kind: kindOf(boost) });
    }
    const held = new Set(have.values());
    const free = order.filter((i) => !held.has(i));
    const most = Math.min(offers.length, free.length, hi - have.size);
    if (most < 1) return undefined;
    const prefer = new Set(mainsOf(set).map((o) => o.letter).filter((l): l is number => l !== undefined));
    const ranked = orderOffers(e, from, free, offers, most, now, prefer);

    let best: Found | undefined;
    // whether `best` is a gain in what the search names: such a count is kept over one that is not,
    // whatever their scores, since the list drops a swap that gains nothing asked for
    let bestAsked = false;
    for (let k = 1; k <= most; k++) {
      const count = have.size + k;
      if (count < lo || count > hi) continue;
      let chosen = ranked.slice(0, k);
      if (count === 1) {
        // one piece alone earns no set bonus: only a unique piece's global is worth a slot
        const single = ranked.find((o) => prefer.has(o.letter)) ?? ranked.find((o) => o.kind === 'global');
        if (!single) continue;
        chosen = [single];
      }
      const slots = from.slice();
      const pieces: SwapPiece[] = [];
      const displaced: Slot[] = [];
      chosen.forEach((o, j) => {
        const i = free[j]!;
        if (from[i]!.enh) displaced.push(from[i]!);
        slots[i] = { level: from[i]!.level, enh: o.enh };
        pieces.push({ slot: i, enh: o.enh });
      });
      const scored = scorer.score(e, now, base.state(e, slots));
      if (q.main) {
        // the wanted bonus must really arrive: the stat rises under its cap, through a bonus of the
        // asked depth that this swap newly earns and the rule of five still counts
        if (!(base.cappedChange(q.main.stat, scored.lines.get(q.main.stat) ?? 0) > 1e-9)) continue;
        const earns = (o: MainOption) => (o.letter !== undefined ? chosen.some((c) => c.letter === o.letter) : have.size < o.min && count >= o.min);
        if (!mainsOf(set).some((o) => earns(o) && o.bonus.some((id) => (scored.counted.get(id) ?? 0) > 0))) continue;
      }
      const score = scored.score - displaced.reduce((n, s) => n + keepValue(s), 0) - COST_STEP * costOf(set);
      const asked = !!q.main || scored.asked > 1e-9;
      if (!best || (asked && !bestAsked) || (asked === bestAsked && score > best.score)) {
        best = { entry: e, set, count, pieces, displaced, before: slotIds(from), scored, score };
        bestAsked = asked;
      }
    }
    return best;
  };

  // the powers a swap may go into: every one with slots, or only those the search names (an empty
  // list names none, so it is every power)
  const named = q.powers?.length ? new Set(q.powers.map((x) => `${x.key}|${x.power}`)) : null;
  const entries = base.st.entries.filter((e) => e.level <= base.last && rules.slottable(e.power) && (!named || named.has(`${e.key}|${e.power.id}`)));
  const found: Found[] = [];
  for (let n = 0; n < entries.length; n++) {
    const e = entries[n]!;
    const from = keptKeys.has(e.key) ? ownEntries.get(e.key)!.slots : e.slots;
    const usable = from.map((_, i) => i).filter((i) => from[i]!.level <= base.last);
    const sets = usable.length ? setsOfPower(gd, e.power.id).filter(wanted) : [];
    if (sets.length) {
      const now = base.state(e, e.slots);
      const order = removalOrder(e, from, usable, now);
      for (const set of sets) {
        const f = bestOf(e, from, usable, order, now, set);
        if (f) found.push(f);
      }
    }
    yield (n + 1) / entries.length;
  }

  found.sort((a, b) => b.score - a.score || (a.set.n < b.set.n ? -1 : a.set.n > b.set.n ? 1 : 0) || (a.entry.key < b.entry.key ? -1 : 1));
  // the game must take every piece of every kept swap and of the new one on the finished build: a
  // swap that replaces a kept one can free or crowd a unique piece another kept swap relies on
  const legal = (swap: Swap): boolean => swapsLegal(gd, build, [...kept.filter((k) => k.key !== swap.key), swap], ownRules);
  const swaps: RankedSwap[] = [];
  const limit = input.limit ?? DEFAULT_LIMIT;
  for (const f of found) {
    if (swaps.length >= limit) break;
    // without a wanted bonus, only swaps that leave the build better off by the search's own measure
    if (!q.main && f.score <= 0) break;
    // and better off in what the search names: what it did not name only orders the list
    if (!q.main && f.scored.asked <= 1e-9) continue;
    const swap: Swap = { key: f.entry.key, power: f.entry.power.id, freeLevel: f.entry.level, set: f.set.id, count: f.count, pieces: f.pieces, before: f.before };
    if (!legal(swap)) continue;
    swaps.push({
      ...swap,
      score: f.score,
      lines: [...f.scored.lines],
      warnings: warningsOf(gd, f.scored, f.displaced),
      displaced: f.displaced.map((s) => s.enh!.boost),
    });
  }
  return { swaps, considered: found.length, stale };
}

/**
 * Search in one go (tests, and screens that need no progress).
 *
 * @param input The search's inputs.
 * @return The result.
 */
export function findSwaps(input: FinderInput): FinderResult {
  const run = searchSwaps(input);
  for (;;) {
    const step = run.next();
    if (step.done) return step.value;
  }
}
