import { useState } from 'react';
import { CLR_CBLOW, CLR_CRDS, CLR_SHADOW, ui, type ElemColors, type Skin } from '../skin/skin.ts';
import { Sprite } from './Sprite.tsx';

export type BarState = 'standard' | 'selected' | 'unselectable';

interface CheckBarProps {
  skin: Skin;
  x: number; // center of the round check box (left end of the bar)
  y: number; // vertical center
  wd: number; // bar width to the right of x
  scale?: number;
  text: string;
  state: BarState;
  down?: boolean; // checked (owned / chosen)
  icon?: string; // power icon shown inside a power ring instead of the check box
  onClick?: () => void;
  onHover?: (on: boolean) => void;
  title?: string;
}

const CHECKBOX_WD = 38;

/** Brighten an rgba() color by a fixed amount (brightenColor in uiUtilMenu.c). */
function brighten(c: string, amt: number): string {
  return c.replace(/rgba?\((\d+),(\d+),(\d+)/, (_, r, g, b) =>
    `rgba(${Math.min(255, +r + amt)},${Math.min(255, +g + amt)},${Math.min(255, +b + amt)}`,
  );
}

/**
 * The in-game "check bar" pill (drawCheckBarEx): a round check box or power ring on the left,
 * tinted frame and meat layers, and the italic label. Drawn from the client's own textures.
 */
export function CheckBar({ skin, x, y, wd, scale = 1.16, text, state, down, icon, onClick, onHover, title }: CheckBarProps) {
  const [hover, setHover] = useState(false);
  const selectable = state !== 'unselectable' && !!onClick;
  const colors: ElemColors =
    state === 'unselectable' ? skin.unselectable : down || state === 'selected' ? skin.selected : skin.standard;
  const lit = hover && selectable;
  const base = lit ? brighten(colors.base, 60) : colors.base;
  const sc = lit && !icon ? scale + 0.06 : scale;
  const sel = (down || state === 'selected') && state !== 'unselectable' ? 'selected_' : '';
  const dir = 'creation/common/checkbar';
  const frameL = { w: 38 * sc, h: 38 * sc };
  const frameR = { w: 22 * sc, h: 30 * sc };
  const midW = wd - frameR.w;
  const textColor = lit ? brighten(colors.text, 60) : colors.text;

  return (
    <div
      className={`checkbar${selectable ? '' : ' gray'}`}
      style={{ left: x - frameL.w / 2 - 3 * sc, top: y - frameL.h / 2, width: wd + frameL.w / 2 + 3 * sc, height: frameL.h }}
      onMouseEnter={() => {
        setHover(true);
        onHover?.(true);
      }}
      onMouseLeave={() => {
        setHover(false);
        onHover?.(false);
      }}
      onClick={selectable ? onClick : undefined}
      title={title}
    >
      <div className="layer" style={{ left: frameL.w / 2 + 3 * sc, top: frameL.h / 2, width: 0, height: 0 }}>
        {/* frame */}
        <Sprite src={ui(`${dir}/checkbar_frame_lg_${sel}l_bulb`)} x={-frameL.w / 2 - 3 * sc} y={-frameL.h / 2} w={frameL.w} h={frameL.h} z={5} tint={colors.frame} />
        <Sprite src={ui(`${dir}/checkbar_frame_lg_${sel}mid`)} x={0} y={-frameR.h / 2} w={midW} h={frameR.h} z={3} tint={colors.frame} />
        <Sprite src={ui(`${dir}/checkbar_frame_lg_${sel}r`)} x={wd - frameR.w} y={-frameR.h / 2} w={frameR.w} h={frameR.h} z={4} tint={colors.frame} />
        {/* meat */}
        <Sprite src={ui(`${dir}/checkbar_meat_base_mid`)} x={0} y={-16 * sc} w={midW} h={32 * sc} z={0} tint={base} />
        <Sprite src={ui(`${dir}/checkbar_meat_highlight_mid`)} x={0} y={-16 * sc} w={midW} h={32 * sc} z={1} tint={colors.highlight} />
        <Sprite src={ui(`${dir}/checkbar_meat_shadow_mid`)} x={0} y={-16 * sc} w={midW} h={32 * sc} z={2} tint={CLR_SHADOW} />
        <Sprite src={ui(`${dir}/checkbar_meat_base_r`)} x={midW} y={-12 * sc} w={20 * sc} h={24 * sc} z={0} tint={base} />
        <Sprite src={ui(`${dir}/checkbar_meat_highlight_r`)} x={midW} y={-12 * sc} w={20 * sc} h={24 * sc} z={1} tint={colors.highlight} />
        <Sprite src={ui(`${dir}/checkbar_meat_shadow_r`)} x={midW} y={-12 * sc} w={20 * sc} h={24 * sc} z={2} tint={CLR_SHADOW} />
        <CheckBox skin={skin} colors={colors} base={base} sc={sc} down={!!down} gray={state === 'unselectable'} icon={icon} />
        {/* label */}
        <div
          className="bar-text"
          style={{
            position: 'absolute',
            left: (CHECKBOX_WD / 2 + 5) * sc,
            top: -11 * sc,
            fontSize: 19 * sc,
            lineHeight: `${22 * sc}px`,
            maxWidth: midW - (CHECKBOX_WD / 2 + 5) * sc,
            backgroundImage: `linear-gradient(${textColor}, ${colors.text2})`,
            zIndex: 9,
            textTransform: 'uppercase',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {text}
        </div>
      </div>
    </div>
  );
}

/** The round check box at the left of a bar (drawCheckBox), or a power ring with an icon. */
function CheckBox({ colors, base, sc, down, gray, icon }: { skin: Skin; colors: ElemColors; base: string; sc: number; down: boolean; gray: boolean; icon?: string }) {
  const dir = 'creation/common/checkbox';
  const s = 32 * sc;
  const o = -s / 2;
  if (icon) {
    const ring = 38 * sc;
    const hole = 64 * sc * 0.5;
    return (
      <>
        <Sprite src={ui(gray ? 'creation/enhancements/enhnctray_ringhole' : 'creation/enhancements/enhnctray_ringhole_highlight')} x={-hole / 2} y={-hole / 2} w={hole} h={hole} z={6} tint={gray ? 'rgba(204,204,204,1)' : undefined} />
        <Sprite src={icon} x={-16 * sc} y={-16 * sc} w={32 * sc} h={32 * sc} z={10} />
        <Sprite src={ui('hud/tray/tray_ring_power')} x={-ring / 2} y={-ring / 2} w={ring} h={ring} z={9} tint={colors.frame} />
      </>
    );
  }
  const high = down && !gray ? 'rgba(164,240,66,0.75)' : colors.highlight;
  return (
    <>
      <Sprite src={ui(`${dir}/checkbox_base`)} x={o - 0.05 * s} y={o - 0.05 * s} w={s * 1.1} h={s * 1.1} z={6} tint={base} />
      <Sprite src={ui(`${dir}/checkbox_base_shadow`)} x={o} y={o} w={s} h={s} z={7} tint={CLR_CBLOW} />
      <Sprite src={ui(`${dir}/checkbox_base_highlight`)} x={o} y={o} w={s} h={s} z={8} tint={high} />
      <Sprite src={ui(`${dir}/checkbox_ring_dropshadow`)} x={o} y={o} w={s} h={s} z={11} tint={CLR_CRDS} />
      <Sprite src={ui(`${dir}/checkbox_ring`)} x={o} y={o} w={s} h={s} z={12} tint={base} />
      <Sprite src={ui(`${dir}/checkbox_ring_shadow`)} x={o} y={o} w={s} h={s} z={13} tint={CLR_SHADOW} />
      <Sprite src={ui(`${dir}/checkbox_ring_highlight`)} x={o} y={o} w={s} h={s} z={14} tint={high} />
      {down ? (
        <Sprite src={ui(`${dir}/checkedbox_checkmark`)} x={o} y={o} w={s} h={s} z={16} />
      ) : (
        <>
          <Sprite src={ui('creation/enhancements/enhnctray_ringhole')} x={-64 * 0.25 * sc / 2} y={-64 * 0.25 * sc / 2} w={64 * 0.25 * sc} h={64 * 0.25 * sc} z={9} tint={base} />
          <Sprite src={ui(`${dir}/checkbox_base_fill`)} x={o} y={o} w={s} h={s} z={10} tint={colors.fill} />
        </>
      )}
    </>
  );
}
