import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { setDevPx } from '../skin/metrics.ts';
import { ui, type Skin } from '../skin/skin.ts';

/** Desktop stage: the game's 16:9 screen. Phone stage: a portrait canvas, one panel at a time. */
export const DESKTOP = { w: 2000, h: 1125, phone: false };
export const PHONE = { w: 1000, h: 1780, phone: true };
export const PHONE_BREAKPOINT = 768;

export type StageDims = typeof DESKTOP;
export type StageInfo = StageDims & { devPx: number }; // devPx: stage px per device pixel

const StageCtx = createContext<StageInfo>({ ...DESKTOP, devPx: 1 });

/** @return The current stage size, whether the phone layout is active, and stage px per device px. */
export function useStage(): StageInfo {
  return useContext(StageCtx);
}

function pick(): StageDims {
  return window.innerWidth < PHONE_BREAKPOINT ? PHONE : DESKTOP;
}

/**
 * @return Current layout dims, the scale that fits them into the window, and the stage's
 *   top-left corner in CSS px, rounded to a device pixel so snapped stage coordinates land on
 *   whole device pixels.
 */
export function useStageScale(): { dims: StageDims; scale: number; left: number; top: number } {
  const calc = () => {
    const dims = pick();
    const scale = Math.min(window.innerWidth / dims.w, window.innerHeight / dims.h);
    const dpr = window.devicePixelRatio || 1;
    const left = Math.round(((window.innerWidth - dims.w * scale) / 2) * dpr) / dpr;
    const top = Math.round(((window.innerHeight - dims.h * scale) / 2) * dpr) / dpr;
    return { dims, scale, left, top };
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
  const { dims, scale, left, top } = useStageScale();
  const bg = ui(`creation/common/backgrounds/background_skyline_normal`, skin);
  const devPx = 1 / (scale * (window.devicePixelRatio || 1));
  setDevPx(devPx);
  const info = useMemo(() => ({ ...dims, devPx }), [dims, devPx]);
  return (
    <StageCtx.Provider value={info}>
      <div className="viewport">
        <div style={{ width: dims.w * scale, height: dims.h * scale, position: 'absolute', left, top, overflow: 'hidden' }}>
          <div
            className={`stage skin-${skin.name}${dims.phone ? ' phone' : ''}`}
            // right-click belongs to the planner (slot undo / clear), except in text fields
            onContextMenu={(e) => {
              const t = e.target as HTMLElement;
              if (!t.closest('input, textarea, select')) e.preventDefault();
            }}
            style={{
              width: dims.w,
              height: dims.h,
              // zoom, not transform: scale -- zoom lays the stage out at its final size, so the
              // browser snaps every box to device pixels and pieces that share an edge tile
              // cleanly (a scale transform snaps in unscaled px and then lands edges on
              // fractional device pixels, which leaves seams wherever two pieces meet)
              zoom: scale,
              position: 'absolute',
              left: 0,
              top: 0,
              backgroundImage: `url(${bg})`,
              // desktop: drawBackground runs before scaling is disabled, so the 1024x768 skyline
              // (with its rounded border) is stretched by sx/sy to fill the screen; phone: keep
              // the skyline at the bottom
              backgroundPosition: dims.phone ? 'center bottom' : '0 0',
              backgroundSize: dims.phone ? 'cover' : '100% 100%',
              ['--dev-px' as string]: `${devPx}px`,
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
