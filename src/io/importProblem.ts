/**
 * Import failures in words for the person importing.
 *
 * An ImportProblem is something wrong with what they gave the planner (a code cut short, a damaged
 * file, a build for another server): its message says what is wrong and what they can do about it.
 * Anything else that goes wrong while importing is a fault on the planner's side; the user gets a
 * calm, generic message and the details go to the browser console for whoever looks into it.
 */
import { stripHidden } from '../engine/build.ts';

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

/** A server as the messages below name it (the planner's own SERVERS entries, never imported text). */
interface ServerName {
  label: string; // "Thunderspy"
  path: string; // its address segment ("Thunderspy")
}

/**
 * The problem to report for a share code made on one server's data opened at another server's
 * address. Each server numbers its powers on its own, so the code would read as other powers.
 *
 * @param made The server whose game version the code names.
 * @param named The server the link's address names.
 * @return The problem, worded for the user.
 */
export function wrongServer(made: ServerName, named: ServerName): ImportProblem {
  return new ImportProblem(
    `the build was made on ${made.label}'s game data, but the link's address names ${named.label}`,
    `Open it on ${made.label}: change "/${named.path}/" in the link to "/${made.path}/".`,
  );
}

/**
 * The problem to report for a share code whose server can't be told: no server's version list
 * that loaded holds its game version, and some list didn't load.
 *
 * @return The problem, worded for the user.
 */
export function serverListsUnread(): ImportProblem {
  return new ImportProblem("the planner couldn't load every server's game versions, so it can't tell which server the build is for", 'Check the connection, then try again.');
}

/**
 * The problem to report for Mids on a server MidsReborn has no database for.
 *
 * @param s The server.
 * @param withMids The servers that do have one (for the way out).
 * @return The problem, worded for the user.
 */
export function noMids(s: ServerName, withMids: readonly ServerName[]): ImportProblem {
  const other = withMids.map((x) => x.label).join(' or ');
  return new ImportProblem(
    `MidsReborn has no ${s.label} database, so ${s.label} builds can't come from or go to Mids`,
    `Share ${s.label} builds with the planner's share links.${other ? ` A Mids build made for ${other} imports after switching to ${other} on New Build.` : ''}`,
  );
}

/**
 * The problem to report for a /build_save file on a server whose game client doesn't write them.
 *
 * @param s The server shown.
 * @param writers The servers whose clients write them.
 * @return The problem, worded for the user.
 */
export function noBuildSave(s: ServerName, writers: readonly ServerName[]): ImportProblem {
  const w = writers.map((x) => x.label).join(' or ');
  return new ImportProblem(
    `a /build_save file comes from ${w || 'another server'}'s game client, not ${s.label}'s`,
    w ? `Switch to ${w} on New Build, then import it there.` : '',
  );
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

/** Longest name a message repeats from an imported file (the game's longest names are ~40). */
const READABLE_MAX = 60;

/** @return "Ice Mastery DefCorr" for a set name part like "Ice_Mastery_DefCorr": internal names made readable. */
export function readable(name: string): string {
  // names come from the file: plain text, short enough that a crafted one can't fill the message
  const s = stripHidden(name).replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
  return s.length > READABLE_MAX ? `${s.slice(0, READABLE_MAX - 3)}...` : s;
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
