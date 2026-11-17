// Types and doc blocks for audit-dev.mjs (plain Node: the audit job installs nothing).

/** An advisory the development tools' audit lets through until a fixed release exists. */
export interface AllowedAdvisory {
  id: string; // its GHSA id
  package: string; // the npm package it is about
  added: string; // when it was allowed (YYYY-MM-DD)
  why: string; // why it can wait: what uses the package, and why the advisory doesn't reach the site
}

/** The advisories the check lets through. */
export declare const ALLOWED: readonly AllowedAdvisory[];

/** A high or critical advisory found by npm audit. */
export interface FoundAdvisory {
  id: string; // its GHSA id (else npm's advisory number)
  name: string; // the package
  title: string;
  severity: string; // "high" or "critical"
  url: string;
}

/**
 * Sort an npm audit report's high and critical advisories into those that fail the check and the
 * allowed ones.
 *
 * @param report The parsed `npm audit --json` output (npm 7 or later).
 * @param allowed The advisories let through (ALLOWED).
 * @return The failing advisories, the allowed ones found, and the allowed ids not found (stale).
 */
export declare function sortAdvisories(
  report: unknown,
  allowed?: readonly AllowedAdvisory[],
): { failing: FoundAdvisory[]; allowed: FoundAdvisory[]; stale: string[] };
