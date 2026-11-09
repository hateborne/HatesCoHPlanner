import type { CSSProperties } from 'react';

/** Split a CSS rgba() string into its rgb() color and alpha. */
function splitAlpha(c: string): { rgb: string; a: number } {
  const m = /^rgba\((\d+),(\d+),(\d+),([\d.]+)\)$/.exec(c.replace(/\s/g, ''));
  if (!m) return { rgb: c, a: 1 };
  return { rgb: `rgb(${m[1]},${m[2]},${m[3]})`, a: Number(m[4]) };
}

interface SpriteProps {
  src: string;
  x: number;
  y: number;
  w: number;
  h: number;
  z?: number;
  tint?: string; // multiply the texture by this rgba color, like the client's display_sprite tint
  style?: CSSProperties;
}

/**
 * One textured quad, optionally tinted (texture x color, alpha from the texture and the tint),
 * which is how the client draws its UI pieces (display_sprite with a color).
 */
export function Sprite({ src, x, y, w, h, z, tint, style }: SpriteProps) {
  const base: CSSProperties = {
    left: x,
    top: y,
    width: w,
    height: h,
    zIndex: z,
    backgroundImage: `url(${src})`,
    ...style,
  };
  if (!tint) return <div className="sprite" style={base} />;
  const { rgb, a } = splitAlpha(tint);
  return (
    <div
      className="sprite tinted"
      style={{
        ...base,
        backgroundColor: rgb,
        WebkitMaskImage: `url(${src})`,
        maskImage: `url(${src})`,
        opacity: a,
      }}
    />
  );
}
