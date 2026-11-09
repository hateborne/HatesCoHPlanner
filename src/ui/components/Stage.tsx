import { useEffect, useState, type ReactNode } from 'react';
import { ui, type Skin } from '../skin/skin.ts';

export const STAGE_W = 2000;
export const STAGE_H = 1125;

/** @return The scale that fits the 2000x1125 stage into the window. */
export function useStageScale(): number {
  const calc = () => Math.min(window.innerWidth / STAGE_W, window.innerHeight / STAGE_H);
  const [s, setS] = useState(calc);
  useEffect(() => {
    const on = () => setS(calc());
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return s;
}

/**
 * The fixed 16:9 game screen, scaled to the window, with the city skyline backdrop
 * (drawBackground: background_skyline_normal, per skin).
 */
export function Stage({ skin, children }: { skin: Skin; children: ReactNode }) {
  const scale = useStageScale();
  const bg = ui(`creation/common/backgrounds/${skin.prefix}background_skyline_normal`);
  return (
    <div className="viewport">
      <div style={{ width: STAGE_W * scale, height: STAGE_H * scale, position: 'relative', overflow: 'hidden', flex: 'none' }}>
        <div
          className={`stage skin-${skin.name}`}
          style={{
            transform: `scale(${scale})`,
            transformOrigin: '0 0',
            position: 'absolute',
            left: 0,
            top: 0,
            backgroundImage: `url(${bg})`,
            ['--menu-border' as string]: skin.menuBorder,
            ['--title-top' as string]: skin.title[0],
            ['--title-bottom' as string]: skin.title[1],
          }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
