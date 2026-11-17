/**
 * The build research: read a folder of community builds, import each with the planner's own Mids
 * importer, and write the statistics the set finder reads plus a report (docs/pipeline.md,
 * "Build research"). Run with `npm run research`; skipped unless HCP_BUILD_CORPUS names the builds.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'vitest';
import type { FinderNeed, FinderStats } from '../src/data/finderStats.ts';
import { serverById } from '../src/data/servers.ts';
import { checkBuild } from '../src/engine/validate.ts';
import { ImportProblem } from '../src/io/importProblem.ts';
import { importParsed, parseMidsText } from '../src/io/mids.ts';
import { loadData, loadMidsMapFile } from '../tests/helpers/data.ts';
import { groupBy, MIN_GROUP, needsOf, pieceUsage, setUsage, summarize } from './aggregate.ts';
import { corpusPaths, readCorpus } from './corpus.ts';
import { measure, offerFor, type BuildFacts, type Offer } from './measure.ts';
import { reportText, warningKind, type Run, type Tally } from './report.ts';

const setting = process.env.HCP_BUILD_CORPUS;

// a build with fewer powers or enhancements than this is a sketch, not a finished build
const MIN_PICKS = 12;
const MIN_ENHANCEMENTS = 20;

const bump = (t: Tally, key: string, by = 1) => t.set(key, (t.get(key) ?? 0) + by);

/** @return Why an import stopped, for the report: the importer's own reason, or a planner fault. */
function failureReason(e: unknown): string {
  if (e instanceof ImportProblem) return e.reason;
  return `planner fault: ${e instanceof Error ? e.message : String(e)}`.replace(/\d+/g, 'N');
}

describe('build research', () => {
  it.skipIf(!setting)('reads the builds and writes the finder statistics and report', async () => {
    const gd = loadData();
    const version = gd.core.manifest.dataVersion;
    const map = loadMidsMapFile(version);
    const ourDb = serverById(gd.server)?.midsDb?.toLowerCase();
    const { items, skips } = readCorpus(corpusPaths(setting));

    const offers = new Map<number, Offer>();
    const offerOf = (at: number): Offer => {
      let o = offers.get(at);
      if (!o) offers.set(at, (o = offerFor(gd, gd.archetype(at))));
      return o;
    };

    const run: Omit<Run, 'stats' | 'facts'> = {
      generated: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
      mbd: items.filter((i) => i.kind === 'mbd').length,
      codes: items.filter((i) => i.kind === 'code').length,
      skips,
      otherDb: 0,
      failures: new Map(),
      warnings: new Map(),
      warned: 0,
      imported: 0,
      lostPower: 0,
      fixes: new Map(),
      issues: new Map(),
      flagged: 0,
      sparse: 0,
      duplicates: 0,
      farm: 0,
      tags: new Map(),
      midsDb: new Map(),
    };
    const facts: BuildFacts[] = [];
    const seen = new Set<string>();

    for (const item of items) {
      let f: BuildFacts;
      try {
        const parsed = await parseMidsText(item.text);
        const built = parsed.kind === 'mbd' ? parsed.mbd.BuiltWith : undefined;
        if (built?.Database && built.Database.toLowerCase() !== ourDb) {
          run.otherDb++;
          continue;
        }
        const res = await importParsed(gd, map, parsed);
        const checked = checkBuild(gd, res.build);
        if (!checked.build) {
          bump(run.failures, `checkBuild refused it: ${checked.fixes.join('; ').replace(/\d+/g, 'N')}`);
          continue;
        }
        run.imported++;
        bump(run.midsDb, /^\d{4}/.exec(built?.DatabaseVersion ?? '')?.[0] ?? (parsed.kind === 'mbd' ? 'not stated' : 'legacy share code'));
        if (res.warnings.length) run.warned++;
        for (const w of res.warnings) {
          const { category, item: about } = warningKind(w);
          if (!run.warnings.has(category)) run.warnings.set(category, new Map());
          bump(run.warnings.get(category)!, about);
        }
        for (const fix of checked.fixes) bump(run.fixes, fix.replace(/\d+/g, 'N'));
        // a power that did not import leaves a gap in the picks, which checkBuild reads as a build
        // stopped mid-leveling. Here it is a finished build minus one power: measured at its full level
        let build = checked.build;
        if (res.build.endLevel === undefined && build.endLevel !== undefined) {
          build = { ...build, endLevel: undefined };
          run.lostPower++;
        }
        f = measure(gd, build, offerOf(build.at));
      } catch (e) {
        bump(run.failures, failureReason(e));
        continue;
      }
      if (f.issues.length) run.flagged++;
      for (const issue of new Set(f.issues)) bump(run.issues, issue);
      if (f.picks < MIN_PICKS || f.filled < MIN_ENHANCEMENTS) {
        run.sparse++;
        continue;
      }
      if (seen.has(f.signature)) {
        run.duplicates++;
        continue;
      }
      seen.add(f.signature);
      for (const tag of item.tags) bump(run.tags, tag);
      // UNCONFIRMED default (owner has not ruled): farm builds chase fire resistance and damage in
      // a way normal play does not, so they are kept out of the general values
      if (item.tags.includes('farm')) {
        run.farm++;
        continue;
      }
      facts.push(f);
    }
    if (!facts.length) throw new Error('no builds could be counted: check what HCP_BUILD_CORPUS names');

    const atName = (id: number) => gd.archetype(id).n;
    const groups: FinderStats['groups'] = { all: summarize(facts, offerOf) };
    const needs: FinderStats['needs'] = {};
    const protection = (key: string) => key.startsWith('mezprot.');
    const keepNeeds = (name: string, n: Record<string, FinderNeed>) => {
      if (Object.keys(n).length) needs[name] = n;
    };
    for (const [name, list] of groupBy(facts, (f) => [atName(f.at)])) {
      groups[name] = summarize(list, offerOf);
      if (list.length >= MIN_GROUP) keepNeeds(name, needsOf(list, protection));
    }
    for (const [name, list] of groupBy(facts, (f) => [gd.powerset(f.primary).n, gd.powerset(f.secondary).n])) {
      if (list.length >= MIN_GROUP) keepNeeds(name, needsOf(list, protection));
    }
    const stats: FinderStats = {
      v: 1,
      dataVersion: version,
      builds: facts.length,
      minGroup: MIN_GROUP,
      groups,
      needs,
      sets: setUsage(facts, (id) => gd.boostSetById.get(id)!.n, atName),
      pieces: pieceUsage(facts, (id) => gd.power(id).n),
    };

    const statsDir = join(process.cwd(), 'public', 'data', 'finder');
    mkdirSync(statsDir, { recursive: true });
    writeFileSync(join(statsDir, 'stats.json'), `${JSON.stringify(stats, null, 1)}\n`, 'utf-8');
    writeFileSync(join(process.cwd(), 'pipeline', 'report-finder.md'), reportText(gd, { ...run, facts, stats }), 'utf-8');
    console.log(`build research: ${facts.length} builds counted of ${items.length} read`);
  });
});
