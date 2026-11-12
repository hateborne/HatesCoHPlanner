/**
 * The saved build: archetype, origin, sets and every pick with its slots. Everything else
 * (auto-granted powers, set bonuses, totals, validity) is derived from this by the rule modules.
 *
 * Levels are 0-based everywhere (character level 1 = 0), matching the game data.
 */
import { DEFAULT_SERVER } from '../data/servers.ts';

/**
 * Hero, Villain or Praetorian. The game's finer alignments change nothing a build can take (no
 * power or set requirement reads them), so Vigilante counts as Hero, Rogue as Villain and
 * Loyalist / Resistance as Praetorian.
 */
export type Alignment = 'Hero' | 'Villain' | 'Praetorian';

export const ALIGNMENTS: Alignment[] = ['Hero', 'Villain', 'Praetorian'];

/**
 * Fold any alignment name (ours, a Mids one, or one saved before the alignments were condensed)
 * into the three the planner uses.
 *
 * @param a Alignment name, any case; unknown or missing names count as Hero.
 * @return Hero, Villain or Praetorian.
 */
export function toAlignment(a: string | undefined): Alignment {
  switch ((a ?? '').toLowerCase()) {
    case 'villain':
    case 'rogue':
      return 'Villain';
    case 'praetorian':
    case 'loyalist':
    case 'resistance':
      return 'Praetorian';
    default:
      return 'Hero';
  }
}

/** Longest build name (the New Build screen's name field allows as many). */
export const NAME_MAX = 40;

// control characters, and the invisible ones that flip or hide text (bidi overrides and
// isolates, zero-width spaces and joiners, the byte-order mark): a crafted name or file could
// use them to make the planner's own messages read differently than they are
// eslint-disable-next-line no-control-regex -- matching control characters is the point
const HIDDEN_CHARS = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/g;

/** @return Text with control and invisible formatting characters removed. */
export function stripHidden(text: string): string {
  return text.replace(HIDDEN_CHARS, '');
}

/**
 * A build name as the planner keeps and shows it: plain text, at most NAME_MAX characters.
 *
 * @param name The name a build, link or file carries (anything: it comes from outside).
 * @return The name, or '' when it isn't text.
 */
export function cleanName(name: unknown): string {
  return typeof name === 'string' ? stripHidden(name).slice(0, NAME_MAX) : '';
}

/** UI skin implied by an alignment (game: blue hero, red villain, Praetorian). */
export function skinOf(a: string): 'hero' | 'villain' | 'praetorian' {
  const n = toAlignment(a);
  return n === 'Villain' ? 'villain' : n === 'Praetorian' ? 'praetorian' : 'hero';
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
  server?: string; // the game server it is for (servers.ts); absent: Homecoming (every build before servers)
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
  endLevel?: number; // 0-based level a build planned short of 50 stops at (View Build / Save mid-leveling)
  respecTo?: number; // Respec build type: the 0-based level it respecs to (absent: built by leveling)
}

/**
 * A fresh build with no picks yet.
 *
 * @param args.server The game server's id; Homecoming's (or none) leaves the field out.
 * @param args.pickCount Number of power picks in the schedule (24).
 */
export function newBuild(args: {
  server?: string;
  dataVersion: string;
  name?: string;
  at: number;
  origin: number;
  alignment: Alignment;
  primary: number;
  secondary: number;
  pickCount: number;
  respecTo?: number;
}): Build {
  const r = args.respecTo;
  return {
    v: 1,
    ...(args.server && args.server !== DEFAULT_SERVER ? { server: args.server } : {}),
    dataVersion: args.dataVersion,
    name: args.name ?? '',
    at: args.at,
    origin: args.origin,
    alignment: args.alignment,
    primary: args.primary,
    secondary: args.secondary,
    picks: Array.from({ length: args.pickCount }, () => null),
    granted: {},
    // a respec short of 50 ends there, like a build stopped while leveling
    ...(r !== undefined ? { respecTo: r, endLevel: r < 49 ? r : undefined } : {}),
  };
}

/** Deep copy (builds are small plain objects). */
export function cloneBuild(b: Build): Build {
  return JSON.parse(JSON.stringify(b)) as Build;
}
