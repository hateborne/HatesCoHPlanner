// Types and doc blocks for deploy-report.mjs (plain Node: the deploy's last job runs it).

/** The first target's name: the site on GitHub Pages. */
export declare const PAGES: string;

/** The second target's name: the site on its own domain (docs/hosting.md). */
export declare const DOMAIN: string;

/** One job of the deploy, as the workflow's `needs` context gives it to the job that reports. */
export interface NeededJob {
  result: string; // "success", "failure", "cancelled" or "skipped"
  outputs?: Record<string, string>; // prepare's: version, fresh, and domain ("needed", "has-file", "older" or "unknown": pages.yml)
}

/** What a deploy left one target with. */
export interface TargetReport {
  name: string; // PAGES or DOMAIN
  // unconfirmed: published, but not seen live; unchecked: left alone because its release could not be read
  state: 'live' | 'unchanged' | 'failed' | 'unconfirmed' | 'unchecked';
  text: string; // one sentence for the summary and, when it needs attention, the error
}

/** What a deploy did, target by target. */
export interface DeployReport {
  ok: boolean; // every target is where it should be (live, or rightly left as it was)
  version: string; // "v1.2.0" ("the new version" when none was picked)
  targets: TargetReport[]; // GitHub Pages, then the domain
  todo: string[]; // what to do about the targets that need attention
}

/**
 * Work out what a deploy did for each target from its jobs' results.
 *
 * A target counts on its own: one whose build or publishing failed is reported as left on the
 * version it had, whatever the other did. Only what both share takes both down: the first job's
 * checks, and the release's tag. A target is live only when its own last stage says so.
 *
 * @param needs The reporting job's `needs` context: each job of pages.yml by its id.
 * @return The report; `ok` is false when any target failed, was not seen live or was not checked.
 */
export declare function deployReport(needs: Record<string, NeededJob> | null | undefined): DeployReport;

/**
 * Write a report out for GitHub.
 *
 * @param report The report.
 * @return The run summary (Markdown), and one workflow error command per target that needs attention.
 */
export declare function renderReport(report: DeployReport): { summary: string; errors: string[] };
