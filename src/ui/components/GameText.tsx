import { useEffect, useState, type CSSProperties } from 'react';
import { FONTS, ITALIC_DEG, textWidth, vs, type FontKey } from '../skin/metrics.ts';

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
  y: number; // stage px: baseline
  colors: [string, string]; // font_color(top, bottom): per-glyph vertical gradient
  align?: 'left' | 'right' | 'center';
  text: string;
  z?: number;
  style?: CSSProperties;
}

/**
 * Text drawn the way the client's FreeType path draws it: `y` is the baseline, italic is a
 * 0.15 shear around the baseline, outlined fonts get a 1px black outline (80% alpha) plus 1px
 * extra advance per glyph and sit 2px higher / 1px right, and color is a top-to-bottom gradient
 * over each glyph's quad (cap top - 3px to baseline - 1px).
 */
export function GameText({ font: key, scale, x, y, colors, align = 'left', text, z, style }: GameTextProps) {
  useFontsReady();
  const f = FONTS[key];
  const px = f.size * scale;
  const lh = px; // line-height: 1em
  const baseOff = (lh - (f.ascent + f.descent) * px) / 2 + f.ascent * px;
  const w = textWidth(f, px, text);
  const left = align === 'left' ? x : align === 'right' ? x - w : x - w / 2;
  const top = y - baseOff - (f.outline ? 2 : 0);
  const capTop = baseOff - f.cap * px - 3;
  const g0 = Math.max(0, (capTop / lh) * 100);
  const g1 = Math.min(100, ((baseOff - 1) / lh) * 100);
  const filter = f.outline
    ? 'drop-shadow(1px 0 0 rgba(0,0,0,0.8)) drop-shadow(-1px 0 0 rgba(0,0,0,0.8)) drop-shadow(0 1px 0 rgba(0,0,0,0.8)) drop-shadow(0 -1px 0 rgba(0,0,0,0.8))'
    : undefined;
  return (
    <div
      style={{
        position: 'absolute',
        left: left + (f.outline ? 1 : 0),
        top,
        height: lh,
        lineHeight: `${lh}px`,
        fontFamily: f.family,
        fontSize: px,
        letterSpacing: f.outline ? 1 : 0,
        whiteSpace: 'nowrap',
        backgroundImage: `linear-gradient(to bottom, ${colors[0]} ${g0}%, ${colors[1]} ${g1}%)`,
        WebkitBackgroundClip: 'text',
        backgroundClip: 'text',
        color: 'transparent',
        filter,
        transform: f.italic ? `skewX(-${ITALIC_DEG}deg)` : undefined,
        transformOrigin: `0 ${baseOff}px`,
        pointerEvents: 'none',
        zIndex: z,
        ...style,
      }}
    >
      {text}
    </div>
  );
}

/** Convenience: virtual-size helper re-export for callers composing scales. */
export { vs };
