/**
 * The build research's report (pipeline/report-finder.md): what was read, how the import held up,
 * and the statistics in readable tables for the owner's sign-off. Aggregates only: no file names
 * and no build names.
 */
import type { GameData } from '../src/data/gamedata.ts';
import type { FinderGroup, FinderStats } from '../src/data/finderStats.ts';
import { setRarity } from '../src/engine/enhance.ts';
import { statLabel } from '../src/engine/finder/labels.ts';
import { MIN_GROUP } from './aggregate.ts';
import type { CorpusSkips } from './corpus.ts';
import { family, type BuildFacts } from './measure.ts';

/** Counts by name. */
export type Tally = Map<string, number>;

/** Everything one research run found, for the report. */
export interface Run {
  generated: string; // ISO date and time of the run
  mbd: number; // .mbd files read
  codes: number; // share codes read from text files and pages
  skips: CorpusSkips; // files left out while reading
  otherDb: number; // builds made on another server's Mids database
  failures: Tally; // builds that could not be imported, by reason
  warnings: Map<string, Tally>; // import warnings: category -> item -> count
  warned: number; // builds imported with at least one warning
  imported: number; // builds imported
  lostPower: number; // imported builds missing a picked power the importer could not place
  fixes: Tally; // checkBuild repairs, numbers blanked
  issues: Tally; // rule issues the planner flags, by message: builds showing it
  flagged: number; // builds with at least one issue
  sparse: number; // builds too empty to count
  duplicates: number; // builds dropped as copies of another
  tags: Tally; // builds per file-name tag
  midsDb: Tally; // builds per Mids database year
  facts: BuildFacts[]; // the builds counted
  stats: FinderStats; // what was written to stats.json
}

/**
 * Sort an import warning into a category and the thing it is about.
 *
 * @param w The warning text (importMbd).
 * @return The category and the item (a game name, already made readable by the importer).
 */
export function warningKind(w: string): { category: string; item: string } {
  let m = /an enhancement \((.+)\) isn't in the planner's game data/.exec(w);
  if (m) return { category: 'an enhancement is not in the game data', item: m[1]! };
  m = /^(.+) isn't in the planner's game data, so it was left out$/.exec(w);
  if (m) return { category: 'a power is not in the game data', item: m[1]! };
  m = /^(.+) was taken at level \S+, which has no free power pick/.exec(w);
  if (m) return { category: "no free power pick at the power's level", item: m[1]! };
  m = /^A power couldn't be identified(?: \((.+)\))?/.exec(w);
  if (m) return { category: 'a power in a legacy code could not be identified', item: m[1] ?? '(unnamed)' };
  return { category: 'other', item: w.replace(/\d+/g, 'N') };
}

const FAMILY: Record<string, string> = {
  move: 'Movement',
  def: 'Defense',
  res: 'Damage resistance',
  dmg: 'Damage',
  mezres: 'Status resistance',
  mezprot: 'Status protection',
  resx: 'Debuff resistance',
  max: 'Cap raises',
};

export { statLabel };

const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
const num = (v: number) => (Math.abs(v) >= 10 ? v.toFixed(1) : v.toFixed(2));

// stats the totals keep as plain amounts (hit points, endurance points, protection magnitude, feet)
const PLAIN = new Set(['hp', 'endmax', 'absorb', 'stealth', 'enduse']);

/** @return A stat's value as the totals show it: a plain amount, or a percentage. */
function amount(key: string, v: number): string {
  return PLAIN.has(key) || family(key) === 'mezprot' ? num(v) : pct(v);
}

/** @return A markdown table. */
function table(head: string[], rows: (string | number)[][]): string {
  if (!rows.length) return '_None._\n';
  return [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`, ...rows.map((r) => `| ${r.join(' | ')} |`)].join('\n') + '\n';
}

/** @return A tally's rows, largest first, at most `top`. */
function tallyRows(t: Tally, top = 1000): [string, number][] {
  return [...t].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'en')).slice(0, top);
}

/** A group's stats added up by family: the share spent, the share offered and the lift. */
function familyRows(g: FinderGroup): { fam: string; share: number; offered: number }[] {
  const acc = new Map<string, { share: number; offered: number }>();
  for (const [key, s] of Object.entries(g.stats)) {
    const a = acc.get(family(key)) ?? { share: 0, offered: 0 };
    a.share += s.share;
    a.offered += s.lift ? s.share / s.lift : 0;
    acc.set(family(key), a);
  }
  return [...acc].map(([fam, a]) => ({ fam, ...a })).sort((a, b) => b.share - a.share);
}

/**
 * Write the report.
 *
 * @param gd Game data.
 * @param run What the run found.
 * @return The report as markdown (ASCII).
 */
export function reportText(gd: GameData, run: Run): string {
  const out: string[] = [];
  const all = run.stats.groups.all!;
  const atDn = (n: string) => gd.archetypeByName.get(n.toLowerCase())?.dn ?? n;
  const famName = (f: string) => FAMILY[f] ?? statLabel(gd, f);
  const failed = [...run.failures.values()].reduce((a, v) => a + v, 0);

  out.push(`# Build research report -- data ${run.stats.dataVersion}\n`);
  out.push(`Generated ${run.generated} (UTC) by \`npm run research\`. Aggregates only; the builds themselves stay on the machine that ran it.\n`);

  out.push('## What was read\n');
  out.push(
    table(
      ['Item', 'Count'],
      [
        ['.mbd files', run.mbd],
        ['Share codes in text files and saved pages', run.codes],
        ['Files over the size limit (left out)', run.skips.tooBig],
        ['Text files and pages with no share code', run.skips.noCode],
        ['Other files (left alone)', run.skips.otherFiles],
        ["Made on another server's Mids database (left out)", run.otherDb],
        ['Could not be imported', failed],
        ['Imported', run.imported],
        ['Imported without a picked power that could not be placed (counted without it)', run.lostPower],
        ['Too empty to count (under 12 powers or 20 enhancements)', run.sparse],
        ['Copies of another build (left out)', run.duplicates],
        ['**Builds counted**', `**${run.facts.length}**`],
      ],
    ),
  );
  out.push('Builds by file-name tag (a build can carry several):\n');
  out.push(table(['Tag', 'Builds'], tallyRows(run.tags)));
  out.push('Builds by Mids database year:\n');
  out.push(table(['Year', 'Builds'], [...run.midsDb].sort((a, b) => a[0].localeCompare(b[0], 'en'))));

  out.push('## Import check\n');
  out.push(`Every build was imported against ${run.stats.dataVersion} with the planner's own Mids importer. ${run.imported - run.warned} of ${run.imported} imported with no warning.\n`);
  out.push('### Builds that could not be imported\n');
  out.push(table(['Reason', 'Builds'], tallyRows(run.failures, 40)));
  for (const [cat, items] of run.warnings) {
    const total = [...items.values()].reduce((a, v) => a + v, 0);
    out.push(`### Warning: ${cat} (${total})\n`);
    out.push(table(['Item', 'Times'], tallyRows(items, 25)));
  }
  out.push('### Repairs by checkBuild\n');
  out.push(table(['Repair', 'Times'], tallyRows(run.fixes, 25)));
  out.push(`### Rule issues the planner flags (${run.flagged} builds)\n`);
  out.push('A Mids build can break a game rule Mids does not check, so these are leads to look into, not proven planner faults.\n');
  out.push(table(['Issue', 'Builds'], tallyRows(run.issues, 30)));

  out.push('## Builds counted, by archetype\n');
  out.push(
    table(
      ['Archetype', 'Builds', 'Note'],
      Object.entries(run.stats.groups)
        .filter(([k]) => k !== 'all')
        .sort((a, b) => b[1].n - a[1].n)
        .map(([k, g]) => [atDn(k), g.n, g.n < MIN_GROUP ? `under ${MIN_GROUP}: uses the all-archetype values` : '']),
    ),
  );

  out.push('## Stat values, all archetypes\n');
  out.push(
    'Share: the mean share of a build\'s set bonuses spent on the stat, counted in typical bonuses. Offered: the stat\'s share of every set bonus in the game. Lift = share / offered: over 1 means builds seek the stat out.\n',
  );
  out.push(
    table(
      ['Stat', 'Share', 'Offered', 'Lift'],
      familyRows(all)
        .filter((r) => r.share > 0 || r.offered > 0)
        .map((r) => [famName(r.fam), pct(r.share), pct(r.offered), r.offered ? (r.share / r.offered).toFixed(2) : '-']),
    ),
  );
  for (const fam of ['def', 'res']) {
    out.push(`### ${famName(fam)}, type by type\n`);
    out.push(
      table(
        ['Stat', 'Share', 'Lift', 'Typical bonus', 'Median total', 'Median from set bonuses'],
        Object.entries(all.stats)
          .filter(([k, s]) => family(k) === fam && (s.share > 0 || s.total > 0))
          .sort((a, b) => b[1].share - a[1].share)
          .map(([k, s]) => [statLabel(gd, k), pct(s.share), s.lift.toFixed(2), pct(s.unit), pct(s.total), pct(s.bonus)]),
      ),
    );
  }
  out.push('### Everything else\n');
  out.push(
    table(
      ['Stat', 'Share', 'Lift', 'Typical bonus', 'Median total', 'Median from set bonuses'],
      Object.entries(all.stats)
        .filter(([k, s]) => !['def', 'res', 'dmg'].includes(family(k)) && s.share > 0)
        .sort((a, b) => b[1].share - a[1].share)
        .map(([k, s]) => [statLabel(gd, k), pct(s.share), s.lift.toFixed(2), amount(k, s.unit), amount(k, s.total), amount(k, s.bonus)]),
    ),
  );

  out.push('## Stat values by archetype\n');
  out.push('Share of set-bonus spend by stat family, largest first (lift in brackets).\n');
  out.push(
    table(
      ['Archetype', 'Builds', 'Top families'],
      Object.entries(run.stats.groups)
        .filter(([k]) => k !== 'all')
        .sort((a, b) => b[1].n - a[1].n)
        .map(([k, g]) => [
          atDn(k),
          g.n,
          familyRows(g)
            .slice(0, 6)
            .map((r) => `${famName(r.fam)} ${pct(r.share)} (${r.offered ? (r.share / r.offered).toFixed(2) : '-'})`)
            .join(', '),
        ]),
    ),
  );

  out.push('## Needs: status protection added with enhancements\n');
  out.push('Share of a group\'s builds whose enhancements (set bonuses, globals or the pieces themselves) add protection, where at least half do.\n');
  const groupDn = (n: string) => gd.archetypeByName.get(n.toLowerCase())?.dn ?? gd.setByName.get(n.toLowerCase())?.dn ?? n;
  const kind = (n: string) => (gd.archetypeByName.has(n.toLowerCase()) ? 'Archetype' : (n.split('.')[0] ?? '').replace(/_/g, ' '));
  out.push(
    table(
      ['Group', 'Kind', 'Stat', 'Builds adding it', 'Typical amount'],
      Object.entries(run.stats.needs)
        .flatMap(([g, needs]) => Object.entries(needs).map(([k, n]) => ({ g, k, n })))
        .filter((r) => r.n.share >= 0.5)
        .sort((a, b) => kind(a.g).localeCompare(kind(b.g), 'en') || b.n.share - a.n.share)
        .map((r) => [groupDn(r.g), kind(r.g), statLabel(gd, r.k), pct(r.n.share), amount(r.k, r.n.typical)]),
    ),
  );

  out.push('## Sets\n');
  const setOf = (n: string) => gd.boostSets.find((s) => s.n === n)!;
  const tier = (n: string) => setRarity(setOf(n))?.name ?? '?';
  const sets = Object.entries(run.stats.sets).sort((a, b) => b[1].builds - a[1].builds);
  out.push('The 40 sets most often slotted for a bonus (2 or more pieces in one power).\n');
  out.push(
    table(
      ['Set', 'Rarity', 'Category', 'Builds', 'x2', 'x3', 'x4', 'x5', 'x6'],
      sets.slice(0, 40).map(([n, s]) => [setOf(n).dn, tier(n), setOf(n).grp, pct(s.builds), ...s.pieces]),
    ),
  );
  const byTier = new Map<string, number>();
  for (const [n, s] of sets) byTier.set(tier(n), (byTier.get(tier(n)) ?? 0) + s.pieces.reduce((a, v) => a + v, 0));
  const uses = [...byTier.values()].reduce((a, v) => a + v, 0);
  out.push('Set placements by rarity:\n');
  out.push(table(['Rarity', 'Placements', 'Share'], tallyRows(byTier).map(([t, c]) => [t, c, pct(c / uses)])));
  out.push(`Sets no counted build slots for a bonus: ${gd.boostSets.length - sets.length} of ${gd.boostSets.length}.\n`);

  out.push('## Unique pieces\n');
  out.push('Pieces whose own global effect a build earns, by share of builds.\n');
  out.push(
    table(
      ['Piece', 'Builds'],
      Object.entries(run.stats.pieces)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 30)
        .map(([n, v]) => [gd.powerByName.get(n.toLowerCase())?.dn ?? n, pct(v)]),
    ),
  );

  out.push('## Slotting habits\n');
  const sum = (f: (x: BuildFacts) => number) => run.facts.reduce((a, x) => a + f(x), 0);
  const filled = sum((f) => f.filled);
  const setPieces = sum((f) => f.attuned + f.crafted);
  const kinds = new Map<string, number>();
  const levels = new Map<string, number>();
  for (const f of run.facts) {
    for (const [k, v] of Object.entries(f.kinds)) kinds.set(k, (kinds.get(k) ?? 0) + (v ?? 0));
    for (const [l, v] of Object.entries(f.ioLevels)) levels.set(l, (levels.get(l) ?? 0) + v);
  }
  out.push(
    table(
      ['Measure', 'Value'],
      [
        ['Slots per build (mean)', (sum((f) => f.slots) / run.facts.length).toFixed(1)],
        ['Slots left empty', pct(1 - filled / sum((f) => f.slots))],
        ['Set pieces that are attuned', pct(sum((f) => f.attuned) / setPieces)],
        ['Enhancements carrying boosters', pct(sum((f) => f.boosted) / filled)],
        ['Bonus copies lost to the rule of 5, per build (mean)', (sum((f) => f.over5) / run.facts.length).toFixed(2)],
        ['Builds slotting at least one proc', pct(run.facts.filter((f) => f.procs.length).length / run.facts.length)],
        ['Procs per build (mean)', (sum((f) => f.procs.length) / run.facts.length).toFixed(1)],
      ],
    ),
  );
  out.push('Enhancements by family:\n');
  out.push(table(['Family', 'Share'], tallyRows(kinds).map(([k, v]) => [k, pct(v / filled)])));
  out.push('Crafted set pieces by level (the 8 most used):\n');
  out.push(table(['Level', 'Share'], tallyRows(levels, 8).map(([l, v]) => [l, pct(v / sum((f) => f.crafted))])));

  return out.join('\n');
}
