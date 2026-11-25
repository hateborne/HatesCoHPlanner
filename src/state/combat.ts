/**
 * The totals' Out of Combat switch: whether the totals (and what reads them: the pet cards, a
 * power's damage in its info) count what powers give out of combat. Off on every visit, so the
 * totals never overstate how a character holds up in a fight; not part of a build or a link.
 */
import { create } from 'zustand';

/** The switch's state. */
interface CombatState {
  outOfCombat: boolean; // count the out-of-combat bonuses (src/engine/combat.ts)
}

export const useCombat = create<CombatState>(() => ({ outOfCombat: false }));

/** Flip the Out of Combat switch. */
export function toggleOutOfCombat(): void {
  useCombat.setState((s) => ({ outOfCombat: !s.outOfCombat }));
}
