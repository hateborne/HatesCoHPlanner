import { describe, expect, it } from 'vitest';
import { floatingRoom, pageKeyStep, placeFloating, routeWheel, scrollRoom, WHEEL_LATCH_MS, wheelScrollsBox, wheelStep, type StageRect } from '../src/ui/floating.ts';

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

  it('keeps a box cut to floatingRoom whole on the stage, wherever the pointer is', () => {
    const room = floatingRoom(STAGE);
    expect(room).toBe(1125 - 64 - 8);
    for (const y of [100, 463, 900]) {
      for (const bar of [{ x: 1242, y: y - 20, w: 528, h: 41 }, { x: 600, y: y - 20, w: 800, h: 41 }, undefined]) {
        const at = placeFloating(tip(1500, y, room), STAGE, bar);
        expect(at.y).toBeGreaterThanOrEqual(8);
        expect(at.y + room).toBeLessThanOrEqual(STAGE.h - 64);
      }
    }
  });
});

describe('wheelStep (a tall tooltip scrolls with the wheel)', () => {
  it('moves the text as far on screen as the wheel reports in pixels', () => {
    // a 1125-tall stage drawn 562.5 px high: 2 stage px a window px
    expect(wheelStep({ deltaY: 100, deltaMode: 0 }, 2, 1053)).toBe(200);
    expect(wheelStep({ deltaY: -100, deltaMode: 0 }, 2, 1053)).toBe(-200);
  });

  it('turns lines and pages into stage px', () => {
    expect(wheelStep({ deltaY: 3, deltaMode: 1 }, 2, 1053)).toBe(120);
    expect(wheelStep({ deltaY: 1, deltaMode: 2 }, 2, 1053)).toBe(1053);
  });
});

describe('wheelScrollsBox (which turns a tall tooltip takes)', () => {
  const box = (scrollTop: number) => ({ scrollTop, clientHeight: 1053, scrollHeight: 2000 });
  const down = { deltaY: 100, ctrlKey: false };
  const up = { deltaY: -100, ctrlKey: false };

  it('takes a turn while the box is cut short and can move that way', () => {
    expect(wheelScrollsBox(down, box(0))).toBe(true);
    expect(wheelScrollsBox(up, box(500))).toBe(true);
  });

  it("lets a turn past the box's end go to the list under it", () => {
    expect(wheelScrollsBox(down, box(2000 - 1053))).toBe(false);
    expect(wheelScrollsBox(up, box(0))).toBe(false);
  });

  it('leaves a box that fits, a sideways turn and Ctrl + wheel alone', () => {
    expect(wheelScrollsBox(down, { scrollTop: 0, clientHeight: 600, scrollHeight: 600 })).toBe(false);
    expect(wheelScrollsBox({ deltaY: 0, ctrlKey: false }, box(500))).toBe(false);
    expect(wheelScrollsBox({ deltaY: 100, ctrlKey: true }, box(500))).toBe(false);
  });
});

describe('routeWheel (a wheel gesture stays with what it started on)', () => {
  const scroll = (scrollTop: number) => ({ scrollTop, clientHeight: 1053, scrollHeight: 2000 });
  const down = { deltaY: 100, ctrlKey: false };
  const shown = () => true;
  const A = 'tooltip A';
  const B = 'tooltip B';

  it('starts a gesture on the newest cut-short box while it can move, else on the screen', () => {
    expect(routeWheel(down, 0, null, { box: A, scroll: scroll(0) }, shown).box).toBe(A);
    expect(routeWheel(down, 0, null, { box: A, scroll: scroll(947) }, shown).box).toBe(null); // at its end
    expect(routeWheel(down, 0, null, null, shown).box).toBe(null);
  });

  it('keeps a gesture on its box at the box end, so a fling stops there', () => {
    const first = routeWheel(down, 0, null, { box: A, scroll: scroll(900) }, shown);
    const next = routeWheel(down, 100, first.latch, { box: A, scroll: scroll(947) }, shown);
    expect(next.box).toBe(A);
    // after a rest, a new turn past the end goes to the list
    expect(routeWheel(down, 100 + WHEEL_LATCH_MS + 1, next.latch, { box: A, scroll: scroll(947) }, shown).box).toBe(null);
  });

  it('keeps a list scrolling when a tall tooltip appears under the pointer', () => {
    const onList = routeWheel(down, 0, null, null, shown);
    expect(onList.box).toBe(null);
    const next = routeWheel(down, 150, onList.latch, { box: B, scroll: scroll(0) }, shown);
    expect(next.box).toBe(null);
    expect(next.latch?.until).toBe(150 + WHEEL_LATCH_MS);
  });

  it('starts afresh when the box it was latched to is gone', () => {
    const onA = routeWheel(down, 0, null, { box: A, scroll: scroll(0) }, shown);
    expect(routeWheel(down, 50, onA.latch, { box: B, scroll: scroll(0) }, (b) => b !== A).box).toBe(B);
  });

  it('gives the screen the next turn at once when its box is no longer cut short', () => {
    // the box's content shrank (or the stage grew) mid-gesture: nothing is left to scroll in it
    const onA = routeWheel(down, 0, null, { box: A, scroll: scroll(0) }, shown);
    const next = routeWheel(down, 50, onA.latch, null, () => false);
    expect(next.box).toBe(null);
    expect(next.latch).toEqual({ box: null, until: 50 + WHEEL_LATCH_MS });
  });

  it('lets sideways turns through, keeping a live latch going (a diagonal trackpad gesture)', () => {
    const onA = routeWheel(down, 0, null, { box: A, scroll: scroll(0) }, shown);
    const side = routeWheel({ deltaY: 0, ctrlKey: false }, 200, onA.latch, { box: A, scroll: scroll(0) }, shown);
    expect(side.box).toBe(null);
    expect(side.latch).toEqual({ box: A, until: 200 + WHEEL_LATCH_MS });
    // the gesture's next downward frame, more than WHEEL_LATCH_MS after the first, is still A's
    expect(routeWheel(down, 400, side.latch, { box: A, scroll: scroll(947) }, shown).box).toBe(A);
    // an expired latch isn't revived by sideways movement
    const old = { box: A, until: 10 };
    expect(routeWheel({ deltaY: 0, ctrlKey: false }, 500, old, null, shown).latch).toBe(old);
  });

  it('lets Ctrl + wheel (the browser zoom) through without touching the latch', () => {
    const onA = routeWheel(down, 0, null, { box: A, scroll: scroll(0) }, shown);
    const zoom = routeWheel({ deltaY: 100, ctrlKey: true }, 50, onA.latch, { box: A, scroll: scroll(0) }, shown);
    expect(zoom).toEqual({ box: null, latch: onA.latch });
  });
});

describe('pageKeyStep and scrollRoom', () => {
  it('pages a tall box by 90% of its height with Page Up / Page Down only', () => {
    expect(pageKeyStep('PageDown', 1000)).toBe(900);
    expect(pageKeyStep('PageUp', 1000)).toBe(-900);
    expect(pageKeyStep('ArrowDown', 1000)).toBe(0);
  });

  it('widens a cut-short box by a scrollbar beside its text, or pads it for one floating over it', () => {
    expect(scrollRoom(false, 14)).toEqual({ bar: 0, gutter: 0 });
    expect(scrollRoom(true, 14)).toEqual({ bar: 14, gutter: 0 });
    expect(scrollRoom(true, 0)).toEqual({ bar: 12, gutter: 12 });
  });
});
