/**
 * The set finder's store: it downloads its statistics once, searches in slices, keeps swaps beside
 * the build, and only changes the build when the player confirms. Its shopping list shows the kept
 * swaps' pieces and keeps them in the browser once the swaps are applied.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { checkFinderStats } from '../src/data/finderStats.ts';
import type { Build } from '../src/engine/build.ts';
import { applySwaps, slotIds } from '../src/engine/finder/pending.ts';
import type * as Search from '../src/engine/finder/search.ts';
import { findSwaps, swapsLegal, type RankedSwap } from '../src/engine/finder/search.ts';
import { swapItems } from '../src/engine/finder/shopping.ts';
import { BuildRules } from '../src/engine/rules.ts';
import { importMidsText } from '../src/io/mids.ts';
import { decodeShare } from '../src/io/share.ts';
import { readShopping, SHOPPING_KEY, writeShopping } from '../src/io/shopping.ts';
import { checkRecipes } from '../src/data/recipes.ts';
import { GIVE_UP_MS, RECIPES_WAIT_MS, shopItems, shoppingChangedElsewhere, swapId, useFinder } from '../src/state/finder.ts';
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
const recipesText = readFileSync(join(process.cwd(), 'public', 'data', 'recipes', `${gd.core.manifest.dataVersion}.json`), 'utf-8');
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
// what the browser keeps (the shopping list), and whether the recipe file is there
let stored = new Map<string, string>();
let noRecipes = false;
// what the planner told the player outside the finder's pane (notify)
let told: string[] = [];

beforeEach(async () => {
  fetched = [];
  answer = true;
  hook.fail = false;
  stored = new Map();
  noRecipes = false;
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => stored.get(k) ?? null,
    setItem: (k: string, v: string) => void stored.set(k, v),
    removeItem: (k: string) => void stored.delete(k),
  });
  vi.stubGlobal('location', { origin: 'https://example.test', pathname: '/', search: '', hash: '' });
  vi.stubGlobal('fetch', async (url: string) => {
    fetched.push(url);
    if (url.includes('/recipes/')) return noRecipes ? { ok: false, status: 404, json: async () => null } : { ok: true, status: 200, json: async () => JSON.parse(recipesText) as unknown };
    return { ok: true, status: 200, json: async () => JSON.parse(statsText) as unknown };
  });
  told = [];
  useStore.setState({ gd, build: await dominator(), server: 'homecoming', view: 'overview', askConfirm: async () => answer, notify: (text: string) => void told.push(text) });
  useFinder.getState().stop();
  useFinder.setState({ stats: null, loading: false, problem: null, query: { goals: [], tags: [], extra: [] }, searched: null, searchedKept: null, result: null, progress: null, kept: [], selected: null, link: null, note: null });
  useFinder.setState({ recipes: null, recipesFor: null, recipesLoading: false, recipesMissing: false, recipesFailed: null, unsavedFor: null, shop: [], shopFor: null, shopOwned: {}, settled: [] });
  useFinderOpen.setState({ open: false });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * A request that gets no answer, as a stalled download's does: it fails only when it is given up
 * (its signal), like a browser's own.
 *
 * @param init The fetch settings it was made with.
 * @param given Called when the request is given up.
 * @return A promise that never fulfils, and rejects once the request is given up.
 */
function noAnswer(init: RequestInit | undefined, given: () => void): Promise<never> {
  return new Promise<never>((_, reject) => {
    init?.signal?.addEventListener('abort', () => {
      given();
      reject(new DOMException('given up', 'AbortError'));
    });
  });
}

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
    // every part a search reads is checked, not the top of the file alone
    const good = (): Record<string, unknown> => ({
      v: 1,
      dataVersion: 'i28p4',
      builds: 3,
      minGroup: 25,
      groups: { all: { n: 3, stats: { rech: { share: 0.2, lift: 1.1, unit: 0.05, total: 0.7, bonus: 0.4 } } } },
      needs: { Class_Blaster: { 'mezprot.Knock': { share: 0.9, typical: 4 } } },
      sets: { Luck_of_the_Gambler: { builds: 0.8, pieces: [1, 2, 3, 0, 0], at: { Class_Blaster: 0.7 } } },
      pieces: { Crafted_Luck_of_the_Gambler_F: 0.8 },
    });
    expect(checkFinderStats(good())).not.toBeNull();
    const broken: [string, (s: Record<string, unknown>) => void][] = [
      ['a group that is not one', (s) => (s.groups = { all: 'x' })],
      ['a stat that is not one', (s) => (s.groups = { all: { n: 3, stats: { rech: null } } })],
      ['a unit under zero', (s) => (s.groups = { all: { n: 3, stats: { rech: { share: 0.2, lift: 1.1, unit: -0.05, total: 0.7, bonus: 0.4 } } } })],
      ['a number that is no number', (s) => (s.groups = { all: { n: 3, stats: { rech: { share: 0.2, lift: 'big', unit: 0.05, total: 0.7, bonus: 0.4 } } } })],
      ['a need that is not one', (s) => (s.needs = { Class_Blaster: { 'mezprot.Knock': 4 } })],
      ['a typical amount under zero', (s) => (s.needs = { Class_Blaster: { 'mezprot.Knock': { share: 0.9, typical: -4 } } })],
      ['needs that are a list', (s) => (s.needs = [])],
      ['sets that are missing', (s) => delete s.sets],
      ['a set with no counts', (s) => (s.sets = { Luck_of_the_Gambler: { builds: 0.8, at: {} } })],
      ['pieces that are not numbers', (s) => (s.pieces = { Crafted_Luck_of_the_Gambler_F: 'often' })],
    ];
    for (const [what, spoil] of broken) {
      const s = good();
      spoil(s);
      expect(checkFinderStats(s), what).toBeNull();
    }
  });

  it('gives a statistics download that stalled up when the pane opens again, and asks afresh', async () => {
    // the first ask never gets an answer; the next one does
    let givenUp = 0;
    vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
      fetched.push(url);
      return fetched.length === 1 ? noAnswer(init, () => givenUp++) : Promise.resolve({ ok: true, status: 200, json: async () => JSON.parse(statsText) as unknown });
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const clock = vi.spyOn(performance, 'now');
    try {
      const started = performance.now();
      useFinder.getState().prepare();
      expect(useFinder.getState().loading).toBe(true);
      // opened again at once: the download is only slow so far, and is left alone
      useFinder.getState().prepare();
      expect(fetched).toHaveLength(1);
      expect(givenUp).toBe(0);
      // opened again after nothing arrived for a while: the old request is given up, a new one made
      clock.mockImplementation(() => started + 60_000);
      useFinder.getState().prepare();
      expect(fetched).toHaveLength(2);
      expect(givenUp).toBe(1);
      clock.mockRestore();
      await until(() => !!useFinder.getState().stats);
      // the failure that giving the old one up made says nothing: not on screen, not in the console
      await new Promise((r) => setTimeout(r, 20));
      expect(useFinder.getState()).toMatchObject({ loading: false, problem: null });
      expect(warn).not.toHaveBeenCalled();
    } finally {
      clock.mockRestore();
      warn.mockRestore();
    }
  });

  it('says so when the statistics stay stalled while the pane is open, and asks again on the next opening', async () => {
    let givenUp = 0;
    let down = true;
    vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
      fetched.push(url);
      return down ? noAnswer(init, () => givenUp++) : Promise.resolve({ ok: true, status: 200, json: async () => JSON.parse(statsText) as unknown });
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    try {
      useFinder.getState().prepare();
      await vi.advanceTimersByTimeAsync(GIVE_UP_MS - 1000);
      // asked for again alongside meanwhile, and still waited for
      expect(fetched.length).toBeGreaterThan(1);
      expect(useFinder.getState()).toMatchObject({ loading: true, problem: null });
      expect(givenUp).toBe(0);
      await vi.advanceTimersByTimeAsync(2000);
      // nothing came for long enough: every request is given up, and the pane says what to do
      expect(givenUp).toBe(fetched.length);
      expect(useFinder.getState().loading).toBe(false);
      expect(useFinder.getState().problem).toMatch(/couldn't load its build statistics/);
    } finally {
      vi.useRealTimers();
      warn.mockRestore();
    }
    down = false;
    useFinder.getState().prepare();
    await until(() => !!useFinder.getState().stats);
    expect(useFinder.getState()).toMatchObject({ loading: false, problem: null });
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

  it('downloads the recipes for a budget search only, and once', async () => {
    const recipesUrl = `${import.meta.env.BASE_URL}data/recipes/${gd.core.manifest.dataVersion}.json`;
    await searched();
    expect(fetched.filter((u) => u.includes('/recipes/'))).toEqual([]);
    const plain = useFinder.getState().result!.swaps;
    // ticking Budget asks for them, so they are on their way before Search is pressed
    useFinder.getState().setQuery({ budget: true });
    expect(fetched.filter((u) => u.includes('/recipes/'))).toEqual([recipesUrl]);
    useFinder.getState().search();
    // the search says it has started while the recipes are on their way, and keeps the old list till it is done
    expect(useFinder.getState()).toMatchObject({ progress: 0, recipesLoading: true });
    await until(() => useFinder.getState().searched?.budget === true);
    expect(fetched.filter((u) => u.includes('/recipes/'))).toEqual([recipesUrl]);
    const cheap = useFinder.getState().result!.swaps;
    expect(cheap.length).toBeGreaterThan(0);
    expect(cheap.map(swapId)).not.toEqual(plain.map(swapId));
    expect(useFinder.getState().note).toBeNull();
    // the list is the one the recipes give, not the one a guess from each set's rarity would
    const input = { gd, stats: useFinder.getState().stats!, build: useStore.getState().build!, query: useFinder.getState().searched! };
    const withRecipes = findSwaps({ ...input, recipes: checkRecipes(JSON.parse(recipesText)) }).swaps;
    expect(cheap.map((s) => [swapId(s), s.score])).toEqual(withRecipes.map((s) => [swapId(s), s.score]));
    expect(cheap.map((s) => [swapId(s), s.score])).not.toEqual(findSwaps(input).swaps.map((s) => [swapId(s), s.score]));
    // ranked again after a swap is kept: the recipes are not asked for twice
    useFinder.getState().keep(cheap[0]!);
    await until(() => useFinder.getState().progress === null && useFinder.getState().searchedKept?.length === 1);
    expect(fetched.filter((u) => u.includes('/recipes/'))).toEqual([recipesUrl]);
  });

  it('gives up a budget search that is still waiting for the recipes when the pane closes', async () => {
    await searched();
    const list = useFinder.getState().result;
    let release: (() => void) | undefined;
    const real = fetch;
    vi.stubGlobal('fetch', async (url: string) => {
      if (url.includes('/recipes/')) await new Promise<void>((r) => (release = r));
      return real(url);
    });
    useFinder.getState().setQuery({ budget: true });
    useFinder.getState().search();
    await until(() => !!release);
    useFinder.getState().stop();
    release!();
    await until(() => !!useFinder.getState().recipes);
    await new Promise((r) => setTimeout(r, 50));
    expect(useFinder.getState()).toMatchObject({ progress: null, result: list });
    expect(useFinder.getState().searched?.budget).toBeUndefined();
  });

  it('gives up a budget search whose build changes while the recipes download, and shares the download with the shopping list', async () => {
    await searched();
    let release: (() => void) | undefined;
    let asks = 0;
    const real = fetch;
    vi.stubGlobal('fetch', async (url: string) => {
      if (url.includes('/recipes/')) {
        asks++;
        await new Promise<void>((r) => (release = r));
      }
      return real(url);
    });
    useFinder.getState().setQuery({ budget: true });
    useFinder.getState().search();
    await until(() => !!release);
    // the shopping list opens meanwhile: it waits for the same download
    useFinder.getState().openShopping();
    expect(asks).toBe(1);
    // the build changes under the search: its list would be for a build that is gone
    useStore.getState().setBuild(structuredClone(useStore.getState().build!));
    expect(useFinder.getState()).toMatchObject({ progress: null, result: null });
    release!();
    await until(() => !!useFinder.getState().recipes);
    await new Promise((r) => setTimeout(r, 50));
    expect(useFinder.getState()).toMatchObject({ progress: null, result: null, searched: null, note: null });
    expect(asks).toBe(1);
  });

  it('does not wait for ever for the recipes: a budget search goes by rarity when they are slow, and says so', async () => {
    await searched();
    let release: (() => void) | undefined;
    const real = fetch;
    vi.stubGlobal('fetch', async (url: string) => {
      if (url.includes('/recipes/')) await new Promise<void>((r) => (release = r));
      return real(url);
    });
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      useFinder.getState().setQuery({ budget: true });
      useFinder.getState().search();
      await vi.advanceTimersByTimeAsync(RECIPES_WAIT_MS - 1);
      // still waiting: nothing ranked yet
      expect(useFinder.getState()).toMatchObject({ progress: 0, recipesLoading: true });
      expect(useFinder.getState().searched?.budget).toBeUndefined();
      for (let i = 0; i < 100_000 && useFinder.getState().progress !== null; i++) await vi.advanceTimersByTimeAsync(1);
    } finally {
      vi.useRealTimers();
    }
    expect(useFinder.getState().searched?.budget).toBe(true);
    expect(useFinder.getState().result!.swaps.length).toBeGreaterThan(0);
    expect(useFinder.getState().note).toMatch(/recipes haven't downloaded/);
    // the download ends later: the next search reads the recipes, and the note goes
    release!();
    await until(() => !!useFinder.getState().recipes);
    useFinder.getState().setQuery({ budget: true });
    useFinder.getState().search();
    await until(() => useFinder.getState().progress === null);
    expect(useFinder.getState().note).toBeNull();
    expect(fetched.filter((u) => u.includes('/recipes/'))).toHaveLength(1);
  });

  it('never holds a kept swap up for recipes that stalled, and asks for them afresh on the next Search', async () => {
    await searched();
    // the recipes get no answer until `answer` is set
    let asks = 0;
    let answer = false;
    const real = fetch;
    vi.stubGlobal('fetch', (url: string) => {
      if (!url.includes('/recipes/')) return real(url);
      asks++;
      return answer ? real(url) : new Promise(() => undefined);
    });
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      useFinder.getState().setQuery({ budget: true });
      expect(asks).toBe(1);
      useFinder.getState().search();
      for (let i = 0; i < 100_000 && useFinder.getState().progress !== null; i++) await vi.advanceTimersByTimeAsync(1);
    } finally {
      vi.useRealTimers();
    }
    expect(useFinder.getState().searched?.budget).toBe(true);
    expect(useFinder.getState().note).toMatch(/recipes haven't downloaded/);
    // a kept swap ranks the list again at once, by rarity: it does not sit out the wait again
    const started = performance.now();
    useFinder.getState().keep(useFinder.getState().result!.swaps[0]!);
    await until(() => useFinder.getState().progress === null && useFinder.getState().searchedKept?.length === 1);
    expect(performance.now() - started).toBeLessThan(RECIPES_WAIT_MS / 2);
    expect(asks).toBe(1);
    // nothing has arrived for a while: the next Search gives that download up and asks afresh
    answer = true;
    const later = performance.now() + 60_000;
    const clock = vi.spyOn(performance, 'now').mockImplementation(() => later);
    try {
      useFinder.getState().search();
    } finally {
      clock.mockRestore();
    }
    expect(asks).toBe(2);
    await until(() => useFinder.getState().progress === null && !!useFinder.getState().recipes);
    expect(useFinder.getState().note).toBeNull();
  });

  it("runs a budget search by each set's rarity when the recipes can't be had, and says so", async () => {
    await searched();
    const real = fetch;
    let down = true;
    vi.stubGlobal('fetch', async (url: string) => (down && url.includes('/recipes/') ? { ok: false, status: 503, json: async () => null } : real(url)));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      useFinder.getState().setQuery({ budget: true });
      useFinder.getState().search();
      await until(() => useFinder.getState().searched?.budget === true);
      expect(useFinder.getState().result!.swaps.length).toBeGreaterThan(0);
      expect(useFinder.getState().note).toMatch(/recipes haven't downloaded/);
      expect(useFinder.getState().note).not.toMatch(/503|HTTP/);
      // a kept swap ranks the list again by rarity at once: only Search asks for the recipes again
      const asked = fetched.filter((u) => u.includes('/recipes/')).length;
      useFinder.getState().keep(useFinder.getState().result!.swaps[0]!);
      await until(() => useFinder.getState().progress === null && useFinder.getState().searchedKept?.length === 1);
      expect(fetched.filter((u) => u.includes('/recipes/'))).toHaveLength(asked);
      expect(useFinder.getState().note).toMatch(/recipes haven't downloaded/);
      useFinder.getState().drop(useFinder.getState().kept[0]!.key);
      await until(() => useFinder.getState().progress === null && useFinder.getState().searchedKept?.length === 0);
      // the next search asks for them again, and the note goes
      down = false;
      useFinder.getState().setQuery({ budget: true });
      useFinder.getState().search();
      await until(() => useFinder.getState().progress === null && !!useFinder.getState().recipes);
      expect(useFinder.getState().note).toBeNull();
    } finally {
      warn.mockRestore();
    }
    // a game version with no recipe file: the same search, with nothing to say (there is nothing to try again)
    noRecipes = true;
    useFinder.setState({ recipes: null, recipesFor: null });
    vi.stubGlobal('fetch', real);
    useFinder.getState().setQuery({ budget: true });
    useFinder.getState().search();
    await until(() => useFinder.getState().progress === null && useFinder.getState().recipesMissing);
    expect(useFinder.getState().result!.swaps.length).toBeGreaterThan(0);
    expect(useFinder.getState().note).toBeNull();
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

  it('lets go of what only fitted with the swap let go, and applies nothing the game would refuse', async () => {
    useFinder.getState().prepare();
    await until(() => !!useFinder.getState().stats);
    const build = useStore.getState().build!;
    const rules = new BuildRules(gd, build);
    const swap = (name: string, set: string, slot: number, enh: { boost: number; ioLevel?: number }): RankedSwap => {
      const e = rules.entries().find((x) => x.power.n === name)!;
      return { key: e.key, power: e.power.id, freeLevel: e.level, set: gd.boostSets.find((s) => s.n === set)!.id, count: 1, pieces: [{ slot, enh }], before: slotIds(e.slots), score: 0, lines: [], warnings: [], displaced: [] };
    };
    // Aria of Stasis holds a unique archetype piece: one swap takes it out, the other puts it into another power
    const unique = pid(gd, 'Boosts.Superior_Attuned_Superior_Dominating_Grasp_E.Superior_Attuned_Superior_Dominating_Grasp_E');
    const out = swap('Dominator_Control.Symphony_Control.Aria_of_Stasis', 'Annihilation', 0, { boost: pid(gd, 'Boosts.Crafted_Annihilation_A.Crafted_Annihilation_A'), ioLevel: 49 });
    const into = swap('Dominator_Control.Symphony_Control.Hymn_of_Dissonance', 'Superior_Dominating_Grasp', 3, { boost: unique });
    expect(build.picks.find((p) => p?.power === out.power)!.slots[0]!.enh?.boost).toBe(unique);
    expect(swapsLegal(gd, build, [out])).toBe(true);
    expect(swapsLegal(gd, build, [into])).toBe(false);
    expect(swapsLegal(gd, build, [out, into])).toBe(true);
    useFinder.getState().keep(out);
    useFinder.getState().keep(into);
    expect(useFinder.getState().kept).toEqual([out, into]);
    // letting the first go would leave the second one the game refuses: it goes too, and is named
    useFinder.getState().drop(out.key);
    expect(useFinder.getState().kept).toEqual([]);
    expect(useFinder.getState().note).toMatch(/Superior Dominating Grasp into Hymn of Dissonance only fitted with the swap you let go/);
    // letting the second go leaves the first, which stands by itself
    useFinder.getState().keep(out);
    useFinder.getState().keep(into);
    useFinder.getState().drop(into.key);
    expect(useFinder.getState()).toMatchObject({ kept: [out], note: null });
    // only what the game refuses goes, whatever order the swaps were kept in: a second pair of the
    // same kind, the swap that puts the piece in kept before the one that takes it out
    const out2 = swap('Dominator_Assault.Dark_Assault.Gloom', 'Winters_Bite', 0, { boost: pid(gd, 'Boosts.Attuned_Winters_Bite_A.Attuned_Winters_Bite_A') });
    const into2 = swap('Dominator_Assault.Dark_Assault.Dark_Blast', 'Apocalypse', 0, { boost: pid(gd, 'Boosts.Crafted_Apocalypse_F.Crafted_Apocalypse_F'), ioLevel: 49 });
    expect(swapsLegal(gd, build, [into, out, out2, into2])).toBe(true);
    useFinder.setState({ kept: [into, out, out2, into2], note: null });
    useFinder.getState().drop(out2.key);
    expect(useFinder.getState().kept).toEqual([into, out]);
    expect(useFinder.getState().note).toMatch(/^Apocalypse into Dark Blast only fitted with the swap you let go, so it was let go too\.$/);
    // kept swaps that do not fit together (however they came to be kept) are never written into the build
    let asked = 0;
    useStore.setState({
      askConfirm: async () => {
        asked++;
        return true;
      },
    });
    useFinder.setState({ kept: [into], note: null });
    await useFinder.getState().apply();
    expect(asked).toBe(0);
    expect(useStore.getState().build).toBe(build);
    expect(useFinder.getState().note).toMatch(/don't fit together any more/);
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

describe('finder store: shopping list', () => {
  /** Search and keep the first result. */
  async function kept(): Promise<RankedSwap> {
    await searched();
    const first = useFinder.getState().result!.swaps[0]!;
    useFinder.getState().keep(first);
    await until(() => useFinder.getState().progress === null);
    return first;
  }

  it("shows the kept swaps' pieces, and keeps them in the browser only once the swaps are applied", async () => {
    const first = await kept();
    const pieces = swapItems([first]);
    expect(pieces.length).toBeGreaterThan(0);
    expect(shopItems(useFinder.getState())).toEqual(pieces);
    // marking a piece of a kept swap as owned is remembered, not stored
    useFinder.getState().setOwned([0], /*owned=*/ true);
    expect(shopItems(useFinder.getState())[0]).toEqual({ ...pieces[0]!, owned: true });
    expect(stored.has(SHOPPING_KEY)).toBe(false);
    // letting the swap go takes its pieces off the list
    useFinder.getState().drop(first.key);
    expect(shopItems(useFinder.getState())).toEqual([]);
    await until(() => useFinder.getState().progress === null); // nothing is kept from a list being ranked again
    useFinder.getState().keep(first);
    expect(useFinder.getState().kept).toEqual([first]);
    await until(() => useFinder.getState().progress === null);
    useFinder.getState().setOwned([0], /*owned=*/ true);
    await useFinder.getState().apply();
    // applied: the pieces are the browser's now, with the mark, and the list still shows them
    const saved = pieces.map((p, i) => ({ ...p, owned: i === 0 }));
    expect(readShopping('homecoming')).toEqual(saved);
    expect(useFinder.getState()).toMatchObject({ kept: [], shop: saved, shopOwned: {}, settled: [] });
    expect(shopItems(useFinder.getState())).toEqual(saved);
  });

  it('adds to the list the browser already keeps, never an applied swap twice', async () => {
    const before = [{ boost: pid(gd, 'Boosts.Crafted_Luck_of_the_Gambler_F.Crafted_Luck_of_the_Gambler_F'), level: 49, owned: true }];
    writeShopping('homecoming', before);
    const first = await kept();
    const pieces = swapItems([first]);
    // the changed build is opened in a new tab (twice), then applied here: its pieces go on once
    useFinder.getState().openedNewBuild();
    expect(readShopping('homecoming')).toEqual([...before, ...pieces]);
    expect(shopItems(useFinder.getState())).toEqual([...before, ...pieces]);
    useFinder.getState().openedNewBuild();
    await useFinder.getState().apply();
    expect(readShopping('homecoming')).toEqual([...before, ...pieces]);
    // a build edited without applying leaves the list as it is
    useStore.getState().setBuild({ ...useStore.getState().build!, name: 'Edited' });
    expect(readShopping('homecoming')).toEqual([...before, ...pieces]);
  });

  it('declined: nothing is applied and nothing is kept in the browser', async () => {
    await kept();
    answer = false;
    await useFinder.getState().apply();
    expect(stored.has(SHOPPING_KEY)).toBe(false);
    expect(useFinder.getState().shop).toEqual([]);
  });

  it('reads the kept list and the recipes when it opens, marks saved items, and clears after asking', async () => {
    const list = [
      { boost: pid(gd, 'Boosts.Crafted_Luck_of_the_Gambler_F.Crafted_Luck_of_the_Gambler_F'), level: 49, owned: false },
      { boost: pid(gd, 'Boosts.Attuned_Winters_Bite_A.Attuned_Winters_Bite_A'), level: null, owned: false },
    ];
    writeShopping('homecoming', list);
    useFinder.getState().openShopping();
    expect(useFinder.getState()).toMatchObject({ shop: list, recipesLoading: true });
    await until(() => !!useFinder.getState().recipes);
    expect(fetched).toEqual([`${import.meta.env.BASE_URL}data/recipes/${gd.core.manifest.dataVersion}.json`]);
    // opened again: the list is read again, the recipes are not asked for twice
    useFinder.getState().openShopping();
    expect(fetched).toHaveLength(1);
    useFinder.getState().setOwned([1, 7], /*owned=*/ true);
    expect(readShopping('homecoming')).toEqual([list[0], { ...list[1]!, owned: true }]);
    answer = false;
    await useFinder.getState().clearShopping();
    expect(readShopping('homecoming')).toHaveLength(2);
    answer = true;
    await useFinder.getState().clearShopping();
    expect(readShopping('homecoming')).toEqual([]);
    expect(useFinder.getState().shop).toEqual([]);
    expect(stored.has(SHOPPING_KEY)).toBe(false);
  });

  it('goes without recipes when the game version has none, without asking for them again', async () => {
    noRecipes = true;
    useFinder.getState().openShopping();
    await until(() => !useFinder.getState().recipesLoading);
    expect(useFinder.getState()).toMatchObject({ recipes: null, recipesMissing: true });
    useFinder.getState().openShopping();
    expect(fetched).toHaveLength(1);
  });

  it('asks for the recipes again after a download that failed', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.stubGlobal('fetch', async (url: string) => {
      fetched.push(url);
      return fetched.length === 1 ? { ok: false, status: 503, json: async () => null } : { ok: true, status: 200, json: async () => JSON.parse(recipesText) as unknown };
    });
    try {
      useFinder.getState().openShopping();
      await until(() => !useFinder.getState().recipesLoading);
      expect(useFinder.getState()).toMatchObject({ recipes: null, recipesFor: null, recipesMissing: false, recipesFailed: gd.core.manifest.dataVersion });
      useFinder.getState().openShopping();
      expect(useFinder.getState().recipesFailed).toBeNull();
      await until(() => !!useFinder.getState().recipes);
      expect(fetched).toHaveLength(2);
    } finally {
      warn.mockRestore();
    }
  });

  it('gives a recipe download that stalled up when the list opens again, and asks afresh', async () => {
    let givenUp = 0;
    vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
      fetched.push(url);
      return fetched.length === 1 ? noAnswer(init, () => givenUp++) : Promise.resolve({ ok: true, status: 200, json: async () => JSON.parse(recipesText) as unknown });
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const clock = vi.spyOn(performance, 'now');
    try {
      const started = performance.now();
      useFinder.getState().openShopping();
      expect(useFinder.getState().recipesLoading).toBe(true);
      // opened again at once: left alone
      useFinder.getState().openShopping();
      expect(fetched).toHaveLength(1);
      expect(givenUp).toBe(0);
      // opened again after nothing arrived for a while: the old request is given up, a new one made
      clock.mockImplementation(() => started + 60_000);
      useFinder.getState().openShopping();
      expect(fetched).toHaveLength(2);
      expect(givenUp).toBe(1);
      clock.mockRestore();
      await until(() => !!useFinder.getState().recipes);
      // the failure that giving the old one up made says nothing
      await new Promise((r) => setTimeout(r, 20));
      expect(useFinder.getState()).toMatchObject({ recipesLoading: false, recipesMissing: false, recipesFailed: null });
      expect(warn).not.toHaveBeenCalled();
    } finally {
      clock.mockRestore();
      warn.mockRestore();
    }
  });

  it('lists the pieces as enhancements when the recipes stay stalled while the list is open, and asks again on the next opening', async () => {
    let down = true;
    vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
      fetched.push(url);
      return down ? noAnswer(init, () => undefined) : Promise.resolve({ ok: true, status: 200, json: async () => JSON.parse(recipesText) as unknown });
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    try {
      useFinder.getState().openShopping();
      await vi.advanceTimersByTimeAsync(GIVE_UP_MS - 1000);
      expect(useFinder.getState()).toMatchObject({ recipesLoading: true, recipesFailed: null });
      await vi.advanceTimersByTimeAsync(2000);
      expect(useFinder.getState()).toMatchObject({ recipes: null, recipesLoading: false, recipesFailed: gd.core.manifest.dataVersion });
    } finally {
      vi.useRealTimers();
      warn.mockRestore();
    }
    down = false;
    useFinder.getState().openShopping();
    await until(() => !!useFinder.getState().recipes);
    expect(useFinder.getState().recipesFailed).toBeNull();
  });

  it('marks the right piece with a saved list and two kept swaps on show', async () => {
    const before = [{ boost: pid(gd, 'Boosts.Crafted_Luck_of_the_Gambler_F.Crafted_Luck_of_the_Gambler_F'), level: 49, owned: false }];
    writeShopping('homecoming', before);
    useFinder.getState().openShopping();
    const first = await kept();
    const second = useFinder.getState().result!.swaps.find((s) => s.key !== first.key && swapItems([s]).length > 0)!;
    useFinder.getState().keep(second);
    await until(() => useFinder.getState().progress === null);
    expect(useFinder.getState().kept).toEqual([first, second]);
    const a = swapItems([first]);
    const b = swapItems([second]);
    expect(shopItems(useFinder.getState())).toEqual([...before, ...a, ...b]);
    // the second swap's last piece, and the saved item
    useFinder.getState().setOwned([before.length + a.length + b.length - 1, 0], /*owned=*/ true);
    const shown = shopItems(useFinder.getState());
    expect(shown.map((it) => it.owned)).toEqual([true, ...a.map(() => false), ...b.map((_, i) => i === b.length - 1)]);
    expect(readShopping('homecoming')).toEqual([{ ...before[0]!, owned: true }]);
    // a swap let go and kept again starts unmarked
    useFinder.getState().drop(second.key);
    await until(() => useFinder.getState().progress === null);
    useFinder.getState().keep(second);
    expect(shopItems(useFinder.getState()).slice(-b.length)).toEqual(b);
  });

  it('keeps what another tab added to the list, and marks nothing on a list that is no longer the one shown', async () => {
    const lotg = { boost: pid(gd, 'Boosts.Crafted_Luck_of_the_Gambler_F.Crafted_Luck_of_the_Gambler_F'), level: 49, owned: false };
    const winter = { boost: pid(gd, 'Boosts.Attuned_Winters_Bite_A.Attuned_Winters_Bite_A'), level: null, owned: false };
    writeShopping('homecoming', [lotg]);
    useFinder.getState().openShopping();
    // another tab (the changed build, opened as a new one) adds a piece
    writeShopping('homecoming', [lotg, winter]);
    useFinder.getState().setOwned([0], /*owned=*/ true);
    expect(readShopping('homecoming')).toEqual([{ ...lotg, owned: true }, winter]);
    expect(useFinder.getState().shop).toEqual([{ ...lotg, owned: true }, winter]);
    // another tab clears the list: index 1 names nothing now
    writeShopping('homecoming', [winter]);
    useFinder.getState().setOwned([1], /*owned=*/ true);
    expect(readShopping('homecoming')).toEqual([winter]);
    expect(useFinder.getState()).toMatchObject({ shop: [winter] });
    expect(useFinder.getState().note).toMatch(/changed in another tab/);
  });

  it('after a clear, shows the kept swaps as not on the list yet, a swap opened as a new build included', async () => {
    const first = await kept();
    const pieces = swapItems([first]);
    useFinder.getState().openedNewBuild();
    expect(readShopping('homecoming')).toEqual(pieces);
    await useFinder.getState().clearShopping();
    expect(readShopping('homecoming')).toEqual([]);
    // as the question said: the kept swap's pieces stay on the list shown
    expect(shopItems(useFinder.getState())).toEqual(pieces);
    await useFinder.getState().apply();
    expect(readShopping('homecoming')).toEqual(pieces);
  });

  it('says so when the browser will not store the list, and keeps it for as long as the tab lives', async () => {
    await kept();
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: () => {
        throw new Error('full');
      },
      removeItem: () => undefined,
    });
    useFinder.getState().openedNewBuild();
    expect(useFinder.getState().note).toMatch(/wouldn't store the shopping list/);
    const held = useFinder.getState().shop;
    expect(held.length).toBeGreaterThan(0);
    // opening the list again does not swap it for the empty one the browser holds
    useFinder.getState().openShopping();
    expect(useFinder.getState()).toMatchObject({ shop: held, unsavedFor: 'homecoming' });
    // nor does a change in another tab: this list is the tab's own
    shoppingChangedElsewhere(SHOPPING_KEY);
    expect(useFinder.getState().shop).toEqual(held);
    // once the browser stores it again, the stored list is the one that counts
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => stored.get(k) ?? null,
      setItem: (k: string, v: string) => void stored.set(k, v),
      removeItem: (k: string) => void stored.delete(k),
    });
    useFinder.getState().setOwned([0], /*owned=*/ true);
    expect(useFinder.getState().unsavedFor).toBeNull();
    expect(readShopping('homecoming')).toEqual(held.map((it, i) => ({ ...it, owned: i === 0 })));
  });

  it("keeps a list the browser refused to store for its own server only", () => {
    const winter = { boost: pid(gd, 'Boosts.Attuned_Winters_Bite_A.Attuned_Winters_Bite_A'), level: null, owned: false };
    writeShopping('homecoming', [winter]);
    // another server's list was refused earlier in this tab: this server's is read from the browser
    useFinder.setState({ shop: [{ boost: 5, level: 20, owned: false }], shopFor: 'thunderspy', unsavedFor: 'thunderspy' });
    useFinder.getState().openShopping();
    expect(useFinder.getState()).toMatchObject({ shop: [winter], shopFor: 'homecoming', unsavedFor: null });
  });

  it('shows what another tab stored, for the list on show only', () => {
    const lotg = { boost: pid(gd, 'Boosts.Crafted_Luck_of_the_Gambler_F.Crafted_Luck_of_the_Gambler_F'), level: 49, owned: false };
    // no list shown yet: nothing to refresh
    writeShopping('homecoming', [lotg]);
    shoppingChangedElsewhere(SHOPPING_KEY);
    expect(useFinder.getState().shop).toEqual([]);
    useFinder.getState().openShopping();
    writeShopping('homecoming', [lotg, lotg]);
    shoppingChangedElsewhere('hcp.current'); // another key: not the list
    expect(useFinder.getState().shop).toEqual([lotg]);
    shoppingChangedElsewhere(SHOPPING_KEY);
    expect(useFinder.getState().shop).toEqual([lotg, lotg]);
    stored.clear();
    shoppingChangedElsewhere(/*key=*/ null); // the whole storage was cleared
    expect(useFinder.getState().shop).toEqual([]);
  });

  it('says what happens when the browser will not clear the stored list', async () => {
    const lotg = { boost: pid(gd, 'Boosts.Crafted_Luck_of_the_Gambler_F.Crafted_Luck_of_the_Gambler_F'), level: 49, owned: false };
    writeShopping('homecoming', [lotg]);
    useFinder.getState().openShopping();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => stored.get(k) ?? null,
      setItem: () => {
        throw new Error('full');
      },
      removeItem: () => {
        throw new Error('full');
      },
    });
    await useFinder.getState().clearShopping();
    // empty here, and said plainly that the stored one is still there
    expect(useFinder.getState().shop).toEqual([]);
    expect(useFinder.getState().note).toMatch(/wouldn't clear the stored shopping list/);
    expect(JSON.parse(stored.get(SHOPPING_KEY)!)).toEqual({ v: 1, lists: { homecoming: [[lotg.boost, 49, 0]] } });
  });

  it('says so outside the pane when applying could not store the list', async () => {
    await kept();
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: () => {
        throw new Error('full');
      },
      removeItem: () => undefined,
    });
    openSetFinder();
    await useFinder.getState().apply();
    // the pane is closed and its note cleared with the build: the planner's own notice says it
    expect(useFinderOpen.getState().open).toBe(false);
    expect(told).toHaveLength(1);
    expect(told[0]).toMatch(/wouldn't store the shopping list/);
    expect(useFinder.getState().shop.length).toBeGreaterThan(0);
  });
});
