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

/**
 * Give each slot the lowest free slot level at or after the level its power was taken (the
 * highest free one when none is that high), powers taken earliest first.
 *
 * It books a respec's slots, which may go on any power. It also finds a leveled history whenever
 * one exists (leveledSlotShortfall() is null): a power can use every level above its own, so the
 * lowest level it can take never strands a power taken later.
 *
 * @param free Slot levels on offer, one entry per slot, any order.
 * @param owned For each slot to place, the 0-based level its power was taken.
 * @param fallback Level for a slot left over when `free` runs out.
 * @return One level per slot, in the order of `owned`.
 */
export function lowestFreeLevels(free: readonly number[], owned: readonly number[], fallback: number): number[] {
  const left = [...free].sort((a, b) => a - b);
  const out: number[] = [];
  for (const i of owned.map((_, k) => k).sort((a, b) => owned[a]! - owned[b]!)) {
    let k = left.findIndex((lv) => lv >= owned[i]!);
    if (k < 0) k = left.length - 1;
    out[i] = k >= 0 ? left.splice(k, 1)[0]! : fallback;
  }
  return out;
}

/**
 * Whether a build's bought slots could all have been gained by leveling: each comes from the slot
 * schedule at or after the level its power was taken.
 *
 * Checked from the top level down: the bought slots on powers taken at a level or later have to
 * fit in the schedule's slots from that level on. The game keeps no level for a slot, so this is
 * the only way to tell a respec apart, and only one way round: a build that passes may still have
 * come from a respec.
 *
 * @param added Each power's 0-based level and its bought slots (the free first slot not counted).
 * @param schedule The slot schedule (0-based level of each slot).
 * @return Null when a leveled history exists; else the highest level that fails, with the bought
 *   slots from it on (`need`) and the schedule's slots from it on (`have`).
 */
export function leveledSlotShortfall(
  added: readonly { level: number; count: number }[],
  schedule: readonly number[],
): { level: number; need: number; have: number } | null {
  const levels = [...new Set(added.filter((a) => a.count > 0).map((a) => a.level))].sort((a, b) => b - a);
  for (const t of levels) {
    const need = added.reduce((n, a) => (a.level >= t ? n + a.count : n), 0);
    const have = schedule.filter((s) => s >= t).length;
    if (need > have) return { level: t, need, have };
  }
  return null;
}
