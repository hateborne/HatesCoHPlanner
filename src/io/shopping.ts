/**
 * The set finder's shopping list as the browser keeps it (localStorage), until the player clears
 * it. It is never part of a build, a saved build or a link. Enhancement ids are a server's own, so
 * each server has its own list.
 */
import { SERVERS } from '../data/servers.ts';
import type { ShopItem } from '../engine/finder/shopping.ts';

export const SHOPPING_KEY = 'hcp.shopping';
// the most items a list keeps: far more than a build has slots, and little enough to read back at once
export const MAX_SHOP_ITEMS = 600;
// no enhancement level is higher (0-based 52 is the game's 53)
const MAX_LEVEL = 60;
// stored text past this is not a list this app wrote
const MAX_TEXT = 200_000;
// more servers than the planner will ever carry; lists past this are not kept
const MAX_SERVERS = 16;

/** One stored item: [enhancement id, 0-based level or -1 for none, 1 when owned]. */
type StoredItem = [number, number, number];

/**
 * One server's stored list, as items.
 *
 * Text from the browser's storage is not trusted: an entry that is not three whole numbers in
 * range is left out, and only the newest MAX_SHOP_ITEMS are kept (as when a list is written).
 *
 * @param list What is stored for the server.
 * @return The items, oldest first.
 */
function itemsOf(list: unknown): ShopItem[] {
  if (!Array.isArray(list)) return [];
  const whole = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);
  const out: ShopItem[] = [];
  // from the newest back, so a list longer than any this app writes costs no more to read
  for (let i = list.length - 1; i >= 0 && out.length < MAX_SHOP_ITEMS; i--) {
    const e: unknown = list[i];
    if (!Array.isArray(e) || e.length !== 3) continue;
    const [boost, level, owned] = e as unknown[];
    if (!whole(boost) || boost < 0 || boost > 0x7fffffff || !whole(level) || level < -1 || level > MAX_LEVEL || (owned !== 0 && owned !== 1)) continue;
    out.push({ boost, level: level < 0 ? null : level, owned: owned === 1 });
  }
  return out.reverse();
}

/**
 * Read what the browser holds, keeping only what has the stored form.
 *
 * The server names are text from storage too, so the lists are held in a Map (a name such as
 * "__proto__" is only a key there), and the planner's own servers are read first: names it does
 * not know can't crowd a real list out of the MAX_SERVERS kept.
 *
 * @return Each server's list, checked (empty when nothing readable is stored).
 */
function readAll(): Map<string, ShopItem[]> {
  const out = new Map<string, ShopItem[]>();
  try {
    const raw = localStorage.getItem(SHOPPING_KEY);
    if (!raw || raw.length > MAX_TEXT) return out;
    const d = JSON.parse(raw) as { v?: unknown; lists?: unknown } | null;
    if (!d || d.v !== 1 || !d.lists || typeof d.lists !== 'object' || Array.isArray(d.lists)) return out;
    const lists = new Map(Object.entries(d.lists as Record<string, unknown>));
    const known = SERVERS.map((s) => s.id).filter((id) => lists.has(id));
    const others = [...lists.keys()].filter((id) => !known.includes(id));
    for (const server of [...known, ...others].slice(0, MAX_SERVERS)) {
      const items = itemsOf(lists.get(server));
      if (items.length) out.set(server, items);
    }
  } catch {
    // no storage (private browsing) or text that is not JSON: no list
  }
  return out;
}

/**
 * The shopping list kept for a server.
 *
 * @param server The server's id.
 * @return The items, oldest first (see itemsOf for what is left out).
 */
export function readShopping(server: string): ShopItem[] {
  return readAll().get(server) ?? [];
}

/**
 * Keep a server's shopping list in the browser (an empty one removes it).
 *
 * The other servers' lists are written back as they were read, checked, so what is stored is
 * always text this app could have written.
 *
 * @param server The server's id.
 * @param items The items; only the newest MAX_SHOP_ITEMS are kept.
 * @return False when the browser would not store it.
 */
export function writeShopping(server: string, items: readonly ShopItem[]): boolean {
  try {
    const all = readAll();
    if (items.length) all.set(server, items.slice(-MAX_SHOP_ITEMS));
    else all.delete(server);
    if (!all.size) {
      localStorage.removeItem(SHOPPING_KEY);
      return true;
    }
    // no prototype, so every server name is a plain key of its own
    const lists = Object.create(null) as Record<string, StoredItem[]>;
    for (const [id, list] of all) lists[id] = list.map((i): StoredItem => [i.boost, i.level ?? -1, i.owned ? 1 : 0]);
    localStorage.setItem(SHOPPING_KEY, JSON.stringify({ v: 1, lists }));
    return true;
  } catch {
    return false;
  }
}
