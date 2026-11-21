import { describe, expect, it } from 'vitest';
import type { SlottedEnh } from '../src/engine/build.ts';
import { powerStrength } from '../src/engine/enhance.ts';
import { powerInfo, segText } from '../src/engine/powerinfo.ts';
import { loadData } from './helpers/data.ts';

const gd = loadData();
const at = gd.archetypeByName.get('class_controller')!;
const blind = gd.powerByName.get('controller_control.illusion_control.blind')!;
const LEVEL = 49;

/** @return A crafted Basilisk's Gaze piece (A to F) slotted at a level (1-based). */
function gaze(letter: string, level: number): SlottedEnh {
  const n = `Crafted_Basilisks_Gaze_${letter}`;
  return { boost: gd.powerByName.get(`boosts.${n}.${n}`.toLowerCase())!.id, ioLevel: level - 1, rel: 0, boosters: 0 };
}

// the owner's example: Blind with four level 30 Basilisk's Gaze pieces (Accuracy/Hold,
// Accuracy/Recharge, Recharge/Hold, Accuracy/Endurance Reduction/Recharge/Hold)
const GAZE = ['A', 'B', 'C', 'E'].map((l) => gaze(l, 30));

describe('slotted bonuses on the power info', () => {
  const str = powerStrength(gd, at, blind, GAZE, LEVEL).post;
  const info = powerInfo(gd, at, blind, LEVEL, str);
  const stat = (label: string) => info.stats.find((r) => r.label === label)!;

  it('puts each bonus on the row it changes', () => {
    expect(stat('Recharge Time:').bonus).toBe(str.get(gd.attribByName.get('RechargeTime')!));
    expect(stat('Accuracy:').bonus).toBe(str.get(gd.attribByName.get('Accuracy')!));
    expect(stat('Endurance Cost:').bonus).toBe(str.get(gd.attribByName.get('EnduranceDiscount')!));
    expect(stat('Recharge Time:').bonus).toBeCloseTo(0.5874, 3);
    expect(stat('Endurance Cost:').bonus).toBeCloseTo(0.1523, 3);
    // the bonus is the one behind the row's own numbers
    expect(info.numbers.recharge.enh).toBeCloseTo(info.numbers.recharge.base / (1 + stat('Recharge Time:').bonus!), 9);
    expect(info.numbers.accuracy.enh).toBeCloseTo(info.numbers.accuracy.base * (1 + stat('Accuracy:').bonus!), 9);
  });

  it('leaves the rows nothing slotted changes without one', () => {
    expect(stat('Average Damage:').bonus).toBeUndefined(); // no damage enhancement in it
    expect(stat('Activation Time:').bonus).toBeUndefined();
    expect(info.target.every((r) => r.bonus === undefined)).toBe(true); // no range enhancement
  });

  it('puts the hold bonus on the hold lines, and none on the damage line', () => {
    const holds = info.effects.filter((e) => segText(e.line).includes('magnitude hold for'));
    expect(holds.length).toBeGreaterThan(0);
    for (const h of holds) expect(h.bonus).toBe(str.get(gd.attribByName.get('Held')!));
    const damage = info.effects.find((e) => segText(e.line).includes('psionic damage'))!;
    expect(damage.bonus).toBeUndefined();
  });

  it('gives a damage line its own enhancement', () => {
    const DMG = gd.attribByName.get('DamageType00')!;
    const all = new Map<number, number>();
    for (let i = 0; i < 20; i++) all.set(DMG + i * 4, 0.95);
    const hit = powerInfo(gd, at, blind, LEVEL, all);
    expect(hit.stats.find((r) => r.label === 'Average Damage:')!.bonus).toBeCloseTo(0.95, 9);
    expect(hit.effects.find((e) => segText(e.line).includes('psionic damage'))!.bonus).toBeCloseTo(0.95, 9);
  });

  it('has none for a power with nothing slotted, or shown unenhanced', () => {
    for (const enh of [powerStrength(gd, at, blind, [], LEVEL).post, null]) {
      const bare = powerInfo(gd, at, blind, LEVEL, enh);
      expect([...bare.stats, ...bare.target].some((r) => r.bonus !== undefined)).toBe(false);
      expect(bare.effects.some((e) => e.bonus !== undefined)).toBe(false);
    }
  });
});

describe('slotted bonuses on Thunderspy', () => {
  it('puts the bonus on its lines there too', () => {
    const ts = loadData(undefined, 'thunderspy');
    const scrapper = ts.archetypeByName.get('class_scrapper')!;
    const followUp = ts.powerByName.get('scrapper_melee.claws.follow_up')!;
    const info = powerInfo(ts, scrapper, followUp, LEVEL, new Map([[ts.attribByName.get('ToHit')!, 0.5]]));
    const toHit = info.effects.find((e) => /hit on self/.test(segText(e.line)))!;
    expect(toHit.bonus).toBe(0.5);
  });
});
