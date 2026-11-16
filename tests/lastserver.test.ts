/**
 * The server list remembers the server last shown in this browser: a visit with no build starts
 * with it highlighted (else the default), and its data starts loading while the list is open.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SERVER } from '../src/data/servers.ts';
import { LAST_SERVER_KEY, lastServer, rememberServer } from '../src/state/lastServer.ts';

/** @return A Storage stand-in backed by a map. */
function memory(init: Record<string, string> = {}) {
  const m = new Map(Object.entries(init));
  return { getItem: (k: string) => m.get(k) ?? null, setItem: vi.fn((k: string, v: string) => void m.set(k, v)), m };
}

/** A storage whose every access throws, as a browser with site data blocked does. */
const blocked = () => {
  throw new DOMException('denied', 'SecurityError');
};

describe('lastServer / rememberServer', () => {
  it('remembers a carried server and reads it back', () => {
    const s = memory();
    expect(lastServer(() => s)).toBeUndefined();
    rememberServer('thunderspy', () => s);
    expect(s.m.get(LAST_SERVER_KEY)).toBe('thunderspy');
    expect(lastServer(() => s)?.id).toBe('thunderspy');
  });

  it('writes only when the server changes', () => {
    const s = memory({ [LAST_SERVER_KEY]: 'homecoming' });
    rememberServer('homecoming', () => s);
    expect(s.setItem).not.toHaveBeenCalled();
  });

  it('ignores ids the site does not carry, written or read', () => {
    const s = memory({ [LAST_SERVER_KEY]: 'nowhere' });
    expect(lastServer(() => s)).toBeUndefined();
    rememberServer('rebirth', () => s);
    rememberServer('', () => s);
    expect(s.setItem).not.toHaveBeenCalled();
  });

  it('survives blocked storage', () => {
    expect(lastServer(blocked)).toBeUndefined();
    expect(() => rememberServer('thunderspy', blocked)).not.toThrow();
  });
});

describe('the server list on a visit with no build', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  /**
   * Load the site root with nothing remembered but (maybe) the last server, every data request failing.
   *
   * @param last The remembered server's id, if any.
   * @return The store and the URLs requested while the list is open.
   */
  async function visit(last?: string) {
    const fetched: string[] = [];
    vi.stubGlobal('location', { pathname: import.meta.env.BASE_URL, hash: '', search: '' });
    vi.stubGlobal('localStorage', memory(last ? { [LAST_SERVER_KEY]: last } : {}));
    vi.stubGlobal('fetch', (url: string) => {
      fetched.push(String(url));
      return Promise.reject(new TypeError('Failed to fetch'));
    });
    vi.resetModules();
    const { useStore } = await import('../src/state/store.ts');
    const done = useStore.getState().load();
    await vi.waitFor(() => expect(useStore.getState().serverAsk).not.toBeNull());
    await vi.waitFor(() => expect(fetched.length).toBeGreaterThan(0));
    return { useStore, fetched, done };
  }

  it('highlights the default and loads its data while the list is open', async () => {
    const { useStore, fetched, done } = await visit();
    expect(useStore.getState().serverAsk?.preselect).toBe(DEFAULT_SERVER);
    expect(fetched.every((u) => !u.includes('/data/thunderspy/'))).toBe(true);
    // a prefetch that failed is quiet: the pick loads again and says what went wrong
    useStore.getState().closeServerAsk(DEFAULT_SERVER);
    await done;
    expect(useStore.getState().view).toBe('error');
  });

  it('highlights the server last shown and loads its data instead', async () => {
    const { useStore, fetched, done } = await visit('thunderspy');
    expect(useStore.getState().serverAsk?.preselect).toBe('thunderspy');
    expect(fetched.every((u) => u.includes('/data/thunderspy/'))).toBe(true);
    useStore.getState().closeServerAsk('thunderspy');
    await done;
  });

  it('falls back to the default for a remembered server the site no longer carries', async () => {
    const { useStore, done } = await visit('nowhere');
    expect(useStore.getState().serverAsk?.preselect).toBe(DEFAULT_SERVER);
    useStore.getState().closeServerAsk(DEFAULT_SERVER);
    await done;
  });
});
