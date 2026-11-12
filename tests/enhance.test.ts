import { describe, expect, it } from 'vitest';
import { newBuild, type Build } from '../src/engine/build.ts';
import { applyED, boostHelpText, boostMods, canSlot, edCurves, enhKind, enhLevelLabel, enhLines, isLegacyDuplicate, pieceName, powerStrength } from '../src/engine/enhance.ts';
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

describe('enhancement value labels (uiCombineSpec.c boostLines)', () => {
  const gd2 = loadData();
  const at = gd2.archetypeByName.get('class_blaster')!;
  const flares = gd2.power(pid(gd2, 'Blaster_Ranged.Fire_Blast.Flares'));
  // a power accepting only the given enhancement types (the label follows the power's types)
  const accepting = (...types: string[]) => ({ ...flares, ba: types.map((n) => gd2.core.attribNames.Boost.findIndex((b) => b.n === n) + 5) });
  const lines = (name: string, ...types: string[]) => enhLines(gd2, at, accepting(...types), { boost: pid(gd2, name), ioLevel: 49 }, 49);
  it('shows damage once as "Damage", not DamageType00 ... 09', () => {
    const dr = [...gd2.powerById.values()].find((p) => p.type === 'Boost' && /^Decimation: Damage\/Recharge$/.test(p.dn))!;
    const l = enhLines(gd2, at, flares, { boost: dr.id, ioLevel: 39 }, 49);
    expect(l.map((x) => x.label)).toEqual(['Damage', 'Recharge Time']);
    expect(l[0]!.value).toBeCloseTo(l[1]!.value, 6);
  });
  it('uses the resist / debuff names for those enhancements', () => {
    expect(lines('Boosts.Crafted_Res_Damage.Crafted_Res_Damage', 'Res_Damage_Boost').map((x) => x.label)).toEqual(['Resist Damage']);
    expect(lines('Boosts.Crafted_Defense_DeBuff.Crafted_Defense_DeBuff', 'Debuff_Defense_Boost').map((x) => x.label)).toEqual(['Defense Debuff']);
    expect(lines('Boosts.Crafted_Recharge.Crafted_Recharge', 'Recharge_Boost').map((x) => x.label)).toEqual(['Recharge Time']);
  });
});

describe('legacy duplicate enhancements', () => {
  const gd3 = loadData();
  it('hides every legacy "Cone" range enhancement and keeps its "Range" twin', () => {
    const cones = gd3.boosts.filter((b) => (b.n.split('.')[1] ?? '').endsWith('_Cone'));
    expect(cones).toHaveLength(11);
    for (const c of cones) {
      const twin = gd3.powerByName.get(c.n.replace(/_Cone/g, '_Range').toLowerCase())!;
      expect(twin.dn).toBe(c.dn);
      expect(isLegacyDuplicate(gd3, c)).toBe(true);
      expect(isLegacyDuplicate(gd3, twin)).toBe(false);
    }
    // ten are exact copies; Helmet (Range) differs (twice the range) and is hidden anyway
    const differ = cones.filter((c) => JSON.stringify(boostMods(c)) !== JSON.stringify(boostMods(gd3.powerByName.get(c.n.replace(/_Cone/g, '_Range').toLowerCase())!)));
    expect(differ.map((c) => c.n)).toEqual(['Boosts.Mutation_Magic_Cone.Mutation_Magic_Cone']);
  });
  it('still hides the fixed-level common IOs but not set pieces', () => {
    expect(isLegacyDuplicate(gd3, gd3.power(pid(gd3, 'Boosts.Crafted_Recharge_10.Crafted_Recharge_10')))).toBe(true);
    expect(isLegacyDuplicate(gd3, gd3.power(pid(gd3, 'Boosts.Crafted_Recharge.Crafted_Recharge')))).toBe(false);
    expect(isLegacyDuplicate(gd3, gd3.power(pid(gd3, 'Boosts.Crafted_Decimation_B.Crafted_Decimation_B')))).toBe(false);
  });
});

describe('review fixes: enhancement values and text', () => {
  const g = loadData();
  const at = g.archetypeByName.get('class_blaster')!;
  const byName = (re: RegExp) => [...g.powerById.values()].find((p) => re.test(p.n))!;
  const allTypes = { ...g.power(pid(g, 'Blaster_Ranged.Fire_Blast.Flares')), ba: g.core.attribNames.Boost.map((_, i) => i + 5) };
  it('counts the recharge half of a "Recharge/Chance for X" proc piece, but not the proc itself', () => {
    const av = byName(/^Boosts\.Attuned_Avalanche_F\./);
    expect(boostMods(av).flatMap((m) => m.a.map((a) => g.attribName.get(a)))).toContain('RechargeTime');
    const rechOnly = { ...allTypes, ba: [g.core.attribNames.Boost.findIndex((b) => b.n === 'Recharge_Boost') + 5] };
    expect(enhLines(g, at, rechOnly, { boost: av.id }, 49).map((l) => l.label)).toEqual(['Recharge Time']);
    expect(boostHelpText(g, at, { boost: av.id }, 49)).not.toContain('?');
    // Basilisk's Gaze F's proc (-Recharge on its target) is not an enhancement value
    const bg = byName(/^Boosts\.Attuned_Basilisks_Gaze_F\./);
    expect(boostMods(bg).every((m) => m.tg === 'Caster')).toBe(true);
  });
  it('lists only the lines the power accepts (getEffectiveString)', () => {
    const wail = byName(/\.FRT_Psychic_Wail$/);
    const ham = byName(/^Boosts\.Hamidon_Endurance_Modification_Accuracy\./);
    expect(enhLines(g, at, wail, { boost: ham.id }, 49).map((l) => l.label)).toEqual(['Accuracy']);
  });
  it('names a line by every type the power accepts', () => {
    const dmg = g.power(pid(g, 'Boosts.Crafted_Damage.Crafted_Damage'));
    const both = { ...allTypes, ba: ['Damage_Boost', 'Res_Damage_Boost'].map((n) => g.core.attribNames.Boost.findIndex((b) => b.n === n) + 5) };
    expect(enhLines(g, at, both, { boost: dmg.id, ioLevel: 49 }, 49).map((l) => l.label)).toEqual(['Damage', 'Resist Damage']);
  });
  it('adds two mods on the same attribute instead of keeping the larger', () => {
    const dup = g.boosts.find((b) => {
      const seen = new Set<number>();
      return boostMods(b).some((m) => m.a.some((a) => (seen.has(a) ? true : (seen.add(a), false))));
    });
    expect(dup).toBeDefined();
    const lines = enhLines(g, at, allTypes, { boost: dup!.id }, 49);
    const contrib = new Map<string, number>();
    for (const m of boostMods(dup!)) for (const a of m.a) contrib.set(g.attribName.get(a)!, (contrib.get(g.attribName.get(a)!) ?? 0) + 1);
    expect([...contrib.values()].some((n) => n > 1)).toBe(true);
    expect(lines.length).toBeGreaterThan(0);
  });
  it("fills every description's numbers from the piece itself, never another effect's", () => {
    expect(boostHelpText(g, at, { boost: byName(/^Boosts\.Attuned_Steadfast_Protection_B\./).id }, 49)).toContain('increases overall defense by 3.0%');
    expect(boostHelpText(g, at, { boost: byName(/^Boosts\.Attuned_Gift_of_the_Ancients_F\./).id }, 49)).toContain('run speed of a power by 7.5%');
    const unresolved = g.boosts.filter((b) => /\?%|by \?| \?/.test(boostHelpText(g, at, { boost: b.id }, 49)));
    expect(unresolved.map((b) => b.n)).toEqual([]);
  });
  it('hides the "_Drain_Endurance" copies of the End Mod enhancements', () => {
    expect(isLegacyDuplicate(g, g.power(pid(g, 'Boosts.Generic_Drain_Endurance.Generic_Drain_Endurance')))).toBe(true);
    expect(isLegacyDuplicate(g, g.power(pid(g, 'Boosts.Generic_Recovery.Generic_Recovery')))).toBe(false);
  });
  it("gives every set piece its own name without the set's", () => {
    const sbf = byName(/^Boosts\.Superior_Attuned_Superior_Brutes_Fury_E\./);
    expect(pieceName(sbf, g.boostSetOf.get(sbf.id)!.set.dn)).toBe('Accuracy/Damage/Endurance/Recharge');
    for (const s of g.boostSets) for (const v of s.slots) for (const id of v) {
      const n = pieceName(g.power(id), s.dn);
      expect(n.length).toBeGreaterThan(0);
      expect(n.includes(s.dn.replace(/^Superior /, ''))).toBe(false);
    }
  });
});

/** The level number printed on a slotted piece (drawEnhancementOriginLevelEx, uiCombineSpec.c). */
describe('enhancement level labels', () => {
  const boost = (name: string) => gd.power(pid(gd, `Boosts.${name}.${name}`));
  const lotg = boost('Crafted_Luck_of_the_Gambler_A');
  const so = boost('Magic_Damage');

  it('prints an IO level on top in CLR_PARAGON, with its boosters', () => {
    expect(enhLevelLabel(gd, lotg, { boost: lotg.id, ioLevel: 49 }, 49)).toEqual({ text: '50', top: true, tone: 'paragon' });
    expect(enhLevelLabel(gd, lotg, { boost: lotg.id, ioLevel: 49, boosters: 5 }, 49)).toEqual({ text: '50+5', top: true, tone: 'paragon' });
    const common = boost('Crafted_Accuracy');
    expect(enhLevelLabel(gd, common, { boost: common.id, ioLevel: 34 }, 49)).toEqual({ text: '35', top: true, tone: 'paragon' });
  });

  it('turns red when the character is too low to use the piece', () => {
    // a level 50 IO works from 3 levels below (power_MinBoostUseLevel)
    expect(enhLevelLabel(gd, lotg, { boost: lotg.id, ioLevel: 49 }, 46)?.tone).toBe('paragon');
    expect(enhLevelLabel(gd, lotg, { boost: lotg.id, ioLevel: 49 }, 29)?.tone).toBe('unusable');
  });

  it('prints a TO/DO/SO level at the bottom, colored by its effectiveness', () => {
    expect(enhLevelLabel(gd, so, { boost: so.id, rel: 0 }, 49)).toEqual({ text: '50', top: false, tone: 'even' });
    expect(enhLevelLabel(gd, so, { boost: so.id, rel: 3 }, 49)).toEqual({ text: '53', top: false, tone: 'above' });
    expect(enhLevelLabel(gd, so, { boost: so.id, rel: -3 }, 49)).toEqual({ text: '47', top: false, tone: 'below' });
  });

  it('prints nothing on attuned and BoostHideLevel pieces', () => {
    const attuned = boost('Attuned_Luck_of_the_Gambler_A');
    expect(enhLevelLabel(gd, attuned, { boost: attuned.id }, 49)).toBeUndefined();
    const hidden = boost('Generic_Clockwork_Efficiency');
    expect(hidden.bhl).toBeTruthy();
    expect(enhLevelLabel(gd, hidden, { boost: hidden.id }, 49)).toBeUndefined();
  });
});
