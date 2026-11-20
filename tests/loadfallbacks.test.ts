/**
 * What a page load does when something it needs fails: a remembered build or link whose server's
 * files won't download leaves the other servers a click away, a stored build the check can't read
 * no longer holds every later load on the error screen, the error screen speaks in plain words, and
 * a load started again (Try again on a slow load) is the only one that shows what it loaded.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { newBuild, toAlignment, type Build } from '../src/engine/build.ts';
import { checkBuild } from '../src/engine/validate.ts';
import { loadData, pid, sid } from './helpers/data.ts';
import { visit } from './helpers/visit.ts';

const gd = loadData();
const ts = loadData(undefined, 'thunderspy');

/** @return A Homecoming build with one power picked. */
function homecoming(name: string): Build {
  const b = newBuild({
    dataVersion: gd.core.manifest.dataVersion,
    name,
    at: gd.archetypeByName.get('class_blaster')!.id,
    origin: gd.core.origins[0]!.id,
    alignment: 'Hero',
    primary: sid(gd, 'Blaster_Ranged.Fire_Blast'),
    secondary: sid(gd, 'Blaster_Support.Fire_Manipulation'),
    pickCount: gd.core.schedule.power.length,
  });
  b.picks[0] = { power: pid(gd, 'Blaster_Ranged.Fire_Blast.Flares'), level: 0, slots: [{ level: 0 }] };
  return b;
}

/** @return A Thunderspy build with one power picked. */
function thunderspy(name: string): Build {
  const b = newBuild({
    dataVersion: ts.core.manifest.dataVersion,
    name,
    at: ts.archetypeByName.get('class_blaster')!.id,
    origin: ts.core.origins[0]!.id,
    alignment: 'Hero',
    primary: sid(ts, 'Blaster_Ranged.Fire_Blast'),
    secondary: sid(ts, 'Blaster_Support.Fire_Manipulation'),
    pickCount: ts.core.schedule.power.length,
  });
  b.picks[0] = { power: pid(ts, 'Blaster_Ranged.Fire_Blast.Flares'), level: 0, slots: [{ level: 0 }] };
  return { ...b, server: 'thunderspy' };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.doUnmock('../src/engine/validate.ts');
  vi.resetModules();
  vi.restoreAllMocks();
});

describe("a build whose server's files won't download", () => {
  it("leaves the other servers a click away when the remembered build's version list fails", async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const b = thunderspy('Spy Guy');
    const { useStore, local, done } = await visit({ build: b, failing: /^data\/thunderspy\/versions\.json$/ });
    // not the error screen: the server list, as when that version's data fails
    expect(useStore.getState().view).toBe('loading');
    expect(useStore.getState().serverAsk).not.toBeNull();
    useStore.getState().closeServerAsk('homecoming');
    await done;
    const s = useStore.getState();
    expect([s.view, s.server, s.build]).toEqual(['setup', 'homecoming', undefined]);
    expect(JSON.parse(local.m.get('hcp.current')!)).toEqual(b); // still remembered
  });

  it("shows the error screen in plain words when the address's own server won't load", async () => {
    const said = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { useStore, done } = await visit({ path: `${import.meta.env.BASE_URL}Thunderspy/`, failing: /^data\/thunderspy\/versions\.json$/ });
    await done;
    const { LOAD_FAILED } = await import('../src/state/store.ts');
    expect(useStore.getState().view).toBe('error');
    expect(useStore.getState().error).toBe(LOAD_FAILED);
    expect(useStore.getState().error).not.toMatch(/fetch|HTTP|undefined|function/i);
    expect(said).toHaveBeenCalled(); // the details are in the console
  });
});

describe('a stored build the check cannot read', () => {
  it('takes any value in a text field as it takes a missing one', () => {
    for (const bad of [5, {}, [], true, null, undefined]) expect(toAlignment(bad)).toBe('Hero');
    const b = { ...homecoming('Odd'), alignment: 5 } as unknown as Build;
    expect(checkBuild(gd, b).build?.alignment).toBe('Hero');
  });

  it('opens New Build and says so, instead of failing every load from then on', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const b = homecoming('Cursed');
    const { useStore, local, done } = await visit({
      build: b,
      // the check failing outright, whatever the cause: it is meant to refuse, never to throw
      before: () =>
        vi.doMock('../src/engine/validate.ts', () => ({
          checkBuild: () => {
            throw new TypeError('boom');
          },
        })),
    });
    // with no build to open, the site root asks which server, as on a first visit
    expect(useStore.getState().serverAsk).not.toBeNull();
    useStore.getState().closeServerAsk('homecoming');
    await done;
    const s = useStore.getState();
    expect([s.view, s.server, s.build]).toEqual(['setup', 'homecoming', undefined]);
    expect(s.confirm?.title).toBe("Couldn't open your last build");
    expect(s.confirm?.text).not.toContain('boom');
    expect(JSON.parse(local.m.get('hcp.current')!)).toEqual(b); // the planner removes nothing on its own
  });
});

describe('a share link pasted into the address while the page still loads', () => {
  it('is read once the load is done, as a link pasted into an open planner', async () => {
    let release = (): void => undefined;
    const held = new Promise<void>((r) => (release = r));
    // the remembered build's game data is still downloading
    const page = await visit({ build: homecoming('Mine'), gate: (rel) => (rel.endsWith('powers.json') ? held : undefined), settle: false });
    const { useStore, fetched } = page;
    await vi.waitFor(() => expect(fetched.some((f) => f.endsWith('powers.json'))).toBe(true));
    expect(useStore.getState().view).toBe('loading');
    const theirs = homecoming('Theirs');
    theirs.picks[1] = { power: pid(gd, 'Blaster_Support.Fire_Manipulation.Ring_of_Fire'), level: 0, slots: [{ level: 0 }] };
    const { encodeShare } = await import('../src/io/share.ts');
    const { readPastedLink } = await import('../src/state/store.ts');
    (location as { hash: string }).hash = `#b=${await encodeShare(theirs)}`;
    readPastedLink(); // the hashchange event
    expect(useStore.getState().view).toBe('loading'); // nothing to open it on yet
    release();
    await page.done;
    expect(useStore.getState().build?.name).toBe('Mine'); // the load opened what it had read
    // and then the pasted link is read: it asks before replacing a build with work
    await vi.waitFor(() => expect(useStore.getState().confirm?.title).toBe('Replace the current build?'), { timeout: 4000 });
    expect(useStore.getState().confirm?.text).toContain('"Theirs"');
  });
});

describe('a build the player asked to continue', () => {
  it("stops on the error screen when its server's version list fails, so Try again continues it", async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { RETURN_AFTER } = await import('../src/state/lastUsed.ts');
    const page = await visit({ build: thunderspy('Spy Guy'), lastUsed: Date.now() - RETURN_AFTER - 60_000, failing: /^data\/thunderspy\/versions\.json$/ });
    const { useStore, CONTINUE_BUILD, done } = page;
    expect(useStore.getState().serverAsk?.resume).toBeDefined(); // the return question
    useStore.getState().closeServerAsk(CONTINUE_BUILD);
    await done;
    // no "couldn't be opened" dialog over an error screen: just the error screen, as before
    expect([useStore.getState().view, useStore.getState().confirm]).toEqual(['error', null]);
  });
});

describe('two quick picks of a game version on New Build', () => {
  it('ends on the one picked last, however slowly the first one loads', async () => {
    let release = (): void => undefined;
    const held = new Promise<void>((r) => (release = r));
    const page = await visit({ path: `${import.meta.env.BASE_URL}Homecoming/`, gate: (rel) => (rel.startsWith('data/i28p3/') ? held : undefined) });
    await page.done;
    const { useStore } = page;
    const shown = () => useStore.getState().gd?.core.manifest.dataVersion;
    expect([useStore.getState().view, shown()]).toEqual(['setup', 'i28p4']);
    const older = useStore.getState().selectVersion('i28p3'); // still downloading...
    const back = useStore.getState().selectVersion('i28p4'); // ...when the first is picked again
    expect(await back).toBe(true);
    release();
    expect(await older).toBe(false);
    expect(shown()).toBe('i28p4');
    // and with nothing else picked since, a version does load
    expect(await useStore.getState().selectVersion('i28p3')).toBe(true);
    expect(shown()).toBe('i28p3');
  });
});

describe('loading again while a load still waits', () => {
  it('fetches afresh, and only the newest load shows what it loaded', async () => {
    let release = (): void => undefined;
    const held = new Promise<void>((r) => (release = r));
    const state = { hold: true };
    // the page's first downloads never answer (until released below)
    const page = await visit({ build: homecoming('Fire Guy'), gate: () => (state.hold ? held : undefined), settle: false });
    const { useStore, fetched } = page;
    await vi.waitFor(() => expect(fetched.length).toBeGreaterThan(0));
    expect(useStore.getState().view).toBe('loading');
    const first = fetched.length;
    // Try again: the downloads are fetched anew, not taken from the ones still waiting
    state.hold = false;
    useStore.getState().retryLoad();
    await vi.waitFor(() => expect(useStore.getState().view).toBe('overview'));
    expect(fetched.length).toBeGreaterThan(first);
    expect(useStore.getState().build?.name).toBe('Fire Guy');
    // the first load's downloads answer late: it shows nothing over what is on screen now
    useStore.setState({ view: 'setup', build: undefined });
    release();
    await page.done;
    await new Promise((r) => setTimeout(r, 20));
    expect([useStore.getState().view, useStore.getState().build]).toEqual(['setup', undefined]);
  });
});
