import { useMemo, useState, type ReactElement } from 'react';
import { PHONE_PANEL, PhoneTabs } from '../components/Phone.tsx';
import { useStage } from '../components/Stage.tsx';
import type { Archetype, Powerset } from '../../data/types.ts';
import { ALIGNMENTS, skinOf, type Alignment } from '../../engine/build.ts';
import { evalRequires } from '../../engine/requires.ts';
import { useStore } from '../../state/store.ts';
import { CheckBar } from '../components/CheckBar.tsx';
import { DescBox, InfoButton, MenuFrame, NextButton, SetTitle, TitleBar } from '../components/Chrome.tsx';
import { icon, SKINS } from '../skin/skin.ts';

const COLS = [
  { x: 33, w: 470 },
  { x: 515, w: 480 },
  { x: 1007, w: 480 },
  { x: 1499, w: 468 },
];
const TOP = 103;
const H = 759;

/** Playable starting sets of a category (VEAT branches and gated sets are not offered). */
function startingSets(gd: NonNullable<ReturnType<typeof useStore.getState>['gd']>, cat: string, at: Archetype): Powerset[] {
  const ctx = {
    ownsPower: () => false,
    ownsSet: () => false,
    prop: (n: string) => (n === 'archetype' ? at.n : n === 'level' ? 1 : 0),
  };
  return gd
    .setsInCategory(cat)
    .filter((s) => !s.spa && s.p.length > 0 && evalRequires(s.sbr, ctx))
    .filter((s) => s.av.some((a) => a === 0));
}

/**
 * Build setup in the in-game style: archetype, primary, secondary, origin, alignment and a name.
 * Finish starts the level 1 power picks.
 */
export function Setup() {
  const { gd, build, startBuild, toOverview } = useStore();
  const [at, setAt] = useState<number | undefined>(build?.at);
  const [pri, setPri] = useState<number | undefined>(build?.primary);
  const [sec, setSec] = useState<number | undefined>(build?.secondary);
  const [origin, setOrigin] = useState<number | undefined>(build?.origin);
  const [align, setAlign] = useState<Alignment>(build?.alignment ?? 'Hero');
  const [name, setName] = useState(build?.name ?? '');
  const [desc, setDesc] = useState<{ text: string; icon?: string } | null>(null);
  const [tab, setTab] = useState(0);
  const { phone } = useStage();
  const archetype = at !== undefined ? gd?.archetypeById.get(at) : undefined;
  const pris = useMemo(() => (gd && archetype ? startingSets(gd, archetype.cats.pri, archetype) : []), [gd, archetype]);
  const secs = useMemo(() => (gd && archetype ? startingSets(gd, archetype.cats.sec, archetype) : []), [gd, archetype]);
  if (!gd) return null;
  const skin = SKINS[skinOf(align)];
  const ready = at !== undefined && pri !== undefined && sec !== undefined && origin !== undefined;
  const ROW = 47;
  const finish = () => {
    if (at !== undefined && pri !== undefined && sec !== undefined && origin !== undefined) {
      startBuild({ name, at, origin, alignment: align, primary: pri, secondary: sec });
    }
  };

  if (phone) {
    const P = PHONE_PANEL;
    const R = 64;
    const bars: ReactElement[] = [];
    if (tab === 0) {
      gd.core.archetypes.forEach((a, i) =>
        bars.push(
          <CheckBar key={a.id} skin={skin} x={70} y={50 + i * R} wd={P.w - 130} text={a.dn} state={a.id === at ? 'selected' : 'standard'} down={a.id === at} icon={icon('at', a.icon)} onClick={() => { if (a.id !== at) { setAt(a.id); setPri(undefined); setSec(undefined); } setDesc({ text: a.lh || a.sh, icon: icon('at', a.icon) }); }} />,
        ),
      );
    } else if (tab === 1 || tab === 2) {
      const list = tab === 1 ? pris : secs;
      const val = tab === 1 ? pri : sec;
      const setv = tab === 1 ? setPri : setSec;
      if (!list.length) bars.push(<div key="x" className="desc-text abs" style={{ left: 30, top: 30, fontSize: 26 }}>Choose an archetype first.</div>);
      list.forEach((s, i) =>
        bars.push(<CheckBar key={s.id} skin={skin} x={70} y={50 + i * R} wd={P.w - 130} text={s.dn} state={s.id === val ? 'selected' : 'standard'} down={s.id === val} onClick={() => { setv(s.id); setDesc({ text: s.lh || s.sh }); }} />),
      );
    } else {
      gd.core.origins.forEach((o, i) =>
        bars.push(<CheckBar key={o.id} skin={skin} x={70} y={50 + i * R} wd={P.w - 130} text={o.dn} state={o.id === origin ? 'selected' : 'standard'} down={o.id === origin} icon={icon('origin', o.icon)} onClick={() => { setOrigin(o.id); setDesc({ text: o.lh || o.sh, icon: icon('origin', o.icon) }); }} />),
      );
      ALIGNMENTS.forEach((a, i) =>
        bars.push(<CheckBar key={a} skin={skin} x={70} y={420 + i * R} wd={P.w - 130} text={a === 'Loyalist' || a === 'Resistance' ? `Praetorian (${a})` : a} state={a === align ? 'selected' : 'standard'} down={a === align} onClick={() => setAlign(a)} />),
      );
    }
    const count = tab === 0 ? gd.core.archetypes.length : tab === 3 ? 13 : Math.max(1, (tab === 1 ? pris : secs).length);
    return (
      <>
        <TitleBar skin={skin} text="CREATE A BUILD" />
        <input className="abs body-text" value={name} maxLength={40} placeholder="Build name" onChange={(e) => setName(e.target.value)} style={{ left: 30, top: 92, width: 600, height: 46, background: '#000', border: '2px solid #4f94ff', borderRadius: 23, color: '#fff', fontSize: 22, padding: '0 20px' }} />
        <button className="info-button" style={{ left: 820, top: 115, transform: 'translate(-50%, -50%)' }} onClick={() => useStore.getState().setMenu(true)}>
          Saved / Import
        </button>
        <PhoneTabs skin={skin} labels={['Archetype', 'Primary', 'Secondary', 'Origin']} active={tab} onChange={setTab} y={180} />
        <MenuFrame x={P.x} y={P.y + 30} w={P.w} h={P.h - 30} />
        <div className="abs scroll-y" style={{ left: P.x + 4, top: P.y + 36, width: P.w - 8, height: P.h - 42 }}>
          <div style={{ position: 'relative', height: count * R + 60 }}>{bars}</div>
        </div>
        <DescBox iconSrc={desc?.icon} text={desc?.text ?? 'Choose an archetype, primary and secondary sets, an origin and an alignment, then Finish.'} />
        <NextButton skin={skin} dir="left" text="Back" locked={!build} onClick={toOverview} />
        <NextButton skin={skin} dir="right" text="Finish" locked={!ready} glow={ready} onClick={finish} />
      </>
    );
  }

  return (
    <>
      <TitleBar skin={skin} text="CREATE A BUILD" />
      <input
        className="abs body-text"
        value={name}
        maxLength={40}
        placeholder="Build name"
        onChange={(e) => setName(e.target.value)}
        style={{ right: 50, top: 18, width: 520, height: 46, background: '#000', border: '2px solid #4f94ff', borderRadius: 23, color: '#fff', fontSize: 22, padding: '0 20px' }}
      />
      <MenuFrame x={32} y={58} w={1937} h={988} r25 outer />
      <InfoButton x={1000} y={58} text="Saved builds / Import" onClick={() => useStore.getState().setMenu(true)} />
      {COLS.map((c) => (
        <MenuFrame key={c.x} x={c.x} y={TOP} w={c.w} h={H} />
      ))}
      <SetTitle x={COLS[0]!.x + 20} y={TOP + 18} text="Archetype" />
      <SetTitle x={COLS[1]!.x + 20} y={TOP + 18} text="Primary Power Set" />
      <SetTitle x={COLS[2]!.x + 20} y={TOP + 18} text="Secondary Power Set" />
      <SetTitle x={COLS[3]!.x + 20} y={TOP + 18} text="Origin" />
      <SetTitle x={COLS[3]!.x + 20} y={TOP + 345} text="Alignment" />
      <div className="abs scroll-y" style={{ left: COLS[0]!.x, top: TOP + 62, width: COLS[0]!.w, height: H - 70 }}>
        <div style={{ position: 'relative', height: gd.core.archetypes.length * ROW + 30 }}>
          {gd.core.archetypes.map((a, i) => (
            <CheckBar
              key={a.id}
              skin={skin}
              x={60}
              y={28 + i * ROW}
              wd={COLS[0]!.w - 100}
              scale={1}
              text={a.dn}
              state={a.id === at ? 'selected' : 'standard'}
              down={a.id === at}
              icon={icon('at', a.icon)}
              onClick={() => {
                if (a.id !== at) {
                  setAt(a.id);
                  setPri(undefined);
                  setSec(undefined);
                }
              }}
              onHover={(on) => setDesc(on ? { text: a.lh || a.sh, icon: icon('at', a.icon) } : null)}
            />
          ))}
        </div>
      </div>
      {[
        { col: COLS[1]!, sets: pris, val: pri, set: setPri },
        { col: COLS[2]!, sets: secs, val: sec, set: setSec },
      ].map(({ col, sets, val, set }) => (
        <div key={col.x} className="abs scroll-y" style={{ left: col.x, top: TOP + 62, width: col.w, height: H - 70 }}>
          <div style={{ position: 'relative', height: sets.length * ROW + 30 }}>
            {sets.map((s, i) => (
              <CheckBar
                key={s.id}
                skin={skin}
                x={50}
                y={28 + i * ROW}
                wd={col.w - 90}
                scale={1}
                text={s.dn}
                state={s.id === val ? 'selected' : 'standard'}
                down={s.id === val}
                onClick={() => set(s.id)}
                onHover={(on) => setDesc(on ? { text: s.lh || s.sh } : null)}
              />
            ))}
          </div>
        </div>
      ))}
      {gd.core.origins.map((o, i) => (
        <CheckBar
          key={o.id}
          skin={skin}
          x={COLS[3]!.x + 60}
          y={TOP + 95 + i * ROW}
          wd={COLS[3]!.w - 100}
          scale={1}
          text={o.dn}
          state={o.id === origin ? 'selected' : 'standard'}
          down={o.id === origin}
          icon={icon('origin', o.icon)}
          onClick={() => setOrigin(o.id)}
          onHover={(on) => setDesc(on ? { text: o.lh || o.sh, icon: icon('origin', o.icon) } : null)}
        />
      ))}
      {ALIGNMENTS.map((a, i) => (
        <CheckBar
          key={a}
          skin={skin}
          x={COLS[3]!.x + 50}
          y={TOP + 420 + i * ROW}
          wd={COLS[3]!.w - 90}
          scale={1}
          text={a === 'Loyalist' || a === 'Resistance' ? `Praetorian (${a})` : a}
          state={a === align ? 'selected' : 'standard'}
          down={a === align}
          onClick={() => setAlign(a)}
        />
      ))}
      <DescBox iconSrc={desc?.icon} text={desc?.text ?? 'Choose an archetype, its primary and secondary power sets, an origin and an alignment, then press Finish to pick your level 1 powers.'} />
      <NextButton skin={skin} dir="left" text="Back" locked={!build} onClick={toOverview} />
      <NextButton
        skin={skin}
        dir="right"
        text="Finish"
        locked={!ready}
        glow={ready}
        onClick={finish}
      />
    </>
  );
}
