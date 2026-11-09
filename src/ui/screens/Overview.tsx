import { useMemo, useState, type ReactElement } from 'react';
import { setEnh, setOn } from '../../engine/actions.ts';
import { BuildRules, type BuildEntry } from '../../engine/rules.ts';
import { computeTotals, defaultOn } from '../../engine/totals.ts';
import { useStore } from '../../state/store.ts';
import { CheckBar } from '../components/CheckBar.tsx';
import { MenuFrame, NextButton, SetTitle, SlotRing, TitleBar } from '../components/Chrome.tsx';
import { GameScroll } from '../components/GameScroll.tsx';
import { GameText } from '../components/GameText.tsx';
import { S, vx, vy } from '../skin/metrics.ts';
import { PHONE_PANEL, PhoneTabs } from '../components/Phone.tsx';
import { useStage } from '../components/Stage.tsx';
import { TotalsPanel } from '../components/TotalsPanel.tsx';
import { icon, type Skin } from '../skin/skin.ts';
import { play } from '../sound.ts';
import { EnhancementPicker } from './EnhancementPicker.tsx';

const COLS = [
  { x: 33, w: 480, kinds: ['primary'] },
  { x: 523, w: 480, kinds: ['secondary'] },
  { x: 1013, w: 480, kinds: ['branch', 'pool', 'epic', 'inherent', 'other'] },
];
const TOP = 170;
const H = 875;
const ROW = 88;
const RING = 42;
const RING_STEP = 54;

/**
 * Build overview (provisional layout until the in-game Enhancement Management reference is in):
 * a level strip that reopens any level's in-game screen, every power with its slot rings
 * (click a ring to pick an enhancement), a totals switch per power, issue flags, and totals.
 */
export function Overview({ skin }: { skin: Skin }) {
  const { gd, build, steps, editPick, editSlots, toSetup, setBuild, setMenu } = useStore();
  const [picker, setPicker] = useState<{ entry: BuildEntry; slot: number } | null>(null);
  const [tab, setTab] = useState(0);
  const { phone } = useStage();
  const rules = useMemo(() => (gd && build ? new BuildRules(gd, build) : null), [gd, build]);
  const totals = useMemo(() => (gd && build && rules ? computeTotals(gd, rules, build) : null), [gd, build, rules]);
  const issues = useMemo(() => (rules ? rules.issues() : []), [rules]);
  if (!gd || !build || !rules || !totals) return null;
  const entries = rules.entries().filter((e) => e.power.sm !== 0 && (rules.slottable(e.power) || e.source === 'pick'));
  const originIndex = gd.core.origins.findIndex((o) => o.id === build.origin);

  const column = (col: { x: number; w: number; kinds: string[] }, top = TOP, height = H) => {
    const items: ReactElement[] = [];
    let y = 0;
    let lastSet = -1;
    for (const e of entries) {
      const ref = gd.setOfPower.get(e.power.id);
      const kind = ref ? rules.setKind(ref.set) : 'other';
      if (!col.kinds.includes(kind)) continue;
      if (ref && ref.set.id !== lastSet) {
        items.push(
          <SetTitle skin={skin} key={`s${ref.set.id}`} x={16} y={y + 6} text={ref.set.dn.toUpperCase()} size={22} />,
        );
        y += 44;
        lastSet = ref.set.id;
      }
      const py = y + 24;
      const on = e.on ?? defaultOn(e.power);
      const toggleable = e.power.type === 'Toggle' || e.power.type === 'Auto' || e.power.type === 'Click';
      const flagged = issues.filter((i) => i.key === e.key);
      items.push(
        <CheckBar
          key={e.key}
          skin={skin}
          x={64}
          y={py}
          wd={col.w - 150}
          scale={0.95}
          text={`${e.level + 1}  ${e.power.dn}`}
          state={flagged.length ? 'unselectable' : 'selected'}
          icon={icon('powers', e.power.icon || 'power_missing')}
          title={flagged.map((f) => f.message).join('\n') || (e.pickIndex !== undefined ? 'Click to change this pick' : undefined)}
          onClick={e.pickIndex !== undefined ? () => editPick(e.pickIndex!) : undefined}
        />,
      );
      if (toggleable) {
        items.push(
          <div
            key={`${e.key}:on`}
            className="abs"
            title={on ? 'Counted in totals (click to exclude)' : 'Not counted in totals (click to include)'}
            onClick={() => setBuild(setOn(build, e.key, !on === defaultOn(e.power) ? undefined : !on))}
            style={{ left: col.w - 70, top: py - 15, width: 30, height: 30, borderRadius: 15, cursor: 'pointer', border: '2px solid #4f94ff', background: on ? 'radial-gradient(#7fff7f, #00a020)' : '#111', boxShadow: on ? '0 0 8px #3f3' : 'none' }}
          />,
        );
      }
      if (flagged.length) {
        items.push(
          <div key={`${e.key}:issue`} className="abs body-text" style={{ left: 100, top: py + 14, fontSize: 13, color: '#ff6060', whiteSpace: 'nowrap' }}>
            {flagged[0]!.message}
          </div>,
        );
      }
      e.slots.forEach((s, i) => {
        const boost = s.enh ? gd.powerById.get(s.enh.boost) : undefined;
        items.push(
          <SlotRing
            skin={skin}
            key={`${e.key}:${i}`}
            x={110 + i * RING_STEP}
            y={py + 38}
            size={RING}
            enhIcon={boost ? icon('enh', boost.icon) : undefined}
            frames={boost?.bf}
            title={boost ? `${boost.dn} (slot from level ${s.level + 1})` : `Empty slot (level ${s.level + 1})`}
            onClick={() => setPicker({ entry: e, slot: i })}
          />,
        );
      });
      y += e.slots.length ? ROW : 58;
    }
    return (
      <GameScroll key={col.x} skin={skin} left={col.x + 2} top={top + 18} width={col.w - 4} height={height - 36} barX={col.x + col.w}>
        <div style={{ position: 'relative', height: y + 30 }}>{items}</div>
      </GameScroll>
    );
  };

  const levelStrip = (x0: number, y0: number, perRow: number, size: number) =>
    steps.map((s, i) => {
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
    return (
      <>
        <TitleBar skin={skin} text={build.name ? build.name.toUpperCase() : 'BUILD OVERVIEW'} />
        <GameText font="title_14" scale={S} x={980} y={118} align="right" colors={skin.heading} text={gd.archetype(build.at).dn.toUpperCase()} />
        <PhoneTabs skin={skin} labels={['Primary', 'Secondary', 'Pools', 'Totals']} active={tab} onChange={setTab} />
        <MenuFrame x={P.x} y={P.y} w={P.w} h={P.h - 150} skin={skin} />
        {tab < 3 ? (
          column({ x: P.x, w: P.w, kinds: COLS[tab]!.kinds }, P.y, P.h - 150)
        ) : (
          <GameScroll skin={skin} left={P.x + 20} top={P.y + 18} width={P.w - 40} height={P.h - 186} barX={P.x + P.w}>
            <TotalsPanel gd={gd} t={totals} width={P.w - 60} />
          </GameScroll>
        )}
        {levelStrip(30, P.y + P.h - 130, 25, 34)}
        <NextButton skin={skin} dir="left" text="New Build" onClick={toSetup} />
        <NextButton skin={skin} dir="right" text="Save / Share" onClick={() => setMenu(true)} />
        {picker_}
      </>
    );
  }

  return (
    <>
      <TitleBar skin={skin} text={build.name ? build.name.toUpperCase() : 'BUILD OVERVIEW'} />
      <GameText font="title_14" scale={S} x={vx(1010)} y={vy(38)} align="right" colors={skin.heading} text={gd.archetype(build.at).dn.toUpperCase()} />
      <MenuFrame x={32} y={58} w={1937} h={988} r25 outer skin={skin} />
      {/* level strip: reopen any level's in-game screen */}
      {levelStrip(50, 92, 50, 34)}
      {COLS.map((c) => (
        <MenuFrame key={c.x} x={c.x} y={TOP} w={c.w} h={H} skin={skin} />
      ))}
      {COLS.map((c) => column(c))}
      <MenuFrame x={1503} y={TOP} w={464} h={H} skin={skin} />
      <GameScroll skin={skin} left={1515} top={TOP + 18} width={444} height={H - 36} barX={1503 + 464}>
        <TotalsPanel gd={gd} t={totals} width={420} />
      </GameScroll>
      <NextButton skin={skin} dir="left" text="New Build" onClick={toSetup} />
      <NextButton skin={skin} dir="right" text="Save / Share" onClick={() => setMenu(true)} />
      {picker_}
    </>
  );
}
