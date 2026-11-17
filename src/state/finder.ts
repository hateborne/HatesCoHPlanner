/**
 * The set finder's state: the search being built, what the last search found, and the swaps kept
 * so far (whether its pane is open is in finderOpen.ts). Nothing here is saved or put in a link:
 * closing the tab forgets it, and the build the planner holds only changes when the player applies
 * the kept swaps.
 */
import { create } from 'zustand';
import { loadFinderStats, type FinderStats } from '../data/finderStats.ts';
import { dataRoot, DEFAULT_SERVER, serverById } from '../data/servers.ts';
import type { Build } from '../engine/build.ts';
import { applySwaps, type Swap } from '../engine/finder/pending.ts';
import type { FinderQuery } from '../engine/finder/query.ts';
import { finderProblem, searchSwaps, swapsLegal, type FinderResult, type RankedSwap } from '../engine/finder/search.ts';
import { shareLink } from '../io/share.ts';
import { closeSetFinder } from './finderOpen.ts';
import { useStore } from './store.ts';

// how long one slice of a search may run before the page gets its turn again (ms)
const SLICE_MS = 12;

/** The set finder's store. */
export interface FinderStore {
  stats: FinderStats | null; // the build statistics, once downloaded
  loading: boolean; // the statistics are on their way
  problem: string | null; // why the finder can't work on this build, in plain words
  query: FinderQuery; // the search as the form holds it
  searched: FinderQuery | null; // the search the list shown was made with (another object than `query`: the form changed since)
  searchedKept: RankedSwap[] | null; // the kept swaps the list shown was ranked on top of (another array than `kept`: the ranking after a change was given up or failed)
  result: FinderResult | null; // what the last search found
  progress: number | null; // 0..1 while a search runs
  kept: RankedSwap[]; // the swaps kept so far, one per power
  selected: string | null; // id of the swap whose gains and losses show (a tap on phones; a click on desktop)
  link: string | null; // a share link to the build with the kept swaps in, for "open as new build"
  note: string | null; // something that went wrong with the last step, in plain words
  /** Get ready for the build the pane opened on: download the statistics the first time, and say why it can't work if it can't. */
  prepare(): void;
  /** Change part of the search. */
  setQuery(patch: Partial<FinderQuery>): void;
  /** Search with the form's query, against the build with the kept swaps in. */
  search(): void;
  /** Give up the running search (the pane closed). The list it would have replaced stays, marked out of date. */
  stop(): void;
  /** Show a swap's gains and losses (null: none). */
  select(id: string | null): void;
  /** Keep a swap (it replaces the one its power had) and rank the list again. Refused while a search runs: the list is on its way out. */
  keep(swap: RankedSwap): void;
  /** Let a power's kept swap go and rank the list again. */
  drop(key: string): void;
  /** Put every kept swap into the build the planner holds, after the player agrees. */
  apply(): Promise<void>;
}

/**
 * A swap's id in lists: its power, set and pieces.
 *
 * @param s The swap.
 * @return A string equal for two swaps that place the same pieces in the same slots.
 */
export function swapId(s: Swap): string {
  return `${s.key}|${s.set}|${s.pieces.map((p) => `${p.slot}:${p.enh.boost}:${p.enh.ioLevel ?? ''}`).join(',')}`;
}

const EMPTY_QUERY: FinderQuery = { goals: [], tags: [], extra: [] };

// each search and each link request gets a number; a newer one makes the older give up
let searchRun = 0;
let linkRun = 0;
// the search the running slices are working on (null: none runs)
let running: FinderQuery | null = null;

export const useFinder = create<FinderStore>((set, get) => {
  /** Work out the new-build link again (the kept swaps changed). */
  const relink = (): void => {
    const run = ++linkRun;
    const build = useStore.getState().build;
    const kept = get().kept;
    set({ link: null });
    if (!build || !kept.length) return;
    shareLink(applySwaps(build, kept))
      .then((link) => {
        if (run === linkRun) set({ link });
      })
      .catch((e: unknown) => {
        console.warn('set finder: the new-build link was not written', e);
        if (run === linkRun) set({ note: "The link for a new build couldn't be written. Your kept swaps are as they were." });
      });
  };

  /**
   * Rank the swaps for a search, in slices, against the build with the kept swaps in.
   *
   * The list on screen stays as it is until this one is whole: `searched` and `searchedKept` name
   * what a list was made with only once it is shown, so a search given up or failed leaves the
   * old list marked out of date.
   *
   * @param query The search to rank for.
   */
  const rank = (query: FinderQuery): void => {
    const { gd, build } = useStore.getState();
    const { stats, kept } = get();
    if (!gd || !build || !stats) return;
    const run = ++searchRun;
    const steps = searchSwaps({ gd, stats, build, kept, query });
    running = query;
    set({ progress: 0, note: null });
    const slice = (): void => {
      if (run !== searchRun) return;
      const until = performance.now() + SLICE_MS;
      let step: IteratorResult<number, FinderResult>;
      try {
        step = steps.next();
        while (!step.done && performance.now() < until) step = steps.next();
      } catch (e) {
        // never leave the pane saying "Searching": say it stopped, details in the console
        console.warn('set finder: the search failed', e);
        running = null;
        set({ progress: null, note: "The search couldn't finish. Press Search to try again." });
        return;
      }
      if (!step.done) {
        set({ progress: step.value });
        setTimeout(slice, 0);
        return;
      }
      const result = step.value;
      running = null;
      const left = result.stale.length ? get().kept.filter((k) => !result.stale.includes(k.key)) : get().kept;
      const ids = new Set([...left, ...result.swaps].map(swapId));
      set({ result, searched: query, searchedKept: left, progress: null, kept: left, selected: ids.has(get().selected ?? '') ? get().selected : null });
      if (left.length !== kept.length) relink();
    };
    setTimeout(slice, 0);
  };

  /**
   * Rank the list again after the kept swaps changed.
   *
   * It ranks for the search the list was made with (or the one being worked on), not the form's:
   * the form may have changed since, even to one that can't be searched, and only Search takes it.
   */
  const rerank = (): void => {
    const query = running ?? (get().result ? get().searched : null);
    if (query) rank(query);
  };

  return {
    stats: null,
    loading: false,
    problem: null,
    query: EMPTY_QUERY,
    searched: null,
    searchedKept: null,
    result: null,
    progress: null,
    kept: [],
    selected: null,
    link: null,
    note: null,

    prepare() {
      const { gd, build, server } = useStore.getState();
      if (!gd || !build) return;
      const known = get().stats;
      if (known) {
        set({ problem: finderProblem(gd, build, known) });
        return;
      }
      if (get().loading) return;
      const s = serverById(server);
      // another server's builds are told so without a download
      if (!s || gd.server !== DEFAULT_SERVER) {
        set({ problem: finderProblem(gd, build, null) });
        return;
      }
      set({ loading: true, problem: null });
      loadFinderStats(dataRoot(s, import.meta.env.BASE_URL))
        .then((stats) => {
          const now = useStore.getState();
          set({ stats, loading: false, problem: now.gd && now.build ? finderProblem(now.gd, now.build, stats) : null });
        })
        .catch((e: unknown) => {
          console.warn('set finder: statistics did not load', e);
          set({ loading: false, problem: "The set finder couldn't load its build statistics. Check your connection and open it again." });
        });
    },

    setQuery(patch) {
      set({ query: { ...get().query, ...patch } });
    },

    search() {
      rank(get().query);
    },

    stop() {
      searchRun++;
      running = null;
      if (get().progress !== null) set({ progress: null });
    },

    select(id) {
      set({ selected: id });
    },

    keep(swap) {
      const { gd, build } = useStore.getState();
      // while a search runs the list on screen is the old one: what it offers may no longer fit
      if (!gd || !build || get().progress !== null) return;
      const kept = [...get().kept.filter((k) => k.key !== swap.key), swap];
      if (!swapsLegal(gd, build, kept)) {
        set({ note: "That swap no longer fits with the swaps you kept. Search again for a list that does." });
        return;
      }
      set({ kept, selected: null, note: null });
      relink();
      rerank();
    },

    drop(key) {
      set({ kept: get().kept.filter((k) => k.key !== key), note: null });
      relink();
      rerank();
    },

    async apply() {
      const main = useStore.getState();
      const { kept } = get();
      const build = main.build;
      if (!build || !kept.length) return;
      const pieces = kept.reduce((n, k) => n + k.pieces.length, 0);
      const replaced = kept.reduce((n, k) => n + k.pieces.filter((p) => (k.before[p.slot] ?? null) !== null).length, 0);
      const ok = await main.askConfirm({
        title: 'Apply the kept swaps',
        text: `This puts ${pieces} set ${pieces === 1 ? 'piece' : 'pieces'} into ${kept.length} ${kept.length === 1 ? 'power' : 'powers'} of this build${replaced ? `, replacing ${replaced} ${replaced === 1 ? 'enhancement' : 'enhancements'} it holds now` : ''}.`,
        okLabel: 'Apply',
      });
      // the build may have changed while the question was up: the kept swaps were cleared with it
      if (!ok || useStore.getState().build !== build) return;
      // so may the kept swaps (a ranking that ended meanwhile found one out of date): the question named others
      if (get().kept !== kept) {
        set({ note: 'Your kept swaps changed while the question was up, so nothing was applied.' });
        return;
      }
      closeSetFinder();
      main.setBuild(applySwaps(build, kept));
    },
  };
});

// the kept swaps and the results belong to the build they were made for: any change to the build
// (an edit, another build opened, the kept swaps applied) starts the finder afresh
let lastBuild: Build | undefined = useStore.getState().build;
const unsubscribe = useStore.subscribe((s) => {
  if (s.build === lastBuild) return;
  lastBuild = s.build;
  searchRun++;
  linkRun++;
  running = null;
  useFinder.setState({ searched: null, searchedKept: null, result: null, progress: null, kept: [], selected: null, link: null, note: null });
  if (!s.build) closeSetFinder();
});
// a dev server swapping this module in again must not leave the old one listening too
if (import.meta.hot) import.meta.hot.dispose(unsubscribe);
