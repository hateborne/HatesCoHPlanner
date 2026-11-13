/** The electric flash's timing (electric_initEx / electric_drawAll, uiFx.c), kept apart from the component for tests. */

export const TICK_MS = 1000 / 30; // TIMESTEP = 30 x elapsed seconds (gfx.c)
const MAX_STEP = 30; // gfx.c caps TIMESTEP at 30
const BURST_FRAMES = 5; // electric_initEx: ef->counter
// a remount this many ticks after the click (a phone tab switched back) keeps its age, no new burst
const BURST_LATE = 3;

// The slot screen's flash: the live client's drawPowerAndEnhancements passes electric_init
// duration 45 (1.5 s, about three flickers); the source passes -1, which electric_initEx turns
// into 5000 ticks
export const SLOT_FLASH_TICKS = 45;

/**
 * @return The ticks a frame between two times advances the effect: TIMESTEP, never negative and
 *   capped as gfx.c caps it.
 */
export function tickStep(fromMs: number, toMs: number): number {
  return Math.min(MAX_STEP, Math.max(0, (toMs - fromMs) / TICK_MS));
}

/** @return Whether a flash `age` ticks old is over (electric_drawAll drops it once totalDuration > duration). */
export function flashOver(age: number, duration: number): boolean {
  return age > duration;
}

/**
 * Where a flash starts when it mounts: fresh from the click, or partway through when remounted.
 *
 * @param bornMs performance.now() of the click that added the slot.
 * @param nowMs performance.now() at the mount.
 * @param duration The flash's length in ticks.
 * @return Its age in ticks and the burst frames still to draw (none when remounted later than
 *   BURST_LATE), or null when it is already over and draws nothing.
 */
export function flashStart(bornMs: number, nowMs: number, duration: number): { age: number; burst: number } | null {
  const age = Math.max(0, (nowMs - bornMs) / TICK_MS); // ef->totalDuration
  if (flashOver(age, duration)) return null;
  return { age, burst: age < BURST_LATE ? BURST_FRAMES : 0 };
}
