/**
 * Import failures in words for the person importing.
 *
 * An ImportProblem is something wrong with what they gave the planner (a code cut short, a damaged
 * file, a build for another server): its message says what is wrong and what they can do about it.
 * Anything else that goes wrong while importing is a fault on the planner's side; the user gets a
 * calm, generic message and the details go to the browser console for whoever looks into it.
 */

/** Something wrong with what was imported, worded for the user: what is wrong and what to do. */
export class ImportProblem extends Error {
  // what is wrong, finishing "Couldn't import X: ..." (lower-case start, no full stop)
  readonly reason: string;
  // what the user can do about it (a full sentence or two), or '' when there is nothing to do
  readonly fix: string;

  constructor(reason: string, fix = '') {
    super(`${reason}${fix ? `. ${fix}` : ''}`);
    this.name = 'ImportProblem';
    this.reason = reason;
    this.fix = fix;
  }
}

/** The formats the planner reads, for messages that need to say so. */
export const READABLE =
  'The planner reads share links from this site, Mids share codes (starting with |MBD; or |MxDz;), Mids .mbd files and the game\'s /build_save file (build.txt).';

/** What to say when a fault on the planner's side stops an import. */
export const OUR_FAULT = 'Something went wrong on our side while importing this build. Please try again in a moment; if it keeps happening, let us know.';

/** A failed import, ready for the dialog. */
export interface ImportFailure {
  title: string; // dialog title
  text: string; // what happened and what to do
  ours: boolean; // a fault on the planner's side, not something the user can fix
}

/**
 * Turn whatever stopped an import into the message the user sees. A fault on the planner's side is
 * logged to the console with its details.
 *
 * @param e What was thrown.
 * @param lead How the message starts, naming what was imported: `Couldn't import "Tank.mbd"`,
 *   "Couldn't import the pasted text". The reason follows after a colon.
 * @param title The dialog's title.
 * @return The dialog's title and text.
 */
export function describeImportFailure(e: unknown, lead: string, title = 'Import failed'): ImportFailure {
  if (e instanceof ImportProblem) return { title, text: `${lead}: ${e.reason}.${e.fix ? `\n${e.fix}` : ''}`, ours: false };
  console.error('Import failed on our side:', e);
  return { title, text: OUR_FAULT, ours: true };
}

/**
 * The problem to report for a build checkBuild refused.
 *
 * @param fixes checkBuild's fixes; the last one says why it refused.
 * @return The problem, worded for the user.
 */
export function refusedBuild(fixes: readonly string[]): ImportProblem {
  if (fixes[fixes.length - 1] === 'no powers picked yet') {
    return new ImportProblem('the build has no powers picked yet', 'Pick at least one power in it, then save or share it again.');
  }
  return new ImportProblem("the build doesn't match the game data the planner has", 'It may come from a newer version of the planner: reload the page and try again.');
}

/**
 * The problem to report for a build or link for a game server the site doesn't carry.
 *
 * @param name The server as the build or the link's address names it.
 * @return The problem, worded for the user.
 */
export function unknownServer(name: string): ImportProblem {
  return new ImportProblem(`it was made for a game server the planner doesn't carry ("${name}")`, 'Check the link, or open the build on the site it was made with.');
}

/** Largest file the import reads: build files are a few KB to a few hundred KB of text. */
export const MAX_BUILD_FILE = 2_000_000;

/**
 * Read a file the user opened or dropped for importing.
 *
 * @param f The file.
 * @return Its text.
 * @raise ImportProblem when it is too big, empty, or can't be read.
 */
export async function readBuildFile(f: Blob): Promise<string> {
  if (f.size > MAX_BUILD_FILE) throw new ImportProblem("it's too big to be a build file (over 2 MB)", 'Check that it is the right file: build files are small text files.');
  let text: string;
  try {
    text = await f.text();
  } catch {
    throw new ImportProblem("the browser couldn't read the file", "Check that it still exists and isn't open in another program, then try again.");
  }
  if (!text.trim()) throw new ImportProblem('the file is empty', 'Check that it is the right file.');
  return text;
}

/** @return "Ice Mastery DefCorr" for a set name part like "Ice_Mastery_DefCorr": internal names made readable. */
export function readable(name: string): string {
  return name.replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * A full internal power name made readable for a message: "Frozen Armor (Ice Mastery DefCorr)".
 *
 * @param full Category.Set.Power, as a file names it.
 * @return The power and its set, readable.
 */
export function readablePower(full: string): string {
  const parts = full.split('.');
  const power = readable(parts[parts.length - 1] ?? full);
  return parts.length >= 3 ? `${power} (${readable(parts[1]!)})` : power;
}
