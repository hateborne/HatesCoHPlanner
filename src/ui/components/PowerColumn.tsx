import type { ReactElement } from 'react';
import type { Power } from '../../data/types.ts';
import type { PowerOption, SetOption } from '../../engine/rules.ts';
import { S, vx, vy } from '../skin/metrics.ts';
import type { Skin } from '../skin/skin.ts';
import { CheckBar, type BarState } from './CheckBar.tsx';
import { GameScroll } from './GameScroll.tsx';
import { GameText } from './GameText.tsx';
import { LockFlash } from './LockFlash.tsx';

/** uiLevelPower.c layout (virtual units): POW_SPACER 50, first bar 35 below the heading. */
export const POW_SPACER = 50;

/** Geometry of one power column in stage px (see desktopColumn / phone callers). */
export interface ColumnGeom {
  left: number; // scroll viewport
  top: number;
  width: number;
  height: number;
  barX: number; // scrollbar anchor (the client's xp*sx)
  headX: number; // heading x, relative to `left`
  barCX: number; // check-box center x of the bars, relative to `left`
  barW: number; // bar width
  firstHead: number; // first heading baseline, relative to `top`
}

/**
 * Desktop column i (0 primary, 1 secondary, 2 pools): frames at x 16 + 336i (320 wide), bars
 * at x 56 / 392 / 744 (FRAME_SPACE + FRAME_OFFSET, 512 - FRAME_WIDTH/2 + FRAME_OFFSET and
 * DEFAULT_SCRN_WD - FRAME_WIDTH + FRAME_OFFSET -- the third ignores FRAME_SPACE, so it sits 16
 * further right inside its frame), 240*sx wide, headings 30 left of the bars, clip/scroll region
 * y 99..585, scrollbar on the frame's right edge (xp 336/672/1008), first heading baseline at y 130.
 */
export function desktopColumn(i: number, extraTop = 0): ColumnGeom {
  const frame = vx(16 + 336 * i);
  const bx = [56, 392, 744][i] ?? 56;
  return {
    left: frame,
    top: vy(99) + extraTop,
    width: vx(320),
    height: vy(486) - extraTop,
    barX: vx(336 + 336 * i),
    headX: vx(bx - 30) - frame,
    barCX: vx(bx) - frame,
    barW: vx(240),
    firstHead: vy(130 - 99),
  };
}

/** State of a pill on the power-pick screens (owned = grey with check, chosen = green). */
export function barState(o: PowerOption, pending?: number): { state: BarState; down: boolean } {
  if (o.power.id === pending) return { state: 'selected', down: true };
  if (o.state === 'owned') return { state: 'unselectable', down: true };
  if (o.state === 'unavailable') return { state: 'unselectable', down: false };
  return { state: 'standard', down: false };
}

interface PowerColumnProps {
  skin: Skin;
  g: ColumnGeom;
  sets: SetOption[];
  pending?: number;
  onPick?: (p: Power) => void;
  onHover?: (p: Power | null) => void;
  flash?: { id: number; key: string; label: string } | null; // a refused pick: that bar flashes `label`
}

/** One column of the Choose a New Power screen: yellow set headings and their check bars. */
export function PowerColumn({ skin, g, sets, pending, onPick, onHover, flash }: PowerColumnProps) {
  const items: ReactElement[] = [];
  let head = g.firstHead;
  let bottom = 0; // content height: last bar's lower edge (9 bars end at 485 of the 486 view)
  for (const s of sets) {
    items.push(<GameText key={`t${s.set.id}`} font="title_12" scale={1.2 * S} x={g.headX} y={head} colors={skin.heading} text={s.set.dn} />);
    let y = head + vy(35);
    for (const o of s.powers) {
      const { state, down } = barState(o, pending);
      const flashing = flash?.key === `power:${o.power.id}`;
      if (flashing) items.push(<LockFlash key={`f${o.power.id}-${flash!.id}`} flashKey={flash!.key} x={g.barCX} y={y} w={g.barW} s={S} />);
      items.push(
        <CheckBar
          key={`p${o.power.id}`}
          skin={skin}
          x={g.barCX}
          y={y}
          wd={g.barW}
          text={flashing ? flash!.label : o.power.dn}
          state={state}
          down={down}
          title={o.reason}
          onClick={o.state === 'available' && onPick ? () => onPick(o.power) : undefined}
          onHover={(on) => onHover?.(on ? o.power : null)}
        />,
      );
      bottom = y + 19 * S;
      y += vy(POW_SPACER);
    }
    head = y + vy(15);
  }
  return (
    <GameScroll skin={skin} left={g.left} top={g.top} width={g.width} height={g.height} barX={g.barX}>
      <div style={{ position: 'relative', height: Math.ceil(bottom), width: '100%' }}>{items}</div>
    </GameScroll>
  );
}
