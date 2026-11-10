/**
 * Which layout a window gets and the stage size it is drawn on. Pure (no DOM), so it is tested
 * on its own.
 */

/** Desktop stage: the game's 16:9 screen. */
export const DESKTOP = { w: 2000, h: 1125, phone: false };
// Windows narrower than this always get the phone layout (landscape ones too).
export const PHONE_BREAKPOINT = 768;
// Phone stage width: a 390 px phone draws it at ~0.58, 1.5x the size of the old 1000-wide canvas
// (the owner's middle ground between that and twice its size), so the game's bars are ~33 px.
export const PHONE_W = 667;
// Phone stage height floor: shorter windows widen the stage instead (tablets, iPhone SE).
export const PHONE_MIN_H = 1067;
// Phone stage width cap (a portrait tablet's ~4:3 window).
export const PHONE_MAX_W = 1013;
// A sideways phone (touch screen, landscape, shorter than this) is asked to turn upright.
export const ROTATE_MAX_H = 500;

export type StageDims = { w: number; h: number; phone: boolean };

/** The layout for one window size. */
export interface StageLayout {
  dims: StageDims; // stage size in stage px, and whether it is the phone layout
  scale: number; // CSS zoom from stage px to window px
  rotate: boolean; // a phone held sideways: show the turn-upright message over the stage
}

/**
 * Pick the layout for a window: the desktop stage for landscape windows at least
 * PHONE_BREAKPOINT wide; otherwise the phone stage, shaped like the window so it fills it.
 *
 * The phone stage is PHONE_W wide and as tall as the window's shape makes it, but never shorter
 * than PHONE_MIN_H: a squatter window (a portrait tablet) widens the stage up to PHONE_MAX_W
 * instead, and anything squatter still is letterboxed.
 *
 * @param width Window width in CSS px.
 * @param height Window height in CSS px.
 * @param touch The primary pointer is coarse (a touch screen).
 * @return The stage dims, its scale and whether to ask for the phone to be turned upright.
 */
export function stageLayout(width: number, height: number, touch: boolean): StageLayout {
  const W = Math.max(1, width);
  const H = Math.max(1, height);
  const rotate = touch && W > H && H < ROTATE_MAX_H;
  if (!rotate && W >= PHONE_BREAKPOINT && W >= H) {
    return { dims: DESKTOP, scale: Math.min(W / DESKTOP.w, H / DESKTOP.h), rotate: false };
  }
  const w = Math.min(PHONE_MAX_W, Math.max(PHONE_W, Math.round((PHONE_MIN_H * W) / H)));
  const h = Math.max(PHONE_MIN_H, Math.round((w * H) / W));
  return { dims: { w, h, phone: true }, scale: Math.min(W / w, H / h), rotate };
}
