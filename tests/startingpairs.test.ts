/**
 * Primaries and secondaries a new character can't start with together (setsGoTogether). New Build
 * greys them as the character creator does, so the level-up wizard never opens on a level 1 with
 * nothing to pick, and builds that already hold such a pair still open as they are.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { GameData } from '../src/data/gamedata.ts';
import type { Archetype, Powerset } from '../src/data/types.ts';
import { newBuild, type Build } from '../src/engine/build.ts';
import { BuildRules, buildPairProblem, pairProblem, setFitsWith, setsGoTogether, startingLocks, startingSets } from '../src/engine/rules.ts';
import { checkBuild } from '../src/engine/validate.ts';
import { decodeShare } from '../src/io/share.ts';
import { PAIR_WARNING_TITLE, useStore, warnInvalidPair } from '../src/state/store.ts';
import { loadData, pid, sid } from './helpers/data.ts';

// a published version's data never changes, so its pairs stay as listed here
const gd = loadData('i28p4');
const arch = (name: string) => gd.archetypeByName.get(name.toLowerCase())!;
const set = (name: string) => gd.powerset(sid(gd, name));

// every pair Homecoming forbids: Shield Defense with the bladed and spiked melee sets
const SHIELD_PAIRS: { at: string; shield: string; melee: string[]; meleeIsPrimary: boolean }[] = [
  { at: 'Class_Tanker', shield: 'Tanker_Defense.Shield_Defense', melee: ['Claws', 'Dual_Blades', 'Katana', 'Spines', 'Staff_Fighting', 'Titan_Weapons'].map((n) => `Tanker_Melee.${n}`), meleeIsPrimary: false },
  { at: 'Class_Brute', shield: 'Brute_Defense.Shield_Defense', melee: ['Claws', 'Dual_Blades', 'Katana', 'Spines', 'Staff_Fighting', 'Titan_Weapons'].map((n) => `Brute_Melee.${n}`), meleeIsPrimary: true },
  { at: 'Class_Scrapper', shield: 'Scrapper_Defense.Shield_Defense', melee: ['Claws', 'Dual_Blades', 'Katana', 'Quills', 'Staff_Fighting', 'Titan_Weapons'].map((n) => `Scrapper_Melee.${n}`), meleeIsPrimary: true },
  { at: 'Class_Stalker', shield: 'Stalker_Defense.Shield_Defense', melee: ['Claws', 'Dual_Blades', 'Ninja_Sword', 'Spines', 'Staff_Fighting'].map((n) => `Stalker_Melee.${n}`), meleeIsPrimary: true },
];

/** @return Primary and secondary of a Shield Defense pair, in the archetype's order. */
const ordered = (g: (typeof SHIELD_PAIRS)[number], melee: string): [string, string] => (g.meleeIsPrimary ? [melee, g.shield] : [g.shield, melee]);

/**
 * Whether the level-up wizard can always make level 1's two picks: some primary power, and after
 * any of them some secondary power.
 *
 * @param data The game version's data.
 * @param at The archetype.
 * @param pri The primary.
 * @param sec The secondary.
 * @return True when no first pick leaves the second without a power.
 */
function wizardStarts(data: GameData, at: Archetype, pri: Powerset, sec: Powerset): boolean {
  const b = newBuild({ dataVersion: data.core.manifest.dataVersion, at: at.id, origin: data.core.origins[0]!.id, alignment: 'Hero', primary: pri.id, secondary: sec.id, pickCount: data.core.schedule.power.length });
  const r0 = new BuildRules(data, b);
  // level 1's picks: only powers available at level 1 can be taken
  const firsts = pri.p.filter((p, i) => pri.av[i] === 0 && r0.powerOption(p, 0).state === 'available');
  return (
    firsts.length > 0 &&
    firsts.every((first) => {
      const r = new BuildRules(data, { ...b, picks: b.picks.map((x, i) => (i === 0 ? { power: first, level: 0, slots: [{ level: 0 }] } : x)) });
      return sec.p.some((p, i) => sec.av[i] === 0 && r.powerOption(p, 1).state === 'available');
    })
  );
}

// the pairs each published version forbids besides SHIELD_PAIRS: Issue 28, Page 3 also kept Claws
// from Stone Armor (Page 4 dropped that)
const OTHER_PAIRS: Record<string, string[]> = {
  i28p4: [],
  i28p3: ['Brute_Melee.Claws + Brute_Defense.Stone_Armor', 'Tanker_Defense.Stone_Armor + Tanker_Melee.Claws'],
};

describe('setsGoTogether', () => {
  it.each(SHIELD_PAIRS.map((g) => [g.at, g] as const))("%s: Shield Defense can't go with the bladed and spiked melee sets", (_, g) => {
    for (const melee of g.melee) {
      const [pri, sec] = ordered(g, melee);
      expect(setsGoTogether(gd, arch(g.at), set(pri), set(sec)), `${pri} + ${sec}`).toBe(false);
      // both ways: the creator greys either set once the other is chosen
      expect(setFitsWith(gd, arch(g.at), set(melee), set(g.shield)), `${melee} with ${g.shield}`).toBe(false);
      expect(setFitsWith(gd, arch(g.at), set(g.shield), set(melee)), `${g.shield} with ${melee}`).toBe(false);
    }
  });

  it.each([
    ['Class_Tanker', 'Tanker_Defense.Shield_Defense', 'Tanker_Melee.Super_Strength'],
    ['Class_Brute', 'Brute_Melee.Super_Strength', 'Brute_Defense.Shield_Defense'],
    ['Class_Scrapper', 'Scrapper_Melee.Broad_Sword', 'Scrapper_Defense.Shield_Defense'],
    ['Class_Stalker', 'Stalker_Melee.Broad_Sword', 'Stalker_Defense.Shield_Defense'],
  ])('%s: %s goes with %s', (at, pri, sec) => {
    expect(setsGoTogether(gd, arch(at), set(pri), set(sec))).toBe(true);
    expect(setFitsWith(gd, arch(at), set(pri), set(sec))).toBe(true);
    expect(setFitsWith(gd, arch(at), set(sec), set(pri))).toBe(true);
  });

  it.each(Object.keys(OTHER_PAIRS))('%s: forbids no other pair New Build offers', (v) => {
    const data = loadData(v);
    const want = [...SHIELD_PAIRS.flatMap((g) => g.melee.map((m) => ordered(g, m).join(' + '))), ...OTHER_PAIRS[v]!].sort();
    const got: string[] = [];
    for (const at of data.core.archetypes) {
      for (const p of startingSets(data, at.cats.pri, at)) {
        for (const s of startingSets(data, at.cats.sec, at)) if (!setsGoTogether(data, at, p, s)) got.push(`${p.n} + ${s.n}`);
      }
    }
    expect(got.sort()).toEqual(want);
  });

  // the wizard's check builds the level-up rules for every first pick, so it is slow: every pair of
  // the default version, and an older version's archetypes whose pairs differ from it (its data
  // never changes, and the forbidden lists above pin the rest)
  const SWEEP: Record<string, string[] | undefined> = { i28p4: undefined, i28p3: ['Class_Brute', 'Class_Tanker'] };
  it.each(Object.keys(SWEEP))("%s: agrees with the level-up wizard's level-1 picks for the pairs swept", (v) => {
    const data = loadData(v);
    const only = SWEEP[v]?.map((n) => n.toLowerCase());
    const bad: string[] = [];
    for (const at of data.core.archetypes.filter((a) => !only || only.includes(a.n.toLowerCase()))) {
      for (const p of startingSets(data, at.cats.pri, at)) {
        for (const s of startingSets(data, at.cats.sec, at)) {
          const fits = setsGoTogether(data, at, p, s);
          if (fits !== wizardStarts(data, at, p, s)) bad.push(`${p.n} + ${s.n}: setsGoTogether says ${fits}`);
        }
      }
    }
    expect(bad).toEqual([]);
  }, 120_000);
});

describe("New Build's greyed sets (startingLocks)", () => {
  const at = arch('Class_Tanker');
  const pris = startingSets(gd, at.cats.pri, at);
  const secs = startingSets(gd, at.cats.sec, at);
  const shield = set('Tanker_Defense.Shield_Defense');
  const blades = set('Tanker_Melee.Dual_Blades');
  const tanker = SHIELD_PAIRS.find((g) => g.at === 'Class_Tanker')!;
  const names = (locks: Map<number, string>) => [...locks.keys()].map((id) => gd.powerset(id).n).sort();

  it('greys nothing until a set is chosen', () => {
    expect(startingLocks(gd, at, pris, secs).size).toBe(0);
  });

  it('greys the secondaries that clash with the chosen primary, saying why', () => {
    const locks = startingLocks(gd, at, pris, secs, shield);
    expect(names(locks)).toEqual([...tanker.melee].sort());
    expect(locks.get(blades.id)).toBe("Can't be taken with Shield Defense");
  });

  it('greys the primaries that clash with the chosen secondary', () => {
    const locks = startingLocks(gd, at, pris, secs, undefined, blades);
    expect(names(locks)).toEqual(['Tanker_Defense.Shield_Defense']);
    expect(locks.get(shield.id)).toBe("Can't be taken with Dual Blades");
  });

  it('a chosen pair that clashes greys the secondary only (it counts as none chosen)', () => {
    const locks = startingLocks(gd, at, pris, secs, shield, blades);
    expect(names(locks)).toEqual([...tanker.melee].sort());
    expect(locks.has(shield.id)).toBe(false);
  });

  it('greys nothing for a pair that goes together', () => {
    expect(startingLocks(gd, at, pris, secs, set('Tanker_Defense.Invulnerability'), set('Tanker_Melee.Super_Strength')).size).toBe(0);
  });

  it('a chosen primary greyed by a one-way clash greys no secondary (it counts as none chosen)', () => {
    // no Homecoming pair clashes one way only: Dual Blades with Super Strength's powers, which don't
    // forbid Shield Defense, while Shield Defense's forbid Dual Blades
    const ss = set('Tanker_Melee.Super_Strength');
    const oneWay: Powerset = { ...blades, p: ss.p, av: ss.av };
    const offered = secs.map((s) => (s.id === blades.id ? oneWay : s));
    expect(setFitsWith(gd, at, shield, oneWay)).toBe(false);
    expect(setFitsWith(gd, at, oneWay, shield)).toBe(true);
    const locks = startingLocks(gd, at, pris, offered, shield, oneWay);
    expect(names(locks)).toEqual(['Tanker_Defense.Shield_Defense']);
    expect(locks.get(shield.id)).toBe("Can't be taken with Dual Blades");
    expect(pairProblem(gd, at, shield, oneWay)).toBe("Shield Defense can't be taken with Dual Blades");
  });
});

describe('New Build reads requirements as the level-up screens do', () => {
  const at = arch('Class_Tanker');
  const shield = set('Tanker_Defense.Shield_Defense');
  const ss = set('Tanker_Melee.Super_Strength');
  const origin = (n: string) => gd.core.origins.find((o) => o.n === n)!.id;
  /** @return Whether the level-up wizard's first pick could take a power of `sec` (BuildRules.newSetBlock). */
  const wizard = (sec: Powerset, o: number) =>
    new BuildRules(gd, newBuild({ dataVersion: 'i28p4', at: at.id, origin: o, alignment: 'Hero', primary: shield.id, secondary: sec.id, pickCount: gd.core.schedule.power.length })).newSetBlock(sec, 0) === null;

  it.each([
    ['$archtype (as the data writes it)', ['$archtype', '@Class_Tanker', '=='], 'Science', true],
    ['another archetype', ['$archtype', '@Class_Blaster', '=='], 'Science', false],
    ['the origin chosen', ['$origin', '@Magic', '=='], 'Magic', true],
    ['another origin', ['$origin', '@Magic', '=='], 'Science', false],
  ] as const)('a SetBuyRequires on %s', (_, sbr, o, want) => {
    const gated: Powerset = { ...ss, sbr: [...sbr] };
    expect(setFitsWith(gd, at, gated, shield, { origin: origin(o), alignment: 'Hero' })).toBe(want);
    expect(wizard(gated, origin(o))).toBe(want);
  });
});

describe('pairProblem', () => {
  it('names the set New Build greys: the secondary when it clashes with the primary', () => {
    expect(pairProblem(gd, arch('Class_Tanker'), set('Tanker_Defense.Shield_Defense'), set('Tanker_Melee.Dual_Blades'))).toBe("Dual Blades can't be taken with Shield Defense");
    expect(pairProblem(gd, arch('Class_Brute'), set('Brute_Melee.Claws'), set('Brute_Defense.Shield_Defense'))).toBe("Shield Defense can't be taken with Claws");
  });

  it('says nothing for a pair that goes together', () => {
    expect(pairProblem(gd, arch('Class_Tanker'), set('Tanker_Defense.Shield_Defense'), set('Tanker_Melee.Super_Strength'))).toBeNull();
  });

  it("blames no set for one that can't start a build on its own (a staff-only set)", () => {
    // every Homecoming set can start a build on its own: Super Strength made staff-only, as a server
    // may hide a set through its powers' BuyRequires
    const at = arch('Class_Tanker');
    const shield = set('Tanker_Defense.Shield_Defense');
    const staff: Powerset = { ...set('Tanker_Melee.Super_Strength'), sbr: ['accesslevel', 'char>', '0', '>'] };
    expect(setFitsWith(gd, at, staff)).toBe(false);
    expect(setsGoTogether(gd, at, shield, staff)).toBe(false);
    expect(pairProblem(gd, at, shield, staff)).toBeNull();
    expect(startingLocks(gd, at, [shield], [staff], shield, staff).size).toBe(0);
  });
});

// made before New Build greyed the pair: Tanker Shield Defense + Dual Blades, named "Shield and
// blades", with Active Defense and Light Opening picked at level 1
const LINK = 'eJxj5GZk2Mi8i1kwOCMzNSdFITEvRSEpJzEltZhB4qEUAwMjA0MDhMIFWDONLApMGAATNAry';

describe('the warning such a build opens with (warnInvalidPair)', () => {
  let old: Build; // the old link's build, as the planner opens it (decoded on the real clock)
  beforeAll(async () => {
    old = checkBuild(gd, await decodeShare(LINK)).build!;
  });
  /**
   * A test that opens a build on a faked clock, put back before the test ends: vitest's own
   * timeouts and hooks run on the real one.
   *
   * @param build The build to open (a getter: the old link's build is decoded before the tests).
   * @param body The test.
   * @return The test function.
   */
  const opening = (build: () => Build, body: () => void) => () => {
    vi.useFakeTimers();
    try {
      useStore.setState({ gd, confirm: null, build: build() });
      body();
    } finally {
      vi.useRealTimers();
      useStore.setState({ confirm: null, build: undefined });
    }
  };

  it('names the clash, and its OK stays locked for 5 seconds', opening(() => old, () => {
    expect(buildPairProblem(gd, old)).toBe("Dual Blades can't be taken with Shield Defense");
    warnInvalidPair();
    vi.advanceTimersByTime(0);
    const c = useStore.getState().confirm!;
    expect(c.title).toBe(PAIR_WARNING_TITLE);
    expect(c.text.startsWith("Dual Blades can't be taken with Shield Defense. The game won't start a character")).toBe(true);
    useStore.getState().closeConfirm(true); // OK and Escape both close through closeConfirm
    expect(useStore.getState().confirm).toBe(c);
    vi.advanceTimersByTime(4999);
    useStore.getState().closeConfirm(false);
    expect(useStore.getState().confirm).toBe(c);
    vi.advanceTimersByTime(1);
    useStore.getState().closeConfirm(true);
    expect(useStore.getState().confirm).toBeNull();
  }));

  it('waits for a message the opening shows first (an import with gaps)', opening(() => old, () => {
    warnInvalidPair();
    void useStore.getState().tell({ title: 'Imported, with gaps', text: 'Some of it could not be brought over.' });
    vi.advanceTimersByTime(0);
    expect(useStore.getState().confirm?.title).toBe('Imported, with gaps');
    useStore.getState().closeConfirm(true);
    expect(useStore.getState().confirm?.title).toBe(PAIR_WARNING_TITLE);
  }));

  it('shows once when the same build opens twice (React dev double mount)', opening(() => old, () => {
    warnInvalidPair();
    warnInvalidPair();
    vi.advanceTimersByTime(0);
    useStore.setState({ build: { ...old } });
    warnInvalidPair(); // a second open after the first already shows
    vi.advanceTimersByTime(5000);
    expect(useStore.getState().confirm?.title).toBe(PAIR_WARNING_TITLE);
    useStore.getState().closeConfirm(true);
    vi.advanceTimersByTime(0);
    expect(useStore.getState().confirm).toBeNull();
  }));

  const fits = () => {
    const at = arch('Class_Tanker');
    return newBuild({ dataVersion: 'i28p4', at: at.id, origin: gd.core.origins[0]!.id, alignment: 'Hero', primary: sid(gd, 'Tanker_Defense.Shield_Defense'), secondary: sid(gd, 'Tanker_Melee.Super_Strength'), pickCount: gd.core.schedule.power.length });
  };
  it('says nothing for a build whose sets go together', opening(fits, () => {
    warnInvalidPair();
    vi.advanceTimersByTime(0);
    expect(useStore.getState().confirm).toBeNull();
  }));

  it('a dialog asked for during the countdown waits for it to close, then shows as it would have', async () => {
    vi.useFakeTimers();
    try {
      useStore.setState({ gd, confirm: null, build: old });
      warnInvalidPair();
      vi.advanceTimersByTime(0);
      const warning = useStore.getState().confirm!;
      expect(warning.title).toBe(PAIR_WARNING_TITLE);
      // a share link pasted meanwhile asks first; a bad one says so
      const asked = useStore.getState().askConfirm({ title: 'Replace the current build?', text: 'The link opens another build.' });
      const told = useStore.getState().tell({ title: "The share link couldn't be opened", text: 'It is cut short.' });
      await Promise.resolve();
      expect(useStore.getState().confirm).toBe(warning);
      vi.advanceTimersByTime(5000);
      expect(useStore.getState().confirm).toBe(warning); // unlocked, up until it is closed
      useStore.getState().closeConfirm(true);
      // then the newer replaces the older, as it always has (the question answered no)
      expect(await asked).toBe(false);
      expect(useStore.getState().confirm?.title).toBe("The share link couldn't be opened");
      useStore.getState().closeConfirm(true);
      await told;
      expect(useStore.getState().confirm).toBeNull();
    } finally {
      vi.useRealTimers();
      useStore.setState({ confirm: null, build: undefined });
    }
  });
});

describe('a build that already holds a forbidden pair', () => {

  it('still opens as it is, its level-1 picks flagged', async () => {
    const raw = await decodeShare(LINK);
    const { build, fixes } = checkBuild(gd, raw);
    // its only change: it ends at level 1, as every build with nothing picked past level 1 does
    expect(fixes).toEqual(['unfinished build: stopped at level 1']);
    expect(build).toEqual({ ...raw, endLevel: 0 });
    expect(build!.name).toBe('Shield and blades');
    expect(build!.at).toBe(arch('Class_Tanker').id);
    expect(build!.primary).toBe(sid(gd, 'Tanker_Defense.Shield_Defense'));
    expect(build!.secondary).toBe(sid(gd, 'Tanker_Melee.Dual_Blades'));
    expect(build!.picks[0]?.power).toBe(pid(gd, 'Tanker_Defense.Shield_Defense.Active_Defense'));
    expect(build!.picks[1]?.power).toBe(pid(gd, 'Tanker_Melee.Dual_Blades.Light_Opening'));
    const issues = new BuildRules(gd, build!).issues();
    expect(issues.filter((x) => x.key === 'pick:0' || x.key === 'pick:1').map((x) => x.message)).toEqual(['No powers available yet', 'No powers available yet']);
  });
});

/** Serve the site's data files (public/data) to the store's fetches, as the site does. */
function serveData(): void {
  vi.stubGlobal('fetch', async (url: string | URL) => {
    const path = String(url).split('?')[0]!.replace(/^.*?\/data\//, '');
    return new Response(readFileSync(join(process.cwd(), 'public', 'data', path)));
  });
}

/** @return After timers already due (the warning waits one turn of the event loop). */
const tick = () => new Promise((r) => setTimeout(r, 0));

describe('links made before this change open the same build (load, openBuild)', () => {
  // the user's Blaster link, made before links carried a game version (tests/hardening.test.ts)
  const BLASTER =
    'eJwdzMtOwkAAQNE71BmeIowUCgq0WCwVW-y6nX_T-Ds-EhUXJkYTF8b_MUaJojI5yV1eIQTSBe_egGKtRVT63mSlRbT1ucmHFpF61yI6L4ClESiBokKFGjXOCgfujERJGjRo0iTjxpRRZVq08FmQcWuqqCo-AQGLf9emjqrTocM-I0acFtvwm-_AW9jGaaPRvIa7sM5dlEuXLh4eIT95D6dHSMyF6aP6DBjYjc9LuAdf-RA1JCSyYi7NmNKYgOd0gppwYCVkPKVT5JRDK-ExnSFnxBxZD-kcOefYSrgyKazyE-APA8cpuQ';
  // each link with the build the planner opened for it before this change, and whether it warns now
  const links = [
    { name: 'Blaster', code: BLASTER, warns: false },
    { name: 'Shield and blades', code: LINK, warns: true },
  ];
  const reset = () => useStore.setState({ confirm: null, build: undefined, view: 'loading' });
  afterEach(() => {
    vi.unstubAllGlobals();
    reset();
  });

  // the site's addresses under the tests' base (the site's is /HatesCoHPlanner/)
  const base = import.meta.env.BASE_URL;
  it.each([
    ['the root address', base],
    ["Homecoming's address", `${base}Homecoming/`],
  ])('opened from %s', async (_, pathname) => {
    serveData();
    for (const l of links) {
      reset();
      vi.stubGlobal('location', { pathname, search: '', hash: `#b=${l.code}` });
      await useStore.getState().load();
      const s = useStore.getState();
      expect([s.view, s.error], l.name).toEqual(['overview', undefined]);
      expect(s.build, l.name).toEqual(checkBuild(gd, await decodeShare(l.code)).build);
      await tick();
      expect(useStore.getState().confirm?.title, l.name).toBe(l.warns ? PAIR_WARNING_TITLE : undefined);
    }
  });

  it('a bare code imported (openBuild)', async () => {
    serveData();
    for (const l of links) {
      reset();
      await useStore.getState().openBuild(await decodeShare(l.code));
      expect(useStore.getState().build, l.name).toEqual(checkBuild(gd, await decodeShare(l.code)).build);
      await tick();
      expect(useStore.getState().confirm?.title, l.name).toBe(l.warns ? PAIR_WARNING_TITLE : undefined);
    }
  });

  it("New Build's Back on another game version shows the build again, without a second warning", async () => {
    serveData();
    reset();
    await useStore.getState().openBuild(await decodeShare(LINK));
    const opened = useStore.getState().build;
    await tick();
    useStore.setState({ confirm: null }); // its OK would unlock after 5 seconds
    useStore.setState({ gd: loadData('i28p3'), view: 'setup' });
    useStore.getState().toOverview();
    await vi.waitFor(() => expect(useStore.getState().gd?.core.manifest.dataVersion).toBe('i28p4'));
    await tick();
    expect(useStore.getState().build).toEqual(opened);
    expect(useStore.getState().confirm).toBeNull();
  });

  it('nor when Back is pressed twice before the build is shown', async () => {
    serveData();
    reset();
    await useStore.getState().openBuild(await decodeShare(LINK));
    await tick();
    useStore.setState({ confirm: null });
    useStore.setState({ gd: loadData('i28p3'), view: 'setup' });
    useStore.getState().toOverview();
    useStore.getState().toOverview();
    await vi.waitFor(() => expect(useStore.getState().gd?.core.manifest.dataVersion).toBe('i28p4'));
    for (let i = 0; i < 5; i++) await tick();
    expect(useStore.getState().confirm).toBeNull();
  });
});
