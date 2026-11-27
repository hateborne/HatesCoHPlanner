/**
 * Golden numbers, the format: how a value the engine works out is written down, so that the same
 * value always makes the same lines and any change to a figure changes a line
 * (tests/goldennumbers.test.ts; what is recorded is in goldenbuilds.ts).
 */
import { createHash } from 'node:crypto';

// figures are kept to this many significant digits, so the last bits of a float (which Node
// versions' maths may round differently) never count as a change
const DIGITS = 9;
// the longest value written on one line: a longer one is split into its parts, one per line
const LINE_LIMIT = 400;
// engine output is never nested deeper than this: more means a cycle, or a whole GameData caught up in it
const MAX_DEPTH = 40;
// how many characters of a digest are kept (48 bits: plenty to tell two records apart)
const DIGEST_LENGTH = 12;
// between a line's path and its value
const SEPARATOR = ' = ';

/** A value as plain JSON data: what plain() makes of the engine's output. */
export type Plain = null | boolean | number | string | Plain[] | { [key: string]: Plain };

/** A run of power info text (the engine's Seg): its text, and its color and slant when it has them. */
interface TextRun {
  text: string; // the words
  color?: string; // their color, when not the default
  italic?: boolean; // whether they are slanted
}

/** @return Whether a value is a run of power info text and nothing more. */
function isTextRun(value: unknown): value is TextRun {
  if (typeof value !== 'object' || value === null || typeof (value as TextRun).text !== 'string') return false;
  return Object.keys(value).every((key) => key === 'text' || key === 'color' || key === 'italic');
}

/** @return A run of text on one line: its color and slant in braces ("{}" for neither), then its text. */
function runText(run: TextRun): string {
  const style = [run.color, run.italic ? 'i' : undefined].filter(Boolean).join(' ');
  return `{${style}}${run.text}`;
}

/** @return A map's key as text: a game object's internal name, any other key as it prints. */
function keyText(key: unknown): string {
  if (typeof key === 'object' && key !== null && typeof (key as { n?: unknown }).n === 'string') return (key as { n: string }).n;
  return String(key);
}

/**
 * Turn a value the engine worked out into plain JSON data.
 *
 * 1. A number keeps 9 significant digits; one that is not finite is written as text.
 * 2. A game object (a power, a power set, an enhancement set, an archetype: anything with an id
 *    and an internal name) is written as "@" and its internal name, never as its numbers.
 * 3. A map becomes an object (number keys in rising order), a set a list.
 * 4. Runs of power info text become one string, each run's color and slant in braces before it.
 * 5. Functions and undefined fields are left out.
 *
 * @param value The value.
 * @param depth How deep in the value this is (callers leave it out).
 * @return The plain data, or undefined for a value that is left out.
 * @throws When the value is nested deeper than engine output ever is, or two keys of a map print alike.
 */
export function plain(value: unknown, depth = 0): Plain | undefined {
  if (depth > MAX_DEPTH) throw new Error('golden: a value is nested too deep to record');
  if (value === null) return null;
  if (value === undefined || typeof value === 'function') return undefined;
  if (typeof value === 'number') return Number.isFinite(value) ? Number(value.toPrecision(DIGITS)) : String(value);
  if (typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value !== 'object') return String(value);
  if (value instanceof Map) {
    const entries = [...value.entries()];
    if (entries.every(([key]) => typeof key === 'number')) entries.sort((a, b) => a[0] - b[0]);
    return plainFields(entries.map(([key, item]) => [keyText(key), item]), depth);
  }
  if (value instanceof Set) return [...value].map((item) => plain(item, depth + 1) ?? null);
  if (Array.isArray(value)) {
    if (value.length > 0 && value.every(isTextRun)) return value.map(runText).join('');
    return value.map((item) => plain(item, depth + 1) ?? null);
  }
  const fields = value as Record<string, unknown>;
  if (typeof fields.id === 'number' && typeof fields.n === 'string') return `@${fields.n}`;
  if (isTextRun(value)) return runText(value);
  return plainFields(Object.entries(fields), depth);
}

/**
 * The plain form of an object's or a map's fields.
 *
 * @param entries Each field's name and value.
 * @param depth How deep in the recorded value the fields are.
 * @return The object, without the fields that are left out.
 * @throws When two fields have one name (two keys of a map that print alike): one would be lost.
 */
function plainFields(entries: [string, unknown][], depth: number): { [key: string]: Plain } {
  const out: { [key: string]: Plain } = {};
  for (const [key, item] of entries) {
    if (key in out) throw new Error(`golden: two fields are named "${key}", so one would go unrecorded`);
    const made = plain(item, depth + 1);
    if (made !== undefined) out[key] = made;
  }
  return out;
}

// what stands for a value the first of two records has and the second lacks
const NOT_THERE = '(not there)';

/**
 * The parts of one plain value that differ from another, for a record that is mostly a copy of one
 * already written down (a build's totals out of combat, beside its totals in combat).
 *
 * Nothing is lost by it: with the first value on record in full, any change to the second changes
 * either the first's lines or these.
 *
 * @param base The value already on record.
 * @param other The value to record beside it.
 * @return The fields of `other` that differ, nested as they are (a list or a figure that differs is
 *   given whole, a field only `base` has reads "(not there)"); undefined when nothing differs.
 */
export function differences(base: Plain | undefined, other: Plain | undefined): Plain | undefined {
  if (other === undefined) return base === undefined ? undefined : NOT_THERE;
  if (base === undefined) return other;
  if (JSON.stringify(base) === JSON.stringify(other)) return undefined;
  const isFields = (value: Plain): value is { [key: string]: Plain } => typeof value === 'object' && value !== null && !Array.isArray(value);
  if (!isFields(base) || !isFields(other)) return other;
  const out: { [key: string]: Plain } = {};
  for (const key of new Set([...Object.keys(other), ...Object.keys(base)])) {
    const differing = differences(base[key], other[key]);
    if (differing !== undefined) out[key] = differing;
  }
  return out;
}

/**
 * Write plain data as lines, each a path and the value there ("totals.hpMax = 1204.76").
 *
 * A value whose JSON fits a line stays on one line; a longer one is split into its fields or
 * items, each under its own path. So a changed figure changes one short line, and that line says
 * where the figure is.
 *
 * @param value The plain data.
 * @param path The path of the value itself (callers leave it out).
 * @return The lines, in the value's own order.
 */
export function flatten(value: Plain, path = ''): string[] {
  const json = JSON.stringify(value);
  if (json.length <= LINE_LIMIT || typeof value !== 'object' || value === null) return [`${path || '(all)'}${SEPARATOR}${json}`];
  if (Array.isArray(value)) return value.flatMap((item, index) => flatten(item, `${path}[${index}]`));
  return Object.entries(value).flatMap(([key, item]) => flatten(item, path ? `${path}.${key}` : key));
}

/**
 * A short digest of a record's lines, for records too many to keep in full.
 *
 * @param lines The record's lines (flatten).
 * @return The first characters of their SHA-1.
 */
export function digest(lines: readonly string[]): string {
  return createHash('sha1').update(lines.join('\n')).digest('hex').slice(0, DIGEST_LENGTH);
}

/**
 * What differs between the lines on record and the lines worked out now, for a failed test to say.
 *
 * @param recorded The lines on record.
 * @param now The lines the engine gives now.
 * @param most How many differing lines to list before only counting the rest.
 * @return Nothing when they are the same; else "- " lines that are gone or changed and "+ " lines
 *   that are new or what they changed to.
 */
export function lineChanges(recorded: readonly string[], now: readonly string[], most = 30): string[] {
  if (recorded.length === now.length && recorded.every((line, index) => line === now[index])) return [];
  const byPath = (lines: readonly string[]) => new Map(lines.map((line) => [line.slice(0, Math.max(0, line.indexOf(SEPARATOR))), line]));
  const before = byPath(recorded);
  const after = byPath(now);
  const changes: string[] = [];
  for (const [path, line] of before) {
    const other = after.get(path);
    if (other === line) continue;
    changes.push(`- ${line}`);
    if (other !== undefined) changes.push(`+ ${other}`);
  }
  for (const [path, line] of after) if (!before.has(path)) changes.push(`+ ${line}`);
  if (changes.length === 0) return ['the same lines, in another order'];
  return changes.length > most ? [...changes.slice(0, most), `... and ${changes.length - most} more lines`] : changes;
}
