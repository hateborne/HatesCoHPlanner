import type { Origin } from '../../data/types.ts';
import { setEnh } from '../../engine/actions.ts';
import { ALIGNMENTS, type Alignment } from '../../engine/build.ts';
import { canSlot } from '../../engine/enhance.ts';
import { BuildRules, type BuildEntry } from '../../engine/rules.ts';
import { useStore } from '../../state/store.ts';
import { icon, type Skin } from '../skin/skin.ts';
import { CheckBar } from './CheckBar.tsx';
import { SetTitle } from './Chrome.tsx';
import { S } from '../skin/metrics.ts';

// The character creator's sounds (UI/Hybrid): every bar click plays N_Select (drawHybridBar), an
// origin also plays N_Origin_<origin>; hovering a bar plays N_MouseEnter and leaving N_MouseExit.
export const SELECT = ['n_select'];
export const originSounds = (o: Origin) => [...SELECT, `n_origin_${o.n}`];

const ROW = 47;
/** Height of the pane's contents from its top (last alignment bar plus a margin). */
export const ORIGIN_PANE_H = 420 + 2 * ROW + 50;

/**
 * The Origin and Alignment column of the New Build screen: both headings and their bars, laid
 * out from (x, y) in a column `w` wide. Used on the setup screen, in the build overview's
 * Origin / Alignment popout and in the phone menu.
 *
 * @param props.k Size of the bars and their spacing (1: the New Build screen's; the pane is
 *   ORIGIN_PANE_H * k tall).
 * @param props.onDesc Called with an origin's help text while it is hovered (null on leave).
 */
export function OriginAlignPane(props: {
  skin: Skin;
  x: number;
  y: number;
  w: number;
  k?: number;
  origin: number | undefined;
  align: Alignment;
  onOrigin: (id: number) => void;
  onAlign: (a: Alignment) => void;
  onDesc?: (d: { text: string; icon?: string } | null) => void;
}) {
  const { skin, x, y, w, k = 1, origin, align, onOrigin, onAlign, onDesc } = props;
  const gd = useStore((s) => s.gd);
  if (!gd) return null;
  return (
    <>
      <SetTitle skin={skin} x={x + 20} y={y + 18 * k} size={12 * 1.2 * S * k} text="Origin" />
      <SetTitle skin={skin} x={x + 20} y={y + 345 * k} size={12 * 1.2 * S * k} text="Alignment" />
      {gd.core.origins.map((o, i) => (
        <CheckBar
          key={o.id}
          testId={`origin:${o.id}`}
          skin={skin}
          x={x + 60 * k}
          y={y + (95 + i * ROW) * k}
          wd={w - 100 * k}
          scale={k}
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
          testId={`align:${a}`}
          skin={skin}
          x={x + 60 * k}
          y={y + (420 + i * ROW) * k}
          wd={w - 100 * k}
          scale={k}
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

/**
 * Switch the current build's origin (the overview's Origin / Alignment popout and the phone menu).
 *
 * Enhancements only the old origin can use (its DOs / SOs) are listed in a confirmation; Proceed
 * switches and empties those slots, Cancel keeps the old origin.
 *
 * @param id The new origin's id.
 */
export async function changeOrigin(id: number): Promise<void> {
  const { gd, build, setBuild, askConfirm } = useStore.getState();
  if (!gd || !build || id === build.origin) return;
  const oi = gd.core.origins.findIndex((o) => o.id === id);
  const bound: { e: BuildEntry; slot: number }[] = [];
  for (const e of new BuildRules(gd, build).entries()) {
    e.slots.forEach((s, i) => {
      const boost = s.enh ? gd.powerById.get(s.enh.boost) : undefined;
      if (boost && !canSlot(gd, e.power, boost, oi)) bound.push({ e, slot: i });
    });
  }
  if (bound.length) {
    const from = gd.core.origins.find((o) => o.id === build.origin)?.dn ?? 'the old origin';
    const to = gd.core.origins[oi]?.dn ?? 'the new origin';
    const ok = await askConfirm({
      title: 'Change origin?',
      text: `Changing from ${from} to ${to} will remove ${bound.length} enhancement${bound.length > 1 ? 's' : ''} bound to ${from}.`,
      okLabel: 'Proceed',
    });
    if (!ok) return;
  }
  let nb = { ...build, origin: id };
  for (const { e, slot } of bound) nb = setEnh(nb, e.key, slot, undefined, e.level);
  setBuild(nb);
}
