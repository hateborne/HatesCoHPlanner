import { useStore } from '../../state/store.ts';
import { vx, vy } from '../skin/metrics.ts';
import type { Skin } from '../skin/skin.ts';
import { InfoButton } from './Chrome.tsx';
import { useStage } from './Stage.tsx';

/**
 * Planner extra on the desktop level-up screens: View Build and Save / Share at the top center.
 * Either one ends the build at the current level (for planning a level 20 or 35 character); the
 * overview then hides the later levels and offers Continue Leveling. Shown while leveling only,
 * not when a level was reopened from the overview.
 */
export function StopButtons({ skin }: { skin: Skin }) {
  const { level, stopHere } = useStore();
  const stage = useStage();
  if (stage.phone || level?.mode !== 'wizard') return null;
  const w = vx(110);
  const h = vy(26);
  return (
    <>
      <InfoButton skin={skin} x={stage.w / 2 - w / 2 - 8} y={vy(22)} w={w} h={h} text="View Build" onClick={() => stopHere(false)} />
      <InfoButton skin={skin} x={stage.w / 2 + w / 2 + 8} y={vy(22)} w={w} h={h} text="Save / Share" onClick={() => stopHere(true)} />
    </>
  );
}
