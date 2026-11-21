import { describe, expect, it } from 'vitest';
import type { Slot } from '../src/engine/build.ts';
import type { BuildEntry } from '../src/engine/rules.ts';
import { earnedBonuses, setBonusLines } from '../src/engine/setbonus.ts';
import { loadData } from './helpers/data.ts';

const gd = loadData();
const blind = gd.powerByName.get('controller_control.illusion_control.blind')!;
const gazeSet = gd.boostSets.find((s) => s.dn === "Basilisk's Gaze")!;
const L50 = 49;

/** @return A Basilisk's Gaze piece (A to F), crafted or attuned, in a slot gained at a level (0-based). */
function gaze(letter: string, kind: 'Crafted' | 'Attuned' = 'Crafted', slotLevel = 1): Slot {
  const n = `${kind}_Basilisks_Gaze_${letter}`;
  return { level: slotLevel, enh: { boost: gd.powerByName.get(`boosts.${n}.${n}`.toLowerCase())!.id, ioLevel: 29, rel: 0, boosters: 0 } };
}

/** @return A build entry holding these slots (the power itself doesn't matter to the count). */
function entry(key: string, slots: Slot[]): BuildEntry {
  return { key, power: blind, level: 1, slots, source: 'pick' };
}

/** @return The lines' states by the pieces each takes: { 2: 'earned', 3: 'new', ... }. */
function states(entries: BuildEntry[], after: Slot[], level = L50): Record<number, string> {
  return Object.fromEntries(setBonusLines(gd, entries, 'pick:0', gazeSet, after, level).map((l) => [l.min, l.state]));
}

describe('setBonusLines', () => {
  it("lists the set's bonuses of two pieces and up, each a real bonus power", () => {
    const lines = setBonusLines(gd, [entry('pick:0', [])], 'pick:0', gazeSet, []);
    expect(lines.map((l) => l.min)).toEqual([2, 3, 4, 5, 6]);
    for (const l of lines) expect(gd.powerById.get(l.power)?.lh, String(l.min)).toBeTruthy();
    expect(lines.every((l) => l.state === 'none')).toBe(true);
  });

  it("the owner's example: two pieces in, a third chosen, then a fourth", () => {
    const now = [entry('pick:0', [gaze('A'), gaze('B'), { level: 1 }, { level: 1 }])];
    expect(states(now, [gaze('A'), gaze('B'), gaze('C'), { level: 1 }])).toEqual({ 2: 'earned', 3: 'new', 4: 'none', 5: 'none', 6: 'none' });
    expect(states(now, [gaze('A'), gaze('B'), gaze('C'), gaze('E')])).toEqual({ 2: 'earned', 3: 'new', 4: 'new', 5: 'none', 6: 'none' });
    // nothing chosen yet: what it earns already
    expect(states(now, now[0]!.slots)).toEqual({ 2: 'earned', 3: 'none', 4: 'none', 5: 'none', 6: 'none' });
  });

  it('a bonus the change would lose reads as not earned', () => {
    const now = [entry('pick:0', [gaze('A'), gaze('B'), gaze('C')])];
    expect(states(now, [gaze('A'), gaze('B'), { level: 1 }])).toEqual({ 2: 'earned', 3: 'none', 4: 'none', 5: 'none', 6: 'none' });
  });

  it('counts a crafted and an attuned copy of one piece once, as the totals do', () => {
    const now = [entry('pick:0', [gaze('A'), { level: 1 }, { level: 1 }])];
    const twice = [gaze('A'), gaze('A', 'Attuned'), { level: 1 }];
    expect(states(now, twice)).toEqual({ 2: 'none', 3: 'none', 4: 'none', 5: 'none', 6: 'none' });
    expect(states(now, [...twice.slice(0, 2), gaze('B')])).toEqual({ 2: 'new', 3: 'none', 4: 'none', 5: 'none', 6: 'none' });
  });

  it('leaves out a piece in a slot the build has not reached, as the totals do', () => {
    const now = [entry('pick:0', [gaze('A', 'Attuned'), gaze('B', 'Attuned'), { level: 40 }])];
    const after = [gaze('A', 'Attuned'), gaze('B', 'Attuned'), gaze('C', 'Attuned', 40)];
    expect(states(now, after, 30)[3]).toBe('none');
    expect(states(now, after, L50)[3]).toBe('new');
  });

  it('a sixth copy of a bonus is not earned (the rule of five)', () => {
    const five = [1, 2, 3, 4, 5].map((i) => entry(`pick:${i}`, [gaze('A'), gaze('B')]));
    const mine = entry('pick:0', [gaze('A'), { level: 1 }]);
    // the build's order decides which copies count: this power comes last
    expect(states([...five, mine], [gaze('A'), gaze('B')])).toEqual({ 2: 'none', 3: 'none', 4: 'none', 5: 'none', 6: 'none' });
    expect(states([...five.slice(0, 4), mine], [gaze('A'), gaze('B')])[2]).toBe('new');
  });

  it('agrees with earnedBonuses about the power after the change', () => {
    const after = [gaze('A'), gaze('B'), gaze('C'), gaze('D')];
    const lines = setBonusLines(gd, [entry('pick:0', [])], 'pick:0', gazeSet, after);
    const earned = earnedBonuses(gd, [entry('pick:0', after)]).filter((b) => !b.global && !b.suppressed).map((b) => b.power.id);
    expect(lines.filter((l) => l.state !== 'none').map((l) => l.power).sort()).toEqual([...earned].sort());
  });
});
