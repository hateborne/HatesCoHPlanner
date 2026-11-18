import { useState } from 'react';
import { S } from '../skin/metrics.ts';
import type { Skin } from '../skin/skin.ts';
import { ElectricFlash } from './ElectricFlash.tsx';

// the check box's drawn size (drawCheckBox: 32 x scale), and the crackle a little wider than it
const BOX = 32;
const SPARK_K = 1.15;

/** @return Whether the system asks for less motion (then the crackle is a still glow). */
function reducedMotion(): boolean {
  try {
    return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/**
 * The slot screen's electric crackle (ElectricFlash) looping around a check bar's round box: the
 * mark of Advanced Respec on New Build. It bursts when it appears, then flickers for as long as it is shown.
 * With reduced motion asked for, a still white glow around the box stands in for it.
 *
 * @param props.x The box's center (the CheckBar's x).
 * @param props.y The bar's vertical center.
 * @param props.scale The bar's draw scale (default S).
 */
export function BulbSpark({ x, y, scale = S, skin }: { x: number; y: number; scale?: number; skin: Skin }) {
  const [born] = useState(() => performance.now());
  const [still] = useState(reducedMotion);
  if (still) {
    const r = (BOX * scale * SPARK_K) / 2;
    return <div className="abs" style={{ left: x - r, top: y - r, width: 2 * r, height: 2 * r, borderRadius: r, boxShadow: '0 0 10px 4px rgba(200,240,255,0.85)', pointerEvents: 'none', zIndex: 9 }} />;
  }
  return <ElectricFlash x={x} y={y} ring={BOX * scale * SPARK_K} born={born} duration={Infinity} skin={skin} />;
}
