// Reads the players' lines a deploy puts at the top of its release notes from CHANGELOG.md (the API
// and its doc blocks are in release-notes.d.mts; the rules in docs/releases.md). Plain Node with no
// dependencies: the deploy runs it before npm ci. Usage: node scripts/release-notes.mjs <vX.Y.Z>,
// naming the release before this one.
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchTag } from './release-version.mjs';

export const CHANGELOG = 'CHANGELOG.md';
export const UPCOMING = 'Unreleased';

// a release's tag, as release-version.mjs names it
const TAG = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

// an item as compared between two copies of the file: a rewrap or a changed indent is no new line
const same = (item) => item.replace(/\s+/g, ' ').trim();

/**
 * Read a changelog's sections, groups and items.
 *
 * @param text The file's text.
 * @return Each "## " section with its "### " groups (the first, untitled, holds items above any
 *   group) and their "- " items, a wrapped item joined into one line.
 */
function read(text) {
  const sections = [];
  let group = null; // the group items go to
  let open = false; // the last line belonged to an item, so an indented line continues it
  for (const line of text.replace(/\r\n?/g, '\n').split('\n')) {
    const section = /^##\s+(.*\S)\s*$/.exec(line);
    const sub = /^###\s+(.*\S)\s*$/.exec(line);
    const item = /^-\s+(.*\S)\s*$/.exec(line);
    if (section) {
      group = { title: null, items: [] };
      sections.push({ title: section[1], groups: [group] });
      open = false;
    } else if (sub) {
      const s = sections[sections.length - 1];
      group = s ? { title: sub[1], items: [] } : null;
      if (s && group) s.groups.push(group);
      open = false;
    } else if (item) {
      if (group) group.items.push(item[1]);
      open = !!group;
    } else if (open && /^\s+\S/.test(line)) {
      group.items[group.items.length - 1] += ` ${line.trim()}`;
    } else {
      open = false;
    }
  }
  return sections;
}

export function releaseNotes(current, previous) {
  const upcoming = read(current).find((s) => s.title.toLowerCase() === UPCOMING.toLowerCase());
  if (!upcoming) return '';
  // how many more times the file holds each line now than the previous release's copy did: counted,
  // not just looked up, so a line that repeats an earlier release's ("Small fixes.") is still new
  const extra = new Map();
  const count = (text, by) => {
    for (const s of read(text)) for (const g of s.groups) for (const i of g.items) extra.set(same(i), (extra.get(same(i)) ?? 0) + by);
  };
  count(current, 1);
  count(previous, -1);
  const blocks = [];
  for (const g of upcoming.groups) {
    const items = g.items.filter((i) => {
      const left = extra.get(same(i)) ?? 0;
      extra.set(same(i), left - 1);
      return left > 0;
    });
    if (items.length) blocks.push([...(g.title ? [`### ${g.title}`, ''] : []), ...items.map((i) => `- ${same(i)}`)].join('\n'));
  }
  return blocks.length ? `${blocks.join('\n\n')}\n` : '';
}

/** The command line: reads the new lines and hands them to the workflow ($GITHUB_OUTPUT). */
function main() {
  const previous = process.argv[2] ?? '';
  if (!TAG.test(previous)) throw new Error(`Name the release before this one (vX.Y.Z) to read the changelog since (got "${previous}").`);
  const git = (...args) => execFileSync('git', args, { encoding: 'utf8' });
  // the deploy's checkout holds main's tip only: the previous release's commit is fetched to read
  // its copy of the file
  const ref = fetchTag(previous);
  // a release from before the changelog has no copy: every line is new then
  const had = git('ls-tree', '--name-only', ref, '--', CHANGELOG).trim() !== '';
  const before = had ? git('show', `${ref}:${CHANGELOG}`) : '';
  const notes = releaseNotes(existsSync(CHANGELOG) ? readFileSync(CHANGELOG, 'utf8') : '', before);
  if (process.env.GITHUB_OUTPUT) {
    // a multi-line value, closed by a line no changelog text can hold
    const end = `end-${randomUUID()}`;
    appendFileSync(process.env.GITHUB_OUTPUT, `notes<<${end}\n${notes}${end}\n`);
  }
  if (notes) console.log(`Changelog lines new since ${previous}:\n\n${notes}`);
  else console.log(`${process.env.GITHUB_ACTIONS ? '::notice::' : ''}${CHANGELOG} has no lines new since ${previous}: the release notes list the pull requests only.`);
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
