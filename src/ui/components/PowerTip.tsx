import { useLayoutEffect, useRef, useState } from 'react';
import type { Power } from '../../data/types.ts';
import { FONTS, S } from '../skin/metrics.ts';
import { icon, ui, type Skin } from '../skin/skin.ts';
import { smf } from '../smf.tsx';
import { MenuFrame } from './Chrome.tsx';
import { Sprite } from './Sprite.tsx';

/**
 * A hover popup with a power's description, drawn like the level-up screen's help box (DescBox):
 * a framed panel, the power icon in powers_description_iconring centered on its left edge, and
 * the long help in the skin's description green. It sizes itself to the text.
 *
 * @param props.power The hovered power.
 * @param props.x Left edge of the frame (stage px); the ring hangs half outside it.
 * @param props.y Top of the frame, or its bottom when `above` is set.
 * @param props.w Frame width (stage px).
 * @param props.above Grow upward from `y` (used near the bottom of the screen).
 */
export function PowerTip({ skin, power, x, y, w, above }: { skin: Skin; power: Power; x: number; y: number; w: number; above?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [textH, setTextH] = useState(0);
  useLayoutEffect(() => {
    const h = ref.current?.offsetHeight ?? 0;
    if (h !== textH) setTextH(h);
  });
  const ring = 72 * S;
  const px = FONTS.smf_12.size * S;
  const pad = 12 * S;
  const h = Math.max(ring + 2 * pad, textH + 2 * pad);
  const top = above ? y - h : y;
  return (
    <div className="abs" style={{ left: 0, top: 0, width: 0, height: 0, zIndex: 60, pointerEvents: 'none' }}>
      <MenuFrame x={x} y={top} w={w} h={h} skin={skin} style={{ background: '#000314' }} />
      <Sprite src={ui('creation/powers/powers_description_iconring', skin)} x={x - ring / 2} y={top + h / 2 - ring / 2} w={ring} h={ring} z={3} />
      <Sprite src={icon('powers', power.icon || 'power_missing')} x={x - 16 * S} y={top + h / 2 - 16 * S} w={32 * S} h={32 * S} z={4} />
      <div
        ref={ref}
        className="abs"
        style={{
          left: x + ring / 2 + pad,
          top: top + pad,
          width: w - ring / 2 - 2 * pad,
          color: skin.desc,
          fontFamily: "'Montreal'",
          fontSize: px,
          lineHeight: `${Math.round(1.255 * px)}px`,
          zIndex: 5,
        }}
      >
        {smf(power.lh || power.sh)}
      </div>
    </div>
  );
}
