/**
 * The deploy's report (scripts/deploy-report.mjs): what each target, GitHub Pages and the site's
 * own domain, got from a run of pages.yml, read from its jobs' results. The report never blames
 * one target for the other's failure, never calls a target live that its own last stage did not
 * put live, and is not ok whenever a target needs attention (docs/releases.md, "The deploy's
 * stages"). The jobs' own order and conditions are the workflow's, and are not tested here.
 */
import { describe, expect, it } from 'vitest';
import { deployReport, DOMAIN, type NeededJob, PAGES, renderReport } from '../scripts/deploy-report.mjs';

/** The jobs of pages.yml that the report reads, in order. */
const JOBS = ['prepare', 'release', 'build-pages', 'build-domain', 'deploy-pages', 'publish-domain', 'check-domain'];
/** A new version: tagged, and its site file still to attach. */
const NEW = { version: '1.2.0', fresh: 'true', domain: 'needed', attempt: '1' };

/**
 * A run's jobs as the reporting job sees them: all successful, but for the results given.
 *
 * @param results The jobs that ended otherwise, by id.
 * @param outputs What the first job gave out (a new version when omitted).
 * @return The `needs` context.
 */
function run(results: Record<string, string> = {}, outputs: Record<string, string> = NEW): Record<string, NeededJob> {
  return Object.fromEntries(JOBS.map((j) => [j, { result: results[j] ?? 'success', ...(j === 'prepare' ? { outputs } : {}) }]));
}

/** The domain's jobs, skipped: what a run looks like when the domain is left alone. */
const NO_DOMAIN = { 'build-domain': 'skipped', 'publish-domain': 'skipped', 'check-domain': 'skipped' };

/** @return Each target's state, GitHub Pages first. */
const states = (needs: Record<string, NeededJob> | null) => deployReport(needs).targets.map((t) => t.state);

describe('deployReport', () => {
  it('reports both targets live when every stage passed', () => {
    const r = deployReport(run());
    expect(r.ok).toBe(true);
    expect(r.version).toBe('v1.2.0');
    expect(r.targets.map((t) => [t.name, t.state, t.text])).toEqual([
      [PAGES, 'live', 'Live as v1.2.0.'],
      [DOMAIN, 'live', 'Live as v1.2.0.'],
    ]);
    expect(r.todo).toEqual([]);
  });

  it("keeps GitHub Pages live when one of the domain's stages fails", () => {
    for (const [results, about] of [
      [{ 'build-domain': 'failure', 'publish-domain': 'skipped', 'check-domain': 'skipped' }, /its build failed/],
      [{ 'publish-domain': 'failure', 'check-domain': 'skipped' }, /could not be attached to release v1\.2\.0/],
    ] as const) {
      const r = deployReport(run(results));
      expect(r.ok).toBe(false);
      expect(r.targets[0]).toEqual({ name: PAGES, state: 'live', text: 'Live as v1.2.0.' });
      expect(r.targets[1]!.state).toBe('failed');
      expect(r.targets[1]!.text).toMatch(about);
      expect(r.targets[1]!.text).toMatch(/stays on the version it had/);
      expect(r.todo.join(' ')).toMatch(/Re-run failed jobs/);
    }
  });

  it('keeps the domain live when a GitHub Pages stage fails', () => {
    const failures: Record<string, string>[] = [{ 'build-pages': 'failure', 'deploy-pages': 'skipped' }, { 'deploy-pages': 'failure' }];
    for (const results of failures) {
      const r = deployReport(run(results));
      expect(r.ok).toBe(false);
      expect(r.targets.map((t) => t.state)).toEqual(['failed', 'live']);
      expect(r.targets[0]!.text).toMatch(/Not deployed.*stays on the version it had/);
      expect(r.todo.join(' ')).toMatch(/Re-run failed jobs/);
      // the way back for an old run that a newer deploy has since passed
      expect(r.todo.join(' ')).toMatch(/newer version has gone out since, start a new deploy/);
    }
  });

  it('says the domain was published but not seen live, and points at its host', () => {
    const r = deployReport(run({ 'check-domain': 'failure' }));
    expect(r.ok).toBe(false);
    expect(r.targets.map((t) => t.state)).toEqual(['live', 'unconfirmed']);
    expect(r.targets[1]!.text).toMatch(/carries its site file, but the domain was not seen serving it/);
    expect(r.todo).toHaveLength(1);
    expect(r.todo[0]).toMatch(/On the host/);
    // once the host is put right, the same button has the domain looked at again
    expect(r.todo[0]).toMatch(/Re-run failed jobs/);
  });

  it('counts a job that was stopped as one that failed', () => {
    expect(states(run({ 'check-domain': 'cancelled' }))).toEqual(['live', 'unconfirmed']);
    expect(states(run({ 'deploy-pages': 'cancelled' }))).toEqual(['failed', 'live']);
    expect(states(run({ 'build-domain': 'cancelled', 'publish-domain': 'skipped', 'check-domain': 'skipped' }))).toEqual(['live', 'failed']);
  });

  it('leaves the domain alone, rightly, when its release has its site file or is not the newest', () => {
    const again = { release: 'skipped', ...NO_DOMAIN }; // a deploy under a version that exists
    const has = deployReport(run(again, { version: '1.2.0', fresh: 'false', domain: 'has-file', attempt: '1' }));
    expect(has.ok).toBe(true);
    expect(has.targets.map((t) => t.state)).toEqual(['live', 'unchanged']);
    expect(has.targets[1]!.text).toMatch(/already carries its site file/);

    // an older release put back on GitHub Pages: the domain only moves forward on its own
    const older = deployReport(run(again, { version: '1.1.0', fresh: 'false', domain: 'older', attempt: '1' }));
    expect(older.ok).toBe(true);
    expect(older.targets.map((t) => [t.state, t.text])).toEqual([
      ['live', 'Live as v1.1.0.'],
      ['unchanged', 'Left as it is: v1.1.0 is not the newest release, and the domain only moves forward on its own.'],
    ]);
  });

  it("flags a domain it could not look at, without taking GitHub Pages down with it", () => {
    for (const domain of ['unknown', '', 'true']) {
      const r = deployReport(run({ release: 'skipped', ...NO_DOMAIN }, { version: '1.2.0', fresh: 'false', domain, attempt: '1' }));
      expect(r.ok, domain).toBe(false);
      expect(r.targets.map((t) => t.state), domain).toEqual(['live', 'unchecked']);
      expect(r.todo.join(' ')).toMatch(/Re-run all jobs/);
    }
  });

  it("runs the domain's stages again for a version whose release still lacks its site file", () => {
    // not a new version (no release job), but the earlier deploy's domain stages failed
    const r = deployReport(run({ release: 'skipped' }, { version: '1.2.0', fresh: 'false', domain: 'needed', attempt: '1' }));
    expect(r.ok).toBe(true);
    expect(r.targets.map((t) => t.state)).toEqual(['live', 'live']);
  });

  it('takes both targets down only for what they share: the first checks and the tag', () => {
    const skipped = Object.fromEntries(JOBS.slice(1).map((j) => [j, 'skipped']));
    const checks = deployReport(run({ ...skipped, prepare: 'failure' }, {}));
    expect(checks.ok).toBe(false);
    expect(checks.version).toBe('the new version');
    expect(checks.targets.map((t) => t.state)).toEqual(['failed', 'failed']);
    expect(checks.targets[0]!.text).toMatch(/the checks every target shares did not pass/);
    expect(checks.todo.join(' ')).toMatch(/start a new deploy/);

    // the builds ran beside the tag, but nothing is published without it
    const tag = deployReport(run({ release: 'failure', 'deploy-pages': 'skipped', 'publish-domain': 'skipped', 'check-domain': 'skipped' }));
    expect(tag.targets.map((t) => t.state)).toEqual(['failed', 'failed']);
    expect(tag.targets[1]!.text).toMatch(/v1\.2\.0 could not be tagged/);
    expect(tag.todo.join(' ')).toMatch(/Re-run all jobs/);

    // both builds failed after the tag: each target reports its own build
    const builds = deployReport(run({ 'build-pages': 'failure', 'build-domain': 'failure', 'deploy-pages': 'skipped', 'publish-domain': 'skipped', 'check-domain': 'skipped' }));
    expect(builds.targets.map((t) => [t.state, /its build failed/.test(t.text)])).toEqual([['failed', true], ['failed', true]]);
  });

  it('never calls a target live that its own last stage did not put live', () => {
    // jobs missing, or skipped for a reason the report doesn't know: not deployed, and not ok
    expect(states(null)).toEqual(['failed', 'failed']);
    expect(states({})).toEqual(['failed', 'failed']);
    expect(states(run({ 'deploy-pages': 'skipped' }))).toEqual(['failed', 'live']);
    expect(states(run({ 'check-domain': 'skipped' }))).toEqual(['live', 'failed']);
    for (const job of ['prepare', 'deploy-pages', 'check-domain']) expect(deployReport(run({ [job]: 'skipped' })).ok, job).toBe(false);
    // whichever job fails or is stopped, the report is not ok and says what to do
    for (const job of JOBS) {
      for (const result of ['failure', 'cancelled']) {
        const r = deployReport(run({ [job]: result }));
        expect(r.ok, `${job} ${result}`).toBe(false);
        expect(r.todo.length, `${job} ${result}`).toBeGreaterThan(0);
      }
    }
  });
});

describe('renderReport', () => {
  it('writes a summary table and no error when all is well', () => {
    const { summary, errors } = renderReport(deployReport(run()));
    expect(summary).toContain('## Deploy of v1.2.0: every target is where it should be');
    expect(summary).toContain(`| ${PAGES} | Live | Live as v1.2.0. |`);
    expect(summary).toContain(`| ${DOMAIN} | Live | Live as v1.2.0. |`);
    expect(summary).not.toContain('What to do');
    expect(errors).toEqual([]);

    // a domain rightly left alone is no error either
    const left = renderReport(deployReport(run({ release: 'skipped', ...NO_DOMAIN }, { version: '1.2.0', fresh: 'false', domain: 'has-file', attempt: '1' })));
    expect(left.summary).toContain(`| ${DOMAIN} | Unchanged |`);
    expect(left.errors).toEqual([]);
  });

  it('names the target that needs attention, in the summary and as an error on the run', () => {
    const { summary, errors } = renderReport(deployReport(run({ 'publish-domain': 'failure', 'check-domain': 'skipped' })));
    expect(summary).toContain('a target needs attention');
    expect(summary).toContain(`| ${PAGES} | Live |`);
    expect(summary).toContain(`| ${DOMAIN} | FAILED |`);
    expect(summary).toContain('### What to do');
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(new RegExp(`^::error title=${DOMAIN}::Not deployed`));
    expect(errors[0]).not.toContain('\n'); // a workflow command is one line

    const late = renderReport(deployReport(run({ 'check-domain': 'failure' })));
    expect(late.summary).toContain(`| ${DOMAIN} | NOT CONFIRMED |`);
    expect(late.errors).toHaveLength(1);

    const unread = renderReport(deployReport(run({ release: 'skipped', ...NO_DOMAIN }, { version: '1.2.0', fresh: 'false', domain: 'unknown', attempt: '1' })));
    expect(unread.summary).toContain(`| ${DOMAIN} | NOT CHECKED |`);
    expect(unread.errors).toHaveLength(1);
  });
});
