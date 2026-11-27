/**
 * The local build check: a few thousand real builds, read on this machine only, to see whether a
 * change to the planner alters what it makes of any of them.
 *
 * It reads the folder of community builds the build research reads (HCP_BUILD_CORPUS) and takes a
 * record of each build: the build as imported and checked, its share link, the build the link
 * opens as, and every figure the screens show of it, each as a digest.
 *
 *   npx vitest run --config tests/localbuildsbaseline.config.ts   on main: writes the record
 *   npx vitest run --config tests/localbuilds.config.ts           on the branch: compares with it
 *
 * The record stays in .localbuilds/ (never committed) and holds digests only: no file name, no
 * build name, no path. A difference names builds by the digest of their text. To see the figures
 * behind one, set HCP_LOCALBUILDS_DUMP to a folder outside the repository (and HCP_LOCALBUILDS_IDS
 * to the digests wanted, separated by commas; none: the builds that differ) on both checkouts, and
 * compare the files. `npm test` never runs this file: it is no test file by name, and CI has no
 * such folder.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { expect, inject, it, vi } from 'vitest';

// brotli-wasm's default (web) build fetches its .wasm, which Node can't: use its Node build
vi.mock('brotli-wasm', async () => {
  const { createRequire } = await import('node:module');
  const pkg: unknown = createRequire(import.meta.url)('brotli-wasm');
  return { default: Promise.resolve(pkg) };
});
import { corpusPaths, readCorpus } from '../research/corpus.ts';
import { HENCHMEN_FOLDER, type GameData } from '../src/data/gamedata.ts';
import { serverById } from '../src/data/servers.ts';
import { checkBuild } from '../src/engine/validate.ts';
import { ImportProblem } from '../src/io/importProblem.ts';
import { importParsed, parseMidsText, type MidsMap } from '../src/io/mids.ts';
import { decodeShare, encodeShare } from '../src/io/share.ts';
import { buildDigest } from './helpers/corpus.ts';
import { dataDir, loadData, loadMidsMapFile, withHenchmen } from './helpers/data.ts';
import { digest, flatten } from './helpers/golden.ts';
import { buildRecord } from './helpers/goldenbuilds.ts';
import { localChanges, type LocalEntry, type LocalRecord } from './helpers/localbuilds.ts';

declare module 'vitest' {
  /** What a vitest config hands its tests: only tests/localbuildsbaseline.config.ts sets this one. */
  export interface ProvidedContext {
    localBaseline: boolean; // write the record this run takes as the baseline, where a run would compare with it
  }
}

// whether this run writes the baseline. Only the baseline config says so.
const WRITE = inject('localBaseline') === true;
// the folders and files of builds, as the build research names them
const SETTING = process.env.HCP_BUILD_CORPUS;
// where the baseline is kept: in the repository's folder, so it is there on main and on a branch, and ignored by git
const BASELINE = join(process.cwd(), '.localbuilds', 'baseline.json');
// a folder to write the full record of some builds to (none: nothing is dumped), and which builds
const DUMP_DIR = dumpDir();
const DUMP_IDS = (process.env.HCP_LOCALBUILDS_IDS ?? '').split(',').map((id) => id.trim()).filter(Boolean);
// how many builds a difference lists before it only counts the rest
const MOST_LISTED = 20;

/**
 * The folder named for a dump, when one is.
 *
 * @return Its full path, or undefined when HCP_LOCALBUILDS_DUMP is not set.
 * @throws When the folder is inside the repository: the builds are not ours to commit.
 */
function dumpDir(): string | undefined {
  const named = process.env.HCP_LOCALBUILDS_DUMP;
  if (!named) return undefined;
  const inside = relative(process.cwd(), resolve(named));
  if (!inside.startsWith('..') && !isAbsolute(inside)) throw new Error('HCP_LOCALBUILDS_DUMP must name a folder outside the repository');
  return resolve(named);
}

/** @return The commit the planner is at, with "+ changes" when files are changed besides. */
function commitNow(): string {
  const git = (...args: string[]) => execFileSync('git', args, { encoding: 'utf-8' }).trim();
  return `${git('rev-parse', '--short', 'HEAD')}${git('status', '--porcelain') ? ' + changes' : ''}`;
}

/**
 * Take the record of one build.
 *
 * @param gd The default server's default game version, with its optional files.
 * @param map That version's Mids map.
 * @param text The build as it was found: a .mbd file's text or a Mids share code.
 * @param lines Called with the build's every figure, a line each, for a dump.
 * @return The entry, or undefined for a build made for another server's Mids database (not ours to read).
 */
async function entryOf(gd: GameData, map: MidsMap, text: string, lines: (all: string[]) => void): Promise<LocalEntry | undefined> {
  try {
    const parsed = await parseMidsText(text);
    const database = parsed.kind === 'mbd' ? parsed.mbd.BuiltWith?.Database : undefined;
    if (database && database.toLowerCase() !== serverById(gd.server)?.midsDb?.toLowerCase()) return undefined;
    const imported = await importParsed(gd, map, parsed);
    const checked = checkBuild(gd, imported.build);
    if (!checked.build) return { problem: `refused: ${digest(checked.fixes)}` };
    const link = await encodeShare(checked.build);
    const all = flatten(buildRecord(gd, checked.build, /*withIssues=*/ false));
    lines(all);
    return {
      build: buildDigest(checked.build),
      link: digest([link]),
      reopened: buildDigest(checkBuild(gd, await decodeShare(link)).build),
      numbers: digest(all),
      notes: digest([...imported.warnings, '--', ...checked.fixes]),
    };
  } catch (error) {
    // what went wrong is kept as its kind and a digest of its words: the words may name the build
    const kind = error instanceof ImportProblem ? 'import problem' : 'planner fault';
    return { problem: `${kind}: ${digest([error instanceof Error ? error.message : String(error)])}` };
  }
}

/**
 * Take the record of every build in the folder.
 *
 * @param dumpOnly The builds to dump the figures of, by the digest of their text (none: no dump).
 * @return The record, and how many builds were for another server's database.
 */
async function recordNow(dumpOnly: ReadonlySet<string>): Promise<{ record: LocalRecord; other: number }> {
  const gd = loadData();
  if (existsSync(join(dataDir(), HENCHMEN_FOLDER, `${gd.core.manifest.dataVersion}.json`))) withHenchmen(gd);
  const map = loadMidsMapFile(gd.core.manifest.dataVersion);
  const entries: Record<string, LocalEntry> = {};
  let other = 0;
  for (const item of readCorpus(corpusPaths(SETTING)).items) {
    const id = createHash('sha1').update(item.text).digest('hex').slice(0, 12);
    if (id in entries) continue;
    const entry = await entryOf(gd, map, item.text, (all) => {
      if (!DUMP_DIR || !dumpOnly.has(id)) return;
      mkdirSync(DUMP_DIR, { recursive: true });
      writeFileSync(join(DUMP_DIR, `${id}.txt`), `${all.join('\n')}\n`);
    });
    if (entry) entries[id] = entry;
    else other++;
  }
  return { record: { commit: commitNow(), entries }, other };
}

it.runIf(WRITE)('writes the record of the local builds as the baseline', async () => {
  if (!SETTING) throw new Error('HCP_BUILD_CORPUS names no folder of builds');
  const { record, other } = await recordNow(new Set(DUMP_IDS));
  mkdirSync(join(process.cwd(), '.localbuilds'), { recursive: true });
  writeFileSync(BASELINE, `${JSON.stringify(record, null, 1)}\n`);
  const opened = Object.values(record.entries).filter((entry) => !entry.problem).length;
  console.log(`baseline at ${record.commit}: ${Object.keys(record.entries).length} builds, ${opened} opened, ${other} for another database left out`);
  expect(Object.keys(record.entries).length).toBeGreaterThan(0);
}, 60 * 60_000);

it.skipIf(WRITE)('makes of every local build what the baseline says', async () => {
  if (!SETTING) throw new Error('HCP_BUILD_CORPUS names no folder of builds');
  if (!existsSync(BASELINE)) throw new Error('no baseline yet: on main, run npx vitest run --config tests/localbuildsbaseline.config.ts');
  const baseline = JSON.parse(readFileSync(BASELINE, 'utf-8')) as LocalRecord;
  // a first pass finds what differs; with a dump folder named, a second writes those builds' figures
  let { record } = await recordNow(new Set(DUMP_IDS));
  const changes = localChanges(baseline.entries, record.entries);
  const differing = changes.flatMap((change) => change.ids);
  if (DUMP_DIR && DUMP_IDS.length === 0 && differing.length > 0) ({ record } = await recordNow(new Set(differing)));
  console.log(`${Object.keys(record.entries).length} builds at ${record.commit}, against the baseline of ${baseline.commit}: ${differing.length} differ`);
  const said = changes.map((change) => `${change.what}: ${change.ids.length} builds (${change.ids.slice(0, MOST_LISTED).join(', ')}${change.ids.length > MOST_LISTED ? ', ...' : ''})`);
  expect(said, `the planner makes something else of these builds than at ${baseline.commit}`).toEqual([]);
}, 60 * 60_000);
