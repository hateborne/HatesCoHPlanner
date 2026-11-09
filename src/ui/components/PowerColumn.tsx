import type { ReactElement } from 'react';
import type { Power } from '../../data/types.ts';
import type { PowerOption, SetOption } from '../../engine/rules.ts';
import type { Skin } from '../skin/skin.ts';
import { CheckBar, type BarState } from './CheckBar.tsx';

export const ROW = 73.3;

interface PowerColumnProps {
  skin: Skin;
  x: number;
  y: number;
  w: number;
  h: number;
  sets: SetOption[];
  pending?: number;
  onPick?: (p: Power) => void;
  onHover?: (p: Power | null) => void;
  titleSize?: number;
}

/** State of a pill on the power-pick screens (owned = grey with check, chosen = green). */
export function barState(o: PowerOption, pending?: number): { state: BarState; down: boolean } {
  if (o.power.id === pending) return { state: 'selected', down: true };
  if (o.state === 'owned') return { state: 'unselectable', down: true };
  if (o.state === 'unavailable') return { state: 'unselectable', down: false };
  return { state: 'standard', down: false };
}

/**
 * One panel column on the Choose a New Power screen: each set's yellow italic title followed by
 * its powers as check bars, scrolling when the sets don't fit.
 */
export function PowerColumn({ skin, x, y, w, h, sets, pending, onPick, onHover, titleSize = 30 }: PowerColumnProps) {
  let cy = 0;
  const items: ReactElement[] = [];
  for (const s of sets) {
    items.push(
      <div key={`t${s.set.id}`} className="title-text abs" style={{ left: 20, top: cy + 55, fontSize: titleSize, textTransform: 'uppercase', maxWidth: w - 40, overflow: 'hidden' }}>
        {s.set.dn}
      </div>,
    );
    cy += 138;
    for (const o of s.powers) {
      const { state, down } = barState(o, pending);
      items.push(
        <CheckBar
          key={`p${o.power.id}`}
          skin={skin}
          x={76}
          y={cy}
          wd={w - 120}
          text={o.power.dn}
          state={state}
          down={down}
          title={o.reason}
          onClick={o.state === 'available' && onPick ? () => onPick(o.power) : undefined}
          onHover={(on) => onHover?.(on ? o.power : null)}
        />,
      );
      cy += ROW;
    }
    cy += 10;
  }
  return (
    <div className="abs scroll-y" style={{ left: x, top: y, width: w, height: h }}>
      <div style={{ position: 'relative', height: cy, width: '100%' }}>{items}</div>
    </div>
  );
}
