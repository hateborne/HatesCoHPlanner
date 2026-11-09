import { useMemo, useState, type ReactElement } from 'react';
import { setEnh, setOn } from '../../engine/actions.ts';
import { BuildRules, type BuildEntry } from '../../engine/rules.ts';
import { computeTotals, defaultOn } from '../../engine/totals.ts';
import { useStore } from '../../state/store.ts';
import { CheckBar } from '../components/CheckBar.tsx';
import { MenuFrame, NextButton, SlotRing, TitleBar } from '../components/Chrome.tsx';
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
  const rules = useMemo(() => (gd && build ? new BuildRules(gd, build) : null), [gd, build]);
  const totals = useMemo(() => (gd && build && rules ? computeTotals(gd, rules, build) : null), [gd, build, rules]);
  const issues = useMemo(() => (rules ? rules.issues() : []), [rules]);
  if (!gd || !build || !rules || !totals) return null;
  const entries = rules.entries().filter((e) => e.power.sm !== 0 && (rules.slottable(e.power) || e.source === 'pick'));
  const originIndex = gd.core.origins.findIndex((o) => o.id === build.origin);

  const column = (col: (typeof COLS)[number]) => {
    const items: ReactElement[] = [];
    let y = 0;
    let lastSet = -1;
    for (const e of entries) {
      const ref = gd.setOfPower.get(e.power.id);
      const kind = ref ? rules.setKind(ref.set) : 'other';
      if (!col.kinds.includes(kind)) continue;
      if (ref && ref.set.id !== lastSet) {
        items.push(
          <div key={`s${ref.set.id}`} className="title-text abs" style={{ left: 16, top: y + 6, fontSize: 22, textTransform: 'uppercase' }}>
            {ref.set.dn}
          </div>,
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
      <div key={col.x} className="abs scroll-y" style={{ left: col.x + 2, top: TOP + 6, width: col.w - 4, height: H - 12 }}>
        <div style={{ position: 'relative', height: y + 30 }}>{items}</div>
      </div>
    );
  };

  return (
    <>
      <TitleBar skin={skin} text={build.name ? build.name.toUpperCase() : 'BUILD OVERVIEW'} />
      <div className="title-text abs" style={{ right: 50, top: 22, fontSize: 30 }}>
        {gd.archetype(build.at).dn.toUpperCase()}
      </div>
      <MenuFrame x={32} y={58} w={1937} h={988} r25 outer />
      {/* level strip: reopen any level's in-game screen */}
      <div className="abs" style={{ left: 50, top: 92, width: 1900, display: 'flex', gap: 4, flexWrap: 'nowrap' }}>
        {steps.map((s) => {
          const isPick = s.picks.length > 0;
          const filled = isPick ? s.picks.every((i) => build.picks[i]) : rules.slotsUsed(s.level) >= s.slots;
          return (
            <div
              key={s.level}
              onClick={() => (isPick ? editPick(s.picks[0]!) : editSlots(s.level))}
              title={isPick ? `Level ${s.level + 1}: choose a power` : `Level ${s.level + 1}: ${s.slots} enhancement slots`}
              className="body-text"
              style={{ width: 34, height: 34, borderRadius: 17, cursor: 'pointer', fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', border: `2px solid ${isPick ? '#ffd200' : '#4f94ff'}`, background: filled ? (isPick ? '#6b5400' : '#0b3d9a') : '#300', boxShadow: filled ? 'none' : '0 0 6px #f33' }}
            >
              {s.level + 1}
            </div>
          );
        })}
      </div>
      {COLS.map((c) => (
        <MenuFrame key={c.x} x={c.x} y={TOP} w={c.w} h={H} />
      ))}
      {COLS.map(column)}
      <MenuFrame x={1503} y={TOP} w={464} h={H} />
      <div className="abs scroll-y" style={{ left: 1515, top: TOP + 8, width: 444, height: H - 16 }}>
        <TotalsPanel gd={gd} t={totals} width={420} />
      </div>
      <NextButton skin={skin} dir="left" text="New Build" onClick={toSetup} />
      <NextButton skin={skin} dir="right" text="Save / Share" onClick={() => setMenu(true)} />
      {picker ? (
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
      ) : null}
    </>
  );
}
