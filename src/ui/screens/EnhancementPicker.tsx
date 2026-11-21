import { useEffect, useMemo, useRef, useState } from 'react';
import { create } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import type { GameData } from '../../data/gamedata.ts';
import type { BoostSet, Power } from '../../data/types.ts';
import type { SlottedEnh } from '../../engine/build.ts';
import { capLevel } from '../../engine/actions.ts';
import { boostHelpText, boostPog, canSlot, defaultLevel, enhKind, enhLines, ioLevelRange, isLegacyDuplicate, pieceName, powerStrength, strengthLines, type EnhKind } from '../../engine/enhance.ts';
import { placements, type Placement } from '../../engine/placing.ts';
import type { BuildEntry } from '../../engine/rules.ts';
import { setBonusLines, type SetBonusLine } from '../../engine/setbonus.ts';
import { CheckBar, SwitchBox } from '../components/CheckBar.tsx';
import { FadingText, MenuFrame, SetTitle, gameText } from '../components/Chrome.tsx';
import { PHONE_TAB_ROW, PhoneTabStrip } from '../components/Phone.tsx';
import { PhoneSetTipLayer } from '../components/PhoneTip.tsx';
import { SetTipLayer, usePointer } from '../components/PowerTip.tsx';
import { useStage } from '../components/Stage.tsx';
import { useHover } from '../hover.ts';
import { longPress, pressKeys, touchPress } from '../press.ts';
import { useStore } from '../../state/store.ts';
import { fitScale, FONTS } from '../skin/metrics.ts';
import { icon, type Skin } from '../skin/skin.ts';
import { TitleText } from '../components/GameText.tsx';
import { HeadMark, TotalsRow } from '../components/TotalsPanel.tsx';
import { useEscape } from '../escape.ts';
import { smf } from '../smf.tsx';

type Tab = 'Training' | 'Origin' | 'Invention' | 'Sets' | 'Special';
const TABS: Tab[] = ['Training', 'Origin', 'Invention', 'Sets', 'Special'];
const SPECIAL: EnhKind[] = ['Hamidon', 'Hydra', 'Titan', 'DSync', 'Synthetic', 'Talisman'];
// the Special tab's groups in order: the Homecoming wiki's Special Enhancements comparison (Hydra,
// Titan, Hamidon, D-Sync), then the kinds it leaves out (the owner's choice)
const SPECIAL_GROUPS: { kind: EnhKind; title: string }[] = [
  { kind: 'Hydra', title: 'Hydra' },
  { kind: 'Titan', title: 'Titan' },
  { kind: 'Hamidon', title: 'Hamidon' },
  { kind: 'DSync', title: 'D-Sync' },
  { kind: 'Synthetic', title: 'Synthetic Hamidon' },
  { kind: 'Talisman', title: 'Talisman' },
  { kind: 'Other', title: 'Other' },
];

// the Sets and Special groups the player closed ("Sets:Defense Sets", "Special:Hydra"), per browser
const CLOSED_KEY = 'hcp.pickerClosed';

function readClosed(): Set<string> {
  try {
    const raw = localStorage.getItem(CLOSED_KEY);
    const v: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
  } catch {
    return new Set();
  }
}

function writeClosed(v: Set<string>): void {
  try {
    localStorage.setItem(CLOSED_KEY, JSON.stringify([...v]));
  } catch {
    /* storage unavailable: the groups just aren't remembered */
  }
}

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

/** A piece to put in one of the power's slots when Place is pressed (undefined: empty the slot). */
export type { Placement };

interface Props {
  gd: GameData;
  skin: Skin;
  entry: BuildEntry;
  entries: BuildEntry[]; // the build's entries (BuildRules.entries()): a set's bonuses are counted across them (rule of five)
  bonusLevel: number; // 0-based level the totals count set bonuses at
  slot: number;
  originIndex: number;
  atId: number;
  refusal: (b: Power) => string | null; // BuildRules.slotRefusal for this slot
  lastLevel: number; // the build's last level (0-based): an IO works from 3 levels below its own
  onPlace: (p: Placement[]) => void;
  /** @return Why several pieces can't go in together as placed (the game's refusal for one of them), or null. */
  checkPlace?: (p: Placement[]) => string | null;
  onClose: () => void;
}

// the level switch's hover text
const AT_CAP_HELP =
  "Puts each enhancement in at the highest level this build can use: the set's top level, or your build level + 3, whichever is lower. While it's on, the level box is greyed, and enhancements rise with the build when it levels further.";

// the multi-selection's headings: the mock-up's yellow, in the body font
const MULTI_HEAD = { color: '#ffd200', fontWeight: 'bold' } as const;

// "FULL!" over a piece Ctrl+Clicked past the slots there are: the slot screen's fadingText, a little smaller
const FULL_SCALE = 1;
// a chosen piece's colour: its row's ring, and the count of chosen pieces beside a set's name
const CHOSEN_COLOR = '#00d919';

// Hovers on the picker's greyed level box so far (0: none yet). Kept out of the picker's own state,
// so a hover redraws only the label that glows, not the whole picker and its list.
const useCapGlow = create<{ n: number }>(() => ({ n: 0 }));

/** The Max Slot/Build Level label: each hover on the greyed level box makes it glow twice. */
function CapLabel() {
  const n = useCapGlow((g) => g.n);
  // keyed by the count: each hover restarts the glow
  return (
    <span key={n} className={n ? 'cap-glow' : undefined}>
      Max Slot/Build Level
    </span>
  );
}

/**
 * Enhancement picker for one slot: only enhancements the game would accept in this power for
 * this origin (power_IsValidBoost) and this build (one of each set piece per power, unique,
 * archetype and level-50 pieces), plus level / booster / attuned / relative-level controls and a
 * live preview of what the piece adds to the power.
 *
 * Planner extras: "Max Slot/Build Level" at the top right (a browser setting) puts every
 * piece in at the highest level the build can use and greys the level box. Ctrl+Click (phones: a
 * tap while Select several is ticked, which a long press on a piece ticks) picks several pieces at once, up to the clicked slot plus the
 * power's empty slots; Place fills those slots left to right in the list's order, so no piece already
 * slotted elsewhere in the power is replaced. Several pieces share the level, attuned and booster
 * controls, and the details show their total after ED above each piece's own values. A set's name
 * shows the set's bonuses when hovered (phones: long pressed).
 *
 * Phones: the categories are one row that scrolls sideways, the set names sit in a frame of
 * their own, and the details leave out the piece's icon and name (its row is lit in the list).
 */
export function EnhancementPicker({ gd, skin, entry, entries, bonusLevel, slot, originIndex, atId, refusal, lastLevel, onPlace, checkPlace, onClose }: Props) {
  const { atCap, setAtCap } = useStore(useShallow((s) => ({ atCap: s.enhAtCap, setAtCap: s.setEnhAtCap })));
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
  // the Special tab's pieces in their groups (SPECIAL_GROUPS), empty groups left out
  const specialGroups = useMemo(() => {
    const list = byTab.get('Special') ?? [];
    return SPECIAL_GROUPS.map((g) => ({ ...g, list: list.filter((b) => enhKind(gd, b) === g.kind) })).filter((g) => g.list.length);
  }, [gd, byTab]);
  const [last] = useState(readLast);
  const lastTab = !current && last && byTab.has(last.tab) ? last.tab : null;
  const firstTab = (current ? tabOf(enhKind(gd, gd.power(current.boost))) : lastTab) ?? TABS.find((t) => byTab.has(t)) ?? 'Training';
  const [tab, setTab] = useState<Tab>(firstTab);
  const stage = useStage();
  const { phone } = stage;
  const at = gd.archetype(atId);

  /**
   * @return The piece's level range (0-based) when its level can be chosen, else null: the levels
   *   it is made at, up to 3 above the build's last level (boost_Effectiveness).
   */
  const rangeOf = (b: Power): [number, number] | null => {
    const r = ioLevelRange(gd, b);
    const hi = capLevel(gd, b, lastLevel);
    return r && hi !== null ? [r[0], hi] : null;
  };
  /** @return The piece at the highest level the build can use (Max Slot/Build Level). */
  const capped = (e: SlottedEnh): SlottedEnh => {
    const r = rangeOf(gd.power(e.boost));
    return r ? { ...e, ioLevel: r[1] } : e;
  };
  // the chosen pieces: one, or several (Ctrl+Click); the slot's own piece to start with, as it is
  // (Max Slot/Build Level applies to pieces chosen here, never to one merely looked at)
  const [picks, setPicks] = useState<SlottedEnh[]>(() => (current ? [current] : []));
  // why the pieces chosen can't all go in where Place would put them (shown above the buttons)
  const [placeError, setPlaceError] = useState<string | null>(null);
  const sel = picks[0];
  const multi = picks.length > 1;
  const selBoost = sel ? gd.powerById.get(sel.boost) : undefined;
  // the level box's text while it is being typed (null: show the chosen pieces' level)
  const [lvlDraft, setLvlDraft] = useState<string | null>(null);
  useEffect(() => useCapGlow.setState({ n: 0 }), []); // a picker just opened has had no hover yet
  // phones: taps add and remove pieces, as Ctrl+Click does
  const [several, setSeveral] = useState(false);
  // "FULL!" over the pieces clicked past the slots there are
  const [fulls, setFulls] = useState<{ id: number; boost: number }[]>([]);
  const fullId = useRef(0);
  // the slots several pieces go into: the clicked one and the power's empty ones, left to right
  const targets = [...new Set([slot, ...entry.slots.flatMap((s, i) => (s.enh ? [] : [i]))])].sort((a, b) => a - b);

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
  // the sets by set type, in the list's order
  const setGroups = useMemo(() => {
    const m = new Map<string, BoostSet[]>();
    for (const st of sets) m.set(st.grp, [...(m.get(st.grp) ?? []), st]);
    return [...m];
  }, [sets]);
  // the Sets and Special groups closed: as last left in this browser, but the group holding the
  // slot's piece (or the remembered set) opens
  const [closed, setClosed] = useState(() => {
    const c = readClosed();
    if (chosenSet) c.delete(`Sets:${chosenSet.grp}`);
    const own = current ? gd.power(current.boost) : undefined;
    const kind = own ? enhKind(gd, own) : undefined;
    const g = kind ? SPECIAL_GROUPS.find((x) => x.kind === kind) : undefined;
    if (g) c.delete(`Special:${g.title}`);
    return c;
  });
  /** Open or close a group, and remember that group only (a group opened for the slot's piece keeps its saved state). */
  const toggleGroup = (key: string) => {
    const next = new Set(closed);
    const nowClosed = !next.delete(key);
    if (nowClosed) next.add(key);
    setClosed(next);
    const saved = readClosed();
    if (nowClosed) saved.add(key);
    else saved.delete(key);
    writeClosed(saved);
  };
  // where each piece sits in the lists (tabs in order, sets in order, a set's pieces in order): the
  // order several pieces fill the slots in
  const order = useMemo(() => {
    const m = new Map<number, number>();
    const add = (id: number) => m.has(id) || m.set(id, m.size);
    for (const t of TABS) {
      if (t === 'Sets') for (const st of sets) for (const v of st.slots) v.forEach(add);
      else if (t === 'Special') for (const g of specialGroups) for (const b of g.list) add(b.id);
      else for (const b of byTab.get(t) ?? []) add(b.id);
    }
    return m;
  }, [sets, specialGroups, byTab]);

  /** @return A list row's identity: a set piece's letter (crafted or attuned), else the enhancement. */
  const rowOf = (id: number) => {
    const r = gd.boostSetOf.get(id);
    return r ? `${r.set.id}:${r.letter}` : `b${id}`;
  };
  /** @return The piece's other version (crafted <-> attuned), when the build allows it here. */
  const altOf = (b: Power): number | undefined => {
    const r = gd.boostSetOf.get(b.id);
    const alt = r ? r.set.slots[r.letter]?.[r.variant === 0 ? 1 : 0] : undefined;
    return alt !== undefined && allowed(gd.power(alt)) ? alt : undefined;
  };
  /**
   * A piece as it is chosen: at the cap with Max Slot/Build Level on, else at `like`'s level
   * (the other pieces chosen with it) or the last placed one, clamped to its range.
   *
   * @param b The piece.
   * @param like A piece already chosen, whose level and boosters it takes.
   */
  const make = (b: Power, like?: SlottedEnh): SlottedEnh => {
    const range = rangeOf(b);
    const want = like?.ioLevel ?? last?.ioLevel;
    const ioLevel = range ? (atCap ? range[1] : Math.max(range[0], Math.min(range[1], want ?? range[1]))) : defaultLevel(gd, b);
    return { boost: b.id, ioLevel, rel: b.bie ? undefined : (like?.rel ?? 0), boosters: b.bb ? (like?.boosters ?? 0) : 0 };
  };
  /**
   * A click on a piece: chooses it alone, or with `add` (Ctrl+Click, Select several) adds it to the
   * pieces chosen, or takes it out again. Past the slots there are, "FULL!" shows over it.
   */
  const choose = (b: Power, add: boolean) => {
    setLvlDraft(null);
    setPlaceError(null);
    if (!add) {
      setPicks([make(b)]);
      return;
    }
    const k = picks.findIndex((p) => rowOf(p.boost) === rowOf(b.id));
    if (k >= 0) {
      setPicks(picks.filter((_, i) => i !== k));
      return;
    }
    if (picks.length >= targets.length) {
      const id = ++fullId.current;
      setFulls((f) => [...f, { id, boost: b.id }]);
      window.setTimeout(() => setFulls((f) => f.filter((x) => x.id !== id)), 1000);
      return;
    }
    // the shared controls' settings: the Attuned box, the level, relative level and boosters shown
    const like: SlottedEnh = { boost: b.id, ioLevel: ranged[0]?.ioLevel, rel: relPick?.rel, boosters: boosted?.boosters };
    const alt = attuned && !b.bup ? altOf(b) : undefined;
    setPicks([...picks, make(alt !== undefined ? gd.power(alt) : b, like)]);
  };
  /** @return Where Place would put the chosen pieces: each with its slot (none while nothing is chosen). */
  const placing = (): Placement[] => placements(picks, { slot, targets, current, order: (id) => order.get(id) ?? Infinity, row: rowOf });
  const place = () => {
    if (!picks.length) return;
    // remember a level only when it was chosen (a pre-order piece's fixed level 1 doesn't count)
    const chosen = picks.find((p) => rangeOf(gd.power(p.boost)))?.ioLevel;
    writeLast({ tab, set: tab === 'Sets' ? setId : undefined, ioLevel: chosen ?? last?.ioLevel });
    const placed = placing();
    // several pieces: each judged in its own slot with the others in (the list was checked for the clicked slot only)
    const why = multi ? (checkPlace?.(placed) ?? null) : null;
    if (why) {
      setPlaceError(why);
      return;
    }
    onPlace(placed);
  };

  // the shared controls: each sets every chosen piece it applies to
  const ranged = picks.filter((p) => rangeOf(gd.power(p.boost)));
  const levelRange: [number, number] | null = ranged.length
    ? [Math.min(...ranged.map((p) => rangeOf(gd.power(p.boost))![0])), Math.max(...ranged.map((p) => rangeOf(gd.power(p.boost))![1]))]
    : null;
  // the chosen pieces stand at different levels (one with none stored reads as the top of its range,
  // as the level box shows it)
  const mixedLevels = new Set(ranged.map((p) => p.ioLevel ?? rangeOf(gd.power(p.boost))![1])).size > 1;
  const setLevel = (n: number) =>
    setPicks(
      picks.map((p) => {
        const r = rangeOf(gd.power(p.boost));
        return r ? { ...p, ioLevel: Math.max(r[0], Math.min(r[1], n)) } : p;
      }),
    );
  const relPick = picks.find((p) => !gd.power(p.boost).bie);
  const boosted = picks.find((p) => gd.power(p.boost).bb);
  const withAlt = picks.filter((p) => altOf(gd.power(p.boost)) !== undefined);
  const attuned = withAlt.some((p) => gd.power(p.boost).bup);
  const toggleAttuned = () =>
    setPicks(
      picks.map((p) => {
        const alt = altOf(gd.power(p.boost));
        return alt !== undefined && !!gd.power(p.boost).bup === attuned ? make(gd.power(alt), p) : p;
      }),
    );
  const toggleCap = () => {
    setAtCap(!atCap);
    // the slot's own piece, only looked at, keeps its level (Place would otherwise change it)
    if (!atCap) setPicks(picks.map((p) => (current && p.boost === current.boost && p.ioLevel === current.ioLevel ? p : capped(p))));
    setLvlDraft(null);
  };

  const values = selBoost && sel && !multi ? enhLines(gd, at, entry.power, sel, 49) : [];
  // several pieces: what they add together, after ED
  const total = multi ? strengthLines(gd, entry.power, powerStrength(gd, at, entry.power, picks, 49).post) : [];
  /** Clamp a typed level into the pieces' range (an empty or unreadable entry keeps the current levels). */
  const commitLevel = () => {
    if (lvlDraft === null || !levelRange) return;
    const n = Math.round(Number(lvlDraft)) - 1;
    if (lvlDraft.trim() !== '' && Number.isFinite(n)) setLevel(Math.max(levelRange[0], Math.min(levelRange[1], n)));
    setLvlDraft(null);
  };
  useEscape(onClose);
  const mouse = usePointer();
  // no set tooltip left behind when the picker closes, or when its row goes without the pointer
  // leaving it (a tab changed or a group closed from the keyboard)
  useEffect(() => () => useHover.setState({ setTip: null, press: null }), []);
  useEffect(() => {
    if (useHover.getState().setTip) useHover.setState({ setTip: null });
  }, [tab, closed]);
  /**
   * @return A set's bonuses as they stand for this power with the chosen pieces placed where Place
   *   puts them: earned already, newly earned, or not earned (as the totals count them).
   */
  const bonusesOf = (s: BoostSet): SetBonusLine[] => {
    const after = entry.slots.map((x) => ({ ...x }));
    for (const p of placing()) if (after[p.slot]) after[p.slot] = { level: after[p.slot]!.level, ...(p.enh ? { enh: p.enh } : {}) };
    return setBonusLines(gd, entries, entry.key, s, after, bonusLevel);
  };
  /** Show a set's bonuses beside the pointer (null: the pointer left its name). */
  const hoverSet = (s: BoostSet | null) => {
    // a tap on a touch screen counts as a hover and never leaves: no box for it
    if (phone || (s && touchPress())) return;
    useHover.setState({ setTip: s ? { set: s, lines: bonusesOf(s), x: mouse.current.x, y: mouse.current.y } : null });
  };

  /** @return A piece's name in the details: its set's name dropped when the set is the one shown. */
  const shortOf = (b: Power) => {
    const ref = gd.boostSetOf.get(b.id);
    return (ref && pieceName(b, ref.set.dn)) || b.dn;
  };
  // several pieces from one set are titled by the set ("Unbreakable Guard:")
  const pickSets = new Set(picks.map((p) => gd.boostSetOf.get(p.boost)?.set.id));
  // how many chosen pieces each set holds: the set list shows them, so a piece chosen in a set no
  // longer shown isn't forgotten
  const chosenIn = new Map<number, number>();
  for (const p of picks) {
    const id = gd.boostSetOf.get(p.boost)?.set.id;
    if (id !== undefined) chosenIn.set(id, (chosenIn.get(id) ?? 0) + 1);
  }
  const oneSet = multi && pickSets.size === 1 ? gd.boostSetOf.get(picks[0]!.boost)?.set : undefined;

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
        const on = picks.some((p) => rowOf(p.boost) === rowOf(b.id));
        return (
          <div
            key={b.id}
            data-testid={`boost:${b.id}`}
            onClick={(ev) => choose(b, several || ev.ctrlKey || ev.metaKey)}
            // phones: a long press starts Select several with this piece in (one already chosen stays);
            // with a single slot to fill there is nothing to add to, so it just chooses the piece
            {...(phone
              ? longPress(() => {
                  if (targets.length < 2) return choose(b, /*add=*/ false);
                  setSeveral(true);
                  if (!on) choose(b, /*add=*/ true);
                })
              : {})}
            {...pressKeys(() => choose(b, several), undefined, own || b.dn)}
            onKeyDown={(ev) => {
              // Enter or Space picks it; with Ctrl (or Cmd) it adds it, as Ctrl+Click does
              if (ev.target !== ev.currentTarget || (ev.key !== 'Enter' && ev.key !== ' ')) return;
              ev.preventDefault();
              choose(b, several || ev.ctrlKey || ev.metaKey);
            }}
            title={gameText(b.sh)}
            style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer', userSelect: 'none', padding: phone ? '6px 8px' : '4px 10px', borderRadius: 10, border: `2px solid ${on ? '#00d919' : 'transparent'}`, background: on ? 'rgba(0,217,25,0.15)' : 'transparent' }}
          >
            {/* its own box: EnhIcon centers itself with auto margins, which a flex row would stretch */}
            <div style={{ flexShrink: 0 }}>
              <EnhIcon gd={gd} b={b} size={52} />
            </div>
            <div className="body-text" style={{ fontSize: phone ? 19 : 16, color: '#cfe8ff', lineHeight: 1.2 }}>
              {own || b.dn}
            </div>
            {fulls
              .filter((f) => f.boost === b.id)
              .map((f) => (
                <FadingText key={f.id} x={phone ? 150 : 220} y={phone ? 52 : 48} base={FULL_SCALE} color="#ff0000" text="FULL!" />
              ))}
          </div>
        );
      })}
    </div>
  );

  /**
   * A Sets or Special group's heading: the Totals panel's +/- and the title; a click opens or closes it.
   *
   * @param chosen How many chosen pieces its sets hold, shown while it is closed.
   */
  const groupHead = (key: string, title: string, chosen = 0) => {
    const open = !closed.has(key);
    return (
      <div
        data-testid={`group:${key}`}
        onClick={() => toggleGroup(key)}
        {...pressKeys(() => toggleGroup(key), undefined, title)}
        title={open ? 'Click to collapse' : 'Click to expand'}
        style={{ cursor: 'pointer', display: 'flex', alignItems: 'baseline', marginTop: 8, userSelect: 'none' }}
      >
        <HeadMark open={open} size={18} />
        <TitleText style={{ fontSize: 18 }}>{title}</TitleText>
        {!open && chosen ? <span style={{ color: CHOSEN_COLOR, fontSize: 14, marginLeft: 8 }}>({chosen})</span> : null}
      </div>
    );
  };

  // Desktop: list beside details. Phone: the whole screen, the tabs in one scrolling row, the list above the details.
  const tabList = TABS.filter((t) => byTab.has(t));
  const phoneG = () => {
    const W = stage.w;
    const bottom = stage.h - 36; // clear of the not-affiliated line
    const tabsY = 116; // under the title row and its two switches (the level switch, Select several)
    const listY = tabsY + PHONE_TAB_ROW / 2 + 8;
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
  // the top right: the level switch (and on phones Select several), the title left of it
  const SWITCH_W = phone ? 250 : 440;
  const titleText = `${entry.power.dn} -- slot ${slot + 1}`;
  const titleW = fw - (phone ? 24 : 60) - SWITCH_W;
  const titleSize = phone ? Math.min(24, fitScale(FONTS.title_12, titleText, titleW) * FONTS.title_12.size) : 34;
  const capSw = phone ? 34 : 24; // the top switches: the overview's (48 / 30), scaled down
  const setsH = Math.round(lh * 0.45); // phones: the most the set names' box takes of the list

  return (
    <div className="overlay" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()}>
        <MenuFrame x={fx} y={fy} w={fw} h={fh} r25 skin={skin} style={{ background: skin.panel }} />
        <SetTitle x={G.title[0]!} y={G.title[1]!} size={titleSize} width={titleW} text={titleText} skin={skin} />
        <div className="abs body-text" style={{ left: fx + fw - SWITCH_W - (phone ? 12 : 30), top: fy + (phone ? 10 : 26), width: SWITCH_W, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: phone ? 6 : 0, fontSize: phone ? 15 : 18, color: '#cfe8ff' }}>
          <label title={AT_CAP_HELP} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer', minHeight: phone ? 32 : undefined }}>
            <CapLabel />{' '}
            {/* the overview's totals switch, a little smaller */}
            <SwitchBox skin={skin} on={atCap} size={capSw} onChange={toggleCap} testId="picker:atcap" />
          </label>
          {phone ? (
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer', minHeight: 32 }}>
              Select several <SwitchBox skin={skin} on={several} size={capSw} onChange={() => setSeveral(!several)} testId="picker:several" />
            </label>
          ) : null}
        </div>
        {phone ? (
          <PhoneTabStrip skin={skin} labels={tabList} active={tabList.indexOf(tab)} onChange={(i) => setTab(tabList[i]!)} y={ty} x={16} width={fw - 20} clickSounds={['powerselect2']} />
        ) : (
          tabList.map((t, i) => <CheckBar key={t} testId={`tab:${t}`} skin={skin} x={tx0 + i * tstep} y={ty} wd={twd} scale={1} text={t} state={t === tab ? 'selected' : 'standard'} down={t === tab} onClick={() => setTab(t)} />)
        )}
        <div className={tab === 'Sets' ? 'abs' : 'abs scroll-y'} style={{ left: lx, top: ly, width: lw, height: lh }}>
          {tab === 'Sets' ? (
            // the set names and the chosen set's pieces scroll separately
            <div style={{ display: 'flex', gap: 16, flexDirection: phone ? 'column' : 'row', height: '100%' }}>
              {/* phones: the set names in a rounded box of their own (as tall as its list, up to setsH), apart from the tabs above and the pieces below */}
              <div className="scroll-y" data-testid="picker:sets" style={phone ? { maxHeight: setsH, boxSizing: 'border-box', padding: '2px 6px 6px', flexShrink: 0, background: 'rgba(0,0,0,0.533)', border: `2px solid ${skin.menuBorder}`, borderRadius: 14 } : { width: 430, height: '100%' }}>
                {setGroups.map(([grp, list]) => (
                  <div key={grp}>
                    {groupHead(`Sets:${grp}`, grp, list.reduce((t, s) => t + (chosenIn.get(s.id) ?? 0), 0))}
                    {closed.has(`Sets:${grp}`)
                      ? null
                      : list.map((s) => {
                        const chosen = chosenIn.get(s.id) ?? 0;
                        return (
                          <div
                            key={s.id}
                            data-testid={`pickerset:${s.id}`}
                            onClick={() => setSetId(s.id)}
                            // its bonuses: beside the pointer, or (phones) in a box a long press opens
                            onMouseEnter={() => hoverSet(s)}
                            onMouseLeave={() => hoverSet(null)}
                            {...(phone ? longPress((pt) => useHover.setState({ press: { kind: 'set', set: s, lines: bonusesOf(s), ...pt } })) : {})}
                            {...pressKeys(() => setSetId(s.id), undefined, s.dn)}
                            className="body-text"
                            // a set holding chosen pieces is lit (the shown set more brightly) and counts them
                            style={{ cursor: 'pointer', padding: phone ? '12px 8px' : '3px 8px', borderRadius: 8, color: s.id === setId || chosen ? '#88ffaa' : '#cfe8ff', background: s.id === setId ? 'rgba(0,217,25,0.18)' : chosen ? 'rgba(0,217,25,0.07)' : 'transparent', fontSize: phone ? 19 : 16 }}
                          >
                            {s.dn} <span style={{ color: '#8fa1b8', fontSize: 13 }}>({s.minL}-{s.maxL})</span>
                            {chosen ? <span data-testid={`pickerset-chosen:${s.id}`} style={{ color: CHOSEN_COLOR, fontSize: 13, marginLeft: 6 }}>{chosen} chosen</span> : null}
                          </div>
                        );
                      })}
                  </div>
                ))}
              </div>
              <div className="scroll-y" style={{ flex: 1, minHeight: 0, height: phone ? undefined : '100%' }}>
                {chosenSet ? enhList(chosenSet.slots.map((v) => gd.power(v[0]!)).filter((b) => canSlot(gd, entry.power, b, originIndex) && allowed(b)), chosenSet.dn) : <div className="desc-text">Choose a set.</div>}
              </div>
            </div>
          ) : tab === 'Special' ? (
            specialGroups.map((g) => (
              <div key={g.kind}>
                {groupHead(`Special:${g.title}`, g.title)}
                {closed.has(`Special:${g.title}`) ? null : enhList(g.list)}
              </div>
            ))
          ) : (
            enhList(byTab.get(tab) ?? [])
          )}
        </div>
        {/* selection details and controls */}
        <MenuFrame x={dx} y={dy} w={dw} h={dh} skin={skin} />
        <div className="abs body-text scroll-y" style={{ left: ix, top: iy, width: iw, height: dh - (phone ? 20 : 30), fontSize: phone ? 19 : 16, color: '#cfe8ff' }}>
          {selBoost && sel ? (
            <>
              {/* phones: no icon or name here (the chosen rows are lit in the list above) */}
              {phone ? null : (
                <>
                  <EnhIcon gd={gd} b={selBoost} size={80} />
                  <TitleText style={{ fontSize: 20, whiteSpace: 'normal' }}>
                    {multi ? (oneSet ? `${oneSet.dn}:` : 'Multiple Selections') : selBoost.dn}
                  </TitleText>
                  {oneSet ? <div style={{ color: '#ffd200', fontSize: 14 }}>(Multiple Selections)</div> : null}
                </>
              )}
              {/* the choices for the enhancement(s) on one row: level (or relative level), attuned, boosters */}
              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', columnGap: 18, rowGap: 6, margin: '8px 0' }}>
                {levelRange ? (
                  <label
                    style={atCap ? { opacity: 0.55 } : undefined}
                    title={atCap ? 'Max Slot/Build Level is on' : undefined}
                    // greyed by Max Slot/Build Level: pointing at it makes that switch's label glow twice
                    onMouseEnter={atCap ? () => useCapGlow.setState((g) => ({ n: g.n + 1 })) : undefined}
                  >
                    Level{' '}
                    <input
                      type="number"
                      data-testid="picker:level"
                      min={levelRange[0] + 1}
                      max={levelRange[1] + 1}
                      disabled={atCap}
                      // pieces at different levels (each at its own cap, or chosen apart) show none
                      // of them; a level typed in sets them all
                      value={lvlDraft ?? (mixedLevels ? '' : String((ranged[0]?.ioLevel ?? levelRange[1]) + 1))}
                      placeholder={mixedLevels ? 'Mixed' : undefined}
                      onChange={(e) => {
                        // keep what is typed ("2" on the way to "25"); apply at once only when in range
                        const v = e.target.value;
                        const n = Number(v) - 1;
                        if (v !== '' && Number.isInteger(n) && n >= levelRange[0] && n <= levelRange[1]) {
                          setLevel(n);
                          setLvlDraft(null);
                        } else setLvlDraft(v);
                      }}
                      onBlur={commitLevel}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') commitLevel();
                      }}
                      style={{ width: phone ? 90 : 70, height: phone ? 44 : undefined, background: atCap ? '#222' : '#000', color: '#fff', border: `1px solid ${skin.menuBorder}` }}
                    />
                  </label>
                ) : null}
                {!levelRange && picks.every((p) => gd.power(p.boost).bup) ? <span style={{ color: '#8fa1b8' }}>Scales with your level</span> : null}
                {relPick ? (
                  <label>
                    Relative level{' '}
                    <select
                      data-testid="picker:rel"
                      value={relPick.rel ?? 0}
                      onChange={(e) => setPicks(picks.map((p) => (gd.power(p.boost).bie ? p : { ...p, rel: Number(e.target.value) })))}
                      style={{ height: phone ? 44 : undefined, background: '#000', color: '#fff' }}
                    >
                      {/* -3..+3 to choose from, plus an imported outleveled piece's own level */}
                      {[...new Set([3, 2, 1, 0, -1, -2, -3, relPick.rel ?? 0])].map((r) => (
                        <option key={r} value={r}>
                          {r > 0 ? `+${r}` : r < -3 ? `${r} (outleveled)` : r}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
                {withAlt.length ? (
                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: phone ? 8 : 6, minHeight: phone ? 44 : undefined, cursor: 'pointer' }}>
                    <SwitchBox skin={skin} on={attuned} size={phone ? 30 : 20} onChange={toggleAttuned} testId="picker:attuned" /> Attuned
                  </label>
                ) : null}
                {boosted ? (
                  <label>
                    Boosters{' '}
                    <select
                      data-testid="picker:boosters"
                      value={boosted.boosters ?? 0}
                      onChange={(e) => setPicks(picks.map((p) => (gd.power(p.boost).bb ? { ...p, boosters: Number(e.target.value) } : p)))}
                      style={{ height: phone ? 44 : undefined, background: '#000', color: '#fff' }}
                    >
                      {[0, 1, 2, 3, 4, 5].map((r) => (
                        <option key={r} value={r}>
                          +{r}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
              </div>
              {multi ? (
                <>
                  {/* the pieces together (after ED), then a gap, then each piece's own values, compact */}
                  <div style={{ ...MULTI_HEAD, marginTop: phone ? 16 : 12 }}>{`Total after ED (${picks.map((p) => shortOf(gd.power(p.boost))).join(', ')})`}</div>
                  {total.map((v) => (
                    <TotalsRow key={v.label} label={v.label} value={`${(v.value * 100).toFixed(2)}%`} tone={v.value} noMark />
                  ))}
                  <div style={{ height: phone ? 26 : 22 }} />
                  {picks.map((p) => {
                    const b = gd.power(p.boost);
                    return (
                      <div key={p.boost} data-testid={`picker:piece:${p.boost}`} style={{ fontSize: phone ? 16 : 14, lineHeight: 1.15, marginBottom: 6 }}>
                        <div style={MULTI_HEAD}>{shortOf(b)}</div>
                        {enhLines(gd, at, entry.power, p, 49).map((v) => (
                          <TotalsRow key={v.label} label={v.label} value={`${(v.value * 100).toFixed(2)}%`} tone={v.value} noMark />
                        ))}
                      </div>
                    );
                  })}
                </>
              ) : (
                <>
                  {/* the game's tooltip: the short help in blue, then the long help with this piece's values
                      filled in (as the build screen's enhancement tooltip shows it) */}
                  <div style={{ margin: '6px 0', color: '#7fd3ff' }}>{gameText(selBoost.sh)}</div>
                  <div style={{ margin: '6px 0 10px', color: '#ffffff', lineHeight: 1.3 }}>{smf(boostHelpText(gd, at, sel, 49))}</div>
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
              )}
            </>
          ) : (
            <div className="desc-text">Choose an enhancement.</div>
          )}
        </div>
        {/* desktop: how to pick several (phones have Select several), small and grey like the not-affiliated line */}
        {phone ? null : (
          <div className="abs notice" style={{ left: fx, top: fy + fh - 30, width: fw, textAlign: 'center', opacity: 0.6 }}>
            Use CTRL + Left-Click to select multiple enhancements
          </div>
        )}
        {placeError ? (
          <div className="abs body-text" data-testid="picker:error" style={{ left: dx, top: G.btnY - (phone ? 44 : 40), width: dw, textAlign: 'center', fontSize: phone ? 16 : 15, color: '#ff6060' }}>
            {placeError}
          </div>
        ) : null}
        {/* equal-width buttons with equal gaps, centered under the details frame */}
        <div className="abs" style={{ left: dx, top: G.btnY, width: dw, display: 'flex', justifyContent: 'center', gap: 14 }}>
          {(
            [
              ['Remove', () => onPlace([{ slot, enh: undefined }]), !current],
              ['Cancel', onClose, false],
              ['Place', place, !picks.length],
            ] as const
          ).map(([label, act, off]) => (
            <button key={label} data-testid={`picker:${label.toLowerCase()}`} className="info-button" style={{ position: 'static', width: G.btnW, padding: 0 }} onClick={act} disabled={off}>
              {label}
            </button>
          ))}
        </div>
        {phone ? <PhoneSetTipLayer gd={gd} skin={skin} /> : <SetTipLayer gd={gd} skin={skin} />}
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
