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
