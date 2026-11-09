import { useEffect, useState } from 'react';
import { skinOf } from './engine/build.ts';
import { TIP_MODES, useStore, type TipMode } from './state/store.ts';
import { SideTotals } from './ui/components/SideTotals.tsx';
import { StopButtons } from './ui/components/StopButtons.tsx';
import { ConfirmDialog } from './ui/components/ConfirmDialog.tsx';
import { SupportDialog } from './ui/components/SupportDialog.tsx';
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

/** A remembered on/off switch in the stage's bottom bar (sound effects, music). */
function Toggle({ label, on, set, x }: { label: string; on: boolean; set: (v: boolean) => void; x: number }) {
  const stage = useStage();
  return (
    <div
      className="abs body-text"
      onClick={() => set(!on)}
      title={on ? `${label} is on (click to turn off)` : `${label} is off (click to turn on)`}
      style={{ left: x, top: stage.h - 54, width: 120, height: 24, borderRadius: 12, border: '1px solid #4f94ff', fontSize: 13, color: on ? '#cfe8ff' : '#8fa1b8', textAlign: 'center', lineHeight: '22px', cursor: 'pointer', background: '#000', zIndex: 40 }}
    >
      {label}: {on ? 'on' : 'off'}
    </div>
  );
}

const TIP_LABEL: Record<TipMode, string> = { enabled: 'Enabled', advanced: 'Advanced', disabled: 'Disabled' };
const TIP_HELP: Record<TipMode, string> = {
  enabled: 'Tooltips: Enabled -- hovering a power shows its description (build screen) or what it can slot (slot screens). Hold SHIFT to see the Advanced tooltip instead. Click to switch to Advanced.',
  advanced: 'Tooltips: Advanced -- hovering a power shows what it can slot plus its full detailed info. Click to switch to Disabled.',
  disabled: 'Tooltips: Disabled -- hovering shows nothing. Click to switch to Enabled.',
};

/** Sound, music and tooltip switches and the Support button, side by side at the bottom center. */
function BottomBar({ skin }: { skin: Skin }) {
  const { muted, setMuted, musicOn, setMusicOn, tips, setTips } = useStore();
  const [support, setSupport] = useState(false);
  const stage = useStage();
  const x0 = stage.w / 2 - (120 + 12 + 120 + 12 + 170 + 12 + 200) / 2;
  return (
    <>
      <Toggle label="Sound" on={!muted} set={(v) => setMuted(!v)} x={x0} />
      <Toggle label="Music" on={musicOn} set={setMusicOn} x={x0 + 132} />
      <div
        className="abs body-text"
        onClick={() => setTips(TIP_MODES[(TIP_MODES.indexOf(tips) + 1) % TIP_MODES.length]!)}
        title={TIP_HELP[tips]}
        style={{ left: x0 + 264, top: stage.h - 54, width: 170, height: 24, borderRadius: 12, border: '1px solid #4f94ff', fontSize: 13, color: tips === 'disabled' ? '#8fa1b8' : '#cfe8ff', textAlign: 'center', lineHeight: '22px', cursor: 'pointer', background: '#000', zIndex: 40 }}
      >
        Tooltips: {TIP_LABEL[tips]}
      </div>
      <div
        className="abs body-text"
        onClick={() => setSupport(true)}
        title="How to support the planner"
        style={{ left: x0 + 446, top: stage.h - 54, width: 200, height: 24, borderRadius: 12, border: '1px solid #4f94ff', fontSize: 13, color: '#cfe8ff', textAlign: 'center', lineHeight: '22px', cursor: 'pointer', background: '#000', zIndex: 40 }}
      >
        Support HateCoHPlanner
      </div>
      {support ? <SupportDialog skin={skin} onClose={() => setSupport(false)} /> : null}
    </>
  );
}

/**
 * A refused change ("Remove enhancements first"): small red text at the bottom center that fades
 * after ~2s, kept clear of each screen's own bottom elements (Slots Available, the help box).
 */
function Notice() {
  const { notice, view, level } = useStore();
  const stage = useStage();
  if (!notice) return null;
  const y = stage.phone ? stage.h - 84 : view === 'level' && level?.sub === 'slots' ? 985 : 1050;
  return (
    <div key={notice.id} className="abs body-text notice-msg" style={{ left: 0, width: stage.w, top: y, textAlign: 'center', fontSize: 15, color: '#ff5a5a', zIndex: 80 }}>
      {notice.text}
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
    <Stage skin={view === 'setup' ? SKINS[skinOf(setupAlign)] : skin}>
      {screen}
      {menuOpen ? <BuildMenu onClose={() => setMenu(false)} /> : null}
      <Notice />
      <ConfirmDialog />
      <BottomBar skin={view === 'setup' ? SKINS[skinOf(setupAlign)] : skin} />
      <div className="abs notice" style={{ left: 0, right: 0, bottom: 4, textAlign: 'center', fontSize: 12, opacity: 0.6 }}>
        Hate&apos;s CoH Planner -- not affiliated with or endorsed by NCSoft or Homecoming. City of Heroes data and art belong to their owners.
      </div>
    </Stage>
  );
}
