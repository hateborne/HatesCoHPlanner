/**
 * Where the set finder's "Select Powers to Consider" box and its Done button sit while the powers
 * are picked on the overview. Kept apart from the finder's pane so the overview can make room for
 * the box without loading the pane.
 */
import { phoneGeom, type Rect } from '../components/Phone.tsx';
import { vx, vy } from '../skin/metrics.ts';

/** The box, and the Done button beside it (stage px). */
export interface PickBox extends Rect {
  doneX: number; // the Done button's left edge
  doneW: number; // its width
}

/**
 * Place the box.
 *
 * Desktop: SlotsAvailable's height (Chrome.tsx), wider for the longer line, centered over the
 * Origin / Alignment and Continue Leveling buttons at the top, where it covers no power. Phones:
 * the slot screen's counter box, in the place of New Build and Save / Share.
 *
 * @param stage The stage's size, and whether it is the phone's.
 * @return The box and its button.
 */
export function pickBox(stage: { w: number; h: number; phone: boolean }): PickBox {
  const doneW = stage.phone ? 100 : vx(70);
  const gap = stage.phone ? 10 : 16;
  const box = stage.phone
    ? { x: 16, y: phoneGeom(stage).nextY - 26, w: stage.w - 32 - gap - doneW, h: 52 }
    : { x: stage.w / 2 - (vx(280) + gap + doneW) / 2, y: vy(13), w: vx(280), h: vy(30) };
  return { ...box, doneX: box.x + box.w + gap, doneW };
}
