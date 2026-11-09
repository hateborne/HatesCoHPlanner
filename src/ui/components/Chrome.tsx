import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { icon as iconUrl, ui, type Skin } from '../skin/skin.ts';
import { Sprite } from './Sprite.tsx';

/**
 * The animated title bar in the top-left corner (drawMenuTitle): glowing dot, horizontal pipes,
 * right cap, and the title in the RedCircle font that slides open when a new menu appears.
 */
export function TitleBar({ skin, text, x = 55, y = 46, scale = 1.9 }: { skin: Skin; text: string; x?: number; y?: number; scale?: number }) {
  const [open, setOpen] = useState(false);
  const measure = useRef<HTMLSpanElement>(null);
  const [measured, setMeasured] = useState(0);
  useLayoutEffect(() => {
    setMeasured(measure.current?.offsetWidth ?? 0);
  }, [text]);
  useEffect(() => {
    setOpen(false);
    const t = window.setTimeout(() => setOpen(true), 30);
    // fonts load after first layout; re-measure once they're ready
    void document.fonts?.ready.then(() => setMeasured(measure.current?.offsetWidth ?? 0));
    return () => window.clearTimeout(t);
  }, [text]);
  const p = skin.prefix;
  const dir = 'creation/common/titlebar';
  const dot = 47 * scale;
  const capW = 22 * scale;
  const capH = 38 * scale;
  const fontSize = 27 * scale;
  const textW = (measured || text.length * fontSize * 0.8) + 40;
  const wd = textW + dot / 2 + capW;
  return (
    <div className="abs" style={{ left: x - dot / 2, top: y - dot / 2, width: wd + dot, height: dot, zIndex: 30 }}>
      <span ref={measure} className="title-text" style={{ position: 'absolute', visibility: 'hidden', fontSize, whiteSpace: 'nowrap' }}>
        {text}
      </span>
      <div
        className="abs"
        style={{
          left: dot / 2,
          top: dot / 2 - capH / 2 + 4 * scale,
          height: capH - 8 * scale,
          width: open ? wd - capW / 2 : 0,
          background: '#000',
          transition: 'width 0.45s ease-out',
          zIndex: 1,
        }}
      />
      <div
        className="abs"
        style={{
          left: dot / 2 - 10 * scale,
          top: dot / 2 - capH / 2,
          height: capH,
          width: open ? wd - capW / 2 : 0,
          transition: 'width 0.45s ease-out',
          overflow: 'hidden',
          zIndex: 6,
        }}
      >
        <div className="title-text" style={{ position: 'absolute', left: 0, top: 2, fontSize, lineHeight: `${capH}px` }}>
          {text}
        </div>
      </div>
      <Sprite src={ui(`${dir}/${p}titlebar_frame_horiz`)} x={dot / 2} y={dot / 2 - capH / 2} w={open ? wd - capW : 0} h={4 * scale} z={2} style={{ transition: 'width 0.45s ease-out' }} />
      <Sprite src={ui(`${dir}/${p}titlebar_frame_horiz`)} x={dot / 2} y={dot / 2 + capH / 2 - 4 * scale} w={open ? wd - capW : 0} h={4 * scale} z={2} style={{ transition: 'width 0.45s ease-out' }} />
      <Sprite src={ui(`${dir}/${p}titlebar_frame_cap_r`)} x={dot / 2 + (open ? wd - capW : 0)} y={dot / 2 - capH / 2} w={capW} h={capH} z={3} style={{ transition: 'left 0.45s ease-out' }} />
      <Sprite src={ui(`${dir}/${p}titlebar_dot_glow`)} x={-dot * 0.25} y={-dot * 0.25} w={dot * 1.5} h={dot * 1.5} z={3} tint="rgba(255,255,255,0.53)" style={{ animation: 'dotpulse 2.5s ease-in-out infinite' }} />
      <Sprite src={ui(`${dir}/${p}titlebar_dot`)} x={0} y={0} w={dot} h={dot} z={4} />
    </div>
  );
}

/** Outer frame + translucent black panel (drawMenuFrame). */
export function MenuFrame({ x, y, w, h, r25, outer, children, style }: { x: number; y: number; w: number; h: number; r25?: boolean; outer?: boolean; children?: ReactNode; style?: CSSProperties }) {
  return (
    <div className={`menu-frame${r25 ? ' r25' : ''}${outer ? ' outer' : ''}`} style={{ left: x, top: y, width: w, height: h, ...style }}>
      {children}
    </div>
  );
}

/** Cancel / Back / Finish buttons (drawNextButton). */
export function NextButton({ skin, dir, text, locked, glow, onClick, y = 1083, scale = 0.95 }: { skin: Skin; dir: 'left' | 'right'; text: string; locked?: boolean; glow?: boolean; onClick?: () => void; y?: number; scale?: number }) {
  const [hover, setHover] = useState(false);
  const d = dir === 'left' ? 'l' : 'r';
  const l = locked ? 'locked_' : '';
  const p = skin.prefix;
  const nb = 'creation/common/nextbuttons';
  const arrow = 64 * scale;
  const tailW = 216 * scale;
  const tailH = 36 * scale;
  const x = dir === 'left' ? 78 : 1912;
  const lit = hover && !locked;
  const textColors = locked ? ['#fff', '#aaa'] : lit ? ['#fff', skin.name === 'villain' ? '#ff4444' : '#8888ff'] : [skin.title[0], skin.title[1]];
  const fontSize = 26;
  return (
    <div
      className="abs"
      style={{ left: dir === 'left' ? x - arrow / 2 : x - tailW - 200, top: y - arrow / 2, width: tailW + arrow / 2 + 200, height: arrow, cursor: locked ? 'default' : 'pointer', zIndex: 20 }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={locked ? undefined : onClick}
    >
      <div className="abs" style={{ left: dir === 'left' ? arrow / 2 : tailW + 200, top: arrow / 2, width: 0, height: 0 }}>
        {dir === 'left' ? (
          <>
            <Sprite src={ui(`${nb}/${p}next_${l}fade_tail_l`)} x={0} y={-tailH / 2} w={tailW} h={tailH} z={0} />
            <Sprite src={ui(`${nb}/${p}next_${l}fade_afterimage_l`)} x={0} y={-tailH / 2} w={64 * scale} h={tailH} z={1} />
            <Sprite src={ui(`${nb}/${p}next_${lit ? '' : l}button_${d}${lit ? '_glow' : ''}`)} x={-arrow / 2} y={-arrow / 2} w={arrow} h={arrow} z={2} />
            <div className="title-text" style={{ position: 'absolute', left: arrow / 2 + 5, top: -fontSize * 0.62, fontSize, fontFamily: 'MontrealHeavy, sans-serif', fontStyle: 'normal', backgroundImage: `linear-gradient(${textColors[0]}, ${textColors[1]})` }}>
              {text}
            </div>
          </>
        ) : (
          <>
            <Sprite src={ui(`${nb}/${p}next_${l}fade_tail_r`)} x={-tailW} y={-tailH / 2} w={tailW} h={tailH} z={0} />
            <Sprite src={ui(`${nb}/${p}next_${l}fade_afterimage_r`)} x={-64 * scale} y={-tailH / 2} w={64 * scale} h={tailH} z={1} />
            <Sprite src={ui(`${nb}/${p}next_${lit ? '' : l}button_${d}${lit ? '_glow' : ''}`)} x={-arrow / 2} y={-arrow / 2} w={arrow} h={arrow} z={2} />
            {glow && !locked ? (
              <div className="abs" style={{ right: arrow / 2 + 10, top: -28 * scale, height: 56 * scale, width: text.length * 17 + 40, borderRadius: 28, boxShadow: '0 0 18px 6px rgba(122,255,116,0.55)', animation: 'dotpulse 2.5s ease-in-out infinite', zIndex: 1 }} />
            ) : null}
            <div className="title-text" style={{ position: 'absolute', right: arrow / 2 + 5, top: -fontSize * 0.62, fontSize, fontFamily: 'MontrealHeavy, sans-serif', fontStyle: 'normal', backgroundImage: `linear-gradient(${textColors[0]}, ${textColors[1]})` }}>
              {text}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** "Show Detailed Info Here" style pill button. */
export function InfoButton({ x, y, text, onClick, disabled }: { x: number; y: number; text: string; onClick?: () => void; disabled?: boolean }) {
  return (
    <button className="info-button" style={{ left: x, top: y, transform: 'translate(-50%, -50%)' }} onClick={onClick} disabled={disabled}>
      {text}
    </button>
  );
}

/** Game help text uses a little markup (<br>, <color ...>, <b>): keep line breaks, drop the rest. */
export function gameText(s: string | undefined): string {
  if (!s) return '';
  return s
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

/** Bottom description box with the round icon frame (power/AT description in green). */
export function DescBox({ x = 168, y = 880, w = 1687, h = 128, iconSrc, text }: { x?: number; y?: number; w?: number; h?: number; iconSrc?: string; text?: string }) {
  return (
    <>
      <MenuFrame x={x} y={y} w={w} h={h} style={{ borderWidth: 2 }} />
      <div className="abs" style={{ left: x - 52, top: y + h / 2 - 50, width: 100, height: 100, borderRadius: 50, border: '4px solid #2f6bff', background: '#000d33', boxShadow: '0 0 8px #2f6bff', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 3 }}>
        <div style={{ width: 76, height: 76, borderRadius: 38, border: '3px solid #2f6bff', background: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {iconSrc ? <img src={iconSrc} width={56} height={56} alt="" /> : null}
        </div>
      </div>
      <div className="abs desc-text scroll-y" style={{ left: x + 75, top: y + 18, width: w - 100, height: h - 26, whiteSpace: 'pre-line' }}>
        {gameText(text)}
      </div>
    </>
  );
}

/** Section heading inside a panel (yellow italic). */
export function SetTitle({ x, y, text, center, width, size = 30 }: { x: number; y: number; text: string; center?: boolean; width?: number; size?: number }) {
  return (
    <div className="title-text abs" style={{ left: x, top: y, fontSize: size, textTransform: 'uppercase', width, textAlign: center ? 'center' : 'left', overflow: 'hidden', textOverflow: 'ellipsis' }}>
      {text}
    </div>
  );
}

/** An enhancement slot ring, empty or holding an enhancement icon (half-scale tray ring). */
export function SlotRing({ x, y, size = 50, enhIcon, frames, pending, onClick, title }: { x: number; y: number; size?: number; enhIcon?: string; frames?: [string, string]; pending?: boolean; onClick?: () => void; title?: string }) {
  return (
    <div
      className="abs"
      title={title}
      onClick={onClick}
      style={{ left: x - size / 2, top: y - size / 2, width: size, height: size, cursor: onClick ? 'pointer' : 'default', zIndex: 8, animation: pending ? 'slotflash 0.6s ease-out' : undefined }}
    >
      <Sprite src={ui('creation/enhancements/enhnctray_ringhole')} x={size * 0.04} y={size * 0.04} w={size * 0.92} h={size * 0.92} z={0} />
      {enhIcon ? (
        <>
          <Sprite src={enhIcon} x={size * (0.5 - 23 / 64)} y={size * (0.5 - 23 / 64)} w={(size * 46) / 64} h={(size * 46) / 64} z={1} />
          {frames ? (
            <>
              {frames[0] ? <Sprite src={iconUrl('enh', frames[0])} x={0} y={0} w={size / 2} h={size} z={2} /> : null}
              {frames[1] ? <Sprite src={iconUrl('enh', frames[1])} x={size / 2} y={0} w={size / 2} h={size} z={2} /> : null}
            </>
          ) : null}
        </>
      ) : null}
      <Sprite src={ui(pending ? 'creation/enhancements/enhnctray_ring_highlight' : 'creation/enhancements/enhnctray_ring')} x={0} y={0} w={size} h={size} z={3} />
    </div>
  );
}
