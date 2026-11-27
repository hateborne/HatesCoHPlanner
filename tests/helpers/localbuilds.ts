/**
 * The local build check, its record: what the planner makes of each build in a folder of community
 * builds on this machine, as digests, and how two such records differ
 * (tests/localbuilds.check.ts; docs/architecture.md, "Local build check").
 *
 * Nothing of a build is kept but digests: no file name, no build name, no path. A build is known
 * by the digest of its own text.
 */

/** What the planner makes of one build, each part as a digest. */
export interface LocalEntry {
  problem?: string; // why it did not open: the kind of failure and a digest of its words (none: it opened)
  build?: string; // the build as imported and checked
  link?: string; // the share link written for it
  reopened?: string; // the build that link opens as
  numbers?: string; // every figure the screens show of it (the golden numbers' record)
  notes?: string; // what the import could not bring over and what the check repaired
}

/** A record of the whole folder, as written by one run. */
export interface LocalRecord {
  commit: string; // the commit the planner was at ("+ changes" when files were changed besides)
  entries: Record<string, LocalEntry>; // each build's entry, by the digest of its text
}

/** The builds that differ between two records in one respect. */
export interface LocalChange {
  what: string; // the part that differs (a LocalEntry field), or "gone" / "new" for a build only one record has
  ids: string[]; // those builds, by the digest of their text
}

// the parts of an entry, in the order a difference is looked for: a build that no longer opens is
// reported as that, not also as changed numbers
const PARTS = ['problem', 'build', 'link', 'reopened', 'numbers', 'notes'] as const;

/**
 * How two records of the same folder differ.
 *
 * @param before The record taken first (the baseline).
 * @param now The record taken now.
 * @return One list per respect in which some build differs, each build under the first part of it
 *   that differs; nothing when the records agree.
 */
export function localChanges(before: Record<string, LocalEntry>, now: Record<string, LocalEntry>): LocalChange[] {
  const lists = new Map<string, string[]>();
  const add = (what: string, id: string) => lists.set(what, [...(lists.get(what) ?? []), id]);
  for (const [id, entry] of Object.entries(before)) {
    const other = now[id];
    if (!other) add('gone', id);
    else {
      const part = PARTS.find((name) => entry[name] !== other[name]);
      if (part) add(part, id);
    }
  }
  for (const id of Object.keys(now)) if (!before[id]) add('new', id);
  return [...lists].map(([what, ids]) => ({ what, ids }));
}
