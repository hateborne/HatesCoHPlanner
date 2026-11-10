import { useState, type ReactNode } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { continueTarget, respecUnfinished, stepsOf, TIP_MODES, useStore, type TipMode } from '../../state/store.ts';
import { useEscape } from '../escape.ts';
import { fitScale, FONTS, S, snap } from '../skin/metrics.ts';
import { pressKeys } from '../press.ts';
import type { Skin } from '../skin/skin.ts';
import { MenuFrame } from './Chrome.tsx';
import { GameText } from './GameText.tsx';
import { PHONE_MENU_BTN, phoneGeom, phoneMenuButton } from './Phone.tsx';
import { changeOrigin, ORIGIN_PANE_H, OriginAlignPane } from './OriginAlign.tsx';
import { useStage } from './Stage.tsx';
import { SupportDialog } from './SupportDialog.tsx';

/** A rounded planner button (not game chrome): the sound / music / tooltip switches, Support, View Build. */
function Pill({ x, y, w, h, fontSize, dim, title, onClick, children }: { x: number; y: number; w: number; h: number; fontSize: number; dim?: boolean; title?: string; onClick: () => void; children: ReactNode }) {
  const bw = h > 30 ? 2 : 1;
  return (
    <div
      className="abs body-text"
      onClick={onClick}
      {...pressKeys(onClick)}
      title={title}
      style={{ left: x, top: y, width: w, height: h, borderRadius: h / 2, border: `${bw}px solid #4f94ff`, fontSize, color: dim ? '#8fa1b8' : '#cfe8ff', textAlign: 'center', lineHeight: `${h - 2 * bw}px`, cursor: 'pointer', background: '#000', zIndex: 40 }}
    >
      {children}
    </div>
  );
}

const TIP_LABEL: Record<TipMode, string> = { enabled: 'Enabled', advanced: 'Advanced', disabled: 'Disabled' };
const TIP_HELP: Record<TipMode, string> = {
  enabled: 'Tooltips: Enabled -- hovering a power shows its description (build screen) or what it can slot (slot screens). Hold SHIFT to see the Advanced tooltip instead. Click to switch to Advanced.',
  advanced: 'Tooltips: Advanced -- hovering a power shows what it can slot plus its full detailed info. Click to switch to Disabled.',
  disabled: 'Tooltips: Disabled -- hovering shows nothing. Click to switch to Enabled.',
};

const onOffHelp = (label: string, on: boolean) => (on ? `${label} is on (click to turn off)` : `${label} is off (click to turn on)`);

/** Desktop: sound, music and tooltip switches and the Support button, side by side at the bottom center. */
function BottomBar({ skin }: { skin: Skin }) {
  const { muted, setMuted, musicOn, setMusicOn, tips, setTips } = useStore(
    useShallow((s) => ({ muted: s.muted, setMuted: s.setMuted, musicOn: s.musicOn, setMusicOn: s.setMusicOn, tips: s.tips, setTips: s.setTips })),
  );
  const [support, setSupport] = useState(false);
  const stage = useStage();
  const x0 = stage.w / 2 - (120 + 12 + 120 + 12 + 170 + 12 + 200) / 2;
  const y = stage.h - 54;
  return (
    <>
      <Pill x={x0} y={y} w={120} h={24} fontSize={13} dim={muted} title={onOffHelp('Sound', !muted)} onClick={() => setMuted(!muted)}>
        Sound: {muted ? 'off' : 'on'}
      </Pill>
      <Pill x={x0 + 132} y={y} w={120} h={24} fontSize={13} dim={!musicOn} title={onOffHelp('Music', musicOn)} onClick={() => setMusicOn(!musicOn)}>
        Music: {musicOn ? 'on' : 'off'}
      </Pill>
      <Pill x={x0 + 264} y={y} w={170} h={24} fontSize={13} dim={tips === 'disabled'} title={TIP_HELP[tips]} onClick={() => setTips(TIP_MODES[(TIP_MODES.indexOf(tips) + 1) % TIP_MODES.length]!)}>
        Tooltips: {TIP_LABEL[tips]}
      </Pill>
      <Pill x={x0 + 446} y={y} w={200} h={24} fontSize={13} title="How to support the planner" onClick={() => setSupport(true)}>
        Support HateCoHPlanner
      </Pill>
      {support ? <SupportDialog skin={skin} onClose={() => setSupport(false)} /> : null}
    </>
  );
}

// Phone menu pane (stage px on the phone stage): it drops from the backdrop's frame line along the
// right edge, under the menu button (phoneMenuButton), scrolling when it is taller than the phone.
const PANE = { right: 8, maxW: 440, pad: 16 };
const ROW_H = 56;
const ROW_GAP = 12;
const PILL_FONT = 20;
// the Origin / Alignment bars in the pane: bigger than the New Build screen's, to fit a finger
const OA_SCALE = 1.25;

/**
 * Phone: a menu button at the top right opening a pane with the planner's own controls, which
 * have no room along the phone's bottom edge: View Build (while leveling) or Continue Leveling /
 * Continue Respec (on the overview of a build that can go on), each with its level; Sound, Music,
 * Support and, on the build overview, the build's origin and archetype and the Origin / Alignment
 * choice. Hover tooltips don't exist on phones, so the Tooltips switch is left out. Closes on
 * Escape, the button or a tap outside it.
 */
function PhoneMenu({ skin }: { skin: Skin }) {
  const { gd, steps, level, continueLeveling, muted, setMuted, musicOn, setMusicOn, wizard, stopHere, build, setBuild, overview, dismissNotice } = useStore(
    useShallow((s) => ({
      gd: s.gd,
      steps: s.steps,
      level: s.level,
      continueLeveling: s.continueLeveling,
      muted: s.muted,
      setMuted: s.setMuted,
      musicOn: s.musicOn,
      setMusicOn: s.setMusicOn,
      wizard: s.view === 'level' && s.level?.mode === 'wizard',
      stopHere: s.stopHere,
      build: s.build,
      setBuild: s.setBuild,
      overview: s.view === 'overview',
      dismissNotice: s.dismissNotice,
    })),
  );
  const [open, setOpen] = useState(false);
  const [support, setSupport] = useState(false);
  const toggle = () => {
    // a refusal toast still showing would cover the pane's first row
    if (!open) dismissNotice();
    setOpen(!open);
  };
  const stage = useStage();
  useEscape(() => setOpen(false), open);
  const g = phoneGeom(stage);
  const btn = phoneMenuButton(g);
  const paneTop = g.line + 6;

  const paneW = Math.min(PANE.maxW, stage.w - 2 * PANE.right);
  const inner = paneW - 2 * PANE.pad;
  const half = (inner - ROW_GAP) / 2;
  const rows: ReactNode[] = [];
  let y = PANE.pad;
  if (overview && build && gd) {
    // the build's origin and archetype (the overview has no room for it on a phone)
    const who = `${gd.core.origins.find((o) => o.id === build.origin)?.dn ?? ''} ${gd.archetype(build.at).dn}`.trim().toUpperCase();
    rows.push(<GameText key="who" font="title_14" scale={Math.min(S, fitScale(FONTS.title_14, who, inner))} x={PANE.pad} y={y + 22} colors={skin.heading} text={who} />);
    y += 40;
  }
  // the top row: View Build while leveling (the level the build would end at), or on the overview
  // Continue Leveling / Continue Respec (the level it resumes at)
  let top: { label: string; title: string; act: () => void } | null = null;
  if (wizard && level) {
    const step = stepsOf(steps, level)[level.step];
    // as stopHere: a respec stopped on its slot screen ends at its respec level
    const end = step ? (level.flow && !step.picks.length ? (level.base.respecTo ?? 49) : step.level) : null;
    if (end !== null) top = { label: `View Build (${end + 1})`, title: 'End the build at this level', act: () => stopHere(false) };
  } else if (overview && build && gd) {
    const end = build.endLevel ?? 49;
    const can = respecUnfinished(gd, build, steps) || (build.endLevel !== undefined && steps.some((st) => st.level > end));
    const where = can ? continueTarget(gd, build, steps) : null;
    if (where) top = { label: `${where.flow ? 'Continue Respec' : 'Continue Leveling'} (${where.target.level + 1})`, title: 'Pick up where the build stopped', act: continueLeveling };
  }
  if (top) {
    const t = top;
    rows.push(
      <Pill key="top" x={PANE.pad} y={y} w={inner} h={ROW_H} fontSize={PILL_FONT} title={t.title} onClick={() => {
          setOpen(false);
          t.act();
        }}>
        {t.label}
      </Pill>,
    );
    y += ROW_H + ROW_GAP;
  }
  rows.push(
    <Pill key="sound" x={PANE.pad} y={y} w={half} h={ROW_H} fontSize={PILL_FONT} dim={muted} onClick={() => setMuted(!muted)}>
      Sound: {muted ? 'off' : 'on'}
    </Pill>,
    <Pill key="music" x={PANE.pad + half + ROW_GAP} y={y} w={half} h={ROW_H} fontSize={PILL_FONT} dim={!musicOn} onClick={() => setMusicOn(!musicOn)}>
      Music: {musicOn ? 'on' : 'off'}
    </Pill>,
  );
  y += ROW_H + ROW_GAP;
  rows.push(
    <Pill key="support" x={PANE.pad} y={y} w={inner} h={ROW_H} fontSize={PILL_FONT} onClick={() => {
        setOpen(false);
        setSupport(true);
      }}>
      Support HateCoHPlanner
    </Pill>,
  );
  y += ROW_H + PANE.pad;
  if (overview && build) {
    rows.push(
      <OriginAlignPane
        key="oa"
        skin={skin}
        x={0}
        y={y - 10}
        w={paneW}
        k={OA_SCALE}
        origin={build.origin}
        align={build.alignment}
        onOrigin={(id) => void changeOrigin(id)}
        onAlign={(a) => setBuild({ ...build, alignment: a })}
      />,
    );
    y += ORIGIN_PANE_H * OA_SCALE - 10;
  }
  const paneH = Math.min(y, stage.h - paneTop - 40);

  return (
    <>
      <div
        className="abs"
        aria-label="Menu"
        aria-expanded={open}
        onClick={toggle}
        {...pressKeys(toggle, undefined, 'Menu')}
        style={{ left: btn.x, top: btn.y, width: btn.w, height: btn.h, cursor: 'pointer', zIndex: 72 }}
      >
        {[0, 1, 2].map((i) => (
          <div key={i} className="abs" style={{ left: 10, top: PHONE_MENU_BTN.pad + i * PHONE_MENU_BTN.pitch, width: btn.w - 20, height: PHONE_MENU_BTN.bar, borderRadius: PHONE_MENU_BTN.bar / 2, background: 'var(--menu-border)', boxShadow: open ? '0 0 8px var(--menu-border)' : 'none' }} />
        ))}
      </div>
      {open ? (
        <>
          <div className="abs" style={{ left: 0, top: 0, width: stage.w, height: stage.h, zIndex: 70 }} onClick={() => setOpen(false)} />
          {/* on whole device pixels, so the bars inside tile without seams */}
          <div className="abs" style={{ left: snap(stage.w - PANE.right - paneW), top: snap(paneTop), width: paneW, height: paneH, zIndex: 71 }}>
            <MenuFrame x={0} y={0} w={paneW} h={paneH} skin={skin} style={{ background: 'rgba(0,3,20,0.96)' }} />
            <div className="abs scroll-y" style={{ left: 0, top: 0, width: paneW, height: paneH }}>
              <div style={{ position: 'relative', height: y }}>{rows}</div>
            </div>
          </div>
        </>
      ) : null}
      {support ? <SupportDialog skin={skin} onClose={() => setSupport(false)} /> : null}
    </>
  );
}

/** The planner's own controls: the bottom bar on desktop, the menu button and pane on phones. */
export function Settings({ skin }: { skin: Skin }) {
  return useStage().phone ? <PhoneMenu skin={skin} /> : <BottomBar skin={skin} />;
}
