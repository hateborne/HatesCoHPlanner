/**
 * One game version's recipes (<server data>/recipes/<version>.json), kept beside the version's
 * folder. Made by `python -m pipeline.recipes` from the client's baserecipes.bin and salvage.bin
 * (docs/pipeline.md). Only the set finder reads it (its shopping list, and a budget search for
 * the salvage a piece's recipe takes): no link, saved build or loader does, and a build opens the
 * same whether the file is there or not.
 */

import { heard } from './packed.ts';
import { ask, Watch } from './watch.ts';

/** Folder beside a server's version folders holding each version's recipes (recipes/<version>.json). */
export const RECIPES_FOLDER = 'recipes';

/** An invention salvage item: [display name, rarity (1 common, 2 uncommon, 3 rare), icon name]. */
export type SalvageDef = [name: string, rarity: number, icon: string];

/** Levels that take the same salvage: [first recipe level, last recipe level, salvage indexes]. Levels are the game's (1-based); an index is repeated when the recipe takes more than one. */
export type RecipeTier = [from: number, to: number, salvage: number[]];

/** The dropped recipe that makes one enhancement. */
export interface RecipeDef {
  dn: string; // the recipe's name as the game shows it ("... (Recipe)")
  r: number; // rarity: 1 common, 2 uncommon, 3 rare, 4 very rare
  t: RecipeTier[]; // the salvage it takes, by level
  lv?: number[]; // the levels it comes at, when not every level from the first tier's start to the last one's end
}

/** The whole recipe file. */
export interface RecipeData {
  v: 1;
  dataVersion: string; // the game version it was decoded for
  salvage: SalvageDef[];
  recipes: Record<string, RecipeDef>; // by the enhancement's full name ('Boosts.Crafted_X.Crafted_X')
}

// more than any client holds; a file past these is not one of ours
const MAX_SALVAGE = 2000;
const MAX_RECIPES = 20000;
// rarities run from 1 (common) to 4 (very rare)
const MAX_RARITY = 4;
// an icon's name as public/assets holds it (it becomes part of an address)
const ICON_NAME = /^[a-z0-9_]*$/;
// what tells the site's own page from any other (index.html holds it; a test keeps the two in step)
export const OWN_PAGE_MARK = 'id="not-started"';

/**
 * Check that a downloaded recipe file has the shape the set finder reads.
 *
 * Every salvage index is checked against the salvage list, so the reader never looks one up
 * that is not there; rarities are ones the list has colours for, and icon names are plain names.
 *
 * @param raw The parsed JSON.
 * @return The recipes, or null when it is not a recipe file this version of the app reads.
 */
export function checkRecipes(raw: unknown): RecipeData | null {
  const d = raw as Partial<RecipeData> | null;
  const whole = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;
  const rarity = (v: unknown): boolean => whole(v) && v >= 1 && v <= MAX_RARITY;
  if (!d || d.v !== 1 || typeof d.dataVersion !== 'string' || !Array.isArray(d.salvage) || d.salvage.length > MAX_SALVAGE) return null;
  if (!d.recipes || typeof d.recipes !== 'object' || Array.isArray(d.recipes)) return null;
  for (const s of d.salvage) {
    if (!Array.isArray(s) || typeof s[0] !== 'string' || !rarity(s[1]) || typeof s[2] !== 'string' || !ICON_NAME.test(s[2])) return null;
  }
  const entries = Object.values(d.recipes);
  if (entries.length > MAX_RECIPES) return null;
  const count = d.salvage.length;
  for (const r of entries) {
    if (!r || typeof r.dn !== 'string' || !rarity(r.r) || !Array.isArray(r.t)) return null;
    if (r.lv !== undefined && !(Array.isArray(r.lv) && r.lv.every(whole))) return null;
    for (const t of r.t) {
      if (!Array.isArray(t) || !whole(t[0]) || !whole(t[1]) || !Array.isArray(t[2])) return null;
      if (!t[2].every((i) => whole(i) && i < count)) return null;
    }
  }
  return d as RecipeData;
}

/**
 * Download one game version's recipes.
 *
 * A web page for an answer means one of two things. A host that answers any address with the
 * site's own page (a dev server, a local preview) gives it for a file it lacks: a version without
 * recipes, as a 404 is on the site. Any other page is someone else's (a network's sign-in page):
 * a failed download, to be asked for again, never "this version has no recipes" for the life of
 * the tab.
 *
 * @param root The server's data folder as the site serves it (dataRoot), with its closing slash.
 * @param version The game version's id.
 * @param watch The watch on the download: a file that gets no answer is asked for again alongside
 *   (ask), and a download that stalls can be given up through it.
 * @return The recipes; null when the site has none for that version (an approximate version: its
 *   client files are gone).
 * @raise Error when the download fails, or the file is not that version's recipe file.
 */
export async function loadRecipes(root: string, version: string, watch: Watch = new Watch()): Promise<RecipeData | null> {
  const url = `${root}${RECIPES_FOLDER}/${encodeURIComponent(version)}.json`;
  const answer = await ask(url, watch, { cache: 'no-cache' });
  if (answer.status === 404) {
    // nothing of it is read: the download is over
    watch.end(url);
    return null;
  }
  if (answer.ok && /^text\/html/i.test(answer.headers?.get('content-type') ?? '')) {
    // (read in one go, where the watch can't hear it)
    watch.unheard(url);
    const page = await answer.text().finally(() => watch.end(url));
    if (page.includes(OWN_PAGE_MARK)) return null;
    throw new Error(`the recipes of ${version} did not load (a web page that is not the site's came back)`);
  }
  const r = heard(answer, watch, url);
  if (!r.ok) throw new Error(`the recipes of ${version} did not load (HTTP ${r.status})`);
  const data = checkRecipes(await r.json());
  if (!data || data.dataVersion !== version) throw new Error('the recipe file is not in a form this version reads');
  return data;
}
