/**
 * The exact gains and losses between a build and the same build with other enhancements in its
 * slots: both builds' full totals, and the own numbers of each power whose slots changed. This is
 * what a hovered swap and the final summary show; the search's ranking uses the quick figures.
 */
import type { GameData } from '../../data/gamedata.ts';
import type { Build, Slot } from '../build.ts';
import type { BuildRules } from '../rules.ts';
import { computeTotals, type StatLine, type Totals } from '../totals.ts';
import { DEFENSE_SOFT_CAP } from './core.ts';
import { damageTypesDealt } from './dealt.ts';
import { damageKind } from './goals.ts';
import { slottedNumbers } from './powerNumbers.ts';
import { isDamageProc, procFigures } from './procs.ts';

/** One figure before and after. */
export interface DiffRow {
  key: string; // a totals line key ('rech', 'def.03', 'hp'), a power figure ('damage', 'recharge'), or a proc ('proc:<boost>:<type>')
  label: string; // the totals' own label for the line, or the figure's name
  before: number; // the figure in the build as it is, held at its cap
  after: number; // the figure with the other enhancements, held at its cap
  lowerIsBetter: boolean; // endurance use, a recharge time, a cost
  rawBefore?: number; // the figure before its cap, when the build as it is holds more than the cap
  rawAfter?: number; // the same with the other enhancements
  atCap?: boolean; // with the other enhancements the figure is at its cap or past it (defense: the soft cap)
  wasAtCap?: boolean; // the same for the build as it is
  softCap?: boolean; // the cap is a soft one (defense's 45%): more still counts against enemies with more ToHit
  unused?: boolean; // a damage bonus of a type none of the build's powers deal
}

/** The changed figures of one power. */
export interface PowerDiff {
  key: string; // the power's entry key
  power: number; // its id
  slotted: boolean; // its own slots change (false: only its procs' rate moves, with the build's recharge)
  gains: DiffRow[]; // its own figures that get better
  losses: DiffRow[]; // its own figures that get worse
}

/** Everything a change of enhancements moves. */
export interface BuildDiff {
  gains: DiffRow[]; // totals that get better, in the totals' order
  losses: DiffRow[]; // totals that get worse
  powers: PowerDiff[]; // the powers whose slots changed, with their own figures, and those whose procs' rate moves
}

// the totals lines shown through a figure worked out from them, as the totals panel shows them
// (`raw`: the same figure before its cap)
const DERIVED: Record<string, { label: string; of: (t: Totals) => number; raw?: (t: Totals) => number; lowerIsBetter?: boolean }> = {
  hp: { label: 'Max HP', of: (t) => t.hpMax, raw: (t) => t.hpRaw },
  endmax: { label: 'Max End', of: (t) => t.endMax },
  regen: { label: 'Regeneration', of: (t) => t.regenPerSec, raw: (t) => t.regenPerSecRaw },
  recov: { label: 'Recovery', of: (t) => t.recovPerSec, raw: (t) => t.recovPerSecRaw },
  enduse: { label: 'Endurance use', of: (t) => t.endUsePerSec, lowerIsBetter: true },
  run: { label: 'Running Speed', of: (t) => t.speeds.run },
  fly: { label: 'Flying Speed', of: (t) => t.speeds.fly },
  jumpspd: { label: 'Jumping Speed', of: (t) => t.speeds.jump },
  jumph: { label: 'Max Jump Height', of: (t) => t.speeds.jumpHeight },
  perc: { label: 'Perception', of: (t) => t.perception },
};

// smallest change worth a row
const EPSILON = 1e-9;
// how far past its cap a derived figure must be to count as over it (the totals panel's own margin)
const OVER = 1e-6;

/**
 * @return Whether a row is a gain (true), a loss (false) or no change (undefined). A figure that
 *   stays at its cap on both sides is judged by what it holds past the cap.
 */
function isGain(r: DiffRow): boolean | undefined {
  let d = r.after - r.before;
  if (Math.abs(d) <= EPSILON) d = (r.rawAfter ?? r.after) - (r.rawBefore ?? r.before);
  if (Math.abs(d) <= EPSILON) return undefined;
  return r.lowerIsBetter ? d < 0 : d > 0;
}

/** @return A totals line's value when it is past the line's cap, else undefined. */
function pastCap(l: StatLine | undefined): number | undefined {
  return l && l.cap !== undefined && l.value > l.cap + EPSILON ? l.value : undefined;
}

/** @return Rows split into gains and losses, unchanged rows dropped. */
function split(rows: DiffRow[]): { gains: DiffRow[]; losses: DiffRow[] } {
  return { gains: rows.filter((r) => isGain(r) === true), losses: rows.filter((r) => isGain(r) === false) };
}

/** @return Whether two slot lists hold the same enhancements. */
function sameSlots(a: readonly Slot[], b: readonly Slot[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((s, i) => {
    const x = s.enh;
    const y = b[i]!.enh;
    if (!x || !y) return !x && !y;
    return x.boost === y.boost && x.ioLevel === y.ioLevel && (x.rel ?? 0) === (y.rel ?? 0) && (x.boosters ?? 0) === (y.boosters ?? 0);
  });
}

/**
 * Compare a build with the same build re-slotted.
 *
 * 1. Totals: every line after its cap, and the figures the totals panel works out from lines
 *    (max HP, regeneration and recovery per second, endurance use, speeds). Cap raises and the
 *    "all defense" helper line are left out. A figure past its cap also carries what it holds
 *    before the cap, and a row is kept when only that moves. Defense has no cap to show: it is
 *    marked at the soft cap (DEFENSE_SOFT_CAP). A damage bonus of a type none of the build's
 *    powers deal is marked unused (damageTypesDealt), unless a pet's damage can't be read.
 * 2. Powers: for each power whose slots differ, its average damage, heal, accuracy, endurance cost
 *    and recharge time (with the build's global recharge, each side's own), and each damage proc
 *    it holds on either side: its damage a minute (procFigures). A click power whose slots stay
 *    is listed too when the build's recharge moves and it holds a damage proc: the proc fires
 *    more or less often.
 *
 * Both sides are worked out at the build's last level, as the search is (FinderBase), whatever
 * exemplar level the build is set to show.
 *
 * @param gd Game data.
 * @param rules Rules of the build as it is.
 * @param after The build with other enhancements in its slots (same powers, same slots).
 * @param dealt The damage types the build's powers deal (damageTypesDealt), when the caller has
 *   them already: they are the same for every re-slotting of one build.
 * @return The gains and losses.
 */
export function buildDiff(gd: GameData, rules: BuildRules, after: Build, dealt: ReadonlySet<number> | null = damageTypesDealt(gd, rules)): BuildDiff {
  const afterRules = rules.reslotted(after);
  const level = rules.lastLevel();
  const t0 = computeTotals(gd, rules, rules.b, level);
  const t1 = computeTotals(gd, afterRules, after, level);

  const rows: DiffRow[] = [];
  for (const key of new Set([...t0.lines.keys(), ...t1.lines.keys()])) {
    if (key === 'def.base' || key.startsWith('max.')) continue;
    const derived = DERIVED[key];
    const l0 = t0.lines.get(key);
    const l1 = t1.lines.get(key);
    const label = derived?.label ?? l1?.label ?? l0?.label ?? key;
    const of = derived ? derived.of : (t: Totals) => t.lines.get(key)?.capped ?? 0;
    const r: DiffRow = { key, label, before: of(t0), after: of(t1), lowerIsBetter: !!derived?.lowerIsBetter };
    const raw = derived?.raw;
    if (raw) {
      const past = (t: Totals) => (raw(t) > derived.of(t) + OVER ? raw(t) : undefined);
      r.rawBefore = past(t0);
      r.rawAfter = past(t1);
      // max HP has a cap of its own to stand at; regeneration and recovery only show when past theirs
      const hpCap = key === 'hp' ? l1?.cap : undefined;
      r.atCap = r.rawAfter !== undefined || (hpCap !== undefined && raw(t1) >= hpCap - OVER);
      r.wasAtCap = r.rawBefore !== undefined || (hpCap !== undefined && raw(t0) >= hpCap - OVER);
    } else if (!derived) {
      r.rawBefore = pastCap(l0);
      r.rawAfter = pastCap(l1);
      const at = (l: StatLine | undefined) => (key.startsWith('def.') ? (l?.value ?? 0) >= DEFENSE_SOFT_CAP - EPSILON : !!l && l.cap !== undefined && l.value >= l.cap - EPSILON);
      r.atCap = at(l1);
      r.wasAtCap = at(l0);
      if (key.startsWith('def.')) r.softCap = true;
    }
    if (dealt && key.startsWith('dmg.') && damageKind(gd, key) === 'dmg' && !dealt.has(Number(key.slice(4)))) r.unused = true;
    rows.push(r);
  }

  const before = new Map(rules.entries().map((e) => [e.key, e]));
  const rech0 = t0.lines.get('rech')?.capped ?? 0;
  const rech1 = t1.lines.get('rech')?.capped ?? 0;
  const holdsProc = (slots: readonly Slot[]) =>
    slots.some((s) => {
      // an enhancement the data doesn't know holds no proc
      const boost = s.enh ? gd.powerById.get(s.enh.boost) : undefined;
      return !!boost && isDamageProc(gd, boost);
    });
  const powers: PowerDiff[] = [];
  for (const e of afterRules.entries()) {
    const was = before.get(e.key);
    if (!was) continue;
    const changed = !sameSlots(was.slots, e.slots);
    // a click's procs fire more or less often when the build's recharge moves, though its own slots stay
    if (!changed && !(Math.abs(rech1 - rech0) > EPSILON && e.power.type === 'Click' && holdsProc(e.slots))) continue;
    const a = slottedNumbers(gd, rules.at, e.power, was.slots, t0.level, rech0);
    const b = slottedNumbers(gd, rules.at, e.power, e.slots, t1.level, rech1);
    const own: DiffRow[] = [];
    const row = (key: string, label: string, x: number, y: number, lowerIsBetter = false) => own.push({ key, label, before: x, after: y, lowerIsBetter });
    if (changed) {
      if (a.damage.base) row('damage', 'Average damage', a.damage.enh, b.damage.enh);
      if (a.heal.base) row('heal', 'Heal', a.heal.enh, b.heal.enh);
      if (a.accuracy.base) row('accuracy', 'Accuracy', a.accuracy.enh, b.accuracy.enh);
      if (a.recharge.base) row('recharge', 'Recharge time', a.rechargeGlobal, b.rechargeGlobal, /*lowerIsBetter=*/ true);
      if (a.endurance.base) row('endurance', 'Endurance cost', a.endurance.enh, b.endurance.enh, /*lowerIsBetter=*/ true);
    }
    // each damage proc on either side: its damage a minute, named with the rate it has where it is
    // slotted (two of one proc and type in a power are one row: their rates and damage added up)
    const sum = (slots: readonly Slot[], level: number, n: typeof a) => {
      const by = new Map<string, { type: number; perMin: number; damage: number }>();
      for (const f of procFigures(gd, rules.at, e.power, slots, level, n)) {
        const key = `proc:${f.boost}:${f.type}`;
        const cur = by.get(key);
        if (cur) by.set(key, { type: f.type, perMin: cur.perMin + f.perMin, damage: cur.damage + f.damage });
        else by.set(key, { type: f.type, perMin: f.perMin, damage: f.damage });
      }
      return by;
    };
    const procs0 = sum(was.slots, t0.level, a);
    const procs1 = sum(e.slots, t1.level, b);
    for (const key of new Set([...procs0.keys(), ...procs1.keys()])) {
      const x = procs0.get(key);
      const y = procs1.get(key);
      const shown = (y ?? x)!;
      const type = (gd.core.attribNames.Damage[shown.type]?.dn ?? 'Proc').replace(/_/g, ' ');
      row(key, `${type} Damage (Proc, ${shown.perMin.toFixed(1)}/min)`, x?.damage ?? 0, y?.damage ?? 0);
    }
    const parts = split(own);
    if (changed || parts.gains.length || parts.losses.length) powers.push({ key: e.key, power: e.power.id, slotted: changed, ...parts });
  }
  return { ...split(rows), powers };
}
