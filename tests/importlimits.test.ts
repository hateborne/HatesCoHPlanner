/**
 * Limits on what an import may make the tab do: a share link or Mids code from a stranger must be
 * refused with a readable message, quickly, however it was built. Decompressed data has a ceiling
 * (IMPORT_LIMITS.inflated / the 2 MB build-file size), counts past any real build's are refused, and a Mids
 * file whose fields have the wrong types is reported as damaged instead of failing part way. A
 * /build_save file is held to the same: its length, its powers, its slots and the lines it can't place.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { brotliCompressSync, deflateSync } from 'node:zlib';
import { describe, expect, it, vi } from 'vitest';
import { MAX_PET_SWITCHES } from '../src/engine/build.ts';
import { ByteWriter, streamBytes, toBase64, toBase64Url, TooLarge } from '../src/io/binary.ts';
import { finishBuildTxt, isBuildTxt, readBuildTxt } from '../src/io/buildtxt.ts';
import { safeFileName } from '../src/io/fileName.ts';
import { ImportProblem } from '../src/io/importProblem.ts';
import { IMPORT_LIMITS } from '../src/io/limits.ts';
import { importMbd, importMidsText, parseMidsText, type Mbd, type MidsMap } from '../src/io/mids.ts';
import { decodeShare } from '../src/io/share.ts';
import { loadData } from './helpers/data.ts';

// what a share link's or a Mids code's data may inflate to
const MAX_INFLATED = IMPORT_LIMITS.inflated;

// brotli-wasm's default (web) build fetches its .wasm, which Node can't: use its Node build
vi.mock('brotli-wasm', async () => {
  const { createRequire } = await import('node:module');
  const pkg: unknown = createRequire(import.meta.url)('brotli-wasm');
  return { default: Promise.resolve(pkg) };
});

const gd = loadData();
const map = JSON.parse(readFileSync(join(process.cwd(), 'public', 'data', gd.core.manifest.dataVersion, 'mids-map.json'), 'utf-8')) as MidsMap;

/** @return A promise's ImportProblem (fails the test if it resolves or throws anything else). */
async function problem(p: Promise<unknown>): Promise<ImportProblem> {
  const e = await p.then(
    () => undefined,
    (err: unknown) => err,
  );
  expect(e).toBeInstanceOf(ImportProblem);
  return e as ImportProblem;
}

/** A share link's payload whose data is `head` followed by `zeros` zero bytes. */
function shareLink(head: number[], zeros: number): string {
  const raw = new Uint8Array(head.length + zeros);
  raw.set(head);
  return toBase64Url(deflateSync(raw));
}

describe('decompression has a ceiling', () => {
  it('stops a stream as soon as it passes the limit', async () => {
    const bomb = deflateSync(new Uint8Array(8 * MAX_INFLATED));
    await expect(streamBytes(bomb, 'deflate', false)).rejects.toBeInstanceOf(TooLarge);
    const small = deflateSync(new Uint8Array(1000).fill(7));
    expect(await streamBytes(small, 'deflate', false)).toEqual(new Uint8Array(1000).fill(7));
  });

  it('refuses a share link that inflates past the ceiling', async () => {
    // a v1 header (version, at, origin, alignment, primary, secondary, empty name, no exemplar),
    // then a huge pick count and megabytes of zeros
    const head = [1, 0, 0, 0, 0, 0, 0, 0, 0x80, 0x80, 0x80, 0x40];
    const t0 = Date.now();
    const e = await problem(decodeShare(shareLink(head, 16 * MAX_INFLATED)));
    expect(e.reason).toContain('damaged');
    expect(Date.now() - t0).toBeLessThan(5000);
  });

  it('refuses counts no build has, even in a small link', async () => {
    const w = new ByteWriter();
    for (const v of [1, 0, 0, 0, 0, 0, 0, 0]) w.u8(v);
    w.varint(100_000); // picks
    await problem(decodeShare(toBase64Url(deflateSync(w.done()))));
  });

  it('refuses a link far longer than any build', async () => {
    await problem(decodeShare('A'.repeat(200_000)));
  });

  it('refuses a Mids |MBD; code whose Brotli data inflates past the build-file size', async () => {
    const raw = new TextEncoder().encode(`{"Class":"Class_Blaster","PowerEntries":[]${' '.repeat(4_000_000)}}`);
    const b64 = toBase64(brotliCompressSync(raw));
    const text = `|MBD;${raw.length};0;${b64.length};BASE64;|\n${b64}\n|-|`;
    const e = await problem(parseMidsText(text));
    expect(e.reason).toContain('damaged');
  });

  it('refuses a Mids |MxDz; code whose zlib data inflates past the ceiling', async () => {
    const hex = Buffer.from(deflateSync(new Uint8Array(8 * MAX_INFLATED))).toString('hex').toUpperCase();
    const text = `|MxDz;${8 * MAX_INFLATED};${hex.length / 2};${hex.length};HEX;|\n${hex}\n|-|`;
    await problem(importMidsText(gd, map, text));
  });

  it('refuses pasted text longer than a build file may be', async () => {
    const e = await problem(parseMidsText(`{"Class":"x",${' '.repeat(2_100_000)}"PowerEntries":[]}`));
    expect(e.reason).toContain('too long');
  });
});

describe('Mids build files with the wrong shape', () => {
  const base = (): Mbd => ({ Class: 'Class_Blaster', Origin: 'Magic', Alignment: 'Hero', PowerSets: ['Blaster_Ranged.Fire_Blast', 'Blaster_Support.Fire_Manipulation'], PowerEntries: [] });

  it('reports a damaged file instead of failing part way', async () => {
    const broken: unknown[] = [
      { ...base(), PowerEntries: [null] },
      { ...base(), PowerEntries: [{ PowerName: 'x', Level: 1, SlotEntries: 'no' }] },
      { ...base(), PowerEntries: [{ PowerName: 'x', Level: 1, SlotEntries: [{ Level: 'one' }] }] },
      { ...base(), PowerEntries: [{ PowerName: 'x', Level: 1, SlotEntries: [{ Level: 1, Enhancement: { Uid: 5 } }] }] },
      { ...base(), Origin: 7 },
      { ...base(), PowerSets: [1, 2] },
      { ...base(), PowerEntries: Array.from({ length: 600 }, () => ({ PowerName: '', Level: 0, SlotEntries: [] })) },
    ];
    for (const m of broken) {
      await problem(parseMidsText(JSON.stringify(m)));
      expect(() => importMbd(gd, map, m as Mbd)).toThrow(ImportProblem);
    }
  });

  it('still reads a well-formed file, null enhancements included', async () => {
    const m = { ...base(), PowerEntries: [{ PowerName: 'Blaster_Ranged.Fire_Blast.Flares', Level: 1, StatInclude: false, SlotEntries: [{ Level: 1, Enhancement: null }] }] };
    const parsed = await parseMidsText(JSON.stringify(m));
    expect(parsed.kind).toBe('mbd');
    expect(importMbd(gd, map, m as unknown as Mbd).build.picks[0]?.power).toBe(gd.powerByName.get('blaster_ranged.fire_blast.flares')!.id);
  });
});

describe('/build_save files have the same kind of limits', () => {
  const head = ['Example Guy: Level 50 Science Class_Blaster', '', 'Character Profile:', '------------------'];
  const flares = 'Level 1: Blaster_Ranged Fire_Blast Flares';
  const caltrops = 'Level 1: Blaster_Support Gadgets Caltrops';
  /** @return A file's ImportProblem and how long the reader took to refuse it. */
  const refused = (text: string) => {
    const t0 = Date.now();
    let e: unknown;
    try {
      readBuildTxt(gd, text);
    } catch (err) {
      e = err;
    }
    expect(e).toBeInstanceOf(ImportProblem);
    return { e: e as ImportProblem, ms: Date.now() - t0 };
  };

  it('refuses a power with more slots than any build has, at once (it froze the tab for minutes)', () => {
    // 1.7 MB: one real power, then a quarter of a million empty slots under it
    const { e, ms } = refused([...head, caltrops, flares, ...Array.from({ length: 250_000 }, () => '\tEMPTY')].join('\n'));
    expect(e.reason).toContain('more powers or slots');
    expect(ms).toBeLessThan(2000);
  });

  it('refuses more powers than any build has, and a power list of lines it cannot place', () => {
    expect(refused([...head, ...Array.from({ length: 5000 }, () => flares)].join('\n')).e.reason).toContain('more powers or slots');
    expect(refused([...head, flares, ...Array.from({ length: 5000 }, () => '\tnot an enhancement line')].join('\n')).e.reason).toContain('/build_save');
  });

  it('refuses text longer than a build file may be, pasted or opened', () => {
    const long = [...head, caltrops, flares, ' '.repeat(2_100_000)].join('\n');
    expect(isBuildTxt(long)).toBe(false); // so the paste box reports it as too long, like any text
    expect(refused(long).e.reason).toContain('too long');
  });

  it('books the slots of the most it accepts in no time', () => {
    // every pick the schedule has, each listed with the most slots a line of powers may carry
    const fire = gd.setByName.get('blaster_ranged.fire_blast')!;
    const powers = fire.p.map((id, i) => ({ n: gd.power(id).n.split('.'), level: (fire.av[i] ?? 0) + 1 })).filter((p) => p.level >= 1);
    const lines = powers.flatMap((p) => [`Level ${p.level}: ${p.n.join(' ')}`, ...Array.from({ length: 64 }, () => '\tEMPTY')]);
    const imp = readBuildTxt(gd, [...head, caltrops, ...lines].join('\n'));
    const t0 = Date.now();
    const b = finishBuildTxt(gd, imp, { alignment: 'Hero', respec: true });
    expect(Date.now() - t0).toBeLessThan(1000);
    expect(b.picks.some((p) => p && p.slots.length === 64)).toBe(true); // checkBuild trims these as it opens the build
  });
});

describe('export file names', () => {
  it('keeps characters file systems refuse out of a downloaded file name', () => {
    expect(safeFileName('Ill/Rad AV Soloer.mbd')).toBe('Ill_Rad AV Soloer.mbd');
    expect(safeFileName('..\\..\\evil.mbd')).toBe('_.._evil.mbd');
    expect(safeFileName('a<b>c:d"e|f?g*h\u0007.mbd')).toBe('a_b_c_d_e_f_g_h_.mbd');
    expect(safeFileName('.mbd')).toBe('build.mbd');
    expect(safeFileName('Fire Farmer.mbd')).toBe('Fire Farmer.mbd');
  });
});

describe('Hero Plan text above a legacy Mids chunk', () => {
  /** A Fire Blast / Fire Manipulation chunk whose pick 0 has a Mids index the map lacks, with `head` pasted above it. */
  async function withHead(head: string) {
    const sets = ['Blaster_Ranged.Fire_Blast', 'Blaster_Support.Fire_Manipulation'];
    const w = new ByteWriter();
    w.bytes(new Uint8Array([77, 120, 68, 12]));
    w.f32(3.2);
    w.bool(false);
    w.bool(true);
    for (const s of ['Class_Blaster', 'Magic']) w.netString(s);
    w.i32(0);
    w.netString('Plan');
    w.i32(sets.length - 1);
    for (const s of sets) w.netString(s);
    w.i32(0);
    w.i32(23); // 24 power entries
    for (let i = 0; i < 24; i++) {
      w.i32(i === 0 ? 999_999 : -1);
      if (i === 0) {
        w.i8(0); // level 1
        w.bool(true);
        w.bool(false);
        w.i32(0);
        w.i32(0);
        w.i8(-1);
      }
      w.i8(-1); // no slots
    }
    const raw = w.done();
    const hex = Buffer.from(deflateSync(raw)).toString('hex').toUpperCase();
    return importMidsText(gd, map, `${head}|MxDz;${raw.length};${hex.length / 2};${hex.length};HEX;|\n${hex}\n|----|`);
  }
  const lost = ["A power couldn't be identified, so it was left out"];

  it('ignores a flood of Level lines, very long names and lines, and out-of-range levels', async () => {
    const t0 = Date.now();
    expect((await withHead('Level 1: Nothing -- x\n'.repeat(80_000))).warnings).toEqual(lost);
    expect(Date.now() - t0).toBeLessThan(5000);
    expect((await withHead(`Level 1: ${'Flares '.repeat(50)} -- x\n`)).warnings).toEqual(lost); // a name over 80 characters
    expect((await withHead(`Level 1: Flares${' '.repeat(5000)}-- x\n`)).warnings).toEqual(lost); // a line over 400 characters
    expect((await withHead('Level 0: Flares -- x\nLevel 51: Flares -- x\nLevel 100: Flares\n')).warnings).toEqual(lost);
    // the real line comes after the 200 lines the importer reads
    expect((await withHead(`${'Level 1: Nothing -- x\n'.repeat(200)}Level 1: Flares -- x\n`)).warnings).toEqual(lost);
  });

  it('strips hidden characters, and a name matching nothing changes nothing', async () => {
    expect((await withHead('Level 1: Fla\u202Ere\u200Bs -- x\n')).warnings).toEqual([]); // stripped, so it reads as "Flares"
    expect((await withHead('Level 1: \u202Esralf\u202C -- x\n')).warnings).toEqual(lost); // reversed text is not "Flares"
    expect((await withHead('Level 1: Nothing At All\u0000\u0007 -- x\n')).warnings).toEqual(lost);
    expect((await withHead('<script>alert(1)</script>\nLevel 1: Blaster_Ranged.Fire_Blast.Flares\n')).warnings).toEqual(lost); // internal full names are not names
  });
});

describe('the import limits table', () => {
  it('holds the numbers each reader has always had (a share link is never read with lower ones)', () => {
    expect(IMPORT_LIMITS).toEqual({
      text: 2_000_000,
      inflated: 1_048_576,
      link: { payload: 65_536, picks: 64, slots: 32, granted: 512, petSwitches: 64, petName: 160 },
      mids: { sets: 32, powers: 512, slots: 64 },
      buildTxt: { powers: 512, slots: 64, skipped: 200 },
    });
    // one number for the pet switches a checked build keeps and a link reads
    expect(IMPORT_LIMITS.link.petSwitches).toBe(MAX_PET_SWITCHES);
  });
});
