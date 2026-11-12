/**
 * Moving a build to another game patch: the few swaps that make picks and slots legal again.
 *
 * Only used when an import is moved to a patch it wasn't made on, and only after the user agrees
 * to the listed changes (the planner never edits a build behind the user's back). Nothing is
 * removed: powers trade places, slots trade the levels they were gained at, and whatever still
 * breaks a rule afterwards stays flagged.
 */
import type { GameData } from '../data/gamedata.ts';
import { slotsFor } from './actions.ts';
import { cloneBuild, type Build, type Pick } from './build.ts';
import { BuildRules, type Issue } from './rules.ts';

/** The result of fitting a build to a patch's data. */
export interface FitResult {
  build: Build; // the build with the swaps made (the input is not changed)
  changes: string[]; // one line per change, "before -> after", for the confirm and the overview
  remaining: Issue[]; // what still breaks a rule after the swaps
}

/** @return The 0-based pick issues of a build (prerequisites, levels; not slot or build issues). */
function pickIssues(gd: GameData, b: Build): Set<number> {
  const out = new Set<number>();
  for (const i of new BuildRules(gd, b).issues()) {
    const m = /^pick:(\d+)$/.exec(i.key);
    if (m && i.slot === undefined && i.message !== 'Too many slots') out.add(Number(m[1]));
  }
  return out;
}

/**
 * Swap what two picks hold (power, slots, on/off) while each pick keeps its own level.
 *
 * @param gd Game data (pick levels come from its schedule).
 * @param b The build (not changed).
 * @param i One pick index.
 * @param j The other pick index (may be empty).
 * @return A new build.
 */
function swapPicks(gd: GameData, b: Build, i: number, j: number): Build {
  const nb = cloneBuild(b);
  const at = (k: number, p: Pick | null): Pick | null => {
    if (!p) return null;
    const level = gd.core.schedule.power[k] ?? p.level;
    const slots = p.slots.map((s, si) => (si === 0 ? { ...s, level } : s));
    return { ...p, level, slots };
  };
  const a = nb.picks[i] ?? null;
  const c = nb.picks[j] ?? null;
  nb.picks[i] = at(i, c);
  nb.picks[j] = at(j, a);
  return nb;
}

/** @return The items of a that b doesn't account for (multiset difference, order kept). */
function minus(a: number[], b: number[]): number[] {
  const rest = [...b];
  return a.filter((x) => {
    const i = rest.indexOf(x);
    if (i < 0) return true;
    rest.splice(i, 1);
    return false;
  });
}

/** @return "21, 23" for 0-based levels [20, 22]. */
function levelList(levels: number[]): string {
  return levels.map((l) => l + 1).join(', ');
}

/**
 * Move picks that the patch no longer allows at their level.
 *
 * Picks are walked from level 1 up. A flagged pick trades places with the first later pick whose
 * power is legal at the flagged pick's level, provided the trade lowers the number of flagged
 * picks (so a fix never breaks more than it mends). A pick with no such partner stays flagged.
 *
 * @param gd The target patch's data.
 * @param b The build, already imported against that data.
 * @return The build after the trades, and one line per moved power.
 */
function fitPicks(gd: GameData, b: Build): { build: Build; changes: string[] } {
  let cur = b;
  let bad = pickIssues(gd, cur);
  for (let k = 0; k < cur.picks.length && bad.size; k++) {
    if (!bad.has(k)) continue;
    for (let j = k + 1; j < cur.picks.length; j++) {
      const next = swapPicks(gd, cur, k, j);
      const nbad = pickIssues(gd, next);
      if (!nbad.has(k) && nbad.size < bad.size) {
        cur = next;
        bad = nbad;
        break;
      }
    }
  }
  const was = new Map<number, number>();
  b.picks.forEach((p) => p && was.set(p.power, p.level));
  const changes: string[] = [];
  cur.picks.forEach((p) => {
    const before = p ? was.get(p.power) : undefined;
    if (p && before !== undefined && before !== p.level) changes.push(`${gd.power(p.power).dn}: level ${before + 1} -> ${p.level + 1}`);
  });
  return { build: cur, changes };
}

/**
 * Re-date slots that a moved power now holds from before it was taken.
 *
 * A slot below its power's level trades the level it was gained at with a slot on another power
 * that may take it: the partner's slot is at or above this power's level, and this slot's level
 * is at or above the partner's power level. The closest partner level wins. Each level keeps the
 * same number of slots, every enhancement stays on its power, and each power's slots stay in
 * level order (so the enhancements keep their places in the ring row).
 *
 * @param gd The target patch's data.
 * @param b The build after fitPicks.
 * @return The build after the trades, and one line per power whose slot levels changed.
 */
function fitSlots(gd: GameData, b: Build): { build: Build; changes: string[] } {
  const rules = new BuildRules(gd, b);
  const entries = rules.entries().filter((e) => e.slots.length > 1);
  const levels = new Map(entries.map((e) => [e.key, e.slots.slice(1).map((s) => s.level)]));
  const owner = new Map(entries.map((e) => [e.key, e.level]));
  const before = new Map([...levels].map(([k, v]) => [k, [...v]]));
  for (const e of entries) {
    const mine = levels.get(e.key)!;
    for (let si = 0; si < mine.length; si++) {
      const l = mine[si]!;
      if (l >= e.level || rules.slotsAnyPower(l)) continue;
      let best: { key: string; idx: number; level: number } | undefined;
      for (const [key, theirs] of levels) {
        if (key === e.key || l < owner.get(key)!) continue;
        theirs.forEach((m, idx) => {
          if (m >= e.level && (!best || m < best.level)) best = { key, idx, level: m };
        });
      }
      if (!best) continue;
      mine[si] = best.level;
      levels.get(best.key)![best.idx] = l;
    }
  }
  const nb = cloneBuild(b);
  const changes: string[] = [];
  for (const e of entries) {
    const old = before.get(e.key)!;
    const now = [...levels.get(e.key)!].sort((x, y) => x - y);
    if (now.every((l, i) => l === old[i])) continue;
    const ref = slotsFor(nb, e.key);
    if (!ref) continue;
    const slots = ref.slots.length ? ref.slots : e.slots;
    ref.set([{ ...slots[0]!, level: e.level }, ...slots.slice(1).map((s, i) => ({ ...s, level: now[i]! }))]);
    changes.push(`${e.power.dn} slots: levels ${levelList(minus(old, now))} -> ${levelList(minus(now, old))}`);
  }
  return { build: nb, changes };
}

/**
 * Fit an imported build to the patch it is being moved to.
 *
 * 1. Picks the patch doesn't allow at their level trade places with later picks (fitPicks).
 * 2. Slots that now sit below their power's level trade levels with slots elsewhere (fitSlots).
 *
 * @param gd The target patch's data.
 * @param b The build, imported against that data.
 * @return The fitted build, the changes made (before -> after), and what is still flagged.
 */
export function fitToPatch(gd: GameData, b: Build): FitResult {
  const picks = fitPicks(gd, b);
  const slots = fitSlots(gd, picks.build);
  return { build: slots.build, changes: [...picks.changes, ...slots.changes], remaining: new BuildRules(gd, slots.build).issues() };
}
