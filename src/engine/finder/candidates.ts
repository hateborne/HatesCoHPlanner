/**
 * The sets and pieces a search may offer: which sets its tags let in, which version and level of a
 * piece goes in, which pieces are special (a unique piece's global, a proc), and which sets give
 * the bonus the search wants.
 */
import type { GameData } from '../../data/gamedata.ts';
import type { BoostSet, Effect, Power } from '../../data/types.ts';
import type { SlottedEnh } from '../build.ts';
import { boostMods, ioLevelRange, levelsAbove, lowerShortName, setRarity, type RarityKind } from '../enhance.ts';
import { isPieceGlobal } from '../setbonus.ts';
import type { BonusVecs } from './bonusVec.ts';
import { depthRange, type Depth, type FinderQuery, type SetTag } from './query.ts';

/** What kind of piece an enhancement is, for the finder. */
export type PieceKind =
  | 'plain' // it enhances the power it is in
  | 'global' // it also does something on its own while slotted (Luck of the Gambler's recharge, Miracle's recovery)
  | 'proc'; // it has a chance effect, which the planner has no numbers for

// the tag a search needs for each rarity; uncommon and rare sets are always looked at
const TAG_OF: Record<RarityKind, SetTag | null> = {
  uncommon: null,
  rare: null,
  veryRare: 'purple',
  pvp: 'pvp',
  winter: 'seasonal',
  superiorWinter: 'seasonal',
  event: 'seasonal',
  archetype: 'archetype',
  superiorArchetype: 'archetype',
};

// how dear a set is, by rarity: uncommon, then rare, then everything else
// UNCONFIRMED default: only breaks ties between swaps worth about the same
const COST_OF: Record<RarityKind, number> = {
  uncommon: 0,
  rare: 1,
  veryRare: 2,
  pvp: 2,
  winter: 2,
  superiorWinter: 2,
  event: 2,
  archetype: 2,
  superiorArchetype: 2,
};

/**
 * Whether a search's tags and categories let a set in.
 *
 * @param set The set.
 * @param q The search.
 * @return True when the set may be offered.
 */
export function setWanted(set: BoostSet, q: FinderQuery): boolean {
  if (q.groups && !q.groups.includes(set.grp)) return false;
  const rarity = setRarity(set);
  const tag = rarity ? TAG_OF[rarity.kind] : null;
  return tag === null || q.tags.includes(tag);
}

/**
 * A set's cost rank, for telling two swaps of about the same worth apart: rarity first, then the
 * level its pieces start at.
 *
 * @param set The set.
 * @return A small number, higher for dearer sets.
 */
export function costOf(set: BoostSet): number {
  const rarity = setRarity(set);
  return (rarity ? COST_OF[rarity.kind] : 2) + Math.max(0, set.minL) / 100;
}

/**
 * The Superior version of an archetype or winter set, when the data has one.
 *
 * @param gd Game data.
 * @param set The set.
 * @return The Superior set, or undefined.
 */
export function superiorOf(gd: GameData, set: BoostSet): BoostSet | undefined {
  const kind = setRarity(set)?.kind;
  if (kind !== 'archetype' && kind !== 'winter') return undefined;
  return gd.boostSets.find((s) => s.n === `Superior_${set.n}`);
}

/**
 * The version of a set's piece a search places: crafted, or attuned when the search asks for it
 * (or the set has no crafted version: archetype, winter and event sets).
 *
 * @param gd Game data.
 * @param set The set.
 * @param letter The piece's index in the set.
 * @param attuned Whether attuned pieces are wanted.
 * @return The enhancement, or undefined when the set has no such piece.
 */
export function pieceFor(gd: GameData, set: BoostSet, letter: number, attuned: boolean): Power | undefined {
  const versions = (set.slots[letter] ?? []).map((id) => gd.powerById.get(id)).filter((p): p is Power => !!p);
  return versions.find((p) => !!p.bup === attuned) ?? versions[0];
}

/**
 * How a piece goes into a slot at a build's last level: a crafted piece at the highest level that
 * works there (its set's top level, or as far above the character as an IO still works), an
 * attuned piece as it is.
 *
 * @param gd Game data.
 * @param boost The piece.
 * @param last The build's last level (0-based).
 * @return The enhancement to slot.
 */
export function enhFor(gd: GameData, boost: Power, last: number): SlottedEnh {
  const range = ioLevelRange(gd, boost);
  if (!range) return { boost: boost.id };
  return { boost: boost.id, ioLevel: Math.max(range[0], Math.min(range[1], last + levelsAbove(gd))) };
}

/** @return Whether any effect group of these (sub groups included) passes a test. */
function someEffect(effs: Effect[] | undefined, test: (e: Effect) => boolean): boolean {
  return (effs ?? []).some((e) => test(e) || someEffect(e.sub, test));
}

/**
 * What kind of piece an enhancement is.
 *
 * 1. Global: a bonus entry of its set names it as the piece its global needs (Luck of the
 *    Gambler's recharge, Steadfast Protection's defense), or it has an effect of its own on its
 *    user that always applies (Miracle's recovery, Kismet's to-hit).
 * 2. Proc: any other piece with a chance effect.
 * 3. Plain: the rest.
 *
 * @param gd Game data.
 * @param boost The enhancement.
 * @return Its kind.
 */
export function pieceKind(gd: GameData, boost: Power): PieceKind {
  const ref = gd.boostSetOf.get(boost.id);
  const name = lowerShortName(boost);
  if (ref?.set.bon.some((b) => isPieceGlobal(b) && (b.req ?? []).some((t) => t.toLowerCase() === name))) return 'global';
  const enhancing = new Set(boostMods(boost));
  const isChance = (e: Effect) => e.ppm !== undefined || (e.ch !== undefined && e.ch < 1);
  const own = (e: Effect) => !isChance(e) && (e.m ?? []).some((m) => m.tg === 'Caster' && !enhancing.has(m) && !m.a.every((a) => gd.attribName.get(a) === 'Null'));
  if (someEffect(boost.eff, own)) return 'global';
  return someEffect(boost.eff, isChance) ? 'proc' : 'plain';
}

/** One way a set gives the bonus a search wants. */
export interface MainOption {
  min: number; // pieces of the set a power needs for it
  letter?: number; // for a unique piece's global: the piece that must be among them
  bonus: number[]; // ids of the bonus powers that give the wanted stat this way
}

/**
 * The ways a set gives the bonus a search wants, within the search's depth.
 *
 * A set bonus counts when its piece count is within the depth. A unique piece's global (one
 * piece) counts only at the depth "anywhere". Bonuses that apply only in PvP never count.
 *
 * @param gd Game data.
 * @param set The set.
 * @param vecs The bonus lines.
 * @param main The wanted stat and depth.
 * @return The options (none: the set does not give it).
 */
export function mainOptions(gd: GameData, set: BoostSet, vecs: BonusVecs, main: { stat: string; depth: Depth }): MainOption[] {
  const [lo, hi] = depthRange(main.depth);
  const out: MainOption[] = [];
  for (const b of set.bon) {
    if ((b.req ?? []).some((t) => t.toLowerCase() === 'ispvpmap?')) continue;
    const global = isPieceGlobal(b);
    const bonus = b.auto.filter((id) => {
      const power = gd.powerById.get(id);
      return !!power && vecs.of(power, global).some((l) => l.key === main.stat && l.value > 0);
    });
    if (!bonus.length) continue;
    if (!global) {
      if (b.min >= lo && b.min <= hi) out.push({ min: b.min, bonus });
      continue;
    }
    if (main.depth !== 'any') continue;
    const named = new Set((b.req ?? []).map((t) => t.toLowerCase()));
    set.slots.forEach((versions, letter) => {
      if (versions.some((id) => named.has(lowerShortName(gd.power(id))))) out.push({ min: 1, letter, bonus });
    });
  }
  return out;
}
