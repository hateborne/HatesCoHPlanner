import { useMemo, useState } from 'react';
import { BuildRules } from '../../engine/rules.ts';
import { computeTotals } from '../../engine/totals.ts';
import { previewBuild, useStore } from '../../state/store.ts';
import { MenuFrame } from './Chrome.tsx';
import { TotalsPanel } from './TotalsPanel.tsx';

/**
 * Collapsible totals tab on the right edge of the level-up screens: the game's screens have no
 * room for totals, so they slide out over the screen on demand.
 */
export function SideTotals() {
  const { gd, steps, level } = useStore();
  const [open, setOpen] = useState(false);
  const totals = useMemo(() => {
    if (!open || !gd || !level) return null;
    const b = previewBuild(gd, steps, level);
    const lvl = steps[level.step]?.level ?? 49;
    return computeTotals(gd, new BuildRules(gd, b), b, lvl);
  }, [open, gd, steps, level]);
  if (!gd) return null;
  return (
    <>
      <div
        className="abs title-text"
        onClick={() => setOpen(!open)}
        style={{ right: 0, top: 470, width: 46, height: 190, cursor: 'pointer', zIndex: 60, writingMode: 'vertical-rl', textAlign: 'center', fontSize: 24, lineHeight: '46px', border: '3px solid var(--menu-border)', borderRight: 'none', borderRadius: '16px 0 0 16px', background: 'rgba(0,0,40,0.92)', backgroundClip: 'padding-box' }}
        title={open ? 'Hide totals' : 'Show totals at this level'}
      >
        <span style={{ background: 'linear-gradient(var(--title-top), var(--title-bottom))', WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent' }}>TOTALS</span>
      </div>
      {open && totals ? (
        <div className="abs" style={{ right: 46, top: 90, width: 470, height: 930, zIndex: 60 }}>
          <MenuFrame x={0} y={0} w={470} h={930} style={{ background: 'rgba(0,0,20,0.95)' }} />
          <div className="abs scroll-y" style={{ left: 18, top: 12, width: 440, height: 906 }}>
            <div className="title-text" style={{ fontSize: 20 }}>AT LEVEL {totals.level + 1}</div>
            <TotalsPanel gd={gd} t={totals} width={420} />
          </div>
        </div>
      ) : null}
    </>
  );
}
