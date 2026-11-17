/**
 * What each set bonus and unique piece's global adds to the totals lines, worked out once per
 * search with the totals' own mapping (bonusLines), so the finder's numbers match the totals.
 */
import type { GameData } from '../../data/gamedata.ts';
import type { Archetype, Power } from '../../data/types.ts';
import type { EvalContext } from '../requires.ts';
import { bonusLines, type ModLine } from '../totals.ts';

/** Changes to totals lines by key ('rech' -> 0.075). */
export type Vec = Map<string, number>;

/**
 * Add lines into a vector.
 *
 * @param into The vector to change.
 * @param lines What to add.
 * @param times How many times (negative to take away).
 */
export function addLines(into: Vec, lines: readonly { key: string; value: number }[], times = 1): void {
  if (!times) return;
  for (const l of lines) into.set(l.key, (into.get(l.key) ?? 0) + l.value * times);
}

/** The lines of every bonus power a search meets, kept after the first look. */
export class BonusVecs {
  private readonly cache = new Map<string, ModLine[]>(); // bonus power id and kind -> its lines

  /**
   * Set up for one build at one level.
   *
   * @param gd Game data.
   * @param at The character's archetype.
   * @param level 0-based level the totals are worked out at.
   * @param ctx Requirement context of the character (the totals state's).
   */
  constructor(
    private readonly gd: GameData,
    private readonly at: Archetype,
    private readonly level: number,
    private readonly ctx: EvalContext,
  ) {}

  /**
   * What one copy of a bonus adds to the totals lines.
   *
   * @param power The bonus power.
   * @param global Whether it is a unique piece's own global rather than a set bonus.
   * @return Its lines ("All" defense folded into each type).
   */
  of(power: Power, global: boolean): readonly ModLine[] {
    const key = `${power.id}${global ? 'g' : 's'}`;
    let lines = this.cache.get(key);
    if (!lines) this.cache.set(key, (lines = bonusLines(this.gd, this.at, { power, global }, this.level, this.ctx)));
    return lines;
  }
}
