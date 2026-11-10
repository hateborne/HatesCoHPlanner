import { useMemo, useState } from 'react';
import { BuildRules } from '../../engine/rules.ts';
import { computeTotals } from '../../engine/totals.ts';
import { previewBuild, stepsOf, useStore } from '../../state/store.ts';
import { MenuFrame } from './Chrome.tsx';
import { TitleText } from './GameText.tsx';
import { TotalsPanel } from './TotalsPanel.tsx';
import { phoneGeom } from './Phone.tsx';
import { useStage } from './Stage.tsx';
import { pressKeys } from '../press.ts';

// phones: the tab over the panel's right edge, in stage px
const PHONE_TAB = { w: 40, h: 150 };

/**
 * Collapsible totals tab on the right edge of the level-up screens: the game's screens have no
 * room for totals, so they slide out over the screen on demand.
 */
export function SideTotals() {
  const { gd, steps, level } = useStore();
  const [open, setOpen] = useState(false);
  const stage = useStage();
  const totals = useMemo(() => {
    if (!open || !gd || !level) return null;
    const b = previewBuild(gd, steps, level);
    const lvl = stepsOf(steps, level)[level.step]?.level ?? 49;
    return computeTotals(gd, new BuildRules(gd, b), b, lvl);
  }, [open, gd, steps, level]);
  if (!gd) return null;
  const toggle = () => setOpen(!open);
  const line = phoneGeom(stage).line;
  const tab = stage.phone ? { ...PHONE_TAB, top: Math.round(stage.h * 0.3) } : { top: 470, w: 46, h: 190 };
  const pane = stage.phone ? { top: line + 6, w: stage.w - PHONE_TAB.w - 6, h: stage.h - line - 6 - 110 } : { top: 90, w: 470, h: 930 };
  return (
    <>
      <div
        className="abs"
        onClick={toggle}
        {...pressKeys(toggle, undefined, open ? 'Hide totals' : 'Show totals')}
        style={{ right: 0, top: tab.top, width: tab.w, height: tab.h, cursor: 'pointer', zIndex: 60, writingMode: 'vertical-rl', textAlign: 'center', fontSize: stage.phone ? 20 : 24, lineHeight: `${tab.w}px`, fontFamily: "'ParagonCity', 'MontrealHeavy', sans-serif", border: '3px solid var(--menu-border)', borderRight: 'none', borderRadius: '16px 0 0 16px', background: 'rgba(0,0,40,0.92)', backgroundClip: 'padding-box' }}
        title={open ? 'Hide totals' : 'Show totals at this level'}
      >
        <TitleText style={{ transform: 'none' }}>TOTALS</TitleText>
      </div>
      {open && totals ? (
        <div className="abs" style={{ right: tab.w, top: pane.top, width: pane.w, height: pane.h, zIndex: 60 }}>
          <MenuFrame x={0} y={0} w={pane.w} h={pane.h} style={{ background: 'rgba(0,0,20,0.95)' }} />
          <div className="abs scroll-y" style={{ left: 18, top: 12, width: pane.w - 30, height: pane.h - 24 }}>
            {/* phones: a little larger text than the desktop pane; its spacing keeps it readable */}
            <div style={{ zoom: stage.phone ? 1.15 : 1 }}>
              <TitleText style={{ fontSize: 20 }}>AT LEVEL {totals.level + 1}</TitleText>
              <TotalsPanel gd={gd} t={totals} width={(pane.w - 50) / (stage.phone ? 1.15 : 1)} />
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
