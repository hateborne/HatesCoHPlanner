import { useEffect, useMemo, useState, type CSSProperties, type ReactElement, type ReactNode } from 'react';
import { useShallow } from 'zustand/react/shallow';
import type { GameData } from '../../data/gamedata.ts';
import type { Power, Powerset } from '../../data/types.ts';
import type { Build } from '../../engine/build.ts';
import { boostPog, enhLevelLabel } from '../../engine/enhance.ts';
import { pickHoldsEnhancements, setEnh, setExclusive, setOn } from '../../engine/actions.ts';
import { BuildRules, type BuildEntry } from '../../engine/rules.ts';
import type { LevelStep } from '../../engine/schedule.ts';
import { computeTotals, defaultOn, defaultsOf, exclusiveGroups } from '../../engine/totals.ts';
import { respecUnfinished, useStore, useTipLevel } from '../../state/store.ts';
import { CheckBar } from '../components/CheckBar.tsx';
import { InfoButton, MenuFrame, NextButton, PHONE_LEVEL_SCALE, SetFrame, SetTitle, SlotRing, TitleBar, type TitleEdit } from '../components/Chrome.tsx';
import { GameScroll } from '../components/GameScroll.tsx';
import { GameText } from '../components/GameText.tsx';
import { PatchNotesBar, PatchNotesBox, patchNotesHeight } from '../components/PatchNotes.tsx';
import { phoneGeom, phoneMenuButton, phonePanel, PhoneTabs, phoneTopRowY } from '../components/Phone.tsx';
import { PhoneTipLayer } from '../components/PhoneTip.tsx';
import { changeOrigin, ORIGIN_PANE_H, OriginAlignPane } from '../components/OriginAlign.tsx';
import { DescTip, EnhTip, SlotTip, usePointer, useShiftHint } from '../components/PowerTip.tsx';
import { LockFlash } from '../components/LockFlash.tsx';
import { AdvancedInfo } from '../components/PowerInfoView.tsx';
import { useStage } from '../components/Stage.tsx';
import { TotalsPanel } from '../components/TotalsPanel.tsx';
import { S, snap, SX, SY, TOP_LABEL_RIGHT, vs, vx, vy } from '../skin/metrics.ts';
import { icon, type Skin } from '../skin/skin.ts';
import { play } from '../sound.ts';
import { EnhancementPicker } from './EnhancementPicker.tsx';
import { useEscape } from '../escape.ts';
import { clearHover, useFreshHover, useHover } from '../hover.ts';
import { longPress, pressKeys } from '../press.ts';

const COLS = [
  { x: 33, w: 480, column: 0 },
  { x: 523, w: 480, column: 1 },
  { x: 1013, w: 480, column: 2 },
];
const TOP = 170;
const H = 875;
const POWER_SPEC_HT = 65; // uiLevelSpec.c row height (virtual)
const SPEC_WD = 36; // ring spacing (virtual, x s)
// EnhncTray_Ring at scale .5, 12% smaller here than on the slot screen so a full row of six
// reads as separate rings
const RING = vs(35) * 0.88;
// ring spacing shrunk with the rings, so they sit edge to edge like the slot screen's
const RING_STEP = SPEC_WD * S * 0.88;
const SWITCH = 30; // the floating on/off button
// phones: finger-sized rings, switches and level orbs, and the rows spaced to hold them
const PHONE_RING = 56;
const PHONE_RING_STEP = 58;
const PHONE_SWITCH = 48;
const PHONE_ROW = 104;
// phones: the rings hang below the bar's center (so its name sits centered in the bar), not over it
const PHONE_RING_DY = 38;

// phones: the level log's button (left of the menu button): width, draw scale, and the room the
// title bar leaves for it
const LOG_BTN_W = 160;
const LOG_BTN_SCALE = 1.35;
const LOG_RESERVE = LOG_BTN_W + 22 * LOG_BTN_SCALE + 16;
// phones: the Totals tab's text, a little larger than the desktop panel's
const TOTALS_ZOOM = 1.15;
// phones: the patch-move changes bar between the panel and Back / Next
const NOTES_BAR = 56;
// width of the Origin / Alignment (and Continue) buttons at the top
const OA_W = vx(150);
// desktop: the build's name ends this far short of the Origin / Alignment button
const TITLE_GAP = 12;
// the build name's longest length (New Build's field; checkBuild cuts imports to it)
const NAME_MAX = 40;

/**
 * Phones: the level log, in place of the desktop's strip of level orbs. A capsule left of the
 * menu button ("1 - 50") opens a list of what each level added: the powers picked there (tap one
 * to swap it, as tapping its orb does: refused while it holds enhancements) and the slots placed
 * there ("Fire Blast +2"; tap to reopen that level's slot screen). Unfinished levels show in red.
 * Closes on Escape, the button or a tap outside it.
 *
 * @param props.shown The build's level steps (up to its stop level).
 * @param props.entries The overview's power entries (for the slots placed at each level).
 */
function LevelLog({ gd, skin, build, shown, entries }: { gd: GameData; skin: Skin; build: Build; shown: LevelStep[]; entries: BuildEntry[] }) {
  const { editPick, editSlots, notify } = useStore(useShallow((s) => ({ editPick: s.editPick, editSlots: s.editSlots, notify: s.notify })));
  const [open, setOpen] = useState(false);
  useEscape(() => setOpen(false), open);
  const stage = useStage();
  const g = phoneGeom(stage, false);
  const btn = phoneMenuButton(g);
  const sc = LOG_BTN_SCALE;
  const end = build.endLevel ?? 49;
  const paneTop = g.line + 6;
  const paneW = stage.w - 16;
  const swap = (k: number) => {
    if (pickHoldsEnhancements(gd, build, k)) {
      notify(`Remove the enhancements from ${gd.power(build.picks[k]!.power).dn} first`);
      return;
    }
    setOpen(false);
    editPick(k);
  };
  const rows: ReactElement[] = [];
  let y = 14;
  const ROW = 60;
  const LINE = 26;
  for (const st of shown) {
    rows.push(<SetTitle key={`h${st.level}`} skin={skin} x={16} y={y} size={18} text={`Level ${st.level + 1}`} />);
    y += 32;
    for (const k of st.picks) {
      const pk = build.picks[k];
      if (pk) {
        const pw = gd.power(pk.power);
        rows.push(<CheckBar key={`p${k}`} skin={skin} x={56} y={y + ROW / 2 - 6} wd={paneW - 100} icon={icon('powers', pw.icon || 'power_missing')} text={pw.dn} state="standard" onClick={() => swap(k)} />);
        y += ROW;
      } else {
        rows.push(
          <div key={`p${k}`} className="abs body-text" onClick={() => swap(k)} {...pressKeys(() => swap(k))} style={{ left: 30, top: y, width: paneW - 60, height: 34, lineHeight: '34px', fontSize: 19, color: '#ff6060', cursor: 'pointer' }}>
            Choose a power
          </div>,
        );
        y += 38;
      }
    }
    if (st.slots > 0) {
      const placed = new Map<string, number>();
      for (const e of entries) for (const sl of e.slots.slice(1)) if (sl.level === st.level) placed.set(e.power.dn, (placed.get(e.power.dn) ?? 0) + 1);
      const left = st.slots - [...placed.values()].reduce((a, b) => a + b, 0);
      const lines = [...placed].map(([n, c]) => ({ text: `${n} +${c}`, red: false }));
      if (left > 0) lines.push({ text: `${left} slot${left > 1 ? 's' : ''} to place`, red: true });
      const reopen = () => {
        setOpen(false);
        editSlots(st.level);
      };
      rows.push(
        <div key={`s${st.level}`} className="abs body-text" onClick={reopen} {...pressKeys(reopen, undefined, `Level ${st.level + 1} slots`)} style={{ left: 30, top: y, width: paneW - 60, fontSize: 19, lineHeight: `${LINE}px`, color: '#cfe8ff', cursor: 'pointer' }}>
          {lines.map((l, i) => (
            <div key={i} style={{ color: l.red ? '#ff6060' : undefined }}>
              {l.text}
            </div>
          ))}
        </div>,
      );
      y += lines.length * LINE + 8;
    }
    y += 10;
  }
  const paneH = Math.min(y + 8, stage.h - paneTop - 50);
  const toggle = () => setOpen(!open);
  return (
    <>
      <CheckBar
        skin={skin}
        x={btn.x - 8 - LOG_BTN_W}
        // level with the menu button
        y={phoneTopRowY(g)}
        wd={LOG_BTN_W}
        scale={sc}
        noBox
        text={`1 - ${end + 1}`}
        state={open ? 'selected' : 'standard'}
        onClick={toggle}
      />
      {open ? (
        <>
          <div className="abs" style={{ left: 0, top: 0, width: stage.w, height: stage.h, zIndex: 70 }} onClick={() => setOpen(false)} />
          {/* on whole device pixels, so the bars inside tile without seams */}
          <div className="abs" style={{ left: snap(8), top: snap(paneTop), width: paneW, height: paneH, zIndex: 71 }}>
            <MenuFrame x={0} y={0} w={paneW} h={paneH} skin={skin} style={{ background: 'rgba(0,3,20,0.96)' }} />
            <div className="abs scroll-y" style={{ left: 0, top: 0, width: paneW, height: paneH }}>
              <div style={{ position: 'relative', height: y + 8 }}>{rows}</div>
            </div>
          </div>
        </>
      ) : null}
    </>
  );
}

interface Group {
  set: Powerset | null;
  title: string;
  entries: BuildEntry[];
}

/** One panel's row geometry, in px relative to its scroll viewport (as AddEnhancementSlot's). */
interface Geom {
  barCX: number;
  barW: number;
  ringX: number;
  ring: number; // slot ring size
  ringStep: number; // slot ring spacing
  ringDy: number; // the rings' center below the bar's center
  sw: number; // the on/off switch's size
  boxW: number;
  start: number;
  row: number;
  unit: number;
  phone: boolean;
}

/**
 * @param width The panel's scroll viewport width.
 * @param unit Virtual-y to stage px for the in-row offsets.
 * @param phone Finger-sized rings and switches, with the first ring as clear of the icon as on the desktop.
 */
function geom(width: number, unit: number, phone = false): Geom {
  const barCX = 62; // the level tag sits in the margin left of the icon
  const sw = phone ? PHONE_SWITCH : SWITCH;
  const barW = width - barCX - 2 * sw - 6;
  const ring = phone ? PHONE_RING : RING;
  const ringStep = phone ? PHONE_RING_STEP : RING_STEP;
  const ringX = phone ? barCX + 48 - ringStep : barCX - 2 * SX;
  return { barCX, barW, ringX, ring, ringStep, ringDy: phone ? PHONE_RING_DY : 20 * S, sw, boxW: barW - 10 * SX, start: phone ? -10 * unit : -19 * unit, row: phone ? PHONE_ROW : POWER_SPEC_HT * unit, unit, phone };
}

/**
 * A steady half-white cover over a power bar or slot ring, drawn only while the level orb `level`
 * is hovered (subscribes to that one fact). Same placement as the red LockFlash, without the blink.
 */
function OrbLight({ level, style }: { level: number; style: CSSProperties }) {
  const lit = useHover((h) => h.orb === level);
  return lit ? <div className="abs hover-light" style={style} /> : null;
}

/** One level orb; it blinks once a second while a power or slot taken at its level is hovered. */
function LevelOrb({ level, className, style, title, onClick, children }: { level: number; className: string; style: CSSProperties; title: string; onClick: () => void; children: ReactNode }) {
  const blinking = useHover((h) => h.blink === level);
  return (
    <div
      onClick={onClick}
      {...pressKeys(onClick, undefined, `Level ${level + 1}`)}
      onMouseEnter={() => useHover.setState({ orb: level })}
      onMouseLeave={() => useHover.setState((h) => (h.orb === level ? { orb: null } : h))}
      title={title}
      className={className}
      style={style}
    >
      {/* under the number, so the number stays readable while the orb lights */}
      {blinking ? <div className="abs hover-light orb-blink" style={{ left: 0, top: 0, right: 0, bottom: 0, borderRadius: '50%', zIndex: 0 }} /> : null}
      <span style={{ position: 'relative', zIndex: 1 }}>{children}</span>
    </div>
  );
}

/** The power / enhancement hover boxes; the only part of the overview that follows the pointer. */
function OverviewTips({ gd, skin, build, end }: { gd: GameData; skin: Skin; build: Build; end: number }) {
  const { tip, ringTip } = useHover(useShallow((h) => ({ tip: h.tip, ringTip: h.ringTip })));
  const tipLevel = useTipLevel();
  const hint = useShiftHint();
  return (
    <>
      {ringTip && tipLevel !== 'off' ? <EnhTip gd={gd} at={gd.archetype(build.at)} slots={ringTip.entry.slots} slot={ringTip.slot} level={end} x={ringTip.x} y={ringTip.y} /> : null}
      {tip && tipLevel === 'basic' ? <DescTip skin={skin} power={tip.entry.power} x={tip.x} y={tip.y} hint={hint} /> : null}
      {tip && tipLevel === 'advanced' ? (
        <SlotTip gd={gd} power={tip.entry.power} x={tip.x} y={tip.y} advanced={<AdvancedInfo gd={gd} at={gd.archetype(build.at)} entry={tip.entry} level={end} />} />
      ) : null}
    </>
  );
}

/**
 * Build overview: the level strip (reopen any level's in-game screen), every power drawn the way
 * the Add an Enhancement Slot / Enhancement Management screens draw them (set frames, power
 * bars, slot rings under each bar), totals, and a hover box with the power's description.
 *
 * Planner extras: each bar's floating switch counts the power in the totals (the bar turns green
 * while it counts), exclusive granted toggles (Bio Armor's Adaptations, Dual Pistols' ammo,
 * Staff Fighting's forms) get one drop-down on the granting power's bar, a ring click picks an
 * enhancement and a right-click clears it.
 */
export function Overview({ skin }: { skin: Skin }) {
  // only the fields drawn here: a store change elsewhere (Shift, a notice) must not redraw the screen
  const { gd, build, steps, editPick, editSlots, toSetup, setBuild, setMenu, continueLeveling, lockFlash } = useStore(
    useShallow((s) => ({ gd: s.gd, build: s.build, steps: s.steps, editPick: s.editPick, editSlots: s.editSlots, toSetup: s.toSetup, setBuild: s.setBuild, setMenu: s.setMenu, continueLeveling: s.continueLeveling, lockFlash: s.lockFlash })),
  );
  // for the room it takes: the list itself is drawn by PatchNotesBox / PatchNotesBar
  const notes = useStore((s) => s.patchNotes);
  const notesH = notes ? patchNotesHeight(notes.lines) : 0;
  const [picker, setPicker] = useState<{ entry: BuildEntry; slot: number } | null>(null);
  const [tab, setTab] = useState(0);
  const [oaOpen, setOaOpen] = useState(false);
  useEscape(() => setOaOpen(false), oaOpen);
  // Hover state (tooltips, and the links between level orbs and the build) lives in useHover, so a
  // hover redraws only the glow / orb / tooltip that subscribes to it, not this whole screen.
  useFreshHover();
  useEffect(() => clearHover(), [build]); // entries are rebuilt; drop any tooltip holding an old one
  const stage = useStage();
  const { phone } = stage;
  const rules = useMemo(() => (gd && build ? new BuildRules(gd, build) : null), [gd, build]);
  const totals = useMemo(() => (gd && build && rules ? computeTotals(gd, rules, build) : null), [gd, build, rules]);
  const issues = useMemo(() => (rules ? rules.issues() : []), [rules]);
  const groupsOf = useMemo(() => (rules ? rules.toggleGroups() : new Map<number, Power[]>()), [rules]);
  // each power's default on/off and the toggles that switch each other off (as computeTotals
  // works them out, over the whole build)
  const onState = useMemo(() => {
    if (!gd || !build || !rules) return { defaults: new Map<string, boolean>(), groupOf: new Map<string, BuildEntry[]>() };
    const counted = rules.entries();
    return { defaults: defaultsOf(gd, counted), groupOf: new Map(exclusiveGroups(counted).flatMap((g) => g.map((e) => [e.key, g] as const))) };
  }, [gd, build, rules]);

  // last pointer position in stage px, for placing the hover box
  const mouse = usePointer();

  if (!gd || !build || !rules || !totals) return null;
  // every pick (even unslottable ones such as Adaptation), plus granted powers the game lets you slot
  const entries = rules.entries().filter((e) => e.source === 'pick' || (e.power.sm !== 0 && rules.slottable(e.power)));
  const originIndex = gd.core.origins.findIndex((o) => o.id === build.origin);
  const end = build.endLevel ?? 49;
  const who = `${gd.core.origins.find((o) => o.id === build.origin)?.dn ?? ''} ${gd.archetype(build.at).dn}`.trim().toUpperCase();
  const title = build.name ? build.name.toUpperCase() : 'BUILD OVERVIEW';
  // the title bar's dot (or the bar) renames the build in place
  const rename: TitleEdit = { value: build.name, maxLength: NAME_MAX, label: 'Rename this build', onCommit: (name) => setBuild({ ...build, name }) };

  /** Entries of one panel grouped by powerset, sets in order of their first power. */
  const groups = (column: number): Group[] => {
    const by = new Map<number, Group>();
    for (const e of entries) {
      const ref = gd.setOfPower.get(e.power.id);
      if ((ref ? rules.column(ref.set) : 2) !== column) continue;
      const id = ref?.set.id ?? -1;
      const g = by.get(id) ?? { set: ref?.set ?? null, title: ref?.set.dn ?? 'Other', entries: [] };
      g.entries.push(e);
      by.set(id, g);
    }
    return [...by.values()];
  };

  const hoverOn = (e: BuildEntry, on: boolean) => {
    if (phone) return;
    useHover.setState((h) => ({
      blink: e.source !== 'pick' ? h.blink : on ? e.level : h.blink === e.level ? null : h.blink,
      tip: on ? { entry: e, x: mouse.current.x, y: mouse.current.y } : h.tip?.entry.key === e.key ? null : h.tip,
    }));
  };

  const renderPanel = (view: { left: number; top: number; width: number; height: number }, bar: { x: number; top: number; height: number }, g: Geom, list: Group[], key: number) => {
    const items: ReactElement[] = [];
    const u = g.unit;
    let primY = g.start;
    for (const grp of list) {
      primY += g.row;
      const top = primY;
      const boxAt = items.length;
      items.push(<GameText key={`h${grp.set?.id ?? 'x'}`} font="title_12" scale={S} x={g.barCX + g.boxW / 2} y={top - 23 * u} align="center" colors={skin.heading} text={grp.title} />);
      for (const e of grp.entries) {
        const y = primY;
        const members = groupsOf.get(e.power.id);
        const chosen = members?.find((m) => build.granted[m.id]?.on ?? defaultOn(m));
        const dflt = onState.defaults.get(e.key) ?? defaultOn(e.power);
        const on = members ? !!chosen : (e.on ?? dflt);
        const flagged = issues.filter((i) => i.key === e.key);
        // a group's drop-down replaces the switch and takes the bar's right end
        const SELECT_W = 150;
        const barW = members ? g.barW + g.sw + 4 - SELECT_W - 8 : g.barW;
        // phones: a long press shows the power's tooltip (with the rule it breaks, if any)
        const longBar = g.phone ? (pt: { x: number; y: number }) => useHover.setState({ press: { kind: 'power', entry: e, notes: flagged.map((f) => f.message), ...pt } }) : undefined;
        const toggleOn = () => {
          let nb = setOn(build, e.key, !on === dflt ? undefined : !on);
          // as in the game, switching on one of toggles that exclude each other switches the rest off
          if (!on) {
            for (const o of onState.groupOf.get(e.key) ?? []) if (o.key !== e.key) nb = setOn(nb, o.key, onState.defaults.get(o.key) ? false : undefined);
          }
          setBuild(nb);
        };
        if (e.source === 'pick') {
          // picked at the hovered orb's level: the bar lit half-white (LockFlash's shape)
          items.push(<OrbLight key={`${e.key}:light`} level={e.level} style={{ left: g.barCX - 19 * S, top: y - 16 * S, width: barW + 17 * S, height: 32 * S, borderRadius: 16 * S, zIndex: 20 }} />);
        }
        items.push(
          <CheckBar
            key={e.key}
            testId={`bar:${e.key}`}
            skin={skin}
            x={g.barCX}
            y={y}
            wd={barW}
            halfText={!g.phone}
            text={lockFlash?.key === e.key ? lockFlash.label : e.power.dn}
            state={flagged.length ? 'unselectable' : on ? 'selected' : 'standard'}
            icon={icon('powers', e.power.icon || 'power_missing')}
            title={flagged.map((f) => f.message).join('\n') || undefined}
            onClick={e.pickIndex !== undefined ? () => editPick(e.pickIndex!) : undefined}
            onLongPress={longBar}
            onHover={(h) => hoverOn(e, h)}
          />,
        );
        if (lockFlash?.key === e.key) items.push(<LockFlash key={`${e.key}:flash-${lockFlash.id}`} flashKey={e.key} x={g.barCX} y={y} w={barW} s={S} />);
        // the level the power was taken, left of its icon (not for what every character starts with)
        if (!(e.source === 'grant' && e.level <= 4)) {
          items.push(
            <GameText key={`${e.key}:lv`} font="title_9" scale={S} x={g.barCX - 22 * S - 4} y={y} centerY align="right" colors={[skin.standard.text, skin.standard.text2]} text={String(e.level + 1)} />,
          );
        }
        if (members) {
          // one switch for the group: Off or the member that runs
          items.push(
            <select
              key={`${e.key}:grp`}
              className="abs body-text"
              value={chosen?.id ?? ''}
              title="Which one is running (counted in the totals)"
              onChange={(ev) => {
                const v = ev.target.value;
                play('powerselect2');
                setBuild(setExclusive(build, members.map((m) => m.id), v ? Number(v) : undefined));
              }}
              style={{ left: g.barCX + barW + 8, top: y - (g.phone ? 24 : 16), width: SELECT_W, height: g.phone ? 48 : 32, fontFamily: "'Montreal'", fontSize: 15, color: '#fff', background: 'linear-gradient(#0c2a6e, #04102e)', border: '2px solid #4f94ff', borderRadius: 16, padding: '0 6px 0 10px', cursor: 'pointer', zIndex: 9 }}
            >
              <option value="">Off</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.dn.replace(/ Adaptation$| Ammunition$/, '')}
                </option>
              ))}
            </select>,
          );
        } else {
          items.push(
            <div
              key={`${e.key}:on`}
              className="abs"
              title={on ? 'Counted in totals (click to exclude)' : 'Not counted in totals (click to include)'}
              onClick={toggleOn}
              {...pressKeys(toggleOn, undefined, on ? 'Counted in totals' : 'Not counted in totals')}
              {...longPress(g.phone ? (pt) => useHover.setState({ press: { kind: 'text', text: on ? 'Counted in the totals (tap to leave it out).' : 'Not counted in the totals (tap to count it).', ...pt } }) : undefined)}
              style={{ left: g.barCX + g.barW + g.sw / 2 + 4, top: y - g.sw / 2, width: g.sw, height: g.sw, borderRadius: g.sw / 2, cursor: 'pointer', border: '2px solid #4f94ff', background: on ? 'radial-gradient(#7fff7f, #00a020)' : '#111', boxShadow: on ? '0 0 8px #3f3' : 'none', zIndex: 9 }}
            />,
          );
        }
        e.slots.forEach((s, i) => {
          const boost = s.enh ? gd.powerById.get(s.enh.boost) : undefined;
          // a slot placed at a level (or a pick's own first slot) belongs to that level's orb
          const orbLevel = i > 0 || e.source === 'pick' ? s.level : null;
          if (i > 0) {
            // placed at the hovered orb's level: the ring lit half-white
            items.push(<OrbLight key={`${e.key}:${i}:light`} level={s.level} style={{ left: g.ringX + (i + 1) * g.ringStep - g.ring / 2, top: y + g.ringDy - g.ring / 2, width: g.ring, height: g.ring, borderRadius: g.ring / 2, zIndex: 10 }} />);
          }
          items.push(
            <SlotRing
              skin={skin}
              key={`${e.key}:${i}`}
              testId={`ring:${e.key}:${i}`}
              x={g.ringX + (i + 1) * g.ringStep}
              y={y + g.ringDy}
              size={g.ring}
              enhIcon={boost ? icon('enh', boost.icon) : undefined}
              frames={boost?.bf}
              pog={boost ? boostPog(gd, boost) : undefined}
              level={boost && s.enh ? enhLevelLabel(gd, boost, s.enh, end) : undefined}
              levelScale={g.phone ? PHONE_LEVEL_SCALE : undefined}
              title={boost ? undefined : `Empty slot (level ${s.level + 1})`}
              onHover={
                phone
                  ? undefined
                  : (h) =>
                      useHover.setState((st) => ({
                        // the enhancement's tooltip (filled slots), and the orb of the slot's level blinks
                        ringTip: h && boost ? { entry: e, slot: i, x: mouse.current.x, y: mouse.current.y } : st.ringTip?.entry.key === e.key && st.ringTip.slot === i ? null : st.ringTip,
                        blink: h ? orbLevel : st.blink === orbLevel ? null : st.blink,
                      }))
              }
              onClick={() => setPicker({ entry: e, slot: i })}
              onLongPress={
                g.phone
                  ? (pt) => useHover.setState({ press: boost ? { kind: 'enh', entry: e, slot: i, ...pt } : { kind: 'text', text: `Empty slot (level ${s.level + 1}).\nTap it to choose an enhancement.`, ...pt } })
                  : undefined
              }
              onRightClick={
                boost
                  ? () => {
                      play('delete');
                      useHover.setState({ ringTip: null });
                      setBuild(setEnh(build, e.key, i, undefined, e.level));
                    }
                  : undefined
              }
            />,
          );
        });
        primY += g.row;
        if (flagged.length) {
          items.push(
            <div key={`${e.key}:issue`} className="abs body-text" style={{ left: g.barCX, top: g.phone ? y + g.ringDy + g.ring / 2 + 2 : primY - 30 * u + 30 * S, fontSize: g.phone ? 16 : 13, color: '#ff6060', whiteSpace: 'nowrap' }}>
              {flagged[0]!.message}
            </div>,
          );
          primY += g.phone ? 22 : 18;
        }
      }
      // the set's frame from the bar's x, as specMenu draws it
      items.splice(boxAt, 0, <SetFrame key={`b${grp.set?.id ?? 'x'}`} skin={skin} x={g.barCX} y={top - 30 * u} w={g.boxW} h={primY - top - 35 * u} />);
    }
    return (
      <GameScroll key={key} skin={skin} left={view.left} top={view.top} width={view.width} height={view.height} barX={bar.x} barTop={bar.top} barHeight={bar.height}>
        <div style={{ position: 'relative', height: Math.max(0, Math.ceil(primY + 30 * u)) }}>{items}</div>
      </GameScroll>
    );
  };

  const desktopPanel = (c: (typeof COLS)[number]) =>
    renderPanel({ left: c.x + 2, top: TOP + 6, width: c.w - 4, height: H - 12 }, { x: c.x + c.w, top: TOP + 18, height: H - 36 }, geom(c.w - 4, SY), groups(c.column), c.column);

  const shown = steps.filter((s) => s.level <= end);
  /** The orb's hover text: the power(s) picked there ("Flight: Fly"), or the slots placed there. */
  const orbTitle = (s: (typeof steps)[number]) => {
    if (s.picks.length) {
      const names = s.picks.map((k) => build.picks[k]).filter((p) => !!p).map((p) => `${gd.setOfPower.get(p!.power)?.set.dn ?? ''}: ${gd.power(p!.power).dn}`);
      return names.length ? names.join('\n') : `Level ${s.level + 1}: choose a power`;
    }
    const placed = new Map<string, number>();
    for (const e of entries) for (const sl of e.slots.slice(1)) if (sl.level === s.level) placed.set(e.power.dn, (placed.get(e.power.dn) ?? 0) + 1);
    return placed.size ? [...placed].map(([n, c]) => `${n} +${c} slot${c > 1 ? 's' : ''}`).join('\n') : `Level ${s.level + 1}: ${s.slots} enhancement slots`;
  };
  const levelStrip = (x0: number, y0: number, perRow: number, size: number) =>
    shown.map((s, i) => {
      const isPick = s.picks.length > 0;
      const filled = isPick ? s.picks.every((k) => build.picks[k]) : rules.slotsUsed(s.level) >= s.slots;
      return (
        <LevelOrb
          key={s.level}
          level={s.level}
          onClick={() => {
            if (!isPick) return editSlots(s.level);
            // the bar that flashes "Remove Enhancements First!" may be scrolled out of view: say it too
            const k = s.picks[0]!;
            if (build.picks[k] && pickHoldsEnhancements(gd, build, k)) useStore.getState().notify(`Remove the enhancements from ${gd.power(build.picks[k].power).dn} first`);
            editPick(k);
          }}
          title={orbTitle(s)}
          className="abs body-text"
          style={{ left: x0 + (i % perRow) * (size + 4), top: y0 + Math.floor(i / perRow) * (size + 6), width: size, height: size, borderRadius: size / 2, cursor: 'pointer', fontSize: size * 0.38, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', border: `2px solid ${isPick ? '#ffd200' : '#4f94ff'}`, background: filled ? (isPick ? '#6b5400' : '#0b3d9a') : '#300', boxShadow: filled ? 'none' : '0 0 6px #f33' }}
        >
          {s.level + 1}
        </LevelOrb>
      );
    });
  // a build stopped short of 50 can pick up where it left off
  // ...and a respec left part-way (powers or slots still to place) picks up where it stopped
  const respecLeft = respecUnfinished(gd, build, steps);
  const canContinue = respecLeft || (build.endLevel !== undefined && steps.some((s) => s.level > end));

  /**
   * Origin / Alignment (and Continue Leveling for a build stopped short of 50) centered on cx;
   * the popout drops from the Origin / Alignment button with the New Build screen's pane at
   * three-quarter scale.
   */
  const oaCenter = (cx: number, w: number) => (canContinue ? cx - w / 2 - 8 : cx);
  const topButtons = (cx: number, cy: number, w: number, h: number) => {
    const oaX = oaCenter(cx, w);
    const PW = 470; // the pane at full size, drawn at POP scale
    const PH = ORIGIN_PANE_H;
    const POP = 0.75;
    return (
      <>
        <InfoButton skin={skin} x={oaX} y={cy} w={w} h={h} text="Origin / Alignment" onClick={() => setOaOpen(!oaOpen)} />
        {canContinue ? <InfoButton skin={skin} x={cx + w / 2 + 8} y={cy} w={w} h={h} text={respecLeft ? 'Continue Respec' : 'Continue Leveling'} onClick={continueLeveling} /> : null}
        {oaOpen ? (
          <>
            <div className="abs" style={{ left: 0, top: 0, width: stage.w, height: stage.h, zIndex: 70 }} onClick={() => setOaOpen(false)} />
            <div className="abs" style={{ left: oaX - (PW * POP) / 2, top: cy + h / 2 + 6, width: PW * POP, height: PH * POP, zIndex: 71 }}>
              <div className="abs" style={{ left: 0, top: 0, width: PW, height: PH, zoom: POP }}>
                <MenuFrame x={0} y={0} w={PW} h={PH} skin={skin} style={{ background: 'rgba(0,3,20,0.96)' }} />
                <OriginAlignPane
                  skin={skin}
                  x={0}
                  y={0}
                  w={PW}
                  origin={build.origin}
                  align={build.alignment}
                  onOrigin={(id) => void changeOrigin(id)}
                  onAlign={(a) => setBuild({ ...build, alignment: a })}
                />
              </div>
            </div>
          </>
        ) : null}
      </>
    );
  };

  const picker_ = picker ? (
    <EnhancementPicker
      gd={gd}
      skin={skin}
      entry={picker.entry}
      slot={picker.slot}
      originIndex={originIndex}
      atId={build.at}
      refusal={(b) => rules?.slotRefusal(picker.entry, picker.slot, b) ?? null}
      lastLevel={rules?.lastLevel() ?? 49}
      onClose={() => setPicker(null)}
      onPlace={(enh) => {
        play(enh ? 'select5' : 'delete');
        setBuild(setEnh(build, picker.entry.key, picker.slot, enh, picker.entry.level));
        setPicker(null);
      }}
    />
  ) : null;

  if (phone) {
    // no archetype label on a phone (it is in the menu pane): the tabs go right under the title;
    // the level log replaces the orb strip and Continue sits in the menu, so the panel runs down
    // to Back / Next
    const pg = phoneGeom(stage, false);
    const P = phonePanel(pg, 4, notes ? NOTES_BAR : 0);
    return (
      <>
        <TitleBar skin={skin} text={title} reserve={LOG_RESERVE} edit={rename} />
        <LevelLog gd={gd} skin={skin} build={build} shown={shown} entries={entries} />
        <PhoneTabs skin={skin} labels={['Primary', 'Secondary', 'Pools', 'Totals']} active={tab} onChange={setTab} y={pg.tabsY} />
        <MenuFrame x={P.x} y={P.y} w={P.w} h={P.h} skin={skin} />
        {tab < 3 ? (
          renderPanel({ left: P.x + 2, top: P.y + 6, width: P.w - 4, height: P.h - 12 }, { x: P.x + P.w, top: P.y + 18, height: P.h - 36 }, geom(P.w - 4, S, true), groups(COLS[tab]!.column), tab)
        ) : (
          <GameScroll skin={skin} left={P.x + 16} top={P.y + 14} width={P.w - 32} height={P.h - 28} barX={P.x + P.w}>
            {/* a little larger text than the desktop panel; its spacing keeps it readable */}
            <div style={{ zoom: TOTALS_ZOOM }}>
              <TotalsPanel gd={gd} t={totals} width={(P.w - 50) / TOTALS_ZOOM} />
            </div>
          </GameScroll>
        )}
        <PatchNotesBar skin={skin} y={pg.navTop - 8 - NOTES_BAR / 2} />
        <NextButton skin={skin} dir="left" text="New Build" onClick={toSetup} />
        <NextButton skin={skin} dir="right" text="Save / Share" onClick={() => setMenu(true)} />
        {picker_}
        <PhoneTipLayer gd={gd} skin={skin} at={gd.archetype(build.at)} level={end} />
      </>
    );
  }

  return (
    <>
      {/* the name stops just short of the Origin / Alignment button (two half-size lines past it) */}
      <TitleBar skin={skin} text={title} limit={oaCenter(stage.w / 2, OA_W) - OA_W / 2 - TITLE_GAP} edit={rename} />
      <GameText font="title_14" scale={S} x={TOP_LABEL_RIGHT} y={vy(38)} align="right" colors={skin.heading} text={who} />
      {topButtons(stage.w / 2, vy(22), OA_W, vy(26))}
      <MenuFrame x={32} y={58} w={1937} h={988} r25 outer skin={skin} />
      {/* level strip: reopen any level's in-game screen (levels after a stop are left off) */}
      {levelStrip(50, 92, 50, 34)}
      {COLS.map((c) => (
        <MenuFrame key={c.x} x={c.x} y={TOP} w={c.w} h={H} skin={skin} />
      ))}
      {COLS.map((c) => desktopPanel(c))}
      <MenuFrame x={1503} y={TOP} w={464} h={H} skin={skin} />
      {/* a patch move's changes sit above the totals until dismissed */}
      <PatchNotesBox skin={skin} x={1521} y={TOP + 16} w={420} />
      <GameScroll skin={skin} left={1515} top={TOP + 18 + notesH} width={444} height={H - 36 - notesH} barX={1503 + 464}>
        <TotalsPanel gd={gd} t={totals} width={420} />
      </GameScroll>
      <OverviewTips gd={gd} skin={skin} build={build} end={end} />
      <NextButton skin={skin} dir="left" text="New Build" onClick={toSetup} />
      <NextButton skin={skin} dir="right" text="Save / Share" onClick={() => setMenu(true)} />
      {picker_}
    </>
  );
}
