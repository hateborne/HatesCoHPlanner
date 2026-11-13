import { useLayoutEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { useShallow } from 'zustand/react/shallow';
import type { GameData } from '../../data/gamedata.ts';
import type { Power, Powerset } from '../../data/types.ts';
import type { Build } from '../../engine/build.ts';
import { boostPog, enhLevelLabel } from '../../engine/enhance.ts';
import { BuildRules, type BuildEntry } from '../../engine/rules.ts';
import { previewBuild, stepsOf, useStore, useTipLevel } from '../../state/store.ts';
import { stepSlotLevels } from '../../engine/schedule.ts';
import { useEscape } from '../escape.ts';
import { useFreshHover, useHover } from '../hover.ts';
import { SlotTip, usePointer, useShiftHint } from '../components/PowerTip.tsx';
import { PhoneTipLayer } from '../components/PhoneTip.tsx';
import { LockFlash } from '../components/LockFlash.tsx';
import { AdvancedInfo } from '../components/PowerInfoView.tsx';
import { CheckBar } from '../components/CheckBar.tsx';
import { ElectricFlash } from '../components/ElectricFlash.tsx';
import { FadingText, MenuFrame, NextButton, PHONE_LEVEL_SCALE, RespecCounter, SetFrame, SlotRing, SlotsAvailable, TitleBar } from '../components/Chrome.tsx';
import { GameScroll } from '../components/GameScroll.tsx';
import { GameText } from '../components/GameText.tsx';
import { PHONE_PAD, phoneGeom, phonePanel as phoneFrame, PhoneTabs, type PhoneGeom, type Rect } from '../components/Phone.tsx';
import { Sprite } from '../components/Sprite.tsx';
import { useStage } from '../components/Stage.tsx';
import { fitScale, FONTS, S, STAGE_W, SY, textWidth, TOP_LABEL_RIGHT, vs, vx, vy } from '../skin/metrics.ts';
import { icon, ui, type Skin } from '../skin/skin.ts';
import { play } from '../sound.ts';
import { smf } from '../smf.tsx';

// uiLevelSpec.c / uiCombineSpec.h (virtual units)
const FRAME_SPACE = 16;
const FRAME_WIDTH = 320;
const SL_FRAME_TOP = 92;
const FRAME_HEIGHT = 623;
const POOL_HEIGHT = 423;
const POWER_SPEC_HT = 65;
const POWER_OFFSET = 50;
const POWER_WIDTH = 240;
const SPEC_WD = 36;
const RING = vs(35); // EnhncTray_Ring (70x70) at scale .5
// phones: rings a finger can hit, and the rows spaced to hold them
const PHONE_RING = 56;
const PHONE_RING_STEP = 58;
const PHONE_ROW = 104;
// phones: the rings hang below the bar's center (so its name sits centered in the bar), not over it
const PHONE_RING_DY = 38;
// phones: the Slots Available row and the tapped power's line above Back / Next
const PHONE_COUNTER_H = 52;
const PHONE_INFO_H = 76;

/** A slot placed by a click on this visit to the level (uiLevelSpec.c enhancementAnim_add). */
interface NewSlot {
  ring: string; // its pending ring's key, `${entry key}:n${k}`
  at: number; // performance.now() of the click
}

interface Group {
  set: Powerset | null;
  title: string;
  entries: BuildEntry[];
}

/** Group owned, slottable entries by powerset for one panel (column 0 / 1 / 2, by category). */
function groups(rules: BuildRules, entries: BuildEntry[], column: number): Group[] {
  const by = new Map<number, Group>();
  for (const e of entries) {
    const ref = rules.gd.setOfPower.get(e.power.id);
    if ((ref ? rules.column(ref.set) : 2) !== column) continue;
    const id = ref?.set.id ?? -1;
    const g = by.get(id) ?? { set: ref?.set ?? null, title: ref?.set.dn ?? 'Other', entries: [] };
    g.entries.push(e);
    by.set(id, g);
  }
  return [...by.values()];
}

/** One power panel in stage px; y values are relative to the scroll viewport's top. */
interface PanelGeom {
  frame: { x: number; y: number; w: number; h: number };
  view: { left: number; top: number; width: number; height: number };
  bar: { x: number; top: number; height: number };
  barCX: number; // check-box center x, relative to view.left
  barW: number;
  ringX: number; // x of slot position 0 (the bar's x - 2), relative to view.left
  ring: number; // slot ring size
  ringStep: number; // slot ring spacing
  ringDy: number; // the rings' center below the bar's center
  headCX: number; // set heading center x, relative to view.left
  boxW: number; // inner set frame width
  start: number; // primY before the first set
  row: number; // POWER_SPEC_HT
  tail: number; // content height past the last primY (makes max scroll = doc - view)
  unit: number; // virtual-y to stage px for the in-row offsets
}

/** Desktop panel i (0 primary, 1 secondary, 2 pool), from specMenu's frames, clip boxes and scrollbars. */
function desktopPanel(i: number): PanelGeom {
  const fx = [FRAME_SPACE, 512 - FRAME_WIDTH / 2, 1024 - FRAME_WIDTH - FRAME_SPACE][i]!;
  const fh = i === 2 ? POOL_HEIGHT : FRAME_HEIGHT;
  const clipTop = SL_FRAME_TOP + 4;
  const clipH = i === 2 ? fh - 11 : fh - 9;
  const view = fh - 24; // doScrollBarEx view height (frame - 2*R12)
  const left = vx(fx) + 2;
  return {
    frame: { x: vx(fx), y: vy(SL_FRAME_TOP), w: vx(FRAME_WIDTH), h: vy(fh) },
    view: { left, top: vy(clipTop), width: vx(FRAME_WIDTH) - 4, height: vy(clipH) },
    bar: { x: vx([334, 674, 1010][i]!), top: vy(SL_FRAME_TOP + 12), height: vy(view) },
    barCX: vx(fx + POWER_OFFSET) - left,
    barW: vx(POWER_WIDTH),
    ringX: vx(fx + POWER_OFFSET - 2) - left,
    ring: RING,
    ringStep: SPEC_WD * S,
    ringDy: 20 * S,
    headCX: vx(fx + FRAME_WIDTH / 2) - left,
    boxW: vx(POWER_WIDTH - 10),
    start: vy(SL_FRAME_TOP + 50 - POWER_SPEC_HT - clipTop),
    row: vy(POWER_SPEC_HT),
    // doScrollBarEx doc = primY_end - 65 (absolute) and max offset = doc - view, so the content
    // (measured from clipTop) is primY_end + clipTop - 65 - view + clipH tall
    tail: vy(clipTop - POWER_SPEC_HT - view + clipH),
    unit: SY,
  };
}

/** The single phone panel: the same row structure scaled by S, with finger-sized rings. */
function phonePanel(pg: PhoneGeom): PanelGeom {
  const P = phoneFrame(pg, 3, PHONE_COUNTER_H + 8 + PHONE_INFO_H + 8);
  return {
    frame: P,
    view: { left: P.x + 2, top: P.y + 6, width: P.w - 4, height: P.h - 12 },
    bar: { x: P.x + P.w, top: P.y + 18, height: P.h - 36 },
    barCX: 54,
    barW: P.w - 96,
    ringX: 50, // the first ring just clear of the bar's icon, as on the desktop
    ring: PHONE_RING,
    ringStep: PHONE_RING_STEP,
    ringDy: PHONE_RING_DY,
    headCX: P.w / 2,
    boxW: P.w - 106,
    start: -10 * S,
    row: PHONE_ROW,
    tail: 50,
    unit: S,
  };
}

/** @return Phones: the Slots Available counter's box, right above Back / Next. */
function phoneCounter(pg: PhoneGeom): Rect {
  return { x: (pg.w - 290) / 2, y: pg.navTop - 8 - PHONE_COUNTER_H, w: 290, h: PHONE_COUNTER_H };
}

/**
 * info_PowManagement(kPowInfo_SpecLevel) (uiInfo.c:2185): an opaque R12 frame 334x193 centered on
 * (850, 617); the power name in title_14 at scale 1 (not screen-scaled, as the client does) right
 * of an 80-wide icon column; short help (game_14, aadeff) at ty + 30, then the set name (099cde)
 * at ty + 30 + the short help's pixel height; the icon centered in the header.
 */
function PowInfoBox({ power, set }: { power?: Power; set?: Powerset }) {
  const ref = useRef<HTMLDivElement>(null);
  const [h1, setH1] = useState(0);
  // measured after every render on purpose (the help text changes size); it settles once h1 matches
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    const h = ref.current?.offsetHeight ?? 0;
    if (h !== h1) setH1(h);
  });
  const wd = 330;
  const ht = 90 + 2 * 14 + 75;
  const tx = 850 - wd / 2;
  const ty = 617 - ht / 2;
  const width = wd - (2 * 3 + 10 + 80);
  const px = 14 * S;
  const textStyle = { fontFamily: "'Montreal'", fontSize: px, lineHeight: `${Math.round(1.255 * px)}px` };
  const name = power?.dn.toUpperCase() ?? '';
  const nameSc = Math.min(1, fitScale(FONTS.title_14, name, vx(width)));
  const headerHt = Math.max(75, 30 + h1 + Math.round(1.255 * px) + 5);
  return (
    <>
      <MenuFrame x={vx(tx - 4)} y={vy(ty)} w={vx(wd + 4)} h={vy(ht)} style={{ background: '#000' }} />
      {power ? (
        <>
          <GameText font="title_14" scale={nameSc} x={vx(tx) + 80 * S} y={vy(ty) + 28 * S} colors={['#ffffff', '#ffffff']} text={name} />
          <div ref={ref} className="abs" style={{ ...textStyle, left: vx(tx) + 80 * S, top: vy(ty + 30), width: vx(width), color: '#aadeff' }}>
            {smf(power.sh)}
          </div>
          <div className="abs" style={{ ...textStyle, left: vx(tx) + 80 * S, top: vy(ty + 30) + h1 * SY, width: vx(width), color: '#099cde' }}>
            {set?.dn}
          </div>
          <Sprite src={icon('powers', power.icon || 'power_missing')} x={vx(tx) + 24 * S} y={vy(ty) + ((headerHt - 32) * S) / 2} w={32 * S} h={32 * S} />
        </>
      ) : null}
    </>
  );
}

/** The last hovered power's info box (desktop) or its name and short help over the counter (phone). */
function HoveredInfo({ gd, phone }: { gd: GameData; phone?: PhoneGeom }) {
  const hovered = useHover((h) => h.desc?.p);
  if (phone) {
    const c = phoneCounter(phone);
    return hovered ? (
      <div className="abs body-text scroll-y" style={{ left: PHONE_PAD, top: c.y - 8 - PHONE_INFO_H, width: phone.w - 2 * PHONE_PAD, height: PHONE_INFO_H, color: '#7fd3ff', fontSize: 18, lineHeight: 1.25 }}>
        {hovered.dn}: {hovered.sh}
      </div>
    ) : null;
  }
  return <PowInfoBox power={hovered} set={hovered ? gd.setOfPower.get(hovered.id)?.set : undefined} />;
}

/** The slot-details / Advanced tooltip for the power bar under the pointer. */
function SlotTipLayer({ gd, atId, level }: { gd: GameData; atId: number; level: number }) {
  const tip = useHover((h) => h.tip);
  const tipLevel = useTipLevel();
  const hint = useShiftHint();
  if (!tip || tipLevel === 'off') return null;
  return (
    <SlotTip
      gd={gd}
      power={tip.entry.power}
      x={tip.x}
      y={tip.y}
      avoid={tip.at}
      hint={tipLevel === 'basic' && hint}
      advanced={tipLevel === 'advanced' ? <AdvancedInfo gd={gd} at={gd.archetype(atId)} entry={tip.entry} level={level} /> : undefined}
    />
  );
}

/**
 * "ADD AN ENHANCEMENT SLOT" (uiLevelSpec.c specMenu): click owned powers to place this level's
 * slots; click a just-placed slot to take it back. Finish unlocks when every slot is placed.
 */
export function AddEnhancementSlot({ skin }: { skin: Skin }) {
  const { gd, steps, level, addPendingSlot, removePendingSlot, finishLevel, backLevel, lockFlash, flashLocked } = useStore(
    useShallow((s) => ({ gd: s.gd, steps: s.steps, level: s.level, addPendingSlot: s.addPendingSlot, removePendingSlot: s.removePendingSlot, finishLevel: s.finishLevel, backLevel: s.backLevel, lockFlash: s.lockFlash, flashLocked: s.flashLocked })),
  );
  useEscape(backLevel, level?.mode === 'edit'); // Escape cancels a level reopened from the overview
  useFreshHover(); // hover lives in useHover: hovering a bar redraws only the info box and tooltip
  // fadingText queue: "No slots to assign!" at the bottom, "FULL!" over the clicked bar
  const [fades, setFades] = useState<{ id: number; key?: string; full: boolean }[]>([]);
  const fadeId = useRef(0);
  // slots clicked in on this visit to the level (a new level.base starts a new visit): they grow
  // in under the electric crackle; once a slot is clicked in or out, the slots slide
  const [visit, setVisit] = useState<{ base: Build; added: NewSlot[] } | null>(null);
  const [tab, setTab] = useState(0);
  const stage = useStage();
  const { phone } = stage;
  const pg = phoneGeom(stage);
  // hover tooltip: the game's slot details, or the Advanced view (setting or Shift)
  const mouse = usePointer();
  const flow = level ? stepsOf(steps, level) : steps;
  const step = level ? flow[level.step] : undefined;
  const preview = useMemo(() => (gd && level ? previewBuild(gd, steps, level) : null), [gd, steps, level]);
  const rules = useMemo(() => (gd && preview ? new BuildRules(gd, preview) : null), [gd, preview]);
  if (!gd || !level || !step || !rules) return null;
  const L = step.level;
  // enhancements are the finished build's: their level numbers read as on the build screen
  const buildEnd = preview!.endLevel ?? 49;
  const levels = stepSlotLevels(step); // a respec screen places the slots of several levels
  // a respec (uiReSpec.c respec_assignment) draws every power, greying the ones bought later
  const respec = !!level.flow;
  const later = (e: BuildEntry) => e.level > L;
  // a respec's slot level reopened from the overview: its slots may still go on any power
  const anyPower = respec || rules.slotsAnyPower(L);
  const entries = rules.entries().filter((e) => (anyPower || !later(e)) && rules.slottable(e.power) && e.power.sm !== 0);
  const remaining = rules.slotsLeft(levels);
  const visiting = visit?.base === level.base;
  const added = visiting ? visit.added : [];
  const pendingOf = (key: string) => level.pendingSlots.filter((k) => k === key).length;
  const anyPlaceable = entries.some((e) => rules.slotBlock(e, L, levels) === null);

  const click = (e: BuildEntry) => {
    // specLevel's order: no slots left beats a full power
    const noSlots = remaining <= 0;
    const block = noSlots ? 'No Slots' : rules.slotBlock(e, L, levels);
    if (block) {
      // drawPowerAndEnhancements: fadingText only, no sound (powerselect2 is for a placed slot)
      const id = ++fadeId.current;
      setFades((f) => [...f, { id, key: e.key, full: block !== 'No Slots' }]);
      window.setTimeout(() => setFades((f) => f.filter((x) => x.id !== id)), 1000);
      return;
    }
    // enhancementAnim_add, electric_init on the new ring, then sndPlay("powerselect2")
    const slot = { ring: `${e.key}:n${pendingOf(e.key)}`, at: performance.now() };
    setVisit((v) => ({ base: level.base, added: [...(v?.base === level.base ? v.added : []), slot] }));
    addPendingSlot(e.key);
    play('powerselect2');
  };
  const noSlotFades = fades
    .filter((f) => !f.full)
    .map((f) =>
      phone ? (
        <FadingText key={f.id} x={pg.w / 2} y={phoneCounter(pg).y + PHONE_COUNTER_H / 2} base={1.5} maxWidth={pg.w - 20} color="#ffffff" text="No slots to assign!" />
      ) : (
        <FadingText key={f.id} x={vx(512)} y={vy(SL_FRAME_TOP + FRAME_HEIGHT - 5)} base={1.5} color="#ffffff" text="No slots to assign!" />
      ),
    );
  const unclick = (key: string) => {
    const idx = level.pendingSlots.lastIndexOf(key);
    if (idx < 0) {
      // nothing movable here: say why when the power's slots at this level hold enhancements
      if (rules.entries().some((x) => x.key === key && x.slots.some((s, i) => i > 0 && levels.includes(s.level) && s.enh))) flashLocked(key);
      return;
    }
    // the client plays nothing here; electric_removeById drops the newest slot's crackle
    const ring = `${key}:n${pendingOf(key) - 1}`;
    setVisit((v) => ({ base: level.base, added: v?.base === level.base ? v.added.filter((a) => a.ring !== ring) : [] }));
    removePendingSlot(idx);
  };

  const renderPanel = (g: PanelGeom, list: Group[], key: number) => {
    const items: ReactElement[] = [];
    const u = g.unit;
    let primY = g.start;
    for (const grp of list) {
      primY += g.row;
      const top = primY;
      const boxAt = items.length; // the set frame goes in behind this set's heading and bars
      items.push(<GameText key={`h${grp.set?.id ?? 'x'}`} font="title_12" scale={S} x={g.headCX} y={top - 23 * u} align="center" colors={skin.heading} text={grp.title} />);
      for (const e of grp.entries) {
        const y = primY;
        items.push(
          <CheckBar
            key={e.key}
            testId={`slotbar:${e.key}`}
            skin={skin}
            x={g.barCX}
            y={y}
            wd={g.barW}
            halfText={!phone}
            clickSounds={[]}
            text={lockFlash?.key === e.key ? lockFlash.label : e.power.dn}
            state={respec && later(e) ? 'unselectable' : 'standard'}
            icon={icon('powers', e.power.icon || 'power_missing')}
            onClick={respec && later(e) ? undefined : () => click(e)}
            onRightClick={respec && later(e) ? undefined : () => unclick(e.key)}
            onLongPress={phone ? (pt) => useHover.setState({ press: { kind: 'power', entry: e, notes: [], ...pt } }) : undefined}
            onHover={(on, at) => {
              // the info box keeps the last hovered power; the tooltip only while over the bar
              if (on) useHover.setState({ desc: { p: e.power }, tip: phone ? null : { entry: e, x: mouse.current.x, y: mouse.current.y, at } });
              else useHover.setState((h) => (h.tip?.entry.key === e.key ? { tip: null } : h));
            }}
          />,
        );
        if (lockFlash?.key === e.key) items.push(<LockFlash key={`${e.key}:flash-${lockFlash.id}`} flashKey={e.key} x={g.barCX} y={y} w={g.barW} s={S} />);
        // pending slots sit next to the bar (positions 1..k); the owned ones slide right by k. Only
        // this level's empty slots are pending -- ones holding an enhancement stay locked
        const pending = pendingOf(e.key);
        let skip = pending;
        const owned = e.slots.filter((s, i) => {
          const isPending = skip > 0 && i > 0 && levels.includes(s.level) && !s.enh;
          if (isPending) skip--;
          return !isPending;
        });
        for (let k = 0; k < pending; k++) {
          const ring = `${e.key}:n${k}`;
          const born = added.find((a) => a.ring === ring)?.at;
          const rx = g.ringX + (k + 1) * g.ringStep;
          items.push(<SlotRing skin={skin} key={ring} x={rx} y={y + g.ringDy} size={g.ring} pending born={born} title="Click or right-click to remove this slot" onClick={() => unclick(e.key)} onRightClick={() => unclick(e.key)} />);
          // drawPowerAndEnhancements: electric_init on the new ring's center, inside the panel's clip
          if (born !== undefined) items.push(<ElectricFlash key={`${ring}:fx${born}`} x={rx} y={y + g.ringDy} ring={g.ring} born={born} skin={skin} />);
        }
        owned.forEach((s, i) => {
          const boost = s.enh ? gd.powerById.get(s.enh.boost) : undefined;
          items.push(
            <SlotRing
              skin={skin}
              key={`${e.key}:${i}`}
              x={g.ringX + (pending + i + 1) * g.ringStep}
              y={y + g.ringDy}
              size={g.ring}
              slide={visiting}
              enhIcon={boost ? icon('enh', boost.icon) : undefined}
              frames={boost?.bf}
              pog={boost ? boostPog(gd, boost) : undefined}
              level={boost && s.enh ? enhLevelLabel(gd, boost, s.enh, buildEnd) : undefined}
              levelScale={phone ? PHONE_LEVEL_SCALE : undefined}
              title={boost && levels.includes(s.level) ? 'Holds an enhancement: remove it on the build screen to move this slot' : `Slot gained at level ${s.level + 1}`}
              onClick={boost && levels.includes(s.level) ? () => flashLocked(e.key) : undefined}
              onRightClick={boost && levels.includes(s.level) ? () => flashLocked(e.key) : undefined}
            />,
          );
        });
        for (const f of fades) {
          if (f.full && f.key === e.key) items.push(<FadingText key={`full${f.id}`} x={g.barCX + g.barW / 2} y={y + 15 * u} base={1.5} maxWidth={phone ? pg.w - 40 : undefined} color="#ff0000" text="FULL!" />);
        }
        primY += g.row;
      }
      // drawFrame(PIX2, R6) around the set: (bar x, top - 30), (POWER_WIDTH - 10) x (primY - top - 35)
      items.splice(
        boxAt,
        0,
        <SetFrame key={`b${grp.set?.id ?? 'x'}`} skin={skin} x={g.barCX} y={top - 30 * u} w={g.boxW} h={primY - top - 35 * u} />,
      );
    }
    return (
      <GameScroll key={key} skin={skin} left={g.view.left} top={g.view.top} width={g.view.width} height={g.view.height} barX={g.bar.x} barTop={g.bar.top} barHeight={g.bar.height}>
        <div style={{ position: 'relative', height: Math.max(0, Math.ceil(primY + g.tail)) }}>{items}</div>
      </GameScroll>
    );
  };

  const title = respec ? 'CHOOSE ALL ENHANCEMENT SLOTS:' : 'ADD AN ENHANCEMENT SLOT';
  /**
   * A panel's sets. The respec screen lists the third panel in the order the character got the
   * sets (ppPowerSets): the inherent sets from character creation first, then pools as picked
   * (checked in game: Inherent, Inherent Fitness, ..., Leadership, Psionic Mastery).
   */
  const panelGroups = (column: number) => {
    const list = groups(rules, entries, column);
    if (!respec || column !== 2) return list;
    const rank = (g: Group) => (g.set?.n === 'Inherent.Inherent' ? 0 : g.set?.n.startsWith('Inherent.') ? 1 : 2);
    // within a set, powers in the set's own order (granted in that order)
    const inSet = (g: Group, e: BuildEntry) => g.set?.p.indexOf(e.power.id) ?? 0;
    return [...list].sort((a, b) => rank(a) - rank(b)).map((g) => ({ ...g, entries: [...g.entries].sort((a, b) => inSet(g, a) - inSet(g, b)) }));
  };
  // Homecoming's respec slot screen: one line, "Slots Available: N" until every slot is placed
  const counter = (box?: { x: number; y: number; w: number; h: number }) =>
    respec ? (
      <RespecCounter done={remaining <= 0} lines={[remaining > 0 ? `Slots Available: ${remaining}` : "Click 'Next' to Continue"]} {...box} />
    ) : (
      <SlotsAvailable n={remaining} {...box} />
    );
  const finishText = respec && level.mode === 'wizard' ? 'Next' : 'Finish';
  // which level the slots belong to: a planner extra on the slot screen; in a respec the game's own
  // line, drawn unscaled at screen pixel (1000, 30) (uiReSpec.c prnt(1000, 30, ...)), so on the
  // 3840 x 2160 reference it is small text just above the title bar
  const levelLine = (x: number, y: number) =>
    respec && phone ? (
      <GameText font="title_12" scale={S} x={x} y={y} align="right" colors={['#ffffff', '#c0c0c0']} text={`Current Respec Level: ${L}`} />
    ) : respec ? (
      <GameText font="title_12" scale={STAGE_W / 3840} x={(1000 * STAGE_W) / 3840} y={(30 * STAGE_W) / 3840} colors={['#ffffff', '#c0c0c0']} text={`Current Respec Level: ${L}`} />
    ) : (
      <GameText font="title_14" scale={S} x={x} y={y} align="right" colors={skin.heading} text={`LEVEL ${L + 1}`} />
    );

  if (phone) {
    const g = phonePanel(pg);
    return (
      <>
        <TitleBar skin={skin} text={title} />
        {levelLine(pg.w - 12, pg.labelY)}
        <PhoneTabs skin={skin} labels={['Primary', 'Secondary', 'Pools']} active={tab} onChange={setTab} />
        <MenuFrame x={g.frame.x} y={g.frame.y} w={g.frame.w} h={g.frame.h} skin={skin} />
        {renderPanel(g, panelGroups(tab), 0)}
        {counter(phoneCounter(pg))}
        {noSlotFades}
        <HoveredInfo gd={gd} phone={pg} />
        <PhoneTipLayer gd={gd} skin={skin} at={gd.archetype(preview!.at)} level={L} />
        <NextButton skin={skin} dir="left" text={level.mode === 'edit' ? 'Cancel' : 'Back'} onClick={backLevel} />
        <NextButton skin={skin} dir="right" text={finishText} locked={remaining > 0 && anyPlaceable} onClick={finishLevel} />
      </>
    );
  }
  const headW = textWidth(FONTS.gamebold_18, FONTS.gamebold_18.size * S, 'POOL POWERS');
  const headX = vx(1024 - FRAME_WIDTH / 2 - FRAME_SPACE);
  const headY = vy(SL_FRAME_TOP - 20);
  const dot = ui(`creation/enhancements/enhnctray_powertitle_dot`, skin);
  return (
    <>
      <TitleBar skin={skin} text={title} />
      {levelLine(TOP_LABEL_RIGHT, vy(38))}
      {[0, 1, 2].map((i) => {
        const f = desktopPanel(i).frame;
        return <MenuFrame key={i} x={f.x} y={f.y} w={f.w} h={f.h} skin={skin} />;
      })}
      {/* drawMenuHeader: gamebold_18 white -> 88b6ff centered on (848, 72), a dot 5s outside each end */}
      {/* the respec screen (uiReSpec.c respec_assignment) draws no POOL POWERS header */}
      {respec ? null : (
        <>
          <GameText font="gamebold_18" scale={S} x={headX} y={headY} centerY align="center" colors={['#ffffff', skin.poolHeader]} text="POOL POWERS" />
          <Sprite src={dot} x={headX - (headW / 2 + 15 * S)} y={headY - 5 * S} w={10 * S} h={10 * S} />
          <Sprite src={dot} x={headX + headW / 2 + 5 * S} y={headY - 5 * S} w={10 * S} h={10 * S} />
        </>
      )}
      {[0, 1, 2].map((i) => renderPanel(desktopPanel(i), panelGroups(i), i))}
      <HoveredInfo gd={gd} />
      <SlotTipLayer gd={gd} atId={preview!.at} level={L} />
      {counter()}
      {noSlotFades}
      <NextButton skin={skin} dir="left" text={level.mode === 'edit' ? 'Cancel' : 'Back'} onClick={backLevel} />
      <NextButton skin={skin} dir="right" text={finishText} locked={remaining > 0 && anyPlaceable} onClick={finishLevel} />
    </>
  );
}
