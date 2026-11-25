/**
 * IO set bonuses: which bonus powers a build earns, with the rule of 5 (the same bonus power
 * counts at most five times across the build; later copies are suppressed, as in MidsReborn).
 */
import type { GameData } from '../data/gamedata.ts';
import type { BoostSet, BoostSetBonus, Power } from '../data/types.ts';
import type { Slot } from './build.ts';
import type { BuildEntry } from './rules.ts';
import { nobody, withSlotted } from './context.ts';
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
      const ctx = withSlotted(nobody(), { inPower: (nm) => names.filter((x) => x === nm.toLowerCase()).length });
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

/** How one of a set's bonuses stands for a power: earned already, newly earned by a change, or not earned. */
export type BonusState = 'earned' | 'new' | 'none';

/** One line of a set's bonus list: a bonus power, the pieces it takes, and how it stands. */
export interface SetBonusLine {
  min: number; // pieces of the set it takes
  power: number; // the bonus power's id
  state: BonusState;
}

/**
 * A set's bonuses for one power, before and after a change to its slots: what the enhancement
 * picker lights up for the pieces chosen but not placed yet.
 *
 * Counted as the totals count them (earnedBonuses): distinct pieces that work at the level, and
 * no copy past the rule of five. A bonus the power earns now and keeps is `earned`; one only the
 * changed slots earn is `new`; the rest, one the change would lose included, are `none`.
 *
 * @param gd Game data.
 * @param entries The build's entries (BuildRules.entries()).
 * @param key The power's entry key.
 * @param set The set.
 * @param after The power's slots as the change would leave them.
 * @param level 0-based level the totals are worked out at.
 * @return The lines in the set's order (a piece's own global left out), each bonus power once per tier.
 */
export function setBonusLines(gd: GameData, entries: BuildEntry[], key: string, set: BoostSet, after: Slot[], level = 49): SetBonusLine[] {
  /** @return The bonus powers the power earns from the set, unsuppressed, and its pieces that count. */
  const read = (list: BuildEntry[]): { got: Set<number>; pieces: number } => {
    const mine = earnedBonuses(gd, list, level).filter((b) => b.entryKey === key && b.set.id === set.id);
    return { got: new Set(mine.filter((b) => !b.suppressed).map((b) => b.power.id)), pieces: mine[0]?.slotted ?? 0 };
  };
  const now = read(entries);
  const then = read(entries.map((e) => (e.key === key ? { ...e, slots: after } : e)));
  const out: SetBonusLine[] = [];
  for (const b of set.bon) {
    if (isPieceGlobal(b)) continue;
    for (const power of b.auto) out.push({ min: b.min, power, state: then.got.has(power) ? (now.got.has(power) ? 'earned' : 'new') : 'none' });
    // its extra power (not one the totals list): by the pieces alone
    const within = (n: number) => n >= b.min && n <= b.max;
    if (b.bp !== undefined) out.push({ min: b.min, power: b.bp, state: within(then.pieces) ? (within(now.pieces) ? 'earned' : 'new') : 'none' });
  }
  return out;
}
