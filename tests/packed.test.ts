/**
 * The data files' downloads and their brotli copies (src/data/packed.ts). GitHub Pages sends a file
 * gzip-compressed and nothing smaller; a build marked for it asks for a brotli copy of each data
 * file in a browser that unpacks brotli itself. No deploy marks its build today (the copies are
 * switched off: docs/architecture.md), but the path is kept, and kept honest here: a copy can make
 * a load smaller, but must never make it fail or change what it reads. A link opens the same build
 * with copies, without them, and with broken ones.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Duplex } from 'node:stream';
import { brotliCompressSync, constants, createBrotliDecompress } from 'node:zlib';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { serverById } from '../src/data/servers.ts';
import type { GameVersion } from '../src/data/versions.ts';
import { BROTLI_COPIES, COPY_STALL_MS, fetchJson, unpacksBrotli } from '../src/data/packed.ts';
import { asAgain, Watch } from '../src/data/watch.ts'; // their own tests: tests/watch.test.ts
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
    // what the default works out in a build marked as having copies: the browser's answer decides
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
   * @param tryCopies Whether the loader tries copies (a build marked for them, in a browser that unpacks brotli).
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

describe('fetchJson under a watch', () => {
  /** @return A body that arrives in `n` parts. */
  const inParts = (text: string, n: number): ReadableStream<Uint8Array> =>
    new ReadableStream<Uint8Array>({
      start(to) {
        const bytes = new TextEncoder().encode(text);
        const size = Math.ceil(bytes.length / n);
        for (let i = 0; i < bytes.length; i += size) to.enqueue(bytes.subarray(i, i + size));
        to.close();
      },
    });

  /**
   * Stand in for a site whose downloads never answer, until they are given up.
   *
   * @return The addresses asked for, in order.
   */
  function silentSite(): string[] {
    const asked: string[] = [];
    vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
      asked.push(String(url));
      return new Promise<Response>((_, reject) => {
        const fail = (): void => reject(new DOMException('The operation was aborted.', 'AbortError'));
        if (init?.signal?.aborted) fail();
        else init?.signal?.addEventListener('abort', fail);
      });
    });
    return asked;
  }

  it('tells the watch of its answer and of each part of its body, and that it has ended', async () => {
    const watch = new Watch();
    const received = vi.spyOn(watch, 'received');
    const end = vi.spyOn(watch, 'end');
    let signal: AbortSignal | null | undefined;
    vi.stubGlobal('fetch', (_url: string, init?: RequestInit) => {
      signal = init?.signal;
      return Promise.resolve(new Response(inParts(TEXT, 3)));
    });
    const r = await fetchJson(FILE, Q, /*copies=*/ false, watch);
    expect(signal?.aborted).toBe(false); // started with a signal the watch can give it up through
    expect(received).toHaveBeenCalledTimes(1); // its answer
    expect(end).not.toHaveBeenCalled(); // its body is still to come
    expect(await r.json()).toEqual(DATA);
    expect(received.mock.calls.length).toBeGreaterThanOrEqual(4); // and each of the three parts
    expect(end.mock.calls).toEqual([[`${FILE}${Q}`]]); // the last of it arrived
    // so giving the watch up now marks nothing for a fresh fetch
    watch.cancel();
    expect(asAgain(`${FILE}${Q}`)).toEqual({});
  });

  it('tells the watch of each part of a copy, too', async () => {
    vi.stubGlobal('DecompressionStream', BrotliStream);
    const watch = new Watch();
    const received = vi.spyOn(watch, 'received');
    site({ [`${FILE}.br${Q}`]: () => new Response(pack(TEXT)) });
    expect(await (await fetchJson(FILE, Q, /*copies=*/ true, watch)).json()).toEqual(DATA);
    expect(received.mock.calls.length).toBeGreaterThanOrEqual(2); // its answer, and its body
  });

  it('returns a failed answer as it came, its download over', async () => {
    const watch = new Watch();
    const end = vi.spyOn(watch, 'end');
    const missing = new Response('not found', { status: 404 });
    vi.stubGlobal('fetch', () => Promise.resolve(missing));
    expect(await fetchJson(FILE, Q, /*copies=*/ false, watch)).toBe(missing);
    expect(end.mock.calls).toEqual([[`${FILE}${Q}`]]);
  });

  it("never calls a download quiet whose body it can't hear arriving (an older browser), until its JSON is read", async () => {
    const watch = new Watch();
    let finish = (): void => undefined;
    const reading = new Promise<void>((r) => (finish = r));
    // an answer with no body to read in parts (an older browser, the tests' own stand-ins)
    vi.stubGlobal('fetch', () => Promise.resolve({ ok: true, status: 200, json: () => reading.then(() => DATA) }));
    const r = await fetchJson(FILE, Q, /*copies=*/ false, watch);
    const data = r.json();
    expect(watch.quietIn(5_000)).toBe(Infinity); // it may be arriving all along
    finish();
    expect(await data).toEqual(DATA);
    expect(watch.quietIn(5_000)).not.toBe(Infinity); // it has ended
  });

  it('fails at once when the watch gives the file up', async () => {
    const asked = silentSite();
    const watch = new Watch();
    const got = fetchJson(FILE, Q, /*copies=*/ false, watch);
    watch.cancel();
    await expect(got).rejects.toThrow('aborted');
    expect(asked).toEqual([`${FILE}${Q}`]);
  });

  it('fails at once when the watch gives a copy up: the file is not fetched in its place', async () => {
    vi.stubGlobal('DecompressionStream', BrotliStream);
    const asked = silentSite();
    const watch = new Watch();
    const got = fetchJson(FILE, Q, /*copies=*/ true, watch);
    watch.cancel();
    await expect(got).rejects.toThrow('aborted');
    expect(asked).toEqual([`${FILE}.br${Q}`]);
  });

  it('gives up a body half read', async () => {
    const watch = new Watch();
    vi.stubGlobal('fetch', (_url: string, init?: RequestInit) => {
      // half the file, then nothing more until the download is given up
      const body = new ReadableStream<Uint8Array>({
        start(to) {
          to.enqueue(new TextEncoder().encode(TEXT.slice(0, TEXT.length >> 1)));
          init?.signal?.addEventListener('abort', () => to.error(new DOMException('The operation was aborted.', 'AbortError')));
        },
      });
      return Promise.resolve(new Response(body));
    });
    const r = await fetchJson(FILE, Q, /*copies=*/ false, watch);
    const read = r.json();
    watch.cancel();
    await expect(read).rejects.toThrow('aborted');
  });
});

describe('a download given up, asked for again', () => {
  /**
   * Stand in for a site whose first download of each address stalls (its answer never comes, until
   * it is given up) and whose later ones answer.
   *
   * @param answer What a later download answers with.
   * @return Each request's address and how it was asked of the browser's cache, in order.
   */
  function stallingSite(answer: (url: string) => Response): [string, RequestCache | undefined][] {
    const asked: [string, RequestCache | undefined][] = [];
    const seen = new Set<string>();
    vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
      asked.push([String(url), init?.cache]);
      if (seen.has(String(url))) return Promise.resolve(answer(String(url)));
      seen.add(String(url));
      return new Promise<Response>((_, reject) => {
        const fail = (): void => reject(new DOMException('The operation was aborted.', 'AbortError'));
        if (init?.signal?.aborted) fail();
        else init?.signal?.addEventListener('abort', fail);
      });
    });
    return asked;
  }

  it('goes past the browser cache once: the browser may still hold the download given up', async () => {
    const other = '/HatesCoHPlanner/data/i28p4/again.json'; // an address no other test gives up
    const asked = stallingSite(() => new Response(TEXT));
    const first = new Watch();
    const got = fetchJson(other, Q, /*copies=*/ false, first);
    first.cancel();
    await expect(got).rejects.toThrow('aborted');
    expect(await (await fetchJson(other, Q, /*copies=*/ false, new Watch())).json()).toEqual(DATA);
    expect(await (await fetchJson(other, Q, /*copies=*/ false, new Watch())).json()).toEqual(DATA);
    expect(asked).toEqual([
      [`${other}${Q}`, undefined],
      [`${other}${Q}`, 'reload'],
      [`${other}${Q}`, undefined],
    ]);
  });

  it('goes past it for a copy given up, too', async () => {
    vi.stubGlobal('DecompressionStream', BrotliStream);
    const other = '/HatesCoHPlanner/data/i28p4/again-copy.json';
    const asked = stallingSite((url) => (url.includes('.br') ? new Response(pack(TEXT)) : new Response(TEXT)));
    const first = new Watch();
    const got = fetchJson(other, Q, /*copies=*/ true, first);
    first.cancel();
    await expect(got).rejects.toThrow('aborted');
    expect(await (await fetchJson(other, Q, /*copies=*/ true, new Watch())).json()).toEqual(DATA);
    expect(asked).toEqual([
      [`${other}.br${Q}`, undefined],
      [`${other}.br${Q}`, 'reload'],
    ]);
  });

  it('is asked for as ever when it had arrived, or had failed by itself, before the watch was given up', async () => {
    const other = '/HatesCoHPlanner/data/i28p4/arrived.json';
    const asked: (RequestCache | undefined)[] = [];
    vi.stubGlobal('fetch', (_url: string, init?: RequestInit) => {
      asked.push(init?.cache);
      return Promise.resolve(new Response(TEXT));
    });
    const watch = new Watch();
    expect(await (await fetchJson(other, Q, /*copies=*/ false, watch)).json()).toEqual(DATA);
    watch.cancel(); // nothing of its is still under way
    expect(await (await fetchJson(other, Q, /*copies=*/ false, new Watch())).json()).toEqual(DATA);
    expect(asked).toEqual([undefined, undefined]);
    // and one that failed by itself
    const failing = '/HatesCoHPlanner/data/i28p4/failed.json';
    vi.stubGlobal('fetch', (_url: string, init?: RequestInit) => {
      asked.push(init?.cache);
      return asked.length === 3 ? Promise.reject(new TypeError('Failed to fetch')) : Promise.resolve(new Response(TEXT));
    });
    const second = new Watch();
    await expect(fetchJson(failing, Q, /*copies=*/ false, second)).rejects.toThrow('Failed to fetch');
    second.cancel();
    expect(await (await fetchJson(failing, Q, /*copies=*/ false, new Watch())).json()).toEqual(DATA);
    expect(asked.slice(2)).toEqual([undefined, undefined]);
  });
});
