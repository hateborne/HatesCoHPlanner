/**
 * What the set finder's screens list: the bonuses a search can ask for, the set categories a
 * build's powers take, and the results grouped by set. Pure: data in, lists out.
 */
import type { GameData } from '../../data/gamedata.ts';
import type { FinderStats } from '../../data/finderStats.ts';
import type { BuildEntry } from '../rules.ts';
import { setsOfPower } from './eligible.ts';
import { familyOf, groupFor } from './goals.ts';
import { statLabel } from './labels.ts';
import type { FinderQuery, PowerPick } from './query.ts';
import type { RankedSwap } from './search.ts';

/** A bonus a search can ask for. */
export interface StatChoice {
  key: string; // the totals line key the search carries ('rech', 'def.03')
  label: string; // its name in the list
  same?: string[]; // the other keys one bonus raises with it: a search that carries one of them means this choice
}

/** Bonuses of one kind, as the search form lists them. */
export interface StatSection {
  title: string; // "Defense", "Resistance", ...
  stats: StatChoice[]; // in the totals' order
}

// stats one set bonus raises together, listed once under one key: every attack damage type, the
// six status resistances, knockback and knockup protection, the three slow resistances
const TOGETHER: { family: string; label: string; skip?: (name: string) => boolean }[] = [
  { family: 'dmg', label: 'Damage', skip: (name) => /^(heal|special|unique)/i.test(name) },
  { family: 'mezres', label: 'Status resistance' },
  { family: 'mezprot', label: 'Knockback protection' },
  { family: 'resx', label: 'Slow resistance' },
];

const SECTION_OF: Record<string, string> = {
  rech: 'Offense',
  acc: 'Offense',
  dmg: 'Offense',
  range: 'Offense',
  def: 'Defense',
  res: 'Resistance',
  hp: 'Health and endurance',
  regen: 'Health and endurance',
  heal: 'Health and endurance',
  recov: 'Health and endurance',
  endmax: 'Health and endurance',
  endrdx: 'Health and endurance',
  mezres: 'Status',
  mezprot: 'Status',
  resx: 'Status',
  run: 'Movement',
  fly: 'Movement',
  jumpspd: 'Movement',
  jumph: 'Movement',
};

const SECTIONS = ['Offense', 'Defense', 'Resistance', 'Health and endurance', 'Status', 'Movement'];

/**
 * The bonuses a search can ask for: every stat some set bonus gives the archetype (the statistics
 * carry a typical size for it), in sections.
 *
 * Stats that one bonus raises together are listed once (TOGETHER), under the first of their keys:
 * asking for one of them finds the same sets as asking for any other. The choice names the others
 * (`same`), from every archetype's statistics, so a search made on another archetype's list still
 * finds its choice here (fitQuery).
 *
 * @param gd Game data (type names).
 * @param stats The build statistics.
 * @param atName The archetype's internal name.
 * @return The sections that have a stat, in the form's order.
 */
export function bonusChoices(gd: GameData, stats: FinderStats, atName: string): StatSection[] {
  const group = groupFor(stats, atName);
  const all = stats.groups['all']?.stats ?? {};
  const keys = [...new Set([...Object.keys(all), ...Object.keys(group.stats)])].filter((k) => (group.stats[k]?.unit || all[k]?.unit || 0) > 0).sort();
  const bySection = new Map<string, StatChoice[]>();
  const listed = new Map<string, StatChoice>();
  /** The kind of bonus a key is listed as one of, if its family is listed once. */
  const togetherOf = (key: string) => {
    const fam = familyOf(key);
    const name = fam === 'dmg' ? (gd.core.attribNames.Damage[Number(key.slice(4))]?.dn ?? '') : key;
    if (fam === 'dmg' && /^heal/i.test(name)) return undefined;
    const together = TOGETHER.find((t) => t.family === fam);
    return together && !together.skip?.(name) ? together : undefined;
  };
  for (const key of keys) {
    const fam = familyOf(key);
    const healing = fam === 'dmg' && /^heal/i.test(gd.core.attribNames.Damage[Number(key.slice(4))]?.dn ?? '');
    const together = togetherOf(key);
    // a family listed once: its first key carries it, and the Special and Unique damage types are no bonus at all
    if (!healing && !together && TOGETHER.some((t) => t.family === fam)) continue;
    if (together && listed.has(fam)) continue;
    const section = SECTION_OF[healing ? 'heal' : fam];
    if (!section) continue;
    const choice: StatChoice = { key, label: together ? together.label : healing ? 'Healing' : statLabel(gd, key) };
    if (together) listed.set(fam, choice);
    bySection.set(section, [...(bySection.get(section) ?? []), choice]);
  }
  // every other key of a listed family that some archetype's list could name it by (a bonus gives it there)
  for (const g of Object.values(stats.groups)) {
    for (const key of Object.keys(g.stats)) {
      const choice = (g.stats[key]?.unit ?? 0) > 0 && togetherOf(key) ? listed.get(familyOf(key)) : undefined;
      if (choice && choice.key !== key && !choice.same?.includes(key)) (choice.same ??= []).push(key);
    }
  }
  return SECTIONS.filter((title) => bySection.has(title)).map((title) => ({ title, stats: bySection.get(title)! }));
}

/**
 * The set categories a build's powers take ("Ranged Damage", "Defense Sets"), for the search
 * form's filter.
 *
 * @param gd Game data.
 * @param entries The build's powers.
 * @return The categories, in the data's order, each once.
 */
export function setGroupsOf(gd: GameData, entries: readonly BuildEntry[]): string[] {
  const seen = new Set<string>();
  for (const e of entries) {
    if (!e.slots.length) continue;
    for (const set of setsOfPower(gd, e.power.id)) seen.add(set.grp);
  }
  const order = new Map<string, number>();
  gd.boostSets.forEach((s, i) => {
    if (!order.has(s.grp)) order.set(s.grp, i);
  });
  return [...seen].sort((a, b) => order.get(a)! - order.get(b)!);
}

/**
 * A search cut down to what the form can show for the build in hand.
 *
 * The form is kept while the pane is closed, and another build may be opened meanwhile: a wanted
 * bonus, an additional bonus or a set type the new build's lists lack would still filter the
 * search while its box shows "any". A bonus this build's list names by another key of the same
 * kind (StatChoice.same) is carried over to that key, not dropped. The powers a search is kept to
 * are cut down to those the build still has in the same place.
 *
 * @param q The search.
 * @param sections The bonuses this build's form lists (bonusChoices).
 * @param groups The set types this build's form lists (setGroupsOf).
 * @param powers The powers this build's search can go into (pickablePowers); absent: the search's powers are left as they are.
 * @return The search without what the lists lack; the same object when nothing changed.
 */
export function fitQuery(q: FinderQuery, sections: readonly StatSection[], groups: readonly string[], powers?: readonly PowerPick[]): FinderQuery {
  const choices = sections.flatMap((s) => s.stats);
  // the key this build's list has for a bonus: its own first, then one it is the same as
  const keyOf = new Map<string, string>();
  for (const c of choices) for (const k of c.same ?? []) keyOf.set(k, c.key);
  for (const c of choices) keyOf.set(c.key, c.key);
  const stat = q.main ? keyOf.get(q.main.stat) : undefined;
  const main = !q.main || stat === undefined ? undefined : stat === q.main.stat ? q.main : { ...q.main, stat };
  const extra = [...new Set(q.extra.flatMap((k) => keyOf.get(k) ?? []))].filter((k) => k !== main?.stat);
  const kept = q.groups?.filter((g) => groups.includes(g));
  const fitGroups = kept?.length ? kept : undefined;
  const sameExtra = extra.length === q.extra.length && extra.every((k, i) => k === q.extra[i]);
  const still = powers && q.powers ? q.powers.filter((x) => powers.some((y) => y.key === x.key && y.power === x.power)) : q.powers;
  const fitPowers = still?.length ? still : undefined;
  if (main === q.main && sameExtra && (fitGroups?.length ?? 0) === (q.groups?.length ?? 0) && (fitPowers?.length ?? 0) === (q.powers?.length ?? 0)) return q;
  return { ...q, main, extra, groups: fitGroups, powers: fitPowers };
}

/**
 * The powers of a build a search can go into: those with enhancement slots at the build's last level.
 *
 * @param entries The build's powers.
 * @param slottable Whether a power takes enhancements (BuildRules.slottable).
 * @param last The build's last level (0-based).
 * @return Each such power's entry key and id.
 */
export function pickablePowers(entries: readonly BuildEntry[], slottable: (p: BuildEntry['power']) => boolean, last: number): PowerPick[] {
  return entries.filter((e) => e.level <= last && slottable(e.power) && e.slots.some((s) => s.level <= last)).map((e) => ({ key: e.key, power: e.power.id }));
}

/** How the result lists are ordered. */
export type FinderSort =
  | { by: 'default' } // by rank, each set's placements folded under its best one
  | { by: 'power'; desc: boolean } // by the name of the power a swap goes into
  | { by: 'slots'; desc: boolean }; // by the number of pieces of the set the power ends up with (the list's "x4")

// the orders in the order a click on the sort label steps through them
const SORT_STEPS: FinderSort[] = [{ by: 'default' }, { by: 'power', desc: false }, { by: 'power', desc: true }, { by: 'slots', desc: false }, { by: 'slots', desc: true }];

/**
 * The order after the one shown: Default, Power A to Z, Power Z to A, fewest slots, most slots,
 * and Default again.
 *
 * @param sort The order shown.
 * @return The next one.
 */
export function nextSort(sort: FinderSort): FinderSort {
  const at = SORT_STEPS.findIndex((s) => s.by === sort.by && (s.by === 'default' || (sort.by !== 'default' && s.desc === sort.desc)));
  return SORT_STEPS[(at + 1) % SORT_STEPS.length]!;
}

/**
 * Swaps in a list's order.
 *
 * Default leaves them as ranked. By power: the name of the power each goes into, A to Z (or Z to
 * A). By slots: the pieces of the set each power ends up holding (the list's "x4"), fewest first
 * (or most first). Swaps that tie keep
 * their rank order, in either direction.
 *
 * @param gd Game data (power names).
 * @param swaps The swaps, best first.
 * @param sort The order wanted.
 * @return A new list in that order.
 */
export function sortSwaps<T extends RankedSwap>(gd: GameData, swaps: readonly T[], sort: FinderSort): T[] {
  if (sort.by === 'default') return swaps.slice();
  const sign = sort.desc ? -1 : 1;
  const name = (s: T) => gd.powerById.get(s.power)?.dn ?? '';
  const cmp = sort.by === 'power' ? (a: T, b: T) => name(a).localeCompare(name(b)) : (a: T, b: T) => a.count - b.count;
  return swaps
    .map((s, i) => ({ s, i }))
    .sort((a, b) => sign * cmp(a.s, b.s) || a.i - b.i)
    .map((x) => x.s);
}

/** One set's swaps in a result list. */
export interface SetResult {
  set: number; // BoostSet id
  best: RankedSwap; // its best placement
  others: RankedSwap[]; // its other placements, best first
}

/**
 * A search's swaps grouped by set, each set with its best placement first.
 *
 * @param swaps The ranked swaps, best first.
 * @return One entry per set, in the order of the sets' best swaps.
 */
export function bySet(swaps: readonly RankedSwap[]): SetResult[] {
  const out = new Map<number, SetResult>();
  for (const s of swaps) {
    const cur = out.get(s.set);
    if (cur) cur.others.push(s);
    else out.set(s.set, { set: s.set, best: s, others: [] });
  }
  return [...out.values()];
}
