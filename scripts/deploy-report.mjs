// Says what a deploy did for each of its targets (GitHub Pages, the site's own domain) from the
// results of its jobs. The last job of pages.yml runs it, so a target that failed while the other
// went live is spelled out on the run's summary page, with what to do about it. The API and its doc
// blocks are in deploy-report.d.mts; the stages are in docs/releases.md, "The deploy's stages".
// Plain Node with no dependencies.
// Usage: NEEDS='<the job's needs, as JSON>' TARGET=<both|pages|domain> node scripts/deploy-report.mjs
import { appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PAGES = 'GitHub Pages';
export const DOMAIN = "The site's own domain";

const STAYS = 'It stays on the version it had.';
// only the failed target's jobs run again; the first job does not, so the version it picked stands
const RETRY =
  'Open this run and choose "Re-run failed jobs": the failed target alone is tried again, under the same version. If a newer version has gone out since, start a new deploy instead.';
const RETRY_ALL = 'Choose "Re-run all jobs" (the version pick sees whether the tag was made). If main has moved on since, start a new deploy instead.';
const SEE_HOST =
  'On the host, see what the update runs say (docs/hosting.md, "By hand"). Once that is put right the host fetches the release by itself; "Re-run failed jobs" then has the domain looked at again.';
const ASK_AGAIN = 'Choose "Re-run all jobs" to have the release read again.';
const LOOK_AGAIN = 'Choose "Re-run failed jobs" to have the domain looked at again.';
const NEW_DEPLOY = 'Start a new deploy: it brings both sites to the newest version.';
const ATTACH_AGAIN = 'Delete planner-site.tar.gz from the release on GitHub, then run the deploy for the domain (target=domain): it builds and attaches the file again.';

const MARK = { live: 'Live', unchanged: 'Unchanged', skipped: 'Left out', failed: 'FAILED', refused: 'NOT DONE', unconfirmed: 'NOT CONFIRMED', unchecked: 'NOT CHECKED' };
// the states that are as they should be; any other is an error on the run
const FINE = ['live', 'unchanged', 'skipped'];

export function deployReport(needs, target = 'both') {
  const result = (job) => needs?.[job]?.result ?? 'skipped';
  // a job that was stopped (its time ran out) left its target as undone as one that failed
  const bad = (job) => result(job) === 'failure' || result(job) === 'cancelled';
  const out = needs?.prepare?.outputs ?? {};
  const version = out.version ? `v${out.version}` : 'the new version';
  const todo = [];
  const done = (targets) => ({ ok: targets.every((t) => FINE.includes(t.state)), version, targets, todo: [...new Set(todo)] });

  // A run started for one target alone leaves the other out (pages.yml's `target` input). After a
  // new version that site is a version behind, which is said here, as nothing else will say it.
  const leftOut = (site, other, flag) => ({
    state: 'skipped',
    text:
      out.fresh === 'true'
        ? `Not part of this run, which was started for ${other} alone. ${version} is a new version, so ${site} is now a version behind: run the deploy with target=${flag} (or both) to bring it up.`
        : `Not part of this run, which was started for ${other} alone: it stays as it is.`,
  });
  const noPages = target === 'domain' ? leftOut('GitHub Pages', 'the domain', 'pages') : null;
  const noDomain = target === 'pages' ? leftOut('the domain', 'GitHub Pages', 'domain') : null;
  // what both targets share went wrong: each target the run was for is not deployed
  const both = (text, what) => {
    todo.push(what);
    return done([
      { name: PAGES, ...(noPages ?? { state: 'failed', text }) },
      { name: DOMAIN, ...(noDomain ?? { state: 'failed', text }) },
    ]);
  };

  if (result('prepare') !== 'success') {
    return both(`Not deployed: the checks every target shares did not pass (the tests, the type check or the version pick). ${STAYS}`, 'Put right what the first job reports, then start a new deploy.');
  }
  if (bad('release')) return both(`Not deployed: ${version} could not be tagged. ${STAYS}`, RETRY_ALL);

  const failed = (text) => {
    todo.push(RETRY);
    return { state: 'failed', text: `${text} ${STAYS}` };
  };

  let pages;
  if (noPages) pages = noPages;
  else if (bad('build-pages')) pages = failed('Not deployed: its build failed.');
  else if (bad('deploy-pages')) pages = failed('Not deployed: the deploy to GitHub Pages failed.');
  else if (result('deploy-pages') === 'success') pages = { state: 'live', text: `Live as ${version}.` };
  else pages = failed('Not deployed.');

  // "needed": built, attached, then looked at. "has-file": its release had the file already, so
  // only looked at (its build and attach jobs are skipped, and the lines for them pass over it).
  let domain;
  if (noDomain) domain = noDomain;
  else if (out.domain === 'older') {
    // nothing to do for the domain; a run that was for the domain alone has then done nothing at all
    const why = `${version} is not the newest release, and the domain only moves forward on its own.`;
    domain =
      target === 'domain'
        ? { state: 'refused', text: `Nothing was done: ${why} An older release goes back on the domain by hand, on its host (docs/hosting.md, "By hand").` }
        : { state: 'unchanged', text: `Left as it is: ${why}` };
  } else if (out.domain !== 'needed' && out.domain !== 'has-file') {
    todo.push(ASK_AGAIN);
    domain = { state: 'unchecked', text: `Left as it is: release ${version} could not be read, so it is not known whether the domain still needs it.` };
  } else if (bad('build-domain')) domain = failed('Not deployed: its build failed.');
  else if (bad('publish-domain')) domain = failed(`Not deployed: its site file could not be attached to release ${version}.`);
  else if (bad('check-domain')) {
    // why the check stopped (its own output); without one, its time ran out waiting for the host
    const why = needs?.['check-domain']?.outputs?.why;
    if (why === 'newer') {
      todo.push(NEW_DEPLOY);
      domain = { state: 'unchecked', text: `Not looked at: a newer version than ${version} has been released since this run started, and the domain only moves forward.` };
    } else if (why === 'github' || why === 'no-file') {
      todo.push(LOOK_AGAIN);
      domain = { state: 'unchecked', text: `Not looked at: GitHub did not give out what the domain is compared with (release ${version}'s site file, or the newest release's name).` };
    } else if (why === 'bad-file') {
      todo.push(ATTACH_AGAIN);
      domain = { state: 'failed', text: `Release ${version}'s site file does not match its checksum, so the host refuses it. ${STAYS}` };
    } else {
      todo.push(SEE_HOST);
      domain = { state: 'unconfirmed', text: `Release ${version} carries its site file, but the domain was not seen serving it within 20 minutes.` };
    }
  } else if (result('check-domain') === 'success') domain = { state: 'live', text: `Live as ${version}.` };
  else domain = failed('Not deployed.');

  return done([
    { name: PAGES, ...pages },
    { name: DOMAIN, ...domain },
  ]);
}

export function renderReport(report) {
  const summary = [
    `## Deploy of ${report.version}: ${report.ok ? 'every target is where it should be' : 'a target needs attention'}`,
    '',
    '| Target | Result | |',
    '|---|---|---|',
    ...report.targets.map((t) => `| ${t.name} | ${MARK[t.state]} | ${t.text} |`),
    ...(report.todo.length ? ['', '### What to do', '', ...report.todo.map((t) => `- ${t}`)] : []),
    '',
  ].join('\n');
  const errors = report.targets.filter((t) => !FINE.includes(t.state)).map((t) => `::error title=${t.name}::${t.text}`);
  return { summary, errors };
}

/** The command line: reads the jobs' results, writes the summary and the errors, and fails when a target needs attention. */
function main() {
  // a run started before the deploy had a target is for both
  const target = ['pages', 'domain'].includes(process.env.TARGET) ? process.env.TARGET : 'both';
  const report = deployReport(JSON.parse(process.env.NEEDS || 'null'), target);
  const { summary, errors } = renderReport(report);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
  else console.log(summary);
  for (const e of errors) console.log(process.env.GITHUB_ACTIONS ? e : e.replace(/^::error title=(.*?)::/, '$1: '));
  if (!report.ok) process.exit(1);
}

// run as a script, not when a test imports it
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (e) {
    console.error(`${process.env.GITHUB_ACTIONS ? '::error::' : ''}The deploy report could not be made: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }
}
