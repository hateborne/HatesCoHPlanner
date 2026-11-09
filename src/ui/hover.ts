import { useEffect } from 'react';
import { create } from 'zustand';
import type { Power, Powerset } from '../data/types.ts';
import type { BuildEntry } from '../engine/rules.ts';

/**
 * Pointer-hover state, kept out of the main store and out of each screen's own state on purpose:
 * a hover only re-renders the small pieces that subscribe to it (a description box, one glow, one
 * level orb, the tooltip), never the whole screen.
 */
export interface HoverState {
  desc: { p?: Power; s?: Powerset } | null; // power / set under the pointer (the green description boxes)
  tip: { entry: BuildEntry; x: number; y: number } | null; // power bar under the pointer (tooltip)
  ringTip: { entry: BuildEntry; slot: number; x: number; y: number } | null; // filled slot ring under the pointer
  pick: number | null; // 0-based level of the hovered pick (lights its level orb)
  orb: number | null; // 0-based level of the hovered orb (lights that level's pick / slots)
}

const EMPTY: HoverState = { desc: null, tip: null, ringTip: null, pick: null, orb: null };

export const useHover = create<HoverState>(() => EMPTY);

/** Forget every hover (a screen opened or closed, or the build changed under the pointer). */
export function clearHover(): void {
  useHover.setState(EMPTY);
}

/** Start a screen with no hover left over from the previous one, and leave none behind. */
export function useFreshHover(): void {
  useEffect(() => {
    clearHover();
    return clearHover;
  }, []);
}

/** Describe a power while it is hovered (null: the pointer left it). Stable, so it never re-renders a list. */
export function hoverPower(p: Power | null): void {
  useHover.setState({ desc: p ? { p } : null });
}
