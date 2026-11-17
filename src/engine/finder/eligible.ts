/**
 * Which enhancement sets each power accepts, indexed once per game data (BoostSet.elig lists the
 * powers of each set; the finder asks the other way round, for every power of a build).
 */
import type { GameData } from '../../data/gamedata.ts';
import type { BoostSet } from '../../data/types.ts';

const indexes = new WeakMap<GameData, Map<number, BoostSet[]>>();

/**
 * The sets a power accepts.
 *
 * @param gd Game data.
 * @param powerId The power's id.
 * @return Its sets, in the data's order (none for a power that takes no set).
 */
export function setsOfPower(gd: GameData, powerId: number): readonly BoostSet[] {
  let index = indexes.get(gd);
  if (!index) {
    index = new Map<number, BoostSet[]>();
    for (const set of gd.boostSets) {
      for (const pid of set.elig) {
        const list = index.get(pid);
        if (list) list.push(set);
        else index.set(pid, [set]);
      }
    }
    indexes.set(gd, index);
  }
  return index.get(powerId) ?? [];
}
