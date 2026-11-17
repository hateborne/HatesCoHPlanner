// Types and doc blocks for release-version.mjs (plain Node, so the deploy runs it before npm ci).

/** The bumps a deploy can pick (AGENTS.md, "Versions and releases", says which fits a change). */
export declare const BUMPS: readonly string[];

/** A release's version, "1.2.0" (SemVer's numbers, no leading zeros, no "v"); vite.config.ts checks HCP_VERSION against it. */
export declare const VERSION: RegExp;

/** The version a deploy publishes. */
export interface Release {
  version: string; // "1.2.0" (its tag is "v1.2.0")
  fresh: boolean; // true: a new version, to be tagged; false: the commit deploys under an existing one
  previous: string | null; // the newest earlier tag ("v1.1.0"), where its release notes start; null when reused
  unchanged?: true; // reused because nothing the site is built from changed since the newest version
}

/**
 * Whether a change to a file can change the published site.
 *
 * Docs, tests, CI and deploy workflows, the data pipeline's code and other tooling are not the
 * application: a deploy of such changes alone keeps its version. src/ and public/ always count,
 * and so does any path the script doesn't list (the build's configuration and dependencies, a new
 * top-level file), so the doubt goes toward a new version.
 *
 * @param path The file's path from the repository root ("src/App.tsx", "docs/releases.md").
 * @return False only for a path the site is known not to be built from.
 */
export declare function affectsSite(path: string): boolean;

/**
 * Pick the version a deploy of one commit publishes.
 *
 * A commit that already carries a version tag keeps it, whatever bump was picked (a redeploy).
 * Otherwise the commit must be main's tip, so re-running an old run that failed before tagging
 * can't give older code the next number. If nothing the site is built from changed since the
 * newest version (affectsSite), the commit deploys under that version again, whatever bump was
 * picked. Otherwise the newest version tag is bumped: major, minor or patch, each resetting the
 * parts after it. Only tags named vX.Y.Z count; an annotated tag counts for the commit it points at.
 *
 * @param lsRemote The output of `git ls-remote --heads --tags origin`.
 * @param head The commit being deployed (its full sha).
 * @param bump "major", "minor" or "patch".
 * @param changedSince Lists every path that differs between a release (its tag and commit) and the
 *   commit being deployed; asked only for main's tip without a tag of its own. Left out, every
 *   untagged commit counts as changed.
 * @return The version, whether it is new, and the tag before it.
 * @throws When no version tag exists yet (v1.0.0 is tagged by hand), or a new version is needed and
 *   the commit isn't main's tip or the bump is none of the three.
 */
export declare function nextRelease(lsRemote: string, head: string, bump: string, changedSince?: (release: { name: string; commit: string }) => string[]): Release;

/**
 * Make a release's tag readable in this checkout, fetching it from origin when it is missing (the
 * deploy's checkout holds main's tip only).
 *
 * @param tag The release's tag ("v1.1.0").
 * @return Its full ref name ("refs/tags/v1.1.0").
 * @throws When the name is no release tag, or origin doesn't have it.
 */
export declare function fetchTag(tag: string): string;
