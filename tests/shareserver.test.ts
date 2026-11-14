/**
 * Which server a share code opens on (shareServer in the store): the one its address names, else the
 * one its game version belongs to. Each server numbers its powers on its own, so a code must never
 * be read with another server's ids, even when a server's version list won't load.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { serverById } from '../src/data/servers.ts';
import { loadVersionIndex } from './helpers/data.ts';

const homecoming = serverById('homecoming')!;
const thunderspy = serverById('thunderspy')!;
const HC = loadVersionIndex();
const TS = loadVersionIndex('thunderspy');

let fetched: string[];
let down: Set<string>; // servers whose versions.json fails to load

/** Serve each server's versions.json as the site does (or fail it), and count the requests. */
function serve(url: string) {
  fetched.push(url);
  const ts = url.includes('/data/thunderspy/');
  if (down.has(ts ? 'thunderspy' : 'homecoming')) return Promise.reject(new TypeError('Failed to fetch'));
  return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(ts ? TS : HC) });
}

/** @return A fresh store module (its version lists are cached per page). */
async function store() {
  vi.resetModules();
  return import('../src/state/store.ts');
}

beforeEach(() => {
  fetched = [];
  down = new Set();
  vi.stubGlobal('fetch', vi.fn(serve));
});
afterEach(() => vi.unstubAllGlobals());

describe('the server a share code opens on', () => {
  it("opens a code at its own server's address after asking only that server", async () => {
    const { shareServer } = await store();
    await expect(shareServer({ server: thunderspy }, TS.default)).resolves.toBe('thunderspy');
    expect(fetched).toHaveLength(1);
    expect(fetched[0]).toContain('/data/thunderspy/versions.json');
  });

  it('opens a bare code on the server its version belongs to', async () => {
    const { shareServer } = await store();
    await expect(shareServer({}, TS.default)).resolves.toBe('thunderspy');
    await expect(shareServer({}, HC.default)).resolves.toBe('homecoming');
  });

  it("refuses a code whose version is another server's than the address names", async () => {
    const { shareServer } = await store();
    await expect(shareServer({ server: homecoming }, TS.default)).rejects.toThrow(/made on Thunderspy's game data/);
  });

  it("refuses a bare code it can't place while a version list won't load, never guessing Homecoming", async () => {
    const { shareServer } = await store();
    down.add('thunderspy');
    const p = shareServer({}, TS.default);
    await expect(p).rejects.toMatchObject({ name: 'ImportProblem' }); // a fresh module's class, so by name
    await expect(p).rejects.toThrow(/can't tell which server/);
  });

  it("still opens a code its address's server lists while another server's list is down", async () => {
    const { shareServer } = await store();
    down.add('thunderspy');
    await expect(shareServer({ server: homecoming }, HC.default)).resolves.toBe('homecoming');
  });

  it('leaves a version no server lists to the address, or Homecoming', async () => {
    const { shareServer } = await store();
    await expect(shareServer({}, 'i99p9')).resolves.toBeUndefined();
    await expect(shareServer({ server: thunderspy }, 'i99p9')).resolves.toBe('thunderspy');
  });

  it("opens an older saved build's data id as Homecoming's, even while another server's list is down", async () => {
    const { shareServer } = await store();
    down.add('thunderspy');
    await expect(shareServer({}, '20261017-f94d0e09')).resolves.toBe('homecoming');
  });

  it('refuses a link from before versions (Homecoming i28p4) at a Thunderspy address', async () => {
    const { shareServer } = await store();
    const { decodeShare } = await import('../src/io/share.ts');
    // a real Blaster link made before links carried a version (the one tests/hardening.test.ts keeps)
    const OLD = 'eJwdzMtOwkAAQNE71BmeIowUCgq0WCwVW-y6nX_T-Ds-EhUXJkYTF8b_MUaJojI5yV1eIQTSBe_egGKtRVT63mSlRbT1ucmHFpF61yI6L4ClESiBokKFGjXOCgfujERJGjRo0iTjxpRRZVq08FmQcWuqqCo-AQGLf9emjqrTocM-I0acFtvwm-_AW9jGaaPRvIa7sM5dlEuXLh4eIT95D6dHSMyF6aP6DBjYjc9LuAdf-RA1JCSyYi7NmNKYgOd0gppwYCVkPKVT5JRDK-ExnSFnxBxZD-kcOefYSrgyKazyE-APA8cpuQ';
    const b = await decodeShare(OLD);
    expect(b.dataVersion).toBe('i28p4');
    await expect(shareServer({}, b.dataVersion)).resolves.toBe('homecoming');
    await expect(shareServer({ server: thunderspy }, b.dataVersion)).rejects.toThrow(/made on Homecoming's game data/);
  });
});
