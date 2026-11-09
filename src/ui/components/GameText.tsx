import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { FONTS, ITALIC_DEG, snap, tallestGlyph, textWidth, vs, type FontKey } from '../skin/metrics.ts';
import { useStage } from './Stage.tsx';

/** Eight 1-device-pixel black shadows: the glyph dilated in every direction. */
function ring(d: number): string {
  const o: string[] = [];
  for (const [x, y] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]] as const) o.push(`${x * d}px ${y * d}px 0 #000`);
  return o.join(', ');
}

let fontsReady = false;
const waiters = new Set<() => void>();
if (typeof document !== 'undefined') {
  void document.fonts?.ready.then(() => {
    fontsReady = true;
    for (const w of waiters) w();
    waiters.clear();
  });
}

/** Re-render once the game fonts have loaded (text widths depend on them). */
export function useFontsReady(): boolean {
  const [ready, setReady] = useState(fontsReady);
  useEffect(() => {
    if (fontsReady) return;
    const w = () => setReady(true);
    waiters.add(w);
    return () => {
      waiters.delete(w);
    };
  }, []);
  return ready;
}

interface GameTextProps {
  font: FontKey;
  scale: number; // the client's draw scale argument (already includes s, e.g. 1.2*s)
  x: number; // stage px: left edge (align left), right edge (right) or center (center)
  y: number; // stage px: baseline (or the vertical center with centerY)
  centerY?: boolean; // the client's CENTER_Y: baseline = y + tallest glyph bitmap / 2 (printBasicWideAbsolute)
  colors: [string, string]; // font_color(top, bottom): per-glyph vertical gradient
  align?: 'left' | 'right' | 'center';
  text: string;
  z?: number;
  spacing?: number; // extra advance per glyph (stage px), e.g. a dynamic font's scaled advances
  style?: CSSProperties;
}

/**
 * Text drawn the way the client's FreeType path draws it: `y` is the baseline, italic is a
 * 0.15 shear around the baseline, outlined fonts get a 1px black outline (80% alpha) plus 1px
 * extra advance per glyph and sit 2px higher / 1px right, and color is a top-to-bottom gradient
 * over each glyph's quad (cap top - 3px to baseline - 1px). Those pixels are device pixels.
 *
 * The outline is ttFontBitmapAddOutline's 8-neighbour dilation: an even, opaque 1px ring on
 * every side (the reference screenshots measure pure black next to the glyph). It is drawn as a
 * black copy of the text under the colored text, with eight 1-device-pixel text shadows doing the
 * dilation. (A centered text stroke left only a faint anti-aliased half-pixel ring, and filter
 * drop-shadows lose their right/bottom copies when Chrome truncates an offset of 0.99999 px.)
 */
export function GameText({ font: key, scale, x, y: yIn, centerY, colors, align = 'left', text, z, spacing = 0, style }: GameTextProps) {
  useFontsReady();
  const d = useStage().devPx; // 1 device pixel in stage px (outline, advance and offsets)
  const f = FONTS[key];
  const px = f.size * scale;
  const y = centerY ? yIn + tallestGlyph(f, px, text) / 2 : yIn;
  const lh = px; // line-height: 1em
  const baseOff = (lh - (f.ascent + f.descent) * px) / 2 + f.ascent * px;
  const w = textWidth(f, px, text) + spacing * text.length;
  const left = align === 'left' ? x : align === 'right' ? x - w : x - w / 2;
  const top = y - baseOff - (f.outline ? 2 * d : 0);
  const capTop = baseOff - f.cap * px - 3 * d;
  // the colored copy paints its gradient over a box padded above and below the 1em line, so
  // descenders (Montreal's p, g, y) and tall glyphs are filled too instead of showing the black
  // outline copy underneath; the stops are in px so the colors stay on the glyph quad
  const pad = 0.4 * lh;
  const g0 = Math.max(0, capTop) + pad;
  const g1 = Math.min(lh, baseOff - d) + pad;
  const layer: CSSProperties = { position: 'absolute', left: 0, top: 0, height: lh, whiteSpace: 'nowrap' };
  return (
    <div
      style={{
        position: 'absolute',
        // the client blits glyph bitmaps on whole pixels: start the run on a device pixel
        left: snap(left + (f.outline ? d : 0)),
        top: snap(top),
        height: lh,
        lineHeight: `${lh}px`,
        fontFamily: f.family,
        fontSize: px,
        letterSpacing: (f.outline ? d : 0) + spacing,
        whiteSpace: 'nowrap',
        transform: f.italic ? `skewX(-${ITALIC_DEG}deg)` : undefined,
        transformOrigin: `0 ${baseOff}px`,
        pointerEvents: 'none',
        zIndex: z,
        ...style,
      }}
    >
      {f.outline ? (
        <span aria-hidden style={{ ...layer, color: '#000', textShadow: ring(d) }}>
          {text}
        </span>
      ) : null}
      <span
        style={{
          ...layer,
          position: 'relative',
          display: 'block',
          top: -pad,
          padding: `${pad}px 0`,
          height: lh + 2 * pad,
          boxSizing: 'border-box',
          backgroundImage: `linear-gradient(to bottom, ${colors[0]} ${g0}px, ${colors[1]} ${g1}px)`,
          WebkitBackgroundClip: 'text',
          backgroundClip: 'text',
          color: 'transparent',
        }}
      >
        {text}
      </span>
    </div>
  );
}

/**
 * In-flow heading in the title_* look (RedCircle, title gradient from the skin, 1px outline),
 * for the planner's own panels. Same two-layer outline as GameText, sized by the caller's CSS.
 *
 * @param props.children The heading text.
 * @param props.className Extra classes (positioning).
 * @param props.style Extra inline style (font size, margins, alignment).
 */
export function TitleText({ children, className, style }: { children: ReactNode; className?: string; style?: CSSProperties }) {
  return (
    <div className={`title-text${className ? ` ${className}` : ''}`} style={style}>
      <span className="title-o" aria-hidden>
        {children}
      </span>
      <span className="title-t">{children}</span>
    </div>
  );
}

/** Convenience: virtual-size helper re-export for callers composing scales. */
export { vs };
