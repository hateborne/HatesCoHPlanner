/**
 * Which server a share code opens on (shareServer in the store): the one its address names, else the
 * one its game version belongs to. Each server numbers its powers on its own, so a code must never
 * be read with another server's ids; and the planner is in production, so a link that opens today
 * must never fail because another server's files won't load. The version id's prefix tells its
 * server (versionServer), so nothing is downloaded to decide.
 */
import { readdirSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { INFO_FOLDER, PETS_FOLDER } from '../src/data/gamedata.ts';
import { DEFAULT_SERVER, serverById, SERVERS, versionServer } from '../src/data/servers.ts';
import { decodeShare } from '../src/io/share.ts';
import { shareServer } from '../src/state/store.ts';
import { dataDir, loadVersionIndex } from './helpers/data.ts';

const homecoming = serverById('homecoming')!;
const thunderspy = serverById('thunderspy')!;
const HC = loadVersionIndex();
const TS = loadVersionIndex('thunderspy');

// a real Blaster link made before links carried a version (the one tests/hardening.test.ts keeps)
const OLD = 'eJwdzMtOwkAAQNE71BmeIowUCgq0WCwVW-y6nX_T-Ds-EhUXJkYTF8b_MUaJojI5yV1eIQTSBe_egGKtRVT63mSlRbT1ucmHFpF61yI6L4ClESiBokKFGjXOCgfujERJGjRo0iTjxpRRZVq08FmQcWuqqCo-AQGLf9emjqrTocM-I0acFtvwm-_AW9jGaaPRvIa7sM5dlEuXLh4eIT95D6dHSMyF6aP6DBjYjc9LuAdf-RA1JCSyYi7NmNKYgOd0gppwYCVkPKVT5JRDK-ExnSFnxBxZD-kcOefYSrgyKazyE-APA8cpuQ';

let fetched: string[];
beforeEach(() => {
  fetched = [];
  // every download fails: deciding a code's server must not need one
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      fetched.push(url);
      return Promise.reject(new TypeError('Failed to fetch'));
    }),
  );
});
afterEach(() => {
  expect(fetched).toEqual([]);
  vi.unstubAllGlobals();
});

describe('the server a share code opens on', () => {
  it("opens a code at its own server's address", () => {
    expect(shareServer({ server: thunderspy }, TS.default)).toBe('thunderspy');
    expect(shareServer({ server: homecoming }, HC.default)).toBe('homecoming');
  });

  it('opens a bare code on the server its version belongs to', () => {
    expect(shareServer({}, TS.default)).toBe('thunderspy');
    expect(shareServer({}, HC.default)).toBe('homecoming');
  });

  it("refuses a code whose version is another server's than the address names", () => {
    expect(() => shareServer({ server: homecoming }, TS.default)).toThrow(/made on Thunderspy's game data/);
    expect(() => shareServer({ server: thunderspy }, HC.default)).toThrow(/made on Homecoming's game data/);
  });

  it('opens a Homecoming version the site no longer lists on Homecoming, with nothing downloaded', () => {
    // i28p3m (the approximate Issue 28, Page 3) was removed; its links open on the default with a note
    expect(HC.versions.some((v) => v.id === 'i28p3m')).toBe(false);
    expect(shareServer({}, 'i28p3m')).toBe('homecoming');
    expect(shareServer({ server: homecoming }, 'i28p3m')).toBe('homecoming');
  });

  it("reads an unknown version as its prefix's server, never with another's ids", () => {
    expect(shareServer({}, 'i99p9')).toBe('homecoming');
    expect(shareServer({}, 'ts99-9')).toBe('thunderspy');
    expect(() => shareServer({ server: thunderspy }, 'i99p9')).toThrow(/made on Homecoming's game data/);
    expect(() => shareServer({ server: homecoming }, 'ts99-9')).toThrow(/made on Thunderspy's game data/);
  });

  it("opens an older saved build's data id as Homecoming's", () => {
    expect(shareServer({}, '20261017-f94d0e09')).toBe('homecoming');
  });

  it('opens a link from before versions on its address, else Homecoming', async () => {
    const b = await decodeShare(OLD);
    expect(b.dataVersion).toBe('i28p4');
    expect(shareServer({}, b.dataVersion)).toBe('homecoming');
    expect(() => shareServer({ server: thunderspy }, b.dataVersion)).toThrow(/made on Homecoming's game data/);
    expect(shareServer({}, undefined)).toBeUndefined();
    expect(shareServer({ server: thunderspy }, undefined)).toBe('thunderspy');
  });
});

describe('version id prefixes', () => {
  it('give every published version, and every version folder, to its own server', () => {
    for (const s of SERVERS) {
      const index = loadVersionIndex(s.id);
      const folders = readdirSync(dataDir(s.id), { withFileTypes: true })
        // a server's pseudo-pet and info folders sit beside its version folders and are none
        .filter((d) => d.isDirectory() && d.name !== PETS_FOLDER && d.name !== INFO_FOLDER && !SERVERS.some((o) => o.data === `${s.data}${d.name}/`))
        .map((d) => d.name);
      for (const id of [...index.versions.map((v) => v.id), ...folders]) expect(versionServer(id).id, `${s.id}/${id}`).toBe(s.id);
    }
  });

  it('leave the default server without one and never overlap', () => {
    expect(serverById(DEFAULT_SERVER)!.versionPrefix).toBeUndefined();
    const prefixes = SERVERS.flatMap((s) => (s.versionPrefix ? [s.versionPrefix] : []));
    expect(prefixes.length).toBe(SERVERS.length - 1);
    for (const a of prefixes) for (const b of prefixes) if (a !== b) expect(b.startsWith(a), `${a} / ${b}`).toBe(false);
  });
});
