import { useMemo, useState } from 'react';
import type { GameData } from '../../data/gamedata.ts';
import type { BoostSet, Power } from '../../data/types.ts';
import type { SlottedEnh } from '../../engine/build.ts';
import { boostHelpText, boostPog, canSlot, defaultLevel, enhKind, enhLines, ioLevelRange, isLegacyDuplicate, levelsAbove, pieceName, type EnhKind } from '../../engine/enhance.ts';
import type { BuildEntry } from '../../engine/rules.ts';
import { CheckBar } from '../components/CheckBar.tsx';
import { MenuFrame, SetTitle, gameText } from '../components/Chrome.tsx';
import { PHONE_TAB_ROW, phoneTabRows, PhoneTabs } from '../components/Phone.tsx';
import { useStage } from '../components/Stage.tsx';
import { pressKeys } from '../press.ts';
import { icon, type Skin } from '../skin/skin.ts';
import { TitleText } from '../components/GameText.tsx';
import { TotalsRow } from '../components/TotalsPanel.tsx';
import { useEscape } from '../escape.ts';
import { smf } from '../smf.tsx';

type Tab = 'Training' | 'Origin' | 'Invention' | 'Sets' | 'Special';
const TABS: Tab[] = ['Training', 'Origin', 'Invention', 'Sets', 'Special'];
const SPECIAL: EnhKind[] = ['Hamidon', 'Hydra', 'Titan', 'DSync', 'Synthetic', 'Talisman'];

// the last enhancement placed (remembered per browser): an empty slot opens on its tab and set,
// and a newly chosen piece starts at its level (e.g. the next Steadfast Protection piece at 30)
const LAST_KEY = 'hcp.lastEnh';
interface LastEnh {
  tab: Tab;
  set?: number; // boost set id when placed from the Sets tab
  ioLevel?: number; // 0-based
}

function readLast(): LastEnh | null {
  try {
    const raw = localStorage.getItem(LAST_KEY);
    return raw ? (JSON.parse(raw) as LastEnh) : null;
  } catch {
    return null;
  }
}

function writeLast(v: LastEnh): void {
  try {
    localStorage.setItem(LAST_KEY, JSON.stringify(v));
  } catch {
    /* storage unavailable: nothing is remembered */
  }
}

function tabOf(k: EnhKind): Tab | null {
  if (k === 'Training' || k === 'Origin' || k === 'Invention') return k;
  if (k === 'Set') return 'Sets';
  if (SPECIAL.includes(k) || k === 'Other') return 'Special';
  return null;
}

interface Props {
  gd: GameData;
  skin: Skin;
  entry: BuildEntry;
  slot: number;
  originIndex: number;
  atId: number;
  refusal: (b: Power) => string | null; // BuildRules.slotRefusal for this slot
  lastLevel: number; // the build's last level (0-based): an IO works from 3 levels below its own
  onPlace: (e: SlottedEnh | undefined) => void;
  onClose: () => void;
}

/**
 * Enhancement picker for one slot: only enhancements the game would accept in this power for
 * this origin (power_IsValidBoost) and this build (one of each set piece per power, unique,
 * archetype and level-50 pieces), plus level / booster / attuned / relative-level controls and a
 * live preview of what the piece adds to the power.
 */
export function EnhancementPicker({ gd, skin, entry, slot, originIndex, atId, refusal, lastLevel, onPlace, onClose }: Props) {
  const current = entry.slots[slot]?.enh;
  // the piece already in this slot always shows, whatever the build now says about it
  const allowed = (b: Power) => b.id === current?.boost || !refusal(b);
  const valid = useMemo(() => {
    const list = gd.boosts.filter((b) => canSlot(gd, entry.power, b, originIndex) && (b.id === current?.boost || !refusal(b)));
    // hide legacy copies (fixed-level common IOs, the "Cone" range enhancements); one already in
    // this slot still shows
    return list.filter((b) => !isLegacyDuplicate(gd, b) || b.id === current?.boost);
  }, [gd, entry.power, originIndex, current?.boost, refusal]);
  const byTab = useMemo(() => {
    const m = new Map<Tab, Power[]>();
    for (const b of valid) {
      const t = tabOf(enhKind(gd, b));
      if (t) m.set(t, [...(m.get(t) ?? []), b]);
    }
    return m;
  }, [gd, valid]);
  const [last] = useState(readLast);
  const lastTab = !current && last && byTab.has(last.tab) ? last.tab : null;
  const firstTab = (current ? tabOf(enhKind(gd, gd.power(current.boost))) : lastTab) ?? TABS.find((t) => byTab.has(t)) ?? 'Training';
  const [tab, setTab] = useState<Tab>(firstTab);
  const stage = useStage();
  const { phone } = stage;
  const [sel, setSel] = useState<SlottedEnh | undefined>(current);
  const selBoost = sel ? gd.powerById.get(sel.boost) : undefined;
  const at = gd.archetype(atId);

  // sets eligible for this power, grouped by set type
  const sets = useMemo(() => {
    const ids = new Set<number>();
    for (const b of byTab.get('Sets') ?? []) {
      const ref = gd.boostSetOf.get(b.id);
      if (ref) ids.add(ref.set.id);
    }
    const list = [...ids].map((id) => gd.boostSetById.get(id)!).sort((a, b) => a.grp.localeCompare(b.grp) || a.dn.localeCompare(b.dn));
    return list;
  }, [gd, byTab]);
  const [setId, setSetId] = useState<number | undefined>(() => {
    if (current) return gd.boostSetOf.get(current.boost)?.set.id;
    // the remembered set, when this power takes it
    return lastTab === 'Sets' && last?.set !== undefined && sets.some((x) => x.id === last.set) ? last.set : undefined;
  });
  const chosenSet: BoostSet | undefined = setId !== undefined ? gd.boostSetById.get(setId) : undefined;

  /**
   * @return The piece's level range (0-based) when its level can be chosen, else null: the levels
   *   it is made at, up to 3 above the build's last level (boost_Effectiveness).
   */
  const rangeOf = (b: Power): [number, number] | null => {
    const r = ioLevelRange(gd, b);
    return r ? [r[0], Math.max(r[0], Math.min(r[1], lastLevel + levelsAbove(gd)))] : null;
  };
  const pickBoost = (b: Power) => {
    // start at the last placed level (else the highest), clamped to this piece's range
    const range = rangeOf(b);
    const ioLevel = range ? Math.max(range[0], Math.min(range[1], last?.ioLevel ?? range[1])) : defaultLevel(gd, b);
    setSel({ boost: b.id, ioLevel, rel: b.bie ? undefined : 0, boosters: 0 });
    setLvlDraft(null);
  };
  const place = () => {
    if (!sel) return;
    writeLast({ tab, set: tab === 'Sets' ? setId : undefined, ioLevel: sel.ioLevel ?? last?.ioLevel });
    onPlace(sel);
  };

  const values = selBoost && sel ? enhLines(gd, at, entry.power, sel, 49) : [];
  const ref = selBoost ? gd.boostSetOf.get(selBoost.id) : undefined;
  const levelRange = selBoost ? rangeOf(selBoost) : null;
  // the level box's text while it is being typed (null: show the selection's level)
  const [lvlDraft, setLvlDraft] = useState<string | null>(null);
  /** Clamp a typed level into the piece's range (an unreadable entry keeps the current level). */
  const commitLevel = () => {
    if (lvlDraft === null || !levelRange || !sel) return;
    const n = Math.round(Number(lvlDraft)) - 1;
    if (Number.isFinite(n)) setSel({ ...sel, ioLevel: Math.max(levelRange[0], Math.min(levelRange[1], n)) });
    setLvlDraft(null);
  };
  useEscape(onClose);
  // the piece's other version (crafted <-> attuned), when the build allows it here
  const alt = ref ? ref.set.slots[ref.letter]?.[ref.variant === 0 ? 1 : 0] : undefined;
  const attunedAlt = alt !== undefined && allowed(gd.power(alt)) ? alt : undefined;

  /**
   * Enhancements as a list, one row each: the icon and the name. A set's pieces drop the set name
   * the left-hand list already shows ("To Hit Buff/Recharge").
   *
   * @param setName The chosen set's name (Sets tab), stripped from the front of each piece's name.
   */
  const enhList = (list: Power[], setName?: string) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {list.map((b) => {
        const own = setName === undefined ? b.dn : pieceName(b, setName);
        // a set row stands for its piece: it stays lit when the attuned version is the one chosen
        const ref = gd.boostSetOf.get(b.id);
        const selRef = sel ? gd.boostSetOf.get(sel.boost) : undefined;
        const on = sel?.boost === b.id || (!!ref && !!selRef && ref.set.id === selRef.set.id && ref.letter === selRef.letter);
        return (
          <div
            key={b.id}
            data-testid={`boost:${b.id}`}
            onClick={() => pickBoost(b)}
            {...pressKeys(() => pickBoost(b), undefined, own || b.dn)}
            title={gameText(b.sh)}
            style={{ display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer', padding: phone ? '6px 8px' : '4px 10px', borderRadius: 10, border: `2px solid ${on ? '#00d919' : 'transparent'}`, background: on ? 'rgba(0,217,25,0.15)' : 'transparent' }}
          >
            {/* its own box: EnhIcon centers itself with auto margins, which a flex row would stretch */}
            <div style={{ flexShrink: 0 }}>
              <EnhIcon gd={gd} b={b} size={52} />
            </div>
            <div className="body-text" style={{ fontSize: phone ? 19 : 16, color: '#cfe8ff', lineHeight: 1.2 }}>
              {own || b.dn}
            </div>
          </div>
        );
      })}
    </div>
  );

  // Desktop: list beside details. Phone: the whole screen, tabs in rows, the list above the details.
  const tabList = TABS.filter((t) => byTab.has(t));
  const phoneG = () => {
    const W = stage.w;
    const bottom = stage.h - 36; // clear of the not-affiliated line
    const tabsY = 82;
    const listY = tabsY + (phoneTabRows(tabList.length) - 1) * PHONE_TAB_ROW + PHONE_TAB_ROW / 2 + 8;
    const btnY = bottom - 14 - 56;
    const room = btnY - 8 - listY;
    const listH = Math.round(room * 0.55);
    const detY = listY + listH + 8;
    const detH = btnY - 10 - detY;
    return { frame: [6, 6, W - 12, bottom - 6], title: [18, 18], tab: [0, tabsY, 0, 0], list: [16, listY, W - 32, listH], det: [10, detY, W - 20, detH], detIn: [22, detY + 10, W - 44], btnY, btnW: Math.min(140, (W - 60) / 3) };
  };
  const G = phone
    ? phoneG()
    : { frame: [200, 90, 1600, 940], title: [240, 110], tab: [265, 190, 300, 240], list: [230, 230, 1100, 690], det: [1350, 230, 420, 690], detIn: [1370, 245, 380], btnY: 940, btnW: 116 };
  const [fx, fy, fw, fh] = G.frame as [number, number, number, number];
  const [tx0, ty, tstep, twd] = G.tab as [number, number, number, number];
  const [lx, ly, lw, lh] = G.list as [number, number, number, number];
  const [dx, dy, dw, dh] = G.det as [number, number, number, number];
  const [ix, iy, iw] = G.detIn as [number, number, number];

  return (
    <div className="overlay" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()}>
        <MenuFrame x={fx} y={fy} w={fw} h={fh} r25 style={{ background: 'rgba(0,0,20,0.94)' }} />
        <SetTitle x={G.title[0]!} y={G.title[1]!} size={phone ? 24 : 34} width={fw - 60} text={`${entry.power.dn} -- slot ${slot + 1}`} />
        {phone ? (
          <PhoneTabs skin={skin} labels={tabList} active={tabList.indexOf(tab)} onChange={(i) => setTab(tabList[i]!)} y={ty} x={16} width={fw - 20} clickSounds={['powerselect2']} />
        ) : (
          tabList.map((t, i) => <CheckBar key={t} testId={`tab:${t}`} skin={skin} x={tx0 + i * tstep} y={ty} wd={twd} scale={1} text={t} state={t === tab ? 'selected' : 'standard'} down={t === tab} onClick={() => setTab(t)} />)
        )}
        <div className={tab === 'Sets' ? 'abs' : 'abs scroll-y'} style={{ left: lx, top: ly, width: lw, height: lh }}>
          {tab === 'Sets' ? (
            // the set names and the chosen set's pieces scroll separately
            <div style={{ display: 'flex', gap: 16, flexDirection: phone ? 'column' : 'row', height: '100%' }}>
              <div className="scroll-y" style={phone ? { maxHeight: Math.round(lh * 0.45), flexShrink: 0 } : { width: 430, height: '100%' }}>
                {sets.map((s, i) => (
                  <div key={s.id}>
                    {i === 0 || sets[i - 1]!.grp !== s.grp ? (
                      <TitleText style={{ fontSize: 18, marginTop: 8 }}>
                        {s.grp}
                      </TitleText>
                    ) : null}
                    <div
                      data-testid={`pickerset:${s.id}`}
                      onClick={() => setSetId(s.id)}
                      {...pressKeys(() => setSetId(s.id), undefined, s.dn)}
                      className="body-text"
                      style={{ cursor: 'pointer', padding: phone ? '12px 8px' : '3px 8px', borderRadius: 8, color: s.id === setId ? '#88ffaa' : '#cfe8ff', background: s.id === setId ? 'rgba(0,217,25,0.18)' : 'transparent', fontSize: phone ? 19 : 16 }}
                    >
                      {s.dn} <span style={{ color: '#8fa1b8', fontSize: 13 }}>({s.minL}-{s.maxL})</span>
                    </div>
                  </div>
                ))}
              </div>
              <div className="scroll-y" style={{ flex: 1, minHeight: 0, height: phone ? undefined : '100%' }}>
                {chosenSet ? enhList(chosenSet.slots.map((v) => gd.power(v[0]!)).filter((b) => canSlot(gd, entry.power, b, originIndex) && allowed(b)), chosenSet.dn) : <div className="desc-text">Choose a set.</div>}
              </div>
            </div>
          ) : (
            enhList(byTab.get(tab) ?? [])
          )}
        </div>
        {/* selection details and controls */}
        <MenuFrame x={dx} y={dy} w={dw} h={dh} />
        <div className="abs body-text scroll-y" style={{ left: ix, top: iy, width: iw, height: dh - (phone ? 20 : 30), fontSize: phone ? 19 : 16, color: '#cfe8ff' }}>
          {selBoost ? (
            <>
              <EnhIcon gd={gd} b={selBoost} size={phone ? 64 : 80} />
              <TitleText style={{ fontSize: 20, whiteSpace: 'normal' }}>
                {selBoost.dn}
              </TitleText>
              {/* the choices for this enhancement on one row: level (or relative level), attuned, boosters */}
              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', columnGap: 18, rowGap: 6, margin: '8px 0' }}>
                {levelRange ? (
                  <label>
                    Level{' '}
                    <input
                      type="number"
                      data-testid="picker:level"
                      min={levelRange[0] + 1}
                      max={levelRange[1] + 1}
                      value={lvlDraft ?? String((sel?.ioLevel ?? levelRange[1]) + 1)}
                      onChange={(e) => {
                        // keep what is typed ("2" on the way to "25"); apply at once only when in range
                        const v = e.target.value;
                        const n = Number(v) - 1;
                        if (v !== '' && Number.isInteger(n) && n >= levelRange[0] && n <= levelRange[1]) {
                          setSel({ ...sel!, ioLevel: n });
                          setLvlDraft(null);
                        } else setLvlDraft(v);
                      }}
                      onBlur={commitLevel}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') commitLevel();
                      }}
                      style={{ width: phone ? 90 : 70, height: phone ? 44 : undefined, background: '#000', color: '#fff', border: '1px solid #4f94ff' }}
                    />
                  </label>
                ) : selBoost.bup ? (
                  <span style={{ color: '#8fa1b8' }}>Scales with your level</span>
                ) : (
                  <label>
                    Relative level{' '}
                    <select data-testid="picker:rel" value={sel?.rel ?? 0} onChange={(e) => setSel({ ...sel!, rel: Number(e.target.value) })} style={{ height: phone ? 44 : undefined, background: '#000', color: '#fff' }}>
                      {[3, 2, 1, 0, -1, -2, -3].map((r) => (
                        <option key={r} value={r}>
                          {r > 0 ? `+${r}` : r}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                {attunedAlt !== undefined ? (
                  <label style={phone ? { display: 'inline-flex', alignItems: 'center', gap: 8, minHeight: 44 } : undefined}>
                    <input type="checkbox" data-testid="picker:attuned" checked={!!selBoost.bup} onChange={() => pickBoost(gd.power(attunedAlt))} style={phone ? { width: 28, height: 28, margin: 0 } : undefined} /> Attuned
                  </label>
                ) : null}
                {selBoost.bb ? (
                  <label>
                    Boosters{' '}
                    <select data-testid="picker:boosters" value={sel?.boosters ?? 0} onChange={(e) => setSel({ ...sel!, boosters: Number(e.target.value) })} style={{ height: phone ? 44 : undefined, background: '#000', color: '#fff' }}>
                      {[0, 1, 2, 3, 4, 5].map((r) => (
                        <option key={r} value={r}>
                          +{r}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
              </div>
              {/* the game's tooltip: the short help in blue, then the long help with this piece's values
                  filled in (as the build screen's enhancement tooltip shows it) */}
              <div style={{ margin: '6px 0', color: '#7fd3ff' }}>{gameText(selBoost.sh)}</div>
              {sel ? <div style={{ margin: '6px 0 10px', color: '#ffffff', lineHeight: 1.3 }}>{smf(boostHelpText(gd, at, sel, 49))}</div> : null}
              {values.length ? (
                <>
                  {/* about two lines of space after the description, so the panel reads less busy */}
                  <TitleText style={{ fontSize: 16, marginTop: phone ? 44 : 32 }}>
                    Adds to this power (before ED)
                  </TitleText>
                  {/* laid out like the build overview's totals: label left, value right (green: it helps);
                      nothing here expands, so no +/- column */}
                  {values.map((v) => (
                    <TotalsRow key={v.label} label={v.label} value={`${(v.value * 100).toFixed(2)}%`} tone={v.value} noMark />
                  ))}
                </>
              ) : null}
            </>
          ) : (
            <div className="desc-text">Choose an enhancement.</div>
          )}
        </div>
        {/* equal-width buttons with equal gaps, centered under the details frame */}
        <div className="abs" style={{ left: dx, top: G.btnY, width: dw, display: 'flex', justifyContent: 'center', gap: 14 }}>
          {(
            [
              ['Remove', () => onPlace(undefined), !current],
              ['Cancel', onClose, false],
              ['Place', place, !sel],
            ] as const
          ).map(([label, act, off]) => (
            <button key={label} data-testid={`picker:${label.toLowerCase()}`} className="info-button" style={{ position: 'static', width: G.btnW, padding: 0 }} onClick={act} disabled={off}>
              {label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * Enhancement icon as drawEnhancementOriginLevelEx layers it: the left / right origin or
 * invention frame halves, the type disc (pog, 48/64) and the 46/64 icon on top.
 */
export function EnhIcon({ gd, b, size }: { gd: GameData; b: Power; size: number }) {
  const inner = (size * 46) / 64;
  const pogSize = (size * 48) / 64;
  const pog = boostPog(gd, b);
  return (
    <div style={{ position: 'relative', width: size, height: size, margin: '0 auto' }}>
      {b.bf?.[0] ? <img src={icon('enh', b.bf[0])} width={size / 2} height={size} alt="" style={{ position: 'absolute', left: 0, top: 0 }} /> : null}
      {b.bf?.[1] ? <img src={icon('enh', b.bf[1])} width={size / 2} height={size} alt="" style={{ position: 'absolute', left: size / 2, top: 0 }} /> : null}
      {pog ? <img src={icon('enh', pog)} width={pogSize} height={pogSize} alt="" style={{ position: 'absolute', left: (size - pogSize) / 2, top: (size - pogSize) / 2 }} /> : null}
      <img src={icon('enh', b.icon)} width={inner} height={inner} alt="" style={{ position: 'absolute', left: (size - inner) / 2, top: (size - inner) / 2 }} />
    </div>
  );
}
