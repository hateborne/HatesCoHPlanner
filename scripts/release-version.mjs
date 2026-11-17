// Picks the version a deploy publishes (the API and its doc blocks are in release-version.d.mts;
// the rules in AGENTS.md, "Versions and releases"). Plain Node with no dependencies: the deploy
// runs it before npm ci. Usage: node scripts/release-version.mjs <major|minor|patch>
import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const BUMPS = ['major', 'minor', 'patch'];

// a version's numbers, as SemVer writes them (no leading zeros)
const XYZ = String.raw`(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)`;
export const VERSION = new RegExp(`^${XYZ}$`);
// a version tag as git ls-remote names it; "^{}" marks an annotated tag's commit
const TAG = new RegExp(String.raw`^refs/tags/v${XYZ}(\^\{\})?$`);
// the branch every release comes from
const MAIN = 'refs/heads/main';

// What the site is not built from: a change to these alone makes no new version (the rule is in
// docs/releases.md, "What counts as a new version"). Anything not listed counts, so a path nobody
// thought of errs toward a new version, never toward a changed site under an old number.
const ALWAYS_THE_SITE = /^(src|public)\//;
const NOT_THE_SITE = [
  /^\.github\//, // CI and deploy workflows, CODEOWNERS
  /^\.claude\//, // agent settings
  /^docs\//,
  /^(tests|e2e)\//,
  /^(pipeline|tools)\//, // the data pipeline's code, ids and reports: what it makes lands in public/, which counts
  /^scripts\//, // CI and deploy helpers
  /\.md$/i, // README, AGENTS, CLAUDE, CHANGELOG and other notes
  /^(\.gitignore|\.gitattributes|LICENSE|eslint\.config\.[cm]?[jt]s|playwright\.config\.[cm]?[jt]s|tsconfig\.e2e\.json)$/,
];

export function affectsSite(path) {
  const p = path.replace(/\\/g, '/').replace(/^\.\//, '');
  return ALWAYS_THE_SITE.test(p) || !NOT_THE_SITE.some((r) => r.test(p));
}

/**
 * Read the version tags and main's tip from git ls-remote output.
 *
 * @param lsRemote The output of `git ls-remote --heads --tags origin`.
 * @return Each vX.Y.Z tag with its version parts and the commit it marks (an annotated tag's peeled
 *   commit), and main's tip (null when the output names no main), all shas in lower case.
 */
function readRemote(lsRemote) {
  const tags = new Map();
  let main = null;
  for (const line of lsRemote.split('\n')) {
    const [sha, ref] = line.trim().split(/\s+/);
    if (!sha || !ref) continue;
    if (ref === MAIN) main = sha.toLowerCase();
    const m = TAG.exec(ref);
    if (!m) continue;
    const name = `v${m[1]}.${m[2]}.${m[3]}`;
    const t = tags.get(name) ?? { name, parts: [m[1], m[2], m[3]].map(Number), direct: null, peeled: null };
    if (m[4]) t.peeled = sha.toLowerCase();
    else t.direct = sha.toLowerCase();
    tags.set(name, t);
  }
  return { tags: [...tags.values()].map((t) => ({ name: t.name, parts: t.parts, commit: t.peeled ?? t.direct })), main };
}

// newest first, by number (v1.10.0 above v1.9.0)
const newestFirst = (a, b) => b.parts[0] - a.parts[0] || b.parts[1] - a.parts[1] || b.parts[2] - a.parts[2];

export function nextRelease(lsRemote, head, bump, changedSince) {
  const { tags, main } = readRemote(lsRemote);
  tags.sort(newestFirst);
  if (!tags.length) throw new Error('No version tag (vX.Y.Z) exists yet: tag the first public release, v1.0.0, by hand before deploying.');
  const commit = head.toLowerCase();
  const own = tags.find((t) => t.commit === commit);
  if (own) return { version: own.name.slice(1), fresh: false, previous: null };
  // a re-run of an older run that failed before tagging would give old code the next number
  if (!main) throw new Error('origin has no main branch to release from.');
  if (commit !== main) {
    throw new Error(`Commit ${commit.slice(0, 7)} is not main's newest (${main.slice(0, 7)}), so it can't take a new version: start a new deploy instead of re-running an old one.`);
  }
  // docs, tests, CI and tooling are not the application: with nothing else changed since the newest
  // version, the site is the one that version already names, whatever bump was picked
  if (changedSince && !changedSince({ name: tags[0].name, commit: tags[0].commit }).some(affectsSite)) {
    return { version: tags[0].name.slice(1), fresh: false, previous: null, unchanged: true };
  }
  if (!BUMPS.includes(bump)) throw new Error(`Pick a version bump to deploy: major, minor or patch (got "${bump}").`);
  const [major, minor, patch] = tags[0].parts;
  const next = bump === 'major' ? [major + 1, 0, 0] : bump === 'minor' ? [major, minor + 1, 0] : [major, minor, patch + 1];
  return { version: next.join('.'), fresh: true, previous: tags[0].name };
}

const git = (...args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

export function fetchTag(tag) {
  const ref = `refs/tags/${tag}`;
  if (!TAG.test(ref) || ref.endsWith('}')) throw new Error(`"${tag}" is not a release's tag (vX.Y.Z).`);
  let here = true;
  try {
    git('rev-parse', '--verify', '--quiet', `${ref}^{commit}`);
  } catch {
    here = false;
  }
  if (!here) {
    // one commit deep in a shallow checkout (the deploy's); a full clone is never made shallow
    const shallow = git('rev-parse', '--is-shallow-repository').trim() === 'true';
    git('fetch', '--quiet', '--no-tags', ...(shallow ? ['--depth', '1'] : []), 'origin', `${ref}:${ref}`);
  }
  return ref;
}

/** The command line: picks the version and hands it to the workflow ($GITHUB_OUTPUT). */
function main() {
  const head = process.env.GITHUB_SHA || git('rev-parse', 'HEAD').trim();
  // every path that differs between a release and this commit: their trees are compared, so the
  // history between them is not needed
  const changedSince = (tag) => git('diff', '--name-only', '--no-renames', '-z', `${fetchTag(tag.name)}^{commit}`, head).split('\0').filter(Boolean);
  const r = nextRelease(git('ls-remote', '--heads', '--tags', 'origin'), head, process.argv[2] ?? '', changedSince);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `version=${r.version}\nfresh=${r.fresh}\nprevious=${r.previous ?? ''}\n`);
  if (r.fresh) console.log(`New version: v${r.version} (after ${r.previous}).`);
  else if (r.unchanged) {
    console.log(`${process.env.GITHUB_ACTIONS ? '::notice::' : ''}Nothing the site is built from changed since v${r.version} (docs, tests, CI or tooling only): deploying it again as v${r.version}, with no new version.`);
  } else console.log(`v${r.version} already marks ${head.slice(0, 7)}: deploying it again as v${r.version}.`);
}

// run as a script, not when a test or vite.config.ts imports it
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (e) {
    console.error(`${process.env.GITHUB_ACTIONS ? '::error::' : ''}${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }
}
