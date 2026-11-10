import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { setDevPx } from '../skin/metrics.ts';
import { ui, type Skin } from '../skin/skin.ts';
import { DESKTOP, stageLayout, type StageDims } from '../stageLayout.ts';

export { DESKTOP, PHONE_BREAKPOINT, type StageDims } from '../stageLayout.ts';

// devPx: stage px per device pixel; scale: CSS zoom from stage px to window px
export type StageInfo = StageDims & { devPx: number; scale: number };

const StageCtx = createContext<StageInfo>({ ...DESKTOP, devPx: 1, scale: 1 });

/** @return The current stage size, whether the phone layout is active, and its scale. */
export function useStage(): StageInfo {
  return useContext(StageCtx);
}

/**
 * @return Current layout dims, the scale that fits them into the window, the stage's top-left
 *   corner in CSS px (rounded to a device pixel so snapped stage coordinates land on whole device
 *   pixels), and whether a sideways phone should be asked to turn upright.
 */
export function useStageScale(): { dims: StageDims; scale: number; left: number; top: number; rotate: boolean } {
  const calc = () => {
    const touch = typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
    const { dims, scale, rotate } = stageLayout(window.innerWidth, window.innerHeight, touch);
    const dpr = window.devicePixelRatio || 1;
    const left = Math.round(((window.innerWidth - dims.w * scale) / 2) * dpr) / dpr;
    const top = Math.round(((window.innerHeight - dims.h * scale) / 2) * dpr) / dpr;
    return { dims, scale, left, top, rotate };
  };
  const [s, setS] = useState(calc);
  useEffect(() => {
    const on = () => setS(calc());
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return s;
}

/** A phone held sideways: the planner is laid out for portrait, so ask for the phone to be turned. */
function RotatePrompt() {
  return (
    <div className="rotate-prompt" role="alert">
      <div className="rotate-phone" aria-hidden="true" />
      <div className="rotate-title">TURN YOUR PHONE UPRIGHT</div>
      <div className="rotate-text">The planner is laid out for a phone held upright.</div>
    </div>
  );
}

/**
 * The fixed game screen scaled to the window, with the city skyline backdrop
 * (drawBackground: background_skyline_normal, per skin). Narrow and portrait windows get the
 * phone canvas instead (stageLayout), and a phone held sideways is asked to turn upright; the
 * stage stays mounted under that message, so nothing on it is lost.
 */
export function Stage({ skin, children }: { skin: Skin; children: ReactNode }) {
  const { dims, scale, left, top, rotate } = useStageScale();
  const bg = ui(`creation/common/backgrounds/background_skyline_normal`, skin);
  const devPx = 1 / (scale * (window.devicePixelRatio || 1));
  setDevPx(devPx);
  const info = useMemo(() => ({ ...dims, devPx, scale }), [dims, devPx, scale]);
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
              // text fields at 16+ window px, so iOS does not zoom the page when one is tapped
              ['--input-px' as string]: `${Math.ceil(16.5 / scale)}px`,
              ['--menu-border' as string]: skin.menuBorder,
              ['--title-top' as string]: skin.title[0],
              ['--title-bottom' as string]: skin.title[1],
            }}
          >
            {children}
          </div>
        </div>
      </div>
      {rotate ? <RotatePrompt /> : null}
    </StageCtx.Provider>
  );
}
