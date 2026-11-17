/**
 * What the build research records about one build: its totals, what its enhancements add to them,
 * and which sets and pieces it slots. Pure: a build and its game data in, numbers out.
 */
import type { GameData } from '../src/data/gamedata.ts';
import type { Archetype, BoostSet, Power } from '../src/data/types.ts';
import { newBuild, type Build } from '../src/engine/build.ts';
import { enhKind, type EnhKind } from '../src/engine/enhance.ts';
import { evalRequires, type EvalContext } from '../src/engine/requires.ts';
import { BuildRules, startingSets } from '../src/engine/rules.ts';
import { isPieceGlobal } from '../src/engine/setbonus.ts';
import { bonusLines, computeTotals } from '../src/engine/totals.ts';

/** A stat line's value by its totals key ('def.03', 'rech', 'mezprot.Knock'). */
export type StatMap = Record<string, number>;

/** One set in one power of a build. */
export interface SetUse {
  set: number; // BoostSet id
  pieces: number; // distinct pieces of it in the power
}

/** Everything the research keeps about one build. */
export interface BuildFacts {
  at: number; // archetype id
  primary: number; // powerset id
  secondary: number; // powerset id
  picks: number; // powers picked
  slots: number; // enhancement slots in the build
  filled: number; // slots holding an enhancement
  totals: StatMap; // the build's totals, after caps
  fromBonus: StatMap; // what its set bonuses add (2 or more pieces; rule-of-5 copies left out)
  spend: StatMap; // the same bonuses counted in typical bonuses (bonusSpend), by stat
  fromGlobal: StatMap; // what its unique pieces' own globals add
  fromIo: StatMap; // everything its enhancements add: bonuses, globals and pieces' own effects
  sets: SetUse[]; // every set in every power, single pieces included
  globals: number[]; // boost ids of the pieces whose global the build earns
  procs: number[]; // boost ids of slotted pieces with a chance effect
  over5: number; // bonus copies lost to the rule of 5
  kinds: Partial<Record<EnhKind, number>>; // slotted enhancements by family
  attuned: number; // slotted set pieces that are attuned
  crafted: number; // slotted set pieces that are crafted at a level
  boosted: number; // slotted enhancements carrying boosters
  ioLevels: Record<number, number>; // crafted set pieces by level (1-based)
  issues: string[]; // rule issues the planner flags, numbers blanked
  signature: string; // equal for two builds with the same powers and slotting
}

/** @return Whether an enhancement has an effect that only sometimes fires (a proc). */
function isProc(boost: Power): boolean {
  return (boost.eff ?? []).some((e) => e.ppm !== undefined || (e.ch !== undefined && e.ch < 1));
}

/** @return a + b, key by key. */
function addInto(into: StatMap, key: string, value: number): void {
  if (value) into[key] = (into[key] ?? 0) + value;
}

/**
 * A requirement context for reading bonus powers on a build, as computeTotals makes its own.
 *
 * @param rules The build's rules.
 * @param level 0-based level.
 * @return The context.
 */
export function bonusContext(rules: BuildRules, level: number): EvalContext {
  return { ...rules.ctx(level, rules.ownedAt(level)), targetEntType: 'player' };
}

/**
 * Measure one build.
 *
 * @param gd The game data the build was imported against.
 * @param b The build (after checkBuild).
 * @param offer What the game's set bonuses offer the build's archetype (offerFor).
 * @return Its facts.
 */
export function measure(gd: GameData, b: Build, offer: Offer): BuildFacts {
  const rules = new BuildRules(gd, b);
  const t = computeTotals(gd, rules, b);
  const ctx = bonusContext(rules, t.level);
  const entries = rules.entries().filter((e) => e.level <= t.level);

  const totals: StatMap = {};
  for (const l of t.lines.values()) if (l.key !== 'def.base') totals[l.key] = l.capped;

  // names computeTotals files an enhancement's contributions under: "Set (pieces)" for a set
  // bonus, the piece's own name for its global and for what the piece itself does
  const ioNames = new Set<string>();
  const fromBonus: StatMap = {};
  const fromGlobal: StatMap = {};
  const spend: StatMap = {};
  const globals = new Set<number>();
  for (const bn of t.bonuses) {
    if (bn.suppressed) continue;
    ioNames.add(bn.global ? (bn.piece ?? bn.power).dn : `${bn.set.dn} (${bn.slotted})`);
    if (bn.global && bn.piece) globals.add(bn.piece.id);
    const lines = bonusLines(gd, rules.at, bn, t.level, ctx);
    for (const l of lines) addInto(bn.global ? fromGlobal : fromBonus, l.key, l.value);
    if (!bn.global) for (const [key, v] of Object.entries(bonusSpend(lines, offer.unit))) addInto(spend, key, v);
  }

  const sets: SetUse[] = [];
  const procs = new Set<number>();
  const kinds: Partial<Record<EnhKind, number>> = {};
  const ioLevels: Record<number, number> = {};
  let slots = 0;
  let filled = 0;
  let attuned = 0;
  let crafted = 0;
  let boosted = 0;
  for (const e of entries) {
    const bySet = new Map<number, Set<number>>();
    for (const s of e.slots) {
      slots++;
      const boost = s.enh ? gd.powerById.get(s.enh.boost) : undefined;
      if (!s.enh || !boost) continue;
      filled++;
      ioNames.add(boost.dn);
      const kind = enhKind(gd, boost);
      kinds[kind] = (kinds[kind] ?? 0) + 1;
      if (s.enh.boosters) boosted++;
      if (isProc(boost)) procs.add(boost.id);
      const ref = gd.boostSetOf.get(boost.id);
      if (!ref) continue;
      if (boost.bup) attuned++;
      else {
        crafted++;
        const lv = (s.enh.ioLevel ?? ref.set.maxL - 1) + 1;
        ioLevels[lv] = (ioLevels[lv] ?? 0) + 1;
      }
      bySet.set(ref.set.id, (bySet.get(ref.set.id) ?? new Set<number>()).add(ref.letter));
    }
    for (const [set, letters] of bySet) sets.push({ set, pieces: letters.size });
  }

  const fromIo: StatMap = {};
  for (const l of t.lines.values()) {
    if (l.key === 'def.base') continue;
    for (const s of l.sources) if (ioNames.has(s.name)) addInto(fromIo, l.key, s.value);
  }

  return {
    at: b.at,
    primary: b.primary,
    secondary: b.secondary,
    picks: b.picks.filter(Boolean).length,
    slots,
    filled,
    totals,
    fromBonus,
    spend,
    fromGlobal,
    fromIo,
    sets,
    globals: [...globals].sort((x, y) => x - y),
    procs: [...procs].sort((x, y) => x - y),
    over5: t.bonusesOver5,
    kinds,
    attuned,
    crafted,
    boosted,
    ioLevels,
    issues: rules.issues().map((i) => i.message.replace(/\d+/g, 'N')),
    signature: signature(b),
  };
}

/**
 * A build's powers and slotting as one string, so the same build saved twice counts once.
 *
 * @param b The build.
 * @return The signature (its name and on/off switches left out).
 */
export function signature(b: Build): string {
  const slot = (s: { enh?: { boost: number; ioLevel?: number; boosters?: number } }) => (s.enh ? `${s.enh.boost}@${s.enh.ioLevel ?? ''}+${s.enh.boosters ?? 0}` : '-');
  const picks = b.picks.map((p) => (p ? `${p.power}:${p.slots.map(slot).join(',')}` : ''));
  const granted = Object.keys(b.granted)
    .map(Number)
    .sort((x, y) => x - y)
    .map((id) => `${id}:${b.granted[id]!.slots.map(slot).join(',')}`);
  return [b.at, b.primary, b.secondary, picks.join('|'), granted.join('|')].join('/');
}

/** What the game's set bonuses offer one archetype, stat by stat. */
export interface Offer {
  unit: StatMap; // the typical (median) size of one bonus in each stat
  share: StatMap; // each stat's share of everything offered, counted in typical bonuses (sums to 1)
}

/** @return The middle value of a list (0 for an empty one). */
export function median(values: number[]): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

// the movement stats one "movement speed" bonus raises together
const MOVEMENT = new Set(['run', 'fly', 'jumpspd', 'jumph']);

/** @return The family a stat key belongs to: 'def', 'res', 'dmg', 'mezres', 'move', ... or the key itself. */
export function family(key: string): string {
  if (MOVEMENT.has(key)) return 'move';
  const dot = key.indexOf('.');
  return dot < 0 ? key : key.slice(0, dot);
}

/**
 * One bonus counted in typical bonuses, stat by stat.
 *
 * A bonus of typical size counts 1 in all. It is shared equally between the families of stats it
 * gives (defense, resistance, damage, recharge, movement, ...), and each family's part between the
 * stats of that family it covers. So a damage bonus over every damage type weighs the same as a
 * recharge bonus, and a resistance bonus that also carries status resistance weighs the same as one
 * that does not.
 *
 * @param lines What the bonus adds (bonusLines).
 * @param unit The typical size of one bonus in each stat.
 * @return The spend by stat key; stats with no typical size are left out.
 */
export function bonusSpend(lines: { key: string; value: number }[], unit: StatMap): StatMap {
  const counted = lines.filter((l) => unit[l.key] && l.value > 0);
  const inFamily = new Map<string, number>();
  for (const l of counted) inFamily.set(family(l.key), (inFamily.get(family(l.key)) ?? 0) + 1);
  const out: StatMap = {};
  for (const l of counted) out[l.key] = l.value / unit[l.key]! / inFamily.get(family(l.key))! / inFamily.size;
  return out;
}

/** @return A level-50 build of an archetype with nothing picked or slotted, to read requirements against. */
function blankBuild(gd: GameData, at: Archetype): Build {
  return newBuild({
    dataVersion: gd.core.manifest.dataVersion,
    at: at.id,
    origin: gd.core.origins[0]!.id,
    alignment: 'Hero',
    primary: startingSets(gd, at.cats.pri, at)[0]!.id,
    secondary: startingSets(gd, at.cats.sec, at)[0]!.id,
    pickCount: gd.core.schedule.power.length,
  });
}

/**
 * The enhancement sets an archetype can slot at all.
 *
 * An archetype origin set is for its own archetype only (its pieces' SlotRequires name it); every
 * other set is open to everyone. Tested on a level-50 character with nothing slotted, so unique
 * and level-50 pieces pass.
 *
 * @param gd Game data.
 * @param at The archetype.
 * @return The sets, in the data's order.
 */
export function setsFor(gd: GameData, at: Archetype): BoostSet[] {
  const rules = new BuildRules(gd, blankBuild(gd, at));
  const ctx: EvalContext = { ...bonusContext(rules, rules.lastLevel()), boostsSlotted: () => 0, powerBoostsSlotted: () => 0 };
  const open = (id: number) => {
    const piece = gd.powerById.get(id);
    return !!piece && (!piece.slr?.length || evalRequires(piece.slr, ctx));
  };
  return gd.boostSets.filter((set) => set.slots.some((versions) => versions.some(open)));
}

/**
 * What the game's set bonuses would add for one archetype.
 *
 * Every bonus of 2 or more pieces of every set the archetype can slot (setsFor) counts once; a
 * unique piece's global and the PvP-only bonuses (which never apply in the planner) are left out.
 *
 * @param gd Game data.
 * @param at The archetype.
 * @param level 0-based level the mod tables are read at.
 * @return The typical bonus size per stat and each stat's share of the offer.
 */
export function offerFor(gd: GameData, at: Archetype, level = 49): Offer {
  const ctx = bonusContext(new BuildRules(gd, blankBuild(gd, at)), level);
  const offered: { key: string; value: number }[][] = [];
  for (const set of setsFor(gd, at)) {
    for (const bon of set.bon) {
      if (isPieceGlobal(bon) || bon.req?.includes('isPVPMap?')) continue;
      for (const pid of bon.auto) {
        const power = gd.powerById.get(pid);
        if (power) offered.push(bonusLines(gd, at, { power, global: false }, level, ctx));
      }
    }
  }
  const sizes = new Map<string, number[]>();
  for (const lines of offered) for (const l of lines) if (l.value > 0) sizes.set(l.key, [...(sizes.get(l.key) ?? []), l.value]);
  const unit: StatMap = {};
  for (const [key, list] of sizes) unit[key] = median(list);
  const share: StatMap = {};
  let all = 0;
  for (const lines of offered) {
    for (const [key, v] of Object.entries(bonusSpend(lines, unit))) {
      share[key] = (share[key] ?? 0) + v;
      all += v;
    }
  }
  for (const key of Object.keys(share)) share[key] = share[key]! / all;
  return { unit, share };
}
