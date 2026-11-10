import type { GameData } from '../../data/gamedata.ts';
import type { Archetype } from '../../data/types.ts';
import { useEscape } from '../escape.ts';
import { useHover, type PressTip } from '../hover.ts';
import type { Skin } from '../skin/skin.ts';
import { AdvancedInfo } from './PowerInfoView.tsx';
import { EnhDetails, SlotDetails } from './PowerTip.tsx';
import { useStage } from './Stage.tsx';

// the box's text size (stage px; about 14 px on a phone) and its gap from the finger
const PX = 18;
const GAP = 44;
const MARGIN = 12;

/** Close the long-press tooltip. */
const close = () => useHover.setState({ press: null });

/**
 * Phones: the tooltip a long press opened on the build overview (useHover.press), in place of
 * the desktop's hover tooltips. It sits above or below the finger, whichever has more room,
 * scrolls when it is long, and closes on a tap anywhere (or Escape).
 *
 * @param props.at The build's archetype (the detailed numbers and enhancement values).
 * @param props.level 0-based level the numbers are shown at (the build's last level).
 */
export function PhoneTipLayer({ gd, skin, at, level }: { gd: GameData; skin: Skin; at: Archetype; level: number }) {
  const press = useHover((h) => h.press);
  if (!press) return null;
  return <PhoneTip gd={gd} skin={skin} at={at} level={level} press={press} />;
}

function PhoneTip({ gd, skin, at, level, press }: { gd: GameData; skin: Skin; at: Archetype; level: number; press: PressTip }) {
  const stage = useStage();
  useEscape(close);
  // the press point in stage px
  const wrap = typeof document !== 'undefined' ? document.querySelector('.stage')?.parentElement : null;
  const r = wrap?.getBoundingClientRect();
  const y = r && r.height ? ((press.y - r.top) / r.height) * stage.h : stage.h / 2;
  const below = y < stage.h / 2;
  const place = below ? { top: y + GAP, maxHeight: stage.h - (y + GAP) - MARGIN } : { bottom: stage.h - (y - GAP), maxHeight: y - GAP - MARGIN };
  let body;
  if (press.kind === 'power') {
    body = (
      <>
        {press.notes.map((n, i) => (
          <div key={i} style={{ color: '#ff6060', marginBottom: '0.4em' }}>
            {n}
          </div>
        ))}
        <SlotDetails gd={gd} power={press.entry.power} longColor={skin.desc} />
        <div style={{ borderTop: '1px solid #6d7fd8', margin: '0.8em 0' }} />
        <AdvancedInfo gd={gd} at={at} entry={press.entry} level={level} />
      </>
    );
  } else if (press.kind === 'enh') {
    body = <EnhDetails gd={gd} at={at} slots={press.entry.slots} slot={press.slot} level={level} />;
  } else {
    body = <div style={{ whiteSpace: 'pre-line' }}>{press.text}</div>;
  }
  return (
    <>
      {/* a tap anywhere closes it, and does nothing else */}
      <div className="abs" style={{ left: 0, top: 0, width: stage.w, height: stage.h, zIndex: 66 }} onClick={close} />
      <div
        className="abs scroll-y"
        role="tooltip"
        onClick={close}
        style={{ left: MARGIN, width: stage.w - 2 * MARGIN, ...place, zIndex: 67, boxSizing: 'border-box', padding: `${PX * 0.6}px ${PX * 0.8}px`, background: 'rgba(0,2,24,0.97)', border: '2px solid #3a55d6', borderRadius: PX * 0.6, fontFamily: "'Montreal'", fontSize: PX, lineHeight: 1.3, color: '#ffffff' }}
      >
        {body}
      </div>
    </>
  );
}
