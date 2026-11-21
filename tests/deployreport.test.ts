/**
 * The deploy's report (scripts/deploy-report.mjs): what each target, GitHub Pages and the site's
 * own domain, got from a run of pages.yml, read from its jobs' results and the run's target. The
 * report never blames one target for the other's failure or for a run it was left out of, never
 * calls a target live that its own last stage did not put live, and is not ok whenever a target
 * the run was for needs attention (docs/releases.md, "The deploy's stages"). The jobs' own order
 * and conditions are the workflow's, and are not tested here.
 */
import { describe, expect, it } from 'vitest';
import { CHANGES, deployReport, DOMAIN, type NeededJob, PAGES, renderReport } from '../scripts/deploy-report.mjs';

/** The jobs of pages.yml that the report reads, in order. */
const JOBS = ['prepare', 'release', 'stamp-changelog', 'build-pages', 'build-domain', 'deploy-pages', 'publish-domain', 'check-domain'];
/** A new version, deployed to both targets: tagged, and its site file still to attach. */
const NEW = { version: '1.2.0', fresh: 'true', pages: 'true', domain: 'needed', attempt: '1' };
/** The same version again: no tag to make. */
const AGAIN = { version: '1.2.0', fresh: 'false', pages: 'true', attempt: '1' };

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
const states = (needs: Record<string, NeededJob> | null, target?: 'both' | 'pages' | 'domain') => deployReport(needs, target).targets.map((t) => t.state);

describe('deployReport', () => {
  it("reports the changelog's stamp on its own, failing the run but neither site", () => {
    const stamped = (outcome: string) => ({ ...run(), 'stamp-changelog': { result: 'success', outputs: { outcome } } });
    expect(deployReport(stamped('stamped')).changelog).toEqual({ state: 'done', text: "Stamped: v1.2.0's lines are under their own heading on main." });
    expect(deployReport(stamped('already')).changelog.state).toBe('done');
    expect(deployReport(stamped('empty')).changelog.text).toMatch(/shipped no changelog lines/);
    for (const result of ['failure', 'cancelled']) {
      const r = deployReport(run({ 'stamp-changelog': result }));
      expect(r.ok).toBe(false);
      expect(r.changelog.state).toBe('failed');
      expect(r.targets.map((t) => t.state)).toEqual(['live', 'live']);
      expect(r.todo.join(' ')).toMatch(/Re-run failed jobs/);
      const { summary, errors } = renderReport(r);
      expect(summary).toContain(`| ${CHANGES} | FAILED |`);
      expect(errors).toEqual([`::error title=${CHANGES}::${r.changelog.text}`]);
    }
    // the same in a run for one target alone
    expect(deployReport(run({ 'stamp-changelog': 'failure', ...NO_DOMAIN }, { ...NEW, domain: 'off' }), 'pages').changelog.state).toBe('failed');
    // no new version: nothing to stamp, and the run is fine
    const again = deployReport(run({ release: 'skipped', 'stamp-changelog': 'skipped' }, { ...AGAIN, domain: 'has-file' }));
    expect(again.changelog).toEqual({ state: 'skipped', text: 'Nothing to stamp: no new version.' });
    expect(again.ok).toBe(true);
    // no tag made: the tag's failure is what the report blames
    expect(deployReport(run({ release: 'failure', 'stamp-changelog': 'skipped' })).changelog.text).toBe('Not stamped: no release was made.');
  });

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

  it('only looks at the domain when its release has its site file already, and still says when it is not live', () => {
    // nothing to build or attach: the check alone runs
    const jobs = { release: 'skipped', 'build-domain': 'skipped', 'publish-domain': 'skipped' };
    const live = deployReport(run(jobs, { ...AGAIN, domain: 'has-file' }));
    expect(live.ok).toBe(true);
    expect(live.targets.map((t) => [t.state, t.text])).toEqual([
      ['live', 'Live as v1.2.0.'],
      ['live', 'Live as v1.2.0.'],
    ]);

    const stuck = deployReport(run({ ...jobs, 'check-domain': 'failure' }, { ...AGAIN, domain: 'has-file' }));
    expect(stuck.ok).toBe(false);
    expect(stuck.targets.map((t) => t.state)).toEqual(['live', 'unconfirmed']);
    expect(stuck.todo.join(' ')).toMatch(/On the host/);

    // the check did not run at all: never called live
    expect(states(run({ ...jobs, 'check-domain': 'skipped' }, { ...AGAIN, domain: 'has-file' }))).toEqual(['live', 'failed']);
  });

  it('leaves the domain alone, rightly, when the release put back on GitHub Pages is not the newest', () => {
    const again = { release: 'skipped', ...NO_DOMAIN }; // a deploy under a version that exists
    // an older release put back on GitHub Pages: the domain only moves forward on its own
    const older = deployReport(run(again, { version: '1.1.0', fresh: 'false', pages: 'true', domain: 'older', attempt: '1' }));
    expect(older.ok).toBe(true);
    expect(older.targets.map((t) => [t.state, t.text])).toEqual([
      ['live', 'Live as v1.1.0.'],
      ['unchanged', 'Left as it is: v1.1.0 is not the newest release, and the domain only moves forward on its own.'],
    ]);
  });

  it("flags a domain it could not look at, without taking GitHub Pages down with it", () => {
    for (const domain of ['unknown', '', 'true']) {
      const r = deployReport(run({ release: 'skipped', ...NO_DOMAIN }, { ...AGAIN, domain }));
      expect(r.ok, domain).toBe(false);
      expect(r.targets.map((t) => t.state), domain).toEqual(['live', 'unchecked']);
      expect(r.todo.join(' ')).toMatch(/Re-run all jobs/);
    }
  });

  it("runs the domain's stages again for a version whose release still lacks its site file", () => {
    // not a new version (no release job), but the earlier deploy's domain stages failed
    const r = deployReport(run({ release: 'skipped' }, { ...AGAIN, domain: 'needed' }));
    expect(r.ok).toBe(true);
    expect(r.targets.map((t) => t.state)).toEqual(['live', 'live']);
  });

  it('leaves out the target a run was not started for, and judges the run by the other alone', () => {
    const NO_PAGES = { 'build-pages': 'skipped', 'deploy-pages': 'skipped' };
    // the domain alone, to deploy it again after it failed: its release exists and lacks the file
    const domain = deployReport(run({ release: 'skipped', ...NO_PAGES }, { ...AGAIN, pages: 'false', domain: 'needed' }), 'domain');
    expect(domain.ok).toBe(true);
    expect(domain.targets.map((t) => [t.name, t.state])).toEqual([[PAGES, 'skipped'], [DOMAIN, 'live']]);
    expect(domain.targets[0]!.text).toBe('Not part of this run, which was started for the domain alone: it stays as it is.');
    expect(domain.todo).toEqual([]);

    // GitHub Pages alone
    const pages = deployReport(run({ release: 'skipped', ...NO_DOMAIN }, { ...AGAIN, domain: 'off' }), 'pages');
    expect(pages.ok).toBe(true);
    expect(pages.targets.map((t) => [t.name, t.state])).toEqual([[PAGES, 'live'], [DOMAIN, 'skipped']]);
    expect(pages.targets[1]!.text).toBe('Not part of this run, which was started for GitHub Pages alone: it stays as it is.');

    // the target asked for failing is the run failing; the one left out is never blamed
    const failed = deployReport(run({ release: 'skipped', ...NO_PAGES, 'publish-domain': 'failure', 'check-domain': 'skipped' }, { ...AGAIN, pages: 'false', domain: 'needed' }), 'domain');
    expect(failed.ok).toBe(false);
    expect(failed.targets.map((t) => t.state)).toEqual(['skipped', 'failed']);
    expect(states(run({ release: 'skipped', ...NO_DOMAIN, 'deploy-pages': 'failure' }, { ...AGAIN, domain: 'off' }), 'pages')).toEqual(['failed', 'skipped']);
    // nor when the tag could not be made
    expect(states(run({ release: 'failure', ...NO_PAGES, 'publish-domain': 'skipped', 'check-domain': 'skipped' }, { ...NEW, pages: 'false' }), 'domain')).toEqual(['skipped', 'failed']);
    expect(states(run({ release: 'failure', ...NO_DOMAIN, 'deploy-pages': 'skipped' }, { ...NEW, domain: 'off' }), 'pages')).toEqual(['failed', 'skipped']);
  });

  it("goes by the run's own target, so the other is not blamed even when the first job failed and gave nothing out", () => {
    const nothing = Object.fromEntries(JOBS.slice(1).map((j) => [j, 'skipped']));
    for (const ended of ['failure', 'cancelled']) {
      // the first job's outputs are missing: only the run's target says what it was for
      const pages = deployReport(run({ ...nothing, prepare: ended }, {}), 'pages');
      expect(pages.ok, ended).toBe(false);
      expect(pages.targets.map((t) => t.state), ended).toEqual(['failed', 'skipped']);
      expect(pages.targets[1]!.text, ended).toMatch(/started for GitHub Pages alone/);
      const domain = deployReport(run({ ...nothing, prepare: ended }, {}), 'domain');
      expect(domain.targets.map((t) => t.state), ended).toEqual(['skipped', 'failed']);
      expect(renderReport(pages).errors, ended).toHaveLength(1);
      expect(renderReport(pages).errors[0], ended).toContain(PAGES);
    }
    // a run for both, and one from before there was a target, blame both: both were asked for
    expect(states(run({ ...nothing, prepare: 'failure' }, {}), 'both')).toEqual(['failed', 'failed']);
    expect(states(run({ ...nothing, prepare: 'failure' }, {}))).toEqual(['failed', 'failed']);
  });

  it('says a site left out of a new version is now a version behind, and how to bring it up', () => {
    const NO_PAGES = { 'build-pages': 'skipped', 'deploy-pages': 'skipped' };
    const pagesOnly = deployReport(run(NO_DOMAIN, { ...NEW, domain: 'off' }), 'pages');
    expect(pagesOnly.ok).toBe(true); // the owner's choice: one target may release a new version
    expect(pagesOnly.targets.map((t) => t.state)).toEqual(['live', 'skipped']);
    expect(pagesOnly.targets[1]!.text).toMatch(/v1\.2\.0 is a new version, so the domain is now a version behind: run the deploy with target=domain \(or both\)/);
    const domainOnly = deployReport(run(NO_PAGES, { ...NEW, pages: 'false' }), 'domain');
    expect(domainOnly.targets.map((t) => t.state)).toEqual(['skipped', 'live']);
    expect(domainOnly.targets[0]!.text).toMatch(/GitHub Pages is now a version behind: run the deploy with target=pages \(or both\)/);
  });

  it('does not end well when a run for the domain alone could do nothing', () => {
    // an older release: the domain only moves forward on its own
    const jobs = { release: 'skipped', 'build-pages': 'skipped', 'deploy-pages': 'skipped', ...NO_DOMAIN };
    const r = deployReport(run(jobs, { version: '1.1.0', fresh: 'false', pages: 'false', domain: 'older', attempt: '1' }), 'domain');
    expect(r.ok).toBe(false);
    expect(r.targets.map((t) => t.state)).toEqual(['skipped', 'refused']);
    expect(r.targets[1]!.text).toMatch(/Nothing was done: v1\.1\.0 is not the newest release.*by hand, on its host/);
    expect(renderReport(r).summary).toContain(`| ${DOMAIN} | NOT DONE |`);
    // in a run for both, GitHub Pages got its older release back and the domain is rightly left: fine
    expect(deployReport(run({ release: 'skipped', ...NO_DOMAIN }, { version: '1.1.0', fresh: 'false', pages: 'true', domain: 'older', attempt: '1' }), 'both').ok).toBe(true);
  });

  it("words the domain check's other endings as what they are, not as a stuck host", () => {
    /** @return The domain's report when the check stopped for the reason given. */
    const stopped = (why: string) => {
      const needs = run({ 'check-domain': 'failure' });
      needs['check-domain']!.outputs = { why };
      const r = deployReport(needs);
      return { state: r.targets[1]!.state, text: r.targets[1]!.text, todo: r.todo.join(' '), ok: r.ok, pages: r.targets[0]!.state };
    };
    // a newer release went out before this run's check was run again: nothing to wait for
    const newer = stopped('newer');
    expect([newer.state, newer.ok, newer.pages]).toEqual(['unchecked', false, 'live']);
    expect(newer.text).toMatch(/a newer version than v1\.2\.0 has been released/);
    expect(newer.todo).toMatch(/Start a new deploy/);
    expect(newer.todo).not.toMatch(/On the host/);
    // GitHub did not answer, or did not hand the site file out
    for (const why of ['github', 'no-file']) {
      const r = stopped(why);
      expect([r.state, r.ok], why).toEqual(['unchecked', false]);
      expect(r.todo, why).toMatch(/Re-run failed jobs/);
      expect(r.todo, why).not.toMatch(/On the host/);
    }
    // the release's file is not the one its checksum names: the host refuses it
    const badFile = stopped('bad-file');
    expect([badFile.state, badFile.ok]).toEqual(['failed', false]);
    expect(badFile.todo).toMatch(/Delete planner-site\.tar\.gz from the release/);
    // the host never served it, or the check's own time ran out before it could say why
    for (const why of ['host', '']) {
      const r = stopped(why);
      expect(r.state, why).toBe('unconfirmed');
      expect(r.todo, why).toMatch(/On the host/);
    }
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

    // a domain rightly left alone, or left out of the run, is no error either
    const left = renderReport(deployReport(run({ release: 'skipped', ...NO_DOMAIN }, { version: '1.1.0', fresh: 'false', pages: 'true', domain: 'older', attempt: '1' })));
    expect(left.summary).toContain(`| ${DOMAIN} | Unchanged |`);
    expect(left.errors).toEqual([]);
    const out = renderReport(deployReport(run({ release: 'skipped', ...NO_DOMAIN }, { ...AGAIN, domain: 'off' }), 'pages'));
    expect(out.summary).toContain('every target is where it should be');
    expect(out.summary).toContain(`| ${DOMAIN} | Left out |`);
    expect(out.errors).toEqual([]);
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

    const unread = renderReport(deployReport(run({ release: 'skipped', ...NO_DOMAIN }, { ...AGAIN, domain: 'unknown' })));
    expect(unread.summary).toContain(`| ${DOMAIN} | NOT CHECKED |`);
    expect(unread.errors).toHaveLength(1);
  });
});
