/**
 * The set finder's shopping list: the recipe file the pipeline decodes, what a list of pieces
 * needs (recipes, salvage, enhancements to buy), the auction house search lines, and the list as
 * the browser keeps it.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { checkRecipes, loadRecipes, OWN_PAGE_MARK, RECIPES_FOLDER, type RecipeData } from '../src/data/recipes.ts';
import { ioLevelRange } from '../src/engine/enhance.ts';
import type { Swap } from '../src/engine/finder/pending.ts';
import { AUCTION_SEARCH_MAX, auctionLines, recipeOf, searchWord, shoppingList, swapItems, type ShopItem } from '../src/engine/finder/shopping.ts';
import { MAX_SHOP_ITEMS, readShopping, SHOPPING_KEY, writeShopping } from '../src/io/shopping.ts';
import { dataDir, loadData, pid } from './helpers/data.ts';

const gd = loadData();
const version = gd.core.manifest.dataVersion;
const raw = (): unknown => JSON.parse(readFileSync(join(dataDir(), RECIPES_FOLDER, `${version}.json`), 'utf-8'));
const recipes = checkRecipes(raw())!;

const LOTG = pid(gd, 'Boosts.Crafted_Luck_of_the_Gambler_F.Crafted_Luck_of_the_Gambler_F');
const LOTG_A = pid(gd, 'Boosts.Crafted_Luck_of_the_Gambler_A.Crafted_Luck_of_the_Gambler_A');
const WINTER = pid(gd, 'Boosts.Attuned_Winters_Bite_A.Attuned_Winters_Bite_A');
const COMMON = pid(gd, 'Boosts.Crafted_Accuracy.Crafted_Accuracy');

/** @return An item not yet owned. */
const item = (boost: number, level: number | null, owned = false): ShopItem => ({ boost, level, owned });

describe('recipe file', () => {
  it('is one the app reads, for the default game version', () => {
    expect(recipes).not.toBeNull();
    expect(recipes.dataVersion).toBe(version);
    // the 108 pieces of invention salvage the game has
    expect(recipes.salvage).toHaveLength(108);
  });

  it('names only set pieces its game version has, and every crafted one at every level it is made at', () => {
    // every version that has a recipe file, against that version's own data
    const files = readdirSync(join(dataDir(), RECIPES_FOLDER)).filter((f) => f.endsWith('.json'));
    expect(files).toContain(`${version}.json`);
    for (const file of files) {
      const id = file.slice(0, -'.json'.length);
      const data = loadData(id);
      const file_ = checkRecipes(JSON.parse(readFileSync(join(dataDir(), RECIPES_FOLDER, file), 'utf-8')))!;
      expect(file_, id).not.toBeNull();
      expect(file_.dataVersion).toBe(id);
      const strangers = Object.keys(file_.recipes).filter((n) => {
        const boost = data.powerByName.get(n.toLowerCase());
        return !boost || !data.boostSetOf.get(boost.id);
      });
      expect(strangers, id).toEqual([]);
      const missing: string[] = [];
      for (const set of data.boostSetById.values()) {
        for (const boost of set.slots.flat()) {
          const range = ioLevelRange(data, data.power(boost));
          if (!range) continue;
          for (let level = range[0]; level <= range[1]; level++) {
            if (!recipeOf(data, file_, item(boost, level))) missing.push(`${data.power(boost).n} at ${level + 1}`);
          }
        }
      }
      expect(missing, id).toEqual([]);
    }
  });

  it('has an icon file for every salvage item', () => {
    const icons = join(process.cwd(), 'public', 'assets', 'icons', 'salvage');
    for (const [name, rarity, icon] of recipes.salvage) {
      expect(name.length, name).toBeGreaterThan(0);
      expect([1, 2, 3], name).toContain(rarity);
      expect(() => readFileSync(join(icons, `${icon}.png`)), name).not.toThrow();
    }
  });

  it('is refused when it is not of the shape the list reads', () => {
    const good = raw() as RecipeData;
    expect(checkRecipes(good)).not.toBeNull();
    expect(checkRecipes(null)).toBeNull();
    expect(checkRecipes({ ...good, v: 2 })).toBeNull();
    expect(checkRecipes({ ...good, salvage: 'x' })).toBeNull();
    expect(checkRecipes({ ...good, recipes: [] })).toBeNull();
    expect(checkRecipes({ ...good, salvage: [['Brass', 1]] })).toBeNull();
    // a salvage index past the salvage list would be read as nothing
    expect(checkRecipes({ ...good, recipes: { x: { dn: 'X', r: 1, t: [[10, 20, [good.salvage.length]]] } } })).toBeNull();
    expect(checkRecipes({ ...good, recipes: { x: { dn: 'X', r: 1, t: [[10, 20, [0]]], lv: ['10'] } } })).toBeNull();
    expect(checkRecipes({ ...good, recipes: { x: { dn: 'X', r: 1, t: [[10, 20, [0]]], lv: [10, 20] } } })).not.toBeNull();
    // a rarity the list has no colour for, and an icon name that is more than a name
    expect(checkRecipes({ ...good, recipes: { x: { dn: 'X', r: 5, t: [[10, 20, [0]]] } } })).toBeNull();
    expect(checkRecipes({ ...good, recipes: { x: { dn: 'X', r: 0, t: [[10, 20, [0]]] } } })).toBeNull();
    expect(checkRecipes({ ...good, salvage: [['Brass', 9, 'salvage_brass']], recipes: {} })).toBeNull();
    expect(checkRecipes({ ...good, salvage: [['Brass', 1, '../x']], recipes: {} })).toBeNull();
    expect(checkRecipes({ ...good, salvage: [['Brass', 1, 'salvage_brass']], recipes: {} })).not.toBeNull();
  });

  it('is downloaded from beside the version folders; none is not an error, a failed download is', async () => {
    const asked: string[] = [];
    vi.stubGlobal('fetch', async (url: string) => {
      asked.push(url);
      if (url.includes('i28p4') || url.includes('other')) return { ok: true, status: 200, json: async () => raw() };
      return { ok: false, status: url.includes('none') ? 404 : 503, json: async () => null };
    });
    try {
      expect((await loadRecipes('/x/data/', 'i28p4'))!.dataVersion).toBe('i28p4');
      expect(asked).toEqual([`/x/data/${RECIPES_FOLDER}/i28p4.json`]);
      // the site has none for that version
      expect(await loadRecipes('/x/data/', 'none')).toBeNull();
      // a dev server (or a local preview) answers a file it does not have with the site's own page
      const page = (html: string) => async () => ({
        ok: true,
        status: 200,
        headers: { get: (name: string) => (name.toLowerCase() === 'content-type' ? 'text/html; charset=utf-8' : null) },
        text: async () => html,
        json: async () => {
          throw new SyntaxError('not JSON');
        },
      });
      const own = readFileSync(join(process.cwd(), 'index.html'), 'utf-8');
      expect(own).toContain(OWN_PAGE_MARK);
      vi.stubGlobal('fetch', page(own));
      expect(await loadRecipes('/x/data/', 'i28p4')).toBeNull();
      // any other page is someone else's (a network's sign-in page): a failed download, never
      // "this version has no recipes"
      vi.stubGlobal('fetch', page('<html><body><form>Sign in to this network</form></body></html>'));
      await expect(loadRecipes('/x/data/', 'i28p4')).rejects.toThrow(/did not load/);
      vi.stubGlobal('fetch', async (url: string) => {
        asked.push(url);
        if (url.includes('other')) return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => raw() };
        return { ok: false, status: 503, json: async () => null };
      });
      await expect(loadRecipes('/x/data/', 'down')).rejects.toThrow(/did not load/);
      // another version's file under this version's name
      await expect(loadRecipes('/x/data/', 'other')).rejects.toThrow(/not in a form/);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('shopping list', () => {
  it('lists the pieces a swap brings in, not the ones the slot already holds', () => {
    const swap: Swap = {
      key: 'pick:0',
      power: 1,
      freeLevel: 0,
      set: 1,
      count: 3,
      pieces: [
        { slot: 0, enh: { boost: LOTG, ioLevel: 49 } },
        { slot: 1, enh: { boost: LOTG_A, ioLevel: 49 } },
        { slot: 2, enh: { boost: WINTER } },
      ],
      before: [null, LOTG_A, 7],
    };
    expect(swapItems([swap])).toEqual([item(LOTG, 49), item(WINTER, null)]);
  });

  it('finds the recipe at the level the piece is made at, with that level of salvage', () => {
    const low = recipeOf(gd, recipes, item(LOTG, 24))!;
    const high = recipeOf(gd, recipes, item(LOTG, 49))!;
    expect(low.level).toBe(25);
    expect(high.level).toBe(50);
    expect(high.def.dn).toBe('Luck of the Gambler: +7.5% Recharge Speed (Recipe)');
    expect(high.def.r).toBe(3);
    expect(high.salvage).toHaveLength(5);
    expect(low.salvage).not.toEqual(high.salvage);
    // below the set's first level, with no level, and a level a common IO does not come at
    expect(recipeOf(gd, recipes, item(LOTG, 10))).toBeNull();
    expect(recipeOf(gd, recipes, item(WINTER, null))).toBeNull();
    // a common IO is no set piece: the file has no recipe for it
    expect(recipeOf(gd, recipes, item(COMMON, 29))).toBeNull();
    // a recipe that does not come at every level between its first and last
    const gapped: RecipeData = { v: 1, dataVersion: version, salvage: [['Brass', 1, 'salvage_brass']], recipes: { [gd.power(LOTG).n]: { dn: 'X (Recipe)', r: 1, t: [[25, 35, [0]]], lv: [25, 30, 35] } } };
    expect(recipeOf(gd, gapped, item(LOTG, 29))?.level).toBe(30);
    expect(recipeOf(gd, gapped, item(LOTG, 30))).toBeNull();
  });

  it('adds up recipes, salvage and enhancements to buy, leaving out what is owned', () => {
    const list = shoppingList(gd, recipes, [item(LOTG, 49), item(LOTG, 49), item(LOTG, 24), item(LOTG_A, 49, /*owned=*/ true), item(WINTER, null), item(999_999_999, 49)]);
    // one bar per set, owned pieces included; an enhancement the data lacks is counted, not shown
    expect(list.sets.map((s) => [s.set.n, s.pieces.map((p) => p.index)])).toEqual([
      ['Luck_of_the_Gambler', [0, 1, 2, 3]],
      ['Winters_Bite', [4]],
    ]);
    expect(list.unknown).toBe(1);
    expect(list.recipes.map((r) => [r.name, r.level, r.count, r.rarity])).toEqual([
      ['Luck of the Gambler: +7.5% Recharge Speed (Recipe)', 25, 1, 3],
      ['Luck of the Gambler: +7.5% Recharge Speed (Recipe)', 50, 2, 3],
    ]);
    // five salvage per recipe: 2 x the level 50 list and 1 x the level 25 list
    expect(list.salvage.reduce((n, r) => n + r.count, 0)).toBe(15);
    const high = recipeOf(gd, recipes, item(LOTG, 49))!.salvage;
    for (const i of high) expect(list.salvage.find((r) => r.name === recipes.salvage[i]![0])!.count).toBeGreaterThanOrEqual(2);
    expect(list.salvage.every((r) => !!r.icon && r.rarity >= 1 && r.rarity <= 3)).toBe(true);
    expect(list.buy.map((r) => [r.name, r.count])).toEqual([["Winter's Bite: Accuracy/Damage", 1]]);
    expect(list.lines.recipes).toEqual(['Luck of the Gambler: +7.5% Recharge Speed']);
    expect(list.lines.buy).toEqual(["Winter's Bite: Accuracy/Damage"]);
    expect(list.lines.salvage.join(', ').split(', ').sort()).toEqual(list.salvage.map((r) => r.name).sort());
  });

  it('lists every piece as an enhancement when there are no recipes, and nothing when all is owned', () => {
    const none = shoppingList(gd, null, [item(LOTG, 49), item(WINTER, null)]);
    expect(none.recipes).toEqual([]);
    expect(none.salvage).toEqual([]);
    expect(none.buy.map((r) => r.count)).toEqual([1, 1]);
    const owned = shoppingList(gd, recipes, [item(LOTG, 49, /*owned=*/ true)]);
    expect(owned.sets).toHaveLength(1);
    expect([owned.recipes, owned.salvage, owned.buy]).toEqual([[], [], []]);
    expect(owned.lines).toEqual({ recipes: [], salvage: [], buy: [] });
  });

  it("writes search lines the auction house's search box takes", () => {
    expect(AUCTION_SEARCH_MAX).toBe(128);
    expect(auctionLines(['Sapphire', 'Clockwork Gear', 'Destiny', 'Hamidon Goo'])).toEqual(['Sapphire, Clockwork Gear, Destiny, Hamidon Goo']);
    // as many names as fit, none split, none twice
    const names = Array.from({ length: 30 }, (_, i) => `Salvage Number ${i}`);
    const lines = auctionLines([...names, 'salvage number 3']);
    expect(lines.every((l) => l.length <= AUCTION_SEARCH_MAX)).toBe(true);
    expect(lines.join(', ').split(', ')).toEqual(names);
    // no line could have taken the next line's first name
    for (let i = 0; i + 1 < lines.length; i++) expect(lines[i]!.length + 2 + lines[i + 1]!.split(', ')[0]!.length).toBeGreaterThan(AUCTION_SEARCH_MAX);
    expect(auctionLines(['ab', 'cd', 'ef'], 6)).toEqual(['ab, cd', 'ef']);
    expect(auctionLines(['abcdefgh'], 6)).toEqual(['abcdef']);
    expect(auctionLines([])).toEqual([]);
    // the search splits on commas, and "(Recipe)" would hide the crafted enhancement
    expect(searchWord('Some Set: Damage (Recipe)')).toBe('Some Set: Damage');
    expect(searchWord('Aura, for Pets (Recipe)')).toBe('for Pets');
    // every real name fits the box on its own
    for (const r of Object.values(recipes.recipes)) expect(searchWord(r.dn).length).toBeLessThanOrEqual(AUCTION_SEARCH_MAX);
  });
});

describe('shopping list in the browser', () => {
  let store: Map<string, string>;
  let broken = false;

  beforeEach(() => {
    store = new Map();
    broken = false;
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => {
        if (broken) throw new Error('no storage');
        return store.get(k) ?? null;
      },
      setItem: (k: string, v: string) => {
        if (broken) throw new Error('no storage');
        store.set(k, v);
      },
      removeItem: (k: string) => void store.delete(k),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('keeps a list per server and reads it back', () => {
    const list = [item(LOTG, 49), item(WINTER, null, /*owned=*/ true)];
    expect(writeShopping('homecoming', list)).toBe(true);
    expect(writeShopping('thunderspy', [item(5, 20)])).toBe(true);
    expect(readShopping('homecoming')).toEqual(list);
    expect(readShopping('thunderspy')).toEqual([item(5, 20)]);
    expect(readShopping('rebirth')).toEqual([]);
    // an empty list removes the server's, and the last one removes the key
    writeShopping('homecoming', []);
    expect(readShopping('homecoming')).toEqual([]);
    expect(readShopping('thunderspy')).toEqual([item(5, 20)]);
    writeShopping('thunderspy', []);
    expect(store.has(SHOPPING_KEY)).toBe(false);
  });

  it('keeps only the newest items past its limit, written or read', () => {
    const many = Array.from({ length: MAX_SHOP_ITEMS + 5 }, (_, i) => item(i, 49));
    writeShopping('homecoming', many);
    const back = readShopping('homecoming');
    expect(back).toHaveLength(MAX_SHOP_ITEMS);
    expect(back[0]!.boost).toBe(5);
    // a longer list written by something else: the same end of it
    store.set(SHOPPING_KEY, JSON.stringify({ v: 1, lists: { homecoming: many.map((i) => [i.boost, 49, 0]) } }));
    expect(readShopping('homecoming')).toEqual(back);
  });

  it("writes the other servers' lists back checked, and finds no list under an object's own names", () => {
    store.set(SHOPPING_KEY, JSON.stringify({ v: 1, lists: { thunderspy: [[5, 20, 0], 'junk', [6, 999, 0]], rebirth: 'junk' } }));
    writeShopping('homecoming', [item(LOTG, 49)]);
    expect(JSON.parse(store.get(SHOPPING_KEY)!)).toEqual({ v: 1, lists: { thunderspy: [[5, 20, 0]], homecoming: [[LOTG, 49, 0]] } });
    expect(readShopping('constructor')).toEqual([]);
    expect(readShopping('toString')).toEqual([]);
  });

  it("keeps the planner's own servers when stored text names many others", () => {
    // sixteen names nobody knows ahead of the real list, and one that would be an object's prototype
    const junk = Object.fromEntries(Array.from({ length: 16 }, (_, i) => [`junk${i}`, [[i, 1, 0]]]));
    store.set(SHOPPING_KEY, `{"v":1,"lists":{"__proto__":[[9,1,0]],${JSON.stringify(junk).slice(1, -1)},"homecoming":[[${LOTG},49,1]]}}`);
    expect(readShopping('homecoming')).toEqual([item(LOTG, 49, /*owned=*/ true)]);
    expect(readShopping('__proto__')).toEqual([item(9, 1)]);
    expect(readShopping('junk0')).toEqual([item(0, 1)]);
    // a write keeps the real list and at most sixteen in all
    writeShopping('thunderspy', [item(5, 20)]);
    const back = JSON.parse(store.get(SHOPPING_KEY)!) as { lists: Record<string, unknown> };
    expect(Object.keys(back.lists)).toContain('homecoming');
    expect(Object.keys(back.lists)).toContain('thunderspy');
    expect(Object.keys(back.lists).length).toBeLessThanOrEqual(17);
    expect(readShopping('homecoming')).toEqual([item(LOTG, 49, /*owned=*/ true)]);
  });

  it('trusts nothing it reads', () => {
    for (const text of ['', 'not json', '[]', '{"v":2,"lists":{"homecoming":[[1,2,0]]}}', '{"v":1,"lists":[]}', '{"v":1,"lists":{"homecoming":"x"}}']) {
      store.set(SHOPPING_KEY, text);
      expect(readShopping('homecoming'), text).toEqual([]);
    }
    store.set(SHOPPING_KEY, JSON.stringify({ v: 1, lists: { homecoming: [[1, 49, 0], [2, -1, 1], [3.5, 1, 0], [-1, 1, 0], [4, 99, 0], [5, 1, 2], ['6', 1, 0], [7, 1], null, [8, 0, 0, 0]] } }));
    expect(readShopping('homecoming')).toEqual([item(1, 49), item(2, null, /*owned=*/ true)]);
  });

  it('says so when the browser will not store it', () => {
    broken = true;
    expect(readShopping('homecoming')).toEqual([]);
    expect(writeShopping('homecoming', [item(LOTG, 49)])).toBe(false);
  });
});
