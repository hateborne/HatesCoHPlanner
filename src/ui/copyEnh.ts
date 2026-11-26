/**
 * The copy keys over a slotted enhancement on the build overview: Ctrl+C (Cmd+C) with the pointer
 * on a filled slot copies what getting that one enhancement takes, its recipe and that recipe's
 * salvage, as the set finder's shopping list would write it for that piece alone (itemSearch).
 */
import { useEffect } from 'react';
import type { GameData } from '../data/gamedata.ts';
import { loadRecipes, type RecipeData } from '../data/recipes.ts';
import { dataRoot, serverById } from '../data/servers.ts';
import type { SlottedEnh } from '../engine/build.ts';
import { itemSearch } from '../engine/finder/shopping.ts';
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

/**
 * While a screen shows: answer the browser's copy with the search for the slotted enhancement
 * under the pointer (hover.ts: `ringTip`).
 *
 * 1. The recipes are asked for when a filled slot is first pointed at, so they are there by the
 *    time the keys are pressed.
 * 2. On copy, with the recipes in, the text goes into the copy itself (no clipboard permission).
 *    With them still on their way it is written when they arrive.
 * 3. Text the player has selected, or a text box they are typing in, keeps the browser's own copy;
 *    so does an enhancement with nothing to list (one in no set).
 *
 * @param gd Game data (none: nothing is heard).
 * @param on Whether to hear the keys now.
 */
export function useCopyHoveredSlot(gd: GameData | null, on: boolean): void {
  useEffect(() => {
    if (!gd || !on) return;
    const load = () => recipesOf(gd).catch((e: unknown) => (console.warn('the recipes did not load', e), null));
    const stop = useHover.subscribe((h, was) => {
      if (h.ringTip && !was.ringTip) void load();
    });
    const onCopy = (e: ClipboardEvent) => {
      const tip = useHover.getState().ringTip;
      const enh = tip?.entry.slots[tip.slot]?.enh;
      const el = document.activeElement;
      if (!enh || !e.clipboardData || el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || window.getSelection()?.toString()) return;
      const key = keyOf(gd);
      if (arrived.has(key)) {
        const text = slotSearch(gd, arrived.get(key) ?? null, enh);
        if (!text) return;
        e.clipboardData.setData('text/plain', text);
        e.preventDefault();
        return;
      }
      // the recipes are still on their way: the copy waits for them
      e.preventDefault();
      void load().then((recipes) => {
        const text = arrived.has(key) ? slotSearch(gd, recipes, enh) : '';
        if (text) return navigator.clipboard?.writeText(text).catch(() => undefined);
      });
    };
    document.addEventListener('copy', onCopy);
    return () => {
      stop();
      document.removeEventListener('copy', onCopy);
    };
  }, [gd, on]);
}
