/**
 * App state: loaded game data, the build, and the level-up flow (wizard or editing one level
 * from the overview). Screens read from here and call these actions; the rules live in engine/.
 */
import { create } from 'zustand';
import { loadGameData, type GameData } from '../data/gamedata.ts';
import { addSlot, setPick } from '../engine/actions.ts';
import { cloneBuild, newBuild, type Alignment, type Build } from '../engine/build.ts';
import { BuildRules } from '../engine/rules.ts';
import { levelSteps, type LevelStep } from '../engine/schedule.ts';

export type View = 'loading' | 'error' | 'setup' | 'level' | 'overview';
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
  gd?: GameData;
  steps: LevelStep[];
  error?: string;
  view: View;
  build?: Build;
  level?: LevelCtx;
  muted: boolean;
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
  setMuted(m: boolean): void;
}

const STORAGE_KEY = 'hcp.current';

function persist(b: Build | undefined): void {
  try {
    if (b) localStorage.setItem(STORAGE_KEY, JSON.stringify(b));
  } catch {
    /* storage unavailable (private mode) -- the build just isn't remembered */
  }
}

function restore(): Build | undefined {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Build) : undefined;
  } catch {
    return undefined;
  }
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
  return l.pendingPower !== undefined && pick >= 0 ? setPick(gd, l.base, pick, l.pendingPower) : l.base;
}

/** Remove a level's choices so it can be redone: the pick itself, or slots gained at the level. */
function withoutLevel(b: Build, step: LevelStep, pick: number | null, dropLater: boolean): Build {
  const nb = cloneBuild(b);
  if (pick !== null) nb.picks = nb.picks.map((p, i) => (i === pick || (dropLater && i > pick) ? null : p));
  else if (dropLater) nb.picks = nb.picks.map((p) => (p && p.level > step.level ? null : p));
  const drop = (lvl: number) => (dropLater ? lvl >= step.level : lvl === step.level);
  const filt = <T extends { level: number }>(slots: T[]) => slots.filter((s, i) => i === 0 || !drop(s.level));
  for (const p of nb.picks) if (p) p.slots = filt(p.slots);
  for (const g of Object.values(nb.granted)) g.slots = filt(g.slots);
  return nb;
}

function slotKeysAt(gd: GameData, b: Build, level: number): string[] {
  const keys: string[] = [];
  for (const e of new BuildRules(gd, b).entries()) {
    e.slots.forEach((s, i) => {
      if (i > 0 && s.level === level) keys.push(e.key);
    });
  }
  return keys;
}

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

  async load() {
    try {
      const gd = await loadGameData(import.meta.env.BASE_URL);
      const steps = levelSteps(gd.core);
      const saved = restore();
      const ok = saved && gd.archetypeById.has(saved.at) && saved.picks.length === gd.core.schedule.power.length;
      set({ gd, steps, build: ok ? saved : undefined, view: ok ? 'overview' : 'setup' });
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
    const pending = slotKeysAt(gd, build, lvl);
    const base = withoutLevel(build, steps[step]!, null, false);
    set({ view: 'level', level: { step, pickInStep: 0, mode: 'edit', sub: 'slots', base, orig: build, pendingSlots: pending } });
  },

  setMuted(m) {
    try {
      localStorage.setItem('hcp.muted', m ? '1' : '0');
    } catch {
      /* ignore */
    }
    set({ muted: m });
  },
}));

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
