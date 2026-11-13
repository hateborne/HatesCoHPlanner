import { describe, expect, it } from 'vitest';
import { flashOver, flashStart, SLOT_FLASH_TICKS, TICK_MS, tickStep } from '../src/ui/electric.ts';

describe('electric flash timing', () => {
  it("lasts the live client's 45 ticks on the slot screen, not the source's 5000", () => {
    // drawPowerAndEnhancements' electric_init call writes 0x2d to its duration in the live exe
    expect(SLOT_FLASH_TICKS).toBe(45);
  });

  it('runs about 1.5 s at 60 frames a second, then is over', () => {
    const born = 1000;
    const start = flashStart(born, born, SLOT_FLASH_TICKS)!;
    let age = start.age;
    let t = born;
    while (!flashOver(age, SLOT_FLASH_TICKS)) {
      const next = t + 1000 / 60;
      age += tickStep(t, next);
      t = next;
    }
    expect(t - born).toBeGreaterThanOrEqual(1500);
    expect(t - born).toBeLessThan(1500 + 1000 / 60 + 1);
  });

  it('starts with the burst when fresh, and keeps it for a remount right after the click', () => {
    expect(flashStart(1000, 1000, SLOT_FLASH_TICKS)).toEqual({ age: 0, burst: 5 });
    expect(flashStart(1000, 1000 + 2 * TICK_MS, SLOT_FLASH_TICKS)?.burst).toBe(5);
    // a clock that reads before the click counts as the click
    expect(flashStart(1000, 900, SLOT_FLASH_TICKS)).toEqual({ age: 0, burst: 5 });
  });

  it('remounted partway through keeps its age but not the burst', () => {
    const s = flashStart(1000, 1000 + 10 * TICK_MS, SLOT_FLASH_TICKS)!;
    expect(s.age).toBeCloseTo(10);
    expect(s.burst).toBe(0);
  });

  it('remounted after it ended draws nothing', () => {
    expect(flashStart(1000, 1000 + 46 * TICK_MS, SLOT_FLASH_TICKS)).toBeNull();
    expect(flashStart(1000, 1000 + 60_000, SLOT_FLASH_TICKS)).toBeNull();
  });

  it('advances at most 30 ticks a frame, never backwards', () => {
    expect(tickStep(0, 1000 / 30)).toBeCloseTo(1);
    expect(tickStep(0, 10_000)).toBe(30); // back from a background tab: gfx.c's cap
    expect(tickStep(100, 50)).toBe(0);
  });
});
