/** Where the hover tooltips go: pure placement maths, kept apart from the components for tests. */

/** A rectangle in stage px. */
export interface StageRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** @return A window-px rectangle (getBoundingClientRect) in stage px, or undefined off the stage. */
export function toStage(r: DOMRect | undefined, stage: { w: number; h: number }): StageRect | undefined {
  const wrap = r && document.querySelector('.stage')?.parentElement?.getBoundingClientRect();
  if (!r || !wrap?.width || !wrap.height) return undefined;
  const sx = stage.w / wrap.width;
  const sy = stage.h / wrap.height;
  return { x: (r.left - wrap.left) * sx, y: (r.top - wrap.top) * sy, w: r.width * sx, h: r.height * sy };
}

// Marks a pop-up's or dialog's full-stage layer (its click-catcher or backdrop): while one is on
// screen, a tooltip left under it takes no wheel turn or Page key (PowerTip's popupOpen).
export const POPUP_LAYER = { 'data-popup': '' } as const;

// The Back / Finish bar's height at the stage's foot, which a floating box keeps clear of.
const BOTTOM_BAR = 64;
// A floating box's margin from the stage's top edge.
const TOP_MARGIN = 8;
// How far one wheel "line" (WheelEvent.DOM_DELTA_LINE, Firefox) scrolls a tall box, in stage px.
const WHEEL_LINE = 40;

/**
 * The tallest a floating box may be: from the top margin to the Back / Finish bar. A taller box
 * is cut to this and scrolls with the mouse wheel (Floating in PowerTip.tsx).
 *
 * @param stage The stage size.
 * @return The height in stage px.
 */
export function floatingRoom(stage: { h: number }): number {
  return stage.h - BOTTOM_BAR - TOP_MARGIN;
}

/**
 * How far a wheel turn scrolls a tall floating box, in stage px: the distance the wheel reports,
 * so the text moves as far on screen as the browser's own scrolling would move it.
 *
 * @param e The wheel event's deltaY and deltaMode (0 pixels, 1 lines, 2 pages).
 * @param stagePerPx Stage px per window px (the stage's scale).
 * @param page The box's visible height in stage px (one page).
 * @return The scroll step (positive is down).
 */
export function wheelStep(e: { deltaY: number; deltaMode: number }, stagePerPx: number, page: number): number {
  if (e.deltaMode === 1) return e.deltaY * WHEEL_LINE;
  if (e.deltaMode === 2) return e.deltaY * page;
  return e.deltaY * stagePerPx;
}

/** A scrolling box's position and sizes (an element's scrollTop, clientHeight and scrollHeight). */
export interface BoxScroll {
  scrollTop: number;
  clientHeight: number;
  scrollHeight: number;
}

/** @return Whether a box is cut short: taller than it is shown. */
export function isCut(box: BoxScroll): boolean {
  return box.scrollHeight > box.clientHeight + 1;
}

/**
 * Whether a wheel turn can scroll a tall floating box: the box is cut short and can still move
 * that way. A sideways turn or Ctrl + wheel (the browser's zoom) never scrolls it.
 *
 * @param e The wheel event's deltaY and ctrlKey.
 * @param box The box's scroll position and sizes.
 * @return Whether the box can take the turn.
 */
export function wheelScrollsBox(e: { deltaY: number; ctrlKey: boolean }, box: BoxScroll): boolean {
  if (e.ctrlKey || !e.deltaY || !isCut(box)) return false;
  return e.deltaY > 0 ? box.scrollTop + box.clientHeight < box.scrollHeight - 1 : box.scrollTop > 0;
}

// How long the wheel stays with what it last scrolled, in ms: a turn this soon after the last one
// carries on the same gesture (a spun wheel's notches, a trackpad fling's frames), and a rest this
// long ends it. Short enough that reaching the list past a tooltip's end takes only a brief pause.
export const WHEEL_LATCH_MS = 250;

/** What a wheel gesture is latched to: a floating box, or null for the screen under it. */
export interface WheelLatch<B> {
  box: B | null;
  until: number; // ms (performance.now) the latch lasts to, unless another turn extends it
}

/**
 * Where a wheel turn goes while a floating box is shown, latched the way browsers latch a scroll
 * gesture to one scroller.
 *
 * 1. A sideways turn or Ctrl + wheel goes to the screen. Ctrl + wheel leaves the latch as it is;
 *    sideways movement keeps a live latch going (a diagonal trackpad gesture is one gesture).
 * 2. While a gesture lasts (each turn within WHEEL_LATCH_MS of the last) it stays with what it
 *    started on: a box keeps it at its end (the turn is swallowed, so a fling doesn't run on into
 *    the list), and the screen keeps it when a tall box appears under the pointer as the list
 *    moves (so scrolling a list doesn't stop at each tall tooltip).
 * 3. A new gesture goes to the newest cut-short box if that box can move that way, else to the
 *    screen (past the box's end, the list behind it scrolls); an older box never takes it.
 *
 * @param e The wheel event's deltaY and ctrlKey.
 * @param now The time in ms (performance.now).
 * @param latch The current latch, if any.
 * @param tall The newest cut-short box and its scroll position, if one is shown.
 * @param shown Whether a box is still shown and cut short; a latch to one that isn't ends, so the
 *   turn isn't swallowed by a box with nothing left to scroll.
 * @return The box that takes the turn (null: the screen) and the latch to keep.
 */
export function routeWheel<B>(
  e: { deltaY: number; ctrlKey: boolean },
  now: number,
  latch: WheelLatch<B> | null,
  tall: { box: B; scroll: BoxScroll } | null,
  shown: (b: B) => boolean,
): { box: B | null; latch: WheelLatch<B> | null } {
  const live = !!latch && now < latch.until && (latch.box === null || shown(latch.box));
  if (e.ctrlKey) return { box: null, latch };
  if (!e.deltaY) return { box: null, latch: live && latch ? { box: latch.box, until: now + WHEEL_LATCH_MS } : latch };
  if (live && latch) {
    return { box: latch.box, latch: { box: latch.box, until: now + WHEEL_LATCH_MS } };
  }
  const box = tall && wheelScrollsBox(e, tall.scroll) ? tall.box : null;
  return { box, latch: { box, until: now + WHEEL_LATCH_MS } };
}

/**
 * How far Page Up / Page Down scroll a tall floating box: most of a page, so a line stays in view.
 *
 * @param key The KeyboardEvent key.
 * @param page The box's visible height in stage px.
 * @return The step (positive is down), or 0 for any other key.
 */
export function pageKeyStep(key: string, page: number): number {
  if (key === 'PageDown') return page * 0.9;
  if (key === 'PageUp') return -page * 0.9;
  return 0;
}

// The room a cut-short box keeps on its right for a scrollbar that floats over the content
// (overlay scrollbars, macOS's default), which measures 0 wide, in stage px.
const OVERLAY_BAR = 12;

/**
 * How a cut-short floating box makes room for its scrollbar without its text rewrapping.
 *
 * A scrollbar beside the content (measured wider than 0) narrows it, so the box widens by the
 * bar's width. One that floats over the content measures 0; the box then widens and pads its right
 * side by OVERLAY_BAR, so the bar sits in the padding instead of over the line ends.
 *
 * @param cut The box is cut short.
 * @param measured The scrollbar's measured width (offsetWidth - clientWidth - borders).
 * @return How much wider the box gets (bar) and how much right padding it adds (gutter).
 */
export function scrollRoom(cut: boolean, measured: number): { bar: number; gutter: number } {
  if (!cut) return { bar: 0, gutter: 0 };
  return measured > 0 ? { bar: measured, gutter: 0 } : { bar: OVERLAY_BAR, gutter: OVERLAY_BAR };
}

/**
 * Where a floating box goes: under the pointer, else above it, else beside the hovered bar, so the
 * box never sits on what it describes.
 *
 * A box too tall for the room under or over the pointer goes to whichever side of the bar has room
 * for it, level with the pointer: pinned to the top of the screen, a tall Advanced tooltip would
 * sit right over the bar. Only when neither side has room does it fall back to the top.
 *
 * @param p The pointer and the box: x, y (stage px), w, h (the box), gap (pointer to box top),
 *   left (box start relative to x), pad (room kept on the left for the icon ring).
 * @param stage The stage size.
 * @param bar The hovered bar (stage px), if known.
 * @return The box's top-left corner.
 */
export function placeFloating(p: { x: number; y: number; w: number; h: number; gap: number; left: number; pad: number }, stage: { w: number; h: number }, bar?: StageRect): { x: number; y: number } {
  const { x, y, w, h, gap, left, pad } = p;
  const minX = 8 + pad;
  const maxX = stage.w - w - 8;
  const bottom = stage.h - BOTTOM_BAR;
  const bx = Math.max(minX, Math.min(maxX, x + left));
  // under / over the pointer, and clear of the whole bar
  const below = Math.max(y + gap, bar ? bar.y + bar.h + 6 : -Infinity);
  if (below + h <= bottom) return { x: bx, y: below };
  const above = Math.min(y - 30, bar ? bar.y - 6 : Infinity) - h;
  if (above >= TOP_MARGIN) return { x: bx, y: above };
  // beside the bar (or the pointer), level with the pointer
  const r = bar ?? { x: x - 20, y, w: 40, h: 0 };
  const top = Math.max(TOP_MARGIN, Math.min(bottom - h, y - h / 2));
  if (r.x + r.w + 12 <= maxX) return { x: r.x + r.w + 12, y: top };
  if (r.x - 12 - w >= minX) return { x: r.x - 12 - w, y: top };
  return { x: bx, y: Math.max(TOP_MARGIN, above) };
}
