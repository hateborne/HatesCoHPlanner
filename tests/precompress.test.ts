/**
 * The pre-compressed copies the deploy writes beside the site's files for its own domain
 * (scripts/precompress.mjs; the web server there hands them out as they are): which files get
 * them, and that each copy holds exactly its file.
 */
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { brotliDecompressSync, gunzipSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import { MIN_BYTES, precompress, wantsCopies } from '../scripts/precompress.mjs';

const made: string[] = [];

/** @return A new empty folder, removed after the test. */
function folder(): string {
  const dir = mkdtempSync(join(tmpdir(), 'hcp-precompress-'));
  made.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('wantsCopies', () => {
  it('takes the text files, the WebAssembly module and the fonts', () => {
    for (const n of ['index.html', 'assets/index-abc.js', 'assets/index-abc.css', 'data/i28p4/powers.json', 'assets/brotli_wasm_bg-x.wasm', 'assets/fonts/Game.ttf', 'DATA/X.JSON']) {
      expect(wantsCopies(n, MIN_BYTES), n).toBe(true);
    }
  });

  it('leaves out art and sounds, small files, and copies themselves', () => {
    for (const n of ['assets/ui/frame.png', 'assets/ui/frame.webp', 'assets/sounds/select.ogg', 'data/i28p4/powers.json.br', 'data/i28p4/powers.json.gz', 'json', 'notes']) {
      expect(wantsCopies(n, 1_000_000), n).toBe(false);
    }
    expect(wantsCopies('index.html', MIN_BYTES - 1)).toBe(false);
  });
});

describe('precompress', () => {
  it('writes a brotli and a gzip copy that hold exactly their file, in every folder', async () => {
    const dir = folder();
    mkdirSync(join(dir, 'data', 'i28p4'), { recursive: true });
    const json = JSON.stringify({ powers: Array.from({ length: 400 }, (_, i) => ({ id: i, name: `Power ${i}`, help: 'Deals moderate damage.' })) });
    const html = `<!doctype html><title>x</title>${'<p>planner</p>'.repeat(200)}`;
    writeFileSync(join(dir, 'data', 'i28p4', 'powers.json'), json);
    writeFileSync(join(dir, 'index.html'), html);
    const t = await precompress(dir);
    expect(t.files).toBe(2);
    expect(t.bytes).toBe(Buffer.byteLength(json) + Buffer.byteLength(html));
    expect(t.br).toBeLessThan(t.gz);
    expect(t.gz).toBeLessThan(t.bytes);
    for (const [p, text] of [[join(dir, 'data', 'i28p4', 'powers.json'), json], [join(dir, 'index.html'), html]] as const) {
      expect(readFileSync(p, 'utf8')).toBe(text); // the file itself is untouched
      expect(brotliDecompressSync(readFileSync(`${p}.br`)).toString('utf8')).toBe(text);
      expect(gunzipSync(readFileSync(`${p}.gz`)).toString('utf8')).toBe(text);
    }
  });

  it('gives no copies to art, sounds or small files, and none to a copy when run again', async () => {
    const dir = folder();
    const noise = Buffer.from(Array.from({ length: 4096 }, (_, i) => (i * 7919 + (i >> 3) * 104729) & 0xff));
    writeFileSync(join(dir, 'frame.png'), noise);
    writeFileSync(join(dir, 'select.ogg'), noise);
    writeFileSync(join(dir, 'tiny.json'), '{"a":1}');
    writeFileSync(join(dir, 'big.json'), JSON.stringify(Array.from({ length: 500 }, (_, i) => ({ i, text: 'the same words again' }))));
    expect((await precompress(dir)).files).toBe(1);
    const first = readdirSync(dir).sort();
    expect(first).toEqual(['big.json', 'big.json.br', 'big.json.gz', 'frame.png', 'select.ogg', 'tiny.json']);
    const br = readFileSync(join(dir, 'big.json.br'));
    expect((await precompress(dir)).files).toBe(1);
    expect(readdirSync(dir).sort()).toEqual(first);
    expect(readFileSync(join(dir, 'big.json.br')).equals(br)).toBe(true);
  });

  it('drops a copy whose file no longer calls for one, so no stale copy is handed out', async () => {
    const dir = folder();
    const p = join(dir, 'data.json');
    writeFileSync(p, JSON.stringify(Array.from({ length: 500 }, (_, i) => ({ i, text: 'the same words again' }))));
    await precompress(dir);
    expect(existsSync(`${p}.br`) && existsSync(`${p}.gz`)).toBe(true);
    // the file changes to one too small for copies: the old ones must not stay beside it
    writeFileSync(p, '{"a":1}');
    expect((await precompress(dir)).files).toBe(0);
    expect(readdirSync(dir)).toEqual(['data.json']);
    // a file that only looks like a copy (nothing of that name beside it) is left alone
    writeFileSync(join(dir, 'archive.gz'), 'not ours');
    await precompress(dir);
    expect(readdirSync(dir).sort()).toEqual(['archive.gz', 'data.json']);
  });

  it('writes no copy that would be larger than its file', async () => {
    const dir = folder();
    // bytes with no pattern to them, under a name that would otherwise get copies
    let x = 0x2545f491;
    const noise = Buffer.from(Array.from({ length: 8192 }, () => ((x = (Math.imul(x, 1664525) + 1013904223) | 0) >>> 24)));
    writeFileSync(join(dir, 'packed.wasm'), noise);
    const t = await precompress(dir);
    expect(t.files).toBe(1);
    expect(existsSync(join(dir, 'packed.wasm.br'))).toBe(false);
    expect(existsSync(join(dir, 'packed.wasm.gz'))).toBe(false);
    expect([t.br, t.gz]).toEqual([noise.length, noise.length]);
  });
});
