import { useMemo } from 'react';
import { BuildRules } from '../../engine/rules.ts';
import { useStore } from '../../state/store.ts';
import { MenuFrame, NextButton, TitleBar } from '../components/Chrome.tsx';
import type { Skin } from '../skin/skin.ts';

/** Build overview (provisional placeholder; replaced by the Manage-screen layout). */
export function Overview({ skin }: { skin: Skin }) {
  const { gd, build, steps, editPick, editSlots, toSetup } = useStore();
  const rules = useMemo(() => (gd && build ? new BuildRules(gd, build) : null), [gd, build]);
  if (!gd || !build || !rules) return null;
  return (
    <>
      <TitleBar skin={skin} text="BUILD OVERVIEW" />
      <MenuFrame x={32} y={58} w={1937} h={988} r25 outer />
      <div className="abs" style={{ left: 60, top: 110, width: 1880, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {steps.map((s) => (
          <button
            key={s.level}
            className="info-button"
            style={{ position: 'static' }}
            onClick={() => (s.picks.length ? editPick(s.picks[0]!) : editSlots(s.level))}
          >
            {s.level + 1}
            {s.picks.length ? ' P' : ` S${s.slots}`}
          </button>
        ))}
      </div>
      <div className="abs body-text" style={{ left: 60, top: 260, width: 1880, columns: 3, fontSize: 18 }}>
        {rules.entries().map((e) => (
          <div key={e.key}>
            {e.level + 1} {e.power.dn} ({e.slots.length})
          </div>
        ))}
      </div>
      <NextButton skin={skin} dir="left" text="New Build" onClick={toSetup} />
    </>
  );
}
