import { useStore } from '../../state/store.ts';
import { vx, vy } from '../skin/metrics.ts';
import type { Skin } from '../skin/skin.ts';
import { InfoButton } from './Chrome.tsx';
import { useStage } from './Stage.tsx';

/**
 * Planner extra on the desktop level-up screens: View Build at the top center. It ends the build
 * at the current level (for planning a level 20 or 35 character); the overview then hides the
 * later levels and offers Continue Leveling (and Save / Share). Shown while leveling only, not
 * when a level was reopened from the overview.
 */
export function StopButtons({ skin }: { skin: Skin }) {
  const { level, stopHere } = useStore();
  const stage = useStage();
  if (stage.phone || level?.mode !== 'wizard') return null;
  return <InfoButton skin={skin} x={stage.w / 2} y={vy(22)} w={vx(110)} h={vy(26)} text="View Build" onClick={() => stopHere(false)} />;
}
