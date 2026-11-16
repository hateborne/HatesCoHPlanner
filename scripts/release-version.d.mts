// Types and doc blocks for release-version.mjs (plain Node, so the deploy runs it before npm ci).

/** The bumps a deploy can pick (AGENTS.md, "Versions and releases", says which fits a change). */
export declare const BUMPS: readonly string[];

/** A release's version, "1.2.0" (SemVer's numbers, no leading zeros, no "v"); vite.config.ts checks HCP_VERSION against it. */
export declare const VERSION: RegExp;

/** The version a deploy publishes. */
export interface Release {
  version: string; // "1.2.0" (its tag is "v1.2.0")
  fresh: boolean; // true: a new version, to be tagged; false: the commit already carries this one
  previous: string | null; // the newest earlier tag ("v1.1.0"), where its release notes start; null when reused
}

/**
 * Pick the version a deploy of one commit publishes.
 *
 * A commit that already carries a version tag keeps it, whatever bump was picked (a redeploy).
 * Otherwise the commit must be main's tip, so re-running an old run that failed before tagging
 * can't give older code the next number; the newest version tag is then bumped: major, minor or
 * patch, each resetting the parts after it. Only tags named vX.Y.Z count; an annotated tag counts
 * for the commit it points at.
 *
 * @param lsRemote The output of `git ls-remote --heads --tags origin`.
 * @param head The commit being deployed (its full sha).
 * @param bump "major", "minor" or "patch".
 * @return The version, whether it is new, and the tag before it.
 * @throws When no version tag exists yet (v1.0.0 is tagged by hand), or a new version is needed and
 *   the commit isn't main's tip or the bump is none of the three.
 */
export declare function nextRelease(lsRemote: string, head: string, bump: string): Release;
