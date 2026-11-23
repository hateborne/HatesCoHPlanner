import { useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { BuildRules } from '../../engine/rules.ts';
import { computeTotals } from '../../engine/totals.ts';
import { previewBuild, stepsOf, useStore } from '../../state/store.ts';
import type { Skin } from '../skin/skin.ts';
import { MenuFrame } from './Chrome.tsx';
import { TitleText } from './GameText.tsx';
import { PetPaneLayer, usePetCards } from './PetCard.tsx';
import { skinOf } from '../../engine/build.ts';
import { SKINS } from '../skin/skin.ts';
import { TotalsPanel } from './TotalsPanel.tsx';
import { phoneGeom } from './Phone.tsx';
import { useStage } from './Stage.tsx';
import { pressKeys } from '../press.ts';
import { useCombat } from '../../state/combat.ts';

// phones: the tab over the panel's right edge, in stage px
const PHONE_TAB = { w: 40, h: 150 };
// desktop: the tab below the power columns (Choose a New Power's end at 864, the slot screens' pool
// column at 754) and above the bottom bar (1061), narrow enough to touch only the info box's
// border: higher up it hid the pool column's scroll bar
const DESKTOP_TAB = { top: 866, w: 38, h: 190 };
// the tab's border (its right side open): the lettering's line is the width inside it, so it centers
const TAB_BORDER = 3;

/**
 * Collapsible totals tab on the right edge of the level-up screens: the game's screens have no
 * room for totals, so they slide out over the screen on demand.
 *
 * @param props.skin The current skin (the tab and pane colours).
 */
export function SideTotals({ skin }: { skin: Skin }) {
  const { gd, steps, level } = useStore(useShallow((s) => ({ gd: s.gd, steps: s.steps, level: s.level })));
  const [open, setOpen] = useState(false);
  const stage = useStage();
  const preview = useMemo(() => {
    if (!open || !gd || !level) return null;
    const b = previewBuild(gd, steps, level);
    const lvl = stepsOf(steps, level)[level.step]?.level ?? 49;
    return { b, lvl, rules: new BuildRules(gd, b) };
  }, [open, gd, steps, level]);
  const outOfCombat = useCombat((s) => s.outOfCombat);
  const totals = useMemo(() => (preview && gd ? computeTotals(gd, preview.rules, preview.b, preview.lvl, outOfCombat) : null), [preview, gd, outOfCombat]);
  const pets = usePetCards(gd, preview?.rules ?? null, preview?.b ?? null, preview?.lvl ?? 49);
  if (!gd) return null;
  const toggle = () => setOpen(!open);
  const line = phoneGeom(stage).line;
  const tab = stage.phone ? { ...PHONE_TAB, top: Math.round(stage.h * 0.3) } : DESKTOP_TAB;
  const pane = stage.phone ? { top: line + 6, w: stage.w - PHONE_TAB.w - 6, h: stage.h - line - 6 - 110 } : { top: 90, w: 470, h: 930 };
  return (
    <>
      <div
        className="abs"
        onClick={toggle}
        {...pressKeys(toggle, undefined, open ? 'Hide totals' : 'Show totals')}
        style={{ right: 0, top: tab.top, width: tab.w, height: tab.h, cursor: 'pointer', zIndex: 60, writingMode: 'vertical-rl', textAlign: 'center', fontSize: stage.phone ? 20 : 24, lineHeight: `${tab.w - TAB_BORDER}px`, fontFamily: "'ParagonCity', 'MontrealHeavy', sans-serif", border: `${TAB_BORDER}px solid var(--menu-border)`, borderRight: 'none', borderRadius: '16px 0 0 16px', background: skin.panel, backgroundClip: 'padding-box' }}
        title={open ? 'Hide totals' : 'Show totals at this level'}
      >
        <TitleText style={{ transform: 'none' }}>TOTALS</TitleText>
      </div>
      {open && totals ? (
        <div className="abs" style={{ right: tab.w, top: pane.top, width: pane.w, height: pane.h, zIndex: 60 }}>
          <MenuFrame x={0} y={0} w={pane.w} h={pane.h} skin={skin} style={{ background: skin.panel }} />
          <div className="abs scroll-y" style={{ left: 18, top: 12, width: pane.w - 30, height: pane.h - 24 }}>
            {/* phones: a little larger text than the desktop pane; its spacing keeps it readable */}
            <div style={{ zoom: stage.phone ? 1.15 : 1 }}>
              <TitleText style={{ fontSize: 20 }}>AT LEVEL {totals.level + 1}</TitleText>
              <TotalsPanel gd={gd} t={totals} width={(pane.w - 50) / (stage.phone ? 1.15 : 1)} pets={pets} skin={skin} />
            </div>
          </div>
        </div>
      ) : null}
      {/* drawn on the stage, over the pane; its switches are the overview's (none here) */}
      {open && preview ? <PetPaneLayer gd={gd} skin={SKINS[skinOf(preview.b.alignment)]} entries={pets} build={preview.b} /> : null}
    </>
  );
}
