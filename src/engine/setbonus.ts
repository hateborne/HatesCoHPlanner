/**
 * IO set bonuses: which bonus powers a build earns, with the rule of 5 (the same bonus power
 * counts at most five times across the build; later copies are suppressed, as in MidsReborn).
 */
import type { GameData } from '../data/gamedata.ts';
import type { BoostSet, BoostSetBonus, Power } from '../data/types.ts';
import type { BuildEntry } from './rules.ts';
import { evalRequires } from './requires.ts';
import { effectiveness, shortName } from './enhance.ts';

export const RULE_OF_FIVE = 5;

// fewest pieces of one set in a power that earn a set bonus
export const SET_BONUS_MIN_PIECES = 2;

/** One earned bonus instance. */
export interface EarnedBonus {
  power: Power; // the Set_Bonus.* power granted
  set: BoostSet;
  entryKey: string; // power entry that earned it
  slotted: number; // distinct pieces of the set that count in that power
  suppressed: boolean; // true when over the rule-of-5 limit
  global: boolean; // a unique piece's own global effect (isPieceGlobal), not a set bonus
  piece?: Power; // for a global: the slotted piece its requirement names (Crafted_Luck_of_the_Gambler_F)
}

/**
 * Whether a set's bonus entry is a unique piece's own global effect rather than a set bonus.
 *
 * Set bonuses need at least two pieces of the set in one power. The data also stores a few pieces'
 * global effects (Luck of the Gambler's +7.5% recharge, Gladiator's Armor's defense, the archetype
 * origin procs) as an entry from one piece, gated on that piece being in the power
 * (`PowerBoostsSlotted>`). The game's enhancement info lists only the two-piece-and-up entries
 * under "Set Bonus".
 *
 * @param b One of a set's bonus entries.
 * @return True for a piece's own global effect.
 */
export function isPieceGlobal(b: BoostSetBonus): boolean {
  return b.min < SET_BONUS_MIN_PIECES;
}

/**
 * Every set bonus a build earns, in build order.
 *
 * A set counts its distinct pieces (letters) in each power, and a piece counts only while it works
 * at the level, unless it always counts (attuned pieces): boostset_FindBonuses. So a crafted and
 * an attuned copy of one piece count once, and a crafted IO too high for an exemplar level drops out.
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
    const bySet = new Map<number, { set: BoostSet; letters: Set<number>; pieces: Power[] }>();
    const names: string[] = []; // every enhancement in the power, for PowerBoostsSlotted>
    for (const s of e.slots) {
      if (!s.enh || s.level > level) continue;
      const boost = gd.power(s.enh.boost);
      names.push(shortName(boost).toLowerCase());
      const ref = gd.boostSetOf.get(boost.id);
      if (!ref) continue;
      if (!boost.bac && effectiveness(gd, boost, s.enh, level) <= 0) continue;
      const cur = bySet.get(ref.set.id) ?? { set: ref.set, letters: new Set<number>(), pieces: [] };
      cur.letters.add(ref.letter);
      cur.pieces.push(boost);
      bySet.set(ref.set.id, cur);
    }
    for (const { set, letters, pieces } of bySet.values()) {
      const n = letters.size;
      const ctx = {
        ownsPower: () => false,
        ownsSet: () => false,
        prop: () => 0,
        powerBoostsSlotted: (nm: string) => names.filter((x) => x === nm.toLowerCase()).length,
      };
      for (const b of set.bon) {
        if (n < b.min || n > b.max) continue;
        if (b.req && !evalRequires(b.req, ctx)) continue;
        const global = isPieceGlobal(b);
        // the piece a global's requirement names (its crafted or attuned version)
        const named = new Set((b.req ?? []).map((t) => t.toLowerCase()));
        const piece = global ? pieces.find((x) => named.has(shortName(x).toLowerCase())) : undefined;
        for (const pid of b.auto) {
          const p = gd.powerById.get(pid);
          if (!p) continue;
          const c = (counts.get(pid) ?? 0) + 1;
          counts.set(pid, c);
          out.push({ power: p, set, entryKey: e.key, slotted: n, suppressed: c > RULE_OF_FIVE, global, ...(piece ? { piece } : {}) });
        }
      }
    }
  }
  return out;
}
