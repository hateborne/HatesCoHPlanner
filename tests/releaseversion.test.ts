import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { affectsSite, BUMPS, nextRelease, VERSION } from '../scripts/release-version.mjs';

// commits as full shas
const A = 'a'.repeat(40);
const B = 'b'.repeat(40);
const C = 'c'.repeat(40);
const TAGOBJ = 'f'.repeat(40); // an annotated tag's own object

/** @return git ls-remote output naming each [sha, ref] pair. */
const remote = (...refs: [string, string][]) => refs.map(([sha, ref]) => `${sha}\t${ref}`).join('\n') + '\n';
/** @return The ls-remote line for main's tip at a commit. */
const main = (sha: string): [string, string] => [sha, 'refs/heads/main'];

describe('nextRelease', () => {
  it('bumps the newest tag, each bump resetting the parts after it', () => {
    const tags = remote([A, 'refs/tags/v1.2.3'], main(B));
    expect(nextRelease(tags, B, 'patch')).toEqual({ version: '1.2.4', fresh: true, previous: 'v1.2.3' });
    expect(nextRelease(tags, B, 'minor')).toEqual({ version: '1.3.0', fresh: true, previous: 'v1.2.3' });
    expect(nextRelease(tags, B, 'major')).toEqual({ version: '2.0.0', fresh: true, previous: 'v1.2.3' });
    expect([...BUMPS].sort()).toEqual(['major', 'minor', 'patch']);
  });

  it('orders versions by number, not as text', () => {
    const tags = remote([A, 'refs/tags/v1.9.0'], [B, 'refs/tags/v1.10.0'], [A, 'refs/tags/v1.2.9'], main(C));
    expect(nextRelease(tags, C, 'patch')).toEqual({ version: '1.10.1', fresh: true, previous: 'v1.10.0' });
  });

  it('counts only vX.Y.Z tags', () => {
    const others: [string, string][] = [[B, 'refs/tags/v9.0'], [B, 'refs/tags/9.0.0'], [B, 'refs/tags/vfoo'], [B, 'refs/tags/v09.0.0'], [B, 'refs/tags/v9.0.0-beta'], [B, 'refs/heads/v9.0.0']];
    expect(nextRelease(remote([A, 'refs/tags/v1.0.0'], ...others, main(C)), C, 'minor')).toEqual({ version: '1.1.0', fresh: true, previous: 'v1.0.0' });
    // none of them marks B as released
    expect(nextRelease(remote([A, 'refs/tags/v1.0.0'], ...others, main(B)), B, 'patch').fresh).toBe(true);
  });

  it('keeps the version of a commit already tagged (a redeploy), whatever bump was picked', () => {
    const tags = remote([A, 'refs/tags/v1.0.0'], [B, 'refs/tags/v1.1.0'], main(B));
    expect(nextRelease(tags, B, 'major')).toEqual({ version: '1.1.0', fresh: false, previous: null });
    expect(nextRelease(tags, B.toUpperCase(), 'pick one')).toEqual({ version: '1.1.0', fresh: false, previous: null });
    // main has moved on: an older release still deploys as itself
    expect(nextRelease(remote([A, 'refs/tags/v1.0.0'], [B, 'refs/tags/v1.1.0'], main(C)), A, 'pick one')).toEqual({ version: '1.0.0', fresh: false, previous: null });
  });

  it('reads an annotated tag by the commit it points at', () => {
    const tags = remote([TAGOBJ, 'refs/tags/v1.4.0'], [B, 'refs/tags/v1.4.0^{}'], main(B));
    expect(nextRelease(tags, B, 'patch')).toEqual({ version: '1.4.0', fresh: false, previous: null });
    // the tag's own object marks nothing
    const tagObjAtMain = remote([TAGOBJ, 'refs/tags/v1.4.0'], [B, 'refs/tags/v1.4.0^{}'], main(TAGOBJ));
    expect(nextRelease(tagObjAtMain, TAGOBJ, 'patch')).toEqual({ version: '1.4.1', fresh: true, previous: 'v1.4.0' });
    // the peeled line may come first
    const swapped = remote([B, 'refs/tags/v1.4.0^{}'], [TAGOBJ, 'refs/tags/v1.4.0'], main(C));
    expect(nextRelease(swapped, B, 'patch').fresh).toBe(false);
  });

  it("gives a new version only to main's tip (an old run re-run can't take one)", () => {
    // B failed before it was tagged, then C was merged and deployed as v1.1.0
    const tags = remote([A, 'refs/tags/v1.0.0'], [C, 'refs/tags/v1.1.0'], main(C));
    expect(() => nextRelease(tags, B, 'patch')).toThrow(/not main's newest/);
    expect(() => nextRelease(tags, B.toUpperCase(), 'major')).toThrow(/start a new deploy/);
    // only refs/heads/main is main
    const lookalikes = remote([A, 'refs/tags/v1.0.0'], [B, 'refs/heads/main-old'], [B, 'refs/heads/feature/main'], [B, 'refs/tags/main']);
    expect(() => nextRelease(lookalikes, B, 'patch')).toThrow(/no main branch/);
    expect(nextRelease(remote([A, 'refs/tags/v1.0.0'], main(B.toUpperCase())), B, 'patch').version).toBe('1.0.1');
  });

  it('refuses a new version without a bump', () => {
    const tags = remote([A, 'refs/tags/v1.0.0'], main(B));
    for (const bump of ['pick one', '', 'Minor', 'feature']) expect(() => nextRelease(tags, B, bump)).toThrow(/Pick a version bump/);
  });

  it('refuses to pick any version before the first one is tagged', () => {
    expect(() => nextRelease('', A, 'patch')).toThrow(/v1\.0\.0/);
    expect(() => nextRelease(remote([A, 'refs/tags/release-1'], main(A)), A, 'major')).toThrow(/v1\.0\.0/);
  });
});

describe('a deploy of changes the site is not built from', () => {
  const tags = remote([A, 'refs/tags/v1.1.0'], [C, 'refs/tags/v1.0.0'], main(B));

  it('keeps the newest version, whatever bump was picked, and tags nothing', () => {
    const only = ['docs/releases.md', 'AGENTS.md', 'tests/rules.test.ts', '.github/workflows/ci.yml', 'pipeline/export.py', 'scripts/audit-dev.mjs'];
    for (const bump of ['patch', 'minor', 'major', 'pick one']) {
      expect(nextRelease(tags, B, bump, () => only)).toEqual({ version: '1.1.0', fresh: false, previous: null, unchanged: true });
    }
    // nothing differs at all (a change and its revert)
    expect(nextRelease(tags, B, 'patch', () => [])).toEqual({ version: '1.1.0', fresh: false, previous: null, unchanged: true });
  });

  it('takes a new version as soon as one changed file is part of the site', () => {
    expect(nextRelease(tags, B, 'patch', () => ['docs/releases.md', 'src/App.tsx'])).toEqual({ version: '1.1.1', fresh: true, previous: 'v1.1.0' });
    expect(() => nextRelease(tags, B, 'pick one', () => ['package-lock.json'])).toThrow(/Pick a version bump/);
  });

  it('compares with the newest version, and only for an untagged tip of main', () => {
    const asked: { name: string; commit: string }[] = [];
    const changed = (release: { name: string; commit: string }) => {
      asked.push(release);
      return ['README.md'];
    };
    nextRelease(tags, B, 'patch', changed);
    expect(asked).toEqual([{ name: 'v1.1.0', commit: A }]);
    // a commit with a tag of its own, and one that isn't main's tip, are settled before any comparing
    expect(nextRelease(tags, A, 'patch', changed)).toEqual({ version: '1.1.0', fresh: false, previous: null });
    expect(() => nextRelease(remote([A, 'refs/tags/v1.1.0'], main(C)), B, 'patch', changed)).toThrow(/not main's newest/);
    expect(asked).toHaveLength(1);
  });
});

describe('affectsSite', () => {
  it('counts everything the site is built from', () => {
    const site = ['src/App.tsx', 'src/engine/rules.ts', 'public/data/i28p4/core.json', 'public/data/versions.json', 'public/assets/icons/x.png', 'index.html', 'vite.config.ts', 'package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.app.json', 'tsconfig.node.json'];
    for (const p of site) expect(affectsSite(p), p).toBe(true);
  });

  it('leaves out docs, tests, CI, the pipeline and tooling', () => {
    const not = [
      ...['README.md', 'AGENTS.md', 'CLAUDE.md', 'CHANGELOG.md', 'LICENSE', 'docs/releases.md', 'docs/img/screen.png'],
      ...['tests/rules.test.ts', 'tests/fixtures/builds/README.md', 'tests/fixtures/builds/x.txt', 'e2e/boosted.spec.ts', 'playwright.config.ts', 'playwright.built.config.ts', 'tsconfig.e2e.json'],
      ...['.github/workflows/ci.yml', '.github/workflows/pages.yml', '.github/CODEOWNERS', 'scripts/release-version.mjs', 'scripts/audit-dev.mjs', 'eslint.config.js'],
      ...['hosting/Caddyfile', 'hosting/planner-update.sh', 'hosting/planner-update.timer'],
      ...['pipeline/export.py', 'pipeline/ids.json', 'pipeline/report.md', 'tools/coh_exe.py', 'research/corpus.ts', 'research/vitest.config.ts', '.claude/launch.json', '.gitignore', '.gitattributes'],
    ];
    for (const p of not) expect(affectsSite(p), p).toBe(false);
  });

  it('counts a file inside the site whatever its name, and any path nobody listed', () => {
    for (const p of ['public/notes.md', 'src/ui/README.md', 'public/docs/x.json', 'src/tests/x.ts', 'newtool.config.js', 'Dockerfile', 'assets/logo.png', 'docsite/index.html']) expect(affectsSite(p), p).toBe(true);
    // as Windows and "./" write the same paths
    expect(affectsSite(String.raw`docs\releases.md`)).toBe(false);
    expect(affectsSite('./src/App.tsx')).toBe(true);
  });

  it('agrees with every file and folder the repository tracks at its top level', () => {
    // a new top-level file or folder has to be put on one side here on purpose
    const site = ['index.html', 'package-lock.json', 'package.json', 'public', 'src', 'tsconfig.app.json', 'tsconfig.json', 'tsconfig.node.json', 'vite.config.ts'];
    const list = (...args: string[]) => execFileSync('git', ['ls-tree', ...args, '--name-only', 'HEAD'], { encoding: 'utf8' }).split('\n').filter(Boolean);
    const folders = new Set(list('-d'));
    expect(list().filter((n) => affectsSite(folders.has(n) ? `${n}/x` : n)).sort()).toEqual(site);
  });
});

describe('VERSION', () => {
  it('takes X.Y.Z only (what vite.config.ts lets HCP_VERSION be)', () => {
    for (const v of ['0.0.0', '1.2.0', '1.10.3', '10.0.0']) expect(VERSION.test(v)).toBe(true);
    for (const v of ['dev', '', '1.2', 'v1.2.0', '01.2.0', '1.02.0', '1.2.0-beta', '1.2.0/../x', ' 1.2.0', '1.2.0\n']) expect(VERSION.test(v)).toBe(false);
  });
});
