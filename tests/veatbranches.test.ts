import { describe, expect, it } from 'vitest';
import { setPick } from '../src/engine/actions.ts';
import { newBuild, type Build } from '../src/engine/build.ts';
import { checkBuild } from '../src/engine/validate.ts';
import { BuildRules, startingSets } from '../src/engine/rules.ts';
import { loadData, pid } from './helpers/data.ts';

const gd = loadData();
// the first pick at a level (0-based)
const pickAt = (level: number) => gd.core.schedule.power.findIndex((lv) => lv >= level);

/** @return A new Arachnos build on its trunk sets; a Respec build when `respecTo` is given (0-based). */
function arachnos(atName: string, respecTo?: number): Build {
  const at = gd.archetypeByName.get(atName)!;
  return newBuild({
    name: 'Arachnos',
    at: at.id,
    origin: gd.core.origins[0]!.id,
    alignment: 'Villain',
    primary: startingSets(gd, at.cats.pri, at)[0]!.id,
    secondary: startingSets(gd, at.cats.sec, at)[0]!.id,
    dataVersion: gd.core.manifest.dataVersion,
    pickCount: gd.core.schedule.power.length,
    server: gd.server,
    respecTo,
  });
}

const state = (b: Build, power: string, pick: number) => new BuildRules(gd, b).powerOption(pid(gd, power), pick);

describe('Arachnos branches (SpecializeAt 24)', () => {
  it('open from the first pick of a respec at 24 or above, as the game checks the respec level', () => {
    for (const respecTo of [23, 49]) {
      const soldier = arachnos('class_arachnos_soldier', respecTo);
      expect(state(soldier, 'Arachnos_Soldiers.Crab_Spider_Soldier.Channelgun', 0).state, `Channelgun, respec to ${respecTo + 1}`).toBe('available');
      expect(state(soldier, 'Arachnos_Soldiers.Bane_Spider_Soldier.BS_Bash', 0).state).toBe('available');
      const widow = arachnos('class_arachnos_widow', respecTo);
      expect(state(widow, 'Widow_Training.Fortunata_Training.FRT_Mental_Blast', 0).state).toBe('available');
      expect(state(widow, 'Widow_Training.Night_Widow_Training.NW_Mental_Blast', 0).state).toBe('available');
    }
  });

  it('keep their own power levels in a respec', () => {
    const b = arachnos('class_arachnos_soldier', 49);
    const o = state(b, 'Arachnos_Soldiers.Crab_Spider_Soldier.Frenzy', pickAt(0));
    expect(o.state).toBe('unavailable');
    expect(o.reason).toBe('Available at level 22');
  });

  it('stay shut in a respec below 24', () => {
    const o = state(arachnos('class_arachnos_soldier', 19), 'Arachnos_Soldiers.Crab_Spider_Soldier.Channelgun', 0);
    expect(o.state).toBe('unavailable');
    expect(o.reason).toBe('Available at level 24');
  });

  it('open at 24 when leveling', () => {
    const b = arachnos('class_arachnos_soldier');
    expect(state(b, 'Arachnos_Soldiers.Crab_Spider_Soldier.Channelgun', pickAt(7)).reason).toBe('Available at level 24');
    expect(state(b, 'Arachnos_Soldiers.Crab_Spider_Soldier.Channelgun', pickAt(23)).state).toBe('available');
  });

  it('take the path from the first branch power: the other branch closes', () => {
    const b = setPick(gd, arachnos('class_arachnos_soldier', 49), 0, pid(gd, 'Arachnos_Soldiers.Crab_Spider_Soldier.Channelgun'));
    const later = pickAt(1);
    expect(state(b, 'Arachnos_Soldiers.Crab_Spider_Soldier.Longfang', later).state).toBe('available');
    const bane = state(b, 'Arachnos_Soldiers.Bane_Spider_Soldier.Mace_Beam_Blast', later);
    expect(bane.state).toBe('unavailable');
    expect(bane.reason).toBe('Another specialization is chosen');
    expect(state(b, 'Training_Gadgets.Bane_Spider_Training.Bane_Spider_Armor', later).reason).toBe('Another specialization is chosen');
  });

  it('pass the build checks with a branch power at level 1 in a respec, and flag it when leveling', () => {
    const power = pid(gd, 'Arachnos_Soldiers.Crab_Spider_Soldier.Channelgun');
    const respec = setPick(gd, arachnos('class_arachnos_soldier', 49), 0, power);
    expect(new BuildRules(gd, respec).issues().filter((i) => i.key === 'pick:0')).toEqual([]);
    expect(checkBuild(gd, respec).build?.picks[0]?.power).toBe(power);
    const leveling = setPick(gd, arachnos('class_arachnos_soldier'), 0, power);
    expect(new BuildRules(gd, leveling).issues().find((i) => i.key === 'pick:0')?.message).toBe('Available at level 24');
  });
});
