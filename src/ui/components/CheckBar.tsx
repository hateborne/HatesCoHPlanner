import { useState } from 'react';
import { fitScale, FONTS, S } from '../skin/metrics.ts';
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
  onClick?: () => void;
  onHover?: (on: boolean) => void;
  title?: string;
}

const CHECKBOX_WD = 38;
// How far the stretched 2px mid strips run under the right caps, so no hairline shows at the join.
const OVERLAP = 3;

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
 */
export function CheckBar({ skin, x, y, wd, scale = S, text, state, down, icon, halfText, isPower, onClick, onHover, title }: CheckBarProps) {
  useFontsReady();
  const [hover, setHover] = useState(false);
  const selectable = state !== 'unselectable' && !!onClick;
  const colors: ElemColors =
    state === 'unselectable' ? skin.unselectable : down || state === 'selected' ? skin.selected : skin.standard;
  const lit = hover && selectable;
  const base = lit ? brighten(colors.base, 60) : colors.base;
  const textTop = lit ? brighten(colors.text, 60) : colors.text;
  const s = lit && !halfText ? scale + 0.1 : scale; // the client adds an absolute 0.1
  const sel = (down || state === 'selected') && state !== 'unselectable' ? 'selected_' : '';
  // drawCheckBarEx: the hero skin uses the colored frame textures, the others the _tintable ones
  const tt = skin.name === 'hero' ? '' : '_tintable';
  // the Praetorian skin lays a gold underlight over the meat of every non-gray bar
  const under = skin.name === 'praetorian' && state !== 'unselectable';
  const dir = 'creation/common/checkbar';
  const midW = wd - 22 * s;

  let label = null;
  if (halfText) {
    label = <GameText font="title_9" scale={s} x={x + (CHECKBOX_WD / 2) * s} y={y} colors={[textTop, colors.text2]} text={text} z={9} />;
  } else {
    const fit = Math.min(s, fitScale(FONTS.title_12, text, wd - 1.5 * 22 * s));
    label = <GameText font="title_12" scale={fit} x={x + (CHECKBOX_WD / 2 + 5) * s} y={y + 5 * s} colors={[textTop, colors.text2]} text={text} z={9} />;
  }

  // Everything is placed relative to the bar's (x, y); the outer div is the hover/click box
  // (BuildCBox(x, y - frameL.h*s/2, wd, frameL.h*s)) widened to include the bulb.
  const boxLeft = x - 22 * s;
  const boxTop = y - 19 * s;
  const rx = (v: number) => v - boxLeft;
  const ry = (v: number) => v - boxTop;
  return (
    <div
      className={`checkbar${selectable ? '' : ' gray'}`}
      style={{ left: boxLeft, top: boxTop, width: wd + 22 * s, height: 38 * s }}
      onMouseEnter={() => {
        setHover(true);
        onHover?.(true);
      }}
      onMouseLeave={() => {
        setHover(false);
        onHover?.(false);
      }}
      onClick={
        selectable
          ? () => {
              play('powerselect2');
              onClick?.();
            }
          : undefined
      }
      title={title}
    >
      <Sprite src={ui(`${dir}/checkbar_frame_lg_${sel}l_bulb${tt}`, skin)} x={rx(x - 19 * s - 3 * s)} y={ry(y - 19 * s)} w={38 * s} h={38 * s} z={5} tint={colors.frame} />
      <Sprite src={ui(`${dir}/checkbar_frame_lg_${sel}mid${tt}`, skin)} x={rx(x)} y={ry(y - 15 * s)} w={midW + OVERLAP} h={30 * s} z={3} tint={colors.frame} />
      <Sprite src={ui(`${dir}/checkbar_frame_lg_${sel}r${tt}`, skin)} x={rx(x + midW)} y={ry(y - 15 * s)} w={22 * s} h={30 * s} z={4} tint={colors.frame} />
      {/* meat: the mid strips (base, highlight, shadow) run OVERLAP under the right cap, and the cap
          is composited as one isolated group -- opaque thanks to its base -- so the join neither
          double-applies the translucent strips nor leaves an anti-aliasing hairline */}
      <div className="layer" style={{ left: rx(x), top: ry(y - 16 * s), width: midW + OVERLAP, height: 32 * s, zIndex: 0, isolation: 'isolate' }}>
        <Sprite src={ui(`${dir}/checkbar_meat_base_mid`, skin)} x={0} y={0} w={midW + OVERLAP} h={32 * s} z={0} tint={base} />
        <Sprite src={ui(`${dir}/checkbar_meat_highlight_mid`, skin)} x={0} y={0} w={midW + OVERLAP} h={32 * s} z={1} tint={colors.highlight} />
        <Sprite src={ui(`${dir}/checkbar_meat_shadow_mid`, skin)} x={0} y={0} w={midW + OVERLAP} h={32 * s} z={2} tint={CLR_SHADOW} />
        {under ? <Sprite src={ui(`${dir}/checkbar_meat_base_underlight_mid`, skin)} x={0} y={4 * s} w={midW + OVERLAP} h={24 * s} z={3} /> : null}
      </div>
      <div className="layer" style={{ left: rx(x + midW), top: ry(y - 12 * s), width: 20 * s, height: 24 * s, zIndex: 0, isolation: 'isolate' }}>
        <Sprite src={ui(`${dir}/checkbar_meat_base_r`, skin)} x={0} y={0} w={20 * s} h={24 * s} z={0} tint={base} />
        <Sprite src={ui(`${dir}/checkbar_meat_highlight_r`, skin)} x={0} y={0} w={20 * s} h={24 * s} z={1} tint={colors.highlight} />
        <Sprite src={ui(`${dir}/checkbar_meat_shadow_r`, skin)} x={0} y={0} w={20 * s} h={24 * s} z={2} tint={CLR_SHADOW} />
        {under ? <Sprite src={ui(`${dir}/checkbar_meat_base_underlight_r`, skin)} x={0} y={0} w={20 * s} h={24 * s} z={3} /> : null}
      </div>
      <div className="layer" style={{ left: rx(x), top: ry(y), width: 0, height: 0 }}>
        <CheckBox skin={skin} isPower={isPower} colors={colors} base={base} sc={lit && !icon ? s : scale} down={!!down} gray={state === 'unselectable'} icon={icon} />
      </div>
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
