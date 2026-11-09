import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { GameData } from '../../data/gamedata.ts';
import type { Power } from '../../data/types.ts';
import { allowedSetCategories, allowedTypes } from '../../engine/enhance.ts';
import { useStore } from '../../state/store.ts';
import { FONTS, S } from '../skin/metrics.ts';
import { icon, ui, type Skin } from '../skin/skin.ts';
import { smf } from '../smf.tsx';
import { MenuFrame } from './Chrome.tsx';
import { Sprite } from './Sprite.tsx';
import { useStage } from './Stage.tsx';

/**
 * The last pointer position in stage px. Captured on the window, so a hover handler that runs
 * on the same mouse event already sees the new position.
 */
export function usePointer(): React.MutableRefObject<{ x: number; y: number }> {
  const stage = useStage();
  const mouse = useRef({ x: 0, y: 0 });
  useEffect(() => {
    const on = (e: MouseEvent) => {
      const wrap = document.querySelector('.stage')?.parentElement;
      if (!wrap) return;
      const r = wrap.getBoundingClientRect();
      mouse.current = { x: ((e.clientX - r.left) / r.width) * stage.w, y: ((e.clientY - r.top) / r.height) * stage.h };
    };
    window.addEventListener('mousemove', on, true);
    window.addEventListener('mouseover', on, true);
    return () => {
      window.removeEventListener('mousemove', on, true);
      window.removeEventListener('mouseover', on, true);
    };
  }, [stage.w, stage.h]);
  return mouse;
}

/**
 * A floating box under (or, near the bottom, above) a point, kept on screen and sized to its
 * content. `left` is where the box starts relative to x; `pad` reserves room on the left for
 * anything drawn outside the box (the description tip's icon ring).
 */
function Floating({ x, y, w, gap, left = -140, pad = 0, render }: { x: number; y: number; w: number; gap: number; left?: number; pad?: number; render: (box: { x: number; y: number; h: number }, measure: React.RefObject<HTMLDivElement>) => ReactNode }) {
  const stage = useStage();
  const ref = useRef<HTMLDivElement>(null);
  const [h, setH] = useState(0);
  useLayoutEffect(() => {
    const v = ref.current?.offsetHeight ?? 0;
    if (v !== h) setH(v);
  });
  const bx = Math.max(8 + pad, Math.min(stage.w - w - 8, x + left));
  const below = y + gap;
  const by = below + h <= stage.h - 64 ? below : Math.max(8, y - 30 - h);
  return (
    <div className="abs" style={{ left: 0, top: 0, width: 0, height: 0, zIndex: 60, pointerEvents: 'none' }}>
      {render({ x: bx, y: by, h }, ref)}
    </div>
  );
}

const SHIFT_HINT = 'Hold SHIFT for the advanced tooltip.';

/**
 * The build screen's normal hover tip: the power's description drawn like the level-up help box
 * (DescBox) -- a framed panel, the icon in powers_description_iconring on its left edge and the
 * long help in the skin's description green.
 */
export function DescTip({ skin, power, x, y, hint }: { skin: Skin; power: Power; x: number; y: number; hint?: boolean }) {
  const ring = 72 * S;
  const px = FONTS.smf_12.size * S;
  const pad = 12 * S;
  const w = 900;
  return (
    <Floating
      x={x}
      y={y}
      w={w}
      gap={80}
      pad={ring / 2}
      render={(b, ref) => {
        const h = Math.max(ring + 2 * pad, b.h);
        return (
          <>
            <MenuFrame x={b.x} y={b.y} w={w} h={h} skin={skin} style={{ background: '#000314' }} />
            <Sprite src={ui('creation/powers/powers_description_iconring', skin)} x={b.x - ring / 2} y={b.y + h / 2 - ring / 2} w={ring} h={ring} z={3} />
            <Sprite src={icon('powers', power.icon || 'power_missing')} x={b.x - 16 * S} y={b.y + h / 2 - 16 * S} w={32 * S} h={32 * S} z={4} />
            <div
              ref={ref}
              className="abs"
              style={{ left: b.x + ring / 2 + pad, top: b.y, width: w - ring / 2 - 2 * pad, padding: `${pad}px 0`, color: skin.desc, fontFamily: "'Montreal'", fontSize: px, lineHeight: `${Math.round(1.255 * px)}px`, zIndex: 5 }}
            >
              {smf(power.lh || power.sh)}
              {hint ? <div style={{ marginTop: 6, color: '#8fa1b8', fontSize: px * 0.8 }}>{SHIFT_HINT}</div> : null}
            </div>
          </>
        );
      }}
    />
  );
}

// the game's power tooltip (power name, short help, allowed enhancement types and set categories)
export const TIP_PX = 11 * S;
const TIP = { name: '#a9dcff', text: '#ffffff', list: '#8fcfff' };

/** The slot details block: name, short help, allowed enhancements and set categories. */
export function SlotDetails({ gd, power }: { gd: GameData; power: Power }) {
  const types = allowedTypes(gd, power);
  const cats = allowedSetCategories(gd, power);
  return (
    <>
      <div style={{ color: TIP.name, fontWeight: 700, fontSize: TIP_PX * 1.1 }}>{power.dn}</div>
      <div style={{ color: TIP.text }}>{smf(power.sh)}</div>
      {types.length ? (
        <>
          <div style={{ color: TIP.text, marginTop: TIP_PX * 0.9 }}>Allowed Enhancements:</div>
          <div style={{ color: TIP.list }}>{types.join(', ')}</div>
        </>
      ) : (
        <div style={{ color: TIP.list, marginTop: TIP_PX * 0.9 }}>This power cannot be enhanced.</div>
      )}
      {cats.length ? (
        <>
          <div style={{ color: TIP.text, marginTop: TIP_PX * 0.9 }}>Allowed Enhancements Set Categories:</div>
          <div style={{ color: TIP.list }}>{cats.join(', ')}</div>
        </>
      ) : null}
    </>
  );
}

/**
 * The game's power hover tooltip box (screenshot: a dark panel with a thin rounded blue border):
 * the slot details, and in the Advanced view a divider and the detailed info below them.
 */
export function SlotTip({ gd, power, x, y, hint, advanced, w = 640 }: { gd: GameData; power: Power; x: number; y: number; hint?: boolean; advanced?: ReactNode; w?: number }) {
  return (
    <Floating
      x={x}
      y={y}
      w={advanced ? 760 : w}
      gap={34}
      left={30}
      render={(b, ref) => (
        <div
          ref={ref}
          className="abs"
          style={{ left: b.x, top: b.y, width: advanced ? 760 : w, boxSizing: 'border-box', padding: `${TIP_PX * 0.6}px ${TIP_PX * 0.8}px`, background: 'rgba(0,2,24,0.97)', border: '2px solid #3a55d6', borderRadius: TIP_PX * 0.6, fontFamily: "'Montreal'", fontSize: TIP_PX, lineHeight: 1.3, color: TIP.text }}
        >
          <SlotDetails gd={gd} power={power} />
          {advanced ? (
            <>
              <div style={{ borderTop: '1px solid #6d7fd8', margin: `${TIP_PX * 0.8}px 0` }} />
              {advanced}
            </>
          ) : null}
          {hint ? <div style={{ marginTop: 6, color: '#8fa1b8', fontSize: TIP_PX * 0.8 }}>{SHIFT_HINT}</div> : null}
        </div>
      )}
    />
  );
}

/** @return Whether the Shift hint belongs on a normal tooltip (only while tooltips are Enabled). */
export function useShiftHint(): boolean {
  return useStore((s) => s.tips === 'enabled');
}
