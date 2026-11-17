/**
 * What a search's goals are worth, stat by stat.
 *
 * Everything is counted in "typical bonuses": a stat's unit is the size of one typical set bonus
 * in it (from the build statistics), so one unit of recharge and one unit of defense are each "one
 * set bonus worth". A goal is a bundle of stats and of power channels (what a power's own slotting
 * does for a role: an attack's damage, a heal's recharge). A chosen goal counts by its importance.
 * What the search did not name still counts: a little when gained (BASELINE), and in full when
 * given up (LOSS_WEIGHT), so a swap never looks cheap for what it takes away.
 */
import { GameData } from '../../data/gamedata.ts';
import type { FinderGroup, FinderStats } from '../../data/finderStats.ts';
import { IMPORTANCE, type FinderQuery, type GoalId } from './query.ts';
import type { Aspect, Role } from './roles.ts';

// what a gain in a goal the search did not pick counts: half of Low
// UNCONFIRMED default
export const BASELINE = 0.25;
// the least a loss counts, in any goal, picked or not: as much as a Medium goal
// UNCONFIRMED default
export const LOSS_WEIGHT = 1;
// what the wanted bonus and each additional bonus add to their own stat's worth
// UNCONFIRMED defaults: the wanted bonus like two High goals, an additional one like High
export const MAIN_WEIGHT = 4;
export const EXTRA_WEIGHT = 2;
// the least a stat of a goal counts beside the goal's most used stat (defense and resistance
// types, weighed by how the archetype's builds spend on them)
export const SHARE_FLOOR = 0.25;
// one unit of a power's own output where no set bonus gives the same thing to measure it by
// (hold duration, a buff's strength): 4% enhancement
// UNCONFIRMED default: the totals carry no line for these, so the statistics have no unit for them
export const OUTPUT_UNIT = 0.04;

/** A power channel: a role and what enhancements change about it ('st.out', 'heal.rech'). */
export type Channel = `${Role}.${Aspect}`;

const ROLES: Role[] = ['st', 'aoe', 'heal', 'ctrl', 'other'];
const ASPECTS: Aspect[] = ['out', 'acc', 'rech', 'end'];

/** Every channel. */
export const CHANNELS: Channel[] = ROLES.flatMap((r) => ASPECTS.map((a): Channel => `${r}.${a}`));

/** @return The family a stat key belongs to ('def', 'res', 'dmg', 'mezres', ...), or the key itself. */
export function familyOf(key: string): string {
  const dot = key.indexOf('.');
  return dot < 0 ? key : key.slice(0, dot);
}

/** One goal: the stats and channels it is made of, each with its part (1 = counts in full). */
interface GoalDef {
  stats: Record<string, number>; // by stat key, or by family ('def', 'dmg') for every stat in it
  shares?: boolean; // weigh the family's stats by how the archetype's builds spend on them
  channels: Partial<Record<Channel, number>>; // the power channels it is made of, each with its part
}

const each = (aspect: Aspect, part: number): Partial<Record<Channel, number>> => Object.fromEntries(ROLES.map((r) => [`${r}.${aspect}`, part]));

// 'dmg' stands for the attack damage types only (see attackDamage); 'heal' for the healing bonus
const GOAL_DEFS: Record<GoalId | 'utility', GoalDef> = {
  defense: { stats: { def: 1 }, shares: true, channels: {} },
  resistance: { stats: { res: 1 }, shares: true, channels: {} },
  recharge: { stats: { rech: 1 }, channels: each('rech', 0.25) },
  stDamage: { stats: { dmg: 1, acc: 0.5, tohit: 0.5, rech: 0.5 }, channels: { 'st.out': 1, 'st.acc': 0.5, 'st.rech': 0.5 } },
  aoeDamage: { stats: { dmg: 1, acc: 0.5, tohit: 0.5, rech: 0.5 }, channels: { 'aoe.out': 1, 'aoe.acc': 0.5, 'aoe.rech': 0.5 } },
  balancedDamage: {
    stats: { dmg: 1, acc: 0.5, tohit: 0.5, rech: 0.5 },
    channels: { 'st.out': 0.5, 'st.acc': 0.25, 'st.rech': 0.25, 'aoe.out': 0.5, 'aoe.acc': 0.25, 'aoe.rech': 0.25 },
  },
  sustain: { stats: { hp: 1, regen: 1, heal: 1, absorb: 1 }, channels: { 'heal.out': 1, 'heal.rech': 1 } },
  endurance: { stats: { recov: 1, endmax: 1, endrdx: 1, enduse: 1 }, channels: each('end', 1) },
  accuracy: { stats: { acc: 1, tohit: 1 }, channels: each('acc', 0.5) },
  control: { stats: { rech: 0.25, acc: 0.25 }, channels: { 'ctrl.out': 1, 'ctrl.acc': 0.5, 'ctrl.rech': 0.5 } },
  status: { stats: { mezres: 1, mezprot: 1, resx: 1 }, channels: {} },
  movement: { stats: { run: 0.25, fly: 0.25, jumpspd: 0.25, jumph: 0.25 }, channels: {} },
  // never offered: what the other powers' own slotting is for (a buff's strength, a debuff's)
  utility: { stats: {}, channels: { 'other.out': 1 } },
};

/** What a search's goals make each stat and channel worth. */
export interface Weights {
  stat: Map<string, number>; // stat key -> worth of one unit gained
  statLoss: Map<string, number>; // stat key -> worth of one unit lost (never less than a gain's)
  unit: Map<string, number>; // stat key -> the size of one typical bonus (stats without one are absent)
  channel: Map<Channel, number>; // channel -> worth of one unit gained
  channelLoss: Map<Channel, number>; // channel -> worth of one unit lost
  channelUnit: Record<Channel, number>; // channel -> enhancement strength that makes one unit
}

/**
 * The group of builds a character's weights come from: its archetype's, or every build's when the
 * archetype has too few (Kheldians, Arachnos).
 *
 * @param stats The build statistics.
 * @param atName The archetype's internal name ('Class_Blaster').
 * @return The group.
 */
export function groupFor(stats: FinderStats, atName: string): FinderGroup {
  const own = stats.groups[atName];
  return own && own.n >= stats.minGroup ? own : (stats.groups['all'] ?? { n: 0, stats: {} });
}

/**
 * The stat a damage line key stands for in a goal: 'heal' for the Healing type (a healing bonus),
 * 'dmg' for the types attacks deal, none for the Special and Unique types.
 *
 * @param gd Game data (damage type names).
 * @param key A 'dmg.NN' key.
 * @return 'dmg', 'heal' or undefined.
 */
function damageKind(gd: GameData, key: string): 'dmg' | 'heal' | undefined {
  const name = gd.core.attribNames.Damage[Number(key.slice(4))]?.dn ?? '';
  if (/^heal/i.test(name)) return 'heal';
  return /^(special|unique)/i.test(name) ? undefined : 'dmg';
}

/**
 * The size of one typical bonus for the stats no set bonus gives, from a stat that does the same
 * job.
 *
 * @param key The stat key.
 * @param unit The units known so far.
 * @param baseToHit The archetype's base ToHit (0.75 for players).
 * @return The unit, or undefined when there is nothing to go by.
 */
function borrowedUnit(key: string, unit: Map<string, number>, baseToHit: number): number | undefined {
  // the chance to hit is (base ToHit + to-hit - defense) x (1 + accuracy) (CalcToHit): a typical
  // accuracy bonus does what that much x the base ToHit does as to-hit
  if (key === 'tohit') return unit.has('acc') ? unit.get('acc')! * baseToHit : undefined;
  // endurance per second: recovery is a share of 100 endurance every 60 seconds
  if (key === 'enduse') return unit.has('recov') ? (unit.get('recov')! * 100) / 60 : undefined;
  if (key === 'absorb') return unit.get('hp');
  return undefined;
}

/**
 * Work out what each stat and channel is worth to a search.
 *
 * 1. A stat's unit is the typical bonus size in the archetype's group, else in every build's.
 * 2. A goal gives a stat its part, divided among the stats one bonus raises together (an "all
 *    damage" bonus counts once, not once per type; a defense or resistance bonus covers two types
 *    as a rule, so each type counts half). Defense and resistance types are also weighed by the
 *    share of set-bonus spend the archetype's builds give them, against the most used type.
 * 3. A stat's worth is the sum over the chosen goals of importance x part, plus BASELINE x its
 *    largest part in any goal, plus MAIN_WEIGHT / EXTRA_WEIGHT when it is a bonus the search names.
 *    A unit lost counts at least LOSS_WEIGHT x that largest part.
 *
 * @param gd Game data.
 * @param stats The build statistics.
 * @param atName The archetype's internal name.
 * @param q The search.
 * @return The weights.
 */
export function weightsFor(gd: GameData, stats: FinderStats, atName: string, q: FinderQuery): Weights {
  const group = groupFor(stats, atName);
  const all = stats.groups['all']?.stats ?? {};
  const unit = new Map<string, number>();
  for (const key of new Set([...Object.keys(all), ...Object.keys(group.stats)])) {
    const u = group.stats[key]?.unit || all[key]?.unit;
    if (u) unit.set(key, u);
  }
  const at = gd.archetypeByName.get(atName.toLowerCase());
  const baseToHit = at ? GameData.attrAt(at.base, 'ToHit', 49, 0.75) : 0.75;
  for (const key of ['tohit', 'enduse', 'absorb']) {
    const u = unit.has(key) ? undefined : borrowedUnit(key, unit, baseToHit);
    if (u) unit.set(key, u);
  }

  // the name a goal knows each stat by, and how many stats share one bonus
  const goalStat = (key: string): string | undefined => {
    const fam = familyOf(key);
    if (fam === 'dmg') return damageKind(gd, key);
    return fam === 'max' ? undefined : fam === key ? key : fam;
  };
  const inFamily = new Map<string, number>();
  for (const key of unit.keys()) {
    const g = goalStat(key);
    if (g) inFamily.set(g, (inFamily.get(g) ?? 0) + 1);
  }
  const spread = (name: string): number => (name === 'def' || name === 'res' ? 0.5 : 1 / (inFamily.get(name) ?? 1));
  const topShare = new Map<string, number>();
  for (const key of unit.keys()) {
    const g = goalStat(key);
    if (g) topShare.set(g, Math.max(topShare.get(g) ?? 0, group.stats[key]?.share ?? 0));
  }
  const part = (def: GoalDef, key: string): number => {
    const name = goalStat(key);
    const p = name ? (def.stats[name] ?? 0) : 0;
    if (!p) return 0;
    const top = topShare.get(name!) ?? 0;
    const byShare = def.shares && top > 0 ? Math.max(SHARE_FLOOR, (group.stats[key]?.share ?? 0) / top) : 1;
    return p * spread(name!) * byShare;
  };

  const chosen = q.goals.map((g) => ({ def: GOAL_DEFS[g.goal], importance: IMPORTANCE[g.importance] }));
  const defs = Object.values(GOAL_DEFS);
  const stat = new Map<string, number>();
  const statLoss = new Map<string, number>();
  for (const key of unit.keys()) {
    const most = Math.max(0, ...defs.map((d) => part(d, key)));
    let w = BASELINE * most;
    for (const c of chosen) w += c.importance * part(c.def, key);
    if (q.main?.stat === key) w += MAIN_WEIGHT;
    if (q.extra.includes(key)) w += EXTRA_WEIGHT;
    if (!w) continue;
    stat.set(key, w);
    statLoss.set(key, Math.max(w, LOSS_WEIGHT * most));
  }
  const channel = new Map<Channel, number>();
  const channelLoss = new Map<Channel, number>();
  for (const ch of CHANNELS) {
    const most = Math.max(0, ...defs.map((d) => d.channels[ch] ?? 0));
    let w = BASELINE * most;
    for (const c of chosen) w += c.importance * (c.def.channels[ch] ?? 0);
    if (!w) continue;
    channel.set(ch, w);
    channelLoss.set(ch, Math.max(w, LOSS_WEIGHT * most));
  }

  // a channel's unit: the global bonus that does the same for every power
  const firstUnit = (test: (key: string) => boolean): number | undefined => [...unit].find(([key]) => test(key))?.[1];
  const damage = firstUnit((key) => familyOf(key) === 'dmg' && damageKind(gd, key) === 'dmg') ?? OUTPUT_UNIT;
  const healing = firstUnit((key) => familyOf(key) === 'dmg' && damageKind(gd, key) === 'heal') ?? OUTPUT_UNIT;
  const outUnit: Record<Role, number> = { st: damage, aoe: damage, heal: healing, ctrl: OUTPUT_UNIT, other: OUTPUT_UNIT };
  const aspectUnit: Record<Exclude<Aspect, 'out'>, number> = {
    acc: unit.get('acc') ?? OUTPUT_UNIT,
    rech: unit.get('rech') ?? OUTPUT_UNIT,
    end: unit.get('endrdx') ?? OUTPUT_UNIT,
  };
  const channelUnit = Object.fromEntries(
    ROLES.flatMap((r) => ASPECTS.map((a) => [`${r}.${a}`, a === 'out' ? outUnit[r] : aspectUnit[a]])),
  ) as Record<Channel, number>;
  return { stat, statLoss, unit, channel, channelLoss, channelUnit };
}
