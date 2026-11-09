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
