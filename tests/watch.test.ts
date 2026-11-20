/**
 * Watched downloads (src/data/watch.ts): what tells a download that stalled from one that is slow,
 * and asks again for a file that gets no answer. A slow connection must never be punished for
 * being slow: nothing is cancelled by itself, a file with no answer is asked for a second time
 * alongside the first, and whichever answers first is used.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { asAgain, ask, EXTRA_ASKS, STALLED_MS, Watch } from '../src/data/watch.ts';

const A = '/data/a.json';
const B = '/data/b.json';

/** One request the stand-in for fetch has been made. */
interface Asked {
  url: string;
  cache: RequestCache | undefined; // how it was asked of the browser's cache
  signal: AbortSignal; // what would give it up
  answer: (r: Response) => void; // its answer comes
  fail: (why: Error) => void; // it fails by itself
}

/**
 * Stand in for a site whose answers come when the test says so. A request given up fails at once,
 * as a browser's does.
 *
 * @return The requests made, in order.
 */
function slowSite(): Asked[] {
  const asked: Asked[] = [];
  vi.stubGlobal('fetch', (url: string, init: RequestInit = {}) => {
    const signal = init.signal!;
    const gone = (): Error => new DOMException('The operation was aborted.', 'AbortError');
    if (signal.aborted) return Promise.reject(gone()); // refused before it goes out
    return new Promise<Response>((answer, fail) => {
      signal.addEventListener('abort', () => fail(gone()));
      asked.push({ url: String(url), cache: init.cache, signal, answer, fail });
    });
  });
  return asked;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('Watch', () => {
  it('is quiet once nothing has been heard for long enough, and not before', () => {
    const watch = new Watch();
    watch.begin(A);
    vi.advanceTimersByTime(STALLED_MS - 1);
    expect(watch.quiet(STALLED_MS)).toBe(false);
    expect(watch.quietIn(STALLED_MS)).toBe(1);
    vi.advanceTimersByTime(1);
    expect(watch.quiet(STALLED_MS)).toBe(true);
    watch.received();
    expect(watch.quiet(STALLED_MS)).toBe(false);
    expect(watch.quietIn(STALLED_MS)).toBe(STALLED_MS);
  });

  it('takes a download that begins as a sign of life', () => {
    const watch = new Watch();
    vi.advanceTimersByTime(STALLED_MS * 6);
    expect(watch.quiet(STALLED_MS)).toBe(true);
    watch.begin(A);
    expect(watch.quiet(STALLED_MS)).toBe(false);
  });

  it('goes by the steady clock, not the time of day (which jumps when a device sets its time)', () => {
    const watch = new Watch();
    const day = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 3_600_000);
    try {
      expect(watch.quiet(STALLED_MS)).toBe(false);
    } finally {
      day.mockRestore();
    }
  });

  it("is never quiet while a download is under way that it can't hear", () => {
    const watch = new Watch();
    watch.begin(A);
    watch.begin(B);
    watch.unheard(A);
    vi.advanceTimersByTime(STALLED_MS * 20);
    expect(watch.quietIn(STALLED_MS)).toBe(Infinity);
    expect(watch.quiet(STALLED_MS)).toBe(false);
    watch.end(A); // it has ended: the rest can be heard, and has been silent all along
    expect(watch.quiet(STALLED_MS)).toBe(true);
  });

  it('gives its downloads up through its signal, and marks those still under way for a fresh fetch, once', () => {
    const watch = new Watch();
    watch.begin(A);
    watch.begin(B);
    watch.end(B); // all of B arrived
    expect(watch.signal.aborted).toBe(false);
    watch.cancel();
    expect(watch.signal.aborted).toBe(true);
    expect(asAgain(A)).toEqual({ cache: 'reload' });
    expect(asAgain(A)).toEqual({});
    expect(asAgain(B)).toEqual({});
  });
});

describe('ask', () => {
  it('asks once, and gives the answer, when it comes in time', async () => {
    const asked = slowSite();
    const watch = new Watch();
    const got = ask(A, watch, { cache: 'no-cache' });
    await vi.advanceTimersByTimeAsync(STALLED_MS - 1);
    const answer = new Response('{}');
    asked[0]!.answer(answer);
    expect(await got).toBe(answer);
    await vi.advanceTimersByTimeAsync(STALLED_MS * 10);
    expect(asked.map((a) => [a.url, a.cache])).toEqual([[A, 'no-cache']]);
    expect(asked[0]!.signal.aborted).toBe(false);
  });

  it('asks again alongside when no answer comes, past the browser cache, as often as allowed, and cancels nothing', async () => {
    const asked = slowSite();
    void ask(A, new Watch(), { cache: 'no-cache' });
    await vi.advanceTimersByTimeAsync(STALLED_MS - 1);
    expect(asked.length).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(asked.length).toBe(2);
    await vi.advanceTimersByTimeAsync(STALLED_MS);
    expect(asked.length).toBe(3);
    // asked as often as it may be: left as it is, however long the silence
    await vi.advanceTimersByTimeAsync(STALLED_MS * 20);
    expect(asked.length).toBe(1 + EXTRA_ASKS);
    expect(asked.map((a) => a.cache)).toEqual(['no-cache', 'reload', 'reload']);
    expect(asked.map((a) => a.signal.aborted)).toEqual([false, false, false]);
  });

  it('uses the first ask when it is only slow to answer: its wait is not thrown away', async () => {
    const asked = slowSite();
    const got = ask(A, new Watch());
    await vi.advanceTimersByTimeAsync(STALLED_MS + 2000); // 7 seconds to its first byte
    expect(asked.length).toBe(2);
    const answer = new Response('{}');
    asked[0]!.answer(answer);
    expect(await got).toBe(answer);
    // the ask made alongside is let go of, and none follows
    expect(asked.map((a) => a.signal.aborted)).toEqual([false, true]);
    await vi.advanceTimersByTimeAsync(STALLED_MS * 10);
    expect(asked.length).toBe(2);
  });

  it('uses the ask made alongside when that answers first, and lets go of the one that hung', async () => {
    const asked = slowSite();
    const got = ask(A, new Watch());
    await vi.advanceTimersByTimeAsync(STALLED_MS);
    const answer = new Response('{}');
    asked[1]!.answer(answer);
    expect(await got).toBe(answer);
    expect(asked.map((a) => a.signal.aborted)).toEqual([true, false]);
    // an answer the first one gives after all changes nothing
    asked[0]!.answer(new Response('late'));
    expect(await got).toBe(answer);
  });

  it('does not ask again while anything of the watch is arriving: the file is waiting its turn', async () => {
    const asked = slowSite();
    const watch = new Watch();
    watch.begin(B);
    void ask(A, watch);
    // B streams for two minutes, a part every 4 seconds; A has no answer all that time
    for (let i = 0; i < 30; i++) {
      await vi.advanceTimersByTimeAsync(STALLED_MS - 1000);
      watch.received();
    }
    expect(asked.length).toBe(1);
    // B ends, and then nothing arrives at all: now A is asked for again
    watch.end(B);
    await vi.advanceTimersByTimeAsync(STALLED_MS);
    expect(asked.length).toBe(2);
  });

  it('asks again for every file with no answer at the same pace: an extra ask is no sign of life, and the watch stays quiet', async () => {
    const asked = slowSite();
    const watch = new Watch();
    const files = [A, B, '/data/c.json', '/data/d.json'];
    for (const url of files) void ask(url, watch).catch(() => undefined);
    await vi.advanceTimersByTimeAsync(STALLED_MS);
    expect(asked.map((a) => a.url).sort()).toEqual([...files, ...files].sort()); // each a second time
    expect(watch.quiet(STALLED_MS)).toBe(true); // nothing has arrived: Try again may give them up
    await vi.advanceTimersByTimeAsync(STALLED_MS);
    expect(asked.length).toBe(files.length * (1 + EXTRA_ASKS));
    expect(watch.quiet(STALLED_MS)).toBe(true);
    await vi.advanceTimersByTimeAsync(STALLED_MS * 10);
    expect(asked.length).toBe(files.length * (1 + EXTRA_ASKS));
  });

  it('once the file that was arriving has ended, asks again for all the rest together, not one after another', async () => {
    const asked = slowSite();
    const watch = new Watch();
    watch.begin('/data/slow.json');
    const waiting = [A, B, '/data/c.json'];
    for (const url of waiting) void ask(url, watch).catch(() => undefined);
    for (let i = 0; i < 10; i++) {
      await vi.advanceTimersByTimeAsync(STALLED_MS - 1000);
      watch.received(); // the slow file keeps arriving
    }
    expect(asked.length).toBe(3);
    watch.end('/data/slow.json');
    await vi.advanceTimersByTimeAsync(STALLED_MS);
    expect(asked.length).toBe(6);
    await vi.advanceTimersByTimeAsync(STALLED_MS);
    expect(asked.length).toBe(9);
  });

  it("does not ask again while a download is under way that the watch can't hear", async () => {
    const asked = slowSite();
    const watch = new Watch();
    watch.begin(B);
    watch.unheard(B);
    void ask(A, watch);
    await vi.advanceTimersByTimeAsync(STALLED_MS * 20);
    expect(asked.length).toBe(1);
  });

  it('never asks again once the answer has come, however long its body takes or stalls', async () => {
    const asked = slowSite();
    const watch = new Watch();
    const got = ask(A, watch);
    asked[0]!.answer(new Response('{}'));
    await got;
    await vi.advanceTimersByTimeAsync(STALLED_MS * 20);
    expect(asked.length).toBe(1);
    expect(asked[0]!.signal.aborted).toBe(false);
    // the body is still the watch's to give up
    watch.cancel();
    expect(asked[0]!.signal.aborted).toBe(true);
  });

  it('fails at once when its only ask fails by itself, and is not asked for again', async () => {
    const asked = slowSite();
    const watch = new Watch();
    const got = ask(A, watch);
    const failed = expect(got).rejects.toThrow('Failed to fetch');
    asked[0]!.fail(new TypeError('Failed to fetch'));
    await failed;
    await vi.advanceTimersByTimeAsync(STALLED_MS * 10);
    expect(asked.length).toBe(1);
    // its download has ended: giving the watch up later marks nothing
    watch.cancel();
    expect(asAgain(A)).toEqual({});
  });

  it('is not failed by one ask failing while another is still out; fails with the last when all have', async () => {
    const asked = slowSite();
    const got = ask(A, new Watch());
    let settled = false;
    got.then(
      () => (settled = true),
      () => (settled = true),
    );
    await vi.advanceTimersByTimeAsync(STALLED_MS);
    asked[1]!.fail(new TypeError('the second failed'));
    await vi.advanceTimersByTimeAsync(10);
    expect(settled).toBe(false);
    asked[0]!.fail(new TypeError('the first failed'));
    await expect(got).rejects.toThrow('the first failed');
  });

  it('fails every ask at once when the watch gives the download up, and the file is fetched fresh the next time', async () => {
    const asked = slowSite();
    const watch = new Watch();
    const got = ask(A, watch);
    const failed = expect(got).rejects.toThrow('aborted');
    await vi.advanceTimersByTimeAsync(STALLED_MS);
    expect(asked.length).toBe(2);
    watch.cancel();
    await failed;
    expect(asked.map((a) => a.signal.aborted)).toEqual([true, true]);
    // nothing more is asked for under a watch given up
    await vi.advanceTimersByTimeAsync(STALLED_MS * 10);
    expect(asked.length).toBe(2);
    void ask(A, new Watch()).catch(() => undefined);
    expect(asked[2]!.cache).toBe('reload');
  });

  it('fails at once under a watch already given up', async () => {
    const asked = slowSite();
    const watch = new Watch();
    watch.cancel();
    await expect(ask(A, watch)).rejects.toThrow('aborted');
    await vi.advanceTimersByTimeAsync(STALLED_MS * 10);
    expect(asked.length).toBe(0); // refused before it went out, as a browser refuses it
  });
});
