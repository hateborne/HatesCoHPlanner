/**
 * Runs once before the screenshot check's walks, and keeps the pictures honest: a note beside them
 * says which planner they are of and which browser drew them.
 *
 * Taking the pictures (--update-snapshots) throws the old ones away first, so every picture on
 * record is of the same planner and none outlives the step that took it, then writes the note.
 * Comparing reads the note: it refuses to run without one, or with another browser version than
 * the one that drew the pictures (a new version draws a little differently, and every picture would
 * differ), and says what the pictures are of before the walks start.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type FullConfig } from '@playwright/test';

// where the pictures are kept (e2e/screens.config.ts: snapshotPathTemplate)
const PICTURES = join(process.cwd(), '.screens');
// the note beside them
const NOTE = join(PICTURES, 'taken.json');
// what the planner's screens are built from: pictures are of main's planner while these match main's
const SITE = ['src', 'public', 'index.html'];
// how the pictures are taken
const TAKE = 'npx playwright test --config e2e/screens.config.ts --update-snapshots';

/** What the note records about the pictures on record. */
interface Taken {
  main: string; // main's commit when they were taken ('' when git could not say)
  sameAsMain: boolean; // whether the planner pictured was main's (its site files matched main's)
  chrome: string; // the browser version that drew them
}

/**
 * Ask git something.
 *
 * @param args The git arguments.
 * @return What it printed, or null when it failed (a diff --quiet that found a difference fails).
 */
function git(...args: string[]): string | null {
  try {
    return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

/** @return Main as this checkout last saw it: the remote's, or the local branch when there is no remote. */
function mainRef(): string {
  return git('rev-parse', '--verify', '--quiet', 'origin/main') !== null ? 'origin/main' : 'main';
}

/** @return What the pictures would be of, taken now. */
async function now(): Promise<Taken> {
  const ref = mainRef();
  const main = git('rev-parse', ref) ?? '';
  // the same files as main's, and no new file git does not know yet
  const same = main !== '' && git('diff', '--quiet', ref, '--', ...SITE) !== null && git('status', '--porcelain', '--', ...SITE) === '';
  const browser = await chromium.launch({ channel: 'chrome' });
  const chrome = browser.version();
  await browser.close();
  return { main, sameAsMain: same, chrome };
}

/** @return The note's wording of which planner the pictures are of. */
function describe(taken: Taken): string {
  const at = taken.main ? `main at ${taken.main.slice(0, 7)}` : 'main';
  return taken.sameAsMain ? `the planner of ${at}` : `a planner that differs from ${at}`;
}

/**
 * Before the walks: throw away and note (taking the pictures), or check the note (comparing).
 *
 * @param config The run's configuration; its updateSnapshots says which of the two this run is.
 */
export default async function taken(config: FullConfig): Promise<void> {
  const state = await now();
  if (config.updateSnapshots === 'all' || config.updateSnapshots === 'changed') {
    for (const project of config.projects) rmSync(join(PICTURES, project.name), { recursive: true, force: true });
    mkdirSync(PICTURES, { recursive: true });
    writeFileSync(NOTE, `${JSON.stringify(state, null, 2)}\n`);
    console.log(`Taking the pictures of ${describe(state)}.`);
    if (!state.sameAsMain) console.log('  They are not of main: the comparison will hold a branch to these, not to main. Take them on main.');
    return;
  }
  if (!existsSync(NOTE)) throw new Error(`There are no pictures to compare with. Take them on main first: ${TAKE}`);
  const note = JSON.parse(readFileSync(NOTE, 'utf8')) as Taken;
  if (note.chrome !== state.chrome) {
    throw new Error(`The pictures were drawn by Chrome ${note.chrome} and this is Chrome ${state.chrome}, which draws a little differently. Take them again on main: ${TAKE}`);
  }
  console.log(`Comparing with pictures of ${describe(note)}.`);
  if (!note.sameAsMain) console.log('  They are not of main: take them again on main for a comparison with main.');
  if (note.main !== state.main) console.log(`  Main has moved since (now ${state.main.slice(0, 7)}): take them again if the screens changed there.`);
}
