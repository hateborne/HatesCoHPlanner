import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { FONTS, ITALIC_DEG, tallestGlyph, textWidth, vs, type FontKey } from '../skin/metrics.ts';
import { useStage } from './Stage.tsx';

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
 * The outline is ttFontBitmapAddOutline's 8-neighbour dilation: an even 1px ring on every side.
 * It is drawn as a black copy of the text stroked 2px wide (1px outside the glyph) under the
 * colored text. Offset drop-shadows can't do it: Chrome truncates a 1-device-pixel offset that
 * lands at 0.99999 after the stage scale, so the right/bottom shadows vanish and only the
 * top/left ones show (the "light from below-right" look).
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
  const g0 = Math.max(0, (capTop / lh) * 100);
  const g1 = Math.min(100, ((baseOff - d) / lh) * 100);
  const layer: CSSProperties = { position: 'absolute', left: 0, top: 0, height: lh, whiteSpace: 'nowrap' };
  return (
    <div
      style={{
        position: 'absolute',
        left: left + (f.outline ? d : 0),
        top,
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
        <span aria-hidden style={{ ...layer, color: '#000', WebkitTextStroke: `${2 * d}px #000`, opacity: 0.8 }}>
          {text}
        </span>
      ) : null}
      <span
        style={{
          ...layer,
          position: 'relative',
          display: 'block',
          backgroundImage: `linear-gradient(to bottom, ${colors[0]} ${g0}%, ${colors[1]} ${g1}%)`,
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
