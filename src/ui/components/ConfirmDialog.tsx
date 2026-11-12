import { useStore } from '../../state/store.ts';
import { useEscape } from '../escape.ts';
import { SKINS } from '../skin/skin.ts';
import { skinOf } from '../../engine/build.ts';
import { MenuFrame, SetTitle } from './Chrome.tsx';
import { GameScroll } from './GameScroll.tsx';
import { useStage } from './Stage.tsx';

/**
 * The planner's confirmation dialog (replacing a build, an origin change that removes
 * enhancements): a framed panel centred on the stage with the question and Proceed / Cancel.
 * A question with a list (the changes a patch move makes) gets a taller panel and the list in a
 * scrolling box under the text.
 * Escape cancels; clicking outside does nothing, so a stray click can't decide for you. It sits
 * above the Build menu's overlay (100), which asks some of these questions.
 */
/** @return The dialog's top edge: centred on a stage of height `stageH`. */
function y0(stageH: number, h: number): number {
  return (stageH - h) / 2;
}

export function ConfirmDialog() {
  const { confirm, closeConfirm, build } = useStore();
  const stage = useStage();
  useEscape(() => closeConfirm(false), !!confirm);
  if (!confirm) return null;
  const skin = SKINS[build ? skinOf(build.alignment) : 'hero'];
  const list = confirm.lines?.length ? confirm.lines : undefined;
  const w = stage.phone ? stage.w - 24 : list ? 900 : 760;
  const h = list ? (stage.phone ? Math.min(stage.h - 60, 760) : 620) : stage.phone ? 400 : 330;
  // the list box: under the text (estimated at ~3 lines), above the buttons
  const listTop = y0(stage.h, h) + (stage.phone ? 76 : 90) + (stage.phone ? 150 : 104);
  const listBottom = y0(stage.h, h) + h - (stage.phone ? 100 : 90);
  const x = (stage.w - w) / 2;
  const y = (stage.h - h) / 2;
  const btnW = Math.min(170, (w - 72) / 2);
  const pad = stage.phone ? 24 : 40;
  return (
    <div className="abs" style={{ left: 0, top: 0, width: stage.w, height: stage.h, zIndex: 105, background: 'rgba(0,0,0,0.55)' }}>
      <MenuFrame x={x} y={y} w={w} h={h} r25 skin={skin} style={{ background: 'rgba(0,3,24,0.97)' }} />
      <SetTitle skin={skin} x={x + (stage.phone ? 22 : 36)} y={y + 26} size={stage.phone ? 26 : 28} text={confirm.title} />
      <div className="abs body-text" style={{ left: x + (stage.phone ? 24 : 40), top: y + (stage.phone ? 76 : 90), width: w - (stage.phone ? 48 : 80), fontSize: 19, lineHeight: 1.35, color: '#cfe8ff', whiteSpace: 'pre-line' }}>
        {confirm.text}
      </div>
      {list ? (
        <GameScroll skin={skin} left={x + pad} top={listTop} width={w - 2 * pad - 14} height={listBottom - listTop} barX={x + w - pad / 2}>
          <div className="body-text" style={{ fontSize: 18, lineHeight: 1.4, color: '#e8f4ff' }}>
            {list.map((l, i) => (
              <div key={i}>{l}</div>
            ))}
          </div>
        </GameScroll>
      ) : null}
      <div className="abs" style={{ left: x, top: y + h - (stage.phone ? 84 : 72), width: w, display: 'flex', justifyContent: 'center', gap: 24 }}>
        <button className="info-button" style={{ position: 'static', width: btnW, padding: 0 }} onClick={() => closeConfirm(true)}>
          {confirm.okLabel ?? 'Proceed'}
        </button>
        <button className="info-button" style={{ position: 'static', width: btnW, padding: 0 }} onClick={() => closeConfirm(false)} autoFocus>
          Cancel
        </button>
      </div>
    </div>
  );
}
