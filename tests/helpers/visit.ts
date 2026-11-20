import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, vi } from 'vitest';
import type { Build } from '../../src/engine/build.ts';
import { LAST_SERVER_KEY } from '../../src/state/lastServer.ts';
import { LAST_USED_KEY } from '../../src/state/lastUsed.ts';

// the site base the store builds its addresses on ("/" under vitest)
const BASE = import.meta.env.BASE_URL;

/** @return A Storage stand-in backed by a map. */
export function memory(init: Record<string, string> = {}) {
  const m = new Map(Object.entries(init));
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: vi.fn((k: string, v: string) => void m.set(k, v)),
    removeItem: (k: string) => void m.delete(k),
    m,
  };
}

/** What the browser holds when the planner's page loads. */
export interface Visit {
  build?: unknown; // the remembered build (hcp.current), as stored: anything
  lastUsed?: number; // the time of the last use
  path?: string; // the address's path (default: the site root)
  hash?: string; // the address's hash ("#b=...")
  lastServer?: string; // the server last shown
  failing?: RegExp; // files (paths under public/) whose download fails
  gate?: (rel: string) => Promise<void> | undefined; // a download waits for what this returns, if anything
  settle?: boolean; // wait for the load to settle or ask (default true; false when a gate holds it)
  before?: () => void; // run before the store is imported (vi.doMock)
}

/**
 * Load the planner the way a browser would: the site's files served from public/, the given
 * storage, and the address given. Tests using it reset modules and unstub globals after each.
 *
 * @param opts What the browser holds: the remembered build, the last use, the address.
 * @return The store, the local storage, the history stand-in and the load's promise, once the load
 *   has settled or asked a question.
 */
export async function visit(opts: Visit) {
  const local = memory({
    ...(opts.build !== undefined ? { 'hcp.current': JSON.stringify(opts.build as Build) } : {}),
    ...(opts.lastUsed !== undefined ? { [LAST_USED_KEY]: String(opts.lastUsed) } : {}),
    ...(opts.lastServer ? { [LAST_SERVER_KEY]: opts.lastServer } : {}),
  });
  const history = { state: null, replaceState: vi.fn() };
  vi.stubGlobal('location', { pathname: opts.path ?? BASE, hash: opts.hash ?? '', search: '' });
  vi.stubGlobal('localStorage', local);
  vi.stubGlobal('sessionStorage', memory());
  vi.stubGlobal('history', history);
  const fetched: string[] = [];
  vi.stubGlobal('fetch', async (url: string) => {
    const rel = String(url).split('?')[0]!.slice(BASE.length);
    fetched.push(rel);
    await opts.gate?.(rel);
    if (opts.failing?.test(rel)) return Promise.reject(new TypeError('Failed to fetch'));
    try {
      const body = readFileSync(join(process.cwd(), 'public', rel), 'utf-8');
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(JSON.parse(body) as unknown) });
    } catch {
      return Promise.resolve({ ok: false, status: 404, json: () => Promise.reject(new Error('404')) });
    }
  });
  vi.resetModules();
  opts.before?.();
  const { useStore, CONTINUE_BUILD } = await import('../../src/state/store.ts');
  const done = useStore.getState().load();
  // wait for the load to settle or to ask
  if (opts.settle !== false) await vi.waitFor(() => expect(useStore.getState().serverAsk !== null || useStore.getState().view !== 'loading').toBe(true));
  return { useStore, CONTINUE_BUILD, local, history, done, fetched };
}
