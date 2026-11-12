/**
 * UI metrics ported from the client source instead of hand-tuned.
 *
 * The front-end screens (uiLevelPower.c, uiPowers.c, uiLevelSpec.c) lay out on a virtual 1024x768
 * canvas: calc_scrn_scaling gives sx = width/1024 and sy = height/768, positions use x*sx / y*sy,
 * and sprites and text use the uniform s = min(sx, sy). Our desktop stage is 2000x1125, so
 * sx = 1.953, sy = s = 1.465 -- verified against the user's 3840x2160 screenshots (check-bar body
 * 85px = 30 x 2.8125; text cap heights = point size x draw scale x 2.8125 x 0.80).
 */
export const STAGE_W = 2000;
export const STAGE_H = 1125;
export const SX = STAGE_W / 1024;
export const SY = STAGE_H / 768;
export const S = Math.min(SX, SY);
// The game's screenScale on the 3840x2160 reference screenshots (min(3840/1024, 2160/768)), for
// the few client draws whose size depends on the real resolution rather than the virtual screen.
export const REF_SCREEN_SCALE = 2160 / 768;
// Right end of the planner's top-right labels (archetype, LEVEL N): inside the outer frames, whose
// right edge is at 1969, before their rounded corners begin, so the text doesn't hang past the edge.
export const TOP_LABEL_RIGHT = 1930;

/** Virtual-x to stage px. */
export const vx = (v: number) => v * SX;
/** Virtual-y to stage px. */
export const vy = (v: number) => v * SY;
/** Uniform sprite/text size: virtual px x s. */
export const vs = (v: number) => v * S;

/** A client font context (sprite_font.c loadFonts). */
export interface GameFont {
  family: string; // CSS family registered in index.css
  canvas: string; // family for canvas measurement
  size: number; // base pixel size (em) at draw scale 1
  italic: boolean; // synthetic FreeType shear (x' = x + 0.15y), not an italic face
  outline: boolean; // 1 device-px black outline at 80% alpha (+1px per glyph advance)
  ascent: number; // per-em, from the face's hhea table
  descent: number;
  cap: number; // cap height per em
}

const REDCIRCLE = { family: "'ParagonCity'", canvas: 'ParagonCity', ascent: 1.0, descent: 0.205, cap: 0.8 };
const MONT = { family: "'Montreal'", canvas: 'Montreal', ascent: 1.022, descent: 0.233, cap: 0.721 };
const MONT_HEAVY = { family: "'MontrealHeavy'", canvas: 'MontrealHeavy', ascent: 1.04, descent: 0.233, cap: 0.721 };

export const FONTS = {
  title_9: { ...REDCIRCLE, size: 9, italic: true, outline: true },
  title_12: { ...REDCIRCLE, size: 12, italic: true, outline: true },
  title_14: { ...REDCIRCLE, size: 14, italic: true, outline: true },
  title_18: { ...REDCIRCLE, size: 18, italic: true, outline: true },
  game_9: { ...MONT, size: 9, italic: false, outline: true },
  game_12: { ...MONT, size: 12, italic: false, outline: true },
  game_18: { ...MONT, size: 18, italic: false, outline: true },
  gamebold_18: { ...MONT_HEAVY, size: 18, italic: true, outline: true },
  /** SMF description text: game_12 face without the outline. */
  smf_12: { ...MONT, size: 12, italic: false, outline: false },
} satisfies Record<string, GameFont>;

export type FontKey = keyof typeof FONTS;

/** Shear angle of the synthetic italic: atan(0.15). */
export const ITALIC_DEG = (Math.atan(0.15) * 180) / Math.PI;

let ctx: CanvasRenderingContext2D | null = null;

// Stage px per device pixel. The client's outline (1px), per-glyph advance (+1px) and the small
// text offsets are native screen pixels, so they shrink in stage units as the stage is scaled up.
let devPx = 1;
/** Set by Stage whenever the stage scale or devicePixelRatio changes. */
export function setDevPx(v: number): void {
  devPx = v > 0 && Number.isFinite(v) ? v : 1;
}
/** @return Stage px per device pixel. */
export function getDevPx(): number {
  return devPx;
}

/**
 * Round a stage coordinate to the nearest device pixel (the stage origin is device-aligned).
 *
 * Piece edges snapped this way tile like the client's quads: two pieces that meet on the same
 * snapped edge cover each pixel exactly once instead of both anti-aliasing it.
 *
 * @param v Stage px.
 * @return Stage px on a device-pixel boundary.
 */
export function snap(v: number): number {
  return Math.round(v / devPx) * devPx;
}

/**
 * Advance width of a string in a game font at a pixel size (str_wd): canvas advance plus the
 * outline's +1 device px per glyph and +1 at the end.
 */
export function textWidth(font: GameFont, px: number, text: string): number {
  ctx ??= document.createElement('canvas').getContext('2d');
  if (!ctx) return text.length * px * 0.7;
  ctx.font = `${px}px ${font.canvas}`;
  const w = ctx.measureText(text).width;
  return font.outline ? w + (text.length + 1) * devPx : w;
}

/**
 * Height of the tallest glyph bitmap in a string (ttGetStringDimensionsHandler's stringHeight):
 * the largest per-glyph ink height, plus the outline's pixel on each side for outlined fonts.
 *
 * @param font Game font.
 * @param px Pixel size (em).
 * @param text The string.
 * @return Height in stage px.
 */
export function tallestGlyph(font: GameFont, px: number, text: string): number {
  ctx ??= document.createElement('canvas').getContext('2d');
  if (!ctx) return px * font.cap + (font.outline ? 2 : 0);
  ctx.font = `${px}px ${font.canvas}`;
  let h = 0;
  for (const ch of new Set(text)) {
    if (ch.trim() === '') continue;
    const m = ctx.measureText(ch);
    h = Math.max(h, m.actualBoundingBoxAscent + m.actualBoundingBoxDescent);
  }
  return h + (font.outline ? 2 * devPx : 0);
}

/**
 * The scale that fits text into `avail` stage px (str_sc), measured at draw scale 1.
 *
 * @return avail / width at scale 1 (may exceed 1; callers clamp with MIN like the client).
 */
export function fitScale(font: GameFont, text: string, avail: number): number {
  if (avail < 1) return 0;
  let sc = avail / Math.max(1, textWidth(font, font.size, text));
  for (let i = 0; i < 20; i++) {
    const w = textWidth(font, font.size * sc, text);
    if (w <= avail) break;
    sc = (sc * avail) / w;
  }
  return sc;
}
