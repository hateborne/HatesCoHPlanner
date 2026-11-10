import { useEffect, useMemo, useState, type CSSProperties, type ReactElement } from 'react';
import { PHONE_PAD, PHONE_TAB_ROW, phoneDesc, phoneGeom, PhoneTabs } from '../components/Phone.tsx';
import { useStage } from '../components/Stage.tsx';
import type { Archetype, Powerset } from '../../data/types.ts';
import { ALIGNMENTS, skinOf, type Alignment } from '../../engine/build.ts';
import { evalRequires } from '../../engine/requires.ts';
import { useStore } from '../../state/store.ts';
import { CheckBar } from '../components/CheckBar.tsx';
import { DescBox, InfoButton, MenuFrame, NextButton, SetTitle, TitleBar } from '../components/Chrome.tsx';
import { GameScroll } from '../components/GameScroll.tsx';
import { OriginAlignPane, originSounds, SELECT } from '../components/OriginAlign.tsx';
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

// an archetype click also plays N_Archetype_<class> (origin sounds live with OriginAlignPane)
const atSounds = (a: Archetype) => [...SELECT, `n_archetype_${a.n}`];

/** How the build is made: leveling up one level at a time, or a respec (every power, then every slot). */
type BuildType = 'leveling' | 'respec';
const BUILD_TYPES: { id: BuildType; label: string; help: string }[] = [
  { id: 'leveling', label: 'Leveling', help: 'Leveling: choose a power or place enhancement slots one level at a time, the way a character levels up.' },
  {
    id: 'respec',
    label: 'Respec',
    help: "Respec: choose every power first, level by level, then place every enhancement slot, the way the game's respecification works. Set the level to respec to (50 unless you change it).",
  },
];

/** @return A typed respec level as a whole level from 1 to 50 (50 when it isn't a number). */
const respecLevel = (raw: string) => {
  const n = Math.round(Number(raw));
  return Number.isFinite(n) && raw.trim() !== '' ? Math.min(50, Math.max(1, n)) : 50;
};

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
  const { gd, build, startBuild, toOverview, versions, selectVersion } = useStore();
  const [at, setAt] = useState<number | undefined>(build?.at);
  const [pri, setPri] = useState<number | undefined>(build?.primary);
  const [sec, setSec] = useState<number | undefined>(build?.secondary);
  const [origin, setOrigin] = useState<number | undefined>(build?.origin);
  const [align, setAlign] = useState<Alignment>(build?.alignment ?? 'Hero');
  const [name, setName] = useState(build?.name ?? '');
  const [desc, setDesc] = useState<{ text: string; icon?: string } | null>(null);
  const [buildType, setBuildType] = useState<BuildType>(build?.respecTo !== undefined ? 'respec' : 'leveling');
  const [respecTo, setRespecTo] = useState(String((build?.respecTo ?? 49) + 1)); // typed text, 1-based
  const [tab, setTab] = useState(0);
  const stage = useStage();
  const { phone } = stage;
  const archetype = at !== undefined ? gd?.archetypeById.get(at) : undefined;
  const pris = useMemo(() => (gd && archetype ? startingSets(gd, archetype.cats.pri, archetype) : []), [gd, archetype]);
  const secs = useMemo(() => (gd && archetype ? startingSets(gd, archetype.cats.sec, archetype) : []), [gd, archetype]);
  useEffect(() => {
    setMusicSkin(skinOf(align));
    useStore.setState({ setupAlign: align });
  }, [align]);
  if (!gd) return null;
  const skin = SKINS[skinOf(align)];
  // ids are stable across game versions, but a choice may not exist in the version picked here
  const ready =
    archetype !== undefined && pris.some((s) => s.id === pri) && secs.some((s) => s.id === sec) && gd.core.origins.some((o) => o.id === origin);
  const ROW = 47;
  const finish = async () => {
    if (at === undefined || pri === undefined || sec === undefined || origin === undefined) return;
    // a new build replaces the current one (and this tab's address): ask first when it has any work
    if (build && (build.picks.some((p) => p) || Object.values(build.granted).some((g) => g.slots.some((s) => s.enh)))) {
      const ok = await useStore.getState().askConfirm({
        title: 'Start a new build?',
        text: `This replaces ${build.name ? `"${build.name}"` : 'your current build'}. Save it first (Saved builds / Import) if you want to keep it.`,
        okLabel: 'Start new',
      });
      if (!ok) return;
    }
    startBuild({ name, at, origin, alignment: align, primary: pri, secondary: sec, respecTo: buildType === 'respec' ? respecLevel(respecTo) - 1 : undefined });
  };
  const pickAt = (a: Archetype) => {
    if (a.id === at) return;
    setAt(a.id);
    setPri(undefined);
    setSec(undefined);
  };
  /** Which game version's data the new build uses (each version keeps its own data on the site). */
  const versionPicker = (style: CSSProperties) => (
    <select
      className="abs body-text"
      aria-label="Game version"
      title="Game version: the patch whose powers and enhancements this build uses"
      value={gd.core.manifest.dataVersion}
      onChange={(e) => void selectVersion(e.target.value)}
      style={{ fontFamily: "'Montreal'", fontSize: 20, color: '#fff', background: 'linear-gradient(#0c2a6e, #04102e)', border: '2px solid #4f94ff', borderRadius: 22, padding: '0 12px 0 18px', cursor: 'pointer', ...style }}
    >
      {(versions?.versions ?? []).map((v) => (
        <option key={v.id} value={v.id} style={{ background: '#04102e' }}>
          {v.label}
        </option>
      ))}
    </select>
  );
  /** The Build Type bars (Leveling / Respec) from (x, y), `step` apart, `wd` wide. */
  const typeBars = (x: number, y: number, step: number, wd: number, scale?: number) =>
    BUILD_TYPES.map((t, i) => (
      <CheckBar
        key={t.id}
        skin={skin}
        x={x}
        y={y + i * step}
        wd={wd}
        scale={scale}
        text={t.label}
        state={t.id === buildType ? 'selected' : 'standard'}
        down={t.id === buildType}
        clickSounds={SELECT}
        hoverSounds
        onClick={() => {
          setBuildType(t.id);
          setDesc({ text: t.help });
        }}
        onHover={(on) => setDesc(on ? { text: t.help } : null)}
      />
    ));
  /** "Respec to level" and its field, shown while Respec is ticked; the label's left edge at x. */
  const levelField = (x: number, cy: number, size: number) =>
    buildType === 'respec' ? (
      <div className="abs body-text" style={{ left: x, top: cy - size, height: 2 * size, display: 'flex', alignItems: 'center', gap: size * 0.6, color: '#cfe8ff', fontSize: size, zIndex: 5 }}>
        <label htmlFor="respec-level">Respec to level</label>
        <input
          id="respec-level"
          type="number"
          min={1}
          max={50}
          value={respecTo}
          onChange={(e) => setRespecTo(e.target.value)}
          onBlur={() => setRespecTo(String(respecLevel(respecTo)))}
          onKeyDown={(e) => {
            if (e.key === 'Enter') setRespecTo(String(respecLevel(respecTo)));
          }}
          style={{ width: size * 4.2, height: size * 1.9, background: '#000', border: '2px solid #4f94ff', borderRadius: size, color: '#fff', fontSize: size, textAlign: 'center', boxSizing: 'border-box' }}
        />
      </div>
    ) : null;
  const nameStyle = { background: '#000', border: '2px solid #4f94ff', borderRadius: 22, color: '#fff', fontSize: 22, padding: '0 20px', boxSizing: 'border-box' as const };

  if (phone) {
    const pg = phoneGeom(stage, false);
    const half = (pg.w - 3 * PHONE_PAD) / 2;
    // under the title: the name, then the version and Saved / Import, two rows of tabs, the panel
    // and the description
    const nameY = pg.line + 10;
    const rowY = nameY + 58;
    const tabsY = rowY + 56 + 8 + PHONE_TAB_ROW / 2;
    const descBox = phoneDesc(pg);
    const top = tabsY + PHONE_TAB_ROW + PHONE_TAB_ROW / 2 + 4;
    const P = { x: PHONE_PAD, y: top, w: pg.w - 2 * PHONE_PAD, h: descBox.y - 8 - top };
    const R = 64;
    const BX = 52; // bars' check-box center
    const BW = P.w - 86;
    const bars: ReactElement[] = [];
    let end = 0; // content height
    if (tab === 0) {
      // Origin, Alignment and Build Type, each under its heading
      let y = 12;
      const heading = (text: string) => {
        bars.push(<SetTitle key={`h-${text}`} skin={skin} x={18} y={y} text={text} />);
        y += 56;
      };
      heading('Origin');
      gd.core.origins.forEach((o) => {
        bars.push(<CheckBar key={o.id} skin={skin} x={BX} y={y} wd={BW} text={o.dn} state={o.id === origin ? 'selected' : 'standard'} down={o.id === origin} icon={icon('origin', o.icon)} clickSounds={originSounds(o)} hoverSounds onClick={() => { setOrigin(o.id); setDesc({ text: o.lh || o.sh, icon: icon('origin', o.icon) }); }} />);
        y += R;
      });
      heading('Alignment');
      ALIGNMENTS.forEach((a) => {
        bars.push(<CheckBar key={a} skin={skin} x={BX} y={y} wd={BW} text={a} state={a === align ? 'selected' : 'standard'} down={a === align} clickSounds={SELECT} hoverSounds onClick={() => setAlign(a)} />);
        y += R;
      });
      heading('Build Type');
      bars.push(...typeBars(BX, y, R, BW));
      y += 2 * R - 10;
      const field = levelField(24, y, 22);
      if (field) {
        bars.push(<div key="respec-level">{field}</div>);
        y += 50;
      }
      end = y;
    } else if (tab === 1) {
      gd.core.archetypes.forEach((a, i) =>
        bars.push(
          <CheckBar key={a.id} skin={skin} x={BX} y={44 + i * R} wd={BW} text={a.dn} state={a.id === at ? 'selected' : 'standard'} down={a.id === at} icon={icon('at', a.icon)} clickSounds={atSounds(a)} hoverSounds onClick={() => { pickAt(a); setDesc({ text: a.lh || a.sh, icon: icon('at', a.icon) }); }} />,
        ),
      );
      end = 44 + gd.core.archetypes.length * R;
    } else {
      const list = tab === 2 ? pris : secs;
      const val = tab === 2 ? pri : sec;
      const setv = tab === 2 ? setPri : setSec;
      if (!list.length) bars.push(<div key="x" className="desc-text abs" style={{ left: 20, top: 20, fontSize: 20 }}>Choose an archetype first.</div>);
      list.forEach((s, i) =>
        bars.push(<CheckBar key={s.id} skin={skin} x={BX} y={44 + i * R} wd={BW} noBox text={s.dn} state={s.id === val ? 'selected' : 'standard'} down={s.id === val} clickSounds={SELECT} hoverSounds onClick={() => { setv(s.id); setDesc({ text: s.lh || s.sh }); }} />),
      );
      end = 44 + Math.max(1, list.length) * R;
    }
    return (
      <>
        <TitleBar skin={skin} text="CREATE A BUILD" />
        <input className="abs body-text" value={name} maxLength={40} placeholder="Build name" onChange={(e) => setName(e.target.value)} style={{ ...nameStyle, left: PHONE_PAD, top: nameY, width: pg.w - 2 * PHONE_PAD, height: 50 }} />
        {versionPicker({ left: PHONE_PAD, top: rowY + 3, width: half, height: 50 })}
        <button className="info-button" style={{ left: 2 * PHONE_PAD + half, top: rowY, width: half }} onClick={() => useStore.getState().setMenu(true)}>
          Saved / Import
        </button>
        <PhoneTabs skin={skin} labels={['Origin', 'Archetype', 'Primary', 'Secondary']} active={tab} onChange={setTab} y={tabsY} clickSounds={SELECT} />
        <MenuFrame x={P.x} y={P.y} w={P.w} h={P.h} skin={skin} />
        <GameScroll skin={skin} left={P.x + 4} top={P.y + 8} width={P.w - 8} height={P.h - 16} barX={P.x + P.w}>
          <div style={{ position: 'relative', height: end + 20 }}>{bars}</div>
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
      {versionPicker({ right: 586, top: 6, width: 260, height: 44 })}
      <MenuFrame x={32} y={FRAME_TOP} w={1937} h={988} r25 outer skin={skin} />
      <InfoButton skin={skin} x={1000} y={FRAME_TOP} text="Saved builds / Import" onClick={() => useStore.getState().setMenu(true)} />
      {COLS.map((c) => (
        <MenuFrame key={c.x} x={c.x} y={TOP} w={c.w} h={H} skin={skin} />
      ))}
      <OriginAlignPane skin={skin} x={cOrigin.x} y={TOP} w={cOrigin.w} origin={origin} align={align} onOrigin={setOrigin} onAlign={setAlign} onDesc={setDesc} />
      {/* Build Type under Alignment, spaced like the pane's own headings and bars */}
      <SetTitle skin={skin} x={cOrigin.x + 20} y={TOP + 566} text="Build Type" />
      {typeBars(cOrigin.x + 60, TOP + 636, 47, cOrigin.w - 100, 1)}
      {levelField(cOrigin.x + 60, TOP + 728, 20)}
      <SetTitle skin={skin} x={cAt.x + 20} y={TOP + 18} text="Archetype" />
      <SetTitle skin={skin} x={cPri.x + 20} y={TOP + 18} text="Primary Power Set" />
      <SetTitle skin={skin} x={cSec.x + 20} y={TOP + 18} text="Secondary Power Set" />
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
