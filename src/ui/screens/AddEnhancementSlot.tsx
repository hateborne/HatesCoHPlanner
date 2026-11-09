import { useMemo, useState, type ReactElement } from 'react';
import type { Powerset } from '../../data/types.ts';
import { BuildRules, type BuildEntry } from '../../engine/rules.ts';
import { previewBuild, useStore } from '../../state/store.ts';
import { CheckBar } from '../components/CheckBar.tsx';
import { InfoButton, MenuFrame, NextButton, SlotRing, TitleBar } from '../components/Chrome.tsx';
import { Sprite } from '../components/Sprite.tsx';
import { icon, ui, type Skin } from '../skin/skin.ts';

const ROW = 95;
const RING = 50;
const RING_STEP = 70;

interface Group {
  set: Powerset | null;
  title: string;
  entries: BuildEntry[];
}

/** Group owned, slottable entries by powerset for one panel. */
function groups(rules: BuildRules, entries: BuildEntry[], kinds: string[]): Group[] {
  const by = new Map<number, Group>();
  for (const e of entries) {
    const ref = rules.gd.setOfPower.get(e.power.id);
    const kind = ref ? rules.setKind(ref.set) : 'other';
    if (!kinds.includes(kind)) continue;
    const id = ref?.set.id ?? -1;
    const g = by.get(id) ?? { set: ref?.set ?? null, title: ref?.set.dn ?? 'Other', entries: [] };
    g.entries.push(e);
    by.set(id, g);
  }
  return [...by.values()];
}

/**
 * "ADD AN ENHANCEMENT SLOT" (uiLevelSpec.c): click owned powers to place this level's slots;
 * click a just-placed slot to take it back. Finish unlocks when every slot is placed.
 */
export function AddEnhancementSlot({ skin }: { skin: Skin }) {
  const { gd, steps, level, addPendingSlot, removePendingSlot, finishLevel, backLevel } = useStore();
  const [hover, setHover] = useState<BuildEntry | null>(null);
  const [msg, setMsg] = useState<{ key: string; text: string } | null>(null);
  const step = level ? steps[level.step] : undefined;
  const preview = useMemo(() => (gd && level ? previewBuild(gd, steps, level) : null), [gd, steps, level]);
  const rules = useMemo(() => (gd && preview ? new BuildRules(gd, preview) : null), [gd, preview]);
  if (!gd || !level || !step || !rules) return null;
  const L = step.level;
  const entries = rules.entries().filter((e) => e.level <= L && rules.slottable(e.power) && e.power.sm !== 0);
  const remaining = rules.slotsGranted(L) - rules.slotsUsed(L);
  const anyPlaceable = entries.some((e) => rules.slotBlock(e, L) === null);
  const panels: { x: number; y: number; w: number; h: number; groups: Group[] }[] = [
    { x: 33, y: 135, w: 622, h: 910, groups: groups(rules, entries, ['primary']) },
    { x: 689, y: 135, w: 622, h: 910, groups: groups(rules, entries, ['secondary']) },
    { x: 1345, y: 135, w: 622, h: 617, groups: groups(rules, entries, ['branch', 'pool', 'epic', 'inherent', 'other']) },
  ];

  const click = (e: BuildEntry) => {
    const block = rules.slotBlock(e, L);
    if (block) {
      setMsg({ key: e.key, text: block });
      window.setTimeout(() => setMsg(null), 1400);
      return;
    }
    addPendingSlot(e.key);
  };
  const unclick = (key: string) => {
    const idx = level.pendingSlots.lastIndexOf(key);
    if (idx >= 0) removePendingSlot(idx);
  };

  const renderPanel = (p: (typeof panels)[number]) => {
    const items: ReactElement[] = [];
    let y = 0;
    for (const g of p.groups) {
      const top = y;
      y += 52;
      for (const e of g.entries) {
        const py = y + 22;
        items.push(
          <CheckBar
            key={e.key}
            skin={skin}
            x={95}
            y={py}
            wd={p.w - 145}
            scale={1.05}
            text={e.power.dn}
            state="selected"
            icon={icon('powers', e.power.icon || 'power_missing')}
            onClick={() => click(e)}
            onHover={(on) => setHover(on ? e : null)}
          />,
        );
        e.slots.forEach((s, i) => {
          const pending = i > 0 && s.level === L;
          const boost = s.enh ? gd.powerById.get(s.enh.boost) : undefined;
          items.push(
            <SlotRing
              key={`${e.key}:${i}`}
              x={145 + i * RING_STEP}
              y={py + 34}
              size={RING}
              pending={pending}
              enhIcon={boost ? icon('enh', boost.icon) : undefined}
              frames={boost?.bf}
              title={pending ? 'Click to remove this slot' : `Slot gained at level ${s.level + 1}`}
              onClick={pending ? () => unclick(e.key) : undefined}
            />,
          );
        });
        if (msg?.key === e.key) {
          items.push(
            <div key={`${e.key}:msg`} className="abs title-text" style={{ left: p.w - 220, top: py - 18, fontSize: 26, backgroundImage: 'linear-gradient(#ff5050,#ff0000)' }}>
              {msg.text}
            </div>,
          );
        }
        y += ROW;
      }
      items.push(
        <div key={`g${g.set?.id ?? 'x'}`} className="set-box" style={{ left: 95, top: top + 30, width: p.w - 175, height: y - top - 30 }}>
          <div className="title-text" style={{ position: 'absolute', left: 0, right: 0, top: -30, textAlign: 'center', fontSize: 24, textTransform: 'uppercase' }}>
            {g.title}
          </div>
        </div>,
      );
      y += 14;
    }
    return (
      <div key={p.x} className="abs scroll-y" style={{ left: p.x + 2, top: p.y + 22, width: p.w - 4, height: p.h - 30 }}>
        <div style={{ position: 'relative', height: y + 20 }}>{items}</div>
      </div>
    );
  };

  const hovered = hover?.power;
  const hoveredSet = hovered ? gd.setOfPower.get(hovered.id)?.set : undefined;
  return (
    <>
      <TitleBar skin={skin} text="ADD AN ENHANCEMENT SLOT" />
      <div className="title-text abs" style={{ right: 50, top: 22, fontSize: 34 }}>
        LEVEL {L + 1}
      </div>
      <MenuFrame x={32} y={58} w={1937} h={988} r25 outer />
      {panels.map((p) => (
        <MenuFrame key={p.x} x={p.x} y={p.y} w={p.w} h={p.h} />
      ))}
      <InfoButton x={343} y={103} text="Show Detailed Info Here" disabled />
      <InfoButton x={999} y={103} text="Show Detailed Info Here" disabled />
      <div className="abs" style={{ left: 1345, top: 82, width: 622, textAlign: 'center' }}>
        <span className="title-text" style={{ fontSize: 32, fontFamily: 'MontrealHeavy, sans-serif', fontStyle: 'normal' }}>
          <Sprite src={ui('creation/enhancements/enhnctray_powertitle_dot')} x={-24} y={14} w={12} h={12} />
          POOL POWERS
        </span>
      </div>
      {panels.map(renderPanel)}
      <MenuFrame x={1332} y={762} w={648} h={283} />
      {hovered ? (
        <div className="abs" style={{ left: 1360, top: 790, width: 600 }}>
          <div className="title-text" style={{ fontSize: 15, marginLeft: 95 }}>{hovered.dn.toUpperCase()}</div>
          <div className="body-text" style={{ marginLeft: 95, color: '#7fd3ff', fontSize: 24, lineHeight: 1.2 }}>{hovered.sh}</div>
          <img src={icon('powers', hovered.icon || 'power_missing')} width={48} height={48} alt="" style={{ position: 'absolute', left: 15, top: 125 }} />
          <div className="body-text" style={{ position: 'absolute', left: 95, top: 170, color: '#7fd3ff', fontSize: 24, width: 200 }}>{hoveredSet?.dn}</div>
        </div>
      ) : null}
      <div className={`slots-available${remaining <= 0 ? ' done' : ''}`} style={{ left: 807, top: 1020, width: 386, height: 42 }}>
        Slots Available: {Math.max(0, remaining)}
      </div>
      <NextButton skin={skin} dir="left" text={level.mode === 'edit' ? 'Cancel' : 'Back'} onClick={backLevel} />
      <NextButton skin={skin} dir="right" text="Finish" locked={remaining > 0 && anyPlaceable} glow={remaining <= 0} onClick={finishLevel} />
    </>
  );
}
