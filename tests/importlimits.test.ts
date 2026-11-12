/**
 * Limits on what an import may make the tab do: a share link or Mids code from a stranger must be
 * refused with a readable message, quickly, however it was built. Decompressed data has a ceiling
 * (MAX_INFLATED / the 2 MB build-file size), counts past any real build's are refused, and a Mids
 * file whose fields have the wrong types is reported as damaged instead of failing part way.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { brotliCompressSync, deflateSync } from 'node:zlib';
import { describe, expect, it, vi } from 'vitest';
import { ByteWriter, MAX_INFLATED, streamBytes, toBase64, toBase64Url, TooLarge } from '../src/io/binary.ts';
import { safeFileName } from '../src/io/fileName.ts';
import { ImportProblem } from '../src/io/importProblem.ts';
import { importMbd, importMidsText, parseMidsText, type Mbd, type MidsMap } from '../src/io/mids.ts';
import { decodeShare } from '../src/io/share.ts';
import { loadData } from './helpers/data.ts';

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

describe('export file names', () => {
  it('keeps characters file systems refuse out of a downloaded file name', () => {
    expect(safeFileName('Ill/Rad AV Soloer.mbd')).toBe('Ill_Rad AV Soloer.mbd');
    expect(safeFileName('..\\..\\evil.mbd')).toBe('_.._evil.mbd');
    expect(safeFileName('a<b>c:d"e|f?g*h\u0007.mbd')).toBe('a_b_c_d_e_f_g_h_.mbd');
    expect(safeFileName('.mbd')).toBe('build.mbd');
    expect(safeFileName('Fire Farmer.mbd')).toBe('Fire Farmer.mbd');
  });
});
