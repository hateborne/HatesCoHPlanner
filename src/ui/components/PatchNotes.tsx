import { useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useStore } from '../../state/store.ts';
import { useEscape } from '../escape.ts';
import { snap } from '../skin/metrics.ts';
import type { Skin } from '../skin/skin.ts';
import { CheckBar } from './CheckBar.tsx';
import { MenuFrame, SetTitle } from './Chrome.tsx';
import { GameScroll } from './GameScroll.tsx';
import { PHONE_PAD } from './Phone.tsx';
import { useStage } from './Stage.tsx';

// the list's line height (stage px)
const LINE = 26;
// phones: the bar's draw scale, and its check box center from the left padding (as PhoneTabs)
const BAR_SCALE = 1.3;
const BULB = 22 * BAR_SCALE + 4;

// desktop: about this many characters fit on one line of the box (17px text, 406px wide)
const CHARS_PER_LINE = 44;

/** @return The height the desktop box takes for these lines (title, list up to 8 rows, button). */
export function patchNotesHeight(lines: string[]): number {
  const rows = lines.reduce((n, l) => n + Math.max(1, Math.ceil(l.length / CHARS_PER_LINE)), 0);
  return 44 + Math.min(rows, 8) * LINE + 58;
}

/**
 * Desktop: the changes a patch move made, in a box at the top of the overview's Totals column
 * (the totals scroll under it). Stays until Dismiss.
 *
 * @param props.x Left edge (stage px).
 * @param props.y Top edge.
 * @param props.w Width.
 */
export function PatchNotesBox({ skin, x, y, w }: { skin: Skin; x: number; y: number; w: number }) {
  const { notes, setNotes } = useStore(useShallow((s) => ({ notes: s.patchNotes, setNotes: s.setPatchNotes })));
  if (!notes) return null;
  const h = patchNotesHeight(notes.lines);
  const listH = h - 44 - 58;
  return (
    <>
      <SetTitle skin={skin} x={x} y={y} size={20} width={w} text={notes.title} />
      <GameScroll skin={skin} left={x} top={y + 36} width={w - 14} height={listH} barX={x + w + 4}>
        <div className="body-text" style={{ fontSize: 17, lineHeight: `${LINE}px`, color: '#e8f4ff' }}>
          {notes.lines.map((l, i) => (
            <div key={i}>{l}</div>
          ))}
        </div>
      </GameScroll>
      <button className="info-button" data-testid="patchnotes:dismiss" style={{ position: 'absolute', left: x, top: y + 44 + listH + 10, width: 150 }} onClick={() => setNotes(null)}>
        Dismiss
      </button>
      <div className="abs" style={{ left: x, top: y + h - 4, width: w, height: 2, background: 'rgba(120,170,255,0.35)' }} />
    </>
  );
}

/**
 * Phones: a bar right above Back / Next naming the changes a patch move made; a tap opens them in
 * a pane with Dismiss (gone for good) and Close. Closes on Escape or a tap outside it.
 *
 * @param props.y The bar's center (stage px).
 */
export function PatchNotesBar({ skin, y }: { skin: Skin; y: number }) {
  const { notes, setNotes } = useStore(useShallow((s) => ({ notes: s.patchNotes, setNotes: s.setPatchNotes })));
  const [open, setOpen] = useState(false);
  useEscape(() => setOpen(false), open && !!notes);
  const stage = useStage();
  if (!notes) return null;
  const paneW = stage.w - 16;
  const paneH = Math.min(118 + notes.lines.length * LINE + 90, stage.h - 160);
  const paneTop = Math.max(60, y - 40 - paneH);
  return (
    <>
      {/* sized and placed like a full-width row of PhoneTabs (check box center, bar width from it) */}
      <CheckBar skin={skin} x={PHONE_PAD + BULB} y={y} wd={stage.w - 2 * PHONE_PAD - BULB - 8} scale={BAR_SCALE} text={`${notes.title} (${notes.lines.length})`} state={open ? 'selected' : 'standard'} onClick={() => setOpen(!open)} />
      {open ? (
        <>
          <div className="abs" style={{ left: 0, top: 0, width: stage.w, height: stage.h, zIndex: 70 }} onClick={() => setOpen(false)} />
          {/* on whole device pixels, so the frame's pieces tile without seams */}
          <div className="abs" style={{ left: snap(8), top: snap(paneTop), width: paneW, height: paneH, zIndex: 71 }}>
            <MenuFrame x={0} y={0} w={paneW} h={paneH} skin={skin} style={{ background: 'rgba(0,3,20,0.96)' }} />
            <SetTitle skin={skin} x={18} y={16} size={22} width={paneW - 36} text={notes.title} />
            <GameScroll skin={skin} left={22} top={64} width={paneW - 56} height={paneH - 64 - 84} barX={paneW - 14}>
              <div className="body-text" style={{ fontSize: 19, lineHeight: `${LINE + 2}px`, color: '#e8f4ff' }}>
                {notes.lines.map((l, i) => (
                  <div key={i}>{l}</div>
                ))}
              </div>
            </GameScroll>
            <div className="abs" style={{ left: 0, top: paneH - 70, width: paneW, display: 'flex', justifyContent: 'center', gap: 24 }}>
              <button className="info-button" data-testid="patchnotes:dismiss" style={{ position: 'static', width: 170, height: 48 }} onClick={() => { setOpen(false); setNotes(null); }}>
                Dismiss
              </button>
              <button className="info-button" style={{ position: 'static', width: 170, height: 48 }} onClick={() => setOpen(false)}>
                Close
              </button>
            </div>
          </div>
        </>
      ) : null}
    </>
  );
}
