/**
 * The player's work is never replaced unasked, and a page load or link that fails leaves a way on:
 * - a build the browser still remembers while none is open (after the return question's server
 *   tile, or at another server's address) is asked about before a new build, an import, a saved
 *   build or a link pasted into the address bar replaces it, with a button that opens it instead;
 *   Escape and Enter stay;
 * - New Build's choices only start a build on the data they were made on;
 * - a failed load keeps the address (Try again reads the same link), a link refused for what it
 *   holds opens New Build on its own server, and a link pasted while the load's server question is
 *   open isn't held back by it;
 * - the logo's server list closes when a build opens behind it.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GameData } from '../src/data/gamedata.ts';
import { hasWork, newBuild, type Build } from '../src/engine/build.ts';
import { encodeShare } from '../src/io/share.ts';
import { LAST_USED_KEY, RETURN_AFTER } from '../src/state/lastUsed.ts';
import { loadData, pid, sid } from './helpers/data.ts';

const BASE = import.meta.env.BASE_URL; // the site base the store builds its addresses on ("/" under vitest)
const hc = loadData();
const ts = loadData(undefined, 'thunderspy');
const away = Date.now() - RETURN_AFTER - 60_000;
const LOADED = { timeout: 15_000 }; // a wait for a load that reads a whole server's game data
vi.setConfig({ testTimeout: 30_000 }); // some tests load both servers' game data

/** @return A Storage stand-in backed by a map. */
function memory(init: Record<string, string> = {}) {
  const m = new Map(Object.entries(init));
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), m };
}

/** @return A Blaster build on a server's data with one power picked (a build with work in it). */
function blaster(gd: GameData, name: string, power = 'Blaster_Ranged.Fire_Blast.Flares'): Build {
  const b = newBuild({
    server: gd.server,
    dataVersion: gd.core.manifest.dataVersion,
    name,
    at: gd.archetypeByName.get('class_blaster')!.id,
    origin: gd.core.origins[0]!.id,
    alignment: 'Hero',
    primary: sid(gd, 'Blaster_Ranged.Fire_Blast'),
    secondary: sid(gd, 'Blaster_Support.Fire_Manipulation'),
    pickCount: gd.core.schedule.power.length,
  });
  b.picks[0] = { power: pid(gd, power), level: 0, slots: [{ level: 0 }] };
  return b;
}

/** @return The name of the build a storage remembers ('' for none). */
const remembered = (s: ReturnType<typeof memory>) => (JSON.parse(s.getItem('hcp.current') ?? '{"name":""}') as Build).name;

// timers a test's store left running (the address sync, a notice's fade) are stopped after it, so
// they can't write a later test's address
const timers = new Set<ReturnType<typeof setTimeout>>();

afterEach(() => {
  for (const t of timers) clearTimeout(t);
  timers.clear();
  vi.unstubAllGlobals();
  vi.resetModules();
  vi.restoreAllMocks();
});

/**
 * Load the planner the way a browser would: the site's files served from public/ (the ones
 * `net.failing` matches fail), the given storage and address, and window events kept to fire.
 *
 * @param opts What the browser holds: the remembered build, the last use, the address.
 * @return The store module, the address, both storages, the network switch, the load and `fire`.
 */
async function visit(opts: { build?: Build; lastUsed?: number; path?: string; hash?: string; failing?: RegExp } = {}) {
  const local = memory({
    ...(opts.build ? { 'hcp.current': JSON.stringify(opts.build) } : {}),
    ...(opts.lastUsed !== undefined ? { [LAST_USED_KEY]: String(opts.lastUsed) } : {}),
  });
  const session = memory();
  const loc = { pathname: opts.path ?? BASE, hash: opts.hash ?? '', search: '' };
  const history = {
    state: null,
    replaceState: vi.fn((_s: unknown, _t: string, url: string) => {
      const at = url.indexOf('#');
      loc.pathname = (at < 0 ? url : url.slice(0, at)).split('?')[0]!;
      loc.hash = at < 0 ? '' : url.slice(at);
    }),
  };
  const handlers = new Map<string, (() => void)[]>();
  vi.stubGlobal('location', loc);
  vi.stubGlobal('localStorage', local);
  vi.stubGlobal('sessionStorage', session);
  vi.stubGlobal('history', history);
  vi.stubGlobal('window', {
    setTimeout: (fn: () => void, ms?: number) => {
      const t = setTimeout(() => {
        timers.delete(t);
        fn();
      }, ms);
      timers.add(t);
      return t;
    },
    clearTimeout: (t: ReturnType<typeof setTimeout>) => {
      timers.delete(t);
      clearTimeout(t);
    },
    addEventListener: (type: string, fn: () => void) => handlers.set(type, [...(handlers.get(type) ?? []), fn]),
    removeEventListener: () => undefined,
  });
  const net: { failing?: RegExp } = { failing: opts.failing };
  vi.stubGlobal('fetch', (url: string) => {
    const rel = String(url).split('?')[0]!.slice(BASE.length);
    if (net.failing?.test(rel)) return Promise.reject(new TypeError('Failed to fetch'));
    try {
      const body = readFileSync(join(process.cwd(), 'public', rel), 'utf-8');
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(JSON.parse(body) as unknown) });
    } catch {
      return Promise.resolve({ ok: false, status: 404, json: () => Promise.reject(new Error('404')) });
    }
  });
  vi.spyOn(console, 'error').mockImplementation(() => undefined); // failed loads log their details
  vi.resetModules();
  const mod = await import('../src/state/store.ts');
  const { useStore } = mod;
  const done = useStore.getState().load();
  await vi.waitFor(() => expect(useStore.getState().serverAsk !== null || useStore.getState().view !== 'loading').toBe(true), LOADED);
  const fire = (type: string) => handlers.get(type)?.forEach((f) => f());
  return { ...mod, loc, history, local, session, net, done, fire };
}

/** The return question after a long break, answered with a server tile: New Build, the build still remembered. */
async function afterTile(tile: string) {
  const v = await visit({ build: blaster(hc, 'Fire Guy'), lastUsed: away });
  expect(v.useStore.getState().serverAsk?.resume).toBeDefined();
  v.useStore.getState().closeServerAsk(tile);
  await v.done;
  expect([v.useStore.getState().view, v.useStore.getState().build]).toEqual(['setup', undefined]);
  expect(remembered(v.local)).toBe('Fire Guy'); // the browser's most recent build (this tab never held it)
  return v;
}

describe('hasWork', () => {
  it('counts a picked power or an enhancement in a granted slot, and nothing in a damaged build', () => {
    const b = blaster(hc, 'x');
    expect(hasWork(b)).toBe(true);
    b.picks[0] = null;
    expect(hasWork(b)).toBe(false);
    b.granted = { 1: { slots: [{ level: 0 }, { level: 2, enh: { boost: 5 } }] } };
    expect(hasWork(b)).toBe(true);
    for (const junk of [{ picks: 'x', granted: null }, { picks: [null], granted: { 1: null } }, { granted: { 1: { slots: 'x' } } }]) {
      expect(hasWork(junk as unknown as Build)).toBe(false);
    }
  });
});

describe("the dialog's three-way question", () => {
  it('answers ok or alt by its buttons, cancel by Escape, and replaced when a newer dialog takes its place', async () => {
    const { useStore } = await visit({ path: `${BASE}Homecoming/` });
    const q = { title: 'Q', text: 'T', okLabel: 'Start new', altLabel: 'Open it' };
    const answer = async (close: (st: ReturnType<typeof useStore.getState>) => void) => {
      const p = useStore.getState().askThreeWay(q);
      await vi.waitFor(() => expect(useStore.getState().confirm?.altLabel).toBe('Open it'));
      close(useStore.getState());
      return p;
    };
    expect(await answer((st) => st.closeConfirm(true))).toBe('ok');
    expect(await answer((st) => st.closeConfirm('alt'))).toBe('alt');
    expect(await answer((st) => st.closeConfirm(false))).toBe('cancel'); // Escape and Cancel
    // a newer dialog taking its place is no answer: 'replaced', so a caller can tell it from Cancel
    expect(await answer((st) => void st.askConfirm({ title: 'newer', text: '' }))).toBe('replaced');
    useStore.getState().closeConfirm(false);
    // a plain question has no second way: 'alt' leaves it open
    const plain = useStore.getState().askConfirm({ title: 'Plain', text: '' });
    useStore.getState().closeConfirm('alt');
    expect(useStore.getState().confirm?.title).toBe('Plain');
    useStore.getState().closeConfirm(false);
    expect(await plain).toBe(false);
  });
});

describe('a build the browser still remembers while none is open', () => {
  it('is asked about before something replaces it: Cancel keeps it, Open it opens it, Replace goes ahead', async () => {
    const v = await afterTile('thunderspy');
    const ask = () => v.askOverRemembered('Replace your last build?', 'Loading "Other"', 'Replace');
    // Cancel (and Escape, and Enter: Cancel has the focus) stays on New Build and keeps it
    let p = ask();
    await vi.waitFor(() => expect(v.useStore.getState().confirm?.title).toBe('Replace your last build?'));
    const c = v.useStore.getState().confirm!;
    expect(c.text).toBe('This browser still remembers your last build "Fire Guy". Loading "Other" replaces it. Open your last build to keep working on it, or to save it first (Saved builds / Import).');
    expect([c.okLabel, c.altLabel, c.cancelLabel]).toEqual(['Replace', 'Open it', undefined]);
    v.useStore.getState().closeConfirm(false);
    expect(await p).toBe('cancel');
    expect([v.useStore.getState().view, remembered(v.local), remembered(v.session)]).toEqual(['setup', 'Fire Guy', '']);
    // Replace: the caller goes ahead
    p = ask();
    await vi.waitFor(() => expect(v.useStore.getState().confirm).not.toBeNull());
    v.useStore.getState().closeConfirm(true);
    expect(await p).toBe('go');
    // Open it: the remembered build opens instead, on its own server
    p = ask();
    await vi.waitFor(() => expect(v.useStore.getState().confirm).not.toBeNull());
    v.useStore.getState().closeConfirm('alt');
    expect(await p).toBe('opened');
    expect([v.useStore.getState().view, v.useStore.getState().build?.name, v.useStore.getState().server]).toEqual(['overview', 'Fire Guy', 'homecoming']);
    // with a build open, the open build's own question is the caller's
    expect(await ask()).toBe('go');
    expect(v.useStore.getState().confirm).toBeNull();
  });

  it('asks nothing when the browser remembers no work', async () => {
    const v = await visit({ path: `${BASE}Homecoming/` });
    expect(v.useStore.getState().view).toBe('setup');
    expect(await v.askOverRemembered('t', 'w', 'ok')).toBe('go');
    // a build with no power picked can't be opened again (checkBuild refuses it): nothing to offer back
    const empty = blaster(hc, 'Empty');
    empty.picks[0] = null;
    empty.granted = { 1: { slots: [{ level: 0, enh: { boost: 5 } }] } };
    v.local.setItem('hcp.current', JSON.stringify(empty));
    expect(await v.askOverRemembered('t', 'w', 'ok')).toBe('go');
    expect(v.useStore.getState().confirm).toBeNull();
  });

  it('is asked about before a link pasted into the address bar replaces it', async () => {
    const v = await afterTile('homecoming');
    expect(v.loc.pathname).toBe(`${BASE}Homecoming/`);
    const other = await encodeShare(blaster(hc, 'Other', 'Blaster_Ranged.Fire_Blast.Fire_Blast'));
    // declined: New Build stays, the build stays remembered, and the address drops the link
    v.loc.hash = `#b=${other}`;
    v.fire('hashchange');
    await vi.waitFor(() => expect(v.useStore.getState().confirm?.title).toBe('Replace your last build?'));
    expect(v.useStore.getState().confirm?.text).toContain('Opening the link\'s build "Other" replaces it.');
    v.useStore.getState().closeConfirm(false);
    await vi.waitFor(() => expect(v.loc.hash).toBe(''));
    expect([v.useStore.getState().view, remembered(v.local), remembered(v.session)]).toEqual(['setup', 'Fire Guy', '']);
    // agreed: it opens
    v.loc.hash = `#b=${other}`;
    v.fire('hashchange');
    await vi.waitFor(() => expect(v.useStore.getState().confirm?.title).toBe('Replace your last build?'));
    v.useStore.getState().closeConfirm(true);
    await vi.waitFor(() => expect(v.useStore.getState().build?.name).toBe('Other'), LOADED);
    expect(remembered(v.local)).toBe('Other');
  });

  it("keeps a pasted link in the address when another dialog takes its question's place unanswered", async () => {
    const v = await afterTile('homecoming');
    const other = await encodeShare(blaster(hc, 'Other', 'Blaster_Ranged.Fire_Blast.Fire_Blast'));
    v.loc.hash = `#b=${other}`;
    v.fire('hashchange');
    await vi.waitFor(() => expect(v.useStore.getState().confirm?.title).toBe('Replace your last build?'));
    const told = v.useStore.getState().tell({ title: 'Something else', text: '' });
    await vi.waitFor(() => expect(v.useStore.getState().confirm?.title).toBe('Something else'));
    await new Promise((r) => setTimeout(r, 50));
    // nothing was decided: the link is still there, and the build still remembered
    expect([v.loc.hash, remembered(v.local), v.useStore.getState().build]).toEqual([`#b=${other}`, 'Fire Guy', undefined]);
    v.useStore.getState().closeConfirm(true);
    await told;
  });
});

describe('starting a build', () => {
  it("refuses choices that aren't in the data shown, in words, and starts one that is", async () => {
    const v = await visit({ path: `${BASE}Thunderspy/` });
    expect([v.useStore.getState().view, v.useStore.getState().server]).toEqual(['setup', 'thunderspy']);
    const at = ts.archetypeByName.get('class_blaster')!;
    const ok = { name: 'n', at: at.id, origin: ts.core.origins[0]!.id, alignment: 'Hero' as const, primary: sid(ts, 'Blaster_Ranged.Fire_Blast'), secondary: sid(ts, 'Blaster_Support.Fire_Manipulation') };
    for (const bad of [{ at: 999_999 }, { primary: ok.secondary }, { secondary: ok.primary }, { origin: 999_999 }]) {
      v.useStore.getState().startBuild({ ...ok, ...bad });
      expect(v.useStore.getState().view).toBe('setup');
      expect(v.useStore.getState().notice?.text).toBe('The game data changed while you chose: pick the archetype and power sets again.');
    }
    v.useStore.getState().startBuild(ok);
    expect([v.useStore.getState().view, v.useStore.getState().build?.server]).toEqual(['level', 'thunderspy']);
  });

  it("says in plain words when another server's data won't load", async () => {
    const v = await visit({ path: `${BASE}Homecoming/` });
    v.net.failing = /^data\/thunderspy\//;
    expect(await v.useStore.getState().selectServer('thunderspy')).toBe(false);
    expect(v.useStore.getState().notice?.text).toBe("Couldn't load Thunderspy's game data. Check your connection, then try again.");
    expect(v.useStore.getState().server).toBe('homecoming');
  });
});

describe('a page load whose link fails', () => {
  it('keeps the address on the error screen, so Try again opens a Thunderspy link at the site root', async () => {
    const code = await encodeShare(blaster(ts, 'Spy'));
    const v = await visit({ hash: `#b=${code}`, failing: /^data\/thunderspy\// });
    await v.done;
    expect(v.useStore.getState().view).toBe('error');
    expect([v.loc.pathname, v.loc.hash]).toEqual([BASE, `#b=${code}`]);
    // the network is back: Try again
    v.net.failing = undefined;
    v.useStore.setState({ view: 'loading' });
    await v.useStore.getState().load();
    expect([v.useStore.getState().view, v.useStore.getState().server, v.useStore.getState().build?.name]).toEqual(['overview', 'thunderspy', 'Spy']);
    await vi.waitFor(() => expect(v.loc.pathname).toBe(`${BASE}Thunderspy/`), LOADED);
  });

  it('opens New Build at once for a damaged link at the site root, as before servers, and says why', async () => {
    const v = await visit({ hash: '#b=AAAAnotacode' });
    await v.done;
    expect(v.useStore.getState().serverAsk).toBeNull();
    expect([v.useStore.getState().view, v.useStore.getState().server]).toEqual(['setup', 'homecoming']);
    expect(v.useStore.getState().confirm?.title).toBe("Couldn't open the share link");
    // kept for a reload to retry, on the address of the server it was read for
    expect([v.loc.pathname, v.loc.hash]).toEqual([`${BASE}Homecoming/`, '#b=AAAAnotacode']);
  });

  it("never opens an unknown server's link as Homecoming: the server list asks, as for any address naming none it carries", async () => {
    const code = await encodeShare(blaster(hc, 'Elsewhere'));
    const v = await visit({ path: `${BASE}Rebirth/`, hash: `#b=${code}` });
    expect(v.useStore.getState().serverAsk).not.toBeNull();
    expect(v.useStore.getState().build).toBeUndefined();
    v.useStore.getState().closeServerAsk('homecoming');
    await v.done;
    expect(v.useStore.getState().confirm?.title).toBe("Couldn't open the share link");
  });

  it('drops a damaged link from the address once a tile shows another server than the default', async () => {
    const v = await visit({ build: blaster(hc, 'Fire Guy'), lastUsed: away, hash: '#b=AAAAnotacode' });
    expect(v.useStore.getState().serverAsk?.resume).toBeDefined();
    v.useStore.getState().closeServerAsk('thunderspy');
    await v.done;
    expect([v.useStore.getState().view, v.useStore.getState().server]).toEqual(['setup', 'thunderspy']);
    expect([v.loc.pathname, v.loc.hash]).toEqual([`${BASE}Thunderspy/`, '']);
  });

  it("opens New Build on a refused link's own server, the link moved to that server's address", async () => {
    const bad = blaster(ts, 'Bad');
    bad.at = Math.max(...ts.core.archetypes.map((a) => a.id)) + 1; // no such archetype: checkBuild refuses it
    const code = await encodeShare(bad);
    const v = await visit({ hash: `#b=${code}` });
    await v.done;
    expect(v.useStore.getState().serverAsk).toBeNull();
    expect([v.useStore.getState().view, v.useStore.getState().server]).toEqual(['setup', 'thunderspy']);
    expect(v.useStore.getState().confirm?.title).toBe("Couldn't open the share link");
    await vi.waitFor(() => expect([v.loc.pathname, v.loc.hash]).toEqual([`${BASE}Thunderspy/`, `#b=${code}`]), LOADED);
  });

  it("opens a link pasted into the address bar while the first visit's server list is open", async () => {
    const v = await visit();
    expect(v.useStore.getState().serverAsk).not.toBeNull();
    const code = await encodeShare(blaster(hc, 'Sent'));
    v.loc.hash = `#b=${code}`;
    v.fire('hashchange');
    await v.done; // the load that asked stops there
    await vi.waitFor(() => expect(v.useStore.getState().build?.name).toBe('Sent'), LOADED);
    expect([v.useStore.getState().view, v.useStore.getState().serverAsk]).toEqual(['overview', null]);
  });

  it('opens a link pasted into the address bar while the return question is open', async () => {
    const v = await visit({ build: blaster(hc, 'Fire Guy'), lastUsed: away });
    expect(v.useStore.getState().serverAsk?.resume).toBeDefined();
    const code = await encodeShare(blaster(hc, 'Sent'));
    v.loc.hash = `#b=${code}`;
    v.fire('hashchange');
    await v.done;
    await vi.waitFor(() => expect(v.useStore.getState().build?.name).toBe('Sent'), LOADED);
    expect(v.useStore.getState().serverAsk).toBeNull();
  });
});

describe("the logo's server list", () => {
  it('closes when a build opens behind it', async () => {
    const v = await visit({ path: `${BASE}Homecoming/` });
    const list = v.useStore.getState().askServer(/*cancellable=*/ true, 'homecoming');
    expect(v.useStore.getState().serverAsk?.cancellable).toBe(true);
    await v.useStore.getState().openBuild(blaster(hc, 'From the address bar'));
    expect(v.useStore.getState().serverAsk).toBeNull();
    expect(await list).toBeNull();
  });

  it('closes when a dialog opens over it, so the dialog has the keys', async () => {
    const v = await visit({ path: `${BASE}Homecoming/` });
    const list = v.useStore.getState().askServer(/*cancellable=*/ true, 'homecoming');
    const told = v.useStore.getState().tell({ title: 'A message', text: '' });
    await vi.waitFor(() => expect(v.useStore.getState().confirm?.title).toBe('A message'));
    expect(v.useStore.getState().serverAsk).toBeNull();
    expect(await list).toBeNull();
    v.useStore.getState().closeConfirm(true);
    await told;
  });
});
