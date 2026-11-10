import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { skinOf } from './engine/build.ts';
import { useStore } from './state/store.ts';
import { SideTotals } from './ui/components/SideTotals.tsx';
import { StopButtons } from './ui/components/StopButtons.tsx';
import { ConfirmDialog } from './ui/components/ConfirmDialog.tsx';
import { MenuFrame } from './ui/components/Chrome.tsx';
import { phoneGeom } from './ui/components/Phone.tsx';
import { Settings } from './ui/components/Settings.tsx';
import { Stage, useStage } from './ui/components/Stage.tsx';
import { AddEnhancementSlot } from './ui/screens/AddEnhancementSlot.tsx';
import { BuildMenu } from './ui/screens/BuildMenu.tsx';
import { ChooseNewPower } from './ui/screens/ChooseNewPower.tsx';
import { ChoosePoolSet } from './ui/screens/ChoosePoolSet.tsx';
import { Overview } from './ui/screens/Overview.tsx';
import { Setup } from './ui/screens/Setup.tsx';
import { SKINS, type Skin } from './ui/skin/skin.ts';
import { setMusicSkin } from './ui/sound.ts';
import { TitleText } from './ui/components/GameText.tsx';

/**
 * A refused change ("Remove enhancements first"). Desktop: small red text at the bottom center
 * that fades after ~2s, kept clear of each screen's own bottom elements (Slots Available, the help
 * box). Phones: a toast that drops in under the title bar (PhoneToast).
 */
function Notice({ skin }: { skin: Skin }) {
  const { notice, view, level, dismissNotice } = useStore(useShallow((s) => ({ notice: s.notice, view: s.view, level: s.level, dismissNotice: s.dismissNotice })));
  const stage = useStage();
  if (!notice) return null;
  if (stage.phone) return <PhoneToast key={notice.id} skin={skin} text={notice.text} onClose={dismissNotice} />;
  const y = view === 'level' && level?.sub === 'slots' ? 985 : 1050;
  return (
    <div key={notice.id} className="abs body-text notice-msg" style={{ left: 0, width: stage.w, top: y, textAlign: 'center', fontSize: 15, color: '#ff5a5a', zIndex: 80 }}>
      {notice.text}
    </div>
  );
}

// the toast's widest (stage px), and its text size: about 16 px on the phone's screen
const TOAST_MAX_W = 460;
const TOAST_PX = 20;

/**
 * Phones: a refused change as a toast at the top center, framed like the power hover box with the
 * red refusal text. It slides down over the tabs (and any pop-up), stays ~3s and fades; a tap
 * dismisses it early.
 */
function PhoneToast({ skin, text, onClose }: { skin: Skin; text: string; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);
  // the frame is drawn from sprites at a fixed size: measure the text first
  useLayoutEffect(() => {
    const el = ref.current;
    if (el) setBox({ w: el.offsetWidth, h: el.offsetHeight });
  }, [text]);
  const stage = useStage();
  const px = TOAST_PX;
  const maxW = Math.min(TOAST_MAX_W, stage.w - 30);
  const w = box?.w ?? maxW;
  return (
    <div className="abs phone-toast" role="status" onClick={onClose} style={{ left: (stage.w - w) / 2, top: phoneGeom(stage).line + 8, width: w, height: box?.h ?? 0, zIndex: 110, cursor: 'pointer' }}>
      {box ? <MenuFrame x={0} y={0} w={box.w} h={box.h} skin={skin} style={{ background: '#000314' }} /> : null}
      <div
        ref={ref}
        className="abs body-text"
        style={{ left: 0, top: 0, width: 'max-content', maxWidth: maxW, padding: `${Math.round(px * 0.7)}px ${Math.round(px * 1.2)}px`, boxSizing: 'border-box', textAlign: 'center', fontSize: px, lineHeight: `${Math.round(px * 1.25)}px`, color: '#ff5a5a', zIndex: 5, visibility: box ? 'visible' : 'hidden' }}
      >
        {text}
      </div>
    </div>
  );
}

/** Top-level router: loading, setup, the level-up screens and the build overview. */
export function App() {
  const { view, error, build, level, load, menuOpen, setMenu, setupAlign } = useStore();
  useEffect(() => {
    void load();
  }, [load]);
  const skin = SKINS[build ? skinOf(build.alignment) : 'hero'];
  // the setup screen picks its own track from the alignment being chosen
  useEffect(() => {
    if (view !== 'setup') setMusicSkin(view === 'loading' || view === 'error' ? null : skin.name);
  }, [view, skin.name]);

  const stageSkin = view === 'setup' ? SKINS[skinOf(setupAlign)] : skin;
  let screen = null;
  if (view === 'loading') {
    screen = (
      <TitleText className="abs" style={{ left: 0, right: 0, top: 520, textAlign: 'center', fontSize: 48 }}>
        LOADING...
      </TitleText>
    );
  } else if (view === 'error') {
    screen = (
      <div className="abs body-text" style={{ left: 200, top: 400, width: 1600, fontSize: 28, color: '#ff6060' }}>
        Could not load game data: {error}
      </div>
    );
  } else if (view === 'setup') {
    screen = <Setup />;
  } else if (view === 'level' && level) {
    if (level.sub === 'slots') screen = <AddEnhancementSlot skin={skin} />;
    else if (level.sub === 'pool' || level.sub === 'epic') screen = <ChoosePoolSet skin={skin} kind={level.sub} />;
    else screen = <ChooseNewPower skin={skin} />;
    screen = (
      <>
        {screen}
        <StopButtons skin={skin} />
        <SideTotals />
      </>
    );
  } else if (view === 'overview') {
    screen = <Overview skin={skin} />;
  }
  return (
    <Stage skin={stageSkin}>
      {screen}
      {menuOpen ? <BuildMenu onClose={() => setMenu(false)} /> : null}
      <Notice skin={stageSkin} />
      <ConfirmDialog />
      <Settings skin={stageSkin} />
      <Footer />
    </Stage>
  );
}

/** The not-affiliated line along the bottom edge (two lines on a phone). */
function Footer() {
  const { phone } = useStage();
  return (
    <div className="abs notice" style={{ left: 10, right: 10, bottom: phone ? 3 : 4, textAlign: 'center', fontSize: phone ? 10.5 : 12, lineHeight: phone ? '12px' : undefined, opacity: 0.6 }}>
      Hate&apos;s CoH Planner -- not affiliated with or endorsed by NCSoft or Homecoming. City of Heroes data and art belong to their owners.
    </div>
  );
}
