import { describe, expect, it } from 'vitest';
import { newBuild, type Build } from '../src/engine/build.ts';
import { evalRequires, type EvalContext } from '../src/engine/requires.ts';
import { BuildRules } from '../src/engine/rules.ts';
import { levelSteps } from '../src/engine/schedule.ts';
import { loadData, pid, sid } from './helpers/data.ts';

const gd = loadData();

function blaster(): Build {
  const at = gd.archetypeByName.get('class_blaster')!;
  return newBuild({
    dataVersion: gd.core.manifest.dataVersion,
    at: at.id,
    origin: gd.core.origins[0]!.id,
    alignment: 'Hero',
    primary: sid(gd, 'Blaster_Ranged.Fire_Blast'),
    secondary: sid(gd, 'Blaster_Support.Fire_Manipulation'),
    pickCount: gd.core.schedule.power.length,
  });
}

function pick(b: Build, i: number, name: string): void {
  b.picks[i] = { power: pid(gd, name), level: gd.core.schedule.power[i]!, slots: [] };
}

describe('schedule', () => {
  it('grants 24 picks and 67 slots', () => {
    expect(gd.core.schedule.power).toHaveLength(24);
    expect(gd.core.schedule.slot).toHaveLength(67);
    const steps = levelSteps(gd.core);
    expect(steps[0]).toEqual({ level: 0, picks: [0, 1], slots: 0 });
    expect(steps.find((s) => s.level === 2)?.slots).toBe(2);
    expect(steps.find((s) => s.level === 49)?.slots).toBe(3);
  });
});

describe('requires evaluator', () => {
  const ctx = (owned: string[], at = 'Class_Blaster'): EvalContext => ({
    ownsPower: (n) => owned.includes(n.toLowerCase()),
    ownsSet: () => false,
    prop: (n) => (n === 'archetype' ? at : n === 'level' ? 10 : 0),
  });
  it('treats bare power names as ownership', () => {
    expect(evalRequires(['pool.flight.fly'], ctx(['pool.flight.fly']))).toBe(true);
    expect(evalRequires(['pool.flight.fly'], ctx([]))).toBe(false);
  });
  it('handles 2-of-3 pool prerequisites', () => {
    const req = ['A', 'B', '&&', 'A', 'C', '&&', '||', 'B', 'C', '&&', '||'];
    expect(evalRequires(req, ctx(['a', 'c']))).toBe(true);
    expect(evalRequires(req, ctx(['a']))).toBe(false);
  });
  it('compares archetype strings case-insensitively', () => {
    const req = ['$archetype', '@Class_Blaster', '=='];
    expect(evalRequires(req, ctx([], 'class_blaster'))).toBe(true);
    expect(evalRequires(req, ctx([], 'Class_Tanker'))).toBe(false);
  });
  it('rejects account-gated and disabled powers', () => {
    expect(evalRequires(['0'], ctx([]))).toBe(false);
    expect(evalRequires(['Preorder:Generic', 'auth>', 'VetSprints', 'Owned?', '||'], ctx([]))).toBe(false);
  });
});

describe('power picks', () => {
  it('locks columns for the two level 1 picks', () => {
    const r = new BuildRules(gd, blaster());
    const flares = r.powerOption(pid(gd, 'Blaster_Ranged.Fire_Blast.Flares'), 0);
    const ring = r.powerOption(pid(gd, 'Blaster_Support.Fire_Manipulation.Ring_of_Fire'), 0);
    expect(flares.state).toBe('available');
    expect(ring.state).toBe('unavailable');
    const b = blaster();
    pick(b, 0, 'Blaster_Ranged.Fire_Blast.Flares');
    const r2 = new BuildRules(gd, b);
    expect(r2.powerOption(pid(gd, 'Blaster_Support.Fire_Manipulation.Ring_of_Fire'), 1).state).toBe('available');
    expect(r2.powerOption(pid(gd, 'Blaster_Ranged.Fire_Blast.Fire_Blast'), 1).state).toBe('unavailable');
  });

  it('gates powers by their available level', () => {
    const b = blaster();
    pick(b, 0, 'Blaster_Ranged.Fire_Blast.Flares');
    pick(b, 1, 'Blaster_Support.Fire_Manipulation.Ring_of_Fire');
    const r = new BuildRules(gd, b);
    // pick 2 is character level 2: Fire Ball (level 2) yes, Blaze (level 18) no
    expect(r.powerOption(pid(gd, 'Blaster_Ranged.Fire_Blast.Fire_Ball'), 2).state).toBe('available');
    expect(r.powerOption(pid(gd, 'Blaster_Ranged.Fire_Blast.Blaze'), 2).state).toBe('unavailable');
  });

  it('opens pools at level 4 and enforces pool prerequisites', () => {
    const b = blaster();
    pick(b, 0, 'Blaster_Ranged.Fire_Blast.Flares');
    pick(b, 1, 'Blaster_Support.Fire_Manipulation.Ring_of_Fire');
    pick(b, 2, 'Blaster_Ranged.Fire_Blast.Fire_Ball');
    const r = new BuildRules(gd, b);
    expect(r.canAddNewSet('pool', 2)).toBe(false); // level 2
    expect(r.canAddNewSet('pool', 3)).toBe(true); // level 4
    expect(r.powerOption(pid(gd, 'Pool.Flight.Fly'), 3).state).toBe('available');
    pick(b, 3, 'Pool.Flight.Fly');
    pick(b, 4, 'Pool.Flight.Combat_Flight');
    const r2 = new BuildRules(gd, b);
    // Group Fly needs 2 of the first 3 and level 14 (pick 7 = level 12, pick 8 = level 14)
    expect(r2.powerOption(pid(gd, 'Pool.Flight.Group_Fly'), 7).state).toBe('unavailable');
    expect(r2.powerOption(pid(gd, 'Pool.Flight.Group_Fly'), 8).state).toBe('available');
    const one = blaster();
    pick(one, 0, 'Blaster_Ranged.Fire_Blast.Flares');
    pick(one, 1, 'Blaster_Support.Fire_Manipulation.Ring_of_Fire');
    pick(one, 3, 'Pool.Flight.Fly');
    expect(new BuildRules(gd, one).powerOption(pid(gd, 'Pool.Flight.Group_Fly'), 8).state).toBe('unavailable');
  });

  it('limits pools to four', () => {
    const b = blaster();
    pick(b, 0, 'Blaster_Ranged.Fire_Blast.Flares');
    pick(b, 1, 'Blaster_Support.Fire_Manipulation.Ring_of_Fire');
    pick(b, 3, 'Pool.Flight.Combat_Flight');
    pick(b, 4, 'Pool.Speed.Hasten');
    pick(b, 5, 'Pool.Leaping.Combat_Jumping');
    pick(b, 6, 'Pool.Fighting.Boxing');
    const r = new BuildRules(gd, b);
    expect(r.canAddNewSet('pool', 7)).toBe(false);
    expect(r.powerOption(pid(gd, 'Pool.Leadership.Defense'), 7).state).toBe('unavailable');
    // a power from an already-owned pool is still fine
    expect(r.powerOption(pid(gd, 'Pool.Fighting.Kick'), 7).state).toBe('available');
  });

  it('grants Fitness, inherents and Afterburner automatically', () => {
    const b = blaster();
    pick(b, 0, 'Blaster_Ranged.Fire_Blast.Flares');
    pick(b, 1, 'Blaster_Support.Fire_Manipulation.Ring_of_Fire');
    pick(b, 3, 'Pool.Flight.Fly');
    const g = new BuildRules(gd, b).granted();
    expect(g.get(pid(gd, 'Inherent.Fitness.Stamina'))).toBe(0);
    expect(g.get(pid(gd, 'Inherent.Inherent.Brawl'))).toBe(0);
    expect(g.get(pid(gd, 'Pool.Flight.Fly_Boost'))).toBe(3);
    const names = [...g.keys()].map((id) => gd.power(id).n);
    expect(names.some((n) => /Defiance/i.test(n))).toBe(true);
    expect(names.some((n) => /Containment|Gauntlet|Fury/i.test(n))).toBe(false);
  });

  it('offers only the archetype epic pools from level 35', () => {
    const b = blaster();
    const r = new BuildRules(gd, b);
    const at35 = gd.core.schedule.power.indexOf(34);
    expect(r.canAddNewSet('epic', at35 - 1)).toBe(false);
    const choices = r.newSetChoices('epic', at35).map((c) => c.set.n);
    expect(choices).toContain('Epic.Munitions_Mastery');
    expect(choices).not.toContain('Epic.Dark_Mastery');
  });

  it('lists VEAT branches in their columns, greyed until level 24', () => {
    const at = gd.archetypeByName.get('class_arachnos_soldier')!;
    const b = newBuild({
      dataVersion: '',
      at: at.id,
      origin: gd.core.origins[0]!.id,
      alignment: 'Villain',
      primary: sid(gd, 'Arachnos_Soldiers.Arachnos_Soldier'),
      secondary: sid(gd, 'Training_Gadgets.Training_and_Gadgets'),
      pickCount: 24,
    });
    const r = new BuildRules(gd, b);
    // Like the client, the branch sets are always listed in their category's column (in data
    // order, after the main set) but every power stays unavailable until level 24.
    const avail = (pick: number, n: string) =>
      r.setOptions(pick).find((s) => s.set.n === n)!.powers.filter((p) => p.state === 'available').length;
    const before = r.setOptions(12);
    expect(before.filter((s) => s.column === 0).map((s) => s.set.n)).toEqual([
      'Arachnos_Soldiers.Arachnos_Soldier',
      'Arachnos_Soldiers.Bane_Spider_Soldier',
      'Arachnos_Soldiers.Crab_Spider_Soldier',
    ]);
    expect(before.filter((s) => s.column === 1).map((s) => s.set.n)).toEqual([
      'Training_Gadgets.Training_and_Gadgets',
      'Training_Gadgets.Crab_Spider_Training',
      'Training_Gadgets.Bane_Spider_Training',
    ]);
    expect(avail(12, 'Arachnos_Soldiers.Bane_Spider_Soldier')).toBe(0);
    const lvl24 = gd.core.schedule.power.indexOf(23);
    expect(avail(lvl24, 'Arachnos_Soldiers.Bane_Spider_Soldier')).toBeGreaterThan(0);
    expect(avail(lvl24, 'Arachnos_Soldiers.Crab_Spider_Soldier')).toBeGreaterThan(0);
  });
});

describe('slots', () => {
  it('gives a free slot and enforces per-level capacity', () => {
    const b = blaster();
    pick(b, 0, 'Blaster_Ranged.Fire_Blast.Flares');
    pick(b, 1, 'Blaster_Support.Fire_Manipulation.Ring_of_Fire');
    const r = new BuildRules(gd, b);
    const flares = r.entries().find((e) => e.key === 'pick:0')!;
    expect(flares.slots).toHaveLength(1);
    expect(r.slotsGranted(2)).toBe(2);
    expect(r.slotBlock(flares, 2)).toBeNull();
    b.picks[0]!.slots = [{ level: 0 }, { level: 2 }, { level: 2 }];
    const r2 = new BuildRules(gd, b);
    const ring = r2.entries().find((e) => e.key === 'pick:1')!;
    expect(r2.slotBlock(ring, 2)).toBe('No Slots');
    expect(r2.issues()).toEqual([]);
  });
});
