import { describe, expect, it } from 'vitest';
import { BUMPS, nextRelease, VERSION } from '../scripts/release-version.mjs';

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

describe('VERSION', () => {
  it('takes X.Y.Z only (what vite.config.ts lets HCP_VERSION be)', () => {
    for (const v of ['0.0.0', '1.2.0', '1.10.3', '10.0.0']) expect(VERSION.test(v)).toBe(true);
    for (const v of ['dev', '', '1.2', 'v1.2.0', '01.2.0', '1.02.0', '1.2.0-beta', '1.2.0/../x', ' 1.2.0', '1.2.0\n']) expect(VERSION.test(v)).toBe(false);
  });
});
