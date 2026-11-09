import { useEffect, useState, type CSSProperties } from 'react';
import { snap } from '../skin/metrics.ts';
import { useStage } from './Stage.tsx';

/** Split a CSS #rgb / #rrggbb / #rrggbbaa / rgb() / rgba() color into its channels and alpha. */
function parseTint(c: string): { r: number; g: number; b: number; a: number } | null {
  const h = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(c.trim());
  if (h) {
    const x = h[1]!.length === 3 ? h[1]!.replace(/./g, (d) => d + d) : h[1]!;
    return { r: parseInt(x.slice(0, 2), 16), g: parseInt(x.slice(2, 4), 16), b: parseInt(x.slice(4, 6), 16), a: x.length === 8 ? parseInt(x.slice(6, 8), 16) / 255 : 1 };
  }
  const m = /^rgba?\((\d+),(\d+),(\d+)(?:,([\d.]+))?\)$/.exec(c.replace(/\s/g, ''));
  if (!m) return null;
  return { r: +m[1]!, g: +m[2]!, b: +m[3]!, a: m[4] === undefined ? 1 : +m[4] };
}

// (texture, rgb) -> object URL of the pre-multiplied texture, or the pending load
const tinted = new Map<string, string>();
const pending = new Map<string, Promise<void>>();

/**
 * Bake display_sprite's color multiply into a copy of the texture (rgb x tint / 255 per pixel).
 * Drawing that as a plain image avoids CSS blend/mask tinting, whose image layer Chrome
 * pixel-snaps differently from the fill, leaking the raw texture as a bright 1px line wherever
 * two pieces meet at a fractional position.
 */
function bake(src: string, r: number, g: number, b: number): Promise<void> {
  const key = `${src}|${r},${g},${b}`;
  let p = pending.get(key);
  if (p) return p;
  p = new Promise<void>((resolve) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      const ctx = c.getContext('2d');
      if (!ctx) return resolve();
      ctx.drawImage(img, 0, 0);
      const d = ctx.getImageData(0, 0, c.width, c.height);
      const px = d.data;
      for (let i = 0; i < px.length; i += 4) {
        px[i] = (px[i]! * r) / 255;
        px[i + 1] = (px[i + 1]! * g) / 255;
        px[i + 2] = (px[i + 2]! * b) / 255;
      }
      ctx.putImageData(d, 0, 0);
      c.toBlob((blob) => {
        if (blob) tinted.set(key, URL.createObjectURL(blob));
        resolve();
      });
    };
    img.onerror = () => resolve();
    img.src = src;
  });
  pending.set(key, p);
  return p;
}

/** The baked URL for (src, tint) once ready; re-renders the caller when it arrives. */
function useTinted(src: string, tint?: { r: number; g: number; b: number }): string | undefined {
  const key = tint ? `${src}|${tint.r},${tint.g},${tint.b}` : '';
  const ready = key ? tinted.get(key) : undefined;
  const [, force] = useState(0);
  useEffect(() => {
    if (!tint || ready) return;
    let alive = true;
    void bake(src, tint.r, tint.g, tint.b).then(() => {
      if (alive) force((n) => n + 1);
    });
    return () => {
      alive = false;
    };
    // src and tint are folded into key
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, ready]);
  return ready;
}

interface SpriteProps {
  src: string;
  x: number;
  y: number;
  w: number;
  h: number;
  z?: number;
  tint?: string; // multiply the texture by this rgb(a) color, like the client's display_sprite tint
  style?: CSSProperties;
}

/**
 * One textured quad, optionally tinted (texture x color, alpha from the texture and the tint),
 * which is how the client draws its UI pieces (display_sprite with a color).
 *
 * Its edges are snapped to device pixels (relative to its positioned parent, which callers keep
 * device-aligned), so pieces that share an edge tile without anti-aliased seams.
 */
export function Sprite({ src, x, y, w, h, z, tint, style }: SpriteProps) {
  useStage(); // re-render when the scale (and so the snapping grid) changes
  const t = tint ? parseTint(tint) : null;
  const baked = useTinted(src, t ?? undefined);
  const l = snap(x);
  const tp = snap(y);
  const base: CSSProperties = {
    left: l,
    top: tp,
    width: Math.max(0, snap(x + w) - l),
    height: Math.max(0, snap(y + h) - tp),
    zIndex: z,
    backgroundImage: `url(${src})`,
    ...style,
  };
  if (!t) return <div className="sprite" style={base} />;
  if (baked) return <div className="sprite" style={{ ...base, backgroundImage: `url(${baked})`, opacity: t.a * ((style?.opacity as number | undefined) ?? 1) }} />;
  // first frame, before the baked copy exists: tint with a mask (may show edge seams briefly)
  return (
    <div
      className="sprite tinted"
      style={{
        ...base,
        backgroundColor: `rgb(${t.r},${t.g},${t.b})`,
        WebkitMaskImage: `url(${src})`,
        maskImage: `url(${src})`,
        opacity: t.a,
      }}
    />
  );
}
