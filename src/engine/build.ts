/**
 * The saved build: archetype, origin, sets and every pick with its slots. Everything else
 * (auto-granted powers, set bonuses, totals, validity) is derived from this by the rule modules.
 *
 * Levels are 0-based everywhere (character level 1 = 0), matching the game data.
 */

export type Alignment = 'Hero' | 'Vigilante' | 'Villain' | 'Rogue' | 'Loyalist' | 'Resistance';

export const ALIGNMENTS: Alignment[] = ['Hero', 'Vigilante', 'Villain', 'Rogue', 'Loyalist', 'Resistance'];

/** UI skin implied by an alignment (game: blue hero, red villain, Praetorian). */
export function skinOf(a: Alignment): 'hero' | 'villain' | 'praetorian' {
  if (a === 'Villain' || a === 'Rogue') return 'villain';
  if (a === 'Loyalist' || a === 'Resistance') return 'praetorian';
  return 'hero';
}

/** An enhancement placed in a slot. */
export interface SlottedEnh {
  boost: number; // enhancement power id
  ioLevel?: number; // 0-based enhancement level for IOs / set IOs (boostable or fixed)
  rel?: number; // relative level for TO/DO/SO/HO style enhancements (-3..+3), default 0
  boosters?: number; // enhancement boosters applied (0..5)
}

/** One enhancement slot on a power. */
export interface Slot {
  level: number; // 0-based character level the slot was gained (free slot = power level)
  enh?: SlottedEnh;
}

/** A chosen power with its slots. */
export interface Pick {
  power: number;
  level: number;
  slots: Slot[];
  on?: boolean; // totals toggle override (undefined = default for the power type)
}

/** Slots and totals toggle for an auto-granted power (Fitness, Brawl, AT inherent, ...). */
export interface GrantedState {
  slots: Slot[];
  on?: boolean;
}

export interface Build {
  v: 1;
  dataVersion: string;
  name: string;
  at: number; // archetype id
  origin: number; // origin id
  alignment: Alignment;
  primary: number; // powerset id
  secondary: number; // powerset id
  picks: (Pick | null)[]; // one entry per schedule.power level, in order
  granted: Record<number, GrantedState>; // keyed by power id
  exemplar?: number; // 0-based exemplar level (undefined = full level)
}

/**
 * A fresh build with no picks yet.
 *
 * @param pickCount Number of power picks in the schedule (24).
 */
export function newBuild(args: {
  dataVersion: string;
  name?: string;
  at: number;
  origin: number;
  alignment: Alignment;
  primary: number;
  secondary: number;
  pickCount: number;
}): Build {
  return {
    v: 1,
    dataVersion: args.dataVersion,
    name: args.name ?? '',
    at: args.at,
    origin: args.origin,
    alignment: args.alignment,
    primary: args.primary,
    secondary: args.secondary,
    picks: Array.from({ length: args.pickCount }, () => null),
    granted: {},
  };
}

/** Deep copy (builds are small plain objects). */
export function cloneBuild(b: Build): Build {
  return JSON.parse(JSON.stringify(b)) as Build;
}
