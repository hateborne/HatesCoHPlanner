/**
 * Enhancements: what a power accepts, how strong a slotted enhancement is, and Enhancement
 * Diversification. Ported from boost.c (power_IsValidBoost, boost_Effectiveness),
 * character_mods.c (boost magnitude) and character_attribs.c (AggregateStrength / ED).
 */
import type { GameData } from '../data/gamedata.ts';
import type { Archetype, DimReturnSet, Mod, Power } from '../data/types.ts';
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

/** @return The mods of an enhancement that strengthen the power it is slotted in. */
export function boostMods(boost: Power): Mod[] {
  const out: Mod[] = [];
  const walk = (effs: Power['eff']) => {
    for (const e of effs ?? []) {
      if (e.ch !== undefined && e.ch < 1) continue;
      if (e.ppm) continue;
      for (const m of e.m ?? []) {
        if (m.asp === 'Strength' && (m.fl?.includes('Boost') ?? true)) out.push(m);
      }
      walk(e.sub);
    }
  };
  walk(boost.eff);
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

/** IO set level range as 0-based enhancement levels (boostsets.bin stores 1-based levels). */
export function setLevelRange(set: { minL: number; maxL: number }): [number, number] {
  return [Math.max(0, set.minL - 1), Math.max(0, set.maxL - 1)];
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
