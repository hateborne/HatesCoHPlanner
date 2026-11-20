/**
 * The data files' brotli copies (src/data/packed.ts). GitHub Pages sends a file gzip-compressed and
 * nothing smaller, so its deploy puts a brotli copy beside each data file; a browser that unpacks
 * brotli itself asks for the copy. A copy can make a load smaller, but must never make it fail or
 * change what it reads: a link opens the same build with copies, without them, and with broken ones.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Duplex } from 'node:stream';
import { brotliCompressSync, constants, createBrotliDecompress } from 'node:zlib';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { serverById } from '../src/data/servers.ts';
import type { GameVersion } from '../src/data/versions.ts';
import { BROTLI_COPIES, COPY_STALL_MS, fetchJson, unpacksBrotli } from '../src/data/packed.ts';
import { checkBuild } from '../src/engine/validate.ts';
import { decodeShare } from '../src/io/share.ts';
import { dataDir, loadVersionIndex } from './helpers/data.ts';

// the DecompressionStream this Node has: the stand-ins below hand every other format on to it, as
// share links are unpacked with it (deflate)
const RealStream = globalThis.DecompressionStream;

/**
 * A stand-in for a browser's DecompressionStream that takes brotli (Node's own may not), over
 * Node's brotli: the loader's own stream handling runs against it as it would in the browser.
 */
class BrotliStream {
  readable!: ReadableStream<Uint8Array>;
  writable!: WritableStream<Uint8Array>;
  constructor(format: CompressionFormat) {
    if ((format as string) !== 'brotli') return new RealStream(format) as unknown as BrotliStream;
    const pair = Duplex.toWeb(createBrotliDecompress()) as unknown as { readable: ReadableStream<Uint8Array>; writable: WritableStream<Uint8Array> };
    this.readable = pair.readable;
    this.writable = pair.writable;
  }
}

/** A browser that knows DecompressionStream, but not brotli (Chrome, as of this change). */
class NoBrotliStream {
  constructor(format: CompressionFormat) {
    if ((format as string) === 'brotli') throw new TypeError("Failed to construct 'DecompressionStream': Unsupported compression format: 'brotli'");
    return new RealStream(format) as unknown as NoBrotliStream;
  }
}

/** @return Bytes as brotli (quickly: the copies' size is not what is tested here). */
const pack = (data: Uint8Array | string): Buffer => brotliCompressSync(Buffer.from(data), { params: { [constants.BROTLI_PARAM_QUALITY]: 1 } });

const DATA = { powers: Array.from({ length: 300 }, (_, i) => ({ id: i, name: `Power ${i}`, help: 'Deals moderate damage.' })) };
const TEXT = JSON.stringify(DATA);
const FILE = '/HatesCoHPlanner/data/i28p4/powers.json';
const Q = '?v=abc123';
vi.setConfig({ testTimeout: 60_000 }); // the last tests each read a whole version's game data, several times

/**
 * Stand in for the site: the answers by address, anything else "not found".
 *
 * @param files Each address's answer (a rejection stands for the network failing).
 * @return The addresses asked for, in order.
 */
function site(files: Record<string, () => Response | Promise<Response>>): string[] {
  const asked: string[] = [];
  vi.stubGlobal('fetch', (url: string) => {
    asked.push(String(url));
    const answer = files[String(url)];
    return answer ? Promise.resolve().then(answer) : Promise.resolve(new Response('not found', { status: 404 }));
  });
  return asked;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.doUnmock('../src/data/packed.ts');
  vi.resetModules();
});

describe('unpacksBrotli', () => {
  it('goes by what DecompressionStream takes', () => {
    vi.stubGlobal('DecompressionStream', BrotliStream);
    expect(unpacksBrotli()).toBe(true);
    vi.stubGlobal('DecompressionStream', NoBrotliStream);
    expect(unpacksBrotli()).toBe(false);
    vi.stubGlobal('DecompressionStream', undefined);
    expect(unpacksBrotli()).toBe(false);
  });
});

describe('fetchJson', () => {
  it('asks for the copy alone, and reads from it exactly what the file holds', async () => {
    vi.stubGlobal('DecompressionStream', BrotliStream);
    const asked = site({ [`${FILE}.br${Q}`]: () => new Response(pack(TEXT)), [`${FILE}${Q}`]: () => new Response(TEXT) });
    const r = await fetchJson(FILE, Q, /*copies=*/ true);
    expect([r.ok, r.status]).toEqual([true, 200]);
    expect(await r.json()).toEqual(DATA);
    expect(asked).toEqual([`${FILE}.br${Q}`]);
  });

  it('asks for the file as before when the site has no copies or the browser unpacks none', async () => {
    vi.stubGlobal('DecompressionStream', BrotliStream);
    const asked = site({ [`${FILE}.br${Q}`]: () => new Response(pack(TEXT)), [`${FILE}${Q}`]: () => new Response(TEXT), [FILE]: () => new Response(TEXT) });
    expect(await (await fetchJson(FILE, Q, /*copies=*/ false)).json()).toEqual(DATA);
    // a dev server, the tests and every build but GitHub Pages' are not marked as having copies
    expect(BROTLI_COPIES).toBe(false);
    expect(await (await fetchJson(FILE, Q)).json()).toEqual(DATA);
    expect(await (await fetchJson(FILE)).json()).toEqual(DATA);
    expect(asked).toEqual([`${FILE}${Q}`, `${FILE}${Q}`, FILE]);
  });

  it('gives a copy up for the file whenever the copy is not what it should be', async () => {
    vi.stubGlobal('DecompressionStream', BrotliStream);
    const whole = pack(TEXT);
    const copies: Record<string, () => Response | Promise<Response>> = {
      missing: () => new Response('not found', { status: 404 }),
      'refused by the host': () => new Response('no', { status: 403 }),
      'the network failing': () => Promise.reject(new TypeError('Failed to fetch')),
      'cut short': () => new Response(whole.subarray(0, whole.length - 25)),
      'not brotli at all (a host answering 200 with its own page)': () => new Response('<!doctype html><title>Page not found</title>'),
      'brotli of something that is not JSON': () => new Response(pack('not json')),
      empty: () => new Response(new Uint8Array(0)),
      'without a body to read': () => ({ ok: true, status: 200, body: null }) as unknown as Response,
    };
    for (const [what, copy] of Object.entries(copies)) {
      const asked = site({ [`${FILE}.br${Q}`]: copy, [`${FILE}${Q}`]: () => new Response(TEXT) });
      const r = await fetchJson(FILE, Q, /*copies=*/ true);
      expect(r.ok, what).toBe(true);
      expect(await r.json(), what).toEqual(DATA);
      expect(asked, what).toEqual([`${FILE}.br${Q}`, `${FILE}${Q}`]);
    }
  });

  it('reads a copy the browser has unpacked already (a host that names the encoding) without unpacking it twice', async () => {
    vi.stubGlobal('DecompressionStream', BrotliStream);
    const asked = site({ [`${FILE}.br${Q}`]: () => new Response(TEXT, { headers: { 'Content-Encoding': 'br' } }), [`${FILE}${Q}`]: () => new Response('{"from":"the file"}') });
    expect(await (await fetchJson(FILE, Q, /*copies=*/ true)).json()).toEqual(DATA);
    expect(asked).toEqual([`${FILE}.br${Q}`]);
  });

  it('gives up a copy that stalls, on its way or while it unpacks, so a build still opens', async () => {
    vi.stubGlobal('DecompressionStream', BrotliStream);
    vi.useFakeTimers();
    try {
      const whole = pack(TEXT);
      /** @return A copy's answer that sends some bytes and then nothing more, until it is called off. */
      const hanging = (first: Uint8Array | null) => (signal?: AbortSignal | null) =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(to) {
              if (first) to.enqueue(first);
              signal?.addEventListener('abort', () => to.error(new DOMException('The operation was aborted.', 'AbortError')));
            },
          }),
        );
      const stalls: Record<string, (signal?: AbortSignal | null) => Response | Promise<Response>> = {
        'no answer at all': () => new Promise<Response>(() => undefined),
        'an answer, then no bytes': hanging(null),
        'some bytes, then no more': hanging(whole.subarray(0, 40)),
      };
      for (const [what, copy] of Object.entries(stalls)) {
        const asked: string[] = [];
        let letGo = false; // the copy's request was called off
        vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
          asked.push(String(url));
          if (!String(url).includes('.br')) return Promise.resolve(new Response(TEXT));
          init?.signal?.addEventListener('abort', () => (letGo = true));
          return Promise.resolve(copy(init?.signal));
        });
        let done: unknown = null;
        void fetchJson(FILE, Q, /*copies=*/ true).then(async (r) => (done = await r.json()));
        await vi.advanceTimersByTimeAsync(COPY_STALL_MS - 1000);
        expect(done, what).toBeNull(); // still waited for
        expect(asked, what).toEqual([`${FILE}.br${Q}`]);
        await vi.advanceTimersByTimeAsync(2000);
        expect(done, what).toEqual(DATA);
        expect(asked, what).toEqual([`${FILE}.br${Q}`, `${FILE}${Q}`]);
        expect(letGo, what).toBe(true);
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps waiting for a copy that is slow but still arriving', async () => {
    vi.stubGlobal('DecompressionStream', BrotliStream);
    // only the stall clock is faked: the stand-in's own unpacking runs on Node's real event loop
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const whole = pack(TEXT);
      const asked: string[] = [];
      let feed: ReadableStreamDefaultController<Uint8Array> | null = null;
      vi.stubGlobal('fetch', (url: string) => {
        asked.push(String(url));
        return Promise.resolve(new Response(new ReadableStream<Uint8Array>({ start: (to) => void (feed = to) })));
      });
      let done: unknown = null;
      void fetchJson(FILE, Q, /*copies=*/ true).then(async (r) => (done = await r.json()));
      // a piece every 20 seconds: well past the stall limit in all, but never that long without one
      const third = Math.ceil(whole.length / 3);
      for (let i = 0; i < 3; i++) {
        await vi.advanceTimersByTimeAsync(20_000);
        feed!.enqueue(whole.subarray(i * third, (i + 1) * third));
      }
      await vi.advanceTimersByTimeAsync(20_000);
      feed!.close();
      vi.useRealTimers();
      await vi.waitFor(() => expect(done).toEqual(DATA));
      expect(asked).toEqual([`${FILE}.br${Q}`]); // the copy alone: it was never given up
    } finally {
      vi.useRealTimers();
    }
  });

  it("answers as the file itself does when that fails too, so the loader's own errors are unchanged", async () => {
    vi.stubGlobal('DecompressionStream', BrotliStream);
    site({});
    const gone = await fetchJson(FILE, Q, /*copies=*/ true);
    expect([gone.ok, gone.status]).toEqual([false, 404]);
    site({ [`${FILE}${Q}`]: () => Promise.reject(new TypeError('Failed to fetch')) });
    await expect(fetchJson(FILE, Q, /*copies=*/ true)).rejects.toThrow('Failed to fetch');
    await expect(fetchJson(FILE, Q, /*copies=*/ false)).rejects.toThrow('Failed to fetch');
  });

  it('never asks for a copy in a browser that unpacks no brotli, even on a site that has them', async () => {
    vi.stubGlobal('DecompressionStream', NoBrotliStream);
    const asked = site({ [`${FILE}.br${Q}`]: () => new Response(pack(TEXT)), [`${FILE}${Q}`]: () => new Response(TEXT) });
    // what the default works out on GitHub Pages' build: the site has copies, so the browser's answer decides
    const siteHasCopies = true;
    expect(await (await fetchJson(FILE, Q, /*copies=*/ siteHasCopies && unpacksBrotli())).json()).toEqual(DATA);
    expect(asked).toEqual([`${FILE}${Q}`]);
  });
});

describe('loading a game version through its copies', () => {
  const server = serverById('homecoming')!;
  const version = loadVersionIndex().versions.find((v) => v.id === 'i28p4') as GameVersion;
  const FOUR = ['core.json', 'powersets.json', 'powers.json', 'boosts.json'];
  // a real Blaster link made before links carried a version (the one tests/shareserver.test.ts keeps)
  const OLD =
    'eJwdzMtOwkAAQNE71BmeIowUCgq0WCwVW-y6nX_T-Ds-EhUXJkYTF8b_MUaJojI5yV1eIQTSBe_egGKtRVT63mSlRbT1ucmHFpF61yI6L4ClESiBokKFGjXOCgfujERJGjRo0iTjxpRRZVq08FmQcWuqqCo-AQGLf9emjqrTocM-I0acFtvwm-_AW9jGaaPRvIa7sM5dlEuXLh4eIT95D6dHSMyF6aP6DBjYjc9LuAdf-RA1JCSyYi7NmNKYgOd0gppwYCVkPKVT5JRDK-ExnSFnxBxZD-kcOefYSrgyKazyE-APA8cpuQ';

  /**
   * Load the version with the site standing in: its files from public/, and their copies as given.
   *
   * @param copies What the site answers for a file's copy (none: the site has no copies).
   * @param tryCopies Whether the loader tries copies (GitHub Pages' build, in a browser that unpacks brotli).
   * @return The loaded data and the addresses asked for.
   */
  async function load(copies: ((file: Buffer) => Response) | null, tryCopies: boolean) {
    const asked: string[] = [];
    vi.stubGlobal('DecompressionStream', BrotliStream);
    vi.stubGlobal('fetch', async (url: string) => {
      asked.push(String(url).split('?')[0]!);
      const path = String(url).split('?')[0]!.replace(/^.*?\/data\//, '');
      try {
        if (path.endsWith('.br')) return copies ? copies(readFileSync(join(dataDir(), path.slice(0, -3)))) : new Response('not found', { status: 404 });
        return new Response(readFileSync(join(dataDir(), path)));
      } catch {
        return new Response('not found', { status: 404 });
      }
    });
    vi.resetModules();
    vi.doMock('../src/data/packed.ts', async (original) => {
      const real = await original<typeof import('../src/data/packed.ts')>();
      return { ...real, fetchJson: (url: string, query?: string) => real.fetchJson(url, query, tryCopies) };
    });
    const { loadGameData } = await import('../src/data/gamedata.ts');
    const gd = await loadGameData(server, '/x/', version);
    return { gd, asked: asked.filter((u) => FOUR.some((f) => u.includes(`/i28p4/${f}`))).sort() };
  }

  it('reads the same game data, and opens an old link as the same build, with copies, without them and with broken ones', async () => {
    const plain = await load(null, /*tryCopies=*/ false);
    expect(plain.asked).toEqual(FOUR.map((f) => `/x/data/i28p4/${f}`).sort());

    const packed = await load((file) => new Response(pack(file)), /*tryCopies=*/ true);
    expect(packed.asked).toEqual(FOUR.map((f) => `/x/data/i28p4/${f}.br`).sort()); // the copies alone

    const broken = await load((file) => new Response(pack(file).subarray(0, 1000)), /*tryCopies=*/ true);
    expect(broken.asked).toEqual(FOUR.flatMap((f) => [`/x/data/i28p4/${f}`, `/x/data/i28p4/${f}.br`]).sort()); // each copy, then its file

    const missing = await load(null, /*tryCopies=*/ true);
    expect(missing.asked).toEqual(broken.asked);

    const link = await decodeShare(OLD);
    const opened = checkBuild(plain.gd, link);
    expect(opened.build?.picks.filter((p) => p?.power != null).length).toBe(24);
    for (const [what, other] of Object.entries({ packed, broken, missing })) {
      expect(JSON.stringify(other.gd.core), what).toBe(JSON.stringify(plain.gd.core));
      expect([other.gd.powerById.size, other.gd.setById.size, other.gd.boosts.length], what).toEqual([plain.gd.powerById.size, plain.gd.setById.size, plain.gd.boosts.length]);
      expect(JSON.stringify([...other.gd.powerById.values()]), what).toBe(JSON.stringify([...plain.gd.powerById.values()]));
      expect(checkBuild(other.gd, link), what).toEqual(opened);
    }
  });

  it("fails as before, with the file's own error, when a file is missing altogether", async () => {
    vi.stubGlobal('DecompressionStream', BrotliStream);
    vi.stubGlobal('fetch', async () => new Response('not found', { status: 404 }));
    vi.resetModules();
    vi.doMock('../src/data/packed.ts', async (original) => {
      const real = await original<typeof import('../src/data/packed.ts')>();
      return { ...real, fetchJson: (url: string, query?: string) => real.fetchJson(url, query, /*copies=*/ true) };
    });
    const { loadGameData } = await import('../src/data/gamedata.ts');
    await expect(loadGameData(server, '/x/', version)).rejects.toThrow(/game data i28p4\/.*\.json is missing \(HTTP 404\)/);
  });
});
