/**
 * The set finder's shopping list: the enhancements kept swaps bring in, and what getting them
 * takes. A crafted piece needs its recipe and that recipe's salvage; a piece with no dropped
 * recipe (an attuned one, a winter or archetype set's) is bought whole. Pure: the list's items
 * come in, rows and auction house search lines go out.
 */
import type { GameData } from '../../data/gamedata.ts';
import type { RecipeData, RecipeDef } from '../../data/recipes.ts';
import type { BoostSet, Power } from '../../data/types.ts';
import type { Swap } from './pending.ts';

// The longest text the auction house's search box takes (uiAuction.c: smf_SetFlags(smfSearch, ..., 128, ...)).
export const AUCTION_SEARCH_MAX = 128;
// What the game adds to a recipe's name; a search without it also finds the crafted enhancement.
const RECIPE_SUFFIX = ' (Recipe)';

/** One enhancement to get. */
export interface ShopItem {
  boost: number; // enhancement power id
  level: number | null; // 0-based level it is slotted at; null for a piece with no level of its own (attuned)
  owned: boolean; // the player has it already
}

/** An item of the list with its place in it. */
export interface ShopPiece {
  index: number; // the item's index in the list
  item: ShopItem; // the item
  boost: Power; // its enhancement
}

/** A set on the list, with every piece of it the list holds. */
export interface ShopSet {
  set: BoostSet; // the set
  pieces: ShopPiece[]; // in the list's order
}

/** A row of the things to get. */
export interface ShopRow {
  key: string; // unique within its list
  name: string; // as the game names it
  count: number; // how many
  rarity: number; // 1 common, 2 uncommon, 3 rare, 4 very rare (0: none known)
  level?: number; // recipes: the recipe's level as the game shows it
  boost?: Power; // recipes and enhancements: the enhancement, for its icon
  at?: number | null; // enhancements to buy: the 0-based level the (first such) piece is slotted at, null for one with no level
  icon?: string; // salvage: its icon's name
}

/** Search lines for the auction house, each short enough for its search box. */
export interface AuctionLines {
  recipes: string[]; // recipe names (their level is the player's to set)
  salvage: string[]; // salvage names
  buy: string[]; // enhancement names
}

/** Everything the shopping list shows. */
export interface ShoppingList {
  sets: ShopSet[]; // the sets on the list, owned pieces included
  recipes: ShopRow[]; // recipes still needed, one row per enhancement and level
  salvage: ShopRow[]; // the salvage those recipes take, added up
  buy: ShopRow[]; // enhancements still needed that no recipe makes
  unknown: number; // items left out: this game data has no such enhancement, or it is in no set
  lines: AuctionLines;
}

/**
 * The enhancements a list of swaps brings into the build.
 *
 * A piece going into a slot that already holds that enhancement is not one: the build has it.
 *
 * @param swaps The swaps.
 * @return One item per piece to get, none owned.
 */
export function swapItems(swaps: readonly Swap[]): ShopItem[] {
  const out: ShopItem[] = [];
  for (const s of swaps) {
    for (const p of s.pieces) {
      if (s.before[p.slot] !== p.enh.boost) out.push({ boost: p.enh.boost, level: p.enh.ioLevel ?? null, owned: false });
    }
  }
  return out;
}

// each recipe file's entries by lower-case enhancement name, made once
const byName = new WeakMap<RecipeData, Map<string, RecipeDef>>();

/**
 * The dropped recipe that makes an item, at the item's level.
 *
 * @param gd Game data.
 * @param recipes The game version's recipes.
 * @param item The item.
 * @return The recipe, its level as the game shows it and the salvage it takes there; null when no
 *   recipe makes the piece at that level (the piece is bought whole).
 */
export function recipeOf(gd: GameData, recipes: RecipeData, item: ShopItem): { def: RecipeDef; level: number; salvage: number[] } | null {
  const boost = gd.powerById.get(item.boost);
  if (!boost || item.level === null) return null;
  let map = byName.get(recipes);
  if (!map) {
    map = new Map(Object.entries(recipes.recipes).map(([n, d]) => [n.toLowerCase(), d]));
    byName.set(recipes, map);
  }
  const def = map.get(boost.n.toLowerCase());
  const level = item.level + 1;
  if (!def || (def.lv && !def.lv.includes(level))) return null;
  const tier = def.t.find((t) => t[0] <= level && level <= t[1]);
  return tier ? { def, level, salvage: tier[2] } : null;
}

/**
 * What to type into the auction house's search for a name.
 *
 * The search splits its text on commas, so a name with one is searched by its longest part.
 *
 * @param name The name as the game shows it.
 * @return The search word.
 */
export function searchWord(name: string): string {
  const base = name.endsWith(RECIPE_SUFFIX) ? name.slice(0, -RECIPE_SUFFIX.length) : name;
  return base
    .split(',')
    .map((p) => p.trim())
    .reduce((a, b) => (b.length > a.length ? b : a), '');
}

/**
 * Names joined into auction house search lines.
 *
 * The search box takes AUCTION_SEARCH_MAX characters and lists every item whose name holds one of
 * the comma-separated words (uiAuction.c setSearchText), so the names go in as few lines as fit.
 *
 * @param names The names, in the order to list them; repeats are left out.
 * @param max The longest line.
 * @return The lines. A word longer than `max` gets a line of its own, cut to `max`.
 */
export function auctionLines(names: readonly string[], max: number = AUCTION_SEARCH_MAX): string[] {
  const lines: string[] = [];
  const seen = new Set<string>();
  let line = '';
  for (const name of names) {
    const word = searchWord(name).slice(0, max);
    if (!word || seen.has(word.toLowerCase())) continue;
    seen.add(word.toLowerCase());
    if (line && line.length + 2 + word.length > max) {
      lines.push(line);
      line = '';
    }
    line = line ? `${line}, ${word}` : word;
  }
  if (line) lines.push(line);
  return lines;
}

/**
 * Work out the shopping list.
 *
 * @param gd Game data.
 * @param recipes The game version's recipes; null while they load or when there are none (every
 *   piece is then listed as an enhancement to buy).
 * @param items The list's items.
 * @return The sets, the rows of what is still needed and the auction house search lines.
 */
export function shoppingList(gd: GameData, recipes: RecipeData | null, items: readonly ShopItem[]): ShoppingList {
  const sets = new Map<number, ShopSet>();
  const recipeRows = new Map<string, ShopRow>();
  const salvageCount = new Map<number, number>();
  const buyRows = new Map<number, ShopRow>();
  let unknown = 0;
  items.forEach((item, index) => {
    const boost = gd.powerById.get(item.boost);
    const ref = boost ? gd.boostSetOf.get(boost.id) : undefined;
    if (!boost || !ref) {
      unknown++;
      return;
    }
    let group = sets.get(ref.set.id);
    if (!group) sets.set(ref.set.id, (group = { set: ref.set, pieces: [] }));
    group.pieces.push({ index, item, boost });
    if (item.owned) return;
    const made = recipes ? recipeOf(gd, recipes, item) : null;
    if (!made) {
      const row = buyRows.get(boost.id);
      if (row) row.count++;
      else buyRows.set(boost.id, { key: String(boost.id), name: boost.dn, count: 1, rarity: 0, boost, at: item.level });
      return;
    }
    const key = `${boost.id}:${made.level}`;
    const row = recipeRows.get(key);
    if (row) row.count++;
    else recipeRows.set(key, { key, name: made.def.dn, count: 1, rarity: made.def.r, level: made.level, boost });
    for (const i of made.salvage) salvageCount.set(i, (salvageCount.get(i) ?? 0) + 1);
  });
  const byNameThenLevel = (a: ShopRow, b: ShopRow) => a.name.localeCompare(b.name) || (a.level ?? 0) - (b.level ?? 0);
  const recipeList = [...recipeRows.values()].sort(byNameThenLevel);
  const buy = [...buyRows.values()].sort(byNameThenLevel);
  const salvage = [...salvageCount]
    .map(([i, count]): ShopRow => {
      const [name, rarity, icon] = recipes!.salvage[i]!;
      return { key: String(i), name, count, rarity, icon };
    })
    .sort(byNameThenLevel);
  return {
    sets: [...sets.values()],
    recipes: recipeList,
    salvage,
    buy,
    unknown,
    lines: { recipes: auctionLines(recipeList.map((r) => r.name)), salvage: auctionLines(salvage.map((r) => r.name)), buy: auctionLines(buy.map((r) => r.name)) },
  };
}

/**
 * The auction house search for one enhancement alone: what the list would ask for if it held
 * only that piece.
 *
 * A crafted piece is its recipe and that recipe's salvage; a piece no recipe makes is itself.
 * Whether the player has marked it owned does not matter: they asked for this one.
 *
 * @param gd Game data.
 * @param recipes The game version's recipes; null while they load or when there are none.
 * @param item The enhancement and the level it is slotted at.
 * @return The search lines, each short enough for the search box (nearly always one); none for
 *   an enhancement this game data lacks or that is in no set.
 */
export function itemSearch(gd: GameData, recipes: RecipeData | null, item: Pick<ShopItem, 'boost' | 'level'>): string[] {
  const list = shoppingList(gd, recipes, [{ boost: item.boost, level: item.level, owned: false }]);
  return auctionLines([...list.recipes, ...list.salvage, ...list.buy].map((r) => r.name));
}
