/**
 * The build a search starts from, read once, and the quick way to tell what other enhancements in
 * one power's slots would change in its totals.
 *
 * The full totals take several milliseconds a build, too slow to work out for every candidate. A
 * change to one power's slots only moves three things, each cheap to work out again with the
 * totals' own functions: what that power adds while it runs (runningLines), the bonuses its slots
 * earn (earnedBonuses, then the rule of five against the rest of the build), and what the running
 * toggles cost (the power's own slotted endurance reduction, and every toggle's when a bonus
 * changes the character's endurance discount). Everything else is read from the totals worked out
 * once.
 */
import { GameData } from '../../data/gamedata.ts';
import type { Archetype, BoostSet, Power } from '../../data/types.ts';
import type { Build, Slot } from '../build.ts';
import { powerStrength } from '../enhance.ts';
import type { BuildEntry, BuildRules } from '../rules.ts';
import { earnedBonuses, RULE_OF_FIVE } from '../setbonus.ts';
import { computeTotals, lineCap, runningLines, totalsMemo, totalsState, workingPieces, type Totals, type TotalsState } from '../totals.ts';
import { addLines, BonusVecs, type Vec } from './bonusVec.ts';

// Defense past this buys nothing against an enemy of the character's level: its base chance to hit
// is 50%, and the final chance never goes under 5% (CalcToHit, character_combat.c)
export const DEFENSE_SOFT_CAP = 0.45;

/** One bonus a power's slots earn. */
export interface BonusRef {
  power: Power; // the bonus power
  global: boolean; // a unique piece's own global, not a set bonus
  set: BoostSet; // the set whose pieces earn it
}

/** One power read with one slotting. */
export interface EntryState {
  slots: Slot[]; // the slotting it was read with
  working: number[]; // ids of its pieces whose own effects can count (workingPieces), for a power that runs
  strength: Map<number, number>; // enhancement strength by attribute, after ED
  lines: Vec; // what the power adds to the totals lines while it runs (empty for a power that doesn't)
  bonuses: Map<string, { ref: BonusRef; copies: number }>; // the bonuses its slots earn, by bonus power and kind
  discount: number; // its slotted endurance reduction
}

/** What changing one power's slots does to the totals lines. */
export interface LineDelta {
  lines: Vec; // change per line key, before caps
  wasted: BonusRef[]; // bonuses the new slots earn that the rule of five throws away
  counted: Map<number, number>; // bonus power id -> change in the copies of it that count (after the rule of five)
}

/**
 * A build as a search reads it.
 *
 * Everything is worked out at the build's last level (its stop level, else 50), whatever exemplar
 * level the build is set to show: sets are bought for the whole build, and at an exemplar level a
 * piece too high to work would look worthless and be the first one swapped out.
 */
export class FinderBase {
  readonly at: Archetype; // the build's archetype
  readonly st: TotalsState; // the totals state the quick figures are worked out against
  readonly totals: Totals; // the build's full totals, worked out once
  readonly vecs: BonusVecs; // what each bonus adds, kept per search
  readonly level: number; // 0-based level the totals are worked out at: the build's last level
  readonly last: number; // the build's last level: slotting is judged there
  private readonly copies = new Map<number, number>(); // bonus power id -> copies the build earns
  private readonly endDiscount: number; // attribute offset of EnduranceDiscount
  // the running toggles: entry key -> base cost per second and slotted endurance reduction
  private readonly toggles = new Map<string, { perSec: number; discount: number }>();
  private readonly running: BuildEntry[] = []; // the powers that run, in the totals' order
  private readonly place = new Map<string, number>(); // entry key -> index in `running`
  // enhancement id -> indexes (ascending) of the running powers holding it as a working piece
  private readonly holders = new Map<number, number[]>();
  private readonly hpRoom: number; // hit points set bonuses and powers can add before the cap
  private readonly caps = new Map<string, number | undefined>(); // line key -> its cap, kept after the first look

  /**
   * Read a build: its totals, which powers run, and what each holds.
   *
   * @param gd Game data.
   * @param rules Rules of the build.
   * @param build The build.
   */
  constructor(
    readonly gd: GameData,
    readonly rules: BuildRules,
    readonly build: Build,
  ) {
    this.at = rules.at;
    this.last = rules.lastLevel();
    this.level = this.last;
    this.st = totalsState(gd, rules, build, this.level);
    this.totals = computeTotals(gd, rules, build, this.level, this.st);
    // from here on the same powers are read over and over with other slots
    this.st.memo = totalsMemo();
    this.vecs = new BonusVecs(gd, this.at, this.level, this.st.ctx);
    for (const bn of this.totals.bonuses) this.copies.set(bn.power.id, (this.copies.get(bn.power.id) ?? 0) + 1);
    this.endDiscount = gd.attribByName.get('EnduranceDiscount') ?? 368;
    for (const e of this.st.entries) {
      if (!this.st.isOn(e)) continue;
      const at = this.running.length;
      this.running.push(e);
      this.place.set(e.key, at);
      for (const id of new Set(workingPieces(gd, this.st, e.slots))) {
        const list = this.holders.get(id);
        if (list) list.push(at);
        else this.holders.set(id, [at]);
      }
    }
    for (const e of this.st.entries) {
      const p = e.power;
      if (p.type !== 'Toggle' || !p.end || !p.ap || !this.st.isOn(e)) continue;
      const usable = e.slots.filter((s) => s.level <= this.level).map((s) => s.enh);
      const discount = powerStrength(gd, this.at, p, usable, this.level, this.st.memo?.strength).post.get(this.endDiscount) ?? 0;
      this.toggles.set(e.key, { perSec: p.end / p.ap, discount });
    }
    this.hpRoom = GameData.attrAt(this.at.maxMax, 'HitPoints', this.level) - this.totals.hpBase;
  }

  /**
   * Read one power with a slotting.
   *
   * @param e The power's entry in the build.
   * @param slots The slots to read it with.
   * @return Its state.
   */
  state(e: BuildEntry, slots: Slot[]): EntryState {
    const lines: Vec = new Map();
    let strength: Map<number, number>;
    let working: number[] = [];
    const at = this.place.get(e.key);
    if (at !== undefined) {
      working = workingPieces(this.gd, this.st, slots);
      // a piece an earlier running power holds gives its own effects there, not here
      const earlier = working.filter((id) => (this.holders.get(id)?.[0] ?? at) < at);
      const run = runningLines(this.gd, this.at, this.st, { power: e.power, slots }, earlier);
      addLines(lines, run.lines);
      strength = run.strength;
    } else {
      const usable = slots.filter((s) => s.level <= this.level).map((s) => s.enh);
      strength = powerStrength(this.gd, this.at, e.power, usable, this.level, this.st.memo?.strength).post;
    }
    const bonuses: EntryState['bonuses'] = new Map();
    for (const bn of earnedBonuses(this.gd, [{ ...e, slots }], this.level)) {
      const key = `${bn.power.id}${bn.global ? 'g' : 's'}`;
      const cur = bonuses.get(key);
      if (cur) cur.copies++;
      else bonuses.set(key, { ref: { power: bn.power, global: bn.global, set: bn.set }, copies: 1 });
    }
    return { slots, working, strength, lines, bonuses, discount: strength.get(this.endDiscount) ?? 0 };
  }

  /**
   * What the totals lines gain or lose when one power goes from the slotting the build has to
   * another.
   *
   * 1. The power's own lines: the new slotting's minus the old one's. A piece's own effects count
   *    once however many running powers hold it, in the first that does: when this power gains or
   *    loses such a piece and a later one holds it too, that one stops or starts giving them.
   * 2. Its bonuses: for each bonus power, the copies that count go from min(total, 5) to
   *    min(total - old copies + new copies, 5); the difference times what one copy adds.
   * 3. The running toggles' cost per second: each costs its base cost over 1 + the character's
   *    endurance discount + its own slotted reduction (see computeTotals), so the power's new
   *    slotting moves its own cost and a changed discount bonus moves every toggle's.
   *
   * @param e The power's entry.
   * @param from Its state as the build has it (the totals were worked out with it).
   * @param to Its state with the other slotting.
   * @return The change per line, before caps, and the bonuses lost to the rule of five.
   */
  delta(e: BuildEntry, from: EntryState, to: EntryState): LineDelta {
    const lines: Vec = new Map();
    for (const [key, v] of to.lines) lines.set(key, v);
    for (const [key, v] of from.lines) lines.set(key, (lines.get(key) ?? 0) - v);

    const at = this.place.get(e.key);
    if (at !== undefined) {
      const was = new Set(from.working);
      const now = new Set(to.working);
      for (const id of new Set([...from.working, ...to.working])) {
        if (was.has(id) === now.has(id)) continue;
        const held = this.holders.get(id) ?? [];
        if (held.some((i) => i < at)) continue;
        const next = held.find((i) => i > at);
        if (next === undefined) continue;
        const other = this.running[next]!;
        const all = runningLines(this.gd, this.at, this.st, other);
        const without = runningLines(this.gd, this.at, this.st, other, [id]);
        // taken out here: the later power gives the piece's effects from now on; put in here: it stops
        const sign = was.has(id) ? 1 : -1;
        addLines(lines, all.lines, sign);
        addLines(lines, without.lines, -sign);
      }
    }

    const wasted: BonusRef[] = [];
    const counted = new Map<number, number>();
    // per bonus power, whichever way its copies are earned (as a set bonus or as a piece's own
    // global): the rule of five counts the power's copies together
    const earned = new Map<number, { ref: BonusRef; was: number; now: number }>();
    for (const [side, bonuses] of [
      ['was', from.bonuses],
      ['now', to.bonuses],
    ] as const) {
      for (const b of bonuses.values()) {
        let m = earned.get(b.ref.power.id);
        if (!m) earned.set(b.ref.power.id, (m = { ref: b.ref, was: 0, now: 0 }));
        m[side] += b.copies;
        if (side === 'now') m.ref = b.ref;
      }
    }
    for (const { ref, was, now } of earned.values()) {
      const total = this.copies.get(ref.power.id) ?? 0;
      const next = total - was + now;
      const more = Math.min(next, RULE_OF_FIVE) - Math.min(total, RULE_OF_FIVE);
      addLines(lines, this.vecs.of(ref.power, ref.global), more);
      if (more) counted.set(ref.power.id, (counted.get(ref.power.id) ?? 0) + more);
      if (now > was && next > RULE_OF_FIVE) wasted.push(ref);
    }

    const moved = lines.get('endrdx') ?? 0;
    if (this.toggles.size && (moved || (this.toggles.has(e.key) && to.discount !== from.discount))) {
      const global = this.value('endrdx');
      let change = 0;
      for (const [key, t] of this.toggles) {
        const now = t.perSec / Math.max(0.01, 1 + global + t.discount);
        const next = t.perSec / Math.max(0.01, 1 + global + moved + (key === e.key ? to.discount : t.discount));
        change += next - now;
      }
      // the line holds what the toggles drain, as a negative number
      lines.set('enduse', (lines.get('enduse') ?? 0) - change);
    }
    for (const [key, v] of lines) if (Math.abs(v) < 1e-12) lines.delete(key);
    return { lines, wasted, counted };
  }

  /** @return A totals line's value in the build, before its cap (0 for a line the build lacks). */
  value(key: string): number {
    return this.totals.lines.get(key)?.value ?? 0;
  }

  /**
   * The most a totals line can usefully hold: the archetype's cap (resistance, damage, recharge,
   * the room left for hit points) or the defense soft cap.
   *
   * @param key The line's key.
   * @return The cap in the line's unit, or undefined for a line without one.
   */
  cap(key: string): number | undefined {
    if (this.caps.has(key)) return this.caps.get(key);
    const cap = key.startsWith('def.') ? DEFENSE_SOFT_CAP : key === 'hp' ? this.hpRoom : lineCap(this.at, key, this.level);
    this.caps.set(key, cap);
    return cap;
  }

  /**
   * What a change to a line is worth once its cap is counted: nothing past the cap.
   *
   * @param key The line's key.
   * @param change The change, before caps.
   * @return The change in the capped value.
   */
  cappedChange(key: string, change: number): number {
    const cap = this.cap(key);
    if (cap === undefined) return change;
    const before = this.value(key);
    return Math.min(before + change, cap) - Math.min(before, cap);
  }
}
