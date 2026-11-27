/**
 * Golden numbers: the engine's output for whole builds, on record, so that a change to any figure
 * the screens show (a total, a set bonus, an enhancement's strength, a line of power info, a pet's
 * card) fails here, whichever part of the engine it came from.
 *
 * Each server's default game version has a folder, tests/fixtures/golden/<server>/<version>/:
 * - builds.json: the builds, made once and kept as share links (helpers/goldenbuilds.ts): the forum
 *   builds, the links on record (helpers/links.ts), and the sweep's builds of every archetype;
 * - full/: every figure of the forum builds, the links on record and each archetype's first build,
 *   a line each, so a change reads as a diff;
 * - digests.json: a digest of the same record, less the rule issues, for every other build;
 * - powerinfo.json: a digest of every power's unenhanced power info, per archetype that can own it;
 * - unslotted.json: the enhancement sets no recorded build holds a piece of, so the gap is in sight.
 *
 * A change that is meant writes them again, in the same pull request, where the diff shows it:
 *   npx vitest run --config tests/goldenwrite.config.ts
 * That run never replaces a recorded build; it makes the builds a version lacks (a new game version
 * needs its folder: the first test here fails without it). To see every figure behind a digest, set
 * HCP_GOLDEN_DUMP to a folder outside the repository on two checkouts and compare the folders.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { describe, expect, inject, it } from 'vitest';
import { HENCHMEN_FOLDER, type GameData } from '../src/data/gamedata.ts';
import { SERVERS, withServer, type GameServer } from '../src/data/servers.ts';
import type { Build } from '../src/engine/build.ts';
import { checkBuild } from '../src/engine/validate.ts';
import type { MidsMap } from '../src/io/mids.ts';
import { decodeShare, encodeShare } from '../src/io/share.ts';
import { dataDir, loadData, loadVersionIndex, withHenchmen } from './helpers/data.ts';
import { fixtureNames, importFixture } from './helpers/fixtures.ts';
import { digest, flatten, lineChanges } from './helpers/golden.ts';
import { buildRecord, infoDigests, makeSweepBuild, sweepBuilds, unslottedBoostsets, type InfoDigests } from './helpers/goldenbuilds.ts';
import { RECORDED_LINKS } from './helpers/links.ts';

declare module 'vitest' {
  /** What a vitest config hands its tests: only tests/goldenwrite.config.ts sets this one. */
  export interface ProvidedContext {
    goldenWrite: boolean; // write the golden numbers again, where a run would compare them
  }
}

const GOLDEN_DIR = join(process.cwd(), 'tests', 'fixtures', 'golden');
// the files every version's folder holds, beside its full/ folder
const FILES = ['builds.json', 'digests.json', 'powerinfo.json', 'unslotted.json'] as const;
// whether this run writes the numbers. Only the write config says so: a variable left set in a
// shell could turn `npm test` into a run that rewrites everything and checks nothing.
const WRITE = inject('goldenWrite') === true;
// a folder to write every record in full to, digests' records included (none: nothing is dumped)
const DUMP_DIR = dumpDir();
// a build opened and recorded takes tens of milliseconds, and there are hundreds
const TIMEOUT_MS = 10 * 60_000;
// what a failed comparison says after its differences
const HOW_TO =
  "The engine's numbers differ from the golden numbers on record. If the change is meant, write them again " +
  '(npx vitest run --config tests/goldenwrite.config.ts) and show the diff in the pull request; if it is not, the change broke a figure.';

/** One game version with golden numbers: its server, its id and its folder of records. */
interface Target {
  server: GameServer; // the server the version belongs to
  version: string; // the game version id
  dir: string; // tests/fixtures/golden/<server>/<version>
}

/** Everything the write run puts in a version's folder, worked out before any file is touched. */
interface Written {
  builds: Record<string, string>; // builds.json: each build's name and share code
  full: Map<string, string[]>; // full/: the lines of each build kept in full, by name
  digests: Record<string, string>; // digests.json: the digest of every other build, by name
  info: InfoDigests; // powerinfo.json
  unslotted: string[]; // unslotted.json
}

/**
 * The folder named for a full dump, when one is.
 *
 * @return Its full path, or undefined when HCP_GOLDEN_DUMP is not set.
 * @throws When the folder is inside the repository: its files would sit beside tracked ones, one
 *   `git add` from being committed.
 */
function dumpDir(): string | undefined {
  const named = process.env.HCP_GOLDEN_DUMP;
  if (!named) return undefined;
  const inside = relative(process.cwd(), resolve(named));
  if (!inside.startsWith('..') && !isAbsolute(inside)) throw new Error('HCP_GOLDEN_DUMP must name a folder outside the repository');
  return resolve(named);
}

/**
 * The versions that have golden numbers, or must have them.
 *
 * @return Each server's default version, then any other listed version of the server that has a folder.
 */
function targets(): Target[] {
  const out: Target[] = [];
  for (const server of SERVERS) {
    const index = loadVersionIndex(server.id);
    const serverDir = join(GOLDEN_DIR, server.id);
    const others = existsSync(serverDir) ? readdirSync(serverDir).filter((name) => name !== index.default && index.versions.some((version) => version.id === name)) : [];
    for (const version of [index.default, ...others.sort()]) out.push({ server, version, dir: join(serverDir, version) });
  }
  return out;
}

/** @return A JSON file's content, or undefined when there is no such file. */
function readJson<T>(path: string): T | undefined {
  return existsSync(path) ? (JSON.parse(readFileSync(path, 'utf-8')) as T) : undefined;
}

/** Write a JSON file a field to a line, so that a change to one entry is one changed line. */
function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 1)}\n`);
}

/** @return A text file's lines (either line ending), or undefined when there is no such file. */
function readLines(path: string): string[] | undefined {
  if (!existsSync(path)) return undefined;
  const lines = readFileSync(path, 'utf-8').split(/\r?\n/);
  if (lines[lines.length - 1] === '') lines.pop();
  return lines;
}

/** Write lines as a text file with LF line endings, as the repository stores text. */
function writeLines(path: string, lines: readonly string[]): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${lines.join('\n')}\n`);
}

/** @return Whether a build's record is kept in full (a forum build, a link on record, an archetype's first build), not as a digest. */
function keptInFull(name: string): boolean {
  return name.startsWith('forum/') || name.startsWith('link/') || name.startsWith('archetype/');
}

/** @return The name of the file a build's full record is kept in ("forum/x" is forum-x.txt). */
function fullName(name: string): string {
  return `${name.replace(/\//g, '-')}.txt`;
}

/** @return Whether a version is its server's default, the one the forum builds and the links on record belong to. */
function isDefault(target: Target): boolean {
  return target.version === loadVersionIndex(target.server.id).default;
}

/**
 * A version's game data as the site has it once everything has arrived: with its pets and info
 * files (loadData) and its real pets file, when the version has one.
 *
 * @param target The version.
 * @return Its data.
 */
function dataOf(target: Target): GameData {
  const gd = loadData(target.version, target.server.id);
  const hasHenchmen = existsSync(join(dataDir(target.server.id), HENCHMEN_FOLDER, `${target.version}.json`));
  return hasHenchmen ? withHenchmen(gd, target.server.id) : gd;
}

/**
 * Open a recorded build as the planner opens a link: decoded, stamped with its server and checked.
 *
 * @param gd The version's data.
 * @param target The version.
 * @param name The build's name on record, for the error.
 * @param code Its share code.
 * @return The build.
 * @throws When the code does not open, opens only with repairs, or was made on another game version.
 */
async function openBuild(gd: GameData, target: Target, name: string, code: string): Promise<Build> {
  const decoded = await decodeShare(code);
  // a build recorded in one version's folder is read with that version's ids, never another's
  if (decoded.dataVersion !== target.version) throw new Error(`${name}: recorded on ${decoded.dataVersion}, in the folder of ${target.version}`);
  const { build, fixes } = checkBuild(gd, withServer(decoded, target.server.id));
  if (!build || fixes.length > 0) throw new Error(`${name}: the recorded build does not open as it was (${fixes.join('; ') || 'refused'})`);
  return build;
}

// the dump files this run has started: a file left by an earlier run is replaced, not added to
const dumped = new Set<string>();

/**
 * Write a record's full lines into the dump folder, when one is named.
 *
 * @param target The version.
 * @param name The record's name; its part before the last "/" is the file, the rest marks its lines.
 * @param lines The record's lines.
 */
function dump(target: Target, name: string, lines: readonly string[]): void {
  if (!DUMP_DIR) return;
  const cut = name.lastIndexOf('/');
  const path = join(DUMP_DIR, target.server.id, target.version, `${name.slice(0, cut).replace(/\//g, '-')}.txt`);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${lines.map((line) => `${name.slice(cut + 1)} | ${line}`).join('\n')}\n`, { flag: dumped.has(path) ? 'a' : 'w' });
  dumped.add(path);
}

/**
 * Work out the record of each of a version's builds, one at a time.
 *
 * @param target The version.
 * @param builds The builds, by name, as share codes.
 * @param keep Which builds to work out, by name.
 * @param take Called with each build's name, the build as it opens and its record's lines; the lines
 *   are not kept here, so hundreds of records never sit in memory together.
 */
async function eachRecord(target: Target, builds: Record<string, string>, keep: (name: string) => boolean, take: (name: string, build: Build, lines: string[]) => void): Promise<void> {
  const gd = dataOf(target);
  for (const [name, code] of Object.entries(builds)) {
    if (!keep(name)) continue;
    const build = await openBuild(gd, target, name, code);
    const lines = flatten(buildRecord(gd, build, /*withIssues=*/ keptInFull(name)));
    dump(target, `build/${name.replace(/\//g, '-')}/all`, lines);
    take(name, build, lines);
  }
}

/**
 * The forum builds a version's folder holds: the fixtures, on the default version of a server Mids
 * has a database for (the others have no Mids map to import them with).
 *
 * @param target The version.
 * @return Each build's name on record and its fixture file; none for any other version.
 * @throws When two fixture files would share a name on record.
 */
function forumBuilds(target: Target): Map<string, string> {
  const out = new Map<string, string>();
  if (!target.server.midsDb || !isDefault(target)) return out;
  for (const file of fixtureNames()) {
    const name = `forum/${file.replace(/\.[a-z]+$/, '')}`;
    if (out.has(name)) throw new Error(`${file} and ${out.get(name)} would both be recorded as ${name}: rename one`);
    out.set(name, file);
  }
  return out;
}

/**
 * The links on record that a version's folder holds: those made on that very version.
 *
 * @param target The version.
 * @return Each link's name on record and its share code.
 */
async function linkBuilds(target: Target): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const recorded of Object.values(RECORDED_LINKS)) {
    if ((await decodeShare(recorded.link)).dataVersion === target.version) out.set(`link/${recorded.file}`, recorded.link);
  }
  return out;
}

/**
 * Make the builds a version has none of yet, as share codes: the forum builds, the links on record
 * and the sweep's builds.
 *
 * @param target The version.
 * @param recorded The builds already on record: none of them is made again.
 * @return The builds on record and the new ones, the recorded ones first.
 * @throws When a forum build cannot be imported for want of the version's Mids map, or a build's
 *   link does not hold the build that was made.
 */
async function withMissingBuilds(target: Target, recorded: Record<string, string>): Promise<Record<string, string>> {
  const gd = dataOf(target);
  const builds = { ...recorded };
  // record a build that was just made, once its link is seen to hold it
  const add = async (name: string, made: Build) => {
    const code = await encodeShare(made);
    // what opens from the link must give the numbers the made build gives (a link writes some
    // things another way, an unset switch for one, so the builds themselves are not compared)
    const direct = checkBuild(gd, withServer(made, target.server.id)).build;
    if (!direct) throw new Error(`${name}: the build that was made is refused`);
    const opened = await openBuild(gd, target, name, code);
    const changes = lineChanges(flatten(buildRecord(gd, direct, /*withIssues=*/ true)), flatten(buildRecord(gd, opened, /*withIssues=*/ true)));
    expect(changes, `${name}: its link does not hold the build that was made`).toEqual([]);
    builds[name] = code;
  };
  const forum = forumBuilds(target);
  if (forum.size > 0) {
    const mapPath = join(dataDir(target.server.id), target.version, 'mids-map.json');
    if (!existsSync(mapPath)) throw new Error(`${target.version} has no mids-map.json to import the forum builds with`);
    const map = JSON.parse(readFileSync(mapPath, 'utf-8')) as MidsMap;
    for (const [name, file] of forum) if (!(name in builds)) await add(name, (await importFixture(gd, map, file)).build);
  }
  for (const [name, code] of await linkBuilds(target)) {
    if (name in builds) continue;
    await openBuild(gd, target, name, code);
    builds[name] = code;
  }
  for (const sweep of sweepBuilds(gd)) if (!(sweep.name in builds)) await add(sweep.name, makeSweepBuild(gd, sweep));
  return builds;
}

/**
 * Everything a version's folder should hold, worked out from the engine as it is now.
 *
 * @param target The version.
 * @param builds The version's builds, by name, as share codes.
 * @return The files' contents.
 */
async function workOut(target: Target, builds: Record<string, string>): Promise<Written> {
  const gd = dataOf(target);
  const full = new Map<string, string[]>();
  const digests: Record<string, string> = {};
  const opened: Build[] = [];
  await eachRecord(target, builds, () => true, (name, build, lines) => {
    opened.push(build);
    if (keptInFull(name)) full.set(name, lines);
    else digests[name] = digest(lines);
  });
  const info = infoDigests(gd, (name, lines) => dump(target, name, lines));
  return { builds, full, digests, info, unslotted: unslottedBoostsets(gd, opened) };
}

/**
 * Where two sets of power info digests differ.
 *
 * @param recorded The digests on record.
 * @param now The digests worked out now.
 * @return The name of each power whose digest differs ("archetype/power set.power"), a power that
 *   is missing or new included.
 */
function infoChanges(recorded: InfoDigests, now: InfoDigests): string[] {
  // every digest of a set, by its power's full name under its archetype
  const names = (digests: InfoDigests) =>
    new Map(
      Object.entries(digests).flatMap(([archetype, powersets]) =>
        Object.entries(powersets).flatMap(([powerset, powers]) => Object.entries(powers).map(([power, value]) => [`${archetype}/${powerset}.${power}`, value] as const)),
      ),
    );
  const before = names(recorded);
  const after = names(now);
  return [...new Set([...before.keys(), ...after.keys()])].filter((name) => before.get(name) !== after.get(name));
}

describe.runIf(WRITE)('golden numbers, written again', () => {
  it.each(targets())('$server.label $version', async (target) => {
    // everything is worked out first: a run that fails part way leaves the folder as it was
    const written = await workOut(target, await withMissingBuilds(target, readJson<Record<string, string>>(join(target.dir, 'builds.json')) ?? {}));
    writeJson(join(target.dir, 'builds.json'), written.builds);
    rmSync(join(target.dir, 'full'), { recursive: true, force: true });
    for (const [name, lines] of written.full) writeLines(join(target.dir, 'full', fullName(name)), lines);
    writeJson(join(target.dir, 'digests.json'), written.digests);
    writeJson(join(target.dir, 'powerinfo.json'), written.info);
    writeJson(join(target.dir, 'unslotted.json'), written.unslotted);
    expect(Object.keys(written.builds).length).toBeGreaterThan(0);
  }, 6 * TIMEOUT_MS);
});

describe.skipIf(WRITE)('golden numbers', () => {
  it("are on record for every server's default game version, and for no folder that is not a listed version", () => {
    const missing = SERVERS.map((server) => join(server.id, loadVersionIndex(server.id).default)).filter((folder) => !FILES.every((file) => existsSync(join(GOLDEN_DIR, folder, file))));
    expect(missing, 'no golden numbers for these versions: write them (npx vitest run --config tests/goldenwrite.config.ts) and commit the new folder').toEqual([]);
    // a folder nothing checks would look like cover it does not give
    const strays = readdirSync(GOLDEN_DIR).flatMap((serverId) => {
      const server = SERVERS.find((candidate) => candidate.id === serverId);
      if (!server) return [serverId];
      const listed = loadVersionIndex(server.id).versions.map((version) => version.id);
      return readdirSync(join(GOLDEN_DIR, serverId)).filter((folder) => !listed.includes(folder)).map((folder) => join(serverId, folder));
    });
    expect(strays, 'these folders are no server or no listed game version, so nothing checks them').toEqual([]);
  });

  describe.each(targets())('$server.label $version', (target) => {
    // the version's builds as they are on record, by name
    const recorded = () => readJson<Record<string, string>>(join(target.dir, 'builds.json')) ?? {};

    it('hold every build the sweep, the forum fixtures and the links on record call for', async () => {
      const names = new Set(Object.keys(recorded()));
      const forum = forumBuilds(target);
      const wanted = [...forum.keys(), ...(await linkBuilds(target)).keys(), ...sweepBuilds(dataOf(target)).map((sweep) => sweep.name)];
      expect(wanted.filter((name) => !names.has(name)), 'not on record: write the golden numbers again').toEqual([]);
      // on the default version a forum build with no fixture left is a leftover; an older folder keeps its own
      const leftover = isDefault(target) ? [...names].filter((name) => name.startsWith('forum/') && !forum.has(name)) : [];
      expect(leftover, 'no such fixture any more: take the build out of builds.json and delete its file in full/').toEqual([]);
    });

    it('give the forum builds, the links on record and each archetype\'s first build every figure on record', async () => {
      const changed: Record<string, string[]> = {};
      const files: string[] = [];
      await eachRecord(target, recorded(), keptInFull, (name, _build, lines) => {
        files.push(fullName(name));
        const changes = lineChanges(readLines(join(target.dir, 'full', fullName(name))) ?? [], lines);
        if (changes.length > 0) changed[name] = changes;
      });
      expect(changed, HOW_TO).toEqual({});
      // and no file is left over from a build that is no longer on record
      const onDisk = existsSync(join(target.dir, 'full')) ? readdirSync(join(target.dir, 'full')).sort() : [];
      expect(onDisk).toEqual(files.sort());
    }, TIMEOUT_MS);

    it('give every other recorded build the numbers on record', async () => {
      const now: Record<string, string> = {};
      await eachRecord(target, recorded(), (name) => !keptInFull(name), (name, _build, lines) => {
        now[name] = digest(lines);
      });
      const onRecord = readJson<Record<string, string>>(join(target.dir, 'digests.json')) ?? {};
      const changed = [...new Set([...Object.keys(onRecord), ...Object.keys(now)])].filter((name) => onRecord[name] !== now[name]);
      expect(changed, HOW_TO).toEqual([]);
    }, TIMEOUT_MS);

    it("give every power's info the numbers on record, for every archetype that can own it", () => {
      const now = infoDigests(dataOf(target), (name, lines) => dump(target, name, lines));
      expect(infoChanges(readJson<InfoDigests>(join(target.dir, 'powerinfo.json')) ?? {}, now), HOW_TO).toEqual([]);
    }, TIMEOUT_MS);

    it('name the enhancement sets no recorded build holds', async () => {
      const gd = dataOf(target);
      const opened: Build[] = [];
      for (const [name, code] of Object.entries(recorded())) opened.push(await openBuild(gd, target, name, code));
      expect(unslottedBoostsets(gd, opened), HOW_TO).toEqual(readJson<string[]>(join(target.dir, 'unslotted.json')) ?? []);
    }, TIMEOUT_MS);
  });
});
