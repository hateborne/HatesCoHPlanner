import { useEffect } from 'react';
import { skinOf } from './engine/build.ts';
import { useStore } from './state/store.ts';
import { SideTotals } from './ui/components/SideTotals.tsx';
import { StopButtons } from './ui/components/StopButtons.tsx';
import { Stage, useStage } from './ui/components/Stage.tsx';
import { AddEnhancementSlot } from './ui/screens/AddEnhancementSlot.tsx';
import { BuildMenu } from './ui/screens/BuildMenu.tsx';
import { ChooseNewPower } from './ui/screens/ChooseNewPower.tsx';
import { ChoosePoolSet } from './ui/screens/ChoosePoolSet.tsx';
import { Overview } from './ui/screens/Overview.tsx';
import { Setup } from './ui/screens/Setup.tsx';
import { SKINS } from './ui/skin/skin.ts';
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

/** Sound effects and music switches, side by side at the bottom center. */
function AudioToggles() {
  const { muted, setMuted, musicOn, setMusicOn } = useStore();
  const stage = useStage();
  return (
    <>
      <Toggle label="Sound" on={!muted} set={(v) => setMuted(!v)} x={stage.w / 2 - 126} />
      <Toggle label="Music" on={musicOn} set={setMusicOn} x={stage.w / 2 + 6} />
    </>
  );
}

/** Top-level router: loading, setup, the level-up screens and the build overview. */
export function App() {
  const { view, error, build, level, load, menuOpen, setMenu } = useStore();
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
    <Stage skin={view === 'setup' ? SKINS.hero : skin}>
      {screen}
      {menuOpen ? <BuildMenu onClose={() => setMenu(false)} /> : null}
      <AudioToggles />
      <div className="abs notice" style={{ left: 0, right: 0, bottom: 4, textAlign: 'center', fontSize: 12, opacity: 0.6 }}>
        Hate&apos;s CoH Planner -- not affiliated with or endorsed by NCSoft or Homecoming. City of Heroes data and art belong to their owners.
      </div>
    </Stage>
  );
}
