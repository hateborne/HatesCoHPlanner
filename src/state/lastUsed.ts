/**
 * When this browser last used the planner (a click, tap, key or wheel in any of its tabs), so a page
 * load after a long break can ask which server to use, with the last build one button away, instead
 * of reopening that build straight away. A per-browser convenience: with storage blocked there is no
 * remembered build to reopen either.
 */

/** The localStorage key holding the time of the last use (ms since the epoch). */
export const LAST_USED_KEY = 'hcp.lastUsed';

/** How long a break makes the next page load ask first: 4 hours. */
export const RETURN_AFTER = 4 * 60 * 60 * 1000;

// a stored time this far past the clock is damaged (or the clock was set back), not a recent use
const SKEW = 60 * 1000;

/**
 * Whether a page load now comes after a long break.
 *
 * No use on record counts as a long break: a build remembered from before the planner kept the
 * time, or one whose time was cleared, asks first rather than reopening unannounced.
 *
 * @param now The time now (ms since the epoch).
 * @param storage Where the time is kept (localStorage; tests pass their own).
 * @return True when the last use was RETURN_AFTER or longer ago, or isn't known.
 */
export function returning(now: number, storage: () => Pick<Storage, 'getItem'> = () => localStorage): boolean {
  let raw: string | null;
  try {
    raw = storage().getItem(LAST_USED_KEY);
  } catch {
    return true;
  }
  const t = raw === null || !/^\d{1,15}$/.test(raw) ? NaN : Number(raw);
  if (!Number.isFinite(t) || t > now + SKEW) return true;
  return now - t >= RETURN_AFTER;
}

/**
 * Record a use now.
 *
 * @param now The time now (ms since the epoch).
 * @param storage Where the time is kept (localStorage; tests pass their own).
 */
export function markUsed(now: number, storage: () => Pick<Storage, 'setItem'> = () => localStorage): void {
  try {
    storage().setItem(LAST_USED_KEY, String(Math.floor(now)));
  } catch {
    /* storage unavailable: nothing is remembered to come back to either */
  }
}

// a use is written at most this often per tab (the 4-hour window needs nothing finer)
const WRITE_EVERY = 60 * 1000;

/**
 * Record uses from now on: the first input at once, then at most once a minute while it goes on.
 * Only input counts: a tab that merely stays open, or one the browser reloads by itself when it
 * restores a session, is not someone using the planner.
 *
 * @param target The window to listen on.
 * @param clock The time source (Date.now; tests pass their own).
 */
export function trackUse(target: Pick<Window, 'addEventListener'>, clock: () => number = Date.now): void {
  let written = -Infinity;
  const used = () => {
    const now = clock();
    if (now - written < WRITE_EVERY) return;
    written = now;
    markUsed(now);
  };
  for (const type of ['pointerdown', 'keydown', 'wheel'] as const) target.addEventListener(type, used, { capture: true, passive: true });
}
