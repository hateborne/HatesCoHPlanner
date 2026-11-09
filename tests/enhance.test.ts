import { describe, expect, it } from 'vitest';
import { newBuild, type Build } from '../src/engine/build.ts';
import { applyED, canSlot, edCurves, enhKind, powerStrength } from '../src/engine/enhance.ts';
import { BuildRules } from '../src/engine/rules.ts';
import { earnedBonuses } from '../src/engine/setbonus.ts';
import { computeTotals } from '../src/engine/totals.ts';
import { loadData, pid, sid } from './helpers/data.ts';

const gd = loadData();
const blasterAt = gd.archetypeByName.get('class_blaster')!;
const originIdx = (name: string) => gd.core.origins.findIndex((o) => o.n === name);
const DMG = gd.attribByName.get('DamageType02')!; // fire damage strength
const DEF = gd.attribByName.get('DefenseType00')!;

function blaster(origin = 'Magic'): Build {
  return newBuild({
    dataVersion: gd.core.manifest.dataVersion,
    at: blasterAt.id,
    origin: gd.core.origins[originIdx(origin)]!.id,
    alignment: 'Hero',
    primary: sid(gd, 'Blaster_Ranged.Fire_Blast'),
    secondary: sid(gd, 'Blaster_Support.Fire_Manipulation'),
    pickCount: 24,
  });
}

describe('enhancement validity', () => {
  const blaze = gd.power(pid(gd, 'Blaster_Ranged.Fire_Blast.Blaze'));
  it('checks origin and type like power_IsValidBoost', () => {
    const so = gd.power(pid(gd, 'Boosts.Magic_Damage.Magic_Damage'));
    expect(enhKind(gd, so)).toBe('Origin');
    expect(canSlot(gd, blaze, so, originIdx('Magic'))).toBe(true);
    expect(canSlot(gd, blaze, so, originIdx('Science'))).toBe(false);
    const to = gd.power(pid(gd, 'Boosts.Generic_Damage.Generic_Damage'));
    expect(canSlot(gd, blaze, to, originIdx('Science'))).toBe(true);
    const def = gd.power(pid(gd, 'Boosts.Generic_Defense_Buff.Generic_Defense_Buff'));
    expect(canSlot(gd, blaze, def, originIdx('Magic'))).toBe(false);
  });
  it('limits set IOs to their eligible powers', () => {
    const lotg = gd.power(pid(gd, 'Boosts.Crafted_Luck_of_the_Gambler_A.Crafted_Luck_of_the_Gambler_A'));
    const weave = gd.power(pid(gd, 'Pool.Fighting.Weave'));
    expect(enhKind(gd, lotg)).toBe('Set');
    expect(canSlot(gd, weave, lotg, originIdx('Magic'))).toBe(true);
    expect(canSlot(gd, blaze, lotg, originIdx('Magic'))).toBe(false);
  });
});

describe('enhancement values and ED', () => {
  const blaze = gd.power(pid(gd, 'Blaster_Ranged.Fire_Blast.Blaze'));
  it('applies schedule A ED to three damage SOs (95%)', () => {
    const so = { boost: pid(gd, 'Boosts.Magic_Damage.Magic_Damage') };
    const s = powerStrength(gd, blasterAt, blaze, [so, so, so], 49);
    expect(s.pre.get(DMG)).toBeCloseTo(0.9999, 3);
    expect(s.post.get(DMG)).toBeCloseTo(0.9499, 3);
  });
  it('uses the level-50 IO curve (42.4%) and boosters (+5 = x1.25)', () => {
    const io = { boost: pid(gd, 'Boosts.Crafted_Damage.Crafted_Damage'), ioLevel: 49 };
    expect(powerStrength(gd, blasterAt, blaze, [io], 49).post.get(DMG)).toBeCloseTo(0.4238, 3);
    const boosted = { ...io, boosters: 5 };
    expect(powerStrength(gd, blasterAt, blaze, [boosted], 49).post.get(DMG)).toBeCloseTo(0.4238 * 1.25, 3);
  });
  it('scales TO/DO/SO effectiveness by relative level', () => {
    const so = pid(gd, 'Boosts.Magic_Damage.Magic_Damage');
    const plus3 = powerStrength(gd, blasterAt, blaze, [{ boost: so, rel: 3 }], 40).post.get(DMG);
    const minus3 = powerStrength(gd, blasterAt, blaze, [{ boost: so, rel: -3 }], 40).post.get(DMG);
    expect(plus3).toBeCloseTo(0.3333 * 1.15, 3);
    expect(minus3).toBeCloseTo(0.3333 * 0.7, 3);
  });
  it('uses schedule B thresholds for defense', () => {
    const weave = gd.power(pid(gd, 'Pool.Fighting.Weave'));
    const curve = edCurves(gd.core.dimReturns, weave)(DEF);
    expect(curve?.start).toEqual([0.4, 0.5, 0.6]);
    expect(applyED(0.3, curve)).toBeCloseTo(0.3, 5);
  });
});

describe('set bonuses and totals', () => {
  it('earns LotG bonuses and enforces the rule of 5', () => {
    const b = blaster();
    const lotg = 'abcdef'.split('').map((l) => pid(gd, `Boosts.Crafted_Luck_of_the_Gambler_${l.toUpperCase()}.Crafted_Luck_of_the_Gambler_${l.toUpperCase()}`));
    b.picks[0] = { power: pid(gd, 'Blaster_Ranged.Fire_Blast.Flares'), level: 0, slots: [] };
    b.picks[1] = { power: pid(gd, 'Blaster_Support.Fire_Manipulation.Ring_of_Fire'), level: 0, slots: [] };
    const defPowers = ['Pool.Leaping.Combat_Jumping', 'Pool.Fighting.Weave', 'Pool.Leadership.Defense',
      'Pool.Flight.Combat_Flight', 'Pool.Fighting.Tough'];
    const lvls = [3, 13, 15, 17, 19];
    defPowers.slice(0, 4).forEach((n, k) => {
      b.picks[k + 3] = {
        power: pid(gd, n),
        level: gd.core.schedule.power[k + 3]!,
        slots: [{ level: 0, enh: { boost: lotg[5]!, ioLevel: 49 } }],
      };
    });
    void lvls;
    const rules = new BuildRules(gd, b);
    const bon = earnedBonuses(gd, rules.entries());
    const global = bon.filter((x) => x.power.n === 'Set_Bonus.Global_Bonus.Luck_of_the_Gambler');
    expect(global).toHaveLength(4);
    expect(global.every((x) => !x.suppressed)).toBe(true);
    const t = computeTotals(gd, rules, b);
    expect(t.lines.get('rech')?.value).toBeCloseTo(0.3, 3); // 4 x 7.5%
  });

  it('computes typed defense from toggles', () => {
    const b = blaster();
    b.picks[0] = { power: pid(gd, 'Blaster_Ranged.Fire_Blast.Flares'), level: 0, slots: [] };
    b.picks[1] = { power: pid(gd, 'Blaster_Support.Fire_Manipulation.Ring_of_Fire'), level: 0, slots: [] };
    b.picks[3] = { power: pid(gd, 'Pool.Leaping.Combat_Jumping'), level: 3, slots: [] };
    const t = computeTotals(gd, new BuildRules(gd, b), b);
    // Combat Jumping: 0.25 x Melee_Buff_Def (0.07 for Blasters at 50) = 1.75%
    expect(t.lines.get('def.00')?.value).toBeCloseTo(0.0175, 4);
    expect(t.hpBase).toBeCloseTo(1204.76, 1);
    // Health (+40% regen) and Stamina (+25% recovery) are auto-granted
    expect(t.lines.get('regen')?.value).toBeCloseTo(0.4, 3);
    expect(t.lines.get('recov')?.value).toBeCloseTo(0.25, 3);
  });
});
