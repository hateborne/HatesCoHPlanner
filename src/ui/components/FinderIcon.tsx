import { ui } from '../skin/skin.ts';

// the set finder's name: on its button, its pane's title and the phone menu's row
export const FINDER_NAME = 'Set Finder';

/**
 * The set finder's button icon: the invention tutorial's badge, from the client's art
 * (gui/icons/badges/badge_invention_tutorial, 48 x 48). The owner's pick.
 *
 * @param size Its width and height in stage px.
 */
export function FinderIcon({ size }: { size: number }) {
  return <img src={ui('icons/badges/badge_invention_tutorial')} width={size} height={size} alt="" draggable={false} style={{ display: 'block' }} />;
}
