import { useEffect } from 'react';
import { skinOf } from './engine/build.ts';
import { useStore } from './state/store.ts';
import { SideTotals } from './ui/components/SideTotals.tsx';
import { Stage, useStage } from './ui/components/Stage.tsx';
import { AddEnhancementSlot } from './ui/screens/AddEnhancementSlot.tsx';
import { BuildMenu } from './ui/screens/BuildMenu.tsx';
import { ChooseNewPower } from './ui/screens/ChooseNewPower.tsx';
import { ChoosePoolSet } from './ui/screens/ChoosePoolSet.tsx';
import { Overview } from './ui/screens/Overview.tsx';
import { Setup } from './ui/screens/Setup.tsx';
import { SKINS } from './ui/skin/skin.ts';

/** Remembered mute switch in the stage's bottom bar. */
function SoundToggle({ muted, setMuted }: { muted: boolean; setMuted: (m: boolean) => void }) {
  const stage = useStage();
  return (
    <div
      className="abs body-text"
      onClick={() => setMuted(!muted)}
      title={muted ? 'Sounds are off (click to turn on)' : 'Sounds are on (click to mute)'}
      style={{ left: stage.w / 2 - 60, top: stage.h - 27, width: 120, height: 24, borderRadius: 12, border: '1px solid #4f94ff', fontSize: 13, color: muted ? '#8fa1b8' : '#cfe8ff', textAlign: 'center', lineHeight: '22px', cursor: 'pointer', background: '#000', zIndex: 40 }}
    >
      Sound: {muted ? 'off' : 'on'}
    </div>
  );
}

/** Top-level router: loading, setup, the level-up screens and the build overview. */
export function App() {
  const { view, error, build, level, load, menuOpen, setMenu, muted, setMuted } = useStore();
  useEffect(() => {
    void load();
  }, [load]);
  const skin = SKINS[build ? skinOf(build.alignment) : 'hero'];

  let screen = null;
  if (view === 'loading') {
    screen = (
      <div className="title-text abs" style={{ left: 0, right: 0, top: 520, textAlign: 'center', fontSize: 48 }}>
        LOADING...
      </div>
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
      <SoundToggle muted={muted} setMuted={setMuted} />
      <div className="abs notice" style={{ left: 0, right: 0, bottom: 4, textAlign: 'center', fontSize: 12, opacity: 0.6 }}>
        Hate&apos;s CoH Planner -- not affiliated with or endorsed by NCSoft or Homecoming. City of Heroes data and art belong to their owners.
      </div>
    </Stage>
  );
}
