/**
 * Arachnos Soldier and Widow branches: SpecializeAt 24 checked against the character's level, the
 * respec their training to 24 forces (LevelUpRespecs), the other branch hidden once one is chosen,
 * and the leveling wizard walking that respec.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { setPick } from '../src/engine/actions.ts';
import { newBuild, type Build } from '../src/engine/build.ts';
import { checkBuild } from '../src/engine/validate.ts';
import { BuildRules, forcedRespecNote, levelUpRespec, startingSets } from '../src/engine/rules.ts';
import { levelSteps, respecSteps, stepSlotLevels, withForcedRespec } from '../src/engine/schedule.ts';
import { continueTarget, currentPick, levelRules, previewBuild, stepsOf, useStore } from '../src/state/store.ts';
import { loadData, pid } from './helpers/data.ts';

const gd = loadData();
const steps = levelSteps(gd.core);
const AT24 = 23; // 0-based level 24
// the first pick at a level (0-based)
const pickAt = (level: number) => gd.core.schedule.power.findIndex((lv) => lv >= level);
const CHANNELGUN = 'Arachnos_Soldiers.Crab_Spider_Soldier.Channelgun';
const CRAB_ARMOR = 'Training_Gadgets.Crab_Spider_Training.Crab_Spider_Armor';

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

const state = (b: Build, power: string, pick: number, reach?: number) => new BuildRules(gd, b, reach).powerOption(pid(gd, power), pick);
const listed = (r: BuildRules, pick: number) => r.setOptions(pick).map((o) => o.set.n);

describe('Arachnos branches (SpecializeAt 24)', () => {
  it('come with a respec on training to 24 (LevelUpRespecs), for the Arachnos archetypes only', () => {
    for (const at of gd.core.archetypes) {
      expect(levelUpRespec(gd, at), at.n).toBe(/arachnos/i.test(at.n) ? AT24 : undefined);
    }
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

  it('stay shut while leveling to 23, and open from the first pick once the character reaches 24', () => {
    const b = arachnos('class_arachnos_soldier');
    expect(state(b, CHANNELGUN, pickAt(7), /*reach=*/ 7).reason).toBe('Available at level 24');
    expect(state(b, CHANNELGUN, 0, /*reach=*/ 22).reason).toBe('Available at level 24');
    expect(state(b, CHANNELGUN, 0, /*reach=*/ AT24).state).toBe('available');
    // outside the wizard a build reaches its last level: 50, or where it stopped
    expect(state(b, CHANNELGUN, 0).state).toBe('available');
    expect(state({ ...b, endLevel: 21 }, CHANNELGUN, 0).reason).toBe('Available at level 24');
    expect(state({ ...b, endLevel: AT24 }, CHANNELGUN, 0).state).toBe('available');
  });

  it('open from the first pick of a respec below 24 once the build levels past 24 (the training respec)', () => {
    const b = arachnos('class_arachnos_soldier', 19);
    expect(state(b, CHANNELGUN, 0, /*reach=*/ 30).state).toBe('available');
    expect(new BuildRules(gd, b, 30).respecLevel()).toBe(AT24);
    expect(new BuildRules(gd, b).respecLevel()).toBe(19);
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

  it('let the slots up to 24 go on any power once the build is past 24', () => {
    const b = arachnos('class_arachnos_soldier');
    expect(new BuildRules(gd, b).slotsAnyPower(4)).toBe(true);
    expect(new BuildRules(gd, b).slotsAnyPower(AT24 + 1)).toBe(false);
    expect(new BuildRules(gd, b, /*reach=*/ 10).slotsAnyPower(4)).toBe(false);
    expect(new BuildRules(gd, { ...b, endLevel: 21 }).slotsAnyPower(4)).toBe(false);
    // other archetypes never respec on training
    const blaster = { ...b, at: gd.archetypeByName.get('class_blaster')!.id };
    expect(new BuildRules(gd, blaster).slotsAnyPower(4)).toBe(false);
  });

  it('say so when the wizard reaches the respec', () => {
    const n = forcedRespecNote(gd, arachnos('class_arachnos_soldier'), AT24);
    expect(n.title).toBe('Respec at Level 24');
    expect(n.text).toContain('Arachnos Soldiers train to level 24 only through a respec.');
    expect(n.text).toContain('Crab Spider Soldier');
    expect(n.text).toContain('Bane Spider Training');
  });
});

describe('the leveling order with the forced respec (withForcedRespec)', () => {
  const flow = withForcedRespec(steps, AT24);

  it('asks the levels before 24, then the respec to 24 in its own order, then the levels after it', () => {
    const at = flow.findIndex((s) => s.rewalk);
    const after = flow.findIndex((s, i) => i > at && !s.rewalk);
    expect(flow.slice(0, at)).toEqual(steps.filter((s) => s.level < AT24));
    expect(flow.slice(at, after)).toEqual(respecSteps(steps, AT24).map((s) => ({ ...s, rewalk: true })));
    expect(flow.slice(after)).toEqual(steps.filter((s) => s.level > AT24));
    expect(flow.slice(at, after).every((s) => s.respec === AT24)).toBe(true);
  });
});

describe('the leveling wizard at 24', () => {
  const start = () => {
    useStore.setState({ gd, steps, build: undefined, level: undefined, view: 'setup', confirm: null });
    const b = arachnos('class_arachnos_soldier');
    useStore.getState().startBuild({ name: 'Soldier', at: b.at, origin: b.origin, alignment: 'Villain', primary: b.primary, secondary: b.secondary });
  };
  const level = () => useStore.getState().level!;
  const step = () => stepsOf(steps, level())[level().step]!;
  const rules = () => levelRules(gd, steps, level());

  /** Keep the choice offered (a forced respec's), else take the first legal power, and press Next. */
  const pickAndNext = () => {
    const l = level();
    if (l.pendingPower === undefined) {
      const pick = currentPick(steps, l);
      const chosen = rules().setOptions(pick).flatMap((o) => o.powers).find((o) => o.state === 'available')?.power.id;
      expect(chosen, `a legal power at pick ${pick}`).toBeDefined();
      useStore.getState().choosePower(chosen);
    }
    useStore.getState().finishLevel();
  };

  /** Place the slots still to place on this screen, and press Next. */
  const slotAndNext = () => {
    const s = step();
    const levels = stepSlotLevels(s);
    for (let k = 0; k < 200; k++) {
      const r = levelRules(gd, steps, level(), previewBuild(gd, steps, level()));
      if (r.slotsLeft(levels) <= 0) break;
      const cands = r.entries().filter((e) => r.slotBlock(e, s.level, levels) === null);
      expect(cands.length).toBeGreaterThan(0);
      useStore.getState().addPendingSlot(cands[k % cands.length]!.key);
    }
    useStore.getState().finishLevel();
  };

  /** Walk the wizard until the first screen of the forced respec. */
  const toRespec = () => {
    for (let g = 0; g < 100 && !step().rewalk; g++) (level().sub === 'slots' ? slotAndNext : pickAndNext)();
    expect(step().rewalk).toBe(true);
  };

  beforeEach(start);

  it('keeps the branches greyed before 24', () => {
    for (let g = 0; g < 100 && (step().level < 10 || level().sub !== 'power'); g++) (level().sub === 'slots' ? slotAndNext : pickAndNext)();
    const pick = currentPick(steps, level());
    expect(rules().powerOption(pid(gd, CHANNELGUN), pick).reason).toBe('Available at level 24');
    expect(useStore.getState().confirm).toBeNull();
  });

  it('respecs at 24: says so, offers every choice again with the branches open, and goes on leveling', () => {
    toRespec();
    expect(useStore.getState().confirm?.title).toBe('Respec at Level 24');
    useStore.getState().closeConfirm(true);
    const before = useStore.getState().build!;
    // level 1's secondary first, its earlier choice offered
    expect(currentPick(steps, level())).toBe(1);
    expect(level().pendingPower).toBe(before.picks[1]!.power);
    expect(rules().powerOption(pid(gd, CRAB_ARMOR), 1).state).toBe('available');
    useStore.getState().choosePower(pid(gd, CRAB_ARMOR));
    useStore.getState().finishLevel();
    // the primary: Channelgun open, the Bane Spider sets gone
    expect(currentPick(steps, level())).toBe(0);
    expect(rules().powerOption(pid(gd, CHANNELGUN), 0).state).toBe('available');
    expect(listed(rules(), 0)).not.toContain('Arachnos_Soldiers.Bane_Spider_Soldier');
    useStore.getState().choosePower(pid(gd, CHANNELGUN));
    useStore.getState().finishLevel();
    // Back keeps the respec's choices and the ones it hasn't reached
    const next = currentPick(steps, level());
    useStore.getState().backLevel();
    expect(level().pendingPower).toBe(pid(gd, CHANNELGUN));
    expect(useStore.getState().build!.picks[next]?.power).toBe(before.picks[next]!.power);
    useStore.getState().finishLevel();
    // the rest kept as they were, then the new level 24 power, then every slot up to 24
    for (let g = 0; g < 30 && level().sub === 'power' && step().rewalk; g++) pickAndNext();
    expect(level().sub).toBe('slots');
    expect(step().rewalk).toBe(true);
    slotAndNext();
    expect(step().rewalk).toBeFalsy();
    expect(step().level).toBeGreaterThan(AT24);
    const b = useStore.getState().build!;
    expect(gd.power(b.picks[0]!.power).n).toBe(CHANNELGUN);
    expect(gd.power(b.picks[1]!.power).n).toBe(CRAB_ARMOR);
    for (let i = 2; i < pickAt(22); i++) expect(b.picks[i]?.power, `pick ${i}`).toBe(before.picks[i]!.power);
    // the slots made before the respec are all still placed
    // (the respec gives them levels anew, as a Respec's slot screen does)
    const count = (x: Build) => x.picks.reduce((n, p) => n + Math.max(0, (p?.slots.length ?? 0) - 1), 0);
    expect(count(b)).toBe(count(before));
    expect(b.picks.slice(0, pickAt(22)).map((p) => p!.slots.length)).toEqual(before.picks.slice(0, pickAt(22)).map((p) => p!.slots.length));
    expect(new BuildRules(gd, b).issues()).toEqual([]);
  });

  it('Back out of the respec restores its first choice', () => {
    toRespec();
    useStore.getState().closeConfirm(true);
    const power = useStore.getState().build!.picks[1]!.power;
    useStore.getState().backLevel();
    expect(step().rewalk).toBeFalsy();
    expect(useStore.getState().build!.picks[1]?.power).toBe(power);
  });

  it('Back out of the respec undoes what it changed', () => {
    toRespec();
    useStore.getState().closeConfirm(true);
    const before = useStore.getState().build!;
    useStore.getState().choosePower(pid(gd, CRAB_ARMOR));
    useStore.getState().finishLevel();
    useStore.getState().choosePower(pid(gd, CHANNELGUN));
    useStore.getState().finishLevel();
    for (let g = 0; g < 5 && step().rewalk; g++) useStore.getState().backLevel();
    expect(step().rewalk).toBeFalsy();
    const b = previewBuild(gd, steps, level());
    expect(b.picks[0]?.power).toBe(before.picks[0]!.power);
    expect(b.picks[1]?.power).toBe(before.picks[1]!.power);
    expect(new BuildRules(gd, b, step().level).issues()).toEqual([]);
  });

  it('offers a pool power again with its pool shown when it was the only one from it', () => {
    const pick = pickAt(3); // the first pick that may open a pool
    for (let g = 0; g < 100 && currentPick(steps, level()) !== pick; g++) (level().sub === 'slots' ? slotAndNext : pickAndNext)();
    expect(rules().canAddNewSet('pool', pick)).toBe(true);
    const cj = pid(gd, 'Pool.Leaping.Combat_Jumping');
    const leaping = gd.setOfPower.get(cj)!.set.id;
    useStore.getState().closeSetPicker(leaping, cj);
    useStore.getState().finishLevel();
    toRespec();
    useStore.getState().closeConfirm(true);
    for (let g = 0; g < 30 && currentPick(steps, level()) !== pick; g++) pickAndNext();
    expect(level().pendingPower).toBe(cj);
    expect(level().pendingSet).toBe(leaping);
  });

  it('a build stopped in the respec ends at 24, and Continue Leveling starts the respec again', () => {
    toRespec();
    useStore.getState().closeConfirm(true);
    useStore.getState().choosePower(pid(gd, CRAB_ARMOR));
    useStore.getState().finishLevel();
    useStore.getState().stopHere(false);
    const b = useStore.getState().build!;
    expect(b.endLevel).toBe(AT24);
    expect(gd.power(b.picks[1]!.power).n).toBe(CRAB_ARMOR);
    const where = continueTarget(gd, b, steps)!;
    expect(where.target.rewalk).toBe(true);
    expect(where.target.picks).toEqual([1, 0]);
    useStore.getState().continueLeveling();
    expect(currentPick(steps, level())).toBe(1);
    expect(level().pendingPower).toBe(pid(gd, CRAB_ARMOR));
    expect(useStore.getState().confirm?.title).toBe('Respec at Level 24');
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
      const r = levelRules(gd, steps, l);
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
