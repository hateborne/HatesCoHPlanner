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
  const bottom = stage.h - 64; // the Back / Finish bar
  const bx = Math.max(minX, Math.min(maxX, x + left));
  // under / over the pointer, and clear of the whole bar
  const below = Math.max(y + gap, bar ? bar.y + bar.h + 6 : -Infinity);
  if (below + h <= bottom) return { x: bx, y: below };
  const above = Math.min(y - 30, bar ? bar.y - 6 : Infinity) - h;
  if (above >= 8) return { x: bx, y: above };
  // beside the bar (or the pointer), level with the pointer
  const r = bar ?? { x: x - 20, y, w: 40, h: 0 };
  const top = Math.max(8, Math.min(bottom - h, y - h / 2));
  if (r.x + r.w + 12 <= maxX) return { x: r.x + r.w + 12, y: top };
  if (r.x - 12 - w >= minX) return { x: r.x - 12 - w, y: top };
  return { x: bx, y: Math.max(8, above) };
}
