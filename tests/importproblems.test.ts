import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { brotliCompressSync, brotliDecompressSync } from 'node:zlib';
import { describe, expect, it, vi } from 'vitest';

// brotli-wasm fetches its WebAssembly, which Node's test run can't: Node's own Brotli stands in
vi.mock('brotli-wasm', () => ({
  default: {
    decompress: (b: Uint8Array) => new Uint8Array(brotliDecompressSync(b)),
    compress: (b: Uint8Array) => new Uint8Array(brotliCompressSync(b)),
  },
}));
import { newBuild, type Build } from '../src/engine/build.ts';
import { BuildRules, startingSets } from '../src/engine/rules.ts';
import { streamBytes, toBase64Url } from '../src/io/binary.ts';
import {
  describeImportFailure,
  ImportProblem,
  MAX_BUILD_FILE,
  OUR_FAULT,
  readablePower,
  readBuildFile,
  refusedBuild,
} from '../src/io/importProblem.ts';
import { exportMbd, importMbd, importMidsText, MIDS_EPIC_POOLS, parseMidsText, type Mbd } from '../src/io/mids.ts';
import { decodeShare, encodeShare } from '../src/io/share.ts';
import { loadData, loadMidsMapFile, loadVersionIndex, pid, sid } from './helpers/data.ts';

const gd = loadData();
const map = loadMidsMapFile(gd.core.manifest.dataVersion);
const fixture = (name: string) => readFileSync(join(process.cwd(), 'tests', 'fixtures', 'builds', name), 'utf-8');
const MBD_POST = fixture('archery-traps-corruptor.txt'); // a forum post with a |MBD; chunk
const MXDZ_POST = fixture('symphony-dark-dominator.txt'); // a forum post with a legacy |MxDz; chunk

/** @return The reason of the ImportProblem `p` rejects with (fails the test on any other outcome). */
async function reason(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(ImportProblem);
    return (e as ImportProblem).reason;
  }
  throw new Error('expected an ImportProblem');
}

/** @return A forum post with the chunk's data lines (the ones after its header) changed. */
function editChunk(post: string, edit: (lines: string[]) => string[]): string {
  const lines = post.split(/\r?\n/);
  const head = lines.findIndex((l) => /^\|(MBD|MxDz);/.test(l));
  const data = lines.slice(head + 1).filter((l) => l.startsWith('|'));
  return [...lines.slice(0, head + 1), ...edit(data)].join('\n');
}

describe('import problems: what the user gave the planner', () => {
  it('says when there is nothing to import, or nothing it recognizes', async () => {
    expect(await reason(parseMidsText('   '))).toBe("there's nothing to import");
    expect(await reason(parseMidsText('hello, here is my build!'))).toBe("it isn't a build the planner recognizes");
    expect(await reason(parseMidsText('QUJDREVGR0hJSktMTU5PUFFSU1RVVldY'))).toBe("it isn't a build the planner recognizes");
    expect(await reason(parseMidsText('MxD\u0000\u0001\u0002 binary'))).toBe("it isn't a text file the planner can read");
  });

  it('tells a damaged .mbd file from JSON that is no build at all', async () => {
    expect(await reason(parseMidsText('{"Class": "Class_Blaster", "PowerEnt'))).toMatch(/^it isn't valid Mids build data/);
    expect(await reason(parseMidsText('{"name": "my-package"}'))).toBe("it isn't a Mids build");
  });

  it('says when a Mids share code is cut short, changed in transit, or damaged', async () => {
    expect((await parseMidsText(MBD_POST)).kind).toBe('mbd');
    expect(await reason(parseMidsText(editChunk(MBD_POST, (d) => d.slice(0, -3))))).toBe('part of the Mids share code is missing');
    // a forum or chat app turning a character into something else
    expect(await reason(parseMidsText(editChunk(MBD_POST, (d) => [d[0]!.replace(/[A-Za-z]/, '’'), ...d.slice(1)])))).toBe(
      "the Mids share code has characters a share code can't have",
    );
    // valid characters, wrong data
    const flipped = (d: string[]) => [d[0]!, d[1]!.slice(0, 10) + (d[1]![10] === 'A' ? 'B' : 'A') + d[1]!.slice(11), ...d.slice(2)];
    expect(await reason(parseMidsText(editChunk(MBD_POST, flipped)))).toBe('the Mids share code is damaged');
  });

  it('says the same for a legacy |MxDz; code', async () => {
    expect((await parseMidsText(MXDZ_POST)).kind).toBe('mxdz');
    expect(await reason(parseMidsText(editChunk(MXDZ_POST, (d) => d.slice(0, -2))))).toBe('part of the Mids share code is missing');
    expect(await reason(parseMidsText(editChunk(MXDZ_POST, (d) => [d[0]!.replace(/[0-9A-F]/, 'G'), ...d.slice(1)])))).toBe(
      "the Mids share code has characters a share code can't have",
    );
    const flipped = (d: string[]) => [d[0]!, d[1]!.slice(0, 20) + (d[1]![20] === '0' ? '1' : '0') + d[1]!.slice(21), ...d.slice(2)];
    expect(await reason(importMidsText(gd, map, editChunk(MXDZ_POST, flipped)))).toBe('the Mids share code is damaged');
  });

  it('says why a Mids build for another server or a newer patch cannot open', () => {
    const base = JSON.parse(JSON.stringify(exportMbd(gd, map, starter('Class_Blaster')).mbd)) as Mbd;
    const other = { ...base, Class: 'Class_Made_Up', BuiltWith: { ...base.BuiltWith, Database: 'Rebirth' } };
    expect(() => importMbd(gd, map, other)).toThrow(ImportProblem);
    try {
      importMbd(gd, map, other);
    } catch (e) {
      const p = e as ImportProblem;
      expect(p.reason).toBe("its archetype (Made Up) isn't one the planner has");
      expect(p.fix).toMatch(/Rebirth database, for another server/);
    }
    const sets = { ...base, PowerSets: ['Blaster_Ranged.Made_Up_Blast', base.PowerSets[1]!] };
    expect(() => importMbd(gd, map, sets)).toThrow(/power sets \(Made Up Blast \/ .+\) aren't ones the planner has. It may come from a newer patch/);
  });

  it('says when a share link is damaged, cut short, or from a newer planner', async () => {
    const code = await encodeShare(starter('Class_Blaster'));
    expect((await decodeShare(code)).at).toBe(gd.archetypeByName.get('class_blaster')!.id);
    expect(await reason(decodeShare('abc'))).toBe('the share link is damaged or cut short');
    expect(await reason(decodeShare(code.slice(0, code.length - 8)))).toBe('the share link is damaged or cut short');
    const newer = toBase64Url(await streamBytes(new Uint8Array([2, 1, 2, 3]), 'deflate', true));
    expect(await reason(decodeShare(newer))).toBe('the share link was made by a newer version of the planner');
  });

  it('checks opened and dropped files', async () => {
    expect(await readBuildFile(new Blob(['{"Class":"Class_Blaster"}']))).toBe('{"Class":"Class_Blaster"}');
    expect(await reason(readBuildFile(new Blob([' \n '])))).toBe('the file is empty');
    expect(await reason(readBuildFile(new Blob([new Uint8Array(MAX_BUILD_FILE + 1)])))).toBe("it's too big to be a build file (over 2 MB)");
  });

  it('words a build the checks refuse', () => {
    expect(refusedBuild(['picks: 30 -> 24', 'no powers picked yet']).reason).toBe('the build has no powers picked yet');
    expect(refusedBuild(['unknown archetype']).reason).toBe("the build doesn't match the game data the planner has");
  });
});

describe('import problems: the message the user sees', () => {
  it('names what was imported, what is wrong and what to do', () => {
    const f = describeImportFailure(new ImportProblem('part of the Mids share code is missing', 'Copy the whole code again.'), 'Couldn\'t import "Tank.mbd"');
    expect(f).toEqual({ title: 'Import failed', text: 'Couldn\'t import "Tank.mbd": part of the Mids share code is missing.\nCopy the whole code again.', ours: false });
  });

  it('gives a fault on our side a calm generic message, and logs the details', () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const boom = new TypeError("Cannot read properties of undefined (reading 'n')");
    const f = describeImportFailure(boom, "Couldn't import the pasted text");
    expect(f).toEqual({ title: 'Import failed', text: OUR_FAULT, ours: true });
    expect(f.text).not.toMatch(/undefined|TypeError/);
    expect(log).toHaveBeenCalledWith(expect.any(String), boom);
    log.mockRestore();
  });

  it('makes internal power names readable', () => {
    expect(readablePower('Epic.Ice_Mastery_DefCorr.Frozen_Armor')).toBe('Frozen Armor (Ice Mastery DefCorr)');
    expect(readablePower('Brawl')).toBe('Brawl');
  });
});

/** @return A build of an archetype with its first primary and secondary and no picks. */
function starter(cls: string, picks: Build['picks'] = []): Build {
  const at = gd.archetypeByName.get(cls.toLowerCase())!;
  const b = newBuild({
    dataVersion: gd.core.manifest.dataVersion,
    name: 'Test',
    at: at.id,
    origin: gd.core.origins[0]!.id,
    alignment: 'Hero',
    primary: startingSets(gd, at.cats.pri, at)[0]!.id,
    secondary: startingSets(gd, at.cats.sec, at)[0]!.id,
    pickCount: gd.core.schedule.power.length,
  });
  picks.forEach((p, i) => (b.picks[i] = p));
  return b;
}

describe('Mids epic pools under their own names', () => {
  // the archetypes each Mids pool name is for (its suffix)
  const FOR: Record<string, string[]> = {
    'Epic.Dark_Mastery_Blaster': ['Class_Blaster'],
    'Epic.Dark_Mastery_Controller': ['Class_Controller'],
    'Epic.Dark_Mastery_Dominator': ['Class_Dominator'],
    'Epic.Dark_Mastery_Mastermind': ['Class_Mastermind'],
    'Epic.Dark_Mastery_TankBrute': ['Class_Tanker', 'Class_Brute'],
    'Epic.Ice_Mastery_DefCorr': ['Class_Defender', 'Class_Corruptor'],
    'Epic.Ice_Mastery_ScrapStalk': ['Class_Scrapper', 'Class_Stalker'],
    'Epic.Psionic_Mastery_ScrapStalk': ['Class_Scrapper', 'Class_Stalker'],
    'Epic.Psionic_Mastery_TankBrute': ['Class_Tanker', 'Class_Brute'],
  };
  const EPIC_PICK = gd.core.schedule.power.indexOf(34); // the level 35 pick

  it('maps every one to a pool in every game version the site carries', () => {
    expect(MIDS_EPIC_POOLS.map(([m]) => m).sort()).toEqual(Object.keys(FOR).sort());
    for (const v of loadVersionIndex().versions) {
      const data = loadData(v.id);
      for (const [, game] of MIDS_EPIC_POOLS) expect(data.setByName.has(game.toLowerCase()), `${game} in ${v.id}`).toBe(true);
    }
  });

  it('lets each archetype the Mids name is for take the pool it maps to', () => {
    for (const [mids, game] of MIDS_EPIC_POOLS) {
      const set = gd.setById.get(sid(gd, game))!;
      const first = set.p.find((p, i) => (set.av[i] ?? 99) <= 34 && !gd.power(p).auto)!;
      for (const cls of FOR[mids]!) {
        const b = starter(cls, Array.from({ length: EPIC_PICK + 1 }, (_, i) => (i === EPIC_PICK ? { power: first, level: 34, slots: [] } : null)));
        const opt = new BuildRules(gd, b).powerOption(first, EPIC_PICK);
        expect(opt.state === 'owned' || opt.state === 'available', `${cls} taking ${game}: ${opt.reason ?? ''}`).toBe(true);
        const probe = new BuildRules(gd, { ...b, picks: b.picks.map(() => null) }).powerOption(first, EPIC_PICK);
        expect(probe.state, `${cls} taking ${game}: ${probe.reason ?? ''}`).toBe('available');
      }
    }
  });

  it('imports and exports a Defender with Ice Mastery under the Mids name', () => {
    const frozen = pid(gd, 'Epic.Defender_Ice_Mastery.Frozen_Armor');
    const b = starter('Class_Defender', Array.from({ length: EPIC_PICK + 1 }, (_, i) => (i === EPIC_PICK ? { power: frozen, level: 34, slots: [] } : null)));
    const out = exportMbd(gd, map, b).mbd;
    expect(out.PowerEntries[EPIC_PICK]!.PowerName).toBe('Epic.Ice_Mastery_DefCorr.Frozen_Armor');
    expect(out.PowerSets).toContain('Epic.Ice_Mastery_DefCorr');
    const back = importMbd(gd, map, JSON.parse(JSON.stringify(out)) as Mbd);
    expect(back.warnings).toEqual([]);
    expect(back.build.picks[EPIC_PICK]?.power).toBe(frozen);
  });
});
