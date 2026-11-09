import { useState } from 'react';
import { fitScale, FONTS, S, snap } from '../skin/metrics.ts';
import { CLR_CBLOW, CLR_CRDS, CLR_SHADOW, ui, type ElemColors, type Skin } from '../skin/skin.ts';
import { play } from '../sound.ts';
import { GameText, useFontsReady } from './GameText.tsx';
import { Sprite } from './Sprite.tsx';

export type BarState = 'standard' | 'selected' | 'unselectable';

interface CheckBarProps {
  skin: Skin;
  x: number; // check box center (stage px), like drawCheckBarEx's x
  y: number; // bar vertical center
  wd: number; // bar width from x (stage px; the client passes 240*sx etc.)
  scale?: number; // the client's draw scale (screenScale = s by default)
  text: string;
  state: BarState;
  down?: boolean; // checked (owned / chosen)
  icon?: string; // power icon in a power ring instead of the check box
  halfText?: boolean; // title_9 label, no fit, no hover growth (uiLevelSpec)
  isPower?: boolean; // drawCheckBarEx isPower: a power ring (and hole) in place of the check box
  noBox?: boolean; // no check box: drawMenuBar's rounded left cap, label centered
  clickSounds?: string[]; // played on a click (default: the level-up screens' powerselect2)
  hoverSounds?: boolean; // the character creator's N_MouseEnter / N_MouseExit (drawHybridBar)
  onClick?: () => void;
  onRightClick?: () => void; // planner extra: right-click undoes (e.g. removes a slot placed at this level)
  onHover?: (on: boolean) => void;
  title?: string;
}

const CHECKBOX_WD = 38;

/** brightenColor(c, 60) from uiUtilMenu.c. */
function brighten(c: string, amt: number): string {
  return c.replace(/rgba?\((\d+),(\d+),(\d+)/, (_, r, g, b) =>
    `rgba(${Math.min(255, +r + amt)},${Math.min(255, +g + amt)},${Math.min(255, +b + amt)}`,
  );
}

/**
 * The in-game check bar, a direct port of drawCheckBarEx (uiUtilMenu.c:694-850): tinted frame
 * and meat strips, the round check box (or a power ring with an icon), and the title_12 label
 * at x + 24s with its baseline at y + 5s, shrunk to fit wd - 33s.
 *
 * Every piece edge is snapped to a device pixel and neighbours share the same snapped edge, the
 * way the client's quads tile: abutting pieces at a fractional position would be anti-aliased
 * twice by the browser and leave a light or dark 1px seam where they meet.
 *
 * With `noBox` the bar is drawMenuBarSquished's instead (uiUtilMenu.c:859): L / MID / R frame and
 * meat over the same box, no check box, the label centered.
 */
export function CheckBar(props: CheckBarProps) {
  const { skin, x, y, wd, scale = S, text, state, down, icon, halfText, isPower, noBox, clickSounds, hoverSounds, onClick, onRightClick, onHover, title } = props;
  useFontsReady();
  const [hover, setHover] = useState(false);
  const selectable = state !== 'unselectable' && !!onClick;
  const chosen = down || state === 'selected';
  const colors: ElemColors = state === 'unselectable' ? skin.unselectable : chosen ? skin.selected : skin.standard;
  const lit = hover && selectable;
  const base = lit ? brighten(colors.base, 60) : colors.base;
  const textTop = lit ? brighten(colors.text, 60) : colors.text;
  const s = lit && !halfText ? scale + 0.1 : scale; // the client adds an absolute 0.1
  const sel = chosen && state !== 'unselectable' ? 'selected_' : '';
  // drawCheckBarEx: the hero skin uses the colored frame textures, the others the _tintable ones
  const tt = skin.name === 'hero' ? '' : '_tintable';
  // the Praetorian skin lays a gold underlight over the meat of every non-gray bar
  const under = skin.name === 'praetorian' && state !== 'unselectable';
  const dir = 'creation/common/checkbar';

  // The hover/click box (BuildCBox(x, y - frameL.h*s/2, wd, frameL.h*s)) widened to include the
  // bulb; everything else is placed relative to its snapped corner.
  const boxLeft = snap(x - 22 * s);
  const boxTop = snap(y - 19 * s);
  const rx = (v: number) => snap(v) - boxLeft;
  const ry = (v: number) => snap(v) - boxTop;

  // shared snapped column edges: [left end, end of the left cap, start of the right cap, right end]
  const capW = noBox ? 20 * s : 0;
  const xL = noBox ? x - 22 * s : x;
  const xMid0 = rx(xL + capW);
  const xMid1 = rx(noBox ? x + wd - 20 * s : x + wd - 22 * s);
  const xEnd = rx(noBox ? x + wd : x + wd - 2 * s);
  const frameR0 = rx(x + wd - 22 * s);
  // drawMenuBarSquished lays its frame MID 2px over the L and R frames; abutting them instead
  // keeps the partly transparent border rows from doubling up in those 2px
  const frameMid0 = noBox ? rx(xL + 22 * s) : rx(x);
  const frameMid1 = frameR0;

  let label = null;
  if (noBox) {
    const fit = Math.min(s, fitScale(FONTS.title_12, text, wd - 2 * 22 * s));
    label = <GameText font="title_12" scale={fit} x={(x - 22 * s + x + wd) / 2} y={y + 5 * s} align="center" colors={[textTop, colors.text2]} text={text} z={9} />;
  } else if (halfText) {
    label = <GameText font="title_9" scale={s} x={x + (CHECKBOX_WD / 2) * s} y={y} colors={[textTop, colors.text2]} text={text} z={9} />;
  } else {
    const fit = Math.min(s, fitScale(FONTS.title_12, text, wd - 1.5 * 22 * s));
    label = <GameText font="title_12" scale={fit} x={x + (CHECKBOX_WD / 2 + 5) * s} y={y + 5 * s} colors={[textTop, colors.text2]} text={text} z={9} />;
  }

  // a meat group (base, highlight, shadow, Praetorian underlight) between two snapped columns
  const meat = (piece: 'l' | 'mid' | 'r', l: number, r: number) => {
    const h = piece === 'mid' ? 32 * s : 24 * s;
    const t = ry(y - h / 2);
    const hh = ry(y + h / 2) - t;
    const w = r - l;
    if (w <= 0) return null;
    const uT = piece === 'mid' ? ry(y - 12 * s) - t : 0;
    const uH = piece === 'mid' ? ry(y + 12 * s) - ry(y - 12 * s) : hh;
    return (
      <div className="layer" style={{ left: l, top: t, width: w, height: hh, zIndex: 0, isolation: 'isolate' }}>
        <Sprite src={ui(`${dir}/checkbar_meat_base_${piece}`, skin)} x={0} y={0} w={w} h={hh} z={0} tint={base} />
        <Sprite src={ui(`${dir}/checkbar_meat_highlight_${piece}`, skin)} x={0} y={0} w={w} h={hh} z={1} tint={colors.highlight} />
        <Sprite src={ui(`${dir}/checkbar_meat_shadow_${piece}`, skin)} x={0} y={0} w={w} h={hh} z={2} tint={CLR_SHADOW} />
        {under ? <Sprite src={ui(`${dir}/checkbar_meat_base_underlight_${piece}`, skin)} x={0} y={uT} w={w} h={uH} z={3} /> : null}
      </div>
    );
  };
  const fTop = ry(y - 15 * s);
  const fH = ry(y + 15 * s) - fTop;

  return (
    <div
      className={`checkbar${selectable ? '' : ' gray'}`}
      style={{ left: boxLeft, top: boxTop, width: snap(x + wd) - boxLeft, height: snap(y + 19 * s) - boxTop }}
      onMouseEnter={() => {
        setHover(true);
        if (hoverSounds && selectable && !chosen) play('n_mouseenter');
        onHover?.(true);
      }}
      onMouseLeave={() => {
        setHover(false);
        if (hoverSounds && selectable && !chosen) play('n_mouseexit', { noInterrupt: true });
        onHover?.(false);
      }}
      onClick={
        selectable
          ? () => {
              for (const snd of clickSounds ?? ['powerselect2']) play(snd);
              onClick?.();
            }
          : undefined
      }
      onContextMenu={
        onRightClick
          ? (e) => {
              e.preventDefault();
              onRightClick();
            }
          : undefined
      }
      title={title}
    >
      {noBox ? (
        <Sprite src={ui(`${dir}/checkbar_frame_lg_${sel}l${tt}`, skin)} x={rx(xL)} y={fTop} w={rx(xL + 22 * s) - rx(xL)} h={fH} z={5} tint={colors.frame} />
      ) : (
        <Sprite src={ui(`${dir}/checkbar_frame_lg_${sel}l_bulb${tt}`, skin)} x={rx(x - 22 * s)} y={ry(y - 19 * s)} w={rx(x + 16 * s) - rx(x - 22 * s)} h={ry(y + 19 * s) - ry(y - 19 * s)} z={5} tint={colors.frame} />
      )}
      <Sprite src={ui(`${dir}/checkbar_frame_lg_${sel}mid${tt}`, skin)} x={frameMid0} y={fTop} w={frameMid1 - frameMid0} h={fH} z={3} tint={colors.frame} />
      <Sprite src={ui(`${dir}/checkbar_frame_lg_${sel}r${tt}`, skin)} x={frameR0} y={fTop} w={rx(x + wd) - frameR0} h={fH} z={4} tint={colors.frame} />
      {/* meat: the mid strips and each cap are composited as isolated groups that meet on one
          snapped column, so the translucent highlight/shadow strips never double up */}
      {noBox ? meat('l', rx(xL), xMid0) : null}
      {meat('mid', noBox ? xMid0 : rx(x), xMid1)}
      {meat('r', xMid1, xEnd)}
      {noBox ? null : (
        <div className="layer" style={{ left: rx(x), top: ry(y), width: 0, height: 0 }}>
          <CheckBox skin={skin} isPower={isPower} colors={colors} base={base} sc={lit && !icon ? s : scale} down={!!down} gray={state === 'unselectable'} icon={icon} />
        </div>
      )}
      <div className="layer" style={{ left: -boxLeft, top: -boxTop, width: 0, height: 0 }}>
        {label}
      </div>
    </div>
  );
}

/** drawCheckBox: the round box at the bar's left end, or a power ring holding an icon. */
function CheckBox({ skin, isPower, colors, base, sc, down, gray, icon }: { skin: Skin; isPower?: boolean; colors: ElemColors; base: string; sc: number; down: boolean; gray: boolean; icon?: string }) {
  const dir = 'creation/common/checkbox';
  const praet = skin.name === 'praetorian';
  const sz = 32 * sc;
  const o = -sz / 2;
  if (icon || isPower) {
    const ring = 38 * sc;
    const hole = 64 * sc * 0.5;
    return (
      <>
        <Sprite src={ui(!gray ? 'creation/enhancements/enhnctray_ringhole_highlight' : praet ? 'creation/enhancements/p_enhnctray_ringhole_disable' : 'creation/enhancements/enhnctray_ringhole', praet ? undefined : skin)} x={-hole / 2} y={-hole / 2} w={hole} h={hole} z={6} tint={gray ? 'rgba(204,204,204,1)' : undefined} />
        {icon ? <Sprite src={icon} x={-16 * sc} y={-16 * sc} w={32 * sc} h={32 * sc} z={10} /> : null}
        <Sprite src={ui('hud/tray/tray_ring_power', skin)} x={-ring / 2} y={-ring / 2} w={ring} h={ring} z={9} tint={praet && !gray ? 'rgba(255,231,0,1)' : colors.frame} />
      </>
    );
  }
  // CLR_HIGH_SELECT (a4f042bf) when checked, 0xffffffbf on the Praetorian skin
  const high = down && !gray ? (praet ? 'rgba(255,255,255,0.75)' : 'rgba(164,240,66,0.75)') : colors.highlight;
  return (
    <>
      <Sprite src={ui(`${dir}/checkbox_base`, skin)} x={o - 0.05 * sz} y={o - 0.05 * sz} w={sz * 1.1} h={sz * 1.1} z={6} tint={base} />
      <Sprite src={ui(`${dir}/checkbox_base_shadow`, skin)} x={o} y={o} w={sz} h={sz} z={7} tint={CLR_CBLOW} />
      <Sprite src={ui(`${dir}/checkbox_base_highlight`, skin)} x={o} y={o} w={sz} h={sz} z={8} tint={high} />
      <Sprite src={ui(`${dir}/checkbox_ring_dropshadow`, skin)} x={o} y={o} w={sz} h={sz} z={11} tint={CLR_CRDS} />
      <Sprite src={ui(`${dir}/checkbox_ring`, skin)} x={o} y={o} w={sz} h={sz} z={12} tint={base} />
      <Sprite src={ui(`${dir}/checkbox_ring_shadow`, skin)} x={o} y={o} w={sz} h={sz} z={13} tint={CLR_SHADOW} />
      <Sprite src={ui(`${dir}/checkbox_ring_highlight`, skin)} x={o} y={o} w={sz} h={sz} z={14} tint={high} />
      {praet && !gray ? <Sprite src={ui(`${dir}/checkbox_base_underlight`, skin)} x={o} y={o} w={sz} h={sz} z={15} /> : null}
      {down ? (
        <Sprite src={ui(`${dir}/checkedbox_checkmark`, skin)} x={o} y={o} w={sz} h={sz} z={16} />
      ) : (
        <>
          <Sprite src={ui('creation/enhancements/enhnctray_ringhole', skin)} x={(-64 * 0.25 * sc) / 2} y={(-64 * 0.25 * sc) / 2} w={64 * 0.25 * sc} h={64 * 0.25 * sc} z={9} tint={base} />
          <Sprite src={ui(`${dir}/checkbox_base_fill`, skin)} x={o} y={o} w={sz} h={sz} z={10} tint={colors.fill} />
        </>
      )}
    </>
  );
}
