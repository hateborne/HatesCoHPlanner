import { describe, expect, it } from 'vitest';
import { placeFloating, type StageRect } from '../src/ui/floating.ts';

// the desktop stage, and the Advanced power tooltip (SlotTip: 760 wide, 34 under the pointer)
const STAGE = { w: 2000, h: 1125 };
const tip = (x: number, y: number, h: number) => ({ x, y, w: 760, h, gap: 34, left: 30, pad: 0 });

/** @return Whether the box at `at` (w x h) overlaps the rectangle. */
function overlaps(at: { x: number; y: number }, w: number, h: number, r: StageRect): boolean {
  return at.x < r.x + r.w && r.x < at.x + w && at.y < r.y + r.h && r.y < at.y + h;
}

describe('placeFloating', () => {
  it('puts a box that fits under the pointer there, clear of the whole bar', () => {
    const bar = { x: 1242, y: 175, w: 528, h: 41 };
    const at = placeFloating(tip(1500, 177, 400), STAGE, bar);
    expect(at.y).toBe(bar.y + bar.h + 6);
    expect(overlaps(at, 760, 400, bar)).toBe(false);
  });

  it('puts a box with no room under the pointer above it', () => {
    const bar = { x: 1242, y: 800, w: 528, h: 41 };
    const at = placeFloating(tip(1500, 820, 500), STAGE, bar);
    expect(at.y).toBe(820 - 30 - 500); // 30 over the pointer, which is more than 6 over the bar
    expect(overlaps(at, 760, 500, bar)).toBe(false);
  });

  it('puts a tall tooltip beside a right-hand bar instead of on it (Choose an Epic Power Set)', () => {
    // the right list's fourth power: no room under it or over it for a 700-tall box
    const bar = { x: 1242, y: 443, w: 528, h: 41 };
    const at = placeFloating(tip(1500, 463, 700), STAGE, bar);
    expect(at.x).toBe(bar.x - 12 - 760);
    expect(at.y).toBe(463 - 350);
    expect(overlaps(at, 760, 700, bar)).toBe(false);
  });

  it('puts a tall tooltip right of a left-hand bar', () => {
    const bar = { x: 230, y: 443, w: 528, h: 41 };
    const at = placeFloating(tip(400, 463, 700), STAGE, bar);
    expect(at.x).toBe(bar.x + bar.w + 12);
    expect(overlaps(at, 760, 700, bar)).toBe(false);
  });

  it('keeps a tall box on the stage, beside the pointer when no bar is known', () => {
    const at = placeFloating(tip(1500, 463, 700), STAGE);
    expect(at.x + 760).toBeLessThanOrEqual(1500 - 20);
    expect(at.y).toBeGreaterThanOrEqual(8);
    expect(at.y + 700).toBeLessThanOrEqual(STAGE.h - 64);
  });

  it('falls back to the top when the box fits nowhere else', () => {
    const bar = { x: 600, y: 500, w: 800, h: 41 };
    const at = placeFloating(tip(1000, 520, 1000), STAGE, bar);
    expect(at.y).toBe(8);
  });
});
