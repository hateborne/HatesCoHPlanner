import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { PHONE_PANEL, PhoneTabs } from '../components/Phone.tsx';
import { useStage } from '../components/Stage.tsx';
import type { Archetype, Origin, Powerset } from '../../data/types.ts';
import { ALIGNMENTS, skinOf, type Alignment } from '../../engine/build.ts';
import { evalRequires } from '../../engine/requires.ts';
import { useStore } from '../../state/store.ts';
import { CheckBar } from '../components/CheckBar.tsx';
import { DescBox, InfoButton, MenuFrame, NextButton, SetTitle, TitleBar } from '../components/Chrome.tsx';
import { GameScroll } from '../components/GameScroll.tsx';
import { icon, SKINS } from '../skin/skin.ts';
import { setMusicSkin } from '../sound.ts';

// Origin & Alignment first, then Archetype, Primary and Secondary (left to right)
const COLS = [
  { x: 33, w: 470 },
  { x: 515, w: 480 },
  { x: 1007, w: 480 },
  { x: 1499, w: 468 },
];
const TOP = 103;
const H = 759;
const FRAME_TOP = 58; // the outer frame; the name field sits fully above it

// The character creator's sounds (UI/Hybrid): every bar click plays N_Select (drawHybridBar), an
// archetype also plays N_Archetype_<class> and an origin N_Origin_<origin>; hovering a bar plays
// N_MouseEnter and leaving it N_MouseExit.
const SELECT = ['n_select'];
const atSounds = (a: Archetype) => [...SELECT, `n_archetype_${a.n}`];
const originSounds = (o: Origin) => [...SELECT, `n_origin_${o.n}`];

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
 * Build setup in the in-game style: origin and alignment, archetype, primary, secondary and a
 * name. Finish starts the level 1 power picks.
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
  useEffect(() => setMusicSkin(skinOf(align)), [align]);
  if (!gd) return null;
  const skin = SKINS[skinOf(align)];
  const ready = at !== undefined && pri !== undefined && sec !== undefined && origin !== undefined;
  const ROW = 47;
  const finish = () => {
    if (at !== undefined && pri !== undefined && sec !== undefined && origin !== undefined) {
      startBuild({ name, at, origin, alignment: align, primary: pri, secondary: sec });
    }
  };
  const pickAt = (a: Archetype) => {
    if (a.id === at) return;
    setAt(a.id);
    setPri(undefined);
    setSec(undefined);
  };
  const nameStyle = { background: '#000', border: '2px solid #4f94ff', borderRadius: 22, color: '#fff', fontSize: 22, padding: '0 20px', boxSizing: 'border-box' as const };

  if (phone) {
    const P = PHONE_PANEL;
    const R = 64;
    const bars: ReactElement[] = [];
    if (tab === 0) {
      gd.core.origins.forEach((o, i) =>
        bars.push(<CheckBar key={o.id} skin={skin} x={70} y={50 + i * R} wd={P.w - 130} text={o.dn} state={o.id === origin ? 'selected' : 'standard'} down={o.id === origin} icon={icon('origin', o.icon)} clickSounds={originSounds(o)} hoverSounds onClick={() => { setOrigin(o.id); setDesc({ text: o.lh || o.sh, icon: icon('origin', o.icon) }); }} />),
      );
      ALIGNMENTS.forEach((a, i) =>
        bars.push(<CheckBar key={a} skin={skin} x={70} y={420 + i * R} wd={P.w - 130} text={a} state={a === align ? 'selected' : 'standard'} down={a === align} clickSounds={SELECT} hoverSounds onClick={() => setAlign(a)} />),
      );
    } else if (tab === 1) {
      gd.core.archetypes.forEach((a, i) =>
        bars.push(
          <CheckBar key={a.id} skin={skin} x={70} y={50 + i * R} wd={P.w - 130} text={a.dn} state={a.id === at ? 'selected' : 'standard'} down={a.id === at} icon={icon('at', a.icon)} clickSounds={atSounds(a)} hoverSounds onClick={() => { pickAt(a); setDesc({ text: a.lh || a.sh, icon: icon('at', a.icon) }); }} />,
        ),
      );
    } else {
      const list = tab === 2 ? pris : secs;
      const val = tab === 2 ? pri : sec;
      const setv = tab === 2 ? setPri : setSec;
      if (!list.length) bars.push(<div key="x" className="desc-text abs" style={{ left: 30, top: 30, fontSize: 26 }}>Choose an archetype first.</div>);
      list.forEach((s, i) =>
        bars.push(<CheckBar key={s.id} skin={skin} x={70} y={50 + i * R} wd={P.w - 130} noBox text={s.dn} state={s.id === val ? 'selected' : 'standard'} down={s.id === val} clickSounds={SELECT} hoverSounds onClick={() => { setv(s.id); setDesc({ text: s.lh || s.sh }); }} />),
      );
    }
    const count = tab === 1 ? gd.core.archetypes.length : tab === 0 ? 9 : Math.max(1, (tab === 2 ? pris : secs).length);
    return (
      <>
        <TitleBar skin={skin} text="CREATE A BUILD" />
        <input className="abs body-text" value={name} maxLength={40} placeholder="Build name" onChange={(e) => setName(e.target.value)} style={{ ...nameStyle, left: 30, top: 104, width: 600, height: 44 }} />
        <button className="info-button" style={{ left: 820, top: 126, transform: 'translate(-50%, -50%)' }} onClick={() => useStore.getState().setMenu(true)}>
          Saved / Import
        </button>
        <PhoneTabs skin={skin} labels={['Origin', 'Archetype', 'Primary', 'Secondary']} active={tab} onChange={setTab} y={187} clickSounds={SELECT} />
        <MenuFrame x={P.x} y={P.y + 30} w={P.w} h={P.h - 30} skin={skin} />
        <GameScroll skin={skin} left={P.x + 4} top={P.y + 50} width={P.w - 8} height={P.h - 70} barX={P.x + P.w}>
          <div style={{ position: 'relative', height: count * R + 60 }}>{bars}</div>
        </GameScroll>
        <DescBox skin={skin} iconSrc={desc?.icon} text={desc?.text ?? 'Choose an origin and alignment, an archetype and its primary and secondary sets, then Finish.'} />
        <NextButton skin={skin} dir="left" text="Back" locked={!build} onClick={toOverview} />
        <NextButton skin={skin} dir="right" text="Finish" locked={!ready} glow={ready} onClick={finish} />
      </>
    );
  }

  const [cOrigin, cAt, cPri, cSec] = COLS as [typeof COLS[0], typeof COLS[0], typeof COLS[0], typeof COLS[0]];
  return (
    <>
      <TitleBar skin={skin} text="CREATE A BUILD" />
      <input
        className="abs body-text"
        value={name}
        maxLength={40}
        placeholder="Build name"
        onChange={(e) => setName(e.target.value)}
        style={{ ...nameStyle, right: 50, top: 6, width: 520, height: 44 }}
      />
      <MenuFrame x={32} y={FRAME_TOP} w={1937} h={988} r25 outer skin={skin} />
      <InfoButton skin={skin} x={1000} y={FRAME_TOP} text="Saved builds / Import" onClick={() => useStore.getState().setMenu(true)} />
      {COLS.map((c) => (
        <MenuFrame key={c.x} x={c.x} y={TOP} w={c.w} h={H} skin={skin} />
      ))}
      <SetTitle skin={skin} x={cOrigin.x + 20} y={TOP + 18} text="Origin" />
      <SetTitle skin={skin} x={cOrigin.x + 20} y={TOP + 345} text="Alignment" />
      <SetTitle skin={skin} x={cAt.x + 20} y={TOP + 18} text="Archetype" />
      <SetTitle skin={skin} x={cPri.x + 20} y={TOP + 18} text="Primary Power Set" />
      <SetTitle skin={skin} x={cSec.x + 20} y={TOP + 18} text="Secondary Power Set" />
      {gd.core.origins.map((o, i) => (
        <CheckBar
          key={o.id}
          skin={skin}
          x={cOrigin.x + 60}
          y={TOP + 95 + i * ROW}
          wd={cOrigin.w - 100}
          scale={1}
          text={o.dn}
          state={o.id === origin ? 'selected' : 'standard'}
          down={o.id === origin}
          icon={icon('origin', o.icon)}
          clickSounds={originSounds(o)}
          hoverSounds
          onClick={() => setOrigin(o.id)}
          onHover={(on) => setDesc(on ? { text: o.lh || o.sh, icon: icon('origin', o.icon) } : null)}
        />
      ))}
      {ALIGNMENTS.map((a, i) => (
        <CheckBar
          key={a}
          skin={skin}
          x={cOrigin.x + 60}
          y={TOP + 420 + i * ROW}
          wd={cOrigin.w - 100}
          scale={1}
          text={a}
          state={a === align ? 'selected' : 'standard'}
          down={a === align}
          clickSounds={SELECT}
          hoverSounds
          onClick={() => setAlign(a)}
        />
      ))}
      <GameScroll skin={skin} left={cAt.x + 2} top={TOP + 62} width={cAt.w - 4} height={H - 80} barX={cAt.x + cAt.w}>
        <div style={{ position: 'relative', height: gd.core.archetypes.length * ROW + 30 }}>
          {gd.core.archetypes.map((a, i) => (
            <CheckBar
              key={a.id}
              skin={skin}
              x={60}
              y={28 + i * ROW}
              wd={cAt.w - 100}
              scale={1}
              text={a.dn}
              state={a.id === at ? 'selected' : 'standard'}
              down={a.id === at}
              icon={icon('at', a.icon)}
              clickSounds={atSounds(a)}
              hoverSounds
              onClick={() => pickAt(a)}
              onHover={(on) => setDesc(on ? { text: a.lh || a.sh, icon: icon('at', a.icon) } : null)}
            />
          ))}
        </div>
      </GameScroll>
      {[
        { col: cPri, sets: pris, val: pri, set: setPri },
        { col: cSec, sets: secs, val: sec, set: setSec },
      ].map(({ col, sets, val, set }) => (
        <GameScroll key={col.x} skin={skin} left={col.x + 2} top={TOP + 62} width={col.w - 4} height={H - 80} barX={col.x + col.w}>
          <div style={{ position: 'relative', height: sets.length * ROW + 30 }}>
            {sets.map((s, i) => (
              <CheckBar
                key={s.id}
                skin={skin}
                x={50}
                y={28 + i * ROW}
                wd={col.w - 90}
                scale={1}
                noBox
                text={s.dn}
                state={s.id === val ? 'selected' : 'standard'}
                down={s.id === val}
                clickSounds={SELECT}
                hoverSounds
                onClick={() => set(s.id)}
                onHover={(on) => setDesc(on ? { text: s.lh || s.sh } : null)}
              />
            ))}
          </div>
        </GameScroll>
      ))}
      <DescBox skin={skin} iconSrc={desc?.icon} text={desc?.text ?? 'Choose an origin and an alignment, an archetype and its primary and secondary power sets, then press Finish to pick your level 1 powers.'} />
      <NextButton skin={skin} dir="left" text="Back" locked={!build} onClick={toOverview} />
      <NextButton skin={skin} dir="right" text="Finish" locked={!ready} glow={ready} onClick={finish} />
    </>
  );
}
