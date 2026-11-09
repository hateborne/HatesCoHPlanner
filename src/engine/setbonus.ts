/**
 * IO set bonuses: which bonus powers a build earns, with the rule of 5 (the same bonus power
 * counts at most five times across the build; later copies are suppressed, as in MidsReborn).
 */
import type { GameData } from '../data/gamedata.ts';
import type { BoostSet, Power } from '../data/types.ts';
import type { BuildEntry } from './rules.ts';
import { evalRequires } from './requires.ts';
import { shortName } from './enhance.ts';

export const RULE_OF_FIVE = 5;

/** One earned bonus instance. */
export interface EarnedBonus {
  power: Power; // the Set_Bonus.* power granted
  set: BoostSet;
  entryKey: string; // power entry that earned it
  slotted: number; // pieces of the set slotted in that power
  suppressed: boolean; // true when over the rule-of-5 limit
}

/**
 * Every set bonus a build earns, in build order.
 *
 * @param gd Game data.
 * @param entries Build entries (from BuildRules.entries()).
 * @param level Optional exemplar level: bonuses only from powers owned at or below it.
 */
export function earnedBonuses(gd: GameData, entries: BuildEntry[], level = 49): EarnedBonus[] {
  const out: EarnedBonus[] = [];
  const counts = new Map<number, number>();
  for (const e of entries) {
    if (e.level > level) continue;
    const bySet = new Map<number, { set: BoostSet; names: string[] }>();
    for (const s of e.slots) {
      if (!s.enh || s.level > level) continue;
      const ref = gd.boostSetOf.get(s.enh.boost);
      if (!ref) continue;
      const cur = bySet.get(ref.set.id) ?? { set: ref.set, names: [] };
      cur.names.push(shortName(gd.power(s.enh.boost)).toLowerCase());
      bySet.set(ref.set.id, cur);
    }
    for (const { set, names } of bySet.values()) {
      const n = names.length;
      const ctx = {
        ownsPower: () => false,
        ownsSet: () => false,
        prop: () => 0,
        boostsSlotted: (nm: string) => names.filter((x) => x === nm.toLowerCase()).length,
      };
      for (const b of set.bon) {
        if (n < b.min || n > b.max) continue;
        if (b.req && !evalRequires(b.req, ctx)) continue;
        for (const pid of b.auto) {
          const p = gd.powerById.get(pid);
          if (!p) continue;
          const c = (counts.get(pid) ?? 0) + 1;
          counts.set(pid, c);
          out.push({ power: p, set, entryKey: e.key, slotted: n, suppressed: c > RULE_OF_FIVE });
        }
      }
    }
  }
  return out;
}
