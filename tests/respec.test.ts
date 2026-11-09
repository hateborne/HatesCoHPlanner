/**
 * Respec build type: the step order (every power, then the slots, with slot levels merged the way
 * uiReSpec.c merges them), the wizard walking it through the store, and the build field in links
 * and checks.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { newBuild } from '../src/engine/build.ts';
import { BuildRules } from '../src/engine/rules.ts';
import { levelSteps, respecSteps, stepSlotLevels } from '../src/engine/schedule.ts';
import { checkBuild } from '../src/engine/validate.ts';
import { decodeShare, encodeShare } from '../src/io/share.ts';
import { currentPick, previewBuild, respecUnfinished, stepsOf, useStore } from '../src/state/store.ts';
import { loadData, pid, sid } from './helpers/data.ts';

const gd = loadData();
const steps = levelSteps(gd.core);
const SLOTS = gd.core.schedule.slot.length;

const start = (respecTo: number | undefined) => {
  useStore.setState({ gd, steps, build: undefined, level: undefined, view: 'setup' });
  useStore.getState().startBuild({
    name: 'Respec',
    at: gd.archetypeByName.get('class_blaster')!.id,
    origin: gd.core.origins[0]!.id,
    alignment: 'Hero',
    primary: sid(gd, 'Blaster_Ranged.Fire_Blast'),
    secondary: sid(gd, 'Blaster_Support.Fire_Manipulation'),
    respecTo,
  });
};

/** Take the first legal power on the current power screen and press Next. */
const pickAndNext = () => {
  const s = useStore.getState();
  const l = s.level!;
  const pick = currentPick(s.steps, l);
  const rules = new BuildRules(gd, l.base);
  let chosen = rules.setOptions(pick).flatMap((o) => o.powers).find((o) => o.state === 'available')?.power.id;
  if (chosen === undefined) {
    for (const c of rules.newSetChoices('pool', pick).filter((c) => !c.block)) {
      chosen = c.set.p.map((pid) => rules.powerOption(pid, pick)).find((o) => o.state === 'available')?.power.id;
      if (chosen !== undefined) break;
    }
  }
  expect(chosen, `a legal power at pick ${pick}`).toBeDefined();
  s.choosePower(chosen);
  useStore.getState().finishLevel();
};

/** Place every slot of the current slot screen (spread over the powers) and press Next. */
const slotAndNext = () => {
  const l0 = useStore.getState().level!;
  const step = stepsOf(steps, l0)[l0.step]!;
  const levels = stepSlotLevels(step);
  for (let k = 0; k < 200; k++) {
    const rules = new BuildRules(gd, previewBuild(gd, steps, useStore.getState().level!));
    if (rules.slotsLeft(levels) <= 0) break;
    const cands = rules.entries().filter((e) => rules.slotBlock(e, step.level, levels) === null);
    expect(cands.length, `somewhere to put a slot at level ${step.level + 1}`).toBeGreaterThan(0);
    useStore.getState().addPendingSlot(cands[k % cands.length]!.key);
  }
  useStore.getState().finishLevel();
};

describe('respec step order (uiReSpec.c)', () => {
  const flow = respecSteps(steps, 49);
  const firstSlot = flow.findIndex((s) => !s.picks.length);

  it('asks for every power before any slot', () => {
    expect(flow.slice(0, firstSlot).every((s) => s.picks.length && s.slots === 0)).toBe(true);
    expect(flow.slice(firstSlot).every((s) => !s.picks.length && s.slots > 0)).toBe(true);
    // level 1's secondary (pick 1) comes before its primary (pick 0); then index order
    expect(flow.slice(0, firstSlot).flatMap((s) => s.picks)).toEqual([1, 0, ...gd.core.schedule.power.map((_, i) => i).slice(2)]);
    expect(flow.reduce((n, s) => n + s.slots, 0)).toBe(SLOTS);
  });

  it('puts every slot on one screen at the respec level (Homecoming)', () => {
    const slotSteps = flow.slice(firstSlot);
    expect(slotSteps).toHaveLength(1);
    expect(slotSteps[0]!.level).toBe(49);
    expect(slotSteps[0]!.slotLevels).toEqual([...gd.core.schedule.slot].sort((x, y) => x - y));
  });

  it('stops at the respec level', () => {
    const to30 = respecSteps(steps, 29);
    expect(Math.max(...to30.map((s) => s.level))).toBeLessThanOrEqual(29);
    expect(to30.flatMap((s) => s.picks).every((k) => gd.core.schedule.power[k]! <= 29)).toBe(true);
  });
});

describe('the respec wizard', () => {
  beforeEach(() => start(49));

  it('walks every power, then every slot screen, to a valid level 50 build', () => {
    const flow = useStore.getState().level!.flow!;
    const powers = flow.filter((s) => s.picks.length).reduce((n, s) => n + s.picks.length, 0);
    for (let i = 0; i < powers; i++) {
      expect(useStore.getState().level!.sub).toBe('power');
      pickAndNext();
    }
    // every pick is made before the first slot screen
    expect(useStore.getState().level!.sub).toBe('slots');
    expect(useStore.getState().build!.picks.every((p) => p)).toBe(true);
    while (useStore.getState().view === 'level') slotAndNext();
    const b = useStore.getState().build!;
    expect(useStore.getState().view).toBe('overview');
    const rules = new BuildRules(gd, b);
    expect(rules.issues()).toEqual([]);
    expect(rules.slotsLeft([...new Set(gd.core.schedule.slot)])).toBe(0);
    expect(b.respecTo).toBe(49);
    expect(respecUnfinished(gd, b, steps)).toBe(false);
  });

  it('asks the level 1 secondary power first, with the primary column locked', () => {
    const s = useStore.getState();
    expect(currentPick(s.steps, s.level!)).toBe(1);
    const rules = new BuildRules(gd, s.level!.base);
    const opts = rules.setOptions(1);
    expect(opts.filter((o) => o.column === 0).flatMap((o) => o.powers).every((o) => o.state !== 'available')).toBe(true);
    expect(opts.filter((o) => o.column === 1).flatMap((o) => o.powers).filter((o) => o.state === 'available').length).toBe(2);
    pickAndNext();
    expect(currentPick(steps, useStore.getState().level!)).toBe(0);
  });

  it('Back from level 2 to the level 1 primary keeps the secondary chosen before it', () => {
    pickAndNext(); // secondary (pick 1)
    pickAndNext(); // primary (pick 0)
    useStore.getState().backLevel(); // from pick 2 back to pick 0
    const l = useStore.getState().level!;
    expect(currentPick(steps, l)).toBe(0);
    expect(l.base.picks[1]).not.toBeNull();
    expect(l.pendingPower).toBeDefined();
  });

  it('a respec with only its secondary chosen still reloads', () => {
    pickAndNext();
    const b = useStore.getState().build!;
    expect(b.picks[1]).not.toBeNull();
    expect(b.picks[0]).toBeNull();
    expect(checkBuild(gd, b).build).not.toBeNull();
  });

  it('Back from the first slot screen returns to the last power with every pick kept', () => {
    const flow = useStore.getState().level!.flow!;
    const powers = flow.filter((s) => s.picks.length).reduce((n, s) => n + s.picks.length, 0);
    for (let i = 0; i < powers; i++) pickAndNext();
    useStore.getState().addPendingSlot('pick:0');
    useStore.getState().backLevel();
    const l = useStore.getState().level!;
    expect(l.sub).toBe('power');
    expect(currentPick(steps, l)).toBe(gd.core.schedule.power.length - 1);
    expect(l.pendingPower).toBeDefined(); // the last pick comes back selected
    expect(l.base.picks.filter((p) => p).length).toBe(gd.core.schedule.power.length - 1);
  });

  it('lets any power take any slot: all of them on the last powers is a valid build', () => {
    const flow = useStore.getState().level!.flow!;
    const powers = flow.filter((s) => s.picks.length).reduce((n, s) => n + s.picks.length, 0);
    for (let i = 0; i < powers; i++) pickAndNext();
    const l0 = useStore.getState().level!;
    const step = stepsOf(steps, l0)[l0.step]!;
    const levels = stepSlotLevels(step);
    // fill the latest picks first: far more slots than leveling could give them
    const late = new BuildRules(gd, l0.base).entries().filter((e) => e.source === 'pick').sort((a, b) => b.level - a.level);
    for (const e of late) {
      for (;;) {
        const rules = new BuildRules(gd, previewBuild(gd, steps, useStore.getState().level!));
        const cur = rules.entries().find((x) => x.key === e.key)!;
        if (rules.slotsLeft(levels) <= 0 || rules.slotBlock(cur, step.level, levels) !== null) break;
        useStore.getState().addPendingSlot(e.key);
      }
    }
    const last = gd.core.schedule.power.length - 1;
    expect(new BuildRules(gd, previewBuild(gd, steps, useStore.getState().level!)).entries().find((x) => x.key === `pick:${last}`)!.slots.length).toBe(6);
    while (useStore.getState().view === 'level') slotAndNext();
    const b = useStore.getState().build!;
    const rules = new BuildRules(gd, b);
    expect(rules.entries().find((x) => x.key === `pick:${last}`)!.slots.length).toBe(6);
    expect(rules.slotsLeft([...new Set(gd.core.schedule.slot)])).toBe(0);
    expect(rules.issues()).toEqual([]);
    // the same slots on a leveling build break the leveling rule
    expect(new BuildRules(gd, { ...b, respecTo: undefined }).issues().some((i) => i.message === 'Slot is below the power level')).toBe(true);
  });

  it('reopening slots on a finished respec opens its one slot screen', () => {
    const flow = useStore.getState().level!.flow!;
    const powers = flow.filter((s) => s.picks.length).reduce((n, s) => n + s.picks.length, 0);
    for (let i = 0; i < powers; i++) pickAndNext();
    while (useStore.getState().view === 'level') slotAndNext();
    useStore.getState().editSlots(gd.core.schedule.slot[0]!);
    const l = useStore.getState().level!;
    expect(l.mode).toBe('edit');
    expect(l.flow).toBeDefined();
    expect(l.pendingSlots).toHaveLength(SLOTS); // every (empty) slot can move
    useStore.getState().backLevel(); // Cancel restores the build
    expect(useStore.getState().view).toBe('overview');
  });

  it('reopening slots with an enhancement placed keeps every slot level within what it grants', () => {
    const flow = useStore.getState().level!.flow!;
    const powers = flow.filter((s) => s.picks.length).reduce((n, s) => n + s.picks.length, 0);
    for (let i = 0; i < powers; i++) pickAndNext();
    while (useStore.getState().view === 'level') slotAndNext();
    // put an enhancement in the last bought slot of a pick that has one
    const b0 = useStore.getState().build!;
    const k = b0.picks.findIndex((p) => p && p.slots.length > 2);
    const pick = b0.picks[k]!;
    const at = pick.slots.length - 1;
    const enhanced = { ...b0, picks: b0.picks.map((p, i) => (i === k ? { ...pick, slots: pick.slots.map((s, j) => (j === at ? { ...s, enh: { boost: pid(gd, 'Boosts.Crafted_Damage.Crafted_Damage'), ioLevel: 49 } } : s)) } : p)) };
    useStore.getState().setBuild(enhanced);
    expect(new BuildRules(gd, enhanced).issues()).toEqual([]);
    useStore.getState().editSlots(gd.core.schedule.slot[0]!);
    useStore.getState().finishLevel();
    const after = useStore.getState().build!;
    expect(new BuildRules(gd, after).issues()).toEqual([]);
    expect(after.picks[k]!.slots[at]!.enh).toBeDefined();
  });

  it("won't open the slot screen while a respec still has powers to choose", () => {
    (globalThis as { window?: unknown }).window ??= globalThis; // notify() uses window.setTimeout
    pickAndNext();
    pickAndNext();
    useStore.getState().stopHere(false);
    useStore.getState().editSlots(gd.core.schedule.slot[0]!);
    expect(useStore.getState().view).toBe('overview');
    expect(useStore.getState().notice?.text).toMatch(/Continue Respec/);
  });

  it('a respec stopped part-way picks up where it stopped', () => {
    pickAndNext();
    pickAndNext();
    useStore.getState().stopHere(false);
    const stopped = useStore.getState().build!;
    expect(respecUnfinished(gd, stopped, steps)).toBe(true);
    useStore.getState().continueLeveling();
    const l = useStore.getState().level!;
    expect(l.flow).toBeDefined();
    expect(currentPick(steps, l)).toBe(2);
  });
});

describe('a respec to a lower level', () => {
  it('ends at that level', () => {
    start(29);
    const flow = useStore.getState().level!.flow!;
    expect(useStore.getState().build!.endLevel).toBe(29);
    const powers = flow.filter((s) => s.picks.length).reduce((n, s) => n + s.picks.length, 0);
    for (let i = 0; i < powers; i++) pickAndNext();
    while (useStore.getState().view === 'level') slotAndNext();
    const b = useStore.getState().build!;
    expect(b.picks.every((p, i) => (gd.core.schedule.power[i]! <= 29 ? p : !p))).toBe(true);
    expect(new BuildRules(gd, b).issues()).toEqual([]);
  });
});

describe('the build type in links and checks', () => {
  const base = () =>
    newBuild({
      dataVersion: gd.core.manifest.dataVersion,
      at: gd.archetypeByName.get('class_blaster')!.id,
      origin: gd.core.origins[0]!.id,
      alignment: 'Hero',
      primary: sid(gd, 'Blaster_Ranged.Fire_Blast'),
      secondary: sid(gd, 'Blaster_Support.Fire_Manipulation'),
      pickCount: gd.core.schedule.power.length,
      respecTo: 34,
    });
  it('round-trips through a share link; leveling builds carry none', async () => {
    expect((await decodeShare(await encodeShare(base()))).respecTo).toBe(34);
    const lev = { ...base(), respecTo: undefined, endLevel: undefined };
    expect((await decodeShare(await encodeShare(lev))).respecTo).toBeUndefined();
  });
  it('survives checkBuild, and a bad value is dropped', () => {
    const b = base();
    b.picks[0] = { power: gd.powerset(b.primary).p[0]!, level: 0, slots: [{ level: 0 }] };
    expect(checkBuild(gd, b).build?.respecTo).toBe(34);
    expect(checkBuild(gd, { ...b, respecTo: 77 }).build?.respecTo).toBeUndefined();
  });
});
