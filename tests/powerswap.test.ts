/**
 * Swapping a power from the overview (store.finishSwap): the question listing the enhancements a
 * swap drops and keeps, Cancel staying on the power screen, the freed-slot screen, and Advanced
 * Respec, which asks nothing.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { earlierOption, laterPick } from '../src/engine/actions.ts';
import { newBuild, type Build } from '../src/engine/build.ts';
import { BuildRules } from '../src/engine/rules.ts';
import { levelSteps } from '../src/engine/schedule.ts';
import { autoAdvanceReady, previewBuild, useStore } from '../src/state/store.ts';
import { loadData, pid, sid } from './helpers/data.ts';

const gd = loadData();
const steps = levelSteps(gd.core);
const P = gd.core.schedule.power;
const DMG = pid(gd, 'Boosts.Crafted_Damage.Crafted_Damage');
const RECH = pid(gd, 'Boosts.Crafted_Recharge.Crafted_Recharge');
const BOLT = pid(gd, 'Peacebringer_Offensive.Luminous_Blast.Gleaming_Bolt');
const INNER_LIGHT = pid(gd, 'Peacebringer_Offensive.Luminous_Blast.Build_Up');
const QUANTUM = pid(gd, 'Peacebringer_Defensive.Luminous_Aura.Quantum_Boost');
// the first two levels the schedule grants slots at (0-based)
const [S1, S2] = [...new Set(gd.core.schedule.slot)];

/** A Peacebringer: Gleaming Bolt (Damage, Recharge, an empty slot) and Incandescence (two bought slots). */
function peacebringer(respecTo?: number): Build {
  const b = newBuild({
    dataVersion: gd.core.manifest.dataVersion,
    name: 'Nova',
    at: gd.archetypeByName.get('class_peacebringer')!.id,
    origin: gd.core.origins[0]!.id,
    alignment: 'Hero',
    primary: sid(gd, 'Peacebringer_Offensive.Luminous_Blast'),
    secondary: sid(gd, 'Peacebringer_Defensive.Luminous_Aura'),
    pickCount: P.length,
    server: gd.server,
    respecTo,
  });
  b.picks[0] = { power: BOLT, level: P[0]!, slots: [{ level: 0, enh: { boost: DMG, ioLevel: 49 } }, { level: S1!, enh: { boost: RECH, ioLevel: 49 } }, { level: S1! }] };
  b.picks[1] = { power: pid(gd, 'Peacebringer_Defensive.Luminous_Aura.Incandescence'), level: P[1]!, slots: [{ level: 0 }, { level: S2! }, { level: S2! }] };
  return b;
}

const tick = () => new Promise((r) => setTimeout(r, 0));
const st = () => useStore.getState();

/** Open the overview on a build and reopen one of its picks with another power chosen. */
function swap(b: Build, pick: number, power: number, advanced = false) {
  useStore.setState({ gd, steps, build: b, view: 'overview', level: undefined, confirm: null, advancedRespec: advanced });
  st().editPick(pick);
  st().choosePower(power);
  st().finishLevel();
}

beforeEach(() => useStore.setState({ confirm: null, level: undefined }));

describe('swapping a power on the overview', () => {
  it('asks first, naming the powers and the enhancements dropped and kept', async () => {
    swap(peacebringer(), 0, INNER_LIGHT);
    const c = st().confirm!;
    expect(c.title).toBe('Change power?');
    expect(c.text).toBe('Changing Gleaming Bolt to Inner Light for the level 1 power choice will drop the following enhancements:');
    expect(c.highlight).toEqual(['Gleaming Bolt', 'Inner Light']);
    expect(c.sections).toEqual([
      { heading: '', lines: ['Invention: Damage (50)'] },
      { heading: 'The following enhancements will be kept:', lines: ['Invention: Recharge Reduction (50)'] },
    ]);
    // Cancel stays on the power screen with nothing changed
    st().closeConfirm(false);
    await tick();
    expect(st().view).toBe('level');
    expect(st().build!.picks[0]!.power).toBe(BOLT);
    // OK makes the change
    st().finishLevel();
    st().closeConfirm(true);
    await tick();
    expect(st().view).toBe('overview');
    expect(st().build!.picks[0]!.power).toBe(INNER_LIGHT);
    expect(st().build!.picks[0]!.slots.map((s) => s.enh?.boost)).toEqual([undefined, RECH, undefined]);
  });

  it("asks nothing when the swap drops nothing (a power that isn't slotted)", async () => {
    swap(peacebringer(), 1, pid(gd, 'Peacebringer_Defensive.Luminous_Aura.Shining_Shield'));
    expect(st().confirm).toBeNull();
    expect(st().view).toBe('overview');
  });

  it('takes the player to the slots it freed, each keeping its level', async () => {
    swap(peacebringer(), 1, QUANTUM);
    expect(st().confirm!.text).toMatch(/^Changing Incandescence to Quantum Acceleration for the level 1 power choice frees 2 enhancement slots\. You'll place them next\.$/);
    st().closeConfirm(true);
    await tick();
    const l = st().level!;
    expect([l.sub, l.mode, l.freed]).toEqual(['slots', 'edit', true]);
    expect(l.flow![0]!.slotLevels).toEqual([S2, S2]);
    st().addPendingSlot('pick:0');
    st().addPendingSlot('pick:0');
    st().finishLevel();
    const b = st().build!;
    expect(st().view).toBe('overview');
    expect(b.picks[1]!.slots).toEqual([]);
    expect(b.picks[0]!.slots.map((s) => s.level)).toEqual([0, S1, S1, S2, S2]);
  });

  it('Cancel on the freed-slot screen undoes the whole swap', async () => {
    const b = peacebringer();
    swap(b, 1, QUANTUM);
    st().closeConfirm(true);
    await tick();
    st().cancelLevel();
    expect(st().view).toBe('overview');
    expect(st().build).toBe(b);
  });

  it('asks nothing in Advanced Respec (a Respec build only)', async () => {
    swap(peacebringer(49), 0, INNER_LIGHT, /*advanced=*/ true);
    expect(st().confirm).toBeNull();
    expect(st().build!.picks[0]!.power).toBe(INNER_LIGHT);
    swap(peacebringer(49), 1, QUANTUM, /*advanced=*/ true);
    expect(st().confirm).toBeNull();
    expect(st().level!.freed).toBe(true);
    // a leveling build still asks
    swap(peacebringer(), 0, INNER_LIGHT, /*advanced=*/ true);
    expect(st().confirm).not.toBeNull();
  });
});

describe('taking a power the build has later at an earlier pick', () => {
  const GLINT = pid(gd, 'Peacebringer_Offensive.Luminous_Blast.Glinting_Eye');
  const CJ = pid(gd, 'Pool.Leaping.Combat_Jumping');
  // a slot level between picks 3 and 6, and one after pick 6
  const slotBetween = gd.core.schedule.slot.find((l) => l > P[3]! && l < P[6]!)!;
  const slotAfter = gd.core.schedule.slot.find((l) => l > P[6]!)!;

  /** Combat Jumping at pick 3 (a slot gained before pick 6 and one after), Glinting Eye at pick 6. */
  function build(respecTo?: number): Build {
    const b = peacebringer(respecTo);
    b.picks[3] = { power: CJ, level: P[3]!, slots: [{ level: P[3]!, enh: { boost: RECH, ioLevel: 49 } }, { level: slotBetween, enh: { boost: RECH, ioLevel: 49 } }, { level: slotAfter }] };
    b.picks[6] = { power: GLINT, level: P[6]!, slots: [{ level: P[6]!, enh: { boost: DMG, ioLevel: 49 } }] };
    return b;
  }

  it('offers the later power on the earlier pick', () => {
    swap(build(), 3, GLINT);
    // it was offered: chosen and Finish pressed, the question is up
    expect(st().confirm).not.toBeNull();
  });

  it('a leveling build moves the old power up, freeing the slots gained before its new level', async () => {
    swap(build(), 3, GLINT);
    const c = st().confirm!;
    expect(c.text).toBe(
      `Taking Glinting Eye at level ${P[3]! + 1} moves Combat Jumping to level ${P[6]! + 1}. It frees 1 enhancement slot gained before level ${P[6]! + 1}; you'll place it next. The following enhancements will be dropped:`,
    );
    expect(c.sections).toEqual([{ heading: '', lines: ['Invention: Recharge Reduction (50)'] }]);
    st().closeConfirm(true);
    await tick();
    const l = st().level!;
    expect(l.freed).toBe(true);
    expect(l.flow![0]!.slotLevels).toEqual([slotBetween]);
    const b = l.base;
    expect(b.picks[3]).toEqual({ power: GLINT, level: P[3], slots: [{ level: P[3], enh: { boost: DMG, ioLevel: 49 } }] });
    expect(b.picks[6]).toEqual({ power: CJ, level: P[6], slots: [{ level: P[6], enh: { boost: RECH, ioLevel: 49 } }, { level: slotAfter }], on: undefined });
  });

  it('a leveling build refuses when the old power cannot be taken at the later level', async () => {
    const b = build();
    // four other pools between the two picks: Combat Jumping's would be a fifth
    b.picks[4] = { power: pid(gd, 'Pool.Speed.Hasten'), level: P[4]!, slots: [{ level: P[4]! }] };
    b.picks[5] = { power: pid(gd, 'Pool.Fighting.Boxing'), level: P[5]!, slots: [{ level: P[5]! }] };
    b.picks[7] = { power: pid(gd, 'Pool.Leadership.Assault'), level: P[7]!, slots: [{ level: P[7]! }] };
    b.picks[8] = { power: pid(gd, 'Pool.Flight.Combat_Flight'), level: P[8]!, slots: [{ level: P[8]! }] };
    b.picks[9] = { power: GLINT, level: P[9]!, slots: [{ level: P[9]! }] };
    b.picks[6] = null;
    swap(b, 3, GLINT);
    const c = st().confirm!;
    expect(c.title).toBe("Can't swap these powers");
    expect(c.text).toMatch(/^Taking Glinting Eye at level 4 would move Combat Jumping to level \d+, but Combat Jumping can't be taken there: /);
    st().closeConfirm(true);
    await tick();
    expect(st().view).toBe('level');
    expect(st().level!.sub).toBe('power');
    expect(st().build).toBe(b);
  });

  it('a Respec build empties the later pick and has the old power chosen there again', async () => {
    const orig = build(49);
    swap(orig, 3, GLINT);
    const c = st().confirm!;
    expect(c.text).toBe(
      `Selecting Glinting Eye instead of Combat Jumping at level ${P[3]! + 1} will require that Combat Jumping be reselected at level ${P[6]! + 1}, as well as reinserting enhancement slots.`,
    );
    expect(c.sections).toEqual([{ heading: 'The following enhancements will be dropped:', lines: ['Invention: Recharge Reduction (50)', 'Invention: Recharge Reduction (50)'] }]);
    st().closeConfirm(true);
    await tick();
    // the level-10 power screen, Combat Jumping offered first
    let l = st().level!;
    expect([l.sub, l.mode, l.pendingPower, l.chain?.freed]).toEqual(['power', 'edit', CJ, [slotBetween, slotAfter]]);
    expect(l.base.picks[6]).toBeNull();
    st().finishLevel();
    await tick();
    // then the freed slots
    l = st().level!;
    expect(l.freed).toBe(true);
    expect(l.flow![0]!.slotLevels).toEqual([slotBetween, slotAfter]);
    expect(l.base.picks[6]).toEqual({ power: CJ, level: P[6], slots: [], on: undefined });
    // Cancel undoes it all
    st().cancelLevel();
    expect(st().build).toBe(orig);
  });

  it('greys a later power that cannot be taken this early, saying why', () => {
    const b = build();
    // the primary's power that opens latest
    const set = gd.powerset(sid(gd, 'Peacebringer_Offensive.Luminous_Blast'));
    const k = set.av.indexOf(Math.max(...set.av));
    const nova = set.p[k]!;
    const late = P.findIndex((lv) => lv >= set.av[k]!);
    b.picks[late + 2] = { power: nova, level: P[late + 2]!, slots: [{ level: P[late + 2]! }] };
    const base = { ...b, picks: b.picks.map((p, i) => (i === 3 ? null : p)) };
    const o = earlierOption(gd, base, 3, new BuildRules(gd, base).powerOption(nova, 3));
    expect(o.state).toBe('unavailable');
    expect(o.reason).toMatch(new RegExp(`^Your level ${P[late + 2]! + 1} power, and it can't be taken here: Available at level `));
    expect(earlierOption(gd, base, 3, new BuildRules(gd, base).powerOption(GLINT, 3)).state).toBe('available');
  });

  it('asks nothing in Advanced Respec', () => {
    swap(build(49), 3, GLINT, /*advanced=*/ true);
    expect(st().confirm).toBeNull();
    expect(st().level!.chain).toBeDefined();
  });

  it("a Respec build's freed slots placed on a later power are booked at or after its level when they can be", async () => {
    const orig = build(49);
    const all = (b: Build) => new BuildRules(gd, b).entries().flatMap((e) => e.slots.slice(1).map((s) => ({ owned: e.level, level: s.level })));
    const below = (b: Build) => all(b).filter((s) => s.level < s.owned).length;
    expect(below(orig)).toBe(0);
    // Quantum Acceleration takes no bought slots: Incandescence's two (at an early level) are freed
    swap(orig, 1, QUANTUM);
    st().closeConfirm(true);
    await tick();
    // both go on Glinting Eye, taken later than that level
    st().addPendingSlot('pick:6');
    st().addPendingSlot('pick:6');
    const placed = previewBuild(gd, steps, st().level!);
    expect(below(placed)).toBe(2);
    st().finishLevel();
    const b = st().build!;
    expect(st().view).toBe('overview');
    // the same levels, handed out again: one empty slot level is past both Combat Jumping's and
    // Glinting Eye's levels, so one slot below its power's level is the fewest there can be
    expect(all(b).map((s) => s.level).sort((x, y) => x - y)).toEqual(all(placed).map((s) => s.level).sort((x, y) => x - y));
    expect(below(b)).toBe(1);
    expect(b.picks[6]!.slots.length).toBe(3);
    // the slotted ones kept their levels
    expect(b.picks[3]!.slots.filter((s) => s.enh).map((s) => s.level)).toEqual(orig.picks[3]!.slots.filter((s) => s.enh).map((s) => s.level));
  });

  it('a pick chosen again may take a power the build has later still, chaining on to that pick', async () => {
    const HASTEN = pid(gd, 'Pool.Speed.Hasten');
    const orig = build(49);
    orig.picks[9] = { power: HASTEN, level: P[9]!, slots: [{ level: P[9]!, enh: { boost: RECH, ioLevel: 49 } }] };
    swap(orig, 3, GLINT);
    st().closeConfirm(true);
    await tick();
    // pick 6 chosen again: Hasten, taken at pick 9, is offered there
    let l = st().level!;
    const base = l.base;
    const rules = new BuildRules(gd, base);
    expect(earlierOption(gd, base, 6, rules.powerOption(HASTEN, 6)).state).toBe('available');
    st().choosePower(HASTEN);
    // the preview moves Hasten instead of counting it twice
    const shown = previewBuild(gd, steps, st().level!);
    expect(shown.picks.filter((p) => p?.power === HASTEN)).toHaveLength(1);
    expect(shown.picks[9]).toBeNull();
    st().finishLevel();
    const c = st().confirm!;
    expect(c.text).toBe(`Selecting Hasten at level ${P[6]! + 1} will require that a power be reselected at level ${P[9]! + 1}.`);
    st().closeConfirm(true);
    await tick();
    // pick 9 is chosen next, the slots to place still gathered
    l = st().level!;
    expect([l.sub, l.mode, l.chain?.freed]).toEqual(['power', 'edit', [slotBetween, slotAfter]]);
    expect(steps[l.step]!.picks[l.pickInStep]).toBe(9);
    expect(l.base.picks[6]).toMatchObject({ power: HASTEN, level: P[6] });
    expect(l.base.picks[6]!.slots[0]!.enh?.boost).toBe(RECH); // it moves with its enhancement
    expect(l.orig).toBe(orig);
    st().choosePower(CJ);
    st().finishLevel();
    await tick();
    l = st().level!;
    expect(l.freed).toBe(true);
    expect(l.flow![0]!.slotLevels).toEqual([slotBetween, slotAfter]);
    // Undo Swap still undoes it all
    st().cancelLevel();
    expect(st().build).toBe(orig);
  });
});

describe('review fixes', () => {
  const GLINT = pid(gd, 'Peacebringer_Offensive.Luminous_Blast.Glinting_Eye');
  const NOVA = pid(gd, 'Peacebringer_Offensive.Luminous_Blast.Bright_Nova');
  const BOLT = pid(gd, 'Peacebringer_Offensive.Luminous_Blast.Bright_Nova_Bolt');
  const CJ = pid(gd, 'Pool.Leaping.Combat_Jumping');
  const LEAP = pid(gd, 'Pool.Leaping.Leap');
  const between = gd.core.schedule.slot.find((l) => l > P[3]! && l < P[6]!)!;

  it('moving a form power up keeps what its granted powers hold, freeing only their early slots', async () => {
    const b = peacebringer();
    b.picks[3] = { power: NOVA, level: P[3]!, slots: [{ level: P[3]! }] };
    b.picks[6] = { power: GLINT, level: P[6]!, slots: [{ level: P[6]! }] };
    const after = gd.core.schedule.slot.find((l) => l > P[6]!)!;
    b.granted[BOLT] = { slots: [{ level: P[3]!, enh: { boost: RECH, ioLevel: 49 } }, { level: between, enh: { boost: DMG, ioLevel: 49 } }, { level: after, enh: { boost: DMG, ioLevel: 49 } }] };
    swap(b, 3, GLINT);
    const c = st().confirm!;
    expect(c.text).toMatch(/^Taking Glinting Eye at level 4 moves Bright Nova to level 10\. It frees 1 enhancement slot gained before level 10; you'll place it next\. The following enhancements will be dropped:$/);
    expect(c.sections![0]!.lines).toEqual(['Invention: Damage (50) (in Bright Nova Bolt)']);
    st().closeConfirm(true);
    await tick();
    const nb = st().level!.base;
    expect(nb.granted[BOLT]!.slots).toEqual([{ level: P[3]!, enh: { boost: RECH, ioLevel: 49 } }, { level: after, enh: { boost: DMG, ioLevel: 49 } }]);
    expect(st().level!.flow![0]!.slotLevels).toEqual([between]);
  });

  it('lists the picks a swap leaves breaking a rule, and asks even when nothing is dropped', () => {
    const b = peacebringer();
    const leapAt = P.findIndex((l) => l >= 13);
    b.picks[3] = { power: CJ, level: P[3]!, slots: [{ level: P[3]! }] };
    b.picks[4] = { power: pid(gd, 'Pool.Leaping.Long_Jump'), level: P[4]!, slots: [{ level: P[4]! }] };
    b.picks[leapAt] = { power: LEAP, level: P[leapAt]!, slots: [{ level: P[leapAt]! }] };
    swap(b, 3, pid(gd, 'Peacebringer_Offensive.Luminous_Blast.Gleaming_Blast'));
    const c = st().confirm!;
    expect(c.text).toBe('Changing Combat Jumping to Gleaming Blast for the level 4 power choice.');
    expect(c.sections).toEqual([{ heading: 'These picks will be flagged in red (they no longer meet a rule):', lines: [`Level ${P[leapAt]! + 1}: ${gd.power(LEAP).dn} (Requirements not met)`] }]);
  });

  it('a Respec build levels as usual past its respec level', () => {
    // respec to 4: picks 3 (level 4) and 6 (level 10) straddle it, so pick 6 takes the leveling path
    const b = peacebringer(P[3]!);
    b.picks[3] = { power: CJ, level: P[3]!, slots: [{ level: P[3]! }] };
    b.picks[6] = { power: GLINT, level: P[6]!, slots: [{ level: P[6]! }] };
    delete b.endLevel; // continued past its respec level
    swap(b, 3, GLINT, /*advanced=*/ true);
    expect(st().confirm!.text).toMatch(/^Taking Glinting Eye at level 4 moves Combat Jumping to level 10\./);
  });

  it('the totals preview never holds the power twice', () => {
    const b = peacebringer();
    b.picks[3] = { power: CJ, level: P[3]!, slots: [{ level: P[3]! }] };
    b.picks[6] = { power: GLINT, level: P[6]!, slots: [{ level: P[6]! }] };
    useStore.setState({ gd, steps, build: b, view: 'overview', level: undefined, confirm: null, advancedRespec: false });
    st().editPick(3);
    st().choosePower(GLINT);
    const pv = previewBuild(gd, steps, st().level!);
    expect(pv.picks.filter((p) => p?.power === GLINT)).toHaveLength(1);
    expect(pv.picks[6]?.power).toBe(CJ);
  });

  it('a pick past the stop level is not offered for taking earlier', () => {
    const b = peacebringer();
    b.picks[9] = { power: GLINT, level: P[9]!, slots: [{ level: P[9]! }] };
    expect(laterPick(b, 3, GLINT)).toBe(9);
    expect(laterPick({ ...b, endLevel: P[5]! }, 3, GLINT)).toBe(-1);
  });

  it('ignores the second click of a double-click in Advanced Respec', () => {
    expect(autoAdvanceReady()).toBe(true);
    expect(autoAdvanceReady()).toBe(false);
  });
});

describe("level 1's orb", () => {
  /** Reopen level 1 from its orb: its primary pick, then its secondary. */
  const reopenLevelOne = (b: Build) => {
    useStore.setState({ gd, steps, build: b, view: 'overview', level: undefined, confirm: null, advancedRespec: false });
    const level1 = steps.find((s) => s.level === 0)!;
    st().editPick(level1.picks[0]!, level1.picks.slice(1));
    return level1;
  };

  it('opens the primary pick, then the secondary, then the overview', () => {
    const level1 = reopenLevelOne(peacebringer());
    expect(st().level).toMatchObject({ mode: 'edit', pickInStep: 0 });
    st().choosePower(BOLT); // unchanged: no question
    st().finishLevel();
    expect(st().view).toBe('level');
    expect(st().level).toMatchObject({ mode: 'edit', pickInStep: level1.picks.indexOf(1) });
    st().finishLevel();
    expect(st().view).toBe('overview');
    expect(st().level).toBeUndefined();
  });

  it('goes on to the secondary after a swap it asked about, keeping the swap', async () => {
    reopenLevelOne(peacebringer());
    st().choosePower(INNER_LIGHT);
    st().finishLevel();
    st().closeConfirm(true);
    await tick();
    expect(st().view).toBe('level');
    expect(st().level?.pickInStep).toBe(1);
    expect(st().build!.picks[0]!.power).toBe(INNER_LIGHT);
    // Cancel on the secondary keeps the primary's change
    st().cancelLevel();
    expect(st().view).toBe('overview');
    expect(st().build!.picks[0]!.power).toBe(INNER_LIGHT);
  });

  it('stops at the first screen on Cancel', () => {
    reopenLevelOne(peacebringer());
    st().cancelLevel();
    expect(st().view).toBe('overview');
    expect(st().build!.picks[0]!.power).toBe(BOLT);
  });
});
