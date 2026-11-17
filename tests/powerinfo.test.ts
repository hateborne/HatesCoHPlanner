import { describe, expect, it } from 'vitest';
import { powerInfo, segText } from '../src/engine/powerinfo.ts';
import { loadData } from './helpers/data.ts';

const gd = loadData();
const at = gd.archetypeByName.get('class_controller')!;
const power = gd.powerByName.get('controller_control.gravity_control.crushing_field')!;
const DMG0 = gd.attribByName.get('DamageType00')!;
const RECH = gd.attribByName.get('RechargeTime')!;
const IMMOB = gd.attribByName.get('Immobilized')!;

const rows = (r: { label: string; value: { text: string }[] }[]) =>
  Object.fromEntries(r.map((x) => [x.label, segText(x.value)]));

describe('powerInfo: Controller Crushing Field at level 8', () => {
  const info = powerInfo(gd, at, power, 7, new Map());

  it('title', () => {
    expect(segText(info.title)).toBe('Crushing Field as used by level 8 Controller');
  });

  it('base stats', () => {
    expect(rows(info.stats)).toEqual({
      'Average Damage:': '3.87',
      'Damage Per Activation Time:': '2.91',
      'Damage Per Cast Cycle:': '0.42',
      'Activation Time:': '1.33s',
      'Recharge Time:': '8.00s',
      'Endurance Cost:': '15.60',
      'Accuracy:': '0.90X',
      'Available Level:': '8',
    });
  });

  it('target info', () => {
    expect(rows(info.target)).toEqual({
      'Power Type:': 'Click',
      'Target Type:': 'Enemies',
      'Power Range:': '80.00 ft.',
      'Effect Area:': 'AoE -- 30.00 ft. radius (16 targets max)',
      'Attack Types:': 'AoE defense, smashing defense',
    });
  });

  it('effects', () => {
    const got = info.effects.map((e) => [segText(e.line), e.notes.map(segText)]);
    expect(got).toEqual([
      ['3 Ticks of 1.29 smashing damage over 5.20s on target', []],
      ['3.00 magnitude immobilize for 20.06s(20.06s) on target', []],
      ['50.00% chance for 1.00 magnitude immobilize for 13.38s(13.38s) on target', ['Overpower']],
      ['-62.50% strength to jump height for 15.00s on target', ['Ignores buffs and enhancements']],
      ['-62.50% run speed for 15.00s on target', []],
      ['-62.50% fly speed for 15.00s on target', []],
      ['-62.50% jump speed for 15.00s on target', []],
    ]);
  });

  it('keeps the client colors', () => {
    const dmg = info.effects[0]!.line;
    expect(dmg.some((s) => s.color === '#ff4b4b' && s.text.includes('1.29'))).toBe(true);
    expect(info.stats[0]!.value[0]!.color).toBe('#ff4b4b');
  });

  it('shows base values only when unenhanced (null)', () => {
    const base = powerInfo(gd, at, power, 7, null);
    expect(segText(base.effects[1]!.line)).toBe('3.00 magnitude immobilize for 20.06s on target');
  });
});

describe('powerInfo: enhanced values', () => {
  it('prints enhanced(base) once strength differs', () => {
    const enh = new Map<number, number>([
      [DMG0, 0.95],
      [RECH, 0.5],
      [IMMOB, 0.5],
    ]);
    const info = powerInfo(gd, at, power, 7, enh);
    const s = rows(info.stats);
    expect(s['Average Damage:']).toBe('7.55 (3.87)');
    expect(s['Recharge Time:']).toBe('5.33s (8.00s)');
    expect(s['Damage Per Activation Time:']).toBe('5.68 (2.91)');
    expect(s['Damage Per Cast Cycle:']).toBe('1.13 (0.42)');
    expect(segText(info.effects[0]!.line)).toBe('3 Ticks of 2.52 (1.29) smashing damage over 5.20s on target');
    expect(segText(info.effects[1]!.line)).toBe('3.00 magnitude immobilize for 30.09s(20.06s) on target');
  });
});

describe("powerInfo: the client's line order", () => {
  /** @return A power's lines at level 50, unenhanced, with their notes. */
  const lines = (cls: string, name: string) =>
    powerInfo(gd, gd.archetypeByName.get(cls)!, gd.powerByName.get(name)!, 49, null).effects.map((e) =>
      [segText(e.line), ...e.notes.map(segText)].join(' / '),
    );

  it("lists a group's sub-groups before its own mods (Crushing Uppercut's knockup comes last, as in game)", () => {
    const got = lines('class_stalker', 'stalker_melee.brawling.crushing_uppercut');
    expect(got.at(-1)).toBe('6.23 magnitude knockup on target');
    expect(got.indexOf('176.85 smashing damage on target / Only at Combo Level 0')).toBeLessThan(got.length - 1);
  });

  it('puts an ammo group\'s own debuff after the hits of its sub-groups (Executioner\'s Shot, in game)', () => {
    const got = lines('class_sentinel', 'sentinel_ranged.dual_pistols.executioners_shot');
    expect(got.slice(0, 4)).toEqual([
      '129.69 lethal damage on target / Only using Standard Ammo',
      '0.00% chance for 51.87 lethal damage on target / Only using Standard Ammo',
      '-8.75% defense for 8.00s on target / Only using Standard Ammo',
      '1.66 magnitude knockback on target / Only using Standard Ammo',
    ]);
    const cold = got.indexOf('0.00% chance for 51.87 cold damage on target / Only using Cryo Ammo');
    expect(got[cold + 1]).toBe('-15.00% run speed for 10.00s on target / Only using Cryo Ammo');
  });
});

describe("powerInfo: damage by the client's chance rule (getTotalDamage)", () => {
  /** @return A power's damage stats at level 50, unenhanced. */
  const dmg = (cls: string, name: string) => {
    const s = rows(powerInfo(gd, gd.archetypeByName.get(cls)!, gd.powerByName.get(name)!, 49, null).stats);
    return [s['Average Damage:'], s['Damage Per Activation Time:'], s['Damage Per Cast Cycle:']];
  };

  it("counts a hit at its own group's chance, never its parents' nor its tick chance (in game)", () => {
    // the four Opportunity crits (tick chance 0) count whole, the ammo groups above them (0) aside
    expect(dmg('class_sentinel', 'sentinel_ranged.dual_pistols.executioners_shot')).toEqual(['337.18', '201.91', '28.89']);
    // Thunder Strike: the team-crit sub-groups count whole, their 0.07 parent aside
    expect(dmg('class_stalker', 'stalker_melee.electrical_melee.lightning_clap')).toEqual(['331.45', '131.01', '14.71']);
  });

  it('leaves the powers the rules agree on as they were (in game)', () => {
    expect(dmg('class_stalker', 'stalker_melee.brawling.crushing_uppercut')[0]).toBe('189.22');
    expect(dmg('class_sentinel', 'sentinel_ranged.dual_pistols.hail_of_bullets')[0]).toBe('181.99');
    expect(dmg('class_brute', 'brute_defense.fiery_aura.burn')[0]).toBe('130.13');
  });
});

describe("powerInfo: the client's wording and rows (Homecoming, the owner's screenshots, November 17, 2026)", () => {
  const info = (cls: string, name: string, level = 49) =>
    powerInfo(gd, gd.archetypeByName.get(cls)!, gd.powerByName.get(name)!, level, null);
  const lines = (i: ReturnType<typeof info>) => i.effects.map((e) => [segText(e.line), ...e.notes.map(segText)].join(' / '));

  it('words a Current defense as "strength to" (Hail of Bullets)', () => {
    expect(lines(info('class_sentinel', 'sentinel_ranged.dual_pistols.hail_of_bullets')).slice(0, 3)).toEqual([
      '+9.75% strength to ranged defense for 5.00s on self / Ignores buffs and enhancements / Unresistable',
      '+9.75% strength to melee defense for 5.00s on self / Ignores buffs and enhancements / Unresistable',
      '+9.75% strength to AoE defense for 5.00s on self / Ignores buffs and enhancements / Unresistable',
    ]);
  });

  it("lists no damage type the client can't name, and a Chain power's area (Vulnerability, level 2)", () => {
    const v = info('class_sentinel', 'inherent.inherent.vulnerability', 1);
    const res = lines(v).filter((l) => l.includes('resistance to')).map((l) => l.replace(/^-15\.00% resistance to (.*) for 15\.00s on target.*$/, '$1'));
    expect(res).toEqual(['all damage', 'endurance', 'to hit', 'confuse', 'terrorize', 'hold', 'immobilize', 'stun', 'sleep', 'regeneration rate', 'recovery rate', 'recharge', 'Endurance Cost']);
    expect(rows(v.target)['Effect Area:']).toBe('Chain -- 15.00 ft. jump distance (5 targets max)');
  });
});

describe("powerInfo: the owner's second round of checks (Homecoming, level 50, November 17, 2026)", () => {
  const info = (cls: string, name: string) => powerInfo(gd, gd.archetypeByName.get(cls)!, gd.powerByName.get(name)!, 49, null);
  const lines = (i: ReturnType<typeof info>) => i.effects.map((e) => [segText(e.line), ...e.notes.map(segText)].join(' / '));

  it("counts Liquid Nitrogen's Containment damage: the client's note needs one exact run of tokens", () => {
    const s = rows(info('class_controller', 'controller_control.arsenal_control.liquid_nitrogen').stats);
    expect([s['Average Damage:'], s['Damage Per Activation Time:']]).toEqual(['423.02', '211.51']);
  });

  it('lists Evasive Maneuvers without a toxic defense line', () => {
    expect(lines(info('class_blaster', 'pool.flight.afterburner'))).toEqual([
      '8.30 immobilize protection on self / Ignores buffs and enhancements / Unresistable',
      '48.44% resistance to knockup on self / Ignores buffs and enhancements / Unresistable',
      '48.44% resistance to knockback on self / Ignores buffs and enhancements / Unresistable',
      '+10.50% strength to all defense on self / Unresistable',
    ]);
  });

  it("shows Charged Brawl's 20% on the sleep only: the recovery debuff has a duration of its own", () => {
    expect(lines(info('class_blaster', 'blaster_support.electricity_manipulation.charged_brawl')).slice(0, 7)).toEqual([
      '53.39 smashing damage on target',
      '55.61 energy damage on target',
      '-7.00% endurance on target',
      '20.00% chance for 3.00 magnitude sleep for 11.92s on target after 0.25s delay',
      '-100.00% recovery rate for 2.00s on target',
      '30.00% chance for 5.09 endurance on self / Unresistable',
      '+5.50% strength to all damage for 8.33s on self / Ignores buffs and enhancements / Unresistable',
    ]);
  });

  it("lists a Corruptor's Scourge hit as a second bare line", () => {
    const i = info('class_corruptor', 'corruptor_ranged.dark_blast.dark_blast');
    expect(rows(i.stats)['Average Damage:']).toBe('83.42');
    expect(lines(i)).toEqual(['41.71 negative energy damage on target', '41.71 negative energy damage on target', '-7.50% to hit for 6.00s on target']);
  });

  it('still names a toxic attack type', () => {
    expect(rows(info('class_tanker', 'tanker_melee.radiation_melee.atom_smasher').target)['Attack Types:']).toBe('AoE defense, toxic defense');
  });
});

describe('powerInfo: "all damage" and "all defense" groups (markAllTypes, both clients)', () => {
  const at = gd.archetypeByName.get('class_blaster')!;
  const base = gd.powerByName.get('blaster_ranged.fire_blast.flares')!;
  const res = (a: number[], sc: number) => ({ a, asp: 'Resistance', t: 'Magnitude', tg: 'Caster', tbl: 'Ranged_Res_Dmg', sc });
  const lines = (m: ReturnType<typeof res>[]) =>
    powerInfo(gd, at, { ...base, act: undefined, eff: m.map((x) => ({ m: [x] })) }, 49, null).effects.map((e) => segText(e.line).replace(/^\+?[\d.]+% /, ''));
  const EIGHT = [0, 4, 8, 12, 16, 20, 24, 36];

  it('groups the eight types across separate effects of equal value', () => {
    expect(lines(EIGHT.map((o) => res([o], 1)))).toEqual(['resistance to all damage on self']);
  });

  it('lists each type when a value differs or a ninth type joins before the group is whole', () => {
    expect(lines([res(EIGHT.slice(0, 7), 1), res([36], 2)])).toHaveLength(8);
    expect(lines([res([0, 4, 8, 12, 16, 20, 24, 28, 36], 1)])).toHaveLength(9); // healing (28) comes before toxic
    // offsets 40 to 79 (radiation on) count as damage too, but lie outside the mask: never whole
    expect(lines([res([0, 4, 8, 12, 16, 20, 24, 40, 36], 1)])).toHaveLength(9);
  });

  it('keeps counting groups after one is whole, as the client does (its mask is never cleared)', () => {
    // Homecoming's markAllTypes (0x1404e1540) clears only the value once the mask is whole, so a
    // later damage type of that target counts another group, at any value: its line reads "all"
    const all = 'resistance to all damage on self';
    expect(lines([res(EIGHT, 1), res([8], 1)])).toEqual([all, all]);
    expect(lines([res(EIGHT, 1), res([8], 2)])).toEqual([all, all]);
  });

  it('shows a second group for a second effect with every type', () => {
    expect(lines([res(EIGHT, 1), res(EIGHT, 2)])).toEqual(['resistance to all damage on self', 'resistance to all damage on self']);
  });

  it('passes over a second effect once a ninth type has taken the value (Stealth, Homecoming)', () => {
    // the ninth type (radiation) sets the value anew, the second effect's differs, so only one group
    // counts and every later damage type of that target and aspect is left out
    expect(lines([res([...EIGHT, 40], 1), res(EIGHT, 2)])).toEqual(['resistance to all damage on self']);
  });

  it('counts a hidden effect towards a group, as the client walks every effect', () => {
    // the toxic type sits in a HideFromInfo group: not listed, yet it completes the group
    const p = { ...base, act: undefined, eff: [{ m: [res(EIGHT.slice(0, 7), 1)] }, { fl: ['HideFromInfo'], m: [res([36], 1)] }] };
    const got = powerInfo(gd, at, p, 49, null).effects.map((e) => segText(e.line).replace(/^\+?[\d.]+% /, ''));
    expect(got).toEqual(['resistance to all damage on self']);
  });

  it('keeps a lone toxic defense line (no group): Invincibility, Homecoming', () => {
    const inv = powerInfo(gd, gd.archetypeByName.get('class_tanker')!, gd.powerByName.get('tanker_defense.invulnerability.invincibility')!, 49, null);
    expect(inv.effects.some((e) => segText(e.line).includes('toxic defense'))).toBe(true);
  });
});
