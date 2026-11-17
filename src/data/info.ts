/**
 * The shape check of a version's power-info extras file (info/<version>.json, written by the
 * pipeline's Exporter.build_info). Like the pets file it is optional and loads apart from the
 * version's own files, so the planner takes it only when every part the power info reads has the
 * right type: anything else leaves the extras out rather than breaking a tooltip.
 */
import { isEffects } from './pets.ts';
import type { InfoFile, InfoNode } from './types.ts';

type Rec = Record<string, unknown>;

const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === 'string';
const isStrMap = (v: unknown): v is Record<string, string> => isRec(v) && Object.values(v).every(isStr);

// how deep effect groups may nest (the client's deepest is a few levels)
const MAX_NESTING = 32;

/** @return Whether a notes node (and every node in it) is well formed. */
function isNode(v: unknown, depth: number): v is InfoNode {
  if (v === null) return true;
  if (!isRec(v) || depth > MAX_NESTING) return false;
  const okM = v.m === undefined || (Array.isArray(v.m) && v.m.every((x) => x === null || isStr(x)));
  const okS = v.s === undefined || (Array.isArray(v.s) && v.s.every((x) => isNode(x, depth + 1)));
  return okM && okS;
}

const isNodes = (v: unknown) => v === undefined || (Array.isArray(v) && v.every((x) => isNode(x, 0)));

/** @return A copy of a record without a prototype, so a name like "constructor" finds nothing. */
function bare<T>(r: Rec): Record<string, T> {
  return Object.assign(Object.create(null) as Record<string, T>, r);
}

/**
 * Check a parsed info file and make it safe to look names up in.
 *
 * A file that names another version (one copied to the wrong place) is refused: its notes would
 * land on another version's lines.
 *
 * @param raw The parsed JSON.
 * @param version The id of the version it was fetched for.
 * @return The file (its lookup records without prototypes), or null when any part is malformed.
 */
export function readInfoFile(raw: unknown, version: string): InfoFile | null {
  if (!isRec(raw) || raw.version !== version) return null;
  const { notes, hiddenGrants, aggro, attr, text, groups } = raw;
  if (!isRec(notes) || !Object.values(notes).every((n) => isRec(n) && isNodes(n.e) && isNodes(n.a))) return null;
  if (!Array.isArray(hiddenGrants) || !hiddenGrants.every(isStr)) return null;
  if (!isStrMap(aggro) || !isStrMap(attr) || !isStrMap(text)) return null;
  if (groups !== undefined && !(isRec(groups) && Object.values(groups).every((g) => isRec(g) && isEffects(g.eff) && isEffects(g.act))))
    return null;
  const file: InfoFile = {
    notes: bare(notes),
    hiddenGrants: hiddenGrants as string[],
    aggro: bare(aggro),
    attr: bare(attr),
    text: bare(text),
  };
  if (groups !== undefined) file.groups = bare(groups as Rec);
  return file;
}
