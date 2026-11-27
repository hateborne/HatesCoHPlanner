import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { brotliDecompressSync } from 'node:zlib';
import type { GameData } from '../../src/data/gamedata.ts';
import type { Build } from '../../src/engine/build.ts';
import { importMbd, importMidsText, type Mbd, type MidsMap } from '../../src/io/mids.ts';

// where the forum builds are kept (their sources are in its README)
const FIXTURE_DIR = join(process.cwd(), 'tests', 'fixtures', 'builds');

/** @return The names of the forum build files, in alphabetical order (the README is not one). */
export function fixtureNames(): string[] {
  return readdirSync(FIXTURE_DIR)
    .filter((name) => name.endsWith('.txt') || name.endsWith('.mbd'))
    .sort();
}

/**
 * Read a forum build as it was posted.
 *
 * @param name The file's name in tests/fixtures/builds.
 * @return Its text.
 */
export function fixtureText(name: string): string {
  return readFileSync(join(FIXTURE_DIR, name), 'utf-8');
}

/**
 * The .mbd JSON inside a posted |MBD; chunk (Brotli, then Base64), decoded with Node's own Brotli.
 *
 * The planner's reader unpacks Brotli with a WebAssembly build that a test would have to stand in
 * for; Node's own gives the same bytes without it.
 *
 * @param text The post's text, holding the chunk.
 * @return The build as Mids saved it.
 */
export function mbdFromChunk(text: string): Mbd {
  const lines = text.split('\n').map((line) => line.trim());
  const head = lines.findIndex((line) => line.startsWith('|MBD;'));
  const base64 = lines
    .slice(head + 1)
    .filter((line) => /^\|[A-Za-z0-9+/=]+\|$/.test(line))
    .map((line) => line.slice(1, -1))
    .join('');
  return JSON.parse(brotliDecompressSync(Buffer.from(base64, 'base64')).toString('utf-8')) as Mbd;
}

/**
 * Import a forum build the way its format asks: an .mbd file, a |MBD; chunk, or a legacy |MxDz;
 * chunk (with the Hero Plan text above it, when the post had one).
 *
 * @param gd Game data to import onto.
 * @param map That version's Mids name map.
 * @param name The file's name in tests/fixtures/builds.
 * @return The build and what the import could not bring over.
 */
export async function importFixture(gd: GameData, map: MidsMap, name: string): Promise<{ build: Build; warnings: string[] }> {
  const text = fixtureText(name);
  if (name.endsWith('.mbd')) return importMbd(gd, map, JSON.parse(text) as Mbd);
  if (text.includes('|MBD;')) return importMbd(gd, map, mbdFromChunk(text));
  return importMidsText(gd, map, text);
}
