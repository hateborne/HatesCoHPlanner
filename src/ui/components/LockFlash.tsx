import { useEffect, useRef } from 'react';

/** What a locked power bar says while it flashes. */
export const LOCKED_LABEL = 'Remove Enhancements First!';

/**
 * Three quick red flashes over a power bar that refused a change because its slots hold
 * enhancements (swapping the power or moving those slots would strand them). The bar is scrolled
 * into view first, so a refusal from a level orb is seen even when the power is off screen.
 *
 * @param props.x The bar's check-box centre (CheckBar's x), relative to its scroll content.
 * @param props.y The bar's vertical centre.
 * @param props.w The bar width from x.
 * @param props.s The bar's draw scale.
 */
export function LockFlash({ flashKey, x, y, w, s }: { flashKey: string; x: number; y: number; w: number; s: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [flashKey]);
  return <div ref={ref} className="abs lock-flash" style={{ left: x - 19 * s, top: y - 16 * s, width: w + 17 * s, height: 32 * s, borderRadius: 16 * s, zIndex: 20 }} />;
}
