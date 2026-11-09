import type { Core } from '../data/types.ts';

/** Number of schedule entries at or below a 0-based level (engine CountForLevel). */
export function countForLevel(level: number, schedule: readonly number[]): number {
  let n = 0;
  for (const s of schedule) if (s <= level) n++;
  return n;
}

/** Number of schedule entries exactly at a 0-based level. */
export function countAtLevel(level: number, schedule: readonly number[]): number {
  let n = 0;
  for (const s of schedule) if (s === level) n++;
  return n;
}

/** One level-up step of the wizard: what the game hands out at this level. */
export interface LevelStep {
  level: number; // 0-based character level
  picks: number[]; // pick indices granted at this level
  slots: number; // enhancement slots granted at this level
  slotLevels?: number[]; // respec only: the slot levels merged into this step, one entry per slot
}

/**
 * The level-up steps in order (levels that grant a power or slots), as the in-game flow
 * presents them: level 1 (two picks), then every later level with a pick or slots.
 *
 * @param core Exported core data (its schedule).
 * @return Steps sorted by level.
 */
export function levelSteps(core: Core): LevelStep[] {
  const byLevel = new Map<number, LevelStep>();
  const get = (l: number): LevelStep => {
    let s = byLevel.get(l);
    if (!s) {
      s = { level: l, picks: [], slots: 0 };
      byLevel.set(l, s);
    }
    return s;
  };
  core.schedule.power.forEach((l, i) => get(l).picks.push(i));
  for (const l of core.schedule.slot) get(l).slots++;
  return [...byLevel.values()].sort((a, b) => a.level - b.level);
}

/**
 * The same levels in the order Homecoming's respec presents them: every power pick first, level
 * by level (at level 1 the secondary power before the primary), then one "Choose All Enhancement
 * Slots:" screen holding every slot up to the respec level, at the respec level, so any power may
 * take any of them.
 *
 * The I24 source (uiReSpec.c respec_assignment / respec_slotAdvanceLevel, and the server's
 * respec_VerifyBoosts) places slots level by level and refuses a slot on a power bought after its
 * level; the live Homecoming client does not (checked in game: one screen, "Slots Available: 67",
 * slots piled on level 30+ powers were kept).
 *
 * @param steps The leveling steps (levelSteps()).
 * @param end 0-based level the respec runs to.
 * @return Power steps (no slots), then the one slot step (no picks, `slotLevels` set).
 */
export function respecSteps(steps: LevelStep[], end: number): LevelStep[] {
  const upTo = steps.filter((s) => s.level <= end);
  // pick 0 is level 1's primary and pick 1 its secondary (BuildRules.powerOption); the respec asks
  // the secondary first, as the I24 code already did for VEATs (uiReSpec.c pickingPrimary)
  const order = (p: number[]) => (p.includes(0) && p.includes(1) ? [1, 0, ...p.filter((k) => k > 1)] : p);
  const powers: LevelStep[] = upTo.filter((s) => s.picks.length).map((s) => ({ level: s.level, picks: order(s.picks), slots: 0 }));
  const slotLevels = upTo.flatMap((s) => Array.from({ length: s.slots }, () => s.level));
  return slotLevels.length ? [...powers, { level: end, picks: [], slots: slotLevels.length, slotLevels }] : powers;
}

/** @return The distinct levels a step places slots at (just its own level outside a respec). */
export function stepSlotLevels(s: LevelStep): number[] {
  return s.slotLevels ? [...new Set(s.slotLevels)] : [s.level];
}
