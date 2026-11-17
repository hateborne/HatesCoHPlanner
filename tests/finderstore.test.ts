/**
 * The set finder's store: it downloads its statistics once, searches in slices, keeps swaps beside
 * the build, and only changes the build when the player confirms.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { checkFinderStats } from '../src/data/finderStats.ts';
import type { Build } from '../src/engine/build.ts';
import { applySwaps, slotIds } from '../src/engine/finder/pending.ts';
import type * as Search from '../src/engine/finder/search.ts';
import { swapsLegal, type RankedSwap } from '../src/engine/finder/search.ts';
import { BuildRules } from '../src/engine/rules.ts';
import { importMidsText } from '../src/io/mids.ts';
import { decodeShare } from '../src/io/share.ts';
import { swapId, useFinder } from '../src/state/finder.ts';
import { openSetFinder, useFinderOpen } from '../src/state/finderOpen.ts';
import { useStore } from '../src/state/store.ts';
import { loadData, loadMidsMapFile, pid } from './helpers/data.ts';

// a search can be made to fail part-way: the store must say so, never stay "Searching"
const hook = vi.hoisted(() => ({ fail: false }));
vi.mock('../src/engine/finder/search.ts', async (importOriginal) => {
  const real = await importOriginal<typeof Search>();
  return {
    ...real,
    searchSwaps: (input: Parameters<typeof real.searchSwaps>[0]) =>
      hook.fail
        ? (function* (): Generator<number, never> {
            yield 0.5;
            throw new Error('broken on purpose');
          })()
        : real.searchSwaps(input),
  };
});

const gd = loadData();
const statsText = readFileSync(join(process.cwd(), 'public', 'data', 'finder', 'stats.json'), 'utf-8');
vi.setConfig({ testTimeout: 60_000 });

/** @return The Symphony / Dark Dominator forum build. */
async function dominator(): Promise<Build> {
  const text = readFileSync(join(process.cwd(), 'tests', 'fixtures', 'builds', 'symphony-dark-dominator.txt'), 'utf-8');
  return (await importMidsText(gd, loadMidsMapFile(gd.core.manifest.dataVersion), text)).build;
}

/** Wait until something holds (the store works in timers and promises). */
async function until(test: () => boolean): Promise<void> {
  for (let i = 0; i < 3000; i++) {
    if (test()) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error('waited too long');
}

let fetched: string[] = [];
let answer = true;

beforeEach(async () => {
  fetched = [];
  answer = true;
  hook.fail = false;
  vi.stubGlobal('location', { origin: 'https://example.test', pathname: '/', search: '', hash: '' });
  vi.stubGlobal('fetch', async (url: string) => {
    fetched.push(url);
    return { ok: true, status: 200, json: async () => JSON.parse(statsText) as unknown };
  });
  useStore.setState({ gd, build: await dominator(), server: 'homecoming', view: 'overview', askConfirm: async () => answer });
  useFinder.getState().stop();
  useFinder.setState({ stats: null, loading: false, problem: null, query: { goals: [], tags: [], extra: [] }, searched: null, searchedKept: null, result: null, progress: null, kept: [], selected: null, link: null, note: null });
  useFinderOpen.setState({ open: false });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Prepare the finder and run one search for recharge. */
async function searched(): Promise<void> {
  useFinder.getState().prepare();
  await until(() => !!useFinder.getState().stats);
  useFinder.getState().setQuery({ goals: [{ goal: 'recharge', importance: 'high' }], tags: ['pvp', 'purple', 'archetype', 'seasonal'] });
  useFinder.getState().search();
  await until(() => !!useFinder.getState().result);
}

describe('finder store', () => {
  it('downloads the statistics once, from the data folder', async () => {
    useFinder.getState().prepare();
    expect(useFinder.getState().loading).toBe(true);
    await until(() => !!useFinder.getState().stats);
    expect(fetched).toEqual([`${import.meta.env.BASE_URL}data/finder/stats.json`]);
    expect(useFinder.getState()).toMatchObject({ loading: false, problem: null });
    useFinder.getState().prepare();
    expect(fetched).toHaveLength(1);
  });

  it('says so in plain words when it cannot work', async () => {
    vi.stubGlobal('fetch', async () => ({ ok: false, status: 404, json: async () => ({}) }));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    useFinder.getState().prepare();
    await until(() => !useFinder.getState().loading);
    expect(useFinder.getState().problem).toMatch(/couldn't load its build statistics/);
    expect(useFinder.getState().problem).not.toMatch(/404|HTTP/);
    warn.mockRestore();
    // another server's build: told so without a download
    fetched = [];
    useFinder.setState({ problem: null });
    useStore.setState({ gd: loadData(undefined, 'thunderspy'), server: 'thunderspy' });
    useFinder.getState().prepare();
    expect(useFinder.getState().problem).toMatch(/Homecoming builds only/);
    expect(fetched).toEqual([]);
  });

  it('reads only a statistics file of the shape it knows', () => {
    expect(checkFinderStats(JSON.parse(statsText))).not.toBeNull();
    expect(checkFinderStats(null)).toBeNull();
    expect(checkFinderStats({ v: 2, dataVersion: 'i28p4', minGroup: 25, groups: { all: { n: 1, stats: {} } }, needs: {} })).toBeNull();
    expect(checkFinderStats({ v: 1, dataVersion: 'i28p4', minGroup: 25, groups: {}, needs: {} })).toBeNull();
    expect(checkFinderStats('<html>')).toBeNull();
  });

  it('searches in slices and reports its progress', async () => {
    useFinder.getState().prepare();
    await until(() => !!useFinder.getState().stats);
    useFinder.getState().setQuery({ goals: [{ goal: 'defense', importance: 'critical' }] });
    const seen: number[] = [];
    const stop = useFinder.subscribe((s) => {
      if (s.progress !== null) seen.push(s.progress);
    });
    useFinder.getState().search();
    expect(useFinder.getState().result).toBeNull(); // nothing blocks: the first slice runs on a timer
    await until(() => !!useFinder.getState().result);
    stop();
    expect(seen[0]).toBe(0); // it says it has started before any work is done
    expect(seen).toEqual([...seen].sort((a, b) => a - b));
    expect(useFinder.getState().progress).toBeNull();
    expect(useFinder.getState().result!.swaps.length).toBeGreaterThan(0);
  });

  it('marks its list out of date when the form changes, and leaves it so when a search is given up', async () => {
    await searched();
    expect(useFinder.getState().searched).toBe(useFinder.getState().query);
    expect(useFinder.getState().searchedKept).toBe(useFinder.getState().kept);
    useFinder.getState().setQuery({ attuned: true });
    expect(useFinder.getState().searched).not.toBe(useFinder.getState().query);
    const before = useFinder.getState().result;
    // the slices run on timers: every one of them is run here, so "it stopped" is not a matter of waiting long enough
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      useFinder.getState().search();
      useFinder.getState().stop(); // the pane closed
      expect(useFinder.getState().progress).toBeNull();
      vi.runAllTimers();
      // the old list stays, still marked as made with another search
      expect(useFinder.getState().result).toBe(before);
      expect(useFinder.getState().searched).not.toBe(useFinder.getState().query);
      // the same timers do finish a search nobody stops
      useFinder.getState().search();
      vi.runAllTimers();
      expect(useFinder.getState().result).not.toBe(before);
      expect(useFinder.getState().progress).toBeNull();
      expect(useFinder.getState().searched).toBe(useFinder.getState().query);
    } finally {
      vi.useRealTimers();
    }
  });

  it('ranks again for the search its list was made with, whatever the form holds by then', async () => {
    await searched();
    const made = useFinder.getState().searched;
    const first = useFinder.getState().result!.swaps[0]!;
    // a form that can't be searched: keeping and letting go still rank, and the lists stay
    useFinder.getState().setQuery({ goals: [] });
    useFinder.getState().keep(first);
    await until(() => useFinder.getState().progress === null);
    expect(useFinder.getState().result!.problem).toBeUndefined();
    expect(useFinder.getState().result!.swaps.length).toBeGreaterThan(0);
    expect(useFinder.getState().kept).toEqual([first]);
    expect(useFinder.getState().searched).toBe(made);
    expect(useFinder.getState().searched).not.toBe(useFinder.getState().query);
    expect(useFinder.getState().searchedKept).toBe(useFinder.getState().kept);
    useFinder.getState().drop(first.key);
    await until(() => useFinder.getState().progress === null);
    expect(useFinder.getState().result!.problem).toBeUndefined();
    expect(useFinder.getState().result!.swaps.some((s) => swapId(s) === swapId(first))).toBe(true);
    // a ranking given up (the pane closed) leaves the list marked: it was not made with these kept swaps
    useFinder.getState().keep(first);
    useFinder.getState().stop();
    expect(useFinder.getState().kept).toEqual([first]);
    expect(useFinder.getState().searchedKept).not.toBe(useFinder.getState().kept);
    // letting a swap go while a search runs ranks for that search, not for the one before it
    useFinder.getState().setQuery({ goals: [{ goal: 'recharge', importance: 'high' }], attuned: true });
    const asked = useFinder.getState().query;
    useFinder.getState().search();
    useFinder.getState().drop(first.key);
    await until(() => useFinder.getState().progress === null);
    expect(useFinder.getState().searched).toBe(asked);
    expect(useFinder.getState().searchedKept).toBe(useFinder.getState().kept);
  });

  it('says so when a search fails, and searches again after', async () => {
    await searched();
    const before = useFinder.getState().result;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    hook.fail = true;
    try {
      useFinder.getState().search();
      await until(() => useFinder.getState().progress === null);
      expect(useFinder.getState().note).toMatch(/couldn't finish/);
      expect(useFinder.getState().note).not.toMatch(/broken on purpose/);
      expect(useFinder.getState().result).toBe(before);
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
    hook.fail = false;
    useFinder.getState().search();
    await until(() => useFinder.getState().progress === null);
    expect(useFinder.getState().note).toBeNull();
    expect(useFinder.getState().result).not.toBe(before);
  });

  it('keeps nothing from a list that is being ranked again, nor a swap that clashes with a kept one', async () => {
    await searched();
    const first = useFinder.getState().result!.swaps[0]!;
    useFinder.getState().search();
    useFinder.getState().keep(first); // the list on screen is on its way out
    expect(useFinder.getState().kept).toEqual([]);
    await until(() => useFinder.getState().progress === null);
    useFinder.getState().keep(first);
    await until(() => useFinder.getState().progress === null);
    expect(useFinder.getState()).toMatchObject({ kept: [first], selected: null, note: null });
    useFinder.getState().drop(first.key);
    await until(() => useFinder.getState().progress === null);
    // every piece of a winter set is unique: each of two attacks could take this one, the build only one
    const build = useStore.getState().build!;
    const rules = new BuildRules(gd, build);
    const bite = gd.boostSets.find((s) => s.n === 'Winters_Bite')!.id;
    const piece = pid(gd, 'Boosts.Attuned_Winters_Bite_A.Attuned_Winters_Bite_A');
    const into = (name: string): RankedSwap => {
      const e = rules.entries().find((x) => x.power.n === name)!;
      return { key: e.key, power: e.power.id, freeLevel: e.level, set: bite, count: 1, pieces: [{ slot: 0, enh: { boost: piece } }], before: slotIds(e.slots), score: 0, lines: [], warnings: [], displaced: [] };
    };
    const a = into('Dominator_Control.Symphony_Control.Hymn_of_Dissonance');
    const b = into('Dominator_Assault.Dark_Assault.Dark_Blast');
    expect(swapsLegal(gd, build, [a], rules)).toBe(true);
    expect(swapsLegal(gd, build, [b], rules)).toBe(true);
    expect(swapsLegal(gd, build, [a, b], rules)).toBe(false);
    useFinder.getState().keep(a);
    await until(() => useFinder.getState().progress === null);
    expect(useFinder.getState().kept).toEqual([a]);
    useFinder.getState().keep(b);
    expect(useFinder.getState().kept).toEqual([a]);
    expect(useFinder.getState().note).toMatch(/no longer fits/);
    // the next step that works clears the note
    useFinder.getState().drop(a.key);
    expect(useFinder.getState()).toMatchObject({ kept: [], note: null });
  });

  it('keeps swaps beside the build, ranks again, and writes the new-build link', async () => {
    await searched();
    const build = useStore.getState().build!;
    const first = useFinder.getState().result!.swaps[0]!;
    useFinder.getState().select(swapId(first));
    useFinder.getState().keep(first);
    expect(useFinder.getState().kept).toEqual([first]);
    expect(useFinder.getState().selected).toBeNull(); // the pane goes back to the kept swaps together
    expect(useStore.getState().build).toBe(build); // nothing applied
    await until(() => !!useFinder.getState().link && useFinder.getState().progress === null);
    // the kept swap is not offered again
    expect(useFinder.getState().result!.swaps.some((s) => swapId(s) === swapId(first))).toBe(false);
    // the link is a normal share link to the build with the swap in, under the site's own address
    const link = useFinder.getState().link!;
    expect(link.startsWith(`https://example.test${import.meta.env.BASE_URL}`)).toBe(true);
    const opened = await decodeShare(link.split('#b=')[1]!);
    const entry = new BuildRules(gd, opened).entries().find((e) => e.key === first.key)!;
    for (const p of first.pieces) expect(entry.slots[p.slot]!.enh?.boost).toBe(p.enh.boost);
    expect(opened.name).toBe(build.name);
    // letting it go empties the list and the link
    useFinder.getState().drop(first.key);
    expect(useFinder.getState()).toMatchObject({ kept: [], link: null });
  });

  it('changes the build only when the player confirms, then starts afresh', async () => {
    await searched();
    const build = useStore.getState().build!;
    const first = useFinder.getState().result!.swaps[0]!;
    useFinder.getState().keep(first);
    await until(() => useFinder.getState().progress === null);
    openSetFinder();
    // kept swaps that change while the question is up are not the ones it named: nothing is applied, and the pane says so
    useStore.setState({
      askConfirm: async () => {
        useFinder.setState({ kept: [...useFinder.getState().kept] });
        return true;
      },
    });
    await useFinder.getState().apply();
    expect(useStore.getState().build).toBe(build);
    expect(useFinderOpen.getState().open).toBe(true);
    expect(useFinder.getState().note).toMatch(/nothing was applied/);
    useStore.setState({ askConfirm: async () => answer });
    answer = false;
    await useFinder.getState().apply();
    expect(useStore.getState().build).toBe(build);
    expect(useFinderOpen.getState().open).toBe(true);
    answer = true;
    await useFinder.getState().apply();
    expect(useStore.getState().build).toEqual(applySwaps(build, [first]));
    expect(useFinderOpen.getState().open).toBe(false);
    // the kept swaps and results belonged to the build as it was
    expect(useFinder.getState()).toMatchObject({ kept: [], result: null, link: null, selected: null });
  });

  it('forgets its swaps and results when the build changes under it, but not the form', async () => {
    await searched();
    const query = useFinder.getState().query;
    useFinder.getState().keep(useFinder.getState().result!.swaps[0]!);
    useStore.getState().setBuild({ ...useStore.getState().build!, name: 'Edited' });
    expect(useFinder.getState()).toMatchObject({ kept: [], result: null, searched: null, progress: null, note: null });
    expect(useFinder.getState().query).toBe(query);
  });
});
