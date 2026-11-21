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
import { swapsLegal, type RankedSwap } from '../src/engine/finder/search.ts';
import { swapItems } from '../src/engine/finder/shopping.ts';
import { BuildRules } from '../src/engine/rules.ts';
import { importMidsText } from '../src/io/mids.ts';
import { decodeShare } from '../src/io/share.ts';
import { readShopping, SHOPPING_KEY, writeShopping } from '../src/io/shopping.ts';
import { shopItems, shoppingChangedElsewhere, swapId, useFinder } from '../src/state/finder.ts';
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
    vi.stubGlobal('fetch', (url: string) => {
      fetched.push(url);
      return fetched.length === 1 ? new Promise(() => undefined) : Promise.resolve({ ok: true, status: 200, json: async () => JSON.parse(statsText) as unknown });
    });
    const clock = vi.spyOn(performance, 'now');
    try {
      const started = performance.now();
      useFinder.getState().prepare();
      expect(useFinder.getState().loading).toBe(true);
      // opened again at once: the download is only slow so far, and is left alone
      useFinder.getState().prepare();
      expect(fetched).toHaveLength(1);
      // opened again after nothing arrived for a while
      clock.mockImplementation(() => started + 60_000);
      useFinder.getState().prepare();
      expect(fetched).toHaveLength(2);
      clock.mockRestore();
      await until(() => !!useFinder.getState().stats);
      expect(useFinder.getState()).toMatchObject({ loading: false, problem: null });
    } finally {
      clock.mockRestore();
    }
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
    vi.stubGlobal('fetch', (url: string) => {
      fetched.push(url);
      return fetched.length === 1 ? new Promise(() => undefined) : Promise.resolve({ ok: true, status: 200, json: async () => JSON.parse(recipesText) as unknown });
    });
    const clock = vi.spyOn(performance, 'now');
    try {
      const started = performance.now();
      useFinder.getState().openShopping();
      expect(useFinder.getState().recipesLoading).toBe(true);
      // opened again at once: left alone
      useFinder.getState().openShopping();
      expect(fetched).toHaveLength(1);
      clock.mockImplementation(() => started + 60_000);
      useFinder.getState().openShopping();
      expect(fetched).toHaveLength(2);
      clock.mockRestore();
      await until(() => !!useFinder.getState().recipes);
      expect(useFinder.getState()).toMatchObject({ recipesLoading: false, recipesMissing: false, recipesFailed: null });
    } finally {
      clock.mockRestore();
    }
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
