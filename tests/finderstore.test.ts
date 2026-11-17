/**
 * The set finder's store: it downloads its statistics once, searches in slices, keeps swaps beside
 * the build, and only changes the build when the player confirms.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { checkFinderStats } from '../src/data/finderStats.ts';
import type { Build } from '../src/engine/build.ts';
import { applySwaps } from '../src/engine/finder/pending.ts';
import { BuildRules } from '../src/engine/rules.ts';
import { importMidsText } from '../src/io/mids.ts';
import { decodeShare } from '../src/io/share.ts';
import { swapId, useFinder } from '../src/state/finder.ts';
import { openSetFinder, useFinderOpen } from '../src/state/finderOpen.ts';
import { useStore } from '../src/state/store.ts';
import { loadData, loadMidsMapFile } from './helpers/data.ts';

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
  vi.stubGlobal('location', { origin: 'https://example.test', pathname: '/', search: '', hash: '' });
  vi.stubGlobal('fetch', async (url: string) => {
    fetched.push(url);
    return { ok: true, status: 200, json: async () => JSON.parse(statsText) as unknown };
  });
  useStore.setState({ gd, build: await dominator(), server: 'homecoming', view: 'overview', askConfirm: async () => answer });
  useFinder.getState().stop();
  useFinder.setState({ stats: null, loading: false, problem: null, query: { goals: [], tags: [], extra: [] }, searched: null, result: null, progress: null, kept: [], selected: null, link: null, note: null });
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

  it('marks its results out of date when the form changes, and gives a search up when told to', async () => {
    await searched();
    expect(useFinder.getState().searched).toBe(useFinder.getState().query);
    useFinder.getState().setQuery({ attuned: true });
    expect(useFinder.getState().searched).not.toBe(useFinder.getState().query);
    // a search given up (the pane closed) leaves the old results and stops working
    const before = useFinder.getState().result;
    useFinder.getState().search();
    useFinder.getState().stop();
    expect(useFinder.getState().progress).toBeNull();
    await new Promise((r) => setTimeout(r, 300));
    expect(useFinder.getState().result).toBe(before);
  });

  it('keeps nothing from a list that is being ranked again, nor a swap that clashes with a kept one', async () => {
    await searched();
    const [first, second] = useFinder.getState().result!.swaps;
    useFinder.getState().search();
    useFinder.getState().keep(first!); // the list on screen is on its way out
    expect(useFinder.getState().kept).toEqual([]);
    await until(() => useFinder.getState().progress === null);
    useFinder.getState().keep(first!);
    await until(() => useFinder.getState().progress === null);
    expect(useFinder.getState()).toMatchObject({ kept: [first], selected: null, note: null });
    // the same pieces into another power: the game takes one of each unique piece, and here not even the power fits
    const other = useFinder.getState().result!.swaps.find((s) => s.key !== first!.key) ?? second!;
    const clash = { ...first!, key: other.key, power: other.power, freeLevel: other.freeLevel, before: other.before };
    useFinder.getState().keep(clash);
    expect(useFinder.getState().kept).toEqual([first]);
    expect(useFinder.getState().note).toMatch(/no longer fits/);
    // the next step that works clears the note
    useFinder.getState().drop(first!.key);
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
