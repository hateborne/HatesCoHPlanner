import { describe, expect, it } from 'vitest';
import { DESKTOP, PHONE_MAX_W, PHONE_MIN_H, PHONE_W, stageLayout } from '../src/ui/stageLayout.ts';

describe('stageLayout: which layout a window gets', () => {
  it('gives landscape desktop windows the 2000x1125 game screen', () => {
    for (const [w, h] of [
      [1920, 1080],
      [3840, 2160],
      [1280, 1024],
      [800, 600],
    ] as const) {
      const l = stageLayout(w, h, false);
      expect(l.dims).toEqual(DESKTOP);
      expect(l.rotate).toBe(false);
      expect(l.scale).toBeCloseTo(Math.min(w / 2000, h / 1125), 6);
    }
  });

  it('fills a portrait phone with a phone-shaped stage, 1.5x the old 1000-wide canvas', () => {
    const l = stageLayout(390, 844, true);
    expect(l.dims).toEqual({ w: PHONE_W, h: 1443, phone: true });
    expect(l.scale).toBeCloseTo(390 / 667, 6);
    expect(l.rotate).toBe(false);
    // the game's check bars (38 x S stage px): half way between the old ~22 px and the 2x ~44 px
    expect(38 * 1.4648 * l.scale).toBeCloseTo(32.5, 0);
  });

  it('widens the stage for short phones and portrait tablets instead of going below the height floor', () => {
    const se = stageLayout(375, 667, true);
    expect(se.dims.phone).toBe(true);
    expect(se.dims.w).toBe(PHONE_W);
    expect(se.dims.h).toBeGreaterThanOrEqual(PHONE_MIN_H);
    const ipad = stageLayout(768, 1024, true);
    expect(ipad.dims).toEqual({ w: 800, h: PHONE_MIN_H, phone: true });
    expect(ipad.scale).toBeCloseTo(0.96, 2);
    const squat = stageLayout(900, 1000, false);
    expect(squat.dims.phone).toBe(true);
    expect(squat.dims.w).toBeLessThanOrEqual(PHONE_MAX_W);
    // no part of the stage falls outside the window
    for (const l of [se, ipad, squat]) {
      expect(l.dims.w * l.scale).toBeLessThanOrEqual(Math.max(375, 768, 900) + 0.001);
      expect(l.dims.h * l.scale).toBeLessThanOrEqual(Math.max(667, 1024, 1000) + 0.001);
    }
  });

  it('asks a phone held sideways to turn upright, but not a narrow desktop window', () => {
    expect(stageLayout(844, 390, true).rotate).toBe(true);
    expect(stageLayout(740, 360, true).rotate).toBe(true);
    // a landscape tablet keeps the desktop screen
    expect(stageLayout(1024, 768, true)).toMatchObject({ dims: DESKTOP, rotate: false });
    // a mouse-driven window that is narrow and short gets the phone layout, letterboxed
    const narrow = stageLayout(700, 400, false);
    expect(narrow.rotate).toBe(false);
    expect(narrow.dims.phone).toBe(true);
    expect(narrow.dims.h * narrow.scale).toBeLessThanOrEqual(400.001);
  });
});
