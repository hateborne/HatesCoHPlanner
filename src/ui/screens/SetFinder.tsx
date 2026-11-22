import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { useShallow } from 'zustand/react/shallow';
import type { GameData } from '../../data/gamedata.ts';
import type { Build } from '../../engine/build.ts';
import { setLevelRange, setRarity } from '../../engine/enhance.ts';
import { buildDiff, type BuildDiff, type DiffRow } from '../../engine/finder/diff.ts';
import { replacedLines, statAmount, statLabel, warningText } from '../../engine/finder/labels.ts';
import { applySwaps, type Swap } from '../../engine/finder/pending.ts';
import { GOALS, MAX_EXTRA, MAX_GOALS, queryProblem, setGoalAt, type Depth, type GoalId, type Importance, type SetTag } from '../../engine/finder/query.ts';
import type { RankedSwap } from '../../engine/finder/search.ts';
import { bonusChoices, bySet, fitQuery, pickablePowers, setGroupsOf, sortSwaps, type StatSection } from '../../engine/finder/view.ts';
import { BuildRules } from '../../engine/rules.ts';
import { readShopping } from '../../io/shopping.ts';
import { swapId, useFinder } from '../../state/finder.ts';
import { closeSetFinder as close, startPickingPowers, stopPickingPowers, useFinderOpen } from '../../state/finderOpen.ts';
import { useStore } from '../../state/store.ts';
import { CheckBar } from '../components/CheckBar.tsx';
import { FlatFrame, InfoButton, MenuFrame, SetTitle } from '../components/Chrome.tsx';
import { FINDER_NAME } from '../components/FinderIcon.tsx';
import { GameText, TitleText } from '../components/GameText.tsx';
import { PHONE_TAB_ROW, phoneGeom, PhoneTabs } from '../components/Phone.tsx';
import { rarityStyle } from '../components/PowerTip.tsx';
import { Sprite } from '../components/Sprite.tsx';
import { useStage } from '../components/Stage.tsx';
import { MPH, TotalsRow } from '../components/TotalsPanel.tsx';
import { useEscape } from '../escape.ts';
import { useFreshHover, useHover } from '../hover.ts';
import { pressKeys } from '../press.ts';
import { S, vx, vy } from '../skin/metrics.ts';
import { icon, ui, type Skin } from '../skin/skin.ts';
import { EnhIcon } from './EnhancementPicker.tsx';
import { ShopNeeds, ShopSets, useShoppingList } from './FinderShopping.tsx';

const IMPORTANCES: { id: Importance; name: string }[] = [
  { id: 'low', name: 'Low' },
  { id: 'medium', name: 'Medium' },
  { id: 'high', name: 'High' },
  { id: 'critical', name: 'Critical' },
];
const TAGS: { id: SetTag; name: string; title: string }[] = [
  { id: 'pvp', name: 'PvP', title: 'PvP sets (Shield Wall, Panacea, ...)' },
  { id: 'seasonal', name: 'Seasonal', title: 'Winter and event sets' },
  { id: 'purple', name: 'Purple', title: 'Very rare sets, level 50 only' },
  { id: 'archetype', name: 'Archetype', title: "Your archetype's own sets" },
];
const DEPTHS: { id: Depth; name: string }[] = [
  { id: 'any', name: 'Anywhere' },
  { id: '2-3', name: '2-3 pieces' },
  { id: '4-6', name: '4-6 pieces' },
];

// the set type box's two entries that are not set types: go pick the powers, and "N powers selected"
const PICK_POWERS = '__pick';
const POWERS_PICKED = '__picked';

const TEXT = '#cfe8ff';
const MUTED = '#8fa1b8';
const WARN = '#ffd24a';
const BAD = '#ff5a5a';

// what the purple figure means, for its tooltip
const SOFT_CAP_TITLE = 'At the 45% defense soft cap: more only helps against enemies with extra chance to hit.';
// what a proc's row shows, for its tooltip
const PROC_TITLE = 'In brackets: how often the proc fires a minute, per target hit, with the power used whenever it is ready. The figures: its damage a minute, before and after.';

// the totals pane's own names where they differ from the lines' labels
const PANE_LABEL: Record<string, string> = { endrdx: 'End Discount', stealth: 'Stealth (PvE)' };

/**
 * A figure of a gains-and-losses row, written as the totals pane writes that stat.
 *
 * @param key The row's key: a totals line, or one of a power's own figures.
 * @param v The figure.
 * @param power Whether the row is a power's own figure ("heal" is hit points there, a percentage in the totals).
 * @return The text.
 */
function figure(key: string, v: number, power: boolean): string {
  if (power) {
    // a proc's damage a minute
    if (key.startsWith('proc:')) return v > 0 && v < 10 ? v.toFixed(1) : v.toFixed(0);
    if (key === 'accuracy') return `${v.toFixed(2)}x`;
    if (key === 'recharge') return `${v.toFixed(1)}s`;
    return v.toFixed(2);
  }
  if (key === 'regen' || key === 'recov' || key === 'enduse') return `${v.toFixed(2)}/s`;
  if (key === 'run' || key === 'fly' || key === 'jumpspd') return `${(v * MPH).toFixed(2)} mph`;
  if (key === 'jumph') return `${(v * 4).toFixed(2)} ft`;
  if (key === 'hp' || key === 'endmax') return v.toFixed(1);
  if (key === 'perc' || key === 'stealth') return `${v.toFixed(0)} ft`;
  return statAmount(key, v);
}

/** A piece of a row's value: a figure or what joins two, and whether it is a figure at its cap. */
interface ValuePart {
  text: string; // the figure, or " -> " and the like
  cap?: boolean; // a figure standing at its cap: it glows
}

/**
 * A row's before and after, with what a figure holds past its cap written as the character sheet
 * writes it, "cap (actual)": going into the cap "old -> cap (new)", staying past it
 * "cap (old -> new)", dropping out of it "cap (old) -> new". The figure at the cap is marked.
 *
 * @param r The row.
 * @param power Whether the row is a power's own figure.
 * @return The value in parts, in reading order.
 */
function rowParts(r: DiffRow, power: boolean): ValuePart[] {
  const f = (v: number) => figure(r.key, v, power);
  const { rawBefore: rb, rawAfter: ra } = r;
  const before: ValuePart = { text: f(r.before), cap: r.wasAtCap };
  const after: ValuePart = { text: f(r.after), cap: r.atCap };
  if (rb === undefined && ra === undefined) return [before, { text: ' -> ' }, after];
  if (rb === undefined) return [before, { text: ' -> ' }, after, { text: ` (${f(ra!)})` }];
  if (ra === undefined) return [before, { text: ` (${f(rb)}) -> ` }, after];
  // past the cap on both sides; the cap itself moves only for a figure worked out from another (regeneration per second from max HP)
  if (before.text === after.text) return [after, { text: ` (${f(rb)} -> ${f(ra)})` }];
  return [before, { text: ` (${f(rb)}) -> ` }, after, { text: ` (${f(ra)})` }];
}

/** @return A row's value as plain text. */
const rowText = (r: DiffRow, power: boolean): string =>
  rowParts(r, power)
    .map((x) => x.text)
    .join('');

// a figure standing at its cap: amber, with a glow
const AT_CAP: CSSProperties = { color: WARN, textShadow: '0 0 6px rgba(255, 210, 74, 0.75), 0 0 12px rgba(255, 170, 0, 0.5)' };
// at a soft cap (defense's 45%): purple, to tell it from a cap nothing gets past
const AT_SOFT_CAP: CSSProperties = { color: '#d2a8ff', textShadow: '0 0 6px rgba(190, 130, 255, 0.8), 0 0 12px rgba(150, 80, 255, 0.55)' };

/** A row's value, the figure at its cap glowing (amber for a cap, purple for a soft cap). */
function RowValue({ r, power }: { r: DiffRow; power: boolean }) {
  return (
    <>
      {rowParts(r, power).map((x, i) =>
        x.cap ? (
          <span key={i} style={r.softCap ? AT_SOFT_CAP : AT_CAP} title={r.softCap ? SOFT_CAP_TITLE : undefined}>
            {x.text}
          </span>
        ) : (
          x.text
        ),
      )}
    </>
  );
}

/** Rows of one side of the gains and losses, laid out like the totals pane. */
function DiffRows({ gd, rows, gain, power }: { gd: GameData; rows: DiffRow[]; gain: boolean; power: boolean }) {
  // the damage bonuses of types the build's powers don't deal are folded into one row
  const [open, setOpen] = useState(false);
  const row = (r: DiffRow) => (
    // a proc's row carries two figures: say which is which
    <div key={r.key} title={power && r.key.startsWith('proc:') ? PROC_TITLE : undefined}>
      <TotalsRow
        // a line of a family ("def.03") is named by the totals with its type alone
        label={power ? r.label : (PANE_LABEL[r.key] ?? (r.key.includes('.') ? statLabel(gd, r.key) : r.label))}
        value={<RowValue r={r} power={power} />}
        tone={gain ? 1 : -1}
        noMark
      />
    </div>
  );
  const unused = rows.filter((r) => r.unused);
  const values = new Set(unused.map((r) => rowText(r, power)));
  const fold = () => setOpen(!open);
  return (
    <>
      {rows.filter((r) => !r.unused).map(row)}
      {unused.length ? (
        <>
          {/* of no use to this build: greyed, so it draws no eye */}
          <div
            data-testid={`finder:unused:${gain ? 'gains' : 'losses'}`}
            onClick={fold}
            {...pressKeys(fold, undefined, `Unused Damage: ${open ? 'hide' : 'show'} the ${unused.length} damage types this build does not deal`)}
            title="Damage types none of this build's powers deal"
            style={{ display: 'flex', justifyContent: 'space-between', cursor: 'pointer', color: MUTED, padding: '1px 0' }}
          >
            <span>{open ? '-' : '+'} Unused Damage</span>
            <span>{values.size === 1 ? [...values][0]! : ''}</span>
          </div>
          {open ? <div style={{ paddingLeft: 18, opacity: 0.7 }}>{unused.map(row)}</div> : null}
        </>
      ) : null}
    </>
  );
}

/**
 * A re-slotted power's heading over its figures: the power's bar as the build overview draws it
 * (its icon in the ring, its name on the bar), so it reads as the power and not as one more list
 * title. It is a picture only: nothing happens on a click.
 */
function PowerHead({ gd, skin, power, phone, width }: { gd: GameData; skin: Skin; power: number; phone: boolean; width: number }) {
  const p = gd.power(power);
  // the overview's bar at a smaller scale; its ring reaches 19 units left of its center and its box is 32 units tall (Overview.tsx)
  const sc = phone ? 1.25 : 1.1;
  return (
    <div data-testid={`finder:power:${power}`} style={{ position: 'relative', height: 36 * sc, marginBottom: 2 }}>
      <CheckBar skin={skin} x={20 * sc} y={18 * sc} wd={width - 32 * sc} scale={sc} text={p.dn} state="standard" icon={icon('powers', p.icon || 'power_missing')} />
    </div>
  );
}

/**
 * The gains and losses of a change: the powers it re-slots first, each under its bar (PowerHead)
 * with its own figures (the better ones, then the worse), then the totals' net gains and net losses. A
 * power the change only reaches from afar (its procs fire more or less often with the build's
 * recharge) comes under the gains or the losses, with its name over its rows.
 */
function Diff({ gd, diff, skin, phone, width }: { gd: GameData; diff: BuildDiff; skin: Skin; phone: boolean; width: number }) {
  const active = diff.powers.filter((p) => p.slotted && (p.gains.length || p.losses.length));
  const others = diff.powers.filter((p) => !p.slotted);
  if (!diff.gains.length && !diff.losses.length && !active.length && !others.some((p) => p.gains.length || p.losses.length)) return <div className="desc-text">No change in the totals.</div>;
  const afar = (side: 'gains' | 'losses') =>
    others
      .filter((p) => p[side].length)
      .map((p) => (
        <div key={p.key} style={{ marginTop: 6 }}>
          <div style={{ color: TEXT }}>{gd.power(p.power).dn}</div>
          <DiffRows gd={gd} rows={p[side]} gain={side === 'gains'} power />
        </div>
      ));
  const none = (side: 'gains' | 'losses') => (diff[side].length || others.some((p) => p[side].length) ? null : <div style={{ color: MUTED }}>None.</div>);
  return (
    <>
      {active.length ? (
        <div data-testid="finder:powers">
          {active.map((p) => (
            <div key={p.key} style={{ marginTop: 10 }}>
              <PowerHead gd={gd} skin={skin} power={p.power} phone={phone} width={width} />
              <DiffRows gd={gd} rows={p.gains} gain power />
              <DiffRows gd={gd} rows={p.losses} gain={false} power />
            </div>
          ))}
        </div>
      ) : null}
      <TitleText style={{ fontSize: 18, marginTop: 12 }}>Net Gains</TitleText>
      <div data-testid="finder:gains">
        {none('gains')}
        <DiffRows gd={gd} rows={diff.gains} gain power={false} />
        {afar('gains')}
      </div>
      <TitleText style={{ fontSize: 18, marginTop: 14 }}>Net Losses</TitleText>
      <div data-testid="finder:losses">
        {none('losses')}
        <DiffRows gd={gd} rows={diff.losses} gain={false} power={false} />
        {afar('losses')}
      </div>
    </>
  );
}

/** What a swap places: the set's name in its rarity colour, its levels and the power it goes into on one line, the pieces as small icons under it. */
function SwapLine({ gd, swap, phone }: { gd: GameData; swap: Swap; phone: boolean }) {
  const set = gd.boostSetById.get(swap.set);
  const [lo, hi] = set ? setLevelRange(set) : [0, 0];
  const power = gd.powerById.get(swap.power);
  return (
    <div style={{ minWidth: 0 }}>
      {/* one line where there is room: the set, its pieces, its levels, the power it goes into */}
      <div style={{ fontSize: phone ? 20 : 17, lineHeight: 1.2 }}>
        <span style={{ color: TEXT, ...rarityStyle(set ? setRarity(set) : undefined) }}>{set?.dn ?? 'Unknown set'}</span> <span style={{ color: '#fff' }}>x{swap.count}</span>{' '}
        <span style={{ color: MUTED, fontSize: phone ? 15 : 13 }}>
          ({lo + 1}-{hi + 1})
        </span>{' '}
        {/* the power stands out as the set does: its icon, then its name as large, in white; "into" stays small */}
        <span style={{ whiteSpace: 'nowrap' }}>
          <span style={{ color: MUTED, fontSize: phone ? 15 : 13 }}>into</span>{' '}
          {power ? <img src={icon('powers', power.icon || 'power_missing')} alt="" draggable={false} style={{ width: phone ? 26 : 22, height: phone ? 26 : 22, verticalAlign: 'middle', marginRight: 4, position: 'relative', top: -1 }} /> : null}
          <span style={{ color: '#fff', fontWeight: 700 }}>{power?.dn ?? 'a power'}</span>
        </span>
      </div>
      <div style={{ display: 'flex', gap: 2, marginTop: 2 }}>
        {swap.pieces.map((p) => {
          const b = gd.powerById.get(p.enh.boost);
          return b ? (
            <div key={p.slot} title={b.dn} style={{ flexShrink: 0 }}>
              <EnhIcon gd={gd} b={b} size={phone ? 34 : 28} />
            </div>
          ) : null;
        })}
      </div>
    </div>
  );
}

/** A box the player ticks: a native check box with its label, sized for a finger on phones. */
function Tick({ label, checked, onChange, testId, title, phone }: { label: string; checked: boolean; onChange: (on: boolean) => void; testId: string; title?: string; phone: boolean }) {
  return (
    <label title={title} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, minHeight: phone ? 44 : 28, cursor: 'pointer', marginRight: 16 }}>
      <input type="checkbox" data-testid={testId} checked={checked} onChange={(e) => onChange(e.target.checked)} style={phone ? { width: 28, height: 28, margin: 0 } : { width: 18, height: 18, margin: 0 }} />
      {label}
    </label>
  );
}

/** Something that went wrong with the last step, in red (nothing when all is well). */
function Note() {
  const note = useFinder((s) => s.note);
  return note ? (
    <div className="body-text" data-testid="finder:note" role="status" style={{ color: BAD, fontSize: 16, marginBottom: 8 }}>
      {note}
    </div>
  ) : null;
}

/** "Search", or how far the running search is. It alone redraws as the search moves on. */
function SearchLabel({ idle }: { idle: string }) {
  const progress = useFinder((s) => s.progress);
  return <>{progress === null ? idle : `Searching ${Math.round(progress * 100)}%`}</>;
}

/** The search form: priorities, kinds of sets, the wanted bonus and the additional ones, set type. */
function SearchForm({ skin, sections, groups, phone }: { skin: Skin; sections: StatSection[]; groups: string[]; phone: boolean }) {
  const { query, setQuery } = useFinder(useShallow((s) => ({ query: s.query, setQuery: s.setQuery })));
  /** The set type box changed: a set type, every set type, or off to the overview to pick the powers to consider. */
  const setType = (value: string) => {
    if (value === PICK_POWERS) startPickingPowers(query.powers ?? []);
    else if (value !== POWERS_PICKED) setQuery({ groups: value ? [value] : undefined, powers: undefined });
  };
  const select: CSSProperties = {
    fontFamily: "'Montreal'",
    fontSize: 16,
    color: '#fff',
    background: `linear-gradient(${skin.select[0]}, ${skin.select[1]})`,
    border: `2px solid ${skin.menuBorder}`,
    borderRadius: 16,
    padding: '0 6px 0 10px',
    height: phone ? 48 : 34,
    cursor: 'pointer',
    minWidth: 0,
  };
  const option: CSSProperties = { background: skin.select[1] };
  const head = (text: string) => <TitleText style={{ fontSize: 18, marginTop: 14, marginBottom: 4 }}>{text}</TitleText>;

  /** Set, change or clear priority `i`, or its importance; a goal another row holds moves here. */
  const setGoal = (i: number, patch: { goal?: GoalId | null; importance?: Importance }) => setQuery({ goals: setGoalAt(query.goals, i, patch) });
  const setExtra = (i: number, stat: string) => {
    const extra = query.extra.slice();
    if (!stat) extra.splice(i, 1);
    else extra[i] = stat;
    setQuery({ extra: [...new Set(extra)].filter((k) => k !== query.main?.stat) });
  };
  const statOptions = (taken: (string | undefined)[]) =>
    sections.map((sec) => (
      <optgroup key={sec.title} label={sec.title} style={option}>
        {sec.stats.map((c) => (
          <option key={c.key} value={c.key} disabled={taken.includes(c.key)} style={option}>
            {c.label}
          </option>
        ))}
      </optgroup>
    ));
  const row: CSSProperties = { display: 'flex', gap: 8, marginBottom: 8 };
  const invalid = queryProblem(query);

  return (
    <div className="body-text" style={{ fontSize: phone ? 19 : 16, color: TEXT }}>
      {head('Priorities')}
      {Array.from({ length: MAX_GOALS }, (_, i) => {
        const cur = query.goals[i];
        return (
          <div key={i} style={row}>
            <select data-testid={`finder:goal:${i}`} aria-label={`Priority ${i + 1}`} value={cur?.goal ?? ''} onChange={(e) => setGoal(i, { goal: (e.target.value as GoalId) || null })} style={{ ...select, flex: 3 }}>
              <option value="" style={option}>
                {i === 0 ? 'Choose a priority' : 'Add a priority'}
              </option>
              {GOALS.map((g) => {
                // a goal another row holds can still be picked: it moves here and that row empties
                const used = query.goals.findIndex((x, k) => k !== i && x.goal === g.id);
                return (
                  <option key={g.id} value={g.id} style={used < 0 ? option : { ...option, color: WARN }}>
                    {used < 0 ? g.name : `${g.name} (priority ${used + 1})`}
                  </option>
                );
              })}
            </select>
            <select
              data-testid={`finder:importance:${i}`}
              aria-label={`Importance of priority ${i + 1}`}
              value={cur?.importance ?? 'medium'}
              onChange={(e) => setGoal(i, { importance: e.target.value as Importance })}
              style={{ ...select, flex: 2 }}
            >
              {IMPORTANCES.map((m) => (
                <option key={m.id} value={m.id} style={option}>
                  {m.name}
                </option>
              ))}
            </select>
          </div>
        );
      })}
      {/* why Search is off, where a phone can read it too */}
      {invalid ? (
        <div data-testid="finder:invalid" style={{ color: WARN, fontSize: phone ? 16 : 13 }}>
          {invalid}
        </div>
      ) : null}

      {head('Sets to look at')}
      <div style={{ color: MUTED, fontSize: phone ? 16 : 13, marginBottom: 4 }}>Uncommon and rare sets always. Add:</div>
      <div>
        {TAGS.map((t) => (
          <Tick
            key={t.id}
            testId={`finder:tag:${t.id}`}
            label={t.name}
            title={t.title}
            phone={phone}
            checked={query.tags.includes(t.id)}
            onChange={(on) => setQuery({ tags: on ? [...query.tags, t.id] : query.tags.filter((x) => x !== t.id) })}
          />
        ))}
      </div>
      <Tick testId="finder:attuned" label="Attuned pieces" title="Place attuned pieces instead of crafted ones at the highest level that works" phone={phone} checked={!!query.attuned} onChange={(on) => setQuery({ attuned: on })} />

      {head('Set bonus wanted')}
      <div style={row}>
        <select
          data-testid="finder:main"
          aria-label="Set bonus wanted"
          value={query.main?.stat ?? ''}
          onChange={(e) => setQuery({ main: e.target.value ? { stat: e.target.value, depth: query.main?.depth ?? 'any' } : undefined, extra: query.extra.filter((k) => k !== e.target.value) })}
          style={{ ...select, flex: 3 }}
        >
          <option value="" style={option}>
            Any bonus
          </option>
          {statOptions([])}
        </select>
        <select
          data-testid="finder:depth"
          aria-label="How many pieces the bonus may take"
          value={query.main?.depth ?? 'any'}
          disabled={!query.main}
          onChange={(e) => query.main && setQuery({ main: { stat: query.main.stat, depth: e.target.value as Depth } })}
          style={{ ...select, flex: 2, opacity: query.main ? 1 : 0.45 }}
        >
          {DEPTHS.map((d) => (
            <option key={d.id} value={d.id} style={option}>
              {d.name}
            </option>
          ))}
        </select>
      </div>

      {head('Also prefer')}
      {Array.from({ length: Math.min(MAX_EXTRA, query.extra.length + 1) }, (_, i) => (
        <div key={i} style={row}>
          <select data-testid={`finder:extra:${i}`} aria-label={`Additional bonus ${i + 1}`} value={query.extra[i] ?? ''} onChange={(e) => setExtra(i, e.target.value)} style={{ ...select, flex: 1 }}>
            <option value="" style={option}>
              {i === 0 ? 'No other bonus' : 'Add another bonus'}
            </option>
            {statOptions([query.main?.stat, ...query.extra.filter((_, k) => k !== i)])}
          </select>
        </div>
      ))}

      {head('Set type')}
      <div style={row}>
        <select data-testid="finder:group" aria-label="Set type" value={query.powers ? POWERS_PICKED : (query.groups?.[0] ?? '')} onChange={(e) => setType(e.target.value)} style={{ ...select, flex: 1 }}>
          <option value={PICK_POWERS} style={option}>
            Select powers...
          </option>
          {query.powers ? (
            <option value={POWERS_PICKED} style={option}>
              {query.powers.length} {query.powers.length === 1 ? 'power' : 'powers'} selected
            </option>
          ) : null}
          <option value="" style={option}>
            Every set type your powers take
          </option>
          {groups.map((g) => (
            <option key={g} value={g} style={option}>
              {g}
            </option>
          ))}
        </select>
      </div>
      {/* a set type and picked powers take each other's place: said where the powers would be lost */}
      {query.powers ? (
        <div data-testid="finder:powersnote" style={{ color: MUTED, fontSize: phone ? 16 : 13 }}>
          Only the {query.powers.length === 1 ? 'power' : `${query.powers.length} powers`} you picked {query.powers.length === 1 ? 'is' : 'are'} searched. Choosing a set type searches every power again.
        </div>
      ) : null}
    </div>
  );
}

/** What a row of the lists is given. */
interface ResultRowProps {
  gd: GameData; // game data (names, icons)
  swap: RankedSwap; // the swap the row shows
  kept: boolean; // it is one of the kept swaps
  selected: boolean; // its gains and losses are the ones shown
  phone: boolean; // the phone layout
  busy: boolean; // a search is running: the list is on its way out
  onKeep: () => void; // keep it, or let it go when kept
  onSelect: () => void; // show its gains and losses, or stop showing them
}

/**
 * One swap in a list: the box that keeps it or lets it go, what it places, and its warnings.
 * Clicking the row (or Enter on its text) shows its gains and losses; pointing at it does on desktop.
 */
function ResultRow({ gd, swap, kept, selected, phone, busy, onKeep, onSelect }: ResultRowProps) {
  const id = swapId(swap);
  const name = `${gd.boostSetById.get(swap.set)?.dn ?? 'Set'} into ${gd.powerById.get(swap.power)?.dn ?? 'a power'}`;
  const warned = swap.warnings.length ? `${swap.warnings.length} ${swap.warnings.length === 1 ? 'warning' : 'warnings'}` : '';
  // phones have no pointer to hover with: a tap would leave a hover behind that never clears
  const hover = phone
    ? {}
    : {
        onMouseEnter: () => useHover.setState({ swap: id }),
        onMouseLeave: () => useHover.setState((h) => (h.swap === id ? { swap: null } : h)),
      };
  return (
    <div
      data-testid={`finder:swap:${id}`}
      onClick={onSelect}
      {...hover}
      className="body-text"
      style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', padding: phone ? '8px 8px' : '5px 8px', borderRadius: 10, border: `2px solid ${selected ? '#00d919' : 'transparent'}`, background: selected ? 'rgba(0,217,25,0.15)' : 'transparent' }}
    >
      <input
        type="checkbox"
        data-testid={`finder:keep:${id}`}
        aria-label={kept ? `Kept: ${name}. Untick to let it go` : `Keep ${name}`}
        title={kept ? 'Kept: untick to let it go' : 'Keep this swap'}
        checked={kept}
        // while the list is being ranked again, what it offers may no longer fit
        disabled={busy && !kept}
        onClick={(e) => e.stopPropagation()}
        onChange={onKeep}
        style={{ flexShrink: 0, width: phone ? 28 : 20, height: phone ? 28 : 20, margin: 0 }}
      />
      {/* the keyboard's way to the row: Enter on it shows the swap, as a click anywhere on the row does (its name stands in for its text, so it says the warnings too) */}
      <div {...pressKeys(onSelect, undefined, `${name}${warned ? `, ${warned}` : ''}: show its gains and losses`)} style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 }}>
        <SwapLine gd={gd} swap={swap} phone={phone} />
        {swap.warnings.length ? (
          <div title={swap.warnings.map((w) => warningText(gd, w)).join('\n')} style={{ marginLeft: 'auto', flexShrink: 0, color: WARN, fontSize: phone ? 17 : 14 }}>
            {warned}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/**
 * The lists' order, at the top right of the pane: a click steps to the next one (Default, by power
 * A to Z and Z to A, by fewest and most slots). Default shows a dash, the others an arrow.
 */
function SortLabel({ phone }: { phone: boolean }) {
  const { sort, stepSort } = useFinder(useShallow((s) => ({ sort: s.sort, stepSort: s.stepSort })));
  const name = sort.by === 'default' ? 'Default' : sort.by === 'power' ? 'Power' : 'Slots';
  const said = sort.by === 'default' ? 'by rank' : sort.by === 'power' ? (sort.desc ? 'by power, Z to A' : 'by power, A to Z') : sort.desc ? 'most slots first' : 'fewest slots first';
  const arrow = phone ? 16 : 13;
  return (
    <div
      data-testid="finder:sort"
      className="body-text"
      onClick={stepSort}
      {...pressKeys(stepSort, undefined, `Sorted ${said}. Press to change the order`)}
      title={`Sorted ${said}. Click to change the order`}
      style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', color: WARN, fontSize: phone ? 19 : 16, minHeight: phone ? 44 : undefined, userSelect: 'none' }}
    >
      {name}
      {sort.by === 'default' ? (
        <span>-</span>
      ) : (
        // the scroll bars' arrows (GameScroll)
        <span style={{ position: 'relative', display: 'inline-block', width: arrow, height: arrow }}>
          <Sprite src={ui(`hud/map/map_zoom_${sort.desc ? 'down' : 'up'}arrow`)} x={0} y={0} w={arrow} h={arrow} tint={WARN} />
        </span>
      )}
    </div>
  );
}

/**
 * The lists: the kept swaps first, each with its box ticked, then the results, each set with its
 * best placement and its other placements folded under it. In another order than the default
 * (SortLabel) every placement is a row of its own.
 */
function ResultList({ gd, phone, hasSlots }: { gd: GameData; phone: boolean; hasSlots: boolean }) {
  const { result, busy, kept, selected, select, keep, drop, problem, loading, query, searched, searchedKept, sort } = useFinder(
    useShallow((s) => ({
      sort: s.sort,
      result: s.result,
      busy: s.progress !== null,
      kept: s.kept,
      selected: s.selected,
      select: s.select,
      keep: s.keep,
      drop: s.drop,
      problem: s.problem,
      loading: s.loading,
      query: s.query,
      searched: s.searched,
      searchedKept: s.searchedKept,
    })),
  );
  const [more, setMore] = useState<ReadonlySet<number>>(new Set());
  const keptIds = useMemo(() => new Set(kept.map(swapId)), [kept]);
  // a kept swap shows under Kept only (a list not ranked again since it was kept still holds it)
  const found = useMemo(() => sortSwaps(gd, (result?.swaps ?? []).filter((s) => !keptIds.has(swapId(s))), sort), [gd, result, keptIds, sort]);
  const sets = useMemo(() => bySet(found), [found]);
  const keptShown = useMemo(() => sortSwaps(gd, kept, sort), [gd, kept, sort]);
  if (loading) return <div className="desc-text">Loading the build statistics...</div>;
  if (problem) return <div className="desc-text">{problem}</div>;

  /** Tick or untick a swap's box. Its row then moves between the lists with no mouseleave, so the hover it leaves behind is cleared. */
  const toggle = (s: RankedSwap, isKept: boolean) => {
    const before = useFinder.getState().kept;
    if (isKept) drop(s.key);
    else keep(s);
    if (useFinder.getState().kept !== before) useHover.setState({ swap: null });
  };
  const row = (s: RankedSwap) => {
    const id = swapId(s);
    const isKept = keptIds.has(id);
    return <ResultRow key={id} gd={gd} swap={s} kept={isKept} selected={selected === id} phone={phone} busy={busy} onKeep={() => toggle(s, isKept)} onSelect={() => select(selected === id ? null : id)} />;
  };
  const fold = (set: number) => setMore(new Set(more.has(set) ? [...more].filter((x) => x !== set) : [...more, set]));
  const small: CSSProperties = { fontSize: phone ? 16 : 13 };
  let results: ReactNode;
  if (!result) {
    results = <div className="desc-text">{busy ? <SearchLabel idle="" /> : (queryProblem(query) ?? 'Press Search to rank the sets this build could slot.')}</div>;
  } else if (result.problem) {
    results = <div className="desc-text">{result.problem}</div>;
  } else if (!result.swaps.length) {
    results = <div className="desc-text">{hasSlots ? 'Nothing found. Try another priority, or let more kinds of sets in.' : 'This build has no enhancement slots a set could go into yet.'}</div>;
  } else if (sort.by !== 'default') {
    results = found.map(row);
  } else {
    results = sets.map((g) => (
      <div key={g.set} style={{ marginBottom: 4 }}>
        {row(g.best)}
        {g.others.length ? (
          <div className="body-text" data-testid={`finder:more:${g.set}`} onClick={() => fold(g.set)} {...pressKeys(() => fold(g.set))} style={{ ...small, color: MUTED, cursor: 'pointer', padding: phone ? '8px 46px' : '0 38px 4px' }}>
            {more.has(g.set) ? 'Hide' : 'Show'} {g.others.length} other {g.others.length === 1 ? 'placement' : 'placements'}
          </div>
        ) : null}
        {more.has(g.set) ? <div style={{ marginLeft: phone ? 16 : 24 }}>{g.others.map(row)}</div> : null}
      </div>
    ));
  }
  // the form changed since the list was ranked, or a ranking after a kept swap changed never finished
  const outOfDate =
    !result || busy ? null : searched !== query ? 'The search has changed since this list was made.' : searchedKept !== kept ? 'Your kept swaps have changed since this list was made.' : null;
  return (
    <div>
      <Note />
      <div style={{ display: 'flex', alignItems: 'center' }}>
        {kept.length ? <TitleText style={{ fontSize: 18 }}>Kept</TitleText> : null}
        <SortLabel phone={phone} />
      </div>
      {kept.length ? (
        <div data-testid="finder:kept" style={{ marginBottom: 10 }}>
          {keptShown.map(row)}
          <TitleText style={{ fontSize: 18, marginTop: 10 }}>Results</TitleText>
        </div>
      ) : null}
      {outOfDate ? (
        <div className="body-text" data-testid="finder:outofdate" style={{ ...small, color: WARN, marginBottom: 6 }}>
          {outOfDate} Press Search to update it.
        </div>
      ) : null}
      <div style={{ opacity: busy && result ? 0.5 : 1 }}>{results}</div>
    </div>
  );
}

/** A kept swap on the phone's Kept tab, with a button to let it go. */
function KeptLine({ gd, swap }: { gd: GameData; swap: RankedSwap }) {
  const drop = useFinder((s) => s.drop);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8 }}>
      <SwapLine gd={gd} swap={swap} phone />
      <button data-testid={`finder:drop:${swap.key}`} className="info-button" style={{ position: 'static', marginLeft: 'auto', flexShrink: 0, height: 44, fontSize: 17 }} onClick={() => drop(swap.key)}>
        Remove
      </button>
    </div>
  );
}

/**
 * The gains and losses pane. With a swap pointed at (desktop) or selected, what that swap would
 * change on top of the kept ones; a kept swap shows what it is adding. With none, every kept swap
 * together against the build as it is.
 *
 * @param props.summary Always show the kept swaps together, each with a Remove button (the phone's Kept tab).
 * @param props.width The room its rows have (stage px), for the powers' bars.
 */
function Detail({ gd, build, rules, skin, phone, summary, width }: { gd: GameData; build: Build; rules: BuildRules; skin: Skin; phone: boolean; summary: boolean; width: number }) {
  // phones have no hover: only a tap selects
  const hovered = useHover((h) => (phone ? null : h.swap));
  const { result, kept, selected, sort } = useFinder(useShallow((s) => ({ result: s.result, kept: s.kept, selected: s.selected, sort: s.sort })));
  const shown = useMemo(() => {
    if (summary) return null;
    const all = [...kept, ...(result?.swaps ?? [])];
    const find = (id: string | null) => (id ? all.find((s) => swapId(s) === id) : undefined);
    // a hover left over from a list that has since changed falls back to the selection
    return find(hovered) ?? find(selected) ?? null;
  }, [summary, kept, result, hovered, selected]);
  const diff = useMemo(() => {
    if (!shown) return kept.length ? buildDiff(gd, rules, applySwaps(build, kept)) : null;
    const others = kept.filter((k) => k.key !== shown.key);
    const isKept = kept.some((k) => swapId(k) === swapId(shown));
    // a kept swap: what it adds to the others; a result: what it would change on top of the kept ones
    const before = applySwaps(build, isKept ? others : kept);
    return buildDiff(gd, rules.reslotted(before), applySwaps(build, [...others, shown]));
  }, [gd, build, rules, kept, shown]);

  const text: CSSProperties = { fontSize: phone ? 19 : 16, color: TEXT };
  if (shown) {
    return (
      <div className="body-text" style={text}>
        <SwapLine gd={gd} swap={shown} phone={phone} />
        {shown.displaced.length ? (
          // what it takes out, in short: a whole set as its count, part of one by its pieces
          <div data-testid="finder:replaces" style={{ marginTop: 6, fontSize: phone ? 16 : 13, display: 'flex', gap: 6 }}>
            <span style={{ color: MUTED, flex: 'none' }}>Replaces</span>
            <div style={{ color: TEXT }}>
              {replacedLines(gd, shown.displaced).map((line, i) => (
                <div key={i}>{line}</div>
              ))}
            </div>
          </div>
        ) : (
          <div style={{ color: MUTED, marginTop: 6, fontSize: phone ? 16 : 13 }}>Goes into empty slots.</div>
        )}
        {shown.warnings.map((w, i) => (
          <div key={i} data-testid="finder:warning" style={{ color: WARN, marginTop: 6 }}>
            {warningText(gd, w)}
          </div>
        ))}
        {diff ? <Diff gd={gd} diff={diff} skin={skin} phone={phone} width={width} /> : null}
      </div>
    );
  }
  if (!kept.length) {
    return (
      <div className="desc-text">
        {summary ? <Note /> : null}
        {phone ? 'Tap a result to see its net gains and losses. Tick its box to keep it.' : 'Point at a result to see its net gains and losses. Tick its box to keep it.'} Kept swaps change nothing until you apply them.
      </div>
    );
  }
  return (
    <div className="body-text" style={text}>
      {summary ? <Note /> : null}
      <TitleText style={{ fontSize: 20 }}>
        {kept.length} kept {kept.length === 1 ? 'swap' : 'swaps'}
        {kept.length > 1 ? ', together' : ''}
      </TitleText>
      {summary ? sortSwaps(gd, kept, sort).map((k) => <KeptLine key={k.key} gd={gd} swap={k} />) : null}
      {diff ? <Diff gd={gd} diff={diff} skin={skin} phone={phone} width={width} /> : null}
    </div>
  );
}

/** The Search button: off while a search runs, the form is incomplete or the finder can't work here. */
function SearchButton({ width, onSearch }: { width: number | string; onSearch: () => void }) {
  const ready = useFinder((s) => !!s.stats && !s.problem && !queryProblem(s.query) && s.progress === null);
  return (
    <button data-testid="finder:search" className="info-button" style={{ position: 'static', width }} disabled={!ready} onClick={onSearch}>
      <SearchLabel idle="Search" />
    </button>
  );
}

/**
 * The shopping list: the sets to get with their pieces, and what is still needed (on desktop with
 * the auction house search lines). Desktop shows the two parts side by side, a phone one under
 * the other.
 *
 * @param props.part Which part to draw.
 * @param props.width The room the sets' bars have (stage px).
 */
function Shopping({ gd, skin, phone, width, part }: { gd: GameData; skin: Skin; phone: boolean; width: number; part: 'sets' | 'needs' | 'both' }) {
  const { list, recipes } = useShoppingList(gd);
  return (
    <>
      {part === 'needs' ? null : <Note />}
      {part === 'needs' ? null : <ShopSets gd={gd} skin={skin} list={list} phone={phone} width={width} />}
      {part === 'both' && list.sets.length ? <div style={{ height: 12 }} /> : null}
      {part === 'sets' ? null : <ShopNeeds gd={gd} list={list} phone={phone} recipes={recipes} />}
    </>
  );
}

/**
 * What shows in the pane's place while the player clicks the powers to consider on the overview:
 * a box where the slot screen has "Slots Available" (red until a power is picked, then green),
 * and Done beside it, which brings the pane back.
 */
function PickPowers({ skin, onDone }: { skin: Skin; onDone: () => void }) {
  const stage = useStage();
  const n = useFinderOpen((s) => s.picked.length);
  const color = n > 0 ? '#00ff00' : '#ff0000';
  // desktop: SlotsAvailable's height (Chrome.tsx), wider for the longer line, over the Origin / Alignment
  // and Continue Leveling buttons at the top (wider than the two together), where it covers no power; phones: the slot screen's counter box, in the
  // place of New Build and Save / Share (which it covers while the powers are picked)
  const pg = phoneGeom(stage);
  const doneW = stage.phone ? 100 : vx(70);
  const gap = stage.phone ? 10 : 16;
  const box = stage.phone ? { x: 16, y: pg.nextY - 26, w: stage.w - 32 - gap - doneW, h: 52 } : { x: stage.w / 2 - (vx(280) + gap + doneW) / 2, y: vy(13), w: vx(280), h: vy(30) };
  const done = { x: box.x + box.w + gap, w: doneW };
  return (
    <div data-testid="finder:picking" className="abs" style={{ left: 0, top: 0, zIndex: 60 }}>
      {stage.phone ? <div className="abs" style={{ left: 0, top: box.y - 10, width: stage.w, height: box.h + 20, background: '#000' }} /> : null}
      <FlatFrame x={box.x} y={box.y} w={box.w} h={box.h} sc={S} border={color} back="#000" />
      <GameText font="game_12" scale={S} x={box.x + box.w / 2} y={box.y + box.h / 2} centerY align="center" colors={[color, color]} text="Select Powers to Consider" z={2} />
      {/* InfoButton is centered on its point */}
      <InfoButton skin={skin} x={done.x + done.w / 2} y={box.y + box.h / 2} w={done.w} h={box.h} text="Done" onClick={onDone} />
    </div>
  );
}

const PHONE_TABS = ['Search', 'Results', 'Kept', 'List'];
const LIST_TAB = 3;

/**
 * The set finder: a pop-up pane over the build overview (the whole screen on phones). A search
 * form, the kept and the ranked swaps, and the net gains and losses of the swap pointed at or of
 * every kept swap; the kept swaps go into this build, or into a copy opened in a new tab.
 *
 * Nothing here changes the build until "Apply to this build" is confirmed.
 */
export default function SetFinder({ skin }: { skin: Skin }) {
  const { gd, build } = useStore(useShallow((s) => ({ gd: s.gd, build: s.build })));
  const { prepare, search, stop, stats, busy, kept, link, apply, selected, result, keep, drop, setQuery, openShopping, clearShopping, openedNewBuild, saved } = useFinder(
    useShallow((s) => ({
      prepare: s.prepare,
      search: s.search,
      stop: s.stop,
      stats: s.stats,
      busy: s.progress !== null,
      kept: s.kept,
      link: s.link,
      apply: s.apply,
      selected: s.selected,
      result: s.result,
      keep: s.keep,
      drop: s.drop,
      setQuery: s.setQuery,
      openShopping: s.openShopping,
      clearShopping: s.clearShopping,
      openedNewBuild: s.openedNewBuild,
      // the stored list's size, once it is this build's server's (Clear list is off until then)
      saved: gd && s.shopFor === gd.server ? s.shop.length : 0,
    })),
  );
  const stage = useStage();
  const { phone } = stage;
  const [tab, setTab] = useState(0);
  // desktop: the shopping list takes the pane's place
  const [shopping, setShopping] = useState(false);
  const listShown = phone ? tab === LIST_TAB : shopping;
  // the list the browser keeps and the game version's recipes are read when the list shows
  useEffect(() => {
    if (listShown) openShopping();
  }, [listShown, openShopping, gd]);
  // out of the way while the player clicks the powers to consider on the overview
  const picking = useFinderOpen((s) => s.picking);
  /** Bring the pane back with the powers picked on the overview (none picked: every power again). */
  const donePicking = () => {
    const picked = useFinderOpen.getState().picked;
    if (picked.length) setQuery({ powers: picked, groups: undefined });
    else if (useFinder.getState().query.powers) setQuery({ powers: undefined });
    stopPickingPowers();
  };
  // Escape closes the pane; from the desktop's shopping list it goes back to the search first, and from picking powers back to the pane
  useEscape(() => (picking ? donePicking() : shopping && !phone ? setShopping(false) : close()));
  useFreshHover();
  // the statistics, and whether the finder can work on this build at all
  useEffect(() => prepare(), [prepare, gd, build?.dataVersion]);
  // a search still running when the pane closes is given up
  useEffect(() => stop, [stop]);
  const rules = useMemo(() => (gd && build ? new BuildRules(gd, build) : null), [gd, build]);
  const sections = useMemo(() => (gd && build && stats ? bonusChoices(gd, stats, gd.archetype(build.at).n) : []), [gd, build, stats]);
  const groups = useMemo(() => (gd && rules ? setGroupsOf(gd, rules.entries()) : []), [gd, rules]);
  const pickable = useMemo(() => (rules ? pickablePowers(rules.entries(), (p) => rules.slottable(p), rules.lastLevel()) : []), [rules]);
  // the shopping list has something to show: a kept swap's pieces, or what the browser keeps from
  // swaps applied before (read again when the kept swaps or the list shown change)
  const canShop = useMemo(() => kept.length > 0 || saved > 0 || (!!gd && readShopping(gd.server).length > 0), [gd, kept, saved]);
  // a form kept from another build drops what this build's lists can't show
  useEffect(() => {
    if (!sections.length) return;
    const q = useFinder.getState().query;
    const fit = fitQuery(q, sections, groups, pickable);
    if (fit !== q) setQuery(fit);
  }, [sections, groups, pickable, setQuery]);
  if (!gd || !build || !rules) return null;
  if (picking) return <PickPowers skin={skin} onDone={donePicking} />;

  const hasSlots = rules.entries().some((e) => e.slots.length > 0);
  const runSearch = () => {
    search();
    if (phone) setTab(1);
  };
  const closeButton = (width: number | string): ReactNode => (
    <button data-testid="finder:close" className="info-button" style={{ position: 'static', width }} onClick={close}>
      Close
    </button>
  );
  const applyButtons = (width: number | string, short = false): ReactNode => (
    <>
      <button data-testid="finder:apply" className="info-button" title="Puts the kept swaps into this build" style={{ position: 'static', width, padding: short ? 0 : undefined }} disabled={!kept.length} onClick={() => void apply()}>
        {short ? 'Apply' : 'Apply to this build'}
      </button>
      {link ? (
        // a real link the code wrote, opened by the player's own click: no pop-up blocker fires
        <a
          data-testid="finder:newbuild"
          className="info-button"
          href={link}
          target="_blank"
          rel="noopener noreferrer"
          // the changed build is being opened: its pieces go on the shopping list (a middle click opens it too)
          onClick={openedNewBuild}
          onAuxClick={(e) => (e.button === 1 ? openedNewBuild() : undefined)}
          title="Leaves this build as it is and opens the changed one in a new tab"
          style={{ position: 'static', width, padding: short ? 0 : undefined, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', textDecoration: 'none', boxSizing: 'border-box' }}
        >
          {short ? 'New build' : 'Open as new build'}
        </a>
      ) : (
        <button data-testid="finder:newbuild" className="info-button" style={{ position: 'static', width, padding: short ? 0 : undefined }} disabled>
          {short ? 'New build' : 'Open as new build'}
        </button>
      )}
    </>
  );

  const clearButton = (width: number | string): ReactNode => (
    <button data-testid="shop:clear" className="info-button" title="Empties the shopping list this browser keeps" style={{ position: 'static', width }} disabled={!saved} onClick={() => void clearShopping()}>
      Clear list
    </button>
  );

  if (phone) {
    const W = stage.w;
    const bottom = stage.h - 36; // clear of the not-affiliated line
    const tabsY = 82;
    // four tabs are one row that slides sideways
    const top = tabsY + PHONE_TAB_ROW / 2 + 8;
    const btnY = bottom - 14 - 56;
    const room = btnY - 10 - top;
    const listH = tab === 1 ? Math.round(room * 0.52) : room;
    const chosen = selected ? [...kept, ...(result?.swaps ?? [])].find((s) => swapId(s) === selected) : undefined;
    const chosenKept = !!chosen && kept.some((k) => swapId(k) === selected);
    const btnW = Math.floor((W - 32 - 2 * 10) / 3);
    return (
      <div className="overlay" onClick={close}>
        <div onClick={(e) => e.stopPropagation()}>
          <MenuFrame x={6} y={6} w={W - 12} h={bottom - 6} r25 style={{ background: skin.panel }} skin={skin} />
          <SetTitle x={18} y={18} size={24} width={W - 60} text={FINDER_NAME} skin={skin} />
          <PhoneTabs skin={skin} labels={PHONE_TABS.map((t, i) => (i === 2 && kept.length ? `Kept (${kept.length})` : t))} active={tab} onChange={setTab} y={tabsY} x={16} width={W - 20} clickSounds={['powerselect2']} disabled={PHONE_TABS.map((_, i) => i === LIST_TAB && !canShop && tab !== LIST_TAB)} />
          <div className="abs scroll-y" style={{ left: 16, top, width: W - 32, height: listH }}>
            {tab === 0 ? (
              <SearchForm skin={skin} sections={sections} groups={groups} phone />
            ) : tab === 1 ? (
              <ResultList gd={gd} phone hasSlots={hasSlots} />
            ) : tab === LIST_TAB ? (
              <Shopping gd={gd} skin={skin} phone width={W - 32} part="both" />
            ) : (
              <Detail gd={gd} build={build} rules={rules} skin={skin} phone summary width={W - 32 - 12} />
            )}
          </div>
          {tab === 1 ? (
            <>
              <MenuFrame x={10} y={top + listH + 8} w={W - 20} h={room - listH - 8} skin={skin} />
              <div className="abs scroll-y" style={{ left: 22, top: top + listH + 18, width: W - 44, height: room - listH - 28 }}>
                <Detail gd={gd} build={build} rules={rules} skin={skin} phone summary={false} width={W - 44 - 12} />
              </div>
            </>
          ) : null}
          <div className="abs" style={{ left: 16, top: btnY, width: W - 32, display: 'flex', justifyContent: 'center', gap: 10 }}>
            {tab === 0 ? (
              <>
                <SearchButton width={btnW * 2} onSearch={runSearch} />
                {closeButton(btnW)}
              </>
            ) : tab === 1 ? (
              <>
                <button
                  data-testid="finder:keepselected"
                  className="info-button"
                  style={{ position: 'static', width: btnW * 2 }}
                  disabled={!chosen || (busy && !chosenKept)}
                  onClick={() => chosen && (chosenKept ? drop(chosen.key) : keep(chosen))}
                >
                  {chosenKept ? 'Let it go' : 'Keep this swap'}
                </button>
                {closeButton(btnW)}
              </>
            ) : tab === LIST_TAB ? (
              <>
                {clearButton(btnW * 2)}
                {closeButton(btnW)}
              </>
            ) : (
              <>
                {applyButtons(btnW, /*short=*/ true)}
                {closeButton(btnW)}
              </>
            )}
          </div>
        </div>
      </div>
    );
  }

  // desktop: the form, the lists and the gains and losses side by side
  const F = { x: 100, y: 70, w: 1800, h: 985 };
  const paneY = 160;
  const paneH = 790;
  const form = { x: 140, w: 500 };
  const list = { x: 670, w: 620 };
  const det = { x: 1310, w: 560 };
  const btnY = paneY + paneH + 22;
  if (shopping) {
    const sets = { x: 140, w: 850 };
    const needs = { x: 1010, w: 860 };
    return (
      <div className="overlay" onClick={close}>
        <div onClick={(e) => e.stopPropagation()}>
          <MenuFrame x={F.x} y={F.y} w={F.w} h={F.h} r25 style={{ background: skin.panel }} skin={skin} />
          <SetTitle x={F.x + 40} y={F.y + 20} size={34} width={F.w - 80} text={`${FINDER_NAME}: Shopping List`} skin={skin} />
          <MenuFrame x={sets.x} y={paneY} w={sets.w} h={paneH} skin={skin} />
          <div className="abs scroll-y" style={{ left: sets.x + 14, top: paneY + 12, width: sets.w - 28, height: paneH - 24 }}>
            <Shopping gd={gd} skin={skin} phone={false} width={sets.w - 44} part="sets" />
          </div>
          <MenuFrame x={needs.x} y={paneY} w={needs.w} h={paneH} skin={skin} />
          <div className="abs scroll-y" style={{ left: needs.x + 18, top: paneY + 14, width: needs.w - 36, height: paneH - 28 }}>
            <Shopping gd={gd} skin={skin} phone={false} width={needs.w - 36} part="needs" />
          </div>
          <div className="abs" style={{ left: sets.x, top: btnY, width: sets.w, display: 'flex', justifyContent: 'flex-start' }}>
            <button data-testid="shop:back" className="info-button" style={{ position: 'static', width: 240 }} onClick={() => setShopping(false)}>
              Back to the search
            </button>
          </div>
          <div className="abs" style={{ left: needs.x, top: btnY, width: needs.w, display: 'flex', justifyContent: 'flex-end', gap: 14 }}>
            {clearButton(160)}
            {closeButton(120)}
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="overlay" onClick={close}>
      <div onClick={(e) => e.stopPropagation()}>
        <MenuFrame x={F.x} y={F.y} w={F.w} h={F.h} r25 style={{ background: skin.panel }} skin={skin} />
        <SetTitle x={F.x + 40} y={F.y + 20} size={34} width={F.w - 80} text={FINDER_NAME} skin={skin} />
        <div className="abs scroll-y" style={{ left: form.x, top: paneY, width: form.w, height: paneH }}>
          <SearchForm skin={skin} sections={sections} groups={groups} phone={false} />
        </div>
        <MenuFrame x={list.x} y={paneY} w={list.w} h={paneH} skin={skin} />
        <div className="abs scroll-y" style={{ left: list.x + 14, top: paneY + 12, width: list.w - 28, height: paneH - 24 }}>
          <ResultList gd={gd} phone={false} hasSlots={hasSlots} />
        </div>
        <MenuFrame x={det.x} y={paneY} w={det.w} h={paneH} skin={skin} />
        <div className="abs scroll-y" style={{ left: det.x + 18, top: paneY + 14, width: det.w - 36, height: paneH - 28 }}>
          <Detail gd={gd} build={build} rules={rules} skin={skin} phone={false} summary={false} width={det.w - 36 - 12} />
        </div>
        <div className="abs" style={{ left: form.x, top: btnY, width: form.w, display: 'flex', justifyContent: 'center' }}>
          <SearchButton width={220} onSearch={runSearch} />
        </div>
        <div className="abs" style={{ left: list.x, top: btnY, width: det.x + det.w - list.x, display: 'flex', justifyContent: 'flex-end', gap: 14 }}>
          <button data-testid="finder:shopping" className="info-button" title="What the kept and applied swaps need: recipes, salvage and enhancements" style={{ position: 'static', width: 190 }} disabled={!canShop} onClick={() => setShopping(true)}>
            Shopping List
          </button>
          {applyButtons(210)}
          {closeButton(120)}
        </div>
      </div>
    </div>
  );
}
