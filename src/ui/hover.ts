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
  desc: { p?: Power; s?: Powerset; at?: DOMRect } | null; // power / set under the pointer (the green description boxes) and its bar (window px)
  tip: { entry: BuildEntry; x: number; y: number; at?: DOMRect } | null; // power bar under the pointer (tooltip), and the bar itself (window px)
  ringTip: { entry: BuildEntry; slot: number; x: number; y: number } | null; // filled slot ring under the pointer
  blink: number | null; // 0-based level whose orb blinks (the hovered pick or slot was taken then)
  orb: number | null; // 0-based level of the hovered orb (lights that level's pick / slots)
  press: PressTip | null; // phones: what a long press is showing (they have no hover)
}

/**
 * Phones: the tooltip a long press opened, at the press point (window px). A power shows its
 * description, slot details and detailed numbers (with any rule it breaks); a filled slot its
 * enhancement; anything else its help text.
 */
export type PressTip = { x: number; y: number } & ({ kind: 'power'; entry: BuildEntry; notes: string[] } | { kind: 'enh'; entry: BuildEntry; slot: number } | { kind: 'text'; text: string });

const EMPTY: HoverState = { desc: null, tip: null, ringTip: null, blink: null, orb: null, press: null };

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

/**
 * Describe a power while it is hovered (null: the pointer left it). Stable, so it never re-renders a list.
 *
 * @param p The power, or null.
 * @param at Its bar (window px), which the tooltip keeps clear of.
 */
export function hoverPower(p: Power | null, at?: DOMRect): void {
  useHover.setState({ desc: p ? { p, at } : null });
}
