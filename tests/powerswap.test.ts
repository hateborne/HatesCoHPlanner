/**
 * Swapping a power from the overview (store.finishSwap): the question listing the enhancements a
 * swap drops and keeps, Cancel staying on the power screen, the freed-slot screen, and Advanced
 * Respec, which asks nothing.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { earlierOption } from '../src/engine/actions.ts';
import { newBuild, type Build } from '../src/engine/build.ts';
import { BuildRules } from '../src/engine/rules.ts';
import { levelSteps } from '../src/engine/schedule.ts';
import { useStore } from '../src/state/store.ts';
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
});
