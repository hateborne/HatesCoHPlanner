import { useMemo, useState } from 'react';
import type { GameData } from '../../data/gamedata.ts';
import type { BoostSet, Power } from '../../data/types.ts';
import type { SlottedEnh } from '../../engine/build.ts';
import { canSlot, defaultLevel, enhKind, enhValues, setLevelRange, type EnhKind } from '../../engine/enhance.ts';
import type { BuildEntry } from '../../engine/rules.ts';
import { CheckBar } from '../components/CheckBar.tsx';
import { MenuFrame, SetTitle, gameText } from '../components/Chrome.tsx';
import { useStage } from '../components/Stage.tsx';
import { icon, type Skin } from '../skin/skin.ts';

type Tab = 'Training' | 'Origin' | 'Invention' | 'Sets' | 'Special';
const TABS: Tab[] = ['Training', 'Origin', 'Invention', 'Sets', 'Special'];
const SPECIAL: EnhKind[] = ['Hamidon', 'Hydra', 'Titan', 'DSync', 'Synthetic', 'Talisman'];

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
  onPlace: (e: SlottedEnh | undefined) => void;
  onClose: () => void;
}

/**
 * Enhancement picker for one slot: only enhancements the game would accept in this power for
 * this origin (power_IsValidBoost), plus level / booster / attuned / relative-level controls
 * and a live preview of what the piece adds to the power.
 */
export function EnhancementPicker({ gd, skin, entry, slot, originIndex, atId, onPlace, onClose }: Props) {
  const current = entry.slots[slot]?.enh;
  const valid = useMemo(() => {
    const list = gd.boosts.filter((b) => canSlot(gd, entry.power, b, originIndex));
    // hide fixed-level legacy duplicates of the common IOs (Crafted_X_10 ... _50)
    return list.filter((b) => !/^Crafted_[A-Za-z_]+_\d+$/.test(b.n.split('.')[1] ?? '') || gd.boostSetOf.has(b.id));
  }, [gd, entry.power, originIndex]);
  const byTab = useMemo(() => {
    const m = new Map<Tab, Power[]>();
    for (const b of valid) {
      const t = tabOf(enhKind(gd, b));
      if (t) m.set(t, [...(m.get(t) ?? []), b]);
    }
    return m;
  }, [gd, valid]);
  const firstTab = (current ? tabOf(enhKind(gd, gd.power(current.boost))) : null) ?? TABS.find((t) => byTab.has(t)) ?? 'Training';
  const [tab, setTab] = useState<Tab>(firstTab);
  const { phone } = useStage();
  const [sel, setSel] = useState<SlottedEnh | undefined>(current);
  const [setId, setSetId] = useState<number | undefined>(current ? gd.boostSetOf.get(current.boost)?.set.id : undefined);
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
  const chosenSet: BoostSet | undefined = setId !== undefined ? gd.boostSetById.get(setId) : undefined;
  const taken = new Set(entry.slots.filter((s, i) => i !== slot && s.enh).map((s) => s.enh!.boost));

  const pickBoost = (b: Power) => {
    setSel({ boost: b.id, ioLevel: defaultLevel(gd, b), rel: b.bie ? undefined : 0, boosters: 0 });
  };

  const values = selBoost && sel ? enhValues(gd, at, entry.power, sel, 49) : [];
  const ref = selBoost ? gd.boostSetOf.get(selBoost.id) : undefined;
  const levelRange: [number, number] | null =
    selBoost?.bie && !selBoost.bup ? (ref ? setLevelRange(ref.set) : [9, Math.min(49, (selBoost.maxBL ?? 50) - 1)]) : null;
  const attunedAlt = ref ? ref.set.slots[ref.letter]?.[ref.variant === 0 ? 1 : 0] : undefined;

  const grid = (list: Power[]) => (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
      {list.map((b) => (
        <div
          key={b.id}
          onClick={() => pickBoost(b)}
          title={gameText(b.sh)}
          style={{ width: 128, cursor: 'pointer', textAlign: 'center', padding: 6, borderRadius: 10, border: `2px solid ${sel?.boost === b.id ? '#00d919' : 'transparent'}`, background: sel?.boost === b.id ? 'rgba(0,217,25,0.15)' : 'transparent' }}
        >
          <EnhIcon b={b} size={64} />
          <div className="body-text" style={{ fontSize: 13, color: '#cfe8ff', lineHeight: 1.15 }}>
            {b.dn}
          </div>
        </div>
      ))}
    </div>
  );

  // Desktop: list beside details. Phone: list above details on the portrait canvas.
  const G = phone
    ? { frame: [20, 90, 960, 1610], title: [40, 105], tab: [50, 195, 188, 140], list: [40, 240, 920, 800], det: [20, 1060, 960, 520], detIn: [40, 1075, 920], btnY: 1625, btnX: [260, 500, 740] }
    : { frame: [200, 90, 1600, 940], title: [240, 110], tab: [265, 190, 300, 240], list: [230, 230, 1100, 690], det: [1350, 230, 420, 690], detIn: [1370, 245, 380], btnY: 940, btnX: [1390, 1520, 1650] };
  const [fx, fy, fw, fh] = G.frame as [number, number, number, number];
  const [tx0, ty, tstep, twd] = G.tab as [number, number, number, number];
  const [lx, ly, lw, lh] = G.list as [number, number, number, number];
  const [dx, dy, dw, dh] = G.det as [number, number, number, number];
  const [ix, iy, iw] = G.detIn as [number, number, number];

  return (
    <div className="overlay" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()}>
        <MenuFrame x={fx} y={fy} w={fw} h={fh} r25 style={{ background: 'rgba(0,0,20,0.94)' }} />
        <SetTitle x={G.title[0]!} y={G.title[1]!} size={phone ? 28 : 34} width={fw - 60} text={`${entry.power.dn} -- slot ${slot + 1}`} />
        {TABS.filter((t) => byTab.has(t)).map((t, i) => (
          <CheckBar key={t} skin={skin} x={tx0 + i * tstep} y={ty} wd={twd} scale={1} text={t} state={t === tab ? 'selected' : 'standard'} down={t === tab} onClick={() => setTab(t)} />
        ))}
        <div className="abs scroll-y" style={{ left: lx, top: ly, width: lw, height: lh }}>
          {tab === 'Sets' ? (
            <div style={{ display: 'flex', gap: 16, flexDirection: phone ? 'column' : 'row' }}>
              <div style={phone ? { maxHeight: 330, overflowY: 'auto' } : { width: 430 }}>
                {sets.map((s, i) => (
                  <div key={s.id}>
                    {i === 0 || sets[i - 1]!.grp !== s.grp ? (
                      <div className="title-text" style={{ fontSize: 18, marginTop: 8 }}>
                        {s.grp}
                      </div>
                    ) : null}
                    <div
                      onClick={() => setSetId(s.id)}
                      className="body-text"
                      style={{ cursor: 'pointer', padding: '3px 8px', borderRadius: 8, color: s.id === setId ? '#88ffaa' : '#cfe8ff', background: s.id === setId ? 'rgba(0,217,25,0.18)' : 'transparent', fontSize: 16 }}
                    >
                      {s.dn} <span style={{ color: '#8fa1b8', fontSize: 13 }}>({s.minL}-{s.maxL})</span>
                    </div>
                  </div>
                ))}
              </div>
              <div style={{ flex: 1 }}>
                {chosenSet ? grid(chosenSet.slots.map((v) => gd.power(v[0]!)).filter((b) => canSlot(gd, entry.power, b, originIndex) && !taken.has(b.id))) : <div className="desc-text">Choose a set.</div>}
              </div>
            </div>
          ) : (
            grid((byTab.get(tab) ?? []).filter((b) => !taken.has(b.id) || b.id === current?.boost))
          )}
        </div>
        {/* selection details and controls */}
        <MenuFrame x={dx} y={dy} w={dw} h={dh} />
        <div className="abs body-text scroll-y" style={{ left: ix, top: iy, width: iw, height: dh - 30, fontSize: phone ? 22 : 16, color: '#cfe8ff' }}>
          {selBoost ? (
            <>
              <EnhIcon b={selBoost} size={80} />
              <div className="title-text" style={{ fontSize: 20, whiteSpace: 'normal' }}>
                {selBoost.dn}
              </div>
              <div style={{ margin: '6px 0', color: '#7fd3ff' }}>{gameText(selBoost.sh)}</div>
              {levelRange ? (
                <label style={{ display: 'block', margin: '8px 0' }}>
                  Level{' '}
                  <input
                    type="number"
                    min={levelRange[0] + 1}
                    max={levelRange[1] + 1}
                    value={(sel?.ioLevel ?? levelRange[1]) + 1}
                    onChange={(e) => setSel({ ...sel!, ioLevel: Math.max(levelRange[0], Math.min(levelRange[1], Number(e.target.value) - 1)) })}
                    style={{ width: 70, background: '#000', color: '#fff', border: '1px solid #4f94ff' }}
                  />
                </label>
              ) : selBoost.bup ? (
                <div style={{ margin: '8px 0', color: '#8fa1b8' }}>Attuned: scales with your level</div>
              ) : (
                <label style={{ display: 'block', margin: '8px 0' }}>
                  Relative level{' '}
                  <select value={sel?.rel ?? 0} onChange={(e) => setSel({ ...sel!, rel: Number(e.target.value) })} style={{ background: '#000', color: '#fff' }}>
                    {[3, 2, 1, 0, -1, -2, -3].map((r) => (
                      <option key={r} value={r}>
                        {r > 0 ? `+${r}` : r}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {selBoost.bb ? (
                <label style={{ display: 'block', margin: '8px 0' }}>
                  Boosters{' '}
                  <select value={sel?.boosters ?? 0} onChange={(e) => setSel({ ...sel!, boosters: Number(e.target.value) })} style={{ background: '#000', color: '#fff' }}>
                    {[0, 1, 2, 3, 4, 5].map((r) => (
                      <option key={r} value={r}>
                        +{r}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              {attunedAlt !== undefined ? (
                <label style={{ display: 'block', margin: '8px 0' }}>
                  <input type="checkbox" checked={!!selBoost.bup} onChange={() => pickBoost(gd.power(attunedAlt))} /> Attuned
                </label>
              ) : null}
              <div className="title-text" style={{ fontSize: 16, marginTop: 10 }}>
                Adds to this power (before ED)
              </div>
              {values.map((v, i) => (
                <div key={i}>
                  {gd.attribName.get(v.attrib)?.replace(/_/g, ' ')}: +{(v.value * 100).toFixed(2)}%
                </div>
              ))}
            </>
          ) : (
            <div className="desc-text">Choose an enhancement.</div>
          )}
        </div>
        <button className="info-button" style={{ left: G.btnX[0], top: G.btnY }} onClick={() => onPlace(undefined)} disabled={!current}>
          Remove
        </button>
        <button className="info-button" style={{ left: G.btnX[1], top: G.btnY }} onClick={onClose}>
          Cancel
        </button>
        <button className="info-button" style={{ left: G.btnX[2], top: G.btnY }} onClick={() => onPlace(sel)} disabled={!sel}>
          Place
        </button>
      </div>
    </div>
  );
}

/** Enhancement icon: 46/64 icon centered inside the left and right origin/IO frame halves. */
export function EnhIcon({ b, size }: { b: Power; size: number }) {
  const inner = (size * 46) / 64;
  return (
    <div style={{ position: 'relative', width: size, height: size, margin: '0 auto' }}>
      <img src={icon('enh', b.icon)} width={inner} height={inner} alt="" style={{ position: 'absolute', left: (size - inner) / 2, top: (size - inner) / 2 }} />
      {b.bf?.[0] ? <img src={icon('enh', b.bf[0])} width={size / 2} height={size} alt="" style={{ position: 'absolute', left: 0, top: 0 }} /> : null}
      {b.bf?.[1] ? <img src={icon('enh', b.bf[1])} width={size / 2} height={size} alt="" style={{ position: 'absolute', left: size / 2, top: 0 }} /> : null}
    </div>
  );
}
