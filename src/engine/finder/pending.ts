/**
 * Swaps the player has kept, and the build they make. Nothing here touches the build the planner
 * holds: a kept swap is only a list of pieces and the slots they go in, until it is applied.
 */
import type { Build, Slot, SlottedEnh } from '../build.ts';
import { setEnhs } from '../actions.ts';

/** One enhancement a swap places. */
export interface SwapPiece {
  slot: number; // index into the power's slots
  enh: SlottedEnh; // the piece, with the level it goes in at
}

/** A swap: pieces of one set into slots one power already has. */
export interface Swap {
  key: string; // the power's entry key ('pick:<i>' or 'grant:<powerId>')
  power: number; // the power's id, to tell a swap made for another build apart
  freeLevel: number; // 0-based level of the power's free slot
  set: number; // BoostSet id
  count: number; // pieces of the set the power holds afterwards
  pieces: SwapPiece[]; // what goes where
  before: (number | null)[]; // the enhancement id in each of the power's slots when the swap was made (null: empty)
}

/**
 * The enhancements in a power's slots, as a swap records them.
 *
 * @param slots The power's slots.
 * @return The enhancement id per slot, null for an empty one.
 */
export function slotIds(slots: readonly Slot[]): (number | null)[] {
  return slots.map((s) => s.enh?.boost ?? null);
}

/**
 * Whether a swap was made for other slots than the power has now: the player changed the power's
 * slots or enhancements since, so the swap's slot numbers no longer mean what they did.
 *
 * @param swap The swap.
 * @param slots The power's slots in the build as it is, before any kept swap.
 * @return True when the swap should be let go.
 */
export function isStale(swap: Swap, slots: readonly Slot[]): boolean {
  const now = slotIds(slots);
  return now.length !== swap.before.length || now.some((id, i) => id !== swap.before[i]);
}

/**
 * A build with a swap's pieces in place.
 *
 * @param b The build (left as it is).
 * @param swap The swap.
 * @return The new build.
 */
export function applySwap(b: Build, swap: Swap): Build {
  return applySwaps(b, [swap]);
}

/**
 * A build with every kept swap in place.
 *
 * The build is copied once for all of them (setEnhs): a copy per piece was most of what a
 * legality check cost.
 *
 * @param b The build (left as it is).
 * @param kept The kept swaps (one per power: see keepSwap).
 * @return The new build, or `b` itself when no swap placed anything.
 */
export function applySwaps(b: Build, kept: readonly Swap[]): Build {
  return setEnhs(b, kept.flatMap((swap) => swap.pieces.map((p) => ({ key: swap.key, slot: p.slot, enh: p.enh, freeLevel: swap.freeLevel }))));
}

/**
 * Keep a swap. A power holds one kept swap: keeping another for the same power replaces it.
 *
 * @param kept The swaps kept so far.
 * @param swap The swap to keep.
 * @return The new list.
 */
export function keepSwap(kept: readonly Swap[], swap: Swap): Swap[] {
  return [...kept.filter((k) => k.key !== swap.key), swap];
}

/**
 * Let a kept swap go.
 *
 * @param kept The swaps kept so far.
 * @param key The power's entry key.
 * @return The new list.
 */
export function dropSwap(kept: readonly Swap[], key: string): Swap[] {
  return kept.filter((k) => k.key !== key);
}
