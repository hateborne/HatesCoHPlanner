/**
 * Whether the set finder's pane is open. Kept apart from the finder's own state (finder.ts) so the
 * screens that only show its button don't pull the finder's engine into the page's first download:
 * the pane and everything behind it load when it is first opened (App.tsx).
 */
import { create } from 'zustand';

/** The pane's open flag. */
interface FinderOpen {
  open: boolean; // the pane shows
}

export const useFinderOpen = create<FinderOpen>(() => ({ open: false }));

/** Open the set finder's pane. */
export function openSetFinder(): void {
  useFinderOpen.setState({ open: true });
}

/** Close the set finder's pane; its search and kept swaps stay until the build changes. */
export function closeSetFinder(): void {
  useFinderOpen.setState({ open: false });
}
