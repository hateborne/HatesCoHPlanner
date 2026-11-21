// Types and doc blocks for changelog-stamp.mjs (plain Node: the deploy's stamp-changelog job runs it).

/** The time zone a release's heading date is written in. */
export declare const TIME_ZONE: string;

/**
 * A release's date as its changelog heading writes it.
 *
 * @param when The release's time.
 * @return "November 20, 2026", in TIME_ZONE.
 */
export declare function releaseDate(when: Date): string;

/** What stamping did to the file. */
export interface Stamp {
  // stamped: lines moved under the new heading; already: the version has its heading (a job run
  // again), the file is left as it is; empty: the release shipped no lines that are still upcoming
  outcome: 'stamped' | 'already' | 'empty';
  text: string; // the file to write ("stamped") or the file unchanged
}

/**
 * Move the lines a release shipped from "## Unreleased" to a heading of their own.
 *
 * main may have moved on since the release's commit, so only the lines that commit held in its
 * upcoming section move (counted, rewraps ignored); lines merged since stay upcoming. The new
 * section "## vX.Y.Z - Month D, YYYY" goes right below the upcoming one, with each line under its
 * "### " group as before. A version that has its heading already is never stamped twice.
 *
 * @param current CHANGELOG.md as main has it now.
 * @param released CHANGELOG.md as the release's commit has it.
 * @param version The release's version ("1.3.0", no "v").
 * @param date The release's date, as `releaseDate` writes it.
 * @return What was done and the file's text.
 * @raise Error when the version is malformed or main's file has no upcoming section.
 */
export declare function stampChangelog(current: string, released: string, version: string, date: string): Stamp;
