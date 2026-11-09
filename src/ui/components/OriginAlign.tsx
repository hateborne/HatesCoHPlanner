import type { Origin } from '../../data/types.ts';
import { ALIGNMENTS, type Alignment } from '../../engine/build.ts';
import { useStore } from '../../state/store.ts';
import { icon, type Skin } from '../skin/skin.ts';
import { CheckBar } from './CheckBar.tsx';
import { SetTitle } from './Chrome.tsx';

// The character creator's sounds (UI/Hybrid): every bar click plays N_Select (drawHybridBar), an
// origin also plays N_Origin_<origin>; hovering a bar plays N_MouseEnter and leaving N_MouseExit.
export const SELECT = ['n_select'];
export const originSounds = (o: Origin) => [...SELECT, `n_origin_${o.n}`];

const ROW = 47;
/** Height of the pane's contents from its top (last alignment bar plus a margin). */
export const ORIGIN_PANE_H = 420 + 2 * ROW + 50;

/**
 * The Origin and Alignment column of the New Build screen: both headings and their bars, laid
 * out from (x, y) in a column `w` wide. Used on the setup screen and, at half scale, in the build
 * overview's Origin / Alignment popout.
 *
 * @param props.onDesc Called with an origin's help text while it is hovered (null on leave).
 */
export function OriginAlignPane(props: {
  skin: Skin;
  x: number;
  y: number;
  w: number;
  origin: number | undefined;
  align: Alignment;
  onOrigin: (id: number) => void;
  onAlign: (a: Alignment) => void;
  onDesc?: (d: { text: string; icon?: string } | null) => void;
}) {
  const { skin, x, y, w, origin, align, onOrigin, onAlign, onDesc } = props;
  const gd = useStore((s) => s.gd);
  if (!gd) return null;
  return (
    <>
      <SetTitle skin={skin} x={x + 20} y={y + 18} text="Origin" />
      <SetTitle skin={skin} x={x + 20} y={y + 345} text="Alignment" />
      {gd.core.origins.map((o, i) => (
        <CheckBar
          key={o.id}
          skin={skin}
          x={x + 60}
          y={y + 95 + i * ROW}
          wd={w - 100}
          scale={1}
          text={o.dn}
          state={o.id === origin ? 'selected' : 'standard'}
          down={o.id === origin}
          icon={icon('origin', o.icon)}
          clickSounds={originSounds(o)}
          hoverSounds
          onClick={() => onOrigin(o.id)}
          onHover={(on) => onDesc?.(on ? { text: o.lh || o.sh, icon: icon('origin', o.icon) } : null)}
        />
      ))}
      {ALIGNMENTS.map((a, i) => (
        <CheckBar
          key={a}
          skin={skin}
          x={x + 60}
          y={y + 420 + i * ROW}
          wd={w - 100}
          scale={1}
          text={a}
          state={a === align ? 'selected' : 'standard'}
          down={a === align}
          clickSounds={SELECT}
          hoverSounds
          onClick={() => onAlign(a)}
        />
      ))}
    </>
  );
}
