import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { ui, type Skin } from '../skin/skin.ts';

/** Desktop stage: the game's 16:9 screen. Phone stage: a portrait canvas, one panel at a time. */
export const DESKTOP = { w: 2000, h: 1125, phone: false };
export const PHONE = { w: 1000, h: 1780, phone: true };
export const PHONE_BREAKPOINT = 768;

export type StageDims = typeof DESKTOP;

const StageCtx = createContext<StageDims>(DESKTOP);

/** @return The current stage size and whether the phone layout is active. */
export function useStage(): StageDims {
  return useContext(StageCtx);
}

function pick(): StageDims {
  return window.innerWidth < PHONE_BREAKPOINT ? PHONE : DESKTOP;
}

/** @return Current layout dims and the scale that fits them into the window. */
export function useStageScale(): { dims: StageDims; scale: number } {
  const calc = () => {
    const dims = pick();
    return { dims, scale: Math.min(window.innerWidth / dims.w, window.innerHeight / dims.h) };
  };
  const [s, setS] = useState(calc);
  useEffect(() => {
    const on = () => setS(calc());
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return s;
}

/**
 * The fixed game screen scaled to the window, with the city skyline backdrop
 * (drawBackground: background_skyline_normal, per skin). Narrow windows get the portrait
 * phone canvas instead.
 */
export function Stage({ skin, children }: { skin: Skin; children: ReactNode }) {
  const { dims, scale } = useStageScale();
  const bg = ui(`creation/common/backgrounds/background_skyline_normal`, skin);
  return (
    <StageCtx.Provider value={dims}>
      <div className="viewport">
        <div style={{ width: dims.w * scale, height: dims.h * scale, position: 'relative', overflow: 'hidden', flex: 'none' }}>
          <div
            className={`stage skin-${skin.name}${dims.phone ? ' phone' : ''}`}
            style={{
              width: dims.w,
              height: dims.h,
              transform: `scale(${scale})`,
              transformOrigin: '0 0',
              position: 'absolute',
              left: 0,
              top: 0,
              backgroundImage: `url(${bg})`,
              // desktop: drawBackground runs before scaling is disabled, so the 1024x768 skyline
              // (with its rounded border) is stretched by sx/sy to fill the screen; phone: keep
              // the skyline at the bottom
              backgroundPosition: dims.phone ? 'center bottom' : '0 0',
              backgroundSize: dims.phone ? 'cover' : '100% 100%',
              ['--menu-border' as string]: skin.menuBorder,
              ['--title-top' as string]: skin.title[0],
              ['--title-bottom' as string]: skin.title[1],
            }}
          >
            {children}
          </div>
        </div>
      </div>
    </StageCtx.Provider>
  );
}
