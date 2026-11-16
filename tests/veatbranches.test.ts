/**
 * Arachnos Soldier and Widow branches: their level 24 (SpecializeAt 23) checked against the
 * character's level, the respec their training to 24 forces (LevelUpRespecs, which makes New Build
 * plan them as Respec builds), the other branch hidden once one is chosen, and a power offered
 * again with its pool.
 */
import { describe, expect, it } from 'vitest';
import { setPick } from '../src/engine/actions.ts';
import { newBuild, type Build } from '../src/engine/build.ts';
import { checkBuild } from '../src/engine/validate.ts';
import { BuildRules, levelUpRespec, respecOnlyNote, startingSets } from '../src/engine/rules.ts';
import { levelSteps } from '../src/engine/schedule.ts';
import { currentPick, useStore } from '../src/state/store.ts';
import { loadData, pid } from './helpers/data.ts';

const gd = loadData();
const steps = levelSteps(gd.core);
const AT24 = 23; // 0-based level 24
// the first pick at a level (0-based)
const pickAt = (level: number) => gd.core.schedule.power.findIndex((lv) => lv >= level);
const CHANNELGUN = 'Arachnos_Soldiers.Crab_Spider_Soldier.Channelgun';

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
const listed = (r: BuildRules, pick: number) => r.setOptions(pick).map((o) => o.set.n);

describe('Arachnos branches (open at level 24)', () => {
  it('come with a respec on training to 24 (LevelUpRespecs), for the Arachnos archetypes only', () => {
    for (const at of gd.core.archetypes) {
      expect(levelUpRespec(gd, at), at.n).toBe(/arachnos/i.test(at.n) ? AT24 : undefined);
    }
  });

  it('make New Build plan those archetypes as a Respec, and say why', () => {
    const soldier = respecOnlyNote(gd, gd.archetypeByName.get('class_arachnos_soldier')!)!;
    expect(soldier.title).toBe('Respec at Level 24');
    expect(soldier.text).toBe(
      'Arachnos Soldiers must Respec at level 24 to select their archetype path, Bane Spider or Crab Spider. To avoid confusion, Arachnos Soldier builds will only be planned as a Respec build.',
    );
    expect(respecOnlyNote(gd, gd.archetypeByName.get('class_arachnos_widow')!)!.text).toBe(
      'Arachnos Widows must Respec at level 24 to select their archetype path, Night Widow or Fortunata. To avoid confusion, Arachnos Widow builds will only be planned as a Respec build.',
    );
    expect(respecOnlyNote(gd, gd.archetypeByName.get('class_blaster')!)).toBeNull();
  });

  it('open from the first pick of a respec at 24 or above, as the game checks the respec level', () => {
    for (const respecTo of [23, 49]) {
      const soldier = arachnos('class_arachnos_soldier', respecTo);
      expect(state(soldier, CHANNELGUN, 0).state, `Channelgun, respec to ${respecTo + 1}`).toBe('available');
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
    const o = state(arachnos('class_arachnos_soldier', 19), CHANNELGUN, 0);
    expect(o.state).toBe('unavailable');
    expect(o.reason).toBe('Available at level 24');
  });

  it('open from level 1 in a leveling build (a link or an import) that goes past 24, and stay shut in one stopped before', () => {
    const b = arachnos('class_arachnos_soldier');
    expect(state(b, CHANNELGUN, 0).state).toBe('available');
    expect(state({ ...b, endLevel: AT24 }, CHANNELGUN, 0).state).toBe('available');
    expect(state({ ...b, endLevel: 21 }, CHANNELGUN, 0).reason).toBe('Available at level 24');
    // a respec below 24 that levels on past it gets the training respec too
    const continued = { ...arachnos('class_arachnos_soldier', 19), endLevel: undefined };
    expect(new BuildRules(gd, continued).respecLevel()).toBe(AT24);
    expect(new BuildRules(gd, arachnos('class_arachnos_soldier', 19)).respecLevel()).toBe(19);
  });

  it('take the path from the first branch power: the other branch closes, and is no longer listed', () => {
    const fresh = new BuildRules(gd, arachnos('class_arachnos_soldier', 49));
    // both listed, as the game lists every branch the character may still take
    expect(listed(fresh, 0)).toEqual(expect.arrayContaining(['Arachnos_Soldiers.Bane_Spider_Soldier', 'Arachnos_Soldiers.Crab_Spider_Soldier']));
    const b = setPick(gd, arachnos('class_arachnos_soldier', 49), 0, pid(gd, CHANNELGUN));
    const later = pickAt(1);
    expect(state(b, 'Arachnos_Soldiers.Crab_Spider_Soldier.Longfang', later).state).toBe('available');
    const bane = state(b, 'Arachnos_Soldiers.Bane_Spider_Soldier.Mace_Beam_Blast', later);
    expect(bane.state).toBe('unavailable');
    expect(bane.reason).toBe('Another specialization is chosen');
    const sets = listed(new BuildRules(gd, b), later);
    expect(sets).toContain('Arachnos_Soldiers.Crab_Spider_Soldier');
    expect(sets).toContain('Training_Gadgets.Crab_Spider_Training');
    expect(sets).not.toContain('Arachnos_Soldiers.Bane_Spider_Soldier');
    expect(sets).not.toContain('Training_Gadgets.Bane_Spider_Training');
    // re-making the pick that chose the path opens both again
    expect(listed(new BuildRules(gd, b), 0)).toContain('Arachnos_Soldiers.Bane_Spider_Soldier');
  });

  it('pass the build checks with a branch power at level 1 in a build past 24, and flag it in one stopped before', () => {
    const power = pid(gd, CHANNELGUN);
    for (const b of [setPick(gd, arachnos('class_arachnos_soldier', 49), 0, power), setPick(gd, arachnos('class_arachnos_soldier'), 0, power)]) {
      expect(new BuildRules(gd, b).issues().filter((i) => i.key === 'pick:0')).toEqual([]);
      expect(checkBuild(gd, b).build?.picks[0]?.power).toBe(power);
    }
    const stopped = { ...setPick(gd, arachnos('class_arachnos_soldier'), 0, power), endLevel: 21 };
    expect(new BuildRules(gd, stopped).issues().find((i) => i.key === 'pick:0')?.message).toBe('Available at level 24');
  });

  it('let the slots up to 24 go on any power in a leveling build past 24', () => {
    const b = arachnos('class_arachnos_soldier');
    expect(new BuildRules(gd, b).slotsAnyPower(4)).toBe(true);
    expect(new BuildRules(gd, b).slotsAnyPower(AT24 + 1)).toBe(false);
    expect(new BuildRules(gd, { ...b, endLevel: 21 }).slotsAnyPower(4)).toBe(false);
    // other archetypes never respec on training
    const blaster = { ...b, at: gd.archetypeByName.get('class_blaster')!.id };
    expect(new BuildRules(gd, blaster).slotsAnyPower(4)).toBe(false);
  });
});

describe('a power offered again', () => {
  const blaster = () => {
    useStore.setState({ gd, steps, build: undefined, level: undefined, view: 'setup', confirm: null });
    const at = gd.archetypeByName.get('class_blaster')!;
    useStore.getState().startBuild({ name: 'Blaster', at: at.id, origin: gd.core.origins[0]!.id, alignment: 'Hero', primary: startingSets(gd, at.cats.pri, at)[0]!.id, secondary: startingSets(gd, at.cats.sec, at)[0]!.id });
  };

  it('brings its pool along on Back and on a level reopened from the overview, when it was the only one from it', () => {
    blaster();
    const pick = pickAt(3);
    for (let g = 0; g < 100; g++) {
      const l = useStore.getState().level!;
      if (l.sub === 'power' && currentPick(steps, l) === pick) break;
      if (l.sub === 'slots') {
        useStore.getState().finishLevel(); // no slots needed for this
        continue;
      }
      const r = new BuildRules(gd, l.base);
      useStore.getState().choosePower(r.setOptions(currentPick(steps, l)).flatMap((o) => o.powers).find((o) => o.state === 'available')!.power.id);
      useStore.getState().finishLevel();
    }
    const cj = pid(gd, 'Pool.Leaping.Combat_Jumping');
    const leaping = gd.setOfPower.get(cj)!.set.id;
    useStore.getState().closeSetPicker(leaping, cj);
    useStore.getState().finishLevel();
    useStore.getState().backLevel();
    expect(useStore.getState().level!.pendingPower).toBe(cj);
    expect(useStore.getState().level!.pendingSet).toBe(leaping);
    useStore.getState().finishLevel();
    useStore.getState().stopHere(false);
    useStore.getState().editPick(pick);
    expect(useStore.getState().level!.pendingSet).toBe(leaping);
    // a power from the primary needs no set brought along
    useStore.getState().cancelLevel();
    useStore.getState().editPick(0);
    expect(useStore.getState().level!.pendingSet).toBeUndefined();
  });
});
