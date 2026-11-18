/**
 * Swapping a power from the overview (store.finishSwap): the question listing the enhancements a
 * swap drops and keeps, Cancel staying on the power screen, the freed-slot screen, and Advanced
 * Respec, which asks nothing.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { newBuild, type Build } from '../src/engine/build.ts';
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
    expect(st().confirm!.text).toMatch(/^Changing Incandescence to Quantum Acceleration for the level 1 power choice frees 2 enhancement slots \(gained at level /);
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
