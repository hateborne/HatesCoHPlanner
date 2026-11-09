/**
 * App state: loaded game data, the build, and the level-up flow (wizard or editing one level
 * from the overview). Screens read from here and call these actions; the rules live in engine/.
 */
import { create } from 'zustand';
import { loadGameData, type GameData } from '../data/gamedata.ts';
import { loadVersions, resolveVersion, type GameVersion, type GameVersions } from '../data/versions.ts';
import { addSlot, pickHoldsEnhancements, setPick } from '../engine/actions.ts';
import { cloneBuild, newBuild, type Alignment, type Build } from '../engine/build.ts';
import { BuildRules } from '../engine/rules.ts';
import { checkBuild } from '../engine/validate.ts';
import { levelSteps, type LevelStep } from '../engine/schedule.ts';
import { decodeShare, encodeShare } from '../io/share.ts';

export type View = 'loading' | 'error' | 'setup' | 'level' | 'overview';
/** Hover tooltips: Enabled (description / slot details; Shift shows Advanced), Advanced, Disabled. */
export type TipMode = 'enabled' | 'advanced' | 'disabled';
export const TIP_MODES: TipMode[] = ['enabled', 'advanced', 'disabled'];
export type LevelSub = 'power' | 'pool' | 'epic' | 'slots';

/** Where the level-up flow is and what the user has chosen but not yet confirmed. */
export interface LevelCtx {
  step: number; // index into levelSteps()
  pickInStep: number; // which of the step's picks (level 1 has two)
  mode: 'wizard' | 'edit';
  sub: LevelSub;
  base: Build; // build without this level's choice
  orig: Build; // build before editing (edit mode; restored on Cancel)
  pendingPower?: number;
  pendingSet?: number; // a new pool/epic set chosen on the set picker
  pendingSlots: string[]; // entry keys, one per slot placed at this level
}

interface Store {
  gd?: GameData; // the data of the version being shown (the build's, or the one picked on New Build)
  steps: LevelStep[];
  versions?: GameVersions; // every game version the site has data for
  /** Show another game version's data (the New Build screen's version picker); false if it failed. */
  selectVersion(id: string): Promise<boolean>;
  error?: string;
  view: View;
  build?: Build;
  level?: LevelCtx;
  muted: boolean;
  musicOn: boolean; // the login-screen music switch (remembered per browser, on by default)
  setupAlign: Alignment; // the alignment picked on the setup screen (its skin and backdrop)
  tips: TipMode; // hover tooltip setting (remembered per browser)
  shift: boolean; // Shift held: Enabled tooltips show the Advanced view
  setTips(m: TipMode): void;
  notice: { id: number; text: string } | null; // a short red message (a refused change)
  notify(text: string): void;
  lockFlash: { id: number; key: string; label: string } | null; // a power bar flashing a refusal
  flashLocked(key: string, label?: string): void;
  confirm: { title: string; text: string; okLabel?: string; resolve: (ok: boolean) => void } | null;
  /** Ask a yes / no question in the planner's dialog; resolves true on Proceed. */
  askConfirm(q: { title: string; text: string; okLabel?: string }): Promise<boolean>;
  closeConfirm(ok: boolean): void;
  load(): Promise<void>;
  startBuild(args: { name: string; at: number; origin: number; alignment: Alignment; primary: number; secondary: number }): void;
  setBuild(b: Build): void;
  toSetup(): void;
  toOverview(): void;
  choosePower(power: number | undefined): void;
  openSetPicker(kind: 'pool' | 'epic'): void;
  closeSetPicker(set?: number, power?: number): void;
  addPendingSlot(key: string): void;
  removePendingSlot(index: number): void;
  finishLevel(): void;
  backLevel(): void;
  cancelLevel(): void;
  editPick(pickIndex: number): void;
  editSlots(level: number): void;
  stopHere(openMenu: boolean): void;
  continueLeveling(): void;
  setMuted(m: boolean): void;
  setMusicOn(on: boolean): void;
  menuOpen: boolean;
  setMenu(open: boolean): void;
  /** Open a build from outside (link, saved, import) with its own game version's data. */
  loadBuild(b: Build): Promise<void>;
}

const STORAGE_KEY = 'hcp.current';

// one fetch per game version per page: switching back to a version already seen is instant
const dataCache = new Map<string, Promise<GameData>>();
function dataFor(v: GameVersion): Promise<GameData> {
  let p = dataCache.get(v.id);
  if (!p) {
    p = loadGameData(import.meta.env.BASE_URL, v);
    p.catch(() => dataCache.delete(v.id)); // a failed fetch may be retried
    dataCache.set(v.id, p);
  }
  return p;
}

/** Say so when a build asked for a game version this site no longer has. */
function missingNote(missing: string | undefined, used: GameVersion): string | undefined {
  return missing ? `This build was made for game version "${missing}", which is no longer available; it was opened with ${used.label}.` : undefined;
}

/**
 * Remember the build: per tab (sessionStorage, so two tabs hold two builds) and as the browser's
 * most recent build (localStorage, what a brand-new tab starts from). The address bar carries it
 * too (see the #b= sync below).
 */
function persist(b: Build | undefined): void {
  if (!b) return;
  const raw = JSON.stringify(b);
  try {
    sessionStorage.setItem(STORAGE_KEY, raw);
  } catch {
    /* storage unavailable (private mode) */
  }
  try {
    localStorage.setItem(STORAGE_KEY, raw);
  } catch {
    /* storage unavailable (private mode) -- the build just isn't remembered */
  }
}

/** @return This tab's build, else the browser's most recent one (unchecked: see checkBuild). */
function restore(): Build | undefined {
  // even touching window.sessionStorage throws when site data is blocked, so the access itself is
  // inside the try
  const read = (get: () => Storage) => {
    try {
      const raw = get().getItem(STORAGE_KEY);
      return raw ? (JSON.parse(raw) as Build) : undefined;
    } catch {
      return undefined;
    }
  };
  return read(() => sessionStorage) ?? read(() => localStorage);
}

/** @return The pick index the flow is on (power steps only). */
export function currentPick(steps: LevelStep[], l: LevelCtx): number {
  return steps[l.step]?.picks[l.pickInStep] ?? -1;
}

/** Build with this level's pending choices applied (what the screens draw). */
export function previewBuild(gd: GameData, steps: LevelStep[], l: LevelCtx): Build {
  const step = steps[l.step];
  if (!step) return l.base;
  if (l.sub === 'slots') {
    let b = l.base;
    const rules = new BuildRules(gd, b);
    for (const key of l.pendingSlots) {
      const e = rules.entries().find((x) => x.key === key);
      if (e) b = addSlot(b, key, step.level, e.level);
    }
    return b;
  }
  const pick = currentPick(steps, l);
  // editing a level from the overview: the pick's slots and enhancements come from the original
  const carry = l.mode === 'edit' ? l.orig.picks[pick] : undefined;
  return l.pendingPower !== undefined && pick >= 0 ? setPick(gd, l.base, pick, l.pendingPower, carry) : l.base;
}

/**
 * Remove a level's choices so it can be redone: the pick itself, or slots gained at the level.
 *
 * @param keepEnhanced Keep slots that hold an enhancement (reopening a slot level: they stay
 *   placed and locked; only empty slots can be moved).
 */
function withoutLevel(b: Build, step: LevelStep, pick: number | null, dropLater: boolean, keepEnhanced = false): Build {
  const nb = cloneBuild(b);
  if (pick !== null) nb.picks = nb.picks.map((p, i) => (i === pick || (dropLater && i > pick) ? null : p));
  else if (dropLater) nb.picks = nb.picks.map((p) => (p && p.level > step.level ? null : p));
  const drop = (lvl: number) => (dropLater ? lvl >= step.level : lvl === step.level);
  const filt = <T extends { level: number; enh?: unknown }>(slots: T[]) => slots.filter((s, i) => i === 0 || !drop(s.level) || (keepEnhanced && !!s.enh));
  for (const p of nb.picks) if (p) p.slots = filt(p.slots);
  for (const g of Object.values(nb.granted)) g.slots = filt(g.slots);
  return nb;
}

/** @return Entry keys of the slots gained at a level, one per slot (only empty ones if asked). */
function slotKeysAt(gd: GameData, b: Build, level: number, emptyOnly = false): string[] {
  const keys: string[] = [];
  for (const e of new BuildRules(gd, b).entries()) {
    e.slots.forEach((s, i) => {
      if (i > 0 && s.level === level && !(emptyOnly && s.enh)) keys.push(e.key);
    });
  }
  return keys;
}

/** @return Whether undoing a level (and, with dropLater, everything after it) would discard an enhancement. */
function dropsEnhancements(gd: GameData, b: Build, step: LevelStep, pick: number | null, dropLater: boolean): boolean {
  const after = withoutLevel(b, step, pick, dropLater);
  const count = (x: Build) => new BuildRules(gd, x).entries().reduce((n, e) => n + e.slots.filter((s) => s.enh).length, 0);
  return count(after) < count(b);
}

const LOCKED = 'Remove enhancements first';

export const useStore = create<Store>((set, get) => ({
  steps: [],
  view: 'loading',
  muted: (() => {
    try {
      return localStorage.getItem('hcp.muted') === '1';
    } catch {
      return false;
    }
  })(),
  musicOn: (() => {
    try {
      return localStorage.getItem('hcp.music') !== '0';
    } catch {
      return true;
    }
  })(),

  menuOpen: false,
  setupAlign: 'Hero',
  lockFlash: null,
  confirm: null,
  askConfirm(q) {
    get().confirm?.resolve(false); // a newer question replaces an unanswered one
    return new Promise<boolean>((resolve) => set({ confirm: { ...q, resolve } }));
  },
  closeConfirm(ok) {
    const c = get().confirm;
    if (!c) return;
    set({ confirm: null });
    c.resolve(ok);
  },
  flashLocked(key, label = 'Remove Enhancements First!') {
    const id = (get().lockFlash?.id ?? 0) + 1;
    // loaded lazily: the sound module imports this store, so a static import would be circular
    void import('../ui/sound.ts').then((m) => m.play('reject5'));
    set({ lockFlash: { id, key, label } });
    window.setTimeout(() => {
      if (get().lockFlash?.id === id) set({ lockFlash: null });
    }, 1600);
  },
  notice: null,
  notify(text) {
    const id = (get().notice?.id ?? 0) + 1;
    set({ notice: { id, text } });
    window.setTimeout(() => {
      if (get().notice?.id === id) set({ notice: null });
    }, 2200);
  },
  tips: (() => {
    try {
      const v = localStorage.getItem('hcp.tooltips') as TipMode | null;
      return v && TIP_MODES.includes(v) ? v : 'enabled';
    } catch {
      return 'enabled';
    }
  })(),
  shift: false,

  setTips(m) {
    try {
      localStorage.setItem('hcp.tooltips', m);
    } catch {
      /* ignore */
    }
    set({ tips: m });
  },

  setMenu(open) {
    set({ menuOpen: open });
  },

  async selectVersion(id) {
    const { versions, gd } = get();
    const v = versions?.versions.find((x) => x.id === id);
    if (!v) return false;
    if (gd?.core.manifest.dataVersion === id) return true;
    try {
      const data = await dataFor(v);
      set({ gd: data, steps: levelSteps(data.core) });
      return true;
    } catch (e) {
      get().notify(`Couldn't load ${v.label}: ${e instanceof Error ? e.message : String(e)}`);
      return false;
    }
  },

  async loadBuild(b) {
    const { versions } = get();
    if (!versions) return;
    const { version, missing } = resolveVersion(versions, b.dataVersion);
    let gd: GameData;
    try {
      gd = await dataFor(version);
    } catch (e) {
      get().notify(`That build can't be opened (${e instanceof Error ? e.message : String(e)})`);
      return;
    }
    // checked before it replaces anything: an unusable build is refused, a repairable one repaired
    const { build: nb, fixes } = checkBuild(gd, b);
    if (!nb) {
      get().notify(`That build can't be opened (${fixes[fixes.length - 1] ?? 'invalid'})`);
      return;
    }
    if (fixes.length) console.warn('build repaired:', fixes);
    persist(nb);
    set({ gd, steps: levelSteps(gd.core), build: nb, view: 'overview', level: undefined, menuOpen: false });
    const note = missingNote(missing, version);
    if (note) get().notify(note);
  },

  async load() {
    try {
      const versions = await loadVersions(import.meta.env.BASE_URL);
      set({ versions });
      // every build from outside the app is checked (and repaired where safe) against its own game
      // version's data before it is used or saved again: a share link (#b=...) first, else this
      // tab's / the browser's remembered build
      const candidates: (() => Promise<Build | undefined>)[] = [
        async () => {
          const m = /#b=([A-Za-z0-9_-]+)/.exec(location.hash);
          return m ? decodeShare(m[1]!) : undefined;
        },
        async () => restore(),
      ];
      for (const next of candidates) {
        let raw: Build | undefined;
        try {
          raw = await next();
        } catch {
          continue; // bad link: fall back to the remembered build
        }
        if (!raw) continue;
        const { version, missing } = resolveVersion(versions, typeof raw.dataVersion === 'string' ? raw.dataVersion : undefined);
        const gd = await dataFor(version);
        const c = checkBuild(gd, raw);
        if (!c.build) continue;
        if (c.fixes.length) console.warn('saved build repaired:', c.fixes);
        persist(c.build);
        set({ gd, steps: levelSteps(gd.core), build: c.build, view: 'overview' });
        const note = missingNote(missing, version);
        if (note) get().notify(note);
        return;
      }
      const gd = await dataFor(resolveVersion(versions, undefined).version);
      set({ gd, steps: levelSteps(gd.core), build: undefined, view: 'setup' });
    } catch (e) {
      set({ view: 'error', error: e instanceof Error ? e.message : String(e) });
    }
  },

  startBuild(args) {
    const { gd } = get();
    if (!gd) return;
    const b = newBuild({ ...args, dataVersion: gd.core.manifest.dataVersion, pickCount: gd.core.schedule.power.length });
    persist(b);
    set({
      build: b,
      view: 'level',
      level: { step: 0, pickInStep: 0, mode: 'wizard', sub: 'power', base: b, orig: b, pendingSlots: [] },
    });
  },

  setBuild(b) {
    persist(b);
    set({ build: b });
  },

  toSetup() {
    set({ view: 'setup', level: undefined });
  },

  toOverview() {
    // the New Build screen may have switched to another game version: show the build's own again
    const { build, gd } = get();
    if (build && gd && build.dataVersion !== gd.core.manifest.dataVersion) {
      void get().loadBuild(build);
      return;
    }
    set({ view: 'overview', level: undefined });
  },

  choosePower(power) {
    const { level, gd } = get();
    if (!level || !gd) return;
    // A new pool/epic set stays shown only while the chosen power belongs to it.
    const keepSet = power !== undefined && level.pendingSet !== undefined && gd.setOfPower.get(power)?.set.id === level.pendingSet;
    set({ level: { ...level, pendingPower: power, pendingSet: keepSet ? level.pendingSet : undefined } });
  },

  openSetPicker(kind) {
    const { level } = get();
    if (level) set({ level: { ...level, sub: kind } });
  },

  closeSetPicker(setId, power) {
    const { level } = get();
    if (!level) return;
    if (setId === undefined || power === undefined) {
      set({ level: { ...level, sub: 'power' } });
      return;
    }
    set({ level: { ...level, sub: 'power', pendingSet: setId, pendingPower: power } });
  },

  addPendingSlot(key) {
    const { level } = get();
    if (level) set({ level: { ...level, pendingSlots: [...level.pendingSlots, key] } });
  },

  removePendingSlot(index) {
    const { level } = get();
    if (level) set({ level: { ...level, pendingSlots: level.pendingSlots.filter((_, i) => i !== index) } });
  },

  finishLevel() {
    const { gd, steps, level } = get();
    if (!gd || !level) return;
    const b = previewBuild(gd, steps, level);
    persist(b);
    if (level.mode === 'edit') {
      set({ build: b, view: 'overview', level: undefined });
      return;
    }
    // advance the wizard
    let step = level.step;
    let pickInStep = level.pickInStep;
    const cur = steps[step];
    if (level.sub !== 'slots' && cur && pickInStep + 1 < cur.picks.length) {
      pickInStep++;
    } else if (level.sub !== 'slots' && cur && cur.slots > 0) {
      set({ build: b, level: { ...level, base: b, sub: 'slots', pendingPower: undefined, pendingSet: undefined, pendingSlots: [] } });
      return;
    } else {
      step++;
      pickInStep = 0;
    }
    const next = steps[step];
    if (!next) {
      set({ build: b, view: 'overview', level: undefined });
      return;
    }
    set({
      build: b,
      level: {
        step,
        pickInStep,
        mode: 'wizard',
        sub: next.picks.length ? 'power' : 'slots',
        base: b,
        orig: b,
        pendingSlots: [],
      },
    });
  },

  backLevel() {
    const { gd, steps, level, build } = get();
    if (!gd || !level || !build) return;
    if (level.mode === 'edit') {
      set({ view: 'overview', level: undefined, build: level.orig });
      return;
    }
    // previous position in the wizard
    let step = level.step;
    let pickInStep = level.pickInStep;
    let sub: LevelSub = level.sub === 'slots' ? 'slots' : 'power';
    const cur = steps[step];
    if (sub === 'slots' && cur && cur.picks.length) {
      sub = 'power';
      pickInStep = cur.picks.length - 1;
    } else if (sub === 'power' && pickInStep > 0) {
      pickInStep--;
    } else {
      step--;
      const prev = steps[step];
      if (!prev) {
        set({ view: 'setup', level: undefined });
        return;
      }
      sub = prev.slots > 0 ? 'slots' : 'power';
      pickInStep = Math.max(0, prev.picks.length - 1);
    }
    const target = steps[step]!;
    const committed = level.base;
    // Back discards that level and everything after it: not while any of it holds enhancements
    if (dropsEnhancements(gd, committed, target, sub === 'slots' ? null : target.picks[pickInStep]!, true)) {
      get().notify(LOCKED);
      return;
    }
    if (sub === 'slots') {
      const pending = slotKeysAt(gd, committed, target.level);
      const base = withoutLevel(committed, target, null, true);
      set({ build: base, level: { step, pickInStep, mode: 'wizard', sub, base, orig: base, pendingSlots: pending } });
    } else {
      const pick = target.picks[pickInStep]!;
      const pendingPower = committed.picks[pick]?.power;
      const base = withoutLevel(committed, target, pick, true);
      set({ build: base, level: { step, pickInStep, mode: 'wizard', sub, base, orig: base, pendingPower, pendingSlots: [] } });
    }
  },

  cancelLevel() {
    const { level } = get();
    if (level?.mode === 'edit') set({ view: 'overview', level: undefined, build: level.orig });
    else get().backLevel();
  },

  editPick(pickIndex) {
    const { build, steps } = get();
    if (!build) return;
    // swapping a power that holds enhancements (itself, or the powers it grants) could leave set
    // pieces in a power that can't take them (an AoE set in a single-target attack): empty its
    // slots first
    const gd = get().gd;
    if (gd && pickHoldsEnhancements(gd, build, pickIndex)) {
      get().flashLocked(`pick:${pickIndex}`);
      return;
    }
    const step = steps.findIndex((s) => s.picks.includes(pickIndex));
    if (step < 0) return;
    const base = cloneBuild(build);
    base.picks[pickIndex] = null;
    set({
      view: 'level',
      level: {
        step,
        pickInStep: steps[step]!.picks.indexOf(pickIndex),
        mode: 'edit',
        sub: 'power',
        base,
        orig: build,
        pendingPower: build.picks[pickIndex]?.power,
        pendingSlots: [],
      },
    });
  },

  editSlots(lvl) {
    const { gd, build, steps } = get();
    if (!gd || !build) return;
    const step = steps.findIndex((s) => s.level === lvl && s.slots > 0);
    if (step < 0) return;
    // slots holding enhancements stay where they are (locked); only the empty ones can move
    const pending = slotKeysAt(gd, build, lvl, true);
    const base = withoutLevel(build, steps[step]!, null, false, true);
    set({ view: 'level', level: { step, pickInStep: 0, mode: 'edit', sub: 'slots', base, orig: build, pendingSlots: pending } });
  },

  stopHere(openMenu) {
    // View Build / Save / Share mid-leveling: the build ends at this level (its choices so far
    // included) and the overview hides the levels after it
    const { gd, steps, level } = get();
    if (!gd || !level || level.mode !== 'wizard') return;
    const step = steps[level.step];
    if (!step) return;
    const b = { ...previewBuild(gd, steps, level), endLevel: step.level };
    persist(b);
    set({ build: b, view: 'overview', level: undefined, menuOpen: openMenu });
  },

  continueLeveling() {
    // reopen the wizard at the first level that isn't finished (the one after the stop level
    // when everything up to it is done)
    const { gd, build, steps } = get();
    if (!gd || !build) return;
    const rules = new BuildRules(gd, build);
    const done = (s: LevelStep) => s.picks.every((k) => build.picks[k]) && rules.slotsUsed(s.level) >= s.slots;
    const step = steps.findIndex((s) => !done(s));
    if (step < 0) return;
    const target = steps[step]!;
    const b = cloneBuild(build);
    delete b.endLevel;
    persist(b);
    const firstPick = target.picks.findIndex((k) => !b.picks[k]);
    const sub: LevelSub = firstPick >= 0 ? 'power' : 'slots';
    const pendingSlots = sub === 'slots' ? slotKeysAt(gd, b, target.level, true) : [];
    const base = sub === 'slots' ? withoutLevel(b, target, null, false, true) : b;
    set({
      build: base,
      view: 'level',
      level: { step, pickInStep: Math.max(0, firstPick), mode: 'wizard', sub, base, orig: base, pendingSlots },
    });
  },

  setMuted(m) {
    try {
      localStorage.setItem('hcp.muted', m ? '1' : '0');
    } catch {
      /* ignore */
    }
    set({ muted: m });
  },

  setMusicOn(on) {
    try {
      localStorage.setItem('hcp.music', on ? '1' : '0');
    } catch {
      /* ignore */
    }
    set({ musicOn: on });
  },
}));

// The address bar always carries this tab's build as a share code (#b=...), replaced in place so
// edits don't pile up Back-button entries: a reload, a bookmark or a copied address brings back
// exactly this build, and two tabs keep two builds apart.
if (typeof window !== 'undefined') {
  let timer = 0;
  let written = '';
  useStore.subscribe((s, prev) => {
    if (s.build === prev.build || !s.build) return;
    const b = s.build;
    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      void encodeShare(b)
        .then((code) => {
          if (code === written || useStore.getState().build !== b) return;
          written = code;
          // replaceState fires no hashchange, so this doesn't reload the build
          history.replaceState(history.state, '', `${location.pathname}${location.search}#b=${code}`);
        })
        .catch(() => undefined);
    }, 300);
  });
}

// A share link pasted into a tab that already has the planner open only changes the hash (the
// page does not reload), so load the linked build when the hash changes too
if (typeof window !== 'undefined') {
  window.addEventListener('hashchange', () => {
    const m = /#b=([A-Za-z0-9_-]+)/.exec(location.hash);
    const { versions, loadBuild } = useStore.getState();
    if (!m || !versions) return;
    void decodeShare(m[1]!)
      .then((b) => loadBuild(b)) // loadBuild loads its game version and checks it first
      .catch(() => undefined); // a bad link leaves the current build alone
  });
}

// The Sound, Music and Tooltips switches belong to the browser, not the tab, and the last change
// made in any tab wins: every new or reloaded tab reads it from localStorage at start-up, and tabs
// already open follow it at once (the storage event fires in every other tab of the site).
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === 'hcp.muted') useStore.setState({ muted: e.newValue === '1' });
    else if (e.key === 'hcp.music') useStore.setState({ musicOn: e.newValue !== '0' });
    else if (e.key === 'hcp.tooltips') useStore.setState({ tips: TIP_MODES.includes(e.newValue as TipMode) ? (e.newValue as TipMode) : 'enabled' });
    else if (e.key === null) useStore.setState({ muted: false, musicOn: true, tips: 'enabled' }); // site data cleared: defaults
  });
}

// Shift held anywhere switches Enabled tooltips to their Advanced view
if (typeof window !== 'undefined') {
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Shift' && useStore.getState().shift !== (e.type === 'keydown')) useStore.setState({ shift: e.type === 'keydown' });
  };
  window.addEventListener('keydown', onKey);
  window.addEventListener('keyup', onKey);
  window.addEventListener('blur', () => useStore.getState().shift && useStore.setState({ shift: false }));
}

/** @return Which tooltip a hover shows now: none, the normal one, or the advanced one. */
export function useTipLevel(): 'off' | 'basic' | 'advanced' {
  const tips = useStore((s) => s.tips);
  const shift = useStore((s) => s.shift);
  if (tips === 'disabled') return 'off';
  return tips === 'advanced' || shift ? 'advanced' : 'basic';
}

if (import.meta.env.DEV) {
  const w = window as unknown as { __store: typeof useStore; __autoWizard: () => string };
  w.__store = useStore;
  // Dev helper: walk the wizard to level 50 taking the first legal power and spreading slots.
  w.__autoWizard = () => {
    for (let guard = 0; guard < 400; guard++) {
      const s = useStore.getState();
      if (s.view !== 'level' || !s.level || !s.gd) return s.view;
      const l = s.level;
      if (l.sub === 'slots') {
        const step = s.steps[l.step]!;
        for (let k = 0; k < 20; k++) {
          const cur = useStore.getState().level!;
          const rules = new BuildRules(s.gd, previewBuild(s.gd, s.steps, cur));
          if (rules.slotsUsed(step.level) >= rules.slotsGranted(step.level)) break;
          const cands = rules.entries().filter((e) => e.level <= step.level && rules.slotBlock(e, step.level) === null);
          const e = cands[k % Math.max(1, cands.length)];
          if (!e) break;
          s.addPendingSlot(e.key);
        }
        useStore.getState().finishLevel();
        continue;
      }
      const pick = currentPick(s.steps, l);
      const rules = new BuildRules(s.gd, l.base);
      let chosen = rules.setOptions(pick).flatMap((o) => o.powers).find((o) => o.state === 'available')?.power.id;
      if (chosen === undefined) {
        for (const c of rules.newSetChoices('pool', pick).filter((c) => !c.block)) {
          chosen = c.set.p.map((pid) => rules.powerOption(pid, pick)).find((o) => o.state === 'available')?.power.id;
          if (chosen !== undefined) break;
        }
      }
      if (chosen === undefined) return `stuck at pick ${pick}`;
      useStore.getState().choosePower(chosen);
      useStore.getState().finishLevel();
    }
    return 'guard';
  };
}
