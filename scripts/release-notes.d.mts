// Types and doc blocks for release-notes.mjs (plain Node, so the deploy runs it before npm ci).

/** The players' changelog, at the repository root. */
export declare const CHANGELOG: string;

/** The title of the changelog section pull requests add their lines to ("## Unreleased"). */
export declare const UPCOMING: string;

/**
 * The players' lines a release announces: the changelog's upcoming section, without the lines the
 * release before it already had.
 *
 * The notes are read before the deploy moves the released lines under their version's heading
 * (scripts/changelog-stamp.mjs), and a stamp can fail or come late, so its lines are compared with
 * the previous release's copy of the file: a line that copy holds anywhere was announced then and is
 * left out, whether or not it has since been moved under its version's heading. Lines are counted, so one that repeats an earlier release's
 * word for word ("Small fixes.") is new when the file holds it once more than that copy did. A
 * group left with no lines is left out too. A line reworded after its release counts as new.
 *
 * @param current CHANGELOG.md as the commit being released has it.
 * @param previous CHANGELOG.md as the release before it had it ("" when it had none).
 * @return The lines as Markdown, under their "### " group headings and ending in a line break, or
 *   "" when nothing is new or the file has no upcoming section.
 */
export declare function releaseNotes(current: string, previous: string): string;
