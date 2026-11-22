/**
 * The exact gains and losses between a build and the same build with other enhancements in its
 * slots: both builds' full totals, and the own numbers of each power whose slots changed. This is
 * what a hovered swap and the final summary show; the search's ranking uses the quick figures.
 */
import type { GameData } from '../../data/gamedata.ts';
import type { Build, Slot } from '../build.ts';
import type { BuildRules } from '../rules.ts';
import { computeTotals, type Totals } from '../totals.ts';
import { slottedNumbers } from './powerNumbers.ts';

/** One figure before and after. */
export interface DiffRow {
  key: string; // a totals line key ('rech', 'def.03', 'hp'), or a power figure ('damage', 'recharge')
  label: string; // the totals' own label for the line, or the figure's name
  before: number; // the figure in the build as it is
  after: number; // the figure with the other enhancements
  lowerIsBetter: boolean; // endurance use, a recharge time, a cost
}

/** The changed figures of one power. */
export interface PowerDiff {
  key: string; // the power's entry key
  power: number; // its id
  gains: DiffRow[]; // its own figures that get better
  losses: DiffRow[]; // its own figures that get worse
}

/** Everything a change of enhancements moves. */
export interface BuildDiff {
  gains: DiffRow[]; // totals that get better, in the totals' order
  losses: DiffRow[]; // totals that get worse
  powers: PowerDiff[]; // the powers whose slots changed, with their own figures
}

// the totals lines shown through a figure worked out from them, as the totals panel shows them
const DERIVED: Record<string, { label: string; of: (t: Totals) => number; lowerIsBetter?: boolean }> = {
  hp: { label: 'Max HP', of: (t) => t.hpMax },
  endmax: { label: 'Max End', of: (t) => t.endMax },
  regen: { label: 'Regeneration', of: (t) => t.regenPerSec },
  recov: { label: 'Recovery', of: (t) => t.recovPerSec },
  enduse: { label: 'Endurance use', of: (t) => t.endUsePerSec, lowerIsBetter: true },
  run: { label: 'Running Speed', of: (t) => t.speeds.run },
  fly: { label: 'Flying Speed', of: (t) => t.speeds.fly },
  jumpspd: { label: 'Jumping Speed', of: (t) => t.speeds.jump },
  jumph: { label: 'Max Jump Height', of: (t) => t.speeds.jumpHeight },
  perc: { label: 'Perception', of: (t) => t.perception },
};

// smallest change worth a row
const EPSILON = 1e-9;

/** @return Whether a row is a gain (true), a loss (false) or no change (undefined). */
function isGain(r: DiffRow): boolean | undefined {
  const d = r.after - r.before;
  if (Math.abs(d) <= EPSILON) return undefined;
  return r.lowerIsBetter ? d < 0 : d > 0;
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
 *    "all defense" helper line are left out.
 * 2. Powers: for each power whose slots differ, its average damage, heal, accuracy, endurance cost
 *    and recharge time (with the build's global recharge, each side's own).
 *
 * Both sides are worked out at the build's last level, as the search is (FinderBase), whatever
 * exemplar level the build is set to show.
 *
 * @param gd Game data.
 * @param rules Rules of the build as it is.
 * @param after The build with other enhancements in its slots (same powers, same slots).
 * @param before The totals of the build as it is, at its last level, when the caller has them
 *   already (a screen comparing one build with many: half the work of each comparison).
 * @return The gains and losses.
 */
export function buildDiff(gd: GameData, rules: BuildRules, after: Build, before?: Totals): BuildDiff {
  const afterRules = rules.reslotted(after);
  const level = rules.lastLevel();
  const t0 = before ?? computeTotals(gd, rules, rules.b, level);
  const t1 = computeTotals(gd, afterRules, after, level);

  const rows: DiffRow[] = [];
  for (const key of new Set([...t0.lines.keys(), ...t1.lines.keys()])) {
    if (key === 'def.base' || key.startsWith('max.')) continue;
    const derived = DERIVED[key];
    const label = derived?.label ?? t1.lines.get(key)?.label ?? t0.lines.get(key)?.label ?? key;
    const of = derived ? derived.of : (t: Totals) => t.lines.get(key)?.capped ?? 0;
    rows.push({ key, label, before: of(t0), after: of(t1), lowerIsBetter: !!derived?.lowerIsBetter });
  }

  const entries = new Map(rules.entries().map((e) => [e.key, e]));
  const powers: PowerDiff[] = [];
  for (const e of afterRules.entries()) {
    const was = entries.get(e.key);
    if (!was || sameSlots(was.slots, e.slots)) continue;
    const a = slottedNumbers(gd, rules.at, e.power, was.slots, t0.level, t0.lines.get('rech')?.capped ?? 0);
    const b = slottedNumbers(gd, rules.at, e.power, e.slots, t1.level, t1.lines.get('rech')?.capped ?? 0);
    const own: DiffRow[] = [];
    const row = (key: string, label: string, x: number, y: number, lowerIsBetter = false) => own.push({ key, label, before: x, after: y, lowerIsBetter });
    if (a.damage.base) row('damage', 'Average damage', a.damage.enh, b.damage.enh);
    if (a.heal.base) row('heal', 'Heal', a.heal.enh, b.heal.enh);
    if (a.accuracy.base) row('accuracy', 'Accuracy', a.accuracy.enh, b.accuracy.enh);
    if (a.recharge.base) row('recharge', 'Recharge time', a.rechargeGlobal, b.rechargeGlobal, /*lowerIsBetter=*/ true);
    if (a.endurance.base) row('endurance', 'Endurance cost', a.endurance.enh, b.endurance.enh, /*lowerIsBetter=*/ true);
    powers.push({ key: e.key, power: e.power.id, ...split(own) });
  }
  return { ...split(rows), powers };
}
