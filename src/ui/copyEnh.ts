/**
 * The copy keys over an enhancement: Ctrl+C (Cmd+C) with the pointer on one copies what getting
 * that one enhancement takes, its recipe and that recipe's salvage, as the set finder's shopping
 * list would write it for that piece alone (itemSearch). The build overview's slots use it
 * (useCopyHoveredSlot), and the shopping list itself (listenCopy).
 */
import { useEffect } from 'react';
import type { GameData } from '../data/gamedata.ts';
import { loadRecipes, type RecipeData } from '../data/recipes.ts';
import { dataRoot, serverById } from '../data/servers.ts';
import type { SlottedEnh } from '../engine/build.ts';
import { itemSearch } from '../engine/finder/shopping.ts';
import { useStore } from '../state/store.ts';
import { useHover } from './hover.ts';

// each server and game version's recipes, asked for once; a download that failed is forgotten, so
// the next slot pointed at asks again
const asked = new Map<string, Promise<RecipeData | null>>();
// the recipes that have arrived (null: the site has none for that version)
const arrived = new Map<string, RecipeData | null>();

/** @return What names a game data's recipes here: its server and its version. */
const keyOf = (gd: GameData): string => `${gd.server}|${gd.core.manifest.dataVersion}`;

/**
 * The recipes of a game data's version, downloaded the first time they are asked for.
 *
 * @param gd Game data.
 * @return The recipes; null when the site has none for that version.
 * @raise Error when the download fails (it is then asked for again next time).
 */
function recipesOf(gd: GameData): Promise<RecipeData | null> {
  const key = keyOf(gd);
  let p = asked.get(key);
  if (!p) {
    const s = serverById(gd.server);
    p = (s ? loadRecipes(dataRoot(s, import.meta.env.BASE_URL), gd.core.manifest.dataVersion) : Promise.resolve(null)).then(
      (r) => {
        arrived.set(key, r);
        return r;
      },
      (e: unknown) => {
        asked.delete(key);
        throw e;
      },
    );
    asked.set(key, p);
  }
  return p;
}

/**
 * What the copy keys put on the clipboard for a slotted enhancement.
 *
 * @param gd Game data.
 * @param recipes The game version's recipes; null when there are none.
 * @param enh The enhancement as it is slotted.
 * @return The auction house search for it, a line or (for a long recipe) two; empty for an
 *   enhancement that is in no set.
 */
export function slotSearch(gd: GameData, recipes: RecipeData | null, enh: SlottedEnh): string {
  return itemSearch(gd, recipes, { boost: enh.boost, level: enh.ioLevel ?? null }).join('\n');
}

/** What a screen has to copy right now: the text, or the text once something it waits for is in. */
export type CopyAnswer = { text: string } | { later: Promise<string> };

/** @return Whether the browser's own copy has something to do: selected text, or a text box in use. */
function browsersOwn(): boolean {
  const el = document.activeElement;
  return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || !!window.getSelection()?.toString();
}

/**
 * Hear the copy keys for a screen, until the returned function is called.
 *
 * 1. The browser's `copy` event is answered with the text itself, which needs no clipboard
 *    permission. Text that is not ready yet (`later`) is written to the clipboard when it is.
 * 2. A browser that sends no `copy` event with nothing selected still sends the key press: when
 *    Ctrl+C (Cmd+C) was pressed and no `copy` event came with it, the text is written to the
 *    clipboard directly.
 * 3. Selected text, or a text box the player is typing in, is left to the browser, and so is a
 *    press the screen has nothing for (`answer` gives null).
 *
 * @param answer What to copy now, asked at each press; null when the pointer is on nothing of the screen's.
 * @param done Told how each copy of the screen's ended: true once the text is on the clipboard,
 *   false when it could not be put there (an empty text is nothing to copy, and is not told).
 * @return Stops hearing.
 */
export function listenCopy(answer: () => CopyAnswer | null, done: (ok: boolean) => void): () => void {
  // whether the browser's copy event came with the last key press
  let heard = false;
  /** Put a text on the clipboard outside a copy event. */
  const write = (text: Promise<string>) => {
    text
      .then((t) => {
        if (!t) return;
        if (!navigator.clipboard) throw new Error('no clipboard');
        return navigator.clipboard.writeText(t).then(() => done(/*ok=*/ true));
      })
      .catch(() => done(/*ok=*/ false));
  };
  const onCopy = (e: ClipboardEvent) => {
    heard = true;
    if (!e.clipboardData || browsersOwn()) return;
    const a = answer();
    if (!a) return;
    e.preventDefault();
    if ('later' in a) return write(a.later);
    e.clipboardData.setData('text/plain', a.text);
    done(/*ok=*/ true);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key.toLowerCase() !== 'c' || !(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey) return;
    heard = false;
    // the copy event, where the browser sends one, comes before this runs
    window.setTimeout(() => {
      if (heard || browsersOwn()) return;
      const a = answer();
      if (a) write('later' in a ? a.later : Promise.resolve(a.text));
    }, 0);
  };
  document.addEventListener('copy', onCopy);
  document.addEventListener('keydown', onKey);
  return () => {
    document.removeEventListener('copy', onCopy);
    document.removeEventListener('keydown', onKey);
  };
}

/**
 * While a screen shows: the copy keys copy the search for the slotted enhancement under the
 * pointer (hover.ts: `ringTip`).
 *
 * The recipes are asked for when a filled slot is pointed at (also one the pointer already rests
 * on as the screen starts hearing), so they are there by the time the keys are pressed; keys
 * pressed sooner copy when the recipes arrive. An enhancement of no set has nothing to list and
 * keeps the browser's own copy. A copy that fails (the recipes did not download, the browser
 * refused the clipboard) is said in the planner's red notice.
 *
 * @param gd Game data (none: nothing is heard).
 * @param on Whether to hear the keys now.
 */
export function useCopyHoveredSlot(gd: GameData | null, on: boolean): void {
  useEffect(() => {
    if (!gd || !on) return;
    const load = () => void recipesOf(gd).catch((e: unknown) => console.warn('the recipes did not load', e));
    if (useHover.getState().ringTip) load();
    const unsubscribe = useHover.subscribe((h, was) => {
      if (h.ringTip && !was.ringTip) load();
    });
    const answer = (): CopyAnswer | null => {
      const tip = useHover.getState().ringTip;
      const enh = tip?.entry.slots[tip.slot]?.enh;
      // only a set's piece has a recipe list
      if (!enh || !gd.boostSetOf.has(enh.boost)) return null;
      const key = keyOf(gd);
      if (arrived.has(key)) return { text: slotSearch(gd, arrived.get(key) ?? null, enh) };
      return { later: recipesOf(gd).then((recipes) => slotSearch(gd, recipes, enh)) };
    };
    const stop = listenCopy(answer, (ok) => {
      if (!ok) useStore.getState().notify("Couldn't copy that enhancement's recipe list. Try again in a moment.");
    });
    return () => {
      unsubscribe();
      stop();
    };
  }, [gd, on]);
}
