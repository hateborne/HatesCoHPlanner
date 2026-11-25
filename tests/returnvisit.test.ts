/**
 * A page load after a long break (4 hours without a click, key or wheel in any tab) asks which
 * server to use before reopening the player's own build, with a button that continues it. Within
 * the window, and for a link someone else sent, nothing changes: the build opens straight away.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NAME_MAX, newBuild, type Build } from '../src/engine/build.ts';
import { encodeShare } from '../src/io/share.ts';
import { LAST_USED_KEY, markUsed, RETURN_AFTER, returning, trackUse } from '../src/state/lastUsed.ts';
import { loadData, pid, sid } from './helpers/data.ts';
import { memory, visit } from './helpers/visit.ts';

const BASE = import.meta.env.BASE_URL; // the site base the store builds its addresses on ("/" under vitest)
const gd = loadData();

/** @return A Homecoming build with one power picked (one with none is nothing to open). */
function sample(name: string, power = 'Blaster_Ranged.Fire_Blast.Flares'): Build {
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
  b.picks[0] = { power: pid(gd, power), level: 0, slots: [{ level: 0 }] };
  return b;
}

describe('returning / markUsed', () => {
  const now = 1_800_000_000_000;
  const at = (t: number | string) => () => memory({ [LAST_USED_KEY]: String(t) });

  it('counts 4 hours or more without a use as a return', () => {
    expect(returning(now, at(now - RETURN_AFTER + 1))).toBe(false);
    expect(returning(now, at(now - 60_000))).toBe(false);
    expect(returning(now, at(now - RETURN_AFTER))).toBe(true);
    expect(returning(now, at(now - 7 * 60 * 60 * 1000))).toBe(true);
  });

  it('never counts an unknown, damaged or future time, or blocked storage, as a return', () => {
    // every player on the day this shipped has no time on record: their builds open as before
    expect(returning(now, () => memory())).toBe(false);
    for (const bad of ['', 'soon', '1e12', '-5', String(now + 10 * 60_000)]) expect(returning(now, at(bad)), bad).toBe(false);
    // blocked localStorage (sessionStorage may still hold the tab's build): no prompt on every reload
    expect(
      returning(now, () => {
        throw new DOMException('denied', 'SecurityError');
      }),
    ).toBe(false);
  });

  it('records a use', () => {
    const s = memory();
    markUsed(now, () => s);
    expect(returning(now + 1000, () => s)).toBe(false);
    expect(() =>
      markUsed(now, () => {
        throw new DOMException('denied', 'SecurityError');
      }),
    ).not.toThrow();
  });

  it('records input at once, then at most once a minute', () => {
    const s = memory();
    vi.stubGlobal('localStorage', s);
    try {
      const on = new Map<string, () => void>();
      let t = 1000;
      trackUse({ addEventListener: (type: string, fn: () => void) => void on.set(type, fn) } as unknown as Window, () => t);
      expect([...on.keys()].sort()).toEqual(['keydown', 'pointerdown', 'wheel']);
      on.get('pointerdown')!();
      t += 30_000;
      on.get('keydown')!();
      t += 31_000;
      on.get('wheel')!();
      expect(s.setItem.mock.calls.map((c) => c[1])).toEqual(['1000', '62000']);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('a page load after a long break', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  const away = Date.now() - RETURN_AFTER - 60_000;

  it('asks first, with the last build one button away, and Continue opens it', async () => {
    const { useStore, CONTINUE_BUILD, done } = await visit({ build: sample('Fire Guy'), lastUsed: away });
    const ask = useStore.getState().serverAsk!;
    expect(ask.cancellable).toBe(false);
    expect(ask.resume).toEqual({ build: 'Continue "Fire Guy"', server: 'on Homecoming' });
    expect(ask.preselect).toBe('homecoming');
    useStore.getState().closeServerAsk(CONTINUE_BUILD);
    await done;
    expect(useStore.getState().view).toBe('overview');
    expect(useStore.getState().build?.name).toBe('Fire Guy');
  });

  it('starts a new build on the picked server, keeping the last build remembered', async () => {
    const b = sample('Fire Guy');
    const { useStore, local, done } = await visit({ build: b, lastUsed: away, lastServer: 'thunderspy' });
    expect(useStore.getState().serverAsk?.preselect).toBe('thunderspy'); // the server last shown
    useStore.getState().closeServerAsk('thunderspy');
    await done;
    const s = useStore.getState();
    expect([s.view, s.server, s.build]).toEqual(['setup', 'thunderspy', undefined]);
    expect(JSON.parse(local.m.get('hcp.current')!)).toEqual(b);
  });

  it('reopens a build remembered from before the planner kept the time, with no question', async () => {
    const { useStore, done } = await visit({ build: sample('Old Build') });
    await done;
    expect(useStore.getState().serverAsk).toBeNull();
    expect(useStore.getState().build?.name).toBe('Old Build');
  });

  it('names an unnamed build plainly, and an untrusted name only as cleaned', async () => {
    const unnamed = await visit({ build: { ...sample(''), name: undefined } as unknown as Build, lastUsed: away });
    expect(unnamed.useStore.getState().serverAsk?.resume).toEqual({ build: 'Continue your last build', server: 'on Homecoming' });
    unnamed.useStore.getState().closeServerAsk(null);
    await unnamed.done;
    vi.unstubAllGlobals();
    const long = await visit({ build: sample(`${'N'.repeat(NAME_MAX)}${'x'.repeat(60)}`), lastUsed: away });
    expect(long.useStore.getState().serverAsk?.resume).toEqual({ build: `Continue "${'N'.repeat(NAME_MAX)}"`, server: 'on Homecoming' });
    long.useStore.getState().closeServerAsk(null);
    await long.done;
  });

  it('reopens the build at once within 4 hours', async () => {
    const { useStore, done } = await visit({ build: sample('Fire Guy'), lastUsed: Date.now() - RETURN_AFTER + 60_000 });
    await done;
    expect(useStore.getState().serverAsk).toBeNull();
    expect(useStore.getState().build?.name).toBe('Fire Guy');
  });

  it('opens a link someone sent straight away, however long the break', async () => {
    const theirs = sample('Their Build', 'Blaster_Ranged.Fire_Blast.Fire_Blast');
    const code = await encodeShare(theirs);
    const { useStore, done } = await visit({ build: sample('Fire Guy'), lastUsed: away, hash: `#b=${code}` });
    await done;
    expect(useStore.getState().serverAsk).toBeNull();
    expect(useStore.getState().build?.name).toBe('Their Build');
  });

  it("treats a reloaded tab's own link as the last build, and drops it from the address for a new build", async () => {
    const mine = sample('Fire Guy');
    const code = await encodeShare(mine);
    const { useStore, history, done } = await visit({ build: mine, lastUsed: away, path: `${BASE}Homecoming/`, hash: `#b=${code}` });
    expect(useStore.getState().serverAsk?.resume).toEqual({ build: 'Continue "Fire Guy"', server: 'on Homecoming' });
    useStore.getState().closeServerAsk('homecoming');
    await done;
    expect(useStore.getState().view).toBe('setup');
    expect(history.replaceState).toHaveBeenCalledWith(null, '', `${BASE}Homecoming/`);
  });

  it('offers nothing to continue for a build with no power picked yet', async () => {
    const b = sample('Empty');
    b.picks[0] = null;
    const { useStore, done } = await visit({ build: b, lastUsed: away });
    // the first-visit list, without Continue
    expect(useStore.getState().serverAsk?.resume).toBeUndefined();
    useStore.getState().closeServerAsk('homecoming');
    await done;
    expect(useStore.getState().view).toBe('setup');
  });

  it("drops a bare Thunderspy link that couldn't open once Homecoming is shown instead", async () => {
    const ts = loadData(undefined, 'thunderspy');
    const at = ts.archetypeByName.get('class_blaster')!;
    const b = newBuild({ dataVersion: ts.core.manifest.dataVersion, name: 'Spy', at: at.id, origin: ts.core.origins[0]!.id, alignment: 'Hero', primary: ts.setByName.get('blaster_ranged.fire_blast')!.id, secondary: ts.setByName.get('blaster_support.fire_manipulation')!.id, pickCount: ts.core.schedule.power.length });
    b.picks[0] = { power: ts.powerByName.get('blaster_ranged.fire_blast.flares')!.id, level: 0, slots: [{ level: 0 }] };
    const code = await encodeShare(b);
    // Thunderspy's list loads but its game data doesn't: the link can't open
    const { useStore, history, done } = await visit({ hash: `#b=${code}`, lastUsed: Date.now(), failing: /^data\/thunderspy\/ts/ });
    expect(useStore.getState().serverAsk).not.toBeNull();
    useStore.getState().closeServerAsk('homecoming');
    await done;
    expect([useStore.getState().view, useStore.getState().server]).toEqual(['setup', 'homecoming']);
    // the address keeps no Thunderspy code under a Homecoming address (a reload would refuse it)
    expect(history.replaceState).toHaveBeenCalledWith(null, '', BASE);
    expect(useStore.getState().confirm?.title).toMatch(/share link/i);
  });
});
