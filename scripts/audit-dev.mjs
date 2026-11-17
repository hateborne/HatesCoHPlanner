// The development tools' audit (CI, "Dependency audit"): npm audit's high and critical advisories
// fail it, except the few ALLOWED lists, each with its reason, until a fixed release exists. The
// API and its doc blocks are in audit-dev.d.mts. Plain Node with no dependencies (the audit job
// installs nothing). Usage: node scripts/audit-dev.mjs
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Advisories the check lets through, by GHSA id. Remove an entry once a fixed release is in the
// lockfile: the check warns when an allowed advisory no longer shows up.
export const ALLOWED = [
  {
    id: 'GHSA-fc5q-39xc-vjpf',
    package: 'picomatch',
    added: '2026-11-17',
    why:
      'ReDoS through attacker-written glob patterns; no fixed release yet (every picomatch up to ' +
      '4.0.7). Only the build and test tools use it (Vite via fdir and tinyglobby, Vitest), with ' +
      'the fixed patterns of our own config; nothing of it ships.',
  },
];

// the severities that fail the check
const FAILING = new Set(['high', 'critical']);

/** @return An advisory's GHSA id, read from its URL ("https://github.com/advisories/GHSA-..."). */
function ghsaOf(url) {
  const m = /GHSA(-[23456789cfghjmpqrvwx]{4}){3}/.exec(url ?? '');
  return m ? m[0] : null;
}

/**
 * Sort an npm audit report's high and critical advisories into those that fail the check and the
 * allowed ones.
 *
 * @param report The parsed `npm audit --json` output (npm 7 or later).
 * @param allowed The advisories let through (ALLOWED).
 * @return The failing advisories, the allowed ones found, and the allowed ids not found (stale).
 */
export function sortAdvisories(report, allowed = ALLOWED) {
  const ids = new Set(allowed.map((a) => a.id));
  const seen = new Map();
  for (const v of Object.values(report?.vulnerabilities ?? {})) {
    for (const via of v.via ?? []) {
      // a string names another vulnerable package; its own entry carries the advisory
      if (typeof via !== 'object' || !FAILING.has(via.severity)) continue;
      const id = ghsaOf(via.url) ?? `${via.source}`;
      seen.set(id, { id, name: via.name, title: via.title, severity: via.severity, url: via.url });
    }
  }
  const found = [...seen.values()];
  return {
    failing: found.filter((a) => !ids.has(a.id)),
    allowed: found.filter((a) => ids.has(a.id)),
    stale: [...ids].filter((id) => !seen.has(id)),
  };
}

/** The command line: runs npm audit and fails on any high or critical advisory not allowed. */
function main() {
  let out;
  try {
    out = execFileSync('npm', ['audit', '--json'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, shell: process.platform === 'win32' });
  } catch (e) {
    out = e.stdout; // npm audit exits 1 whenever it finds anything
  }
  const report = JSON.parse(out);
  if (report.error) throw new Error(`npm audit failed: ${report.error.summary ?? JSON.stringify(report.error)}`);
  const { failing, allowed, stale } = sortAdvisories(report);
  const gh = !!process.env.GITHUB_ACTIONS;
  for (const a of allowed) console.log(`Allowed: ${a.id} (${a.name}, ${a.severity}): ${ALLOWED.find((x) => x.id === a.id).why}`);
  for (const id of stale) console.log(`${gh ? '::warning::' : 'Warning: '}${id} no longer shows up: remove it from ALLOWED in scripts/audit-dev.mjs.`);
  for (const a of failing) console.error(`${gh ? '::error::' : ''}${a.severity}: ${a.name}: ${a.title} (${a.url})`);
  if (failing.length) process.exit(1);
  console.log('No high or critical advisory in the development tools that is not allowed.');
}

// run as a script, not when a test imports it
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (e) {
    console.error(`${process.env.GITHUB_ACTIONS ? '::error::' : ''}${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }
}
