/**
 * Whether the set finder's pane is open. Kept apart from the finder's own state (finder.ts) so the
 * screens that only show its button don't pull the finder's engine into the page's first download:
 * the pane and everything behind it load when it is first opened (App.tsx).
 */
import { create } from 'zustand';

/** A power picked for the set finder to keep to: its entry key and its id. */
export interface PickedPower {
  key: string; // the power's entry key
  power: number; // the power's id
}

/** The pane's open flag, and the powers being picked on the overview for it. */
interface FinderOpen {
  open: boolean; // the pane shows
  picking: boolean; // the pane is out of the way while the player clicks the powers to consider on the overview
  picked: PickedPower[]; // the powers picked so far
}

export const useFinderOpen = create<FinderOpen>(() => ({ open: false, picking: false, picked: [] }));

/** Open the set finder's pane. */
export function openSetFinder(): void {
  useFinderOpen.setState({ open: true });
}

/** Close the set finder's pane; its search and kept swaps stay until the build changes. */
export function closeSetFinder(): void {
  useFinderOpen.setState({ open: false, picking: false, picked: [] });
}

/**
 * Put the pane out of the way so the player can click the powers to consider on the overview.
 *
 * @param picked The powers the search is kept to already.
 */
export function startPickingPowers(picked: readonly PickedPower[]): void {
  useFinderOpen.setState({ picking: true, picked: [...picked] });
}

/** Bring the pane back; what was picked stays in `picked` for the pane to take. */
export function stopPickingPowers(): void {
  useFinderOpen.setState({ picking: false });
}

/** Pick a power, or let a picked one go. */
export function togglePickedPower(p: PickedPower): void {
  const { picked } = useFinderOpen.getState();
  const has = picked.some((x) => x.key === p.key && x.power === p.power);
  useFinderOpen.setState({ picked: has ? picked.filter((x) => !(x.key === p.key && x.power === p.power)) : [...picked, p] });
}
