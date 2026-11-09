import { useStore } from '../../state/store.ts';
import { useEscape } from '../escape.ts';
import { SKINS } from '../skin/skin.ts';
import { skinOf } from '../../engine/build.ts';
import { MenuFrame, SetTitle } from './Chrome.tsx';
import { useStage } from './Stage.tsx';

/**
 * The planner's confirmation dialog (replacing a build, an origin change that removes
 * enhancements): a framed panel centred on the stage with the question and Proceed / Cancel.
 * Escape cancels; clicking outside does nothing, so a stray click can't decide for you.
 */
export function ConfirmDialog() {
  const { confirm, closeConfirm, build } = useStore();
  const stage = useStage();
  useEscape(() => closeConfirm(false), !!confirm);
  if (!confirm) return null;
  const skin = SKINS[build ? skinOf(build.alignment) : 'hero'];
  const w = stage.phone ? 900 : 760;
  const h = stage.phone ? 520 : 330;
  const x = (stage.w - w) / 2;
  const y = (stage.h - h) / 2;
  return (
    <div className="abs" style={{ left: 0, top: 0, width: stage.w, height: stage.h, zIndex: 95, background: 'rgba(0,0,0,0.55)' }}>
      <MenuFrame x={x} y={y} w={w} h={h} r25 skin={skin} style={{ background: 'rgba(0,3,24,0.97)' }} />
      <SetTitle skin={skin} x={x + 36} y={y + 26} size={stage.phone ? 34 : 28} text={confirm.title} />
      <div className="abs body-text" style={{ left: x + 40, top: y + 90, width: w - 80, fontSize: stage.phone ? 26 : 19, lineHeight: 1.35, color: '#cfe8ff', whiteSpace: 'pre-line' }}>
        {confirm.text}
      </div>
      <div className="abs" style={{ left: x, top: y + h - 72, width: w, display: 'flex', justifyContent: 'center', gap: 24 }}>
        <button className="info-button" style={{ position: 'static', width: 170, padding: 0 }} onClick={() => closeConfirm(true)}>
          {confirm.okLabel ?? 'Proceed'}
        </button>
        <button className="info-button" style={{ position: 'static', width: 170, padding: 0 }} onClick={() => closeConfirm(false)} autoFocus>
          Cancel
        </button>
      </div>
    </div>
  );
}
