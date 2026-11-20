// Types and doc blocks for deploy-report.mjs (plain Node: the deploy's last job runs it).

/** The first target's name: the site on GitHub Pages. */
export declare const PAGES: string;

/** The second target's name: the site on its own domain (docs/hosting.md). */
export declare const DOMAIN: string;

/** One job of the deploy, as the workflow's `needs` context gives it to the job that reports. */
export interface NeededJob {
  result: string; // "success", "failure", "cancelled" or "skipped"
  // prepare's: version, fresh and domain ("needed", "has-file", "older", "unknown", or "off" in a
  // run for GitHub Pages alone); check-domain's: why (what stopped the check: pages.yml)
  outputs?: Record<string, string>;
}

/** What a deploy left one target with. */
export interface TargetReport {
  name: string; // PAGES or DOMAIN
  // skipped: left out of a run started for the other target alone; refused: the run was for this
  // target alone and could do nothing for it; unconfirmed: published, but not seen live; unchecked:
  // not looked at (its release could not be read, or the check could not be made)
  state: 'live' | 'unchanged' | 'skipped' | 'failed' | 'refused' | 'unconfirmed' | 'unchecked';
  text: string; // one sentence for the summary and, when it needs attention, the error
}

/** What a deploy did, target by target. */
export interface DeployReport {
  ok: boolean; // every target the run was for is where it should be (live, or rightly left as it was)
  version: string; // "v1.2.0" ("the new version" when none was picked)
  targets: TargetReport[]; // GitHub Pages, then the domain
  todo: string[]; // what to do about the targets that need attention
}

/**
 * Work out what a deploy did for each target from its jobs' results.
 *
 * A target counts on its own: one whose build or publishing failed is reported as left on the
 * version it had, whatever the other did. Only what both share takes both down: the first job's
 * checks, and the release's tag. A target is live only when its own last stage says so, and a
 * target the run was not started for is left out, whatever its jobs' results read.
 *
 * @param needs The reporting job's `needs` context: each job of pages.yml by its id.
 * @param target What the run was started for (its `target` input); both when omitted. It comes
 *   from the run itself, not from a job, so it is known even when the first job failed.
 * @return The report; `ok` is false when a target the run was for failed, was not seen live, was
 *   not checked, or could not be done at all.
 */
export declare function deployReport(needs: Record<string, NeededJob> | null | undefined, target?: 'both' | 'pages' | 'domain'): DeployReport;

/**
 * Write a report out for GitHub.
 *
 * @param report The report.
 * @return The run summary (Markdown), and one workflow error command per target that needs attention.
 */
export declare function renderReport(report: DeployReport): { summary: string; errors: string[] };
