import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { S, snap, SY } from '../skin/metrics.ts';
import { ui, type Skin } from '../skin/skin.ts';
import { Sprite } from './Sprite.tsx';

/** doScrollBarEx shell colors (uiScrollBar.c:122-131). */
function scrollColor(skin: Skin): string {
  return skin.name === 'villain' ? 'rgba(68,68,68,1)' : skin.name === 'praetorian' ? 'rgba(110,110,110,1)' : 'rgba(42,119,255,1)';
}

interface GameScrollProps {
  skin: Skin;
  left: number; // scroll viewport (stage px)
  top: number;
  width: number;
  height: number;
  barX: number; // the client's x*sx: the bar is centered at barX - 2s
  barTop?: number; // the client's y*sy when the bar does not start at the viewport top
  barHeight?: number; // the client's view height * sy when it differs from the viewport
  children: ReactNode;
}

/**
 * A scrolling panel with the game's own scrollbar (doScrollBarEx, uiScrollBar.c:55-433): no
 * track, a thumb built from scrollbar_top / scrollbar_mid_plain / scrollbar_btm, and
 * map_zoom up/down arrows. Native scrolling (wheel, touch) still drives it; only the bar is
 * custom. Hidden when the content fits.
 */
export function GameScroll({ skin, left, top, width, height, barX, barTop = top, barHeight = height, children }: GameScrollProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [st, setSt] = useState({ off: 0, doc: 0 });
  const update = () => {
    const el = ref.current;
    if (!el) return;
    const off = el.scrollTop;
    const doc = el.scrollHeight;
    setSt((p) => (p.off === off && p.doc === doc ? p : { off, doc }));
  };
  useLayoutEffect(update);
  const color = scrollColor(skin);
  const s = S;
  // virtual units, as the client computes them
  const viewport = height / SY;
  const doc = st.doc / SY;
  const offset = st.off / SY;
  const show = doc > viewport + 0.5 || offset > 0;
  const view = barHeight / SY;
  const buttonSize = view / Math.max(1, doc / view);
  const buttonScale = Math.max(2, (buttonSize - 18) / 4);
  const scrollHt = view - 18 - 4 * buttonScale;
  const t = doc > viewport ? (offset / (doc - viewport)) * scrollHt : 0;
  const yp = barTop / SY;
  const thumbY = (yp + 9 + t) * SY;
  const step = (dy: number) => ref.current?.scrollBy({ top: dy * SY, behavior: 'smooth' });

  const drag = (e: React.PointerEvent) => {
    const el = ref.current;
    if (!el || scrollHt <= 0) return;
    e.preventDefault();
    const y0 = e.clientY;
    const off0 = el.scrollTop;
    // screen px per stage px (the stage is CSS-scaled to the window)
    const stageScale = (e.currentTarget as HTMLElement).getBoundingClientRect().width / (18 * s) || 1;
    const move = (ev: PointerEvent) => {
      const dyStage = (ev.clientY - y0) / stageScale;
      // thumb travel (virtual) maps onto (doc - view) of scroll (virtual); both scale by SY
      el.scrollTop = off0 + dyStage * ((doc - viewport) / scrollHt);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  return (
    <>
      <div ref={ref} className="abs noscrollbar" onScroll={update} style={{ left: snap(left), top: snap(top), width: snap(left + width) - snap(left), height: snap(top + height) - snap(top), overflowY: 'auto', overflowX: 'hidden' }}>
        {children}
      </div>
      {show ? (
        <>
          <div className="abs" style={{ left: snap(barX - 9 * s), top: snap(barTop - 12 * s), width: 13.2 * s, height: 13.2 * s, cursor: 'pointer', zIndex: 15 }} onClick={() => step(-15)}>
            <Sprite src={ui('hud/map/map_zoom_uparrow')} x={0} y={0} w={13.2 * s} h={13.2 * s} tint={color} />
          </div>
          <div className="abs" style={{ left: snap(barX - 9 * s), top: snap(barTop + barHeight), width: 13.2 * s, height: 13.2 * s, cursor: 'pointer', zIndex: 15 }} onClick={() => step(15)}>
            <Sprite src={ui('hud/map/map_zoom_downarrow')} x={0} y={0} w={13.2 * s} h={13.2 * s} tint={color} />
          </div>
          <div className="abs" onPointerDown={drag} style={{ left: snap(barX - 11 * s), top: snap(thumbY - 9 * s), width: 18 * s, height: 4 * buttonScale * SY + 18 * s, cursor: 'grab', zIndex: 15, touchAction: 'none' }}>
            <Sprite src={ui('hud/common/scroll_bar/scrollbar_top')} x={0} y={0} w={18 * s} h={9 * s} tint={color} />
            <Sprite src={ui('hud/common/scroll_bar/scrollbar_mid_plain')} x={0} y={9 * s} w={18 * s} h={4 * buttonScale * SY} tint={color} />
            <Sprite src={ui('hud/common/scroll_bar/scrollbar_btm')} x={0} y={9 * s + 4 * buttonScale * SY} w={18 * s} h={9 * s} tint={color} />
          </div>
        </>
      ) : null}
    </>
  );
}
