// Moves the lines a release shipped from the changelog's "## Unreleased" to a heading of their own,
// "## vX.Y.Z - Month D, YYYY", on main (the API and its doc blocks are in changelog-stamp.d.mts; the
// rules in docs/releases.md, "The changelog"). Plain Node with no dependencies: the deploy's
// stamp-changelog job runs it on a checkout of main, then commits and pushes the file.
// Usage: node scripts/changelog-stamp.mjs <released CHANGELOG.md> <X.Y.Z> [<the release's ISO time>]
// It rewrites CHANGELOG.md in the working directory and prints the outcome (stamped, already or
// empty) as the only line on stdout.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CHANGELOG, UPCOMING } from './release-notes.mjs';

// the time zone a release's date is written in: the owner's
export const TIME_ZONE = 'America/New_York';

// a version without its "v", as release-version.mjs gives it
const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

// an item as compared between two copies of the file (as release-notes.mjs compares them)
const same = (item) => item.replace(/\s+/g, ' ').trim();

export function releaseDate(when) {
  return new Intl.DateTimeFormat('en-US', { timeZone: TIME_ZONE, month: 'long', day: 'numeric', year: 'numeric' }).format(when);
}

/**
 * Split the upcoming section's body into its groups.
 *
 * @param lines The section's lines, below its heading.
 * @return The groups in order (the first, untitled, holds what comes above any "### " heading),
 *   each with its items (an item's lines, a wrapped one included) and its other text lines.
 */
function groups(lines) {
  const out = [{ title: null, items: [], text: [] }];
  let open = false; // the last line belonged to an item, so an indented line continues it
  for (const line of lines) {
    const g = out[out.length - 1];
    if (/^###\s+\S/.test(line)) {
      out.push({ title: line.trimEnd(), items: [], text: [] });
      open = false;
    } else if (/^-\s+\S/.test(line)) {
      g.items.push([line.trimEnd()]);
      open = true;
    } else if (open && /^\s+\S/.test(line)) {
      g.items[g.items.length - 1].push(line.trimEnd());
    } else {
      if (line.trim()) g.text.push(line.trimEnd());
      open = false;
    }
  }
  return out;
}

/** @return The items' text, each joined into one line as compared. */
const itemText = (item) => same(item.join(' ').replace(/^-\s+/, ''));

/** @return A group as Markdown blocks: its heading, then its text and its items. */
function render(group, items, text) {
  const body = [...text, ...items.flat()];
  if (!body.length) return null;
  return [...(group.title ? [group.title, ''] : []), ...body].join('\n');
}

export function stampChangelog(current, released, version, date) {
  if (!VERSION.test(version)) throw new Error(`"${version}" is not a release's version (X.Y.Z).`);
  const lines = current.replace(/\r\n?/g, '\n').split('\n');
  const tag = `v${version}`;
  // stamped already (a job run again): never twice
  if (lines.some((l) => { const m = /^##\s+(\S+)/.exec(l); return !!m && m[1] === tag; })) return { outcome: 'already', text: current };
  const isUpcoming = (l) => new RegExp(`^##\\s+${UPCOMING}\\s*$`, 'i').test(l);
  const start = lines.findIndex(isUpcoming);
  if (start < 0) throw new Error(`${CHANGELOG} on main has no "## ${UPCOMING}" section.`);
  let end = lines.findIndex((l, i) => i > start && /^##\s/.test(l));
  if (end < 0) end = lines.length;

  // the lines the release shipped: its own copy's upcoming section, counted, so a line merged twice
  // (or one merged again after the release) moves only as many times as the release held it
  const shipped = new Map();
  const releasedLines = released.replace(/\r\n?/g, '\n').split('\n');
  const rStart = releasedLines.findIndex(isUpcoming);
  if (rStart >= 0) {
    let rEnd = releasedLines.findIndex((l, i) => i > rStart && /^##\s/.test(l));
    if (rEnd < 0) rEnd = releasedLines.length;
    for (const g of groups(releasedLines.slice(rStart + 1, rEnd))) for (const i of g.items) shipped.set(itemText(i), (shipped.get(itemText(i)) ?? 0) + 1);
  }

  const kept = [];
  const moved = [];
  for (const g of groups(lines.slice(start + 1, end))) {
    const stay = [];
    const go = [];
    for (const item of g.items) {
      const left = shipped.get(itemText(item)) ?? 0;
      if (left > 0) {
        shipped.set(itemText(item), left - 1);
        go.push(item);
      } else stay.push(item);
    }
    // a group's other text stays with the section it was written in
    const k = render(g, stay, g.text);
    const m = render(g, go, []);
    if (k) kept.push(k);
    if (m) moved.push(m);
  }
  if (!moved.length) return { outcome: 'empty', text: current };

  const rest = lines.slice(end).join('\n');
  const parts = [lines.slice(0, start + 1).join('\n'), ...(kept.length ? [kept.join('\n\n')] : []), `## ${tag} - ${date}`, moved.join('\n\n')];
  if (end < lines.length) parts.push(rest);
  const text = parts.join('\n\n');
  return { outcome: 'stamped', text: text.endsWith('\n') ? text : `${text}\n` };
}

/** The command line: stamps CHANGELOG.md in place and prints the outcome. */
function main() {
  const [releasedPath, version, when] = process.argv.slice(2);
  if (!releasedPath || !version) throw new Error('Usage: node scripts/changelog-stamp.mjs <released CHANGELOG.md> <X.Y.Z> [<ISO time>]');
  const at = when ? new Date(when) : new Date();
  if (Number.isNaN(at.getTime())) throw new Error(`"${when}" is not a time.`);
  const { outcome, text } = stampChangelog(readFileSync(CHANGELOG, 'utf8'), readFileSync(releasedPath, 'utf8'), version, releaseDate(at));
  if (outcome === 'stamped') writeFileSync(CHANGELOG, text);
  const say = { stamped: `Moved v${version}'s lines under their own heading.`, already: `v${version} has its heading already: nothing to do.`, empty: `v${version} shipped no changelog lines: nothing to do.` };
  console.error(`${process.env.GITHUB_ACTIONS && outcome !== 'stamped' ? '::notice::' : ''}${say[outcome]}`);
  console.log(outcome);
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
