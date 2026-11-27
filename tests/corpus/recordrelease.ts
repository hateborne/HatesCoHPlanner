/**
 * Records what one release of the planner writes: its share link, the build as it holds it and
 * its Mids exports, for a list of builds. It is run by tests/corpus/record.mjs inside a checkout of
 * a release's tag, as a test file of that checkout, so everything it calls is that release's own
 * code; `npm test` never runs it (its name is no test file's). What it writes goes to
 * tests/fixtures/corpus/ through the same script (docs/architecture.md, "Recorded corpus").
 *
 * It calls only what every release since v1.0.0 has under the same name, and asks loosely for what
 * came later (a server's data, pet switches), so one file serves every tag.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import type { GameData } from '../../src/data/gamedata.ts';
import type { Build } from '../../src/engine/build.ts';
import { startingSets } from '../../src/engine/rules.ts';
import { checkBuild } from '../../src/engine/validate.ts';
import { buildToMxDz, exportMbd, type MidsMap } from '../../src/io/mids.ts';
import { decodeShare, encodeShare } from '../../src/io/share.ts';
import { loadData } from '../helpers/data.ts';
import { walkTo50 } from '../helpers/walk.ts';

/** What the script asks a release to record. */
interface Asked {
  // per "<server>/<game version>": the server's id, its data folder under public/ ("data/" or
  // "data/thunderspy/"), the game version and the builds to record, by name, as share codes
  versions: Record<string, { server: string; data: string; version: string; builds: Record<string, string> }>;
  mids: string[]; // the names of the builds whose legacy Mids code is recorded too
  mbd: string[]; // the names of the builds whose .mbd export is recorded as well
  petPower: string; // a pet power's full name, to switch in the pet pane
  petBuild: string; // the name of the build that gets that switch
  relBuild: string; // the name of the build whose first origin enhancement is given low relative levels
  walked: string; // an older game version of the default server, to level a build per archetype on
}

/** One build as a release recorded it. */
interface Recorded {
  link?: string; // the share code the release writes for it
  build?: Build; // the build as the release holds it, which is also what it keeps in the browser
  reopened?: Build | null; // the build the release opens its own link as (a link cannot hold everything a build can)
  fixes?: string[]; // what the release's own check repaired on the way in (none, for a sound build)
  mxdz?: string; // its legacy Mids code
  mbd?: unknown; // its .mbd export
  error?: string; // why the release could not record it
}

// the levels below an origin enhancement's lowest kept level that a link is tried with
const LOW_RELATIVE_LEVELS = [-8, -12];

/**
 * A version's data as the release's own test helper loads it.
 *
 * @param version The game version id.
 * @param server The server id; the first release takes none and has only the default server.
 * @return The data.
 */
function dataFor(version: string, server: string): GameData {
  return (loadData as (version: string, server?: string) => GameData)(version, server);
}

/**
 * Record one build as the release writes it.
 *
 * @param gd The build's game data.
 * @param raw The build, or anything a link or a file might hold in its place.
 * @param map The version's Mids map, when the build's Mids exports are wanted.
 * @param withMbd Whether the .mbd export is recorded beside the legacy code.
 * @return The record, with an error in place of what could not be made.
 */
async function record(gd: GameData, raw: unknown, map: MidsMap | undefined, withMbd: boolean): Promise<Recorded> {
  try {
    const { build, fixes } = checkBuild(gd, raw);
    if (!build) return { error: 'refused by checkBuild', fixes };
    const link = await encodeShare(build);
    const out: Recorded = { link, build, fixes, reopened: checkBuild(gd, await decodeShare(link)).build };
    if (map) {
      out.mxdz = (await buildToMxDz(gd, map, build)).text;
      if (withMbd) out.mbd = exportMbd(gd, map, build).mbd;
    }
    return out;
  } catch (error) {
    return { error: String(error) };
  }
}

it('records what this release writes', async () => {
  const asked = JSON.parse(readFileSync(process.env.CORPUS_IN!, 'utf-8')) as Asked;
  const out: Record<string, Record<string, Recorded>> = {};
  for (const [key, { server, data, version, builds }] of Object.entries(asked.versions)) {
    const folder = join(process.cwd(), 'public', data, version);
    // a server this release does not carry yet
    if (!existsSync(folder)) continue;
    const gd = dataFor(version, server);
    const mapPath = join(folder, 'mids-map.json');
    const map = existsSync(mapPath) ? (JSON.parse(readFileSync(mapPath, 'utf-8')) as MidsMap) : undefined;
    const records: Record<string, Recorded> = {};
    for (const [name, code] of Object.entries(builds)) {
      let decoded: Build;
      try {
        decoded = await decodeShare(code);
      } catch (error) {
        records[name] = { error: `does not decode: ${String(error)}` };
        continue;
      }
      records[name] = await record(gd, decoded, asked.mids.includes(name) ? map : undefined, asked.mbd.includes(name));
      // a pet switched in the pet pane: only a release that knows the pet pane keeps it
      if (name === asked.petBuild) {
        const switched = await record(gd, { ...decoded, petOn: { [asked.petPower]: false } }, undefined, /*withMbd=*/ false);
        if (switched.build && (switched.build as { petOn?: unknown }).petOn) records['special/pet-switch'] = switched;
      }
      // an origin enhancement far below the character: the first release wrote its level another way
      if (name === asked.relBuild) {
        for (const rel of LOW_RELATIVE_LEVELS) {
          const copy = JSON.parse(JSON.stringify(decoded)) as Build;
          const slot = copy.picks.flatMap((pick) => pick?.slots ?? []).find((candidate) => candidate.enh && candidate.enh.rel !== undefined);
          if (!slot?.enh) continue;
          slot.enh.rel = rel;
          records[`special/relative-level${rel}`] = await record(gd, copy, undefined, /*withMbd=*/ false);
        }
      }
    }
    out[key] = records;
  }
  // an older version of the default server: a build per archetype, leveled by this release's own walk
  const old = dataFor(asked.walked, 'homecoming');
  const walked: Record<string, Recorded> = {};
  for (const archetype of old.core.archetypes) {
    const primary = startingSets(old, archetype.cats.pri, archetype)[0];
    const secondary = startingSets(old, archetype.cats.sec, archetype)[0];
    if (!primary || !secondary) continue;
    walked[`walked/${archetype.n}`] = await record(old, walkTo50(old, archetype.n, primary.id, secondary.id), undefined, /*withMbd=*/ false);
  }
  out[`homecoming/${asked.walked}`] = walked;
  writeFileSync(process.env.CORPUS_OUT!, JSON.stringify(out));
  expect(Object.keys(out).length).toBeGreaterThan(0);
}, 60 * 60 * 1000);
