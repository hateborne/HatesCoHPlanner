import { useLayoutEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import type { Power, Powerset } from '../../data/types.ts';
import { BuildRules, type BuildEntry } from '../../engine/rules.ts';
import { previewBuild, useStore } from '../../state/store.ts';
import { CheckBar } from '../components/CheckBar.tsx';
import { InfoButton, MenuFrame, NextButton, SetFrame, SlotRing, SlotsAvailable, TitleBar } from '../components/Chrome.tsx';
import { GameScroll } from '../components/GameScroll.tsx';
import { GameText } from '../components/GameText.tsx';
import { PHONE_PANEL, PhoneTabs } from '../components/Phone.tsx';
import { Sprite } from '../components/Sprite.tsx';
import { useStage } from '../components/Stage.tsx';
import { fitScale, FONTS, S, SY, textWidth, vs, vx, vy } from '../skin/metrics.ts';
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

/** The single phone panel: the same row structure scaled by S inside PHONE_PANEL. */
function phonePanel(): PanelGeom {
  const P = PHONE_PANEL;
  return {
    frame: P,
    view: { left: P.x + 2, top: P.y + 6, width: P.w - 4, height: P.h - 12 },
    bar: { x: P.x + P.w, top: P.y + 18, height: P.h - 36 },
    barCX: 70,
    barW: P.w - 150,
    ringX: 67,
    headCX: P.w / 2,
    boxW: P.w - 160,
    start: -20 * S,
    row: POWER_SPEC_HT * S,
    tail: 40,
    unit: S,
  };
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

/**
 * "ADD AN ENHANCEMENT SLOT" (uiLevelSpec.c specMenu): click owned powers to place this level's
 * slots; click a just-placed slot to take it back. Finish unlocks when every slot is placed.
 */
export function AddEnhancementSlot({ skin }: { skin: Skin }) {
  const { gd, steps, level, addPendingSlot, removePendingSlot, finishLevel, backLevel } = useStore();
  const [hover, setHover] = useState<BuildEntry | null>(null);
  const [msg, setMsg] = useState<{ key: string; text: string } | null>(null);
  const [tab, setTab] = useState(0);
  const { phone } = useStage();
  const step = level ? steps[level.step] : undefined;
  const preview = useMemo(() => (gd && level ? previewBuild(gd, steps, level) : null), [gd, steps, level]);
  const rules = useMemo(() => (gd && preview ? new BuildRules(gd, preview) : null), [gd, preview]);
  if (!gd || !level || !step || !rules) return null;
  const L = step.level;
  const entries = rules.entries().filter((e) => e.level <= L && rules.slottable(e.power) && e.power.sm !== 0);
  const remaining = rules.slotsGranted(L) - rules.slotsUsed(L);
  const anyPlaceable = entries.some((e) => rules.slotBlock(e, L) === null);

  const click = (e: BuildEntry) => {
    const block = rules.slotBlock(e, L);
    if (block) {
      play('reject5');
      setMsg({ key: e.key, text: block });
      window.setTimeout(() => setMsg(null), 1400);
      return;
    }
    addPendingSlot(e.key); // CheckBar already played powerselect2
  };
  const unclick = (key: string) => {
    play('delete');
    const idx = level.pendingSlots.lastIndexOf(key);
    if (idx >= 0) removePendingSlot(idx);
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
            skin={skin}
            x={g.barCX}
            y={y}
            wd={g.barW}
            halfText
            text={e.power.dn}
            state="standard"
            icon={icon('powers', e.power.icon || 'power_missing')}
            onClick={() => click(e)}
            onHover={(on) => (on ? setHover(e) : undefined)}
          />,
        );
        // pending slots sit next to the bar (positions 1..k); the owned ones slide right by k
        const pending = e.slots.filter((s, i) => i > 0 && s.level === L).length;
        const owned = e.slots.slice(0, e.slots.length - pending);
        for (let k = 0; k < pending; k++) {
          items.push(<SlotRing skin={skin} key={`${e.key}:n${k}`} x={g.ringX + (k + 1) * SPEC_WD * S} y={y + 20 * S} size={RING} pending title="Click to remove this slot" onClick={() => unclick(e.key)} />);
        }
        owned.forEach((s, i) => {
          const boost = s.enh ? gd.powerById.get(s.enh.boost) : undefined;
          items.push(
            <SlotRing
              skin={skin}
              key={`${e.key}:${i}`}
              x={g.ringX + (pending + i + 1) * SPEC_WD * S}
              y={y + 20 * S}
              size={RING}
              enhIcon={boost ? icon('enh', boost.icon) : undefined}
              frames={boost?.bf}
              title={`Slot gained at level ${s.level + 1}`}
            />,
          );
        });
        if (msg?.key === e.key) {
          items.push(<GameText key={`${e.key}:msg`} font="game_12" scale={1.5 * S} x={g.barCX + g.barW / 2} y={y + 15 * u} align="center" colors={['#ff0000', '#ff0000']} text={msg.text} z={20} />);
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

  const hovered = hover?.power;
  const hoveredSet = hovered ? gd.setOfPower.get(hovered.id)?.set : undefined;
  if (phone) {
    const g = phonePanel();
    return (
      <>
        <TitleBar skin={skin} text="ADD AN ENHANCEMENT SLOT" />
        <GameText font="title_14" scale={S} x={980} y={118} align="right" colors={skin.heading} text={`LEVEL ${L + 1}`} />
        <PhoneTabs skin={skin} labels={['Primary', 'Secondary', 'Pool Powers']} active={tab} onChange={setTab} />
        <MenuFrame x={g.frame.x} y={g.frame.y} w={g.frame.w} h={g.frame.h} skin={skin} />
        {renderPanel(g, groups(rules, entries, tab), 0)}
        <SlotsAvailable n={remaining} x={300} y={1465} w={400} h={56} />
        {hovered ? (
          <div className="abs body-text" style={{ left: 40, top: 1545, width: 920, color: '#7fd3ff', fontSize: 24 }}>
            {hovered.dn}: {hovered.sh}
          </div>
        ) : null}
        <NextButton skin={skin} dir="left" text={level.mode === 'edit' ? 'Cancel' : 'Back'} onClick={backLevel} />
        <NextButton skin={skin} dir="right" text="Finish" locked={remaining > 0 && anyPlaceable} onClick={finishLevel} />
      </>
    );
  }
  const headW = textWidth(FONTS.gamebold_18, FONTS.gamebold_18.size * S, 'POOL POWERS');
  const headX = vx(1024 - FRAME_WIDTH / 2 - FRAME_SPACE);
  const headY = vy(SL_FRAME_TOP - 20);
  const dot = ui(`creation/enhancements/enhnctray_powertitle_dot`, skin);
  return (
    <>
      <TitleBar skin={skin} text="ADD AN ENHANCEMENT SLOT" />
      {/* planner extra (not drawn by specMenu): which level these slots belong to */}
      <GameText font="title_14" scale={S} x={vx(1010)} y={vy(38)} align="right" colors={skin.heading} text={`LEVEL ${L + 1}`} />
      {[0, 1, 2].map((i) => {
        const f = desktopPanel(i).frame;
        return <MenuFrame key={i} x={f.x} y={f.y} w={f.w} h={f.h} skin={skin} />;
      })}
      <InfoButton skin={skin} x={vx(FRAME_SPACE + FRAME_WIDTH / 2)} y={vy(SL_FRAME_TOP - 22)} text="Show Detailed Info Here" />
      <InfoButton skin={skin} x={vx(512)} y={vy(SL_FRAME_TOP - 22)} text="Show Detailed Info Here" />
      {/* drawMenuHeader: gamebold_18 white -> 88b6ff centered on (848, 72), a dot 5s outside each end */}
      <GameText font="gamebold_18" scale={S} x={headX} y={headY} centerY align="center" colors={['#ffffff', skin.poolHeader]} text="POOL POWERS" />
      <Sprite src={dot} x={headX - (headW / 2 + 15 * S)} y={headY - 5 * S} w={10 * S} h={10 * S} />
      <Sprite src={dot} x={headX + headW / 2 + 5 * S} y={headY - 5 * S} w={10 * S} h={10 * S} />
      {[0, 1, 2].map((i) => renderPanel(desktopPanel(i), groups(rules, entries, i), i))}
      <PowInfoBox power={hovered} set={hoveredSet} />
      <SlotsAvailable n={remaining} />
      <NextButton skin={skin} dir="left" text={level.mode === 'edit' ? 'Cancel' : 'Back'} onClick={backLevel} />
      <NextButton skin={skin} dir="right" text="Finish" locked={remaining > 0 && anyPlaceable} onClick={finishLevel} />
    </>
  );
}
