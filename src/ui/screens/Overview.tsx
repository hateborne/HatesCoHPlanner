import { useMemo, useState, type ReactElement } from 'react';
import type { Power, Powerset } from '../../data/types.ts';
import { setEnh, setExclusive, setOn } from '../../engine/actions.ts';
import { BuildRules, type BuildEntry } from '../../engine/rules.ts';
import { computeTotals, defaultOn } from '../../engine/totals.ts';
import { useStore, useTipLevel } from '../../state/store.ts';
import { CheckBar } from '../components/CheckBar.tsx';
import { InfoButton, MenuFrame, NextButton, SetFrame, SlotRing, TitleBar } from '../components/Chrome.tsx';
import { GameScroll } from '../components/GameScroll.tsx';
import { GameText } from '../components/GameText.tsx';
import { PHONE_PANEL, PhoneTabs } from '../components/Phone.tsx';
import { ORIGIN_PANE_H, OriginAlignPane } from '../components/OriginAlign.tsx';
import { DescTip, SlotTip, usePointer, useShiftHint } from '../components/PowerTip.tsx';
import { AdvancedInfo } from '../components/PowerInfoView.tsx';
import { useStage } from '../components/Stage.tsx';
import { TotalsPanel } from '../components/TotalsPanel.tsx';
import { S, SX, SY, vs, vx, vy } from '../skin/metrics.ts';
import { icon, type Skin } from '../skin/skin.ts';
import { play } from '../sound.ts';
import { EnhancementPicker } from './EnhancementPicker.tsx';

const COLS = [
  { x: 33, w: 480, column: 0 },
  { x: 523, w: 480, column: 1 },
  { x: 1013, w: 480, column: 2 },
];
const TOP = 170;
const H = 875;
const POWER_SPEC_HT = 65; // uiLevelSpec.c row height (virtual)
const SPEC_WD = 36; // ring spacing (virtual, x s)
const RING = vs(35); // EnhncTray_Ring at scale .5
const SWITCH = 30; // the floating on/off button

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
  boxW: number;
  start: number;
  row: number;
  unit: number;
}

function geom(width: number, unit: number): Geom {
  const barCX = 96; // room for the level tag left of the icon
  const barW = width - barCX - 2 * SWITCH - 6;
  return { barCX, barW, ringX: barCX - 2 * SX, boxW: barW - 10 * SX, start: -19 * unit, row: POWER_SPEC_HT * unit, unit };
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
  const { gd, build, steps, editPick, editSlots, toSetup, setBuild, setMenu, continueLeveling } = useStore();
  const [picker, setPicker] = useState<{ entry: BuildEntry; slot: number } | null>(null);
  const [tab, setTab] = useState(0);
  const [tip, setTip] = useState<{ entry: BuildEntry; x: number; y: number } | null>(null);
  const tipLevel = useTipLevel();
  const hint = useShiftHint();
  const [oaOpen, setOaOpen] = useState(false);
  const stage = useStage();
  const { phone } = stage;
  const rules = useMemo(() => (gd && build ? new BuildRules(gd, build) : null), [gd, build]);
  const totals = useMemo(() => (gd && build && rules ? computeTotals(gd, rules, build) : null), [gd, build, rules]);
  const issues = useMemo(() => (rules ? rules.issues() : []), [rules]);
  const groupsOf = useMemo(() => (rules ? rules.toggleGroups() : new Map<number, Power[]>()), [rules]);

  // last pointer position in stage px, for placing the hover box
  const mouse = usePointer();

  if (!gd || !build || !rules || !totals) return null;
  // every pick (even unslottable ones such as Adaptation), plus granted powers the game lets you slot
  const entries = rules.entries().filter((e) => e.source === 'pick' || (e.power.sm !== 0 && rules.slottable(e.power)));
  const originIndex = gd.core.origins.findIndex((o) => o.id === build.origin);
  const end = build.endLevel ?? 49;
  const who = `${gd.core.origins.find((o) => o.id === build.origin)?.dn ?? ''} ${gd.archetype(build.at).dn}`.trim().toUpperCase();

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
    if (on) setTip({ entry: e, x: mouse.current.x, y: mouse.current.y });
    else setTip((t) => (t?.entry.key === e.key ? null : t));
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
        const on = members ? !!chosen : (e.on ?? defaultOn(e.power));
        const flagged = issues.filter((i) => i.key === e.key);
        // a group's drop-down replaces the switch and takes the bar's right end
        const SELECT_W = 150;
        const barW = members ? g.barW + SWITCH + 4 - SELECT_W - 8 : g.barW;
        items.push(
          <CheckBar
            key={e.key}
            skin={skin}
            x={g.barCX}
            y={y}
            wd={barW}
            halfText
            text={e.power.dn}
            state={flagged.length ? 'unselectable' : on ? 'selected' : 'standard'}
            icon={icon('powers', e.power.icon || 'power_missing')}
            title={flagged.map((f) => f.message).join('\n') || undefined}
            onClick={e.pickIndex !== undefined ? () => editPick(e.pickIndex!) : undefined}
            onHover={(h) => hoverOn(e, h)}
          />,
        );
        // the level the power was taken, left of its icon (not for what every character starts with)
        if (!(e.source === 'grant' && e.level <= 4)) {
          items.push(
            <GameText key={`${e.key}:lv`} font="title_9" scale={S} x={g.barCX - 24 * S} y={y} centerY align="right" colors={[skin.standard.text, skin.standard.text2]} text={String(e.level + 1)} />,
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
              style={{ left: g.barCX + barW + 8, top: y - 16, width: SELECT_W, height: 32, fontFamily: "'Montreal'", fontSize: 15, color: '#fff', background: 'linear-gradient(#0c2a6e, #04102e)', border: '2px solid #4f94ff', borderRadius: 16, padding: '0 6px 0 10px', cursor: 'pointer', zIndex: 9 }}
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
              onClick={() => setBuild(setOn(build, e.key, !on === defaultOn(e.power) ? undefined : !on))}
              style={{ left: g.barCX + g.barW + SWITCH / 2 + 4, top: y - SWITCH / 2, width: SWITCH, height: SWITCH, borderRadius: SWITCH / 2, cursor: 'pointer', border: '2px solid #4f94ff', background: on ? 'radial-gradient(#7fff7f, #00a020)' : '#111', boxShadow: on ? '0 0 8px #3f3' : 'none', zIndex: 9 }}
            />,
          );
        }
        e.slots.forEach((s, i) => {
          const boost = s.enh ? gd.powerById.get(s.enh.boost) : undefined;
          items.push(
            <SlotRing
              skin={skin}
              key={`${e.key}:${i}`}
              x={g.ringX + (i + 1) * SPEC_WD * S}
              y={y + 20 * S}
              size={RING}
              enhIcon={boost ? icon('enh', boost.icon) : undefined}
              frames={boost?.bf}
              title={boost ? `${boost.dn} (slot from level ${s.level + 1}; right-click to clear)` : `Empty slot (level ${s.level + 1})`}
              onClick={() => setPicker({ entry: e, slot: i })}
              onRightClick={
                boost
                  ? () => {
                      play('delete');
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
            <div key={`${e.key}:issue`} className="abs body-text" style={{ left: g.barCX, top: primY - 30 * u + 30 * S, fontSize: 13, color: '#ff6060', whiteSpace: 'nowrap' }}>
              {flagged[0]!.message}
            </div>,
          );
          primY += 18;
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
  const levelStrip = (x0: number, y0: number, perRow: number, size: number) =>
    shown.map((s, i) => {
      const isPick = s.picks.length > 0;
      const filled = isPick ? s.picks.every((k) => build.picks[k]) : rules.slotsUsed(s.level) >= s.slots;
      return (
        <div
          key={s.level}
          onClick={() => (isPick ? editPick(s.picks[0]!) : editSlots(s.level))}
          title={isPick ? `Level ${s.level + 1}: choose a power` : `Level ${s.level + 1}: ${s.slots} enhancement slots`}
          className="abs body-text"
          style={{ left: x0 + (i % perRow) * (size + 4), top: y0 + Math.floor(i / perRow) * (size + 6), width: size, height: size, borderRadius: size / 2, cursor: 'pointer', fontSize: size * 0.38, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', border: `2px solid ${isPick ? '#ffd200' : '#4f94ff'}`, background: filled ? (isPick ? '#6b5400' : '#0b3d9a') : '#300', boxShadow: filled ? 'none' : '0 0 6px #f33' }}
        >
          {s.level + 1}
        </div>
      );
    });
  // a build stopped short of 50 can pick up where it left off
  const canContinue = build.endLevel !== undefined && steps.some((s) => s.level > end);

  /**
   * Origin / Alignment (and Continue Leveling for a build stopped short of 50) centered on cx;
   * the popout drops from the Origin / Alignment button with the New Build screen's pane at
   * three-quarter scale.
   */
  const topButtons = (cx: number, cy: number, w: number, h: number) => {
    const oaX = canContinue ? cx - w / 2 - 8 : cx;
    const PW = 470; // the pane at full size, drawn at POP scale
    const PH = ORIGIN_PANE_H;
    const POP = 0.75;
    return (
      <>
        <InfoButton skin={skin} x={oaX} y={cy} w={w} h={h} text="Origin / Alignment" onClick={() => setOaOpen(!oaOpen)} />
        {canContinue ? <InfoButton skin={skin} x={cx + w / 2 + 8} y={cy} w={w} h={h} text="Continue Leveling" onClick={continueLeveling} /> : null}
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
                  onOrigin={(id) => setBuild({ ...build, origin: id })}
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
      onClose={() => setPicker(null)}
      onPlace={(enh) => {
        play(enh ? 'select5' : 'delete');
        setBuild(setEnh(build, picker.entry.key, picker.slot, enh, picker.entry.level));
        setPicker(null);
      }}
    />
  ) : null;

  if (phone) {
    const P = PHONE_PANEL;
    const ph = P.h - 150;
    return (
      <>
        <TitleBar skin={skin} text={build.name ? build.name.toUpperCase() : 'BUILD OVERVIEW'} />
        <GameText font="title_14" scale={S} x={980} y={118} align="right" colors={skin.heading} text={who} />
        <PhoneTabs skin={skin} labels={['Primary', 'Secondary', 'Pools', 'Totals']} active={tab} onChange={setTab} />
        <MenuFrame x={P.x} y={P.y} w={P.w} h={ph} skin={skin} />
        {tab < 3 ? (
          renderPanel({ left: P.x + 2, top: P.y + 6, width: P.w - 4, height: ph - 12 }, { x: P.x + P.w, top: P.y + 18, height: ph - 36 }, geom(P.w - 4, S), groups(COLS[tab]!.column), tab)
        ) : (
          <GameScroll skin={skin} left={P.x + 20} top={P.y + 18} width={P.w - 40} height={ph - 36} barX={P.x + P.w}>
            <TotalsPanel gd={gd} t={totals} width={P.w - 60} />
          </GameScroll>
        )}
        {levelStrip(30, P.y + P.h - 130, 25, 34)}
        {topButtons(500, P.y + P.h - 20, 300, 44)}
        <NextButton skin={skin} dir="left" text="New Build" onClick={toSetup} />
        <NextButton skin={skin} dir="right" text="Save / Share" onClick={() => setMenu(true)} />
        {picker_}
      </>
    );
  }

  return (
    <>
      <TitleBar skin={skin} text={build.name ? build.name.toUpperCase() : 'BUILD OVERVIEW'} />
      <GameText font="title_14" scale={S} x={vx(1010)} y={vy(38)} align="right" colors={skin.heading} text={who} />
      {topButtons(stage.w / 2, vy(22), vx(150), vy(26))}
      <MenuFrame x={32} y={58} w={1937} h={988} r25 outer skin={skin} />
      {/* level strip: reopen any level's in-game screen (levels after a stop are left off) */}
      {levelStrip(50, 92, 50, 34)}
      {COLS.map((c) => (
        <MenuFrame key={c.x} x={c.x} y={TOP} w={c.w} h={H} skin={skin} />
      ))}
      {COLS.map((c) => desktopPanel(c))}
      <MenuFrame x={1503} y={TOP} w={464} h={H} skin={skin} />
      <GameScroll skin={skin} left={1515} top={TOP + 18} width={444} height={H - 36} barX={1503 + 464}>
        <TotalsPanel gd={gd} t={totals} width={420} />
      </GameScroll>
      {tip && tipLevel === 'basic' ? <DescTip skin={skin} power={tip.entry.power} x={tip.x} y={tip.y} hint={hint} /> : null}
      {tip && tipLevel === 'advanced' ? (
        <SlotTip gd={gd} power={tip.entry.power} x={tip.x} y={tip.y} advanced={<AdvancedInfo gd={gd} at={gd.archetype(build.at)} entry={tip.entry} level={end} />} />
      ) : null}
      <NextButton skin={skin} dir="left" text="New Build" onClick={toSetup} />
      <NextButton skin={skin} dir="right" text="Save / Share" onClick={() => setMenu(true)} />
      {picker_}
    </>
  );
}
