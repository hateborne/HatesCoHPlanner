/**
 * Where the enhancement picker's Place puts the pieces chosen: one piece into the clicked slot,
 * several into the clicked slot and the power's empty slots.
 */
import type { SlottedEnh } from './build.ts';

/** One slot of a power and the enhancement Place puts in it (none: the slot is emptied). */
export interface Placement {
  slot: number; // index into the entry's slots
  enh: SlottedEnh | undefined;
}

/** What placements reads besides the pieces. */
export interface PlacingRules {
  slot: number; // the clicked slot
  targets: number[]; // the slots several pieces may fill, in order: the clicked one and the power's empty ones
  current: SlottedEnh | undefined; // the piece already in the clicked slot
  order: (boost: number) => number; // a piece's place in the picker's lists (the order several fill the slots in)
  row: (boost: number) => string | number; // the list row a piece stands for (its crafted and attuned versions share one)
}

/**
 * The slots the chosen pieces go into.
 *
 * One piece goes into the clicked slot. Several fill the targets in the lists' order, except that
 * the clicked slot's own piece, when still chosen, stays where it is, so no piece already slotted
 * is moved or replaced.
 *
 * @param picks The pieces chosen (no more than there are targets).
 * @param r The clicked slot, the targets and the lists' order.
 * @return Each piece with its slot; none while nothing is chosen.
 */
export function placements(picks: readonly SlottedEnh[], r: PlacingRules): Placement[] {
  if (!picks.length) return [];
  if (picks.length === 1) return [{ slot: r.slot, enh: picks[0] }];
  const ordered = [...picks].sort((a, b) => r.order(a.boost) - r.order(b.boost));
  const cur = r.current;
  const own = cur ? ordered.find((p) => r.row(p.boost) === r.row(cur.boost)) : undefined;
  const rest = ordered.filter((p) => p !== own);
  const free = own ? r.targets.filter((t) => t !== r.slot) : r.targets;
  return [...(own ? [{ slot: r.slot, enh: own }] : []), ...rest.map((enh, i) => ({ slot: free[i]!, enh }))];
}
