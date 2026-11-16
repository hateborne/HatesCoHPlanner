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

export function nextRelease(lsRemote, head, bump) {
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
  if (!BUMPS.includes(bump)) throw new Error(`Pick a version bump to deploy: major, minor or patch (got "${bump}").`);
  const [major, minor, patch] = tags[0].parts;
  const next = bump === 'major' ? [major + 1, 0, 0] : bump === 'minor' ? [major, minor + 1, 0] : [major, minor, patch + 1];
  return { version: next.join('.'), fresh: true, previous: tags[0].name };
}

/** The command line: picks the version and hands it to the workflow ($GITHUB_OUTPUT). */
function main() {
  const git = (...args) => execFileSync('git', args, { encoding: 'utf8' });
  const head = process.env.GITHUB_SHA || git('rev-parse', 'HEAD').trim();
  const r = nextRelease(git('ls-remote', '--heads', '--tags', 'origin'), head, process.argv[2] ?? '');
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `version=${r.version}\nfresh=${r.fresh}\nprevious=${r.previous ?? ''}\n`);
  console.log(r.fresh ? `New version: v${r.version} (after ${r.previous}).` : `v${r.version} already marks ${head.slice(0, 7)}: deploying it again as v${r.version}.`);
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
