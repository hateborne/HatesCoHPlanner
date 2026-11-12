/**
 * Enhancements: what a power accepts, how strong a slotted enhancement is, and Enhancement
 * Diversification. Ported from boost.c (power_IsValidBoost, boost_Effectiveness),
 * character_mods.c (boost magnitude) and character_attribs.c (AggregateStrength / ED).
 */
import type { GameData } from '../data/gamedata.ts';
import type { Archetype, BoostSet, DimReturnSet, Mod, Power } from '../data/types.ts';
import type { SlottedEnh } from './build.ts';

export const ORIGIN_COUNT = 5;

export type EnhKind =
  | 'Training'
  | 'Origin'
  | 'Invention'
  | 'Set'
  | 'Hamidon'
  | 'Hydra'
  | 'Titan'
  | 'DSync'
  | 'Synthetic'
  | 'Talisman'
  | 'Other';

/** @return The picker family of an enhancement power. */
export function enhKind(gd: GameData, boost: Power): EnhKind {
  if (gd.boostSetOf.has(boost.id)) return 'Set';
  const short = boost.n.split('.')[1] ?? '';
  // Generic_* covers Training enhancements and a few event pieces; only the plain-framed
  // "Training:" ones are TOs.
  if (short.startsWith('Generic_')) return /^Training/i.test(boost.dn) ? 'Training' : 'Other';
  if (/^(Magic|Mutation|Natural|Science|Technology)_/.test(short)) return 'Origin';
  if (short.startsWith('Crafted_')) return 'Invention';
  if (short.startsWith('Hamidon_')) return 'Hamidon';
  if (short.startsWith('Hydra_')) return 'Hydra';
  if (short.startsWith('Titan_')) return 'Titan';
  if (short.startsWith('DSync_')) return 'DSync';
  if (short.startsWith('Synthetic_')) return 'Synthetic';
  if (short.startsWith('Yins_')) return 'Talisman';
  return 'Other';
}

/** @return Short (middle) name of a power: "Boosts.X.X" -> "X". */
export function shortName(p: Power): string {
  return p.n.split('.')[1] ?? p.n;
}

/**
 * @return The mods of an enhancement that strengthen the power it is slotted in.
 *
 * A "Recharge/Chance for X" piece keeps its recharge value in the same PPM group as its proc
 * (Attuned_Avalanche_F); the engine applies Boost-flagged Strength mods whatever group holds them
 * (uiCombineSpec.c ClientCalcBoosts), so in a PPM group only the mods flagged Boost count -- the
 * proc's own effect (Basilisk's Gaze's -Recharge on its target) is not flagged and stays out.
 */
export function boostMods(boost: Power): Mod[] {
  const out: Mod[] = [];
  const walk = (effs: Power['eff'], inProc: boolean) => {
    for (const e of effs ?? []) {
      if (e.ch !== undefined && e.ch < 1) continue;
      const proc = inProc || !!e.ppm;
      for (const m of e.m ?? []) {
        const flagged = m.fl?.includes('Boost');
        if (m.asp === 'Strength' && (proc ? flagged === true : (flagged ?? true))) out.push(m);
      }
      walk(e.sub, proc);
    }
  };
  walk(boost.eff, false);
  return out;
}

/**
 * Whether an enhancement may be slotted into a power (engine power_IsValidBoost).
 *
 * @param gd Game data.
 * @param power Target power.
 * @param boost Enhancement power.
 * @param originIndex Character origin index (position in core.origins).
 */
export function canSlot(gd: GameData, power: Power, boost: Power, originIndex: number): boolean {
  const pba = power.ba ?? [];
  if (pba.length === 0 || (power.maxB ?? 0) === 0) return false;
  const ref = gd.boostSetOf.get(boost.id);
  if (ref && !ref.set.elig.includes(power.id)) return false;
  const bba = boost.ba ?? [];
  const originOk = bba.some((v) => v < ORIGIN_COUNT && v === originIndex);
  const typeOk = bba.some((v) => v >= ORIGIN_COUNT && pba.includes(v));
  return originOk && typeOk;
}

/** IO set rarity tiers, one per Enhancement Converter group. */
export type RarityKind =
  | 'uncommon'
  | 'rare'
  | 'veryRare'
  | 'pvp'
  | 'archetype'
  | 'superiorArchetype'
  | 'winter'
  | 'superiorWinter'
  | 'event';

/** An IO set's rarity: its tier and the name the tooltip shows for it. */
export interface SetRarity {
  kind: RarityKind;
  name: string; // "Very Rare", "Archetype Origin", "Event", ...
  event?: string; // event sets only: which event the set came from ("Summer Blockbuster")
}

// Enhancement Converter group (BoostSet.conv, from boostsets.bin) -> tier. "Very Rare" is the
// game's own rarity name (menuMessages.ms); the rest follow the Homecoming wiki's Enhancement
// Sets legend, which sorts sets by the same converter groups.
const RARITY_BY_GROUP: Record<string, { kind: RarityKind; name: string }> = {
  ECUncommon: { kind: 'uncommon', name: 'Uncommon' },
  ECRare: { kind: 'rare', name: 'Rare' },
  ECVeryRare: { kind: 'veryRare', name: 'Very Rare' },
  ECPvP: { kind: 'pvp', name: 'PvP' },
  ECATO: { kind: 'archetype', name: 'Archetype Origin' },
  ECSATO: { kind: 'superiorArchetype', name: 'Superior Archetype Origin' },
  ECWinter: { kind: 'winter', name: 'Winter Pack' },
  ECSWinter: { kind: 'superiorWinter', name: 'Superior Winter Pack' },
  ECUniversalDamage: { kind: 'event', name: 'Event' },
};

// The event sets share one converter group, so the game data can't say which event each came
// from; the owner chose the wiki's event names, keyed by set.
const EVENT_OF_SET: Record<string, string> = {
  Overwhelming_Force: 'Summer Blockbuster',
  Cupids_Crush: 'Spring Event Wedding',
};

/**
 * The rarity of an IO set, from its Enhancement Converter group.
 *
 * @param set The set.
 * @return Its tier and name, or undefined when none of its groups is a known tier.
 */
export function setRarity(set: BoostSet): SetRarity | undefined {
  for (const g of set.conv) {
    const r = RARITY_BY_GROUP[g];
    if (!r) continue;
    const event = r.kind === 'event' ? EVENT_OF_SET[set.n] : undefined;
    return event ? { ...r, event } : { ...r };
  }
  return undefined;
}

/** IO set level range as 0-based enhancement levels (boostsets.bin stores 1-based levels). */
export function setLevelRange(set: { minL: number; maxL: number }): [number, number] {
  return [Math.max(0, set.minL - 1), Math.max(0, set.maxL - 1)];
}

/**
 * The levels an IO is made at (0-based), for enhancements whose level is chosen.
 *
 * @param gd Game data.
 * @param boost Enhancement power.
 * @return A set piece's set range, a common IO's 10 to its maximum; null for attuned pieces (they
 *   follow the character) and for enhancements without an IO level (TO/DO/SO, HOs, ...).
 */
export function ioLevelRange(gd: GameData, boost: Power): [number, number] | null {
  if (!boost.bie || boost.bup) return null;
  const ref = gd.boostSetOf.get(boost.id);
  return ref ? setLevelRange(ref.set) : [9, Math.min(49, (boost.maxBL ?? 50) - 1)];
}

/** @return How many levels above the character an enhancement still works: 3 (boost_EffectivenessLevel). */
export function levelsAbove(gd: GameData): number {
  return gd.core.boostEffect.above.length - 1;
}

/** Default enhancement level for a newly placed enhancement (0-based). */
export function defaultLevel(gd: GameData, boost: Power): number | undefined {
  if (boost.bup) return undefined; // attuned: scales with the character
  const ref = gd.boostSetOf.get(boost.id);
  if (ref) return setLevelRange(ref.set)[1];
  if (boost.bie) return Math.min(49, (boost.maxBL ?? 50) - 1);
  return undefined;
}

/**
 * Level-effectiveness of an enhancement at a character level (boost_Effectiveness).
 *
 * @param gd Game data (boost effect tables).
 * @param boost Enhancement power.
 * @param e Slotted enhancement settings.
 * @param charLevel 0-based character (combat) level.
 * @return Multiplier, 0 when the enhancement does nothing at this level.
 */
export function effectiveness(gd: GameData, boost: Power, e: SlottedEnh, charLevel: number): number {
  const be = gd.core.boostEffect;
  const boosters = Math.max(0, Math.min(be.boosters.length - 1, e.boosters ?? 0));
  if (boost.bie) {
    // power_MinBoostUseLevel / power_MaxBoostUseLevel
    const [minSlot, maxSlot] = boost.slot ?? [-3, 49];
    const lvl = boostLevel(boost, e, charLevel);
    const minUse = boost.bup ? minSlot : Math.max(minSlot, lvl - (be.above.length - 1));
    if (charLevel < minUse || charLevel > maxSlot) return 0;
    return boost.bb ? (be.boosters[boosters] ?? 1) : 1;
  }
  const rel = boostLevel(boost, e, charLevel) + boosters - charLevel;
  const tbl = rel < 0 ? be.below : be.above;
  return tbl[Math.abs(rel)] ?? 0;
}

/** Level used to look up an enhancement's table value (character_mods.c iLevelBoost). */
export function boostLevel(boost: Power, e: SlottedEnh, charLevel: number): number {
  if (boost.bup) return Math.min(charLevel, (boost.maxBL ?? 50) - 1);
  if (boost.bie) return e.ioLevel ?? Math.min(49, (boost.maxBL ?? 50) - 1);
  return charLevel + (e.rel ?? 0);
}

/**
 * Color of an enhancement's level number (font_color in drawEnhancementOriginLevelEx):
 * paragon = an IO (CLR_PARAGON), even = at the character's level (white over light blue),
 * below / above = weaker (yellow) / stronger (green) for its level, unusable = red.
 */
export type EnhLevelTone = 'paragon' | 'even' | 'below' | 'above' | 'unusable';

/** The level number the game prints on a slotted enhancement. */
export interface EnhLevelLabel {
  text: string; // "50", or "50+5" with boosters
  top: boolean; // IOs print it over the piece's top edge, other enhancements at its bottom
  tone: EnhLevelTone;
}

/**
 * The level number the game prints on a slotted enhancement, as drawEnhancementOriginLevelEx
 * (uiCombineSpec.c) does.
 *
 * Attuned pieces print nothing (BoostUsePlayerLevel), nor do Homecoming's BoostHideLevel pieces.
 * A boostable piece with boosters reads "level+boosters". The planner keeps no combines for
 * TO/DO/SO-style enhancements, so their "50++" form never comes up: their level is the
 * character's plus the relative level.
 *
 * @param gd Game data (boost effect tables).
 * @param boost Enhancement power.
 * @param e Slotted enhancement settings.
 * @param charLevel 0-based character level (character_CalcExperienceLevel, not an exemplar level).
 * @return The label, or undefined when the game prints none.
 */
export function enhLevelLabel(gd: GameData, boost: Power, e: SlottedEnh, charLevel: number): EnhLevelLabel | undefined {
  if (boost.bup || boost.bhl) return undefined;
  const level = boostLevel(boost, e, charLevel) + 1;
  const boosters = boost.bb ? (e.boosters ?? 0) : 0;
  const eff = effectiveness(gd, boost, e, charLevel);
  const tone: EnhLevelTone = eff === 0 ? 'unusable' : boost.bie ? 'paragon' : eff < 1 ? 'below' : eff > 1 ? 'above' : 'even';
  return { text: boosters > 0 ? `${level}+${boosters}` : String(level), top: !!boost.bie, tone };
}

/** Per-attribute enhancement strength from one slotted enhancement. */
export interface EnhContribution {
  attrib: number;
  value: number;
  ignoreED: boolean;
}

/**
 * Strength values a slotted enhancement adds to its power, before ED.
 *
 * @param gd Game data.
 * @param at Character archetype (mod tables).
 * @param power Power the enhancement sits in (its BoostsAllowed gates BoostModAllowed mods).
 * @param e Slotted enhancement.
 * @param charLevel 0-based character level.
 */
export function enhValues(
  gd: GameData,
  at: Archetype,
  power: Power,
  e: SlottedEnh,
  charLevel: number,
): EnhContribution[] {
  const boost = gd.powerById.get(e.boost);
  if (!boost) return [];
  const eff = effectiveness(gd, boost, e, charLevel);
  if (eff <= 0) return [];
  const lvl = boostLevel(boost, e, charLevel);
  const pba = power.ba ?? [];
  const out: EnhContribution[] = [];
  for (const m of boostMods(boost)) {
    if (m.bma && !pba.includes(m.bma)) continue;
    const v = gd.table(at, m.tbl, lvl) * m.sc * eff;
    const ignoreED = m.fl?.includes('BoostIgnoreDiminishing') ?? false;
    for (const a of m.a) out.push({ attrib: a, value: v, ignoreED });
  }
  return out;
}

// The game's enhancement value lines (Game/src/UI/uiCombineSpec.c boostLines): one line per
// attribute, labelled by the enhancement type -- the second type (resist / debuff / slow) when the
// enhancement is that kind. Damage shows once, by its first type (Smashing); the other damage and
// defense types, knockup, placate, ... are enhanced alongside and hidden, as the game hides them.
// Labels are the client's messages for the type keys ("Damage_Boost" -> "Damage",
// "Recharge_Boost" -> "Recharge Time", ...).
const BOOST_LINES: { attrib: string; type1: string; type2?: string; label1: string; label2?: string }[] = [
  { attrib: 'DamageType00', type1: 'Damage_Boost', type2: 'Res_Damage_Boost', label1: 'Damage', label2: 'Resist Damage' },
  { attrib: 'DamageType07', type1: 'Heal_Boost', label1: 'Heal' },
  { attrib: 'Endurance', type1: 'Recovery_Boost', type2: 'Endurance_Drain_Boost', label1: 'Endurance', label2: 'Endurance Drain' },
  { attrib: 'ToHit', type1: 'Buff_ToHit_Boost', type2: 'Debuff_ToHit_Boost', label1: 'To Hit', label2: 'To Hit' },
  { attrib: 'Defense', type1: 'Buff_Defense_Boost', type2: 'Debuff_Defense_Boost', label1: 'Defense', label2: 'Defense Debuff' },
  { attrib: 'SpeedRunning', type1: 'SpeedRunning_Boost', type2: 'Slow_Boost', label1: 'Run Speed', label2: 'Slow Run' },
  { attrib: 'SpeedFlying', type1: 'SpeedFlying_Boost', type2: 'Slow_Boost', label1: 'Fly Speed', label2: 'Slow Fly' },
  { attrib: 'SpeedJumping', type1: 'Jump_Boost', type2: 'Slow_Boost', label1: 'Jump Speed', label2: 'Slow Jump' },
  { attrib: 'Taunt', type1: 'Taunt_Boost', label1: 'Threat Duration' },
  { attrib: 'Confused', type1: 'Confuse_Boost', label1: 'Confuse Duration' },
  { attrib: 'Terrorized', type1: 'Fear_Boost', label1: 'Fear Duration' },
  { attrib: 'Held', type1: 'Hold_Boost', label1: 'Hold Duration' },
  { attrib: 'Immobilized', type1: 'Immobilized_Boost', label1: 'Immobilize Duration' },
  { attrib: 'Stunned', type1: 'Stunned_Boost', label1: 'Disorient Duration' },
  { attrib: 'Sleep', type1: 'Sleep_Boost', label1: 'Sleep Duration' },
  { attrib: 'Intangible', type1: 'Intangible_Boost', label1: 'Intangible Duration' },
  { attrib: 'Knock', type1: 'Knockback_Boost', label1: 'KnockBack' },
  { attrib: 'Accuracy', type1: 'Accuracy_Boost', label1: 'Accuracy' },
  { attrib: 'Range', type1: 'Range_Boost', label1: 'Range' },
  { attrib: 'RechargeTime', type1: 'Recharge_Boost', type2: 'Slow_Boost', label1: 'Recharge Time', label2: 'Slow Attack Speed' },
  { attrib: 'InterruptTime', type1: 'Interrupt_Boost', label1: 'Interrupt Time' },
  { attrib: 'EnduranceDiscount', type1: 'EnduranceDiscount_Boost', label1: 'Endurance Discount' },
  { attrib: 'Recovery', type1: 'Recovery_Boost', type2: 'Endurance_Drain_Boost', label1: 'Endurance', label2: 'Endurance Drain' },
];

/**
 * An enhancement's values as the game lists them: one labelled line per attribute group
 * ("Damage", "Recharge Time", ...), instead of one per internal attribute (DamageType00 ... 09).
 *
 * @param gd Game data.
 * @param at The character's archetype (its tables scale the values).
 * @param power The power the enhancement goes in.
 * @param e The enhancement as slotted (level, boosters).
 * @param charLevel 0-based character level (attuned pieces follow it).
 * @return Lines in the game's order, each label once.
 */
export function enhLines(gd: GameData, at: Archetype, power: Power, e: SlottedEnh, charLevel: number): { label: string; value: number }[] {
  // getEffectiveString: a line shows only when the power accepts one of its types, named by the
  // type the power accepts (both names when it accepts both)
  const allowed = new Set((power.ba ?? []).filter((v) => v >= ORIGIN_COUNT).map((v) => gd.core.attribNames.Boost[v - ORIGIN_COUNT]?.n));
  const byName = new Map<string, number>();
  for (const c of enhValues(gd, at, power, e, charLevel)) {
    const n = gd.attribName.get(c.attrib) ?? '';
    byName.set(n, (byName.get(n) ?? 0) + c.value); // the engine adds every mod on an attribute
  }
  const out: { label: string; value: number }[] = [];
  const add = (label: string, value: number) => {
    if (!out.some((o) => o.label === label)) out.push({ label, value });
  };
  for (const line of BOOST_LINES) {
    const v = byName.get(line.attrib);
    if (v === undefined) continue;
    if (allowed.has(line.type1)) add(line.label1, v);
    if (line.type2 && line.label2 && allowed.has(line.type2)) add(line.label2, v);
  }
  return out;
}

/**
 * Whether an enhancement is a legacy copy the picker should not offer.
 *
 * Three families: the fixed-level common IOs (Crafted_X_10 ... _50, not set pieces); the legacy
 * "Cone" range enhancements (Generic_Cone, Magic_Cone, ...), each listed under the same name as
 * its "Range" twin (ten are exact copies; Mutation_Magic_Cone, "Helmet (Range)", gives twice its
 * twin's range in the game data and is hidden as well, the owner's call); and the
 * "_Drain_Endurance" Endurance Modification enhancements, exact copies of their "_Recovery" twin.
 *
 * @param gd Game data.
 * @param b An enhancement (Boost power).
 * @return True when an identical current enhancement covers it.
 */
export function isLegacyDuplicate(gd: GameData, b: Power): boolean {
  const inner = b.n.split('.')[1] ?? '';
  if (/^Crafted_[A-Za-z_]+_\d+$/.test(inner) && !gd.boostSetOf.has(b.id)) return true;
  if (inner.endsWith('_Cone')) {
    const twin = gd.powerByName.get(b.n.replace(/_Cone/g, '_Range').toLowerCase());
    return !!twin && twin.dn === b.dn;
  }
  if (inner.endsWith('_Drain_Endurance')) {
    const twin = gd.powerByName.get(b.n.replace(/_Drain_Endurance/g, '_Recovery').toLowerCase());
    return !!twin && twin.dn === b.dn && JSON.stringify(boostMods(twin)) === JSON.stringify(boostMods(b));
  }
  return false;
}

/**
 * A set piece's own name, without the set name in front ("Damage/Recharge" for "Decimation:
 * Damage/Recharge"). Names that don't start with the set's name ("Superior: Brute's Fury: ...")
 * keep what follows their last ": ".
 *
 * @param b The piece.
 * @param setName Its set's display name.
 */
export function pieceName(b: Power, setName: string): string {
  if (b.dn.startsWith(`${setName}:`)) return b.dn.slice(setName.length + 1).trim();
  const i = b.dn.lastIndexOf(': ');
  return i >= 0 ? b.dn.slice(i + 2).trim() : b.dn;
}

/** One diminishing-returns curve with its precomputed basis values. */
export interface DimCurve {
  start: number[];
  h: number[];
  basis: number[];
}

function makeCurve(ret: { start: number; h: number }[]): DimCurve {
  const start: number[] = [];
  const h: number[] = [];
  const basis: number[] = [];
  let b = 0;
  let lastStart = 0;
  let lastH = 1;
  for (const r of ret) {
    b += lastH * (r.start - lastStart);
    start.push(r.start);
    h.push(r.h);
    basis.push(b);
    lastStart = r.start;
    lastH = r.h;
  }
  return { start, h, basis };
}

/** Apply a diminishing-returns curve to a summed enhancement value (AggregateStrength). */
export function applyED(v: number, c: DimCurve | undefined): number {
  if (!c || c.start.length === 0) return v;
  const s0 = c.start[0] ?? 0;
  if (v <= s0) return v;
  for (let i = 0; i < c.start.length; i++) {
    const next = c.start[i + 1];
    if (next === undefined || v < next) {
      return (c.basis[i] ?? 0) + (v - (c.start[i] ?? 0)) * (c.h[i] ?? 1);
    }
  }
  return v;
}

/**
 * The ED curve for each attribute of a power, chosen from its BoostsAllowed exactly as
 * powers_load.c assigns apppDimReturns.
 */
export function edCurves(dims: DimReturnSet[], power: Power): (attrib: number) => DimCurve | undefined {
  const pba = power.ba ?? [];
  const byAttrib = new Map<number, DimCurve>();
  let fallback: DimCurve | undefined;
  const defaultSet = dims.find((d) => d.default);
  for (const d of dims) {
    if (d === defaultSet) continue;
    if (!d.boost.some((b) => pba.includes(b))) continue;
    for (const s of d.sets) {
      const c = makeCurve(s.ret);
      for (const a of s.a) byAttrib.set(a, c);
    }
  }
  if (defaultSet) {
    for (const s of defaultSet.sets) {
      const c = makeCurve(s.ret);
      if (s.default) {
        fallback = c;
        continue;
      }
      for (const a of s.a) if (!byAttrib.has(a)) byAttrib.set(a, c);
    }
  }
  return (a) => byAttrib.get(a) ?? fallback;
}

/** Enhancement strength of one power after ED: attribute offset -> bonus (0.95 = +95%). */
export interface PowerStrength {
  pre: Map<number, number>;
  post: Map<number, number>;
}

/**
 * Sum every slotted enhancement in a power and apply ED.
 *
 * @param gd Game data.
 * @param at Archetype.
 * @param power The power.
 * @param slots Enhancements in its slots (undefined entries are empty slots).
 * @param charLevel 0-based character level.
 */
export function powerStrength(
  gd: GameData,
  at: Archetype,
  power: Power,
  slots: (SlottedEnh | undefined)[],
  charLevel: number,
): PowerStrength {
  const pre = new Map<number, number>();
  const raw = new Map<number, number>();
  const noED = new Map<number, number>();
  for (const e of slots) {
    if (!e) continue;
    for (const c of enhValues(gd, at, power, e, charLevel)) {
      pre.set(c.attrib, (pre.get(c.attrib) ?? 0) + c.value);
      const target = c.ignoreED ? noED : raw;
      target.set(c.attrib, (target.get(c.attrib) ?? 0) + c.value);
    }
  }
  const curve = edCurves(gd.core.dimReturns, power);
  const post = new Map<number, number>();
  for (const a of new Set([...raw.keys(), ...noED.keys()])) {
    post.set(a, applyED(raw.get(a) ?? 0, curve(a)) + (noED.get(a) ?? 0));
  }
  return { pre, post };
}

/** @return The power's slot-able enhancement types in the game's order (BoostsAllowed). */
export function allowedTypes(gd: GameData, p: Power): string[] {
  const out: string[] = [];
  for (const v of p.ba ?? []) {
    const n = v >= 5 ? gd.core.attribNames.Boost[v - 5]?.dn : undefined;
    if (n && !out.includes(n)) out.push(n);
  }
  return out;
}

/**
 * @return The categories of the enhancement sets the power accepts: archetype sets first, then
 *   universal sets, then the rest (the order the game's tooltip lists them in).
 */
export function allowedSetCategories(gd: GameData, p: Power): string[] {
  const seen: string[] = [];
  for (const s of gd.boostSets) if (s.elig.includes(p.id) && !seen.includes(s.grp)) seen.push(s.grp);
  const rank = (g: string) => (/archetype/i.test(g) ? 0 : /universal/i.test(g) ? 1 : 2);
  const rest = seen.filter((g) => rank(g) === 2).reverse();
  return [...seen.filter((g) => rank(g) === 0), ...seen.filter((g) => rank(g) === 1), ...rest];
}

// help-text placeholders {Boost.Attrib.<group>.Scale} -> attribute names the group covers
// (Threat and Intangibility enhancements name their taunt / intangibility "Mez"; End Mod pieces
// their recovery "Endurance"; Regenerative Tissue its regeneration "Heal")
const HELP_GROUPS: Record<string, string[]> = {
  mez: ['held', 'stunned', 'sleep', 'immobilized', 'confused', 'terrorized', 'taunt', 'intangible'],
  movement: ['speed', 'jump', 'fly'],
  heal: ['heal', 'hitpoints', 'regeneration'],
  regen: ['regeneration'],
  knock: ['knock'],
  endurance: ['endurance', 'recovery'],
};

/**
 * An enhancement's help text with its {Boost.Attrib.<group>.Scale} placeholders filled in
 * (character_BoostGetHelpText): the enhancement's own value for that attribute group at its
 * level, as a percentage with one decimal ("Increases flight speed by 42.4%.").
 *
 * @param e The slotted enhancement (level, boosters).
 * @param charLevel 0-based character level (attuned pieces follow it).
 */
export function boostHelpText(gd: GameData, at: Archetype, e: SlottedEnh, charLevel: number): string {
  const boost = gd.powerById.get(e.boost);
  if (!boost) return '';
  const eff = Math.max(0, effectiveness(gd, boost, e, charLevel)) || 1;
  const lvl = boostLevel(boost, e, charLevel);
  const value = (m: Mod) => (m.tbl ? gd.table(at, m.tbl, lvl) * m.sc * eff : m.sc);
  const named = (mods: Mod[]) => mods.flatMap((m) => m.a.map((a) => ({ name: (gd.attribName.get(a) ?? '').toLowerCase(), v: value(m) })));
  // The game looks the placeholder up by template name among all of the piece's effects
  // (commonLangUtil.c formatHandlerP, basepower_GetAttribByName). The data keeps no template
  // names, so: the piece's enhancement values first, then its other effects, then the "Null"
  // effects that exist only to carry a global unique's number for this text (Steadfast
  // Protection's 3% defense, Gift of the Ancients' 7.5% run speed), in order.
  const vals = named(boostMods(boost));
  const all: Mod[] = [];
  const walk = (effs: Power['eff']) => {
    for (const x of effs ?? []) {
      all.push(...(x.m ?? []));
      walk(x.sub);
    }
  };
  walk(boost.eff);
  const isNull = (m: Mod) => m.a.every((a) => gd.attribName.get(a) === 'Null');
  const others = named(all.filter((m) => !isNull(m)));
  const holders = all.filter(isNull);
  let nextHolder = 0;
  return (boost.lh || '').replace(/\{Boost\.Attrib\.([A-Za-z]+)\.Scale\}/g, (_, g: string) => {
    const key = g.toLowerCase();
    const names = HELP_GROUPS[key] ?? [key];
    const match = (list: { name: string; v: number }[]) => list.find((x) => names.some((n) => x.name.includes(n)));
    const hit = match(vals) ?? match(others);
    if (hit) return (hit.v * 100).toFixed(1);
    const holder = holders[nextHolder++];
    // nothing carries it: say so rather than borrow another effect's number
    return holder ? (value(holder) * 100).toFixed(1) : '?';
  });
}

/**
 * The enhancement's type disc (the client's "pog", drawEnhancementOriginLevelEx): the icon of the
 * first enhancement type it allows (attrib_names Boost), drawn between the origin / invention
 * frame and the icon -- the yellow accuracy or red damage disc of an SO or IO.
 *
 * @return Texture name (no extension), or undefined when it allows no type.
 */
export function boostPog(gd: GameData, boost: Power): string | undefined {
  const v = (boost.ba ?? []).find((x) => x >= ORIGIN_COUNT);
  const name = v !== undefined ? gd.core.attribNames.Boost[v - ORIGIN_COUNT]?.icon : undefined;
  return name ? name.replace(/\.tga$/i, '') : undefined;
}

