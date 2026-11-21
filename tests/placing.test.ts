import { describe, expect, it } from 'vitest';
import type { SlottedEnh } from '../src/engine/build.ts';
import { placements, type PlacingRules } from '../src/engine/placing.ts';

/** @return A piece by a made-up id (placements reads ids only). */
const piece = (boost: number): SlottedEnh => ({ boost, ioLevel: 49, rel: 0, boosters: 0 });

/** @return Rules for a click on `slot` with these targets: the lists hold the pieces in id order, each its own row. */
function rules(slot: number, targets: number[], current?: SlottedEnh, row: (b: number) => number = (b) => b): PlacingRules {
  return { slot, targets, current, order: (b) => b, row };
}

describe('placements (where Place puts the chosen pieces)', () => {
  it('nothing chosen places nothing', () => {
    expect(placements([], rules(2, [2, 3]))).toEqual([]);
  });

  it('one piece goes into the clicked slot, whatever was there', () => {
    expect(placements([piece(7)], rules(2, [2, 4, 5]))).toEqual([{ slot: 2, enh: piece(7) }]);
    expect(placements([piece(7)], rules(2, [2], piece(9)))).toEqual([{ slot: 2, enh: piece(7) }]);
    // the slot's own piece, only looked at, goes back where it is
    expect(placements([piece(9)], rules(2, [2], piece(9)))).toEqual([{ slot: 2, enh: piece(9) }]);
  });

  it("several pieces fill the targets in the lists' order, not the order they were chosen in", () => {
    expect(placements([piece(30), piece(10), piece(20)], rules(3, [1, 3, 5]))).toEqual([
      { slot: 1, enh: piece(10) },
      { slot: 3, enh: piece(20) },
      { slot: 5, enh: piece(30) },
    ]);
  });

  it("the clicked slot's own piece, still chosen, stays in its slot and the others take the empty ones", () => {
    const got = placements([piece(30), piece(10), piece(20)], rules(3, [1, 3, 5], piece(20)));
    expect(got).toEqual([
      { slot: 3, enh: piece(20) },
      { slot: 1, enh: piece(10) },
      { slot: 5, enh: piece(30) },
    ]);
  });

  it("the slot's own piece is known by its row: its attuned version counts as the same piece", () => {
    // 21 is the attuned version of 20: one row
    const row = (b: number) => (b === 21 ? 20 : b);
    const got = placements([piece(21), piece(10)], rules(3, [1, 3], piece(20), row));
    expect(got).toEqual([
      { slot: 3, enh: piece(21) },
      { slot: 1, enh: piece(10) },
    ]);
  });

  it("the slot's own piece dropped from the choice: the clicked slot is filled like any target", () => {
    expect(placements([piece(10), piece(30)], rules(3, [1, 3], piece(20)))).toEqual([
      { slot: 1, enh: piece(10) },
      { slot: 3, enh: piece(30) },
    ]);
  });

  it('fewer pieces than targets leave the later targets alone', () => {
    expect(placements([piece(10), piece(20)], rules(0, [0, 2, 4]))).toEqual([
      { slot: 0, enh: piece(10) },
      { slot: 2, enh: piece(20) },
    ]);
  });
});
