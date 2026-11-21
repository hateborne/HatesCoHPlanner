/**
 * What a change to one power's slots is worth to a search, in typical bonuses.
 *
 * Four parts, added up:
 * 1. Totals: each line's change (after caps) in units of the stat, times the stat's worth.
 * 2. The power's own job: what its slotting does for its role (an attack's damage and accuracy, a
 *    heal's strength and recharge), counted as the global bonus that would do the same for the
 *    build: the change in enhancement strength, times the power's share of the build's output in
 *    that role (its share of the attacks' damage per second, of the heals' healing per second).
 * 3. A mark-down when the change guts something the power is slotted for (its output, accuracy or
 *    recharge multiplier falls by a fifth or more), whatever the search's goals.
 * 4. Needs: stats nearly every build of the archetype or power set holds (knockback protection).
 *    Falling under the typical amount is marked down; climbing toward it is marked up.
 */
import type { GameData } from '../../data/gamedata.ts';
import type { Archetype, Power } from '../../data/types.ts';
import { powerInfo, type PowerNumbers } from '../powerinfo.ts';
import type { BuildEntry } from '../rules.ts';
import type { Vec } from './bonusVec.ts';
import type { BonusRef, EntryState, FinderBase } from './core.ts';
import type { Channel, Weights } from './goals.ts';
import { rolesOf, type Aspect, type PowerRoles, type Role } from './roles.ts';

// a multiplier that falls to this share of what it was, or lower, counts as gutted
export const CRIPPLE_RATIO = 0.8;
// the mark-down for a gutted aspect: this many typical bonuses times the share lost
// UNCONFIRMED default
export const CRIPPLE_PENALTY = 10;
// what a need is worth from nothing to its typical amount, in typical bonuses
// UNCONFIRMED default
export const NEED_WEIGHT = 6;
// the least a power counts among the powers of its role, as a share of an even split: a power
// whose output the planner can't put a number on still matters
export const SHARE_FLOOR_OF_EVEN = 0.25;

// each power's unenhanced numbers by archetype and level, per game data: they depend on nothing
// else, and every search of a build (one per kept swap ticked) asks for the same ones again
const bareNumbers = new WeakMap<GameData, Map<string, PowerNumbers>>();

/**
 * A power's numbers with nothing slotted (kept after the first look).
 *
 * @param gd Game data.
 * @param at The archetype.
 * @param power The power.
 * @param level 0-based level.
 * @return Its numbers, as powerInfo gives them without slots.
 */
function bareNumbersOf(gd: GameData, at: Archetype, power: Power, level: number): PowerNumbers {
  let known = bareNumbers.get(gd);
  if (!known) bareNumbers.set(gd, (known = new Map()));
  const key = `${at.n}|${power.id}|${level}`;
  let n = known.get(key);
  if (!n) known.set(key, (n = powerInfo(gd, at, power, level, null).numbers));
  return n;
}

/** An aspect of a power that a change guts. */
export interface Crippled {
  role: Role; // the job that suffers
  aspect: Aspect; // what about it: its output, accuracy or recharge
  lost: number; // share of the multiplier lost (0.3 = 30% weaker)
  only: boolean; // the build has no other power of this role
}

/** A need a change moves. */
export interface NeedMove {
  stat: string; // the stat's totals line key
  before: number; // what the build holds
  after: number; // what it would hold
  typical: number; // what builds like it typically hold
}

/** A change to one power's slots, scored. */
export interface Scored {
  score: number; // in typical bonuses; higher is better
  lines: Vec; // the totals lines' changes, before caps
  wasted: BonusRef[]; // bonuses lost to the rule of five
  counted: Map<number, number>; // bonus power id -> change in the copies of it that count
  capped: string[]; // stats whose gain a cap cuts
  crippled: Crippled[]; // what the change guts
  needs: NeedMove[]; // needs the change takes under their typical amount, or lowers while under it
}

/** Scores changes to the powers of one build for one search. */
export class Scorer {
  private readonly roles = new Map<number, PowerRoles>(); // power id -> its roles
  private readonly counts: Record<Role, number> = { st: 0, aoe: 0, heal: 0, ctrl: 0, other: 0 }; // the build's powers per role
  private readonly shares = new Map<string, number>(); // entry key and role -> the power's share of the role's output
  private readonly acc: number; // attribute offset of Accuracy
  private readonly rech: number; // attribute offset of RechargeTime
  private readonly end: number; // attribute offset of EnduranceDiscount

  /**
   * Read the build's powers: their roles, and each one's share of its role's output.
   *
   * @param base The build.
   * @param weights What the search's goals make each stat and channel worth.
   * @param needs Stat key -> the typical amount builds like this one hold.
   */
  constructor(
    readonly base: FinderBase,
    readonly weights: Weights,
    readonly needs: ReadonlyMap<string, number>,
  ) {
    const gd = base.gd;
    this.acc = gd.attribByName.get('Accuracy') ?? 356;
    this.rech = gd.attribByName.get('RechargeTime') ?? 360;
    this.end = gd.attribByName.get('EnduranceDiscount') ?? 368;
    // each power's output per second in its roles, unenhanced: an attack's average damage or a
    // heal's hit points over its activation and recharge time (a toggle's: its activation period)
    const output = new Map<string, number>();
    const totals: Record<Role, number> = { st: 0, aoe: 0, heal: 0, ctrl: 0, other: 0 };
    for (const e of base.st.entries) {
      if (!base.rules.slottable(e.power)) continue;
      const roles = this.rolesOf(e).roles;
      const n = roles.some((r) => r.role !== 'ctrl' && r.role !== 'other') ? bareNumbersOf(gd, base.at, e.power, base.level) : undefined;
      const cycle = e.power.type === 'Click' ? (n?.cast ?? 0) + (n?.recharge.base ?? 0) : (e.power.ap ?? 0);
      for (const r of roles) {
        this.counts[r.role]++;
        const amount = r.role === 'heal' ? (n?.heal.base ?? 0) : r.role === 'st' || r.role === 'aoe' ? (n?.damage.base ?? 0) : 1;
        const perSec = r.role === 'ctrl' || r.role === 'other' ? 1 : amount / Math.max(0.5, cycle);
        output.set(`${e.key}|${r.role}`, perSec);
        totals[r.role] += perSec;
      }
    }
    for (const [key, perSec] of output) {
      const role = key.slice(key.indexOf('|') + 1) as Role;
      const even = 1 / this.counts[role];
      const share = totals[role] > 0 ? perSec / totals[role] : even;
      this.shares.set(key, Math.max(share, SHARE_FLOOR_OF_EVEN * even));
    }
  }

  /** @return A power's share of what the build's powers of a role put out (0..1). */
  shareOf(e: BuildEntry, role: Role): number {
    return this.shares.get(`${e.key}|${role}`) ?? 1 / Math.max(1, this.counts[role]);
  }

  /** @return A power's roles (kept after the first look). */
  rolesOf(e: BuildEntry): PowerRoles {
    let r = this.roles.get(e.power.id);
    if (!r) this.roles.set(e.power.id, (r = rolesOf(this.base.gd, e.power)));
    return r;
  }

  /** @return How many of the build's powers have a role. */
  roleCount(role: Role): number {
    return this.counts[role];
  }

  /**
   * Score one power going from the slotting the build has to another.
   *
   * @param e The power's entry.
   * @param from Its state as the build has it.
   * @param to Its state with the other slotting.
   * @return The score with what it was made from.
   */
  score(e: BuildEntry, from: EntryState, to: EntryState): Scored {
    const { base, weights } = this;
    const { lines, wasted, counted } = base.delta(e, from, to);
    let score = 0;

    const capped: string[] = [];
    for (const [key, change] of lines) {
      const real = base.cappedChange(key, change);
      if (change > 0 && real < change - 1e-9) capped.push(key);
      const w = (real < 0 ? weights.statLoss : weights.stat).get(key);
      const unit = weights.unit.get(key);
      if (w && unit) score += (w * real) / unit;
    }

    const roles = this.rolesOf(e);
    const running = e.level <= base.level && base.st.isOn(e);
    const crippled: Crippled[] = [];
    // over the attributes an aspect is made of: the mean change in strength, and the largest share
    // of a multiplier lost (a debuff toggle slotted for one of the three things it takes is gutted
    // when that one goes)
    const change = (attrs: number[]): { gain: number; lost: number } => {
      if (!attrs.length) return { gain: 0, lost: 0 };
      let gain = 0;
      let lost = 0;
      for (const a of attrs) {
        const s0 = from.strength.get(a) ?? 0;
        const s1 = to.strength.get(a) ?? 0;
        gain += s1 - s0;
        // (a strength of -100% or under has no multiplier left to lose a share of)
        if (1 + s0 > 1e-9) lost = Math.max(lost, 1 - (1 + s1) / (1 + s0));
      }
      return { gain: gain / attrs.length, lost };
    };
    const count = (role: Role, aspect: Aspect, attrs: number[], guard: boolean) => {
      const { gain, lost } = change(attrs);
      if (!gain) return;
      const ch: Channel = `${role}.${aspect}`;
      const w = (gain < 0 ? weights.channelLoss : weights.channel).get(ch) ?? 0;
      score += (w * gain * this.shareOf(e, role)) / weights.channelUnit[ch];
      if (guard && lost >= 1 - CRIPPLE_RATIO && !crippled.some((c) => c.aspect === aspect && aspect !== 'out')) {
        crippled.push({ role, aspect, lost, only: this.counts[role] === 1 });
        score -= CRIPPLE_PENALTY * lost;
      }
    };
    for (const r of roles.roles) {
      // a running power's buffs on its own user are already in the totals lines; one aimed at
      // enemies or allies (a debuff toggle) moves no line, so its strength counts here
      if (!(r.role === 'other' && running && roles.onSelf)) count(r.role, 'out', r.out, /*guard=*/ true);
      if (roles.acc) count(r.role, 'acc', [this.acc], /*guard=*/ true);
      if (roles.rech) count(r.role, 'rech', [this.rech], /*guard=*/ true);
      if (roles.end) count(r.role, 'end', [this.end], /*guard=*/ false);
    }

    const needs: NeedMove[] = [];
    for (const [stat, typical] of this.needs) {
      const moved = lines.get(stat);
      if (!moved || typical <= 0) continue;
      const before = base.value(stat);
      const after = before + moved;
      const held = (v: number) => Math.min(Math.max(v, 0), typical);
      score += (NEED_WEIGHT * (held(after) - held(before))) / typical;
      if (after < before && after < typical) needs.push({ stat, before, after, typical });
    }
    return { score, lines, wasted, counted, capped, crippled, needs };
  }
}

/**
 * The needs of a build: what builds of its archetype and of its two power sets nearly all hold.
 *
 * @param needs The statistics' needs, by archetype or power set internal name.
 * @param names The build's archetype, primary and secondary internal names.
 * @return Stat key -> the largest typical amount any of them asks for. Knockup protection is left
 *   to knockback's entry: the same enhancements give both.
 */
export function needsFor(needs: Record<string, Record<string, { typical: number }>>, names: string[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const name of names) {
    for (const [stat, need] of Object.entries(needs[name] ?? {})) out.set(stat, Math.max(out.get(stat) ?? 0, need.typical));
  }
  if (out.has('mezprot.Knock')) out.delete('mezprot.Knockup');
  return out;
}
