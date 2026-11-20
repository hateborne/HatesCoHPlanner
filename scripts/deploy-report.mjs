// Says what a deploy did for each of its targets (GitHub Pages, the site's own domain) from the
// results of its jobs. The last job of pages.yml runs it, so a target that failed while the other
// went live is spelled out on the run's summary page, with what to do about it. The API and its doc
// blocks are in deploy-report.d.mts; the stages are in docs/releases.md, "The deploy's stages".
// Plain Node with no dependencies. Usage: NEEDS='<the job's needs, as JSON>' node scripts/deploy-report.mjs
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

export function deployReport(needs) {
  const result = (job) => needs?.[job]?.result ?? 'skipped';
  // a job that was stopped (its time ran out) left its target as undone as one that failed
  const bad = (job) => result(job) === 'failure' || result(job) === 'cancelled';
  const out = needs?.prepare?.outputs ?? {};
  const version = out.version ? `v${out.version}` : 'the new version';
  const both = (text, todo) => ({
    ok: false,
    version,
    targets: [
      { name: PAGES, state: 'failed', text },
      { name: DOMAIN, state: 'failed', text },
    ],
    todo: [todo],
  });

  if (result('prepare') !== 'success') {
    return both(`Not deployed: the checks every target shares did not pass (the tests, the type check or the version pick). ${STAYS}`, 'Put right what the first job reports, then start a new deploy.');
  }
  if (bad('release')) return both(`Not deployed: ${version} could not be tagged. ${STAYS}`, RETRY_ALL);

  let pages;
  if (bad('build-pages')) pages = { state: 'failed', text: `Not deployed: its build failed. ${STAYS}` };
  else if (bad('deploy-pages')) pages = { state: 'failed', text: `Not deployed: the deploy to GitHub Pages failed. ${STAYS}` };
  else if (result('deploy-pages') === 'success') pages = { state: 'live', text: `Live as ${version}.` };
  else pages = { state: 'failed', text: `Not deployed. ${STAYS}` };

  let domain;
  if (out.domain === 'has-file') domain = { state: 'unchanged', text: `Left as it is: release ${version} already carries its site file.` };
  else if (out.domain === 'older') domain = { state: 'unchanged', text: `Left as it is: ${version} is not the newest release, and the domain only moves forward on its own.` };
  else if (out.domain !== 'needed') domain = { state: 'unchecked', text: `Left as it is: release ${version} could not be read, so it is not known whether the domain still needs it.` };
  else if (bad('build-domain')) domain = { state: 'failed', text: `Not deployed: its build failed. ${STAYS}` };
  else if (bad('publish-domain')) domain = { state: 'failed', text: `Not deployed: its site file could not be attached to release ${version}. ${STAYS}` };
  else if (bad('check-domain')) domain = { state: 'unconfirmed', text: `Release ${version} carries its site file, but the domain was not seen serving it within 20 minutes.` };
  else if (result('check-domain') === 'success') domain = { state: 'live', text: `Live as ${version}.` };
  else domain = { state: 'failed', text: `Not deployed. ${STAYS}` };

  const targets = [
    { name: PAGES, ...pages },
    { name: DOMAIN, ...domain },
  ];
  const todo = [];
  if (targets.some((t) => t.state === 'failed')) todo.push(RETRY);
  if (domain.state === 'unconfirmed') todo.push(SEE_HOST);
  if (domain.state === 'unchecked') todo.push(ASK_AGAIN);
  return { ok: todo.length === 0, version, targets, todo };
}

const MARK = { live: 'Live', unchanged: 'Unchanged', failed: 'FAILED', unconfirmed: 'NOT CONFIRMED', unchecked: 'NOT CHECKED' };
// the states that are as they should be; any other is an error on the run
const FINE = ['live', 'unchanged'];

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
  const report = deployReport(JSON.parse(process.env.NEEDS || 'null'));
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
