import type { Skin } from '../skin/skin.ts';
import { CheckBar } from './CheckBar.tsx';

/** Phone canvas geometry (1000 x 1780): tabs, the single visible panel, description, buttons. */
export const PHONE_TABS_Y = 150;
export const PHONE_PANEL = { x: 20, y: 195, w: 960, h: 1235 };
export const PHONE_DESC = { x: 120, y: 1450, w: 860, h: 190 };
export const PHONE_NEXT_Y = 1720;

/**
 * Row of in-game check bars used as tabs to switch the visible panel on phones. Switching plays
 * the character creator's tab sound (drawHybridTab: N_Select) unless `clickSounds` says otherwise.
 */
export function PhoneTabs({ skin, labels, active, onChange, y = PHONE_TABS_Y, clickSounds = ['n_select'] }: { skin: Skin; labels: string[]; active: number; onChange: (i: number) => void; y?: number; clickSounds?: string[] }) {
  const slot = 960 / labels.length;
  return (
    <>
      {labels.map((l, i) => (
        <CheckBar
          key={l}
          skin={skin}
          x={20 + i * slot + 30}
          y={y}
          wd={slot - 50}
          scale={1}
          text={l}
          state={i === active ? 'selected' : 'standard'}
          down={i === active}
          clickSounds={clickSounds}
          onClick={() => onChange(i)}
        />
      ))}
    </>
  );
}
