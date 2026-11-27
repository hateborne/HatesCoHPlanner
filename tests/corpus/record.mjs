// Records what releases of the planner write, and adds it to the recorded corpus
// (tests/recordedcorpus.test.ts; docs/architecture.md, "Recorded corpus").
//
//   node tests/corpus/record.mjs <tag>...        for example: node tests/corpus/record.mjs v1.3.0
//
// For each tag it checks the tag out into a folder of its own under .claude/worktrees/ (inside this
// checkout, so the release finds this checkout's node_modules by itself; a release with other
// dependencies is refused), has the release's own code write its link, its stored build and its
// Mids exports for every build of the golden numbers (tests/corpus/recordrelease.ts, run there as
// a test file), and takes the checkout away again. Then it has this checkout take the records into
// tests/fixtures/corpus/. It needs Node 20 or newer, as the tests do, and changes nothing but
// tests/fixtures/corpus/.
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const GOLDEN = join(ROOT, 'tests', 'fixtures', 'golden');
// where the releases are checked out: the folder this repository keeps its worktrees in
const CHECKOUTS = join(ROOT, '.claude', 'worktrees');
const VITEST = join(ROOT, 'node_modules', 'vitest', 'vitest.mjs');
// the default server's id (src/data/servers.ts): its data is public/data/, another's public/data/<id>/
const DEFAULT_SERVER = 'homecoming';
// an older game version of the default server, to level a build per archetype on with each release's own walk
const WALKED_VERSION = 'i28p3';

// run git in a folder and give back what it prints
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf-8' }).trim();

/**
 * What every release is asked to record: the golden numbers' builds of each server's version, and
 * which of them also get their Mids exports and the special cases.
 *
 * @return The request, as tests/corpus/recordrelease.ts reads it.
 */
function request() {
  const versions = {};
  for (const server of readdirSync(GOLDEN)) {
    for (const version of readdirSync(join(GOLDEN, server))) {
      const builds = JSON.parse(readFileSync(join(GOLDEN, server, version, 'builds.json'), 'utf-8'));
      versions[`${server}/${version}`] = { server, data: server === DEFAULT_SERVER ? 'data/' : `data/${server}/`, version, builds };
    }
  }
  // the default server's builds are the ones with Mids exports: only it has a Mids map
  const ofDefault = Object.values(versions).filter((asked) => asked.server === DEFAULT_SERVER);
  const names = [...new Set(ofDefault.flatMap((asked) => Object.keys(asked.builds)))];
  // the builds recorded in full, as tests/recordedcorpus.test.ts tells them (recordedInFull)
  const inFull = names.filter((name) => !name.startsWith('pair/') && !name.startsWith('pool/'));
  const henchmen = JSON.parse(readFileSync(join(ROOT, 'public', 'data', 'henchmen', `${ofDefault[0].version}.json`), 'utf-8'));
  return {
    versions,
    mids: inFull,
    mbd: inFull.filter((name) => name.startsWith('forum/') || name.startsWith('link/')),
    petPower: Object.keys(henchmen.powers)[0],
    petBuild: 'archetype/Class_Mastermind',
    relBuild: 'link/blaster-every-enhancement-kind',
    walked: WALKED_VERSION,
  };
}

/**
 * Have one release record what it writes.
 *
 * @param tag The release's tag.
 * @param askedPath The file holding the request.
 * @param rawDir The folder its record goes into, as <tag>.json.
 */
function record(tag, askedPath, rawDir) {
  const lock = (ref) => git(ROOT, 'rev-parse', `${ref}:package-lock.json`);
  if (lock(tag) !== lock('HEAD')) throw new Error(`${tag} has other dependencies than this checkout: install them in a checkout of ${tag} and record there`);
  mkdirSync(CHECKOUTS, { recursive: true });
  const checkout = mkdtempSync(join(CHECKOUTS, `corpus-${tag}-`));
  git(ROOT, 'worktree', 'add', '--detach', checkout, tag);
  try {
    mkdirSync(join(checkout, 'tests', 'corpus'), { recursive: true });
    copyFileSync(join(ROOT, 'tests', 'corpus', 'recordrelease.ts'), join(checkout, 'tests', 'corpus', 'recordrelease.test.ts'));
    execFileSync(process.execPath, [VITEST, 'run', 'tests/corpus/recordrelease.test.ts'], {
      cwd: checkout,
      stdio: 'inherit',
      env: { ...process.env, CORPUS_IN: askedPath, CORPUS_OUT: join(rawDir, `${tag}.json`) },
    });
  } finally {
    git(ROOT, 'worktree', 'remove', '--force', checkout);
  }
}

const tags = process.argv.slice(2);
if (tags.length === 0) {
  console.error('usage: node tests/corpus/record.mjs <tag>...');
  process.exit(2);
}
const work = mkdtempSync(join(tmpdir(), 'hcp-corpus-'));
const rawDir = join(work, 'raw');
mkdirSync(rawDir);
const askedPath = join(work, 'asked.json');
writeFileSync(askedPath, JSON.stringify(request()));
try {
  for (const tag of tags) record(tag, askedPath, rawDir);
  execFileSync(process.execPath, [VITEST, 'run', '--config', 'tests/corpuswrite.config.ts'], { cwd: ROOT, stdio: 'inherit', env: { ...process.env, HCP_CORPUS_RAW: rawDir } });
} finally {
  rmSync(work, { recursive: true, force: true });
}
