/**
 * What a page load does when something it needs fails: a remembered build or link whose server's
 * files won't download leaves the other servers a click away, a stored build the check can't read
 * no longer holds every later load on the error screen, the error screen speaks in plain words, and
 * a load started again (Try again on a slow load) is the only one that shows what it loaded.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { newBuild, toAlignment, type Build } from '../src/engine/build.ts';
import { checkBuild } from '../src/engine/validate.ts';
import { loadData, pid, sid } from './helpers/data.ts';
import { visit } from './helpers/visit.ts';

const gd = loadData();
const ts = loadData(undefined, 'thunderspy');

/** @return A Homecoming build with one power picked. */
function homecoming(name: string): Build {
  const b = newBuild({
    dataVersion: gd.core.manifest.dataVersion,
    name,
    at: gd.archetypeByName.get('class_blaster')!.id,
    origin: gd.core.origins[0]!.id,
    alignment: 'Hero',
    primary: sid(gd, 'Blaster_Ranged.Fire_Blast'),
    secondary: sid(gd, 'Blaster_Support.Fire_Manipulation'),
    pickCount: gd.core.schedule.power.length,
  });
  b.picks[0] = { power: pid(gd, 'Blaster_Ranged.Fire_Blast.Flares'), level: 0, slots: [{ level: 0 }] };
  return b;
}

/** @return A Thunderspy build with one power picked. */
function thunderspy(name: string): Build {
  const b = newBuild({
    dataVersion: ts.core.manifest.dataVersion,
    name,
    at: ts.archetypeByName.get('class_blaster')!.id,
    origin: ts.core.origins[0]!.id,
    alignment: 'Hero',
    primary: sid(ts, 'Blaster_Ranged.Fire_Blast'),
    secondary: sid(ts, 'Blaster_Support.Fire_Manipulation'),
    pickCount: ts.core.schedule.power.length,
  });
  b.picks[0] = { power: pid(ts, 'Blaster_Ranged.Fire_Blast.Flares'), level: 0, slots: [{ level: 0 }] };
  return { ...b, server: 'thunderspy' };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.doUnmock('../src/engine/validate.ts');
  vi.resetModules();
  vi.restoreAllMocks();
});

describe("a build whose server's files won't download", () => {
  it("leaves the other servers a click away when the remembered build's version list fails", async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const b = thunderspy('Spy Guy');
    const { useStore, local, done } = await visit({ build: b, failing: /^data\/thunderspy\/versions\.json$/ });
    // not the error screen: the server list, as when that version's data fails
    expect(useStore.getState().view).toBe('loading');
    expect(useStore.getState().serverAsk).not.toBeNull();
    useStore.getState().closeServerAsk('homecoming');
    await done;
    const s = useStore.getState();
    expect([s.view, s.server, s.build]).toEqual(['setup', 'homecoming', undefined]);
    expect(JSON.parse(local.m.get('hcp.current')!)).toEqual(b); // still remembered
  });

  it("shows the error screen in plain words when the address's own server won't load", async () => {
    const said = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { useStore, done } = await visit({ path: `${import.meta.env.BASE_URL}Thunderspy/`, failing: /^data\/thunderspy\/versions\.json$/ });
    await done;
    const { LOAD_FAILED } = await import('../src/state/store.ts');
    expect(useStore.getState().view).toBe('error');
    expect(useStore.getState().error).toBe(LOAD_FAILED);
    expect(useStore.getState().error).not.toMatch(/fetch|HTTP|undefined|function/i);
    expect(said).toHaveBeenCalled(); // the details are in the console
  });
});

describe('a stored build the check cannot read', () => {
  it('takes any value in a text field as it takes a missing one', () => {
    for (const bad of [5, {}, [], true, null, undefined]) expect(toAlignment(bad)).toBe('Hero');
    const b = { ...homecoming('Odd'), alignment: 5 } as unknown as Build;
    expect(checkBuild(gd, b).build?.alignment).toBe('Hero');
  });

  it('opens New Build and says so, instead of failing every load from then on', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const b = homecoming('Cursed');
    const { useStore, local, done } = await visit({
      build: b,
      // the check failing outright, whatever the cause: it is meant to refuse, never to throw
      before: () =>
        vi.doMock('../src/engine/validate.ts', () => ({
          checkBuild: () => {
            throw new TypeError('boom');
          },
        })),
    });
    // with no build to open, the site root asks which server, as on a first visit
    expect(useStore.getState().serverAsk).not.toBeNull();
    useStore.getState().closeServerAsk('homecoming');
    await done;
    const s = useStore.getState();
    expect([s.view, s.server, s.build]).toEqual(['setup', 'homecoming', undefined]);
    expect(s.confirm?.title).toBe("Couldn't open your last build");
    expect(s.confirm?.text).not.toContain('boom');
    expect(JSON.parse(local.m.get('hcp.current')!)).toEqual(b); // the planner removes nothing on its own
  });
});

describe('a share link pasted into the address while the page still loads', () => {
  it('is read once the load is done, as a link pasted into an open planner', async () => {
    let release = (): void => undefined;
    const held = new Promise<void>((r) => (release = r));
    // the remembered build's game data is still downloading
    const page = await visit({ build: homecoming('Mine'), gate: (rel) => (rel.endsWith('powers.json') ? held : undefined), settle: false });
    const { useStore, fetched } = page;
    await vi.waitFor(() => expect(fetched.some((f) => f.endsWith('powers.json'))).toBe(true));
    expect(useStore.getState().view).toBe('loading');
    const theirs = homecoming('Theirs');
    theirs.picks[1] = { power: pid(gd, 'Blaster_Support.Fire_Manipulation.Ring_of_Fire'), level: 0, slots: [{ level: 0 }] };
    const { encodeShare } = await import('../src/io/share.ts');
    const { readPastedLink } = await import('../src/state/store.ts');
    (location as { hash: string }).hash = `#b=${await encodeShare(theirs)}`;
    readPastedLink(); // the hashchange event
    expect(useStore.getState().view).toBe('loading'); // nothing to open it on yet
    release();
    await page.done;
    expect(useStore.getState().build?.name).toBe('Mine'); // the load opened what it had read
    // and then the pasted link is read: it asks before replacing a build with work
    await vi.waitFor(() => expect(useStore.getState().confirm?.title).toBe('Replace the current build?'), { timeout: 4000 });
    expect(useStore.getState().confirm?.text).toContain('"Theirs"');
  });
});

describe('a build the player asked to continue', () => {
  it("stops on the error screen when its server's version list fails, so Try again continues it", async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { RETURN_AFTER } = await import('../src/state/lastUsed.ts');
    const page = await visit({ build: thunderspy('Spy Guy'), lastUsed: Date.now() - RETURN_AFTER - 60_000, failing: /^data\/thunderspy\/versions\.json$/ });
    const { useStore, CONTINUE_BUILD, done } = page;
    expect(useStore.getState().serverAsk?.resume).toBeDefined(); // the return question
    useStore.getState().closeServerAsk(CONTINUE_BUILD);
    await done;
    // no "couldn't be opened" dialog over an error screen: just the error screen, as before
    expect([useStore.getState().view, useStore.getState().confirm]).toEqual(['error', null]);
  });
});

describe('two quick picks of a game version on New Build', () => {
  it('ends on the one picked last, however slowly the first one loads', async () => {
    let release = (): void => undefined;
    const held = new Promise<void>((r) => (release = r));
    const page = await visit({ path: `${import.meta.env.BASE_URL}Homecoming/`, gate: (rel) => (rel.startsWith('data/i28p3/') ? held : undefined) });
    await page.done;
    const { useStore } = page;
    const shown = () => useStore.getState().gd?.core.manifest.dataVersion;
    expect([useStore.getState().view, shown()]).toEqual(['setup', 'i28p4']);
    const older = useStore.getState().selectVersion('i28p3'); // still downloading...
    const back = useStore.getState().selectVersion('i28p4'); // ...when the first is picked again
    expect(await back).toBe(true);
    release();
    expect(await older).toBe(false);
    expect(shown()).toBe('i28p4');
    // and with nothing else picked since, a version does load
    expect(await useStore.getState().selectVersion('i28p3')).toBe(true);
    expect(shown()).toBe('i28p3');
  });
});

describe('a download that stalls', () => {
  const POWERS = /[/]powers[.]json$/;
  const FOUR = /[/](core|powersets|powers|boosts)[.]json$/;
  type Page = Awaited<ReturnType<typeof visit>>;

  /**
   * Run something as if the page's downloads had last received anything `quietFor` ms ago.
   *
   * @param quietFor How long ago.
   * @param act What to run.
   * @return What it returns.
   */
  function after<T>(quietFor: number, act: () => T): T {
    const clock = vi.spyOn(performance, 'now').mockReturnValue(performance.now() + quietFor);
    try {
      return act();
    } finally {
      clock.mockRestore();
    }
  }
  /** Press Try again as if the page's downloads had last received anything `quietFor` ms ago. */
  const tryAgain = (page: Page, quietFor: number): void => after(quietFor, () => page.useStore.getState().retryLoad());

  /**
   * An answer whose body arrives half at once and the rest when it is let through, and which
   * fails, as a browser's does, when its download is given up.
   *
   * @param text The file's text.
   * @param signal The download's signal.
   * @return The answer, and what lets the rest through.
   */
  function inTwoHalves(text: string, signal: AbortSignal | undefined): { answer: Response; rest: () => void } {
    const bytes = new TextEncoder().encode(text);
    const half = bytes.length >> 1;
    let rest = (): void => undefined;
    const body = new ReadableStream<Uint8Array>({
      start(to) {
        to.enqueue(bytes.subarray(0, half));
        rest = () => {
          to.enqueue(bytes.subarray(half));
          to.close();
        };
        signal?.addEventListener('abort', () => to.error(new DOMException('The operation was aborted.', 'AbortError')));
      },
    });
    return { answer: new Response(body), rest: () => rest() };
  }

  /**
   * What makes the first download of a file arrive half and then stall (later ones arrive whole).
   *
   * @param file Which file.
   * @return The answer hook for `visit`, and what lets the rest of that first download through.
   */
  function stallingHalfWay(file: RegExp) {
    let rest = (): void => undefined;
    let first = true;
    const answer = (rel: string, text: string, signal: AbortSignal | undefined): Response | undefined => {
      if (!file.test(rel) || !first) return undefined;
      first = false;
      const two = inTwoHalves(text, signal);
      rest = two.rest;
      return two.answer;
    };
    return { answer, rest: () => rest() };
  }

  /** @return A page whose first download of powers.json has arrived half and stalled, and what lets the rest through. */
  async function halfWay() {
    const stall = stallingHalfWay(POWERS);
    const page = await visit({ build: homecoming('Fire Guy'), answer: stall.answer, settle: false });
    await vi.waitFor(() => expect(page.fetched.filter((f) => FOUR.test(f)).length).toBe(4));
    await new Promise((r) => setTimeout(r, 30)); // the three whole files, and the half, arrive
    return { page, rest: stall.rest };
  }

  /** @return Where in `fetched` a file was asked for. */
  const asks = (fetched: string[], file = POWERS): number[] => fetched.flatMap((f, i) => (file.test(f) ? [i] : []));

  describe('and Try again', () => {
    it('gives up downloads gone quiet and fetches them afresh, past the browser cache; only the newest load shows what it loaded', async () => {
      let release = (): void => undefined;
      const held = new Promise<void>((r) => (release = r));
      const state = { hold: true };
      // the page's first downloads never answer
      const page = await visit({ build: homecoming('Fire Guy'), gate: () => (state.hold ? held : undefined), settle: false });
      const { useStore, fetched } = page;
      await vi.waitFor(() => expect(fetched.length).toBeGreaterThan(0));
      expect(useStore.getState().view).toBe('loading');
      const first = fetched.length;
      // each is cancelled (while a download of an address is under way, a browser gives a new
      // request for that address the same download) and fetched anew
      state.hold = false;
      tryAgain(page, page.STALLED_MS);
      expect(page.signals.slice(0, first).map((s) => s?.aborted)).toEqual(Array.from({ length: first }, () => true));
      await vi.waitFor(() => expect(useStore.getState().view).toBe('overview'));
      expect(fetched.length).toBeGreaterThan(first);
      for (let i = 0; i < first; i++) expect(page.caches[fetched.indexOf(fetched[i]!, first)], fetched[i]).toBe('reload');
      expect(useStore.getState().build?.name).toBe('Fire Guy');
      // the first load ends late: it shows nothing over what is on screen now
      useStore.setState({ view: 'setup', build: undefined });
      release();
      await page.done;
      await new Promise((r) => setTimeout(r, 20));
      expect([useStore.getState().view, useStore.getState().build]).toEqual(['setup', undefined]);
    });

    it('keeps a download with no answer yet that has not gone quiet: its place in line is not thrown away', async () => {
      let release = (): void => undefined;
      const held = new Promise<void>((r) => (release = r));
      // one file has no answer yet; the others have arrived
      const page = await visit({ build: homecoming('Fire Guy'), gate: (rel) => (POWERS.test(rel) ? held : undefined), settle: false });
      const { useStore, fetched, signals } = page;
      await vi.waitFor(() => expect(fetched.filter((f) => FOUR.test(f)).length).toBe(4));
      await new Promise((r) => setTimeout(r, 30));
      tryAgain(page, page.STALLED_MS - 1000);
      await new Promise((r) => setTimeout(r, 30));
      expect(asks(fetched).length).toBe(1);
      expect(signals.some((s) => s?.aborted)).toBe(false);
      release();
      await vi.waitFor(() => expect(useStore.getState().view).toBe('overview'));
      expect(asks(fetched).length).toBe(1);
    });

    it('keeps a download still coming in: neither cancelled nor asked for again, and it opens the page', async () => {
      const { page, rest } = await halfWay();
      const { useStore, fetched, signals } = page;
      expect(useStore.getState().view).toBe('loading');
      const before = [...fetched];
      // pressed a moment short of the limit since the download last received something
      tryAgain(page, page.STALLED_MS - 1000);
      await new Promise((r) => setTimeout(r, 30));
      // what had arrived is asked for again, as Try again always did (here the version list); the
      // download still coming in is not
      expect(fetched.slice(before.length).filter((f) => !f.endsWith('versions.json'))).toEqual([]);
      expect(signals.some((s) => s?.aborted)).toBe(false);
      expect(useStore.getState().view).toBe('loading');
      rest();
      await vi.waitFor(() => expect(useStore.getState().view).toBe('overview'));
      expect(useStore.getState().build?.name).toBe('Fire Guy');
      expect(asks(fetched).length).toBe(1);
    });

    it('gives up a download gone quiet part way, and only its unfinished file goes past the browser cache', async () => {
      const { page } = await halfWay();
      const { useStore, fetched } = page;
      const before = fetched.length;
      tryAgain(page, page.STALLED_MS);
      await vi.waitFor(() => expect(useStore.getState().view).toBe('overview'));
      expect(page.signals[asks(fetched)[0]!]?.aborted).toBe(true);
      // everything is asked for again. The browser still has what had arrived, so only the file
      // given up, which goes past its cache, costs a download.
      const again = fetched
        .map((f, i) => [f.split('/').slice(-1)[0]!, page.caches[i]] as const)
        .slice(before)
        .filter(([f]) => /^(versions|core|powersets|powers|boosts)[.]json$/.test(f));
      expect(Object.fromEntries(again)).toEqual({
        'versions.json': 'no-cache',
        'core.json': undefined,
        'powersets.json': undefined,
        'powers.json': 'reload',
        'boosts.json': undefined,
      });
    });
  });

  describe('with no press', () => {
    it('is asked for again alongside while it has no answer, twice at most, and nothing is cancelled; the first answer opens the page', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
      try {
        let release = (): void => undefined;
        const held = new Promise<void>((r) => (release = r));
        // one file gets no answer; the others arrive
        const page = await visit({ build: homecoming('Fire Guy'), gate: (rel) => (POWERS.test(rel) ? held : undefined), settle: false });
        const { useStore, fetched, signals, caches } = page;
        await vi.waitFor(() => expect(asks(fetched).length).toBe(1));
        await vi.waitFor(() => expect(fetched.filter((f) => FOUR.test(f)).length).toBe(4));
        // a moment short of the limit: it is not asked for again
        await vi.advanceTimersByTimeAsync(page.STALLED_MS - 1500);
        expect(asks(fetched).length).toBe(1);
        // nothing has arrived for the limit: asked for again, past the browser's cache
        await vi.advanceTimersByTimeAsync(1500);
        await vi.waitFor(() => expect(asks(fetched).length).toBe(2));
        // and once more
        await vi.advanceTimersByTimeAsync(page.STALLED_MS);
        await vi.waitFor(() => expect(asks(fetched).length).toBe(3));
        expect(page.EXTRA_ASKS).toBe(2);
        // after that it is left as it is, however long the silence
        await vi.advanceTimersByTimeAsync(page.STALLED_MS * 6);
        expect(asks(fetched).map((i) => caches[i])).toEqual([undefined, 'reload', 'reload']);
        // nothing was cancelled, and none of it showed: the load is still the first one, waiting
        expect(signals.some((s) => s?.aborted)).toBe(false);
        expect(useStore.getState().view).toBe('loading');
        expect(fetched.filter((f) => f.endsWith('versions.json')).length).toBe(1);
        // an answer comes: the page opens on it, and the other asks are let go of
        release();
        await vi.waitFor(() => expect(useStore.getState().view).toBe('overview'));
        expect(useStore.getState().build?.name).toBe('Fire Guy');
        expect(asks(fetched).filter((i) => signals[i]?.aborted).length).toBe(2);
      } finally {
        vi.useRealTimers();
      }
    });

    it('in a blackout every file is asked for again at the same pace, and the first Try again gives them all up', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
      try {
        let release = (): void => undefined;
        const held = new Promise<void>((r) => (release = r));
        const state = { hold: true };
        // the version list arrives; then none of the four files gets an answer
        const page = await visit({ build: homecoming('Fire Guy'), gate: (rel) => (state.hold && FOUR.test(rel) ? held : undefined), settle: false });
        const { useStore, fetched, signals, caches } = page;
        const four = (): number[] => fetched.flatMap((f, i) => (FOUR.test(f) ? [i] : []));
        await vi.waitFor(() => expect(four().length).toBe(4));
        // each is asked for a second time after the limit, and a third after another: no file
        // waits behind another's extra asks
        await vi.advanceTimersByTimeAsync(page.STALLED_MS);
        await vi.waitFor(() => expect(four().length).toBe(8));
        await vi.advanceTimersByTimeAsync(page.STALLED_MS);
        await vi.waitFor(() => expect(four().length).toBe(12));
        expect(signals.some((s) => s?.aborted)).toBe(false);
        // 10 seconds in, Try again is on screen: the press gives all of it up, the extra asks
        // included (they are no sign of life), and fetches the four afresh
        state.hold = false;
        useStore.getState().retryLoad();
        expect(four().map((i) => signals[i]?.aborted)).toEqual(Array.from({ length: 12 }, () => true));
        await vi.waitFor(() => expect(useStore.getState().view).toBe('overview'));
        expect(four().slice(12).map((i) => caches[i])).toEqual(['reload', 'reload', 'reload', 'reload']);
        release();
      } finally {
        vi.useRealTimers();
      }
    });

    it('is left alone when it stalls part way (a connection that only paused picks it up again)', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
      try {
        const stall = stallingHalfWay(POWERS);
        const page = await visit({ build: homecoming('Fire Guy'), answer: stall.answer, settle: false });
        const { useStore, fetched, signals } = page;
        await vi.waitFor(() => expect(asks(fetched).length).toBe(1));
        // half of it is here, and then nothing for a long while: it is neither given up nor asked for again
        await vi.advanceTimersByTimeAsync(page.STALLED_MS * 8);
        expect(asks(fetched).length).toBe(1);
        expect(signals.some((s) => s?.aborted)).toBe(false);
        expect(useStore.getState().view).toBe('loading');
        // the connection picks up again: the rest arrives, and nothing was thrown away
        stall.rest();
        await vi.waitFor(() => expect(useStore.getState().view).toBe('overview'));
        expect(asks(fetched).length).toBe(1);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('on New Build, which has no Try again', () => {
    const OLDER = /^data[/]i28p3[/]powers[.]json$/;

    /** @return A page on New Build whose pick of the older version stalls half way through one file. */
    async function pickingOlder() {
      const stall = stallingHalfWay(OLDER);
      const page = await visit({ path: `${import.meta.env.BASE_URL}Homecoming/`, answer: stall.answer });
      await page.done;
      const shown = (): string | undefined => page.useStore.getState().gd?.core.manifest.dataVersion;
      expect([page.useStore.getState().view, shown()]).toEqual(['setup', 'i28p4']);
      const first = page.useStore.getState().selectVersion('i28p3');
      await vi.waitFor(() => expect(asks(page.fetched, OLDER).length).toBe(1));
      await new Promise((r) => setTimeout(r, 30)); // half of the file arrives, then nothing
      return { page, shown, first, rest: stall.rest };
    }

    it('picking the version again gives its download up once it has gone quiet, as Try again would', async () => {
      const { page, shown, first } = await pickingOlder();
      const { fetched, signals, caches } = page;
      const again = after(page.STALLED_MS, () => page.useStore.getState().selectVersion('i28p3'));
      expect(await again).toBe(true);
      expect(shown()).toBe('i28p3');
      expect(asks(fetched, OLDER).map((i) => [signals[i]?.aborted, caches[i]])).toEqual([
        [true, undefined],
        [false, 'reload'],
      ]);
      // the first pick was replaced: it says nothing
      expect(await first).toBe(false);
      expect(page.useStore.getState().notice ?? null).toBeNull();
    });

    it('picking it again while it is still coming in waits for the same download', async () => {
      const { page, shown, first, rest } = await pickingOlder();
      const { fetched, signals } = page;
      const again = after(page.STALLED_MS - 1000, () => page.useStore.getState().selectVersion('i28p3'));
      await new Promise((r) => setTimeout(r, 30));
      expect(asks(fetched, OLDER).length).toBe(1);
      expect(signals.some((s) => s?.aborted)).toBe(false);
      rest();
      expect(await again).toBe(true);
      expect(shown()).toBe('i28p3');
      expect(await first).toBe(false);
    });
  });
});
