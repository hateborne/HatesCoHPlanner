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
  gate?: (rel: string) => Promise<void> | undefined; // a download waits for what this returns, if anything (and fails if given up meanwhile)
  answer?: (rel: string, text: string, signal: AbortSignal | undefined) => Response | undefined; // an answer of the test's own for a file (a body that stalls part way), else the file
  settle?: boolean; // wait for the load to settle or ask (default true; false when a gate holds it)
  before?: () => void; // run before the store is imported (vi.doMock)
}

/** @return A promise that fails, as a fetch does, once a download's signal says it was given up. */
function givenUp(signal: AbortSignal | undefined): Promise<never> {
  return new Promise<never>((_, reject) => {
    const fail = (): void => reject(new DOMException('The operation was aborted.', 'AbortError'));
    if (signal?.aborted) fail();
    else signal?.addEventListener('abort', fail);
  });
}

/**
 * Load the planner the way a browser would: the site's files served from public/, the given
 * storage, and the address given. Tests using it reset modules and unstub globals after each.
 *
 * @param opts What the browser holds: the remembered build, the last use, the address.
 * @return The store, the local storage, the history stand-in and the load's promise, once the load
 *   has settled or asked a question; and what was fetched, in order, with each request's signal
 *   and cache setting.
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
  const signals: (AbortSignal | undefined)[] = []; // what would cancel each download, in the order of `fetched`
  const caches: (RequestCache | undefined)[] = []; // how each was asked of the browser's cache, in the same order
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const rel = String(url).split('?')[0]!.slice(BASE.length);
    fetched.push(rel);
    signals.push(init?.signal ?? undefined);
    caches.push(init?.cache);
    const signal = init?.signal ?? undefined;
    const gate = opts.gate?.(rel);
    // as a browser's fetch does, a download given up while it waits fails at once
    if (gate) await Promise.race([gate, givenUp(signal)]);
    if (opts.failing?.test(rel)) return Promise.reject(new TypeError('Failed to fetch'));
    try {
      const body = readFileSync(join(process.cwd(), 'public', rel), 'utf-8');
      // a real answer, with a body the loader reads as a stream, as a browser's is
      return opts.answer?.(rel, body, signal) ?? new Response(body);
    } catch {
      return new Response('not found', { status: 404 });
    }
  });
  vi.resetModules();
  opts.before?.();
  const { useStore, CONTINUE_BUILD } = await import('../../src/state/store.ts');
  const { STALLED_MS, EXTRA_ASKS } = await import('../../src/data/watch.ts');
  const done = useStore.getState().load();
  // wait for the load to settle or to ask
  if (opts.settle !== false) await vi.waitFor(() => expect(useStore.getState().serverAsk !== null || useStore.getState().view !== 'loading').toBe(true));
  return { useStore, CONTINUE_BUILD, STALLED_MS, EXTRA_ASKS, local, history, done, fetched, signals, caches };
}
