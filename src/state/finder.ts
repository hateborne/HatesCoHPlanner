/**
 * The set finder's state: the search being built, what the last search found, the swaps kept so
 * far and the shopping list (whether its pane is open is in finderOpen.ts). Nothing here is put
 * in a link, and only the shopping list is saved (io/shopping.ts): closing the tab forgets the
 * rest, and the build the planner holds only changes when the player applies the kept swaps.
 */
import { create } from 'zustand';
import { askFinderStats, releaseFinderStats, type FinderStats, type StatsAsk } from '../data/finderStats.ts';
import { loadRecipes, type RecipeData } from '../data/recipes.ts';
import { dataRoot, DEFAULT_SERVER, serverById } from '../data/servers.ts';
import { STALLED_MS, Watch } from '../data/watch.ts';
import type { Build } from '../engine/build.ts';
import { applySwaps, type Swap } from '../engine/finder/pending.ts';
import type { FinderQuery } from '../engine/finder/query.ts';
import { finderProblem, refusedSwaps, searchSwaps, swapsLegal, type FinderResult, type RankedSwap } from '../engine/finder/search.ts';
import { swapItems, type ShopItem } from '../engine/finder/shopping.ts';
import { BuildRules } from '../engine/rules.ts';
import { shareLink } from '../io/share.ts';
import { MAX_SHOP_ITEMS, readShopping, SHOPPING_KEY, writeShopping } from '../io/shopping.ts';
import { closeSetFinder } from './finderOpen.ts';
import { useStore } from './store.ts';

// how long one slice of a search may run before the page gets its turn again (ms)
const SLICE_MS = 12;
// how long a budget search waits for the recipes before it goes by each set's rarity (ms)
export const RECIPES_WAIT_MS = 10_000;

// How long a download may have nothing arrive before it is given up while the pane stays open. By
// then it has been asked for twice more alongside (ask), and a line that says it failed, with what
// to do, beats "Loading" for as long as the pane is up.
export const GIVE_UP_MS = 3 * STALLED_MS;

/**
 * Give a watched download up once nothing of it has arrived for GIVE_UP_MS: its request then
 * fails, and whoever asked says so as for any failed download.
 *
 * @param watch The watch on the download.
 * @return Call it when the download is over (or was replaced): the watching stops.
 */
function giveUpWhenStalled(watch: Watch): () => void {
  let timer: ReturnType<typeof setTimeout>;
  const look = (): void => {
    const wait = watch.quietIn(GIVE_UP_MS);
    if (wait <= 0) {
      watch.cancel();
      return;
    }
    // (a download that can't be heard is never quiet: looked at again later)
    timer = setTimeout(look, Math.min(wait, GIVE_UP_MS) + 50);
  };
  timer = setTimeout(look, GIVE_UP_MS);
  return () => clearTimeout(timer);
}

// what waits for the page's next turn (afterTurn), and the channel that brings it round
const turns: (() => void)[] = [];
let turnPort: MessagePort | null = null;

/**
 * Run something once the page has had its turn (input, drawing), as soon as it has.
 *
 * A timer of zero is not that: browsers hold a timer set from inside a timer back to 4 ms after a
 * few rounds, so a search cut into slices spent as long waiting as working. A message to oneself
 * comes round as soon as the page is free. A tab that is not showing keeps to timers, which the
 * browser slows there on purpose: nobody is waiting for the list. Without a window (tests) a
 * timer does too.
 *
 * @param fn What to run.
 */
function afterTurn(fn: () => void): void {
  if (typeof window === 'undefined' || typeof MessageChannel !== 'function' || (typeof document !== 'undefined' && document.visibilityState === 'hidden')) {
    setTimeout(fn, 0);
    return;
  }
  if (!turnPort) {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => turns.shift()?.();
    turnPort = channel.port2;
  }
  turns.push(fn);
  turnPort.postMessage(null);
}

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
  recipes: RecipeData | null; // the recipes of the build's game version, once downloaded for the shopping list or a budget search (null: not yet, or it has none)
  recipesFor: string | null; // the game version `recipes` was asked for
  recipesLoading: boolean; // the recipes are on their way
  recipesMissing: boolean; // the site has no recipes for that game version (not a failed download)
  recipesFailed: string | null; // the game version whose recipes did not download (asked for again when they are next wanted)
  unsavedFor: string | null; // the server whose list the browser refused to store: `shop` is its only copy, for as long as the tab lives
  shop: ShopItem[]; // the shopping list the browser keeps: the pieces of swaps already applied
  shopFor: string | null; // the server whose list `shop` is (enhancement ids are a server's own)
  shopOwned: Record<string, boolean[]>; // which pieces of each kept swap (by swap id) the player has; never saved: they join `shop` when the swap is applied
  settled: string[]; // ids of kept swaps whose pieces are on `shop` already ("Open as new build" was used)
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
  /** Put every kept swap into the build the planner holds, after the player agrees. Their pieces go on the shopping list. */
  apply(): Promise<void>;
  /** Read the shopping list the browser keeps and download the game version's recipes (the list was opened). */
  openShopping(): void;
  /** Mark items of the list shown (shopItems) as owned or not, by their indexes in it. */
  setOwned(indexes: readonly number[], owned: boolean): void;
  /** Empty the shopping list the browser keeps, after the player agrees. */
  clearShopping(): Promise<void>;
  /** The build with the kept swaps in was opened in a new tab: their pieces go on the shopping list. */
  openedNewBuild(): void;
}

/**
 * The pieces of the kept swaps that are not on the saved shopping list yet, with the player's marks.
 *
 * @param s The finder's state.
 * @return Per such swap, its id and its pieces to get.
 */
function pendingItems(s: Pick<FinderStore, 'kept' | 'shopOwned' | 'settled'>): { id: string; items: ShopItem[] }[] {
  return s.kept
    .map((k) => ({ id: swapId(k), swap: k }))
    .filter((k) => !s.settled.includes(k.id))
    .map((k) => ({ id: k.id, items: swapItems([k.swap]).map((it, i) => ({ ...it, owned: s.shopOwned[k.id]?.[i] ?? false })) }));
}

/**
 * The shopping list as shown: what the browser keeps, then the pieces the kept swaps would add.
 *
 * @param s The finder's state.
 * @return The items; setOwned takes indexes into this list.
 */
export function shopItems(s: Pick<FinderStore, 'shop' | 'kept' | 'shopOwned' | 'settled'>): ShopItem[] {
  return [...s.shop, ...pendingItems(s).flatMap((p) => p.items)];
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

// each search, link request and download gets a number; a newer one makes the older give up
let searchRun = 0;
let linkRun = 0;
let statsRun = 0;
let recipesRun = 0;
// the statistics download under way, the data folder it was asked for, and what stops the watching of it
let statsAsk: { root: string; made: StatsAsk; stop: () => void } | null = null;
// the watch on the recipe download under way, and what stops the watching of it
let recipesWatch: Watch | null = null;
let recipesStop: (() => void) | null = null;
// the search the running slices are working on (null: none runs)
let running: FinderQuery | null = null;
// the recipe download under way, if any
let recipesWait: Promise<void> | null = null;

export const useFinder = create<FinderStore>((set, get) => {
  /** Work out the new-build link again (the kept swaps changed). */
  const relink = (): void => {
    const run = ++linkRun;
    const build = useStore.getState().build;
    const kept = get().kept;
    set({ link: null });
    if (!build || !kept.length) return;
    // (the build is made inside the promise, so whatever goes wrong there is told the same way)
    Promise.resolve()
      .then(() => shareLink(applySwaps(build, kept)))
      .then((link) => {
        if (run === linkRun) set({ link });
      })
      .catch((e: unknown) => {
        console.warn('set finder: the new-build link was not written', e);
        if (run === linkRun) set({ note: "The link for a new build couldn't be written. Your kept swaps are as they were." });
      });
  };

  /** @return The id of the server the build's data is for (each server has its own shopping list). */
  const serverId = (): string => useStore.getState().gd?.server ?? DEFAULT_SERVER;

  /**
   * Keep a shopping list in the browser and show it.
   *
   * @param items The list; past MAX_SHOP_ITEMS its oldest items go.
   * @return What the player should be told (the browser would not store it, or items were dropped), else null.
   */
  const saveShop = (items: ShopItem[]): string | null => {
    const cut = items.slice(-MAX_SHOP_ITEMS);
    const stored = writeShopping(serverId(), cut);
    set({ shop: cut, shopFor: serverId(), unsavedFor: stored ? null : serverId() });
    if (!stored) return "Your browser wouldn't store the shopping list, so it will be gone when this tab closes.";
    return cut.length < items.length ? 'The shopping list is full, so its oldest items were dropped.' : null;
  };

  /**
   * The shopping list as it is kept now: read from the browser (another tab may have changed it,
   * and this one may never have opened it), or the store's own when the browser refused to store
   * this server's list, so that list lasts as long as the tab. (A browser that refuses this tab
   * refuses the others too, so nothing another tab stored is passed over.)
   *
   * @return The items.
   */
  const keptShop = (): ShopItem[] => {
    const server = serverId();
    return get().unsavedFor === server && get().shopFor === server ? get().shop : readShopping(server);
  };

  /**
   * Put the kept swaps' pieces on the saved shopping list: the swaps are going into a build.
   * A swap goes on once, however often it is applied or opened.
   *
   * @return What the player should be told about the saving (saveShop), else null.
   */
  const settle = (): string | null => {
    const pending = pendingItems(get());
    if (!pending.length) return null;
    const added = pending.flatMap((p) => p.items);
    const warning = added.length ? saveShop([...keptShop(), ...added]) : null;
    set({ settled: [...get().settled, ...pending.map((p) => p.id)] });
    return warning;
  };

  /** Forget the owned marks of swaps that are no longer kept: a swap kept again starts unmarked. */
  const pruneOwned = (): void => {
    const ids = new Set(get().kept.map(swapId));
    const marks = get().shopOwned;
    const keys = Object.keys(marks);
    if (keys.some((k) => !ids.has(k))) set({ shopOwned: Object.fromEntries(keys.filter((k) => ids.has(k)).map((k) => [k, marks[k]!])) });
  };

  /**
   * Download the recipes of the build's game version, unless they are here, on their way, or the
   * site has none for it. A download that failed is tried again.
   *
   * @param afresh The player asked for them again (the list opened, Search was pressed, Budget
   *   was ticked): a download on its way that has had nothing arrive for a while is then given up
   *   and asked for afresh, so one that stalled does not stay stalled for the life of the tab.
   * @return A promise that settles once the recipes are here or known not to be coming.
   */
  const wantRecipes = (afresh = false): Promise<void> => {
    const { gd } = useStore.getState();
    const s = gd ? serverById(gd.server) : undefined;
    if (!gd || !s) return Promise.resolve();
    const version = gd.core.manifest.dataVersion;
    if (get().recipesFor === version) {
      // here, none on the site, or on their way: left alone, unless they are on their way and stalled
      if (!afresh || !get().recipesLoading || !recipesWatch || !recipesWatch.quiet(STALLED_MS)) return recipesWait ?? Promise.resolve();
      recipesStop?.();
      recipesWatch.cancel();
    }
    const run = ++recipesRun;
    const watch = new Watch();
    const stop = giveUpWhenStalled(watch);
    recipesWatch = watch;
    recipesStop = stop;
    set({ recipes: null, recipesFor: version, recipesLoading: true, recipesMissing: false, recipesFailed: null });
    const wait = loadRecipes(dataRoot(s, import.meta.env.BASE_URL), version, watch)
      .then((recipes) => {
        stop();
        if (run !== recipesRun) return;
        recipesWatch = null;
        // none for this version (an approximate one): not asked for again, the list names enhancements only
        set({ recipes, recipesLoading: false, recipesMissing: !recipes });
      })
      .catch((e: unknown) => {
        stop();
        // (one given up for a fresh one says nothing: the fresh one will)
        if (run !== recipesRun) return;
        recipesWatch = null;
        console.warn('set finder: the recipes did not load', e);
        // asked for again the next time they are wanted
        set({ recipesFor: null, recipesLoading: false, recipesFailed: version });
      })
      .then(() => {
        if (recipesWait === wait) recipesWait = null;
      });
    recipesWait = wait;
    return wait;
  };

  /**
   * Rank the swaps for a search, in slices, against the build with the kept swaps in.
   *
   * The list on screen stays as it is until this one is whole: `searched` and `searchedKept` name
   * what a list was made with only once it is shown, so a search given up or failed leaves the
   * old list marked out of date.
   *
   * A budget search reads the salvage each piece's recipe takes, so a search the player started
   * waits for the recipes first, for RECIPES_WAIT_MS at most. When they can't be had in that time
   * it still runs, the salvage guessed from each set's rarity, and says so. Ranking the list again
   * after a kept swap changed never waits and never asks again: it goes by the recipes as they
   * stand, so a download that failed or stalled does not hold up every tick of a box.
   *
   * @param query The search to rank for.
   * @param retry The player started this search (Search was pressed): wait for the recipes, and
   *   ask again for ones whose download failed or stalled.
   */
  const rank = (query: FinderQuery, retry = false): void => {
    const { gd, build } = useStore.getState();
    const { stats, kept } = get();
    if (!gd || !build || !stats) return;
    const run = ++searchRun;
    const version = gd.core.manifest.dataVersion;
    let steps: Generator<number, FinderResult, void> | undefined;
    let guessed = false;
    running = query;
    set({ progress: 0, note: null });
    // the progress shown is in whole percents: the state is only touched when that changes
    let shown = 0;
    const slice = (): void => {
      if (run !== searchRun) return;
      const until = performance.now() + SLICE_MS;
      try {
        if (!steps) {
          const asked = get().recipesFor === version;
          const recipes = query.budget && asked ? get().recipes : null;
          // none, though the site may have them: the download failed or is taking too long
          guessed = !!query.budget && !recipes && !(asked && get().recipesMissing);
          steps = searchSwaps({ gd, stats, build, kept, query, recipes });
        }
        let step = steps.next();
        while (!step.done && performance.now() < until) step = steps.next();
        if (!step.done) {
          const percent = Math.round(step.value * 100);
          if (percent !== shown) set({ progress: step.value });
          shown = percent;
          afterTurn(slice);
          return;
        }
        const result = step.value;
        running = null;
        const left = result.stale.length ? get().kept.filter((k) => !result.stale.includes(k.key)) : get().kept;
        const ids = new Set([...left, ...result.swaps].map(swapId));
        set({ result, searched: query, searchedKept: left, progress: null, kept: left, selected: ids.has(get().selected ?? '') ? get().selected : null });
        if (guessed) set({ note: "The recipes haven't downloaded, so this budget search went by each set's rarity. Search again to try once more." });
        if (left.length !== kept.length) {
          // (the list is in: whatever goes wrong from here on is not the search's failure)
          try {
            relink();
            pruneOwned();
          } catch (e) {
            console.warn('set finder: the kept swaps were not tidied after the search', e);
          }
        }
      } catch (e) {
        // never leave the pane saying "Searching": say it stopped, details in the console
        console.warn('set finder: the search failed', e);
        running = null;
        set({ progress: null, note: "The search couldn't finish. Press Search to try again." });
      }
    };
    // only a budget search the player started waits for the recipes
    if (!query.budget || !retry) {
      afterTurn(slice);
      return;
    }
    // the first slice runs once: when the recipes are here or not coming, or the wait runs out
    let started = false;
    const start = (): void => {
      if (started) return;
      started = true;
      clearTimeout(timer);
      slice();
    };
    const timer = setTimeout(start, RECIPES_WAIT_MS);
    void wantRecipes(/*afresh=*/ true).then(start);
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
    recipes: null,
    recipesFor: null,
    recipesLoading: false,
    recipesMissing: false,
    recipesFailed: null,
    unsavedFor: null,
    shop: [],
    shopFor: null,
    shopOwned: {},
    settled: [],

    prepare() {
      const { gd, build, server } = useStore.getState();
      if (!gd || !build) return;
      const known = get().stats;
      if (known) {
        set({ problem: finderProblem(gd, known) });
        return;
      }
      if (get().loading) {
        // on their way: left alone, unless nothing has arrived for a while. A download that
        // stalled is given up here, on the pane's next opening, and asked for afresh
        if (!statsAsk || !statsAsk.made.watch.quiet(STALLED_MS)) return;
        // (its number moves on first, so the failure that giving it up makes says nothing)
        statsRun++;
        statsAsk.stop();
        statsAsk.made.watch.cancel();
        releaseFinderStats(statsAsk.root, statsAsk.made);
        statsAsk = null;
        set({ loading: false });
      }
      const s = serverById(server);
      // another server's builds are told so without a download
      if (!s || gd.server !== DEFAULT_SERVER) {
        set({ problem: finderProblem(gd, null) });
        return;
      }
      const run = ++statsRun;
      const root = dataRoot(s, import.meta.env.BASE_URL);
      // the page asked for them alongside the pane's code (App.tsx): the same download is joined
      const made = askFinderStats(root);
      const stop = giveUpWhenStalled(made.watch);
      statsAsk = { root, made, stop };
      set({ loading: true, problem: null });
      made.stats
        .then((stats) => {
          stop();
          if (run !== statsRun) return;
          statsAsk = null;
          releaseFinderStats(root, made);
          const now = useStore.getState();
          set({ stats, loading: false, problem: now.gd ? finderProblem(now.gd, stats) : null });
        })
        .catch((e: unknown) => {
          stop();
          // (one given up for a fresh one says nothing: the fresh one will)
          if (run !== statsRun) return;
          statsAsk = null;
          console.warn('set finder: statistics did not load', e);
          set({ loading: false, problem: "The set finder couldn't load its build statistics. Check your connection and open it again." });
        });
    },

    setQuery(patch) {
      const was = get().query;
      set({ query: { ...was, ...patch } });
      // Budget was ticked: its search reads the recipes, so they start downloading now, not when Search is pressed
      if (get().query.budget && !was.budget) void wantRecipes(/*afresh=*/ true);
    },

    search() {
      rank(get().query, /*retry=*/ true);
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
      pruneOwned();
      relink();
      rerank();
    },

    drop(key) {
      const { gd, build } = useStore.getState();
      let kept = get().kept.filter((k) => k.key !== key);
      let note: string | null = null;
      if (gd && build && kept.length) {
        // a kept swap can stand on another (that one took a unique piece out of the power this one
        // puts it in): without it the game would refuse this one, so it goes too, and is named.
        // Only the swaps the game refuses go, whatever order they were kept in, and what they
        // leave behind is looked at again, until the game takes all that is left
        const gone: string[] = [];
        const rules = new BuildRules(gd, build);
        for (let refused = refusedSwaps(gd, build, kept, rules); refused.length; refused = refusedSwaps(gd, build, kept, rules)) {
          for (const k of refused) gone.push(`${gd.boostSetById.get(k.set)?.dn ?? 'A set'} into ${gd.powerById.get(k.power)?.dn ?? 'a power'}`);
          kept = kept.filter((k) => !refused.includes(k));
        }
        if (gone.length) note = `${gone.join(', ')} only fitted with the swap you let go, so ${gone.length === 1 ? 'it was' : 'they were'} let go too.`;
      }
      set({ kept, note });
      pruneOwned();
      relink();
      rerank();
    },

    async apply() {
      const main = useStore.getState();
      const { kept } = get();
      const build = main.build;
      if (!build || !kept.length) return;
      // nothing the game would refuse is ever written into the build
      if (main.gd && !swapsLegal(main.gd, build, kept)) {
        set({ note: "Your kept swaps don't fit together any more, so nothing was applied. Let one go, or search again." });
        return;
      }
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
      const warning = settle();
      closeSetFinder();
      main.setBuild(applySwaps(build, kept));
      // the pane is closed and its note went with the build: said where the player still sees it
      if (warning) main.notify(warning);
    },

    openShopping() {
      const { gd } = useStore.getState();
      if (!gd) return;
      // a list the browser refused to store is kept for its own server only: another server's list replaces it here
      set({ shop: keptShop(), shopFor: gd.server, unsavedFor: get().unsavedFor === gd.server ? gd.server : null });
      void wantRecipes(/*afresh=*/ true);
    },

    setOwned(indexes, owned) {
      const shown = get().shop;
      // the list as it is kept now: another tab (the changed build, opened in one) may have added to it
      const saved = keptShop().slice();
      const same = saved.length >= shown.length && shown.every((it, i) => it.boost === saved[i]!.boost && it.level === saved[i]!.level);
      if (!same) {
        // not the list the indexes were taken from: mark nothing, show what is kept
        set({ shop: saved, shopFor: serverId(), note: 'The shopping list changed in another tab. It is shown as it is now.' });
        return;
      }
      const pending = pendingItems(get());
      const marks: Record<string, boolean[]> = {};
      for (const p of pending) marks[p.id] = p.items.map((it) => it.owned);
      let touched = false;
      for (const i of indexes) {
        if (i >= 0 && i < shown.length) {
          if (saved[i]!.owned !== owned) touched = true;
          saved[i] = { ...saved[i]!, owned };
          continue;
        }
        // past the list as shown: a kept swap's piece
        let at = i - shown.length;
        for (const p of pending) {
          if (at >= 0 && at < p.items.length) marks[p.id]![at] = owned;
          at -= p.items.length;
        }
      }
      set({ shopOwned: marks });
      if (touched) {
        const warning = saveShop(saved);
        if (warning) set({ note: warning });
      } else if (saved.length !== shown.length) {
        // items another tab added come after the ones shown here: once shown, a kept swap's pieces follow them
        set({ shop: saved, shopFor: serverId() });
      }
    },

    async clearShopping() {
      const main = useStore.getState();
      const build = main.build;
      const kept = get().kept.length;
      const ok = await main.askConfirm({
        title: 'Clear the shopping list',
        text: `This empties the shopping list this browser keeps.${kept ? ' The pieces of the swaps you have kept stay on it until you let those swaps go.' : ''}`,
        okLabel: 'Clear',
      });
      // another build may have been opened while the question was up: the list is that server's now
      if (!ok || useStore.getState().build !== build) return;
      // the kept swaps' pieces show again as not on the list yet, those opened as a new build included
      set({ shopOwned: {}, settled: [] });
      // refused: the list is empty here, but what the browser holds is as it was
      set({ note: saveShop([]) ? "Your browser wouldn't clear the stored shopping list, so the old one will be back when the page loads again." : null });
    },

    openedNewBuild() {
      const warning = settle();
      if (warning) set({ note: warning });
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
  useFinder.setState({ searched: null, searchedKept: null, result: null, progress: null, kept: [], selected: null, link: null, note: null, shopOwned: {}, settled: [] });
  if (!s.build) closeSetFinder();
});
/**
 * Another tab changed what the browser keeps: the shopping list is shown as it is now.
 *
 * A list the browser refused to store for this tab stays as it is: it is this tab's own.
 *
 * @param key The storage key that changed; null when the whole storage was cleared.
 */
export function shoppingChangedElsewhere(key: string | null): void {
  if (key !== null && key !== SHOPPING_KEY) return;
  const { shopFor, unsavedFor } = useFinder.getState();
  if (shopFor && unsavedFor !== shopFor) useFinder.setState({ shop: readShopping(shopFor) });
}
const onStorage = (e: StorageEvent): void => shoppingChangedElsewhere(e.key);
// (tests run without a window)
const listening = typeof window !== 'undefined' && typeof window.addEventListener === 'function';
if (listening) window.addEventListener('storage', onStorage);
// a dev server swapping this module in again must not leave the old one listening too
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    unsubscribe();
    if (listening) window.removeEventListener('storage', onStorage);
  });
}
