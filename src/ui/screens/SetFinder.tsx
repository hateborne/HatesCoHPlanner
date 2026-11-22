import { memo, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useShallow } from 'zustand/react/shallow';
import type { GameData } from '../../data/gamedata.ts';
import type { Build } from '../../engine/build.ts';
import { setLevelRange, setRarity } from '../../engine/enhance.ts';
import { buildDiff, type BuildDiff, type DiffRow } from '../../engine/finder/diff.ts';
import { statAmount, statLabel, warningText } from '../../engine/finder/labels.ts';
import { applySwaps, type Swap } from '../../engine/finder/pending.ts';
import { GOALS, MAX_EXTRA, MAX_GOALS, queryProblem, type Depth, type GoalId, type Importance, type SetTag } from '../../engine/finder/query.ts';
import type { RankedSwap } from '../../engine/finder/search.ts';
import { bonusChoices, bySet, fitQuery, setGroupsOf, type StatSection } from '../../engine/finder/view.ts';
import { BuildRules } from '../../engine/rules.ts';
import { computeTotals, type Totals } from '../../engine/totals.ts';
import { swapId, useFinder } from '../../state/finder.ts';
import { closeSetFinder as close } from '../../state/finderOpen.ts';
import { useStore } from '../../state/store.ts';
import { MenuFrame, SetTitle } from '../components/Chrome.tsx';
import { FINDER_NAME } from '../components/FinderIcon.tsx';
import { TitleText } from '../components/GameText.tsx';
import { PHONE_TAB_ROW, PhoneTabs } from '../components/Phone.tsx';
import { PhoneTipLayer } from '../components/PhoneTip.tsx';
import { rarityStyle } from '../components/PowerTip.tsx';
import { useStage } from '../components/Stage.tsx';
import { MPH, TotalsRow } from '../components/TotalsPanel.tsx';
import { useEscape } from '../escape.ts';
import { pressText, useFreshHover, useHover } from '../hover.ts';
import { longPress, pressKeys } from '../press.ts';
import type { Skin } from '../skin/skin.ts';
import { EnhIcon } from './EnhancementPicker.tsx';
import { ShopNeeds, ShopSets, useShoppingList, type RecipesState } from './FinderShopping.tsx';
import type { ShoppingList } from '../../engine/finder/shopping.ts';

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

const TEXT = '#cfe8ff';
const MUTED = '#8fa1b8';
const WARN = '#ffd24a';
const BAD = '#ff5a5a';

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

/** Rows of one side of the gains and losses, laid out like the totals pane. */
function DiffRows({ gd, rows, gain, power }: { gd: GameData; rows: DiffRow[]; gain: boolean; power: boolean }) {
  return (
    <>
      {rows.map((r) => (
        <TotalsRow
          key={r.key}
          // a line of a family ("def.03") is named by the totals with its type alone
          label={power ? r.label : (PANE_LABEL[r.key] ?? (r.key.includes('.') ? statLabel(gd, r.key) : r.label))}
          value={`${figure(r.key, r.before, power)} -> ${figure(r.key, r.after, power)}`}
          tone={gain ? 1 : -1}
          noMark
        />
      ))}
    </>
  );
}

/** Net gains and net losses of a change: the totals first, then each changed power's own figures. */
function Diff({ gd, diff }: { gd: GameData; diff: BuildDiff }) {
  const none = !diff.gains.length && !diff.losses.length && diff.powers.every((p) => !p.gains.length && !p.losses.length);
  if (none) return <div className="desc-text">No change in the totals.</div>;
  const own = (side: 'gains' | 'losses') =>
    diff.powers
      .filter((p) => p[side].length)
      .map((p) => (
        <div key={p.key} style={{ marginTop: 6 }}>
          <div style={{ color: MUTED }}>{gd.power(p.power).dn}</div>
          <DiffRows gd={gd} rows={p[side]} gain={side === 'gains'} power />
        </div>
      ));
  return (
    <>
      <TitleText style={{ fontSize: 18, marginTop: 10 }}>Net Gains</TitleText>
      <div data-testid="finder:gains">
        {diff.gains.length || diff.powers.some((p) => p.gains.length) ? null : <div style={{ color: MUTED }}>None.</div>}
        <DiffRows gd={gd} rows={diff.gains} gain power={false} />
        {own('gains')}
      </div>
      <TitleText style={{ fontSize: 18, marginTop: 14 }}>Net Losses</TitleText>
      <div data-testid="finder:losses">
        {diff.losses.length || diff.powers.some((p) => p.losses.length) ? null : <div style={{ color: MUTED }}>None.</div>}
        <DiffRows gd={gd} rows={diff.losses} gain={false} power={false} />
        {own('losses')}
      </div>
    </>
  );
}

/**
 * What a swap places: the set's name in its rarity colour, the power it goes into, the pieces as
 * small icons. A piece's name is its hover text; phones have no hover, so a long press lists them.
 */
function SwapLine({ gd, swap, phone }: { gd: GameData; swap: Swap; phone: boolean }) {
  const set = gd.boostSetById.get(swap.set);
  const [lo, hi] = set ? setLevelRange(set) : [0, 0];
  const names = swap.pieces.map((p) => gd.powerById.get(p.enh.boost)?.dn ?? 'An enhancement').join('\n');
  return (
    <div {...longPress(phone ? pressText(names) : undefined)} style={{ minWidth: 0 }}>
      <div style={{ fontSize: phone ? 20 : 17, lineHeight: 1.2 }}>
        <span style={{ color: TEXT, ...rarityStyle(set ? setRarity(set) : undefined) }}>{set?.dn ?? 'Unknown set'}</span> <span style={{ color: '#fff' }}>x{swap.count}</span>{' '}
        <span style={{ color: MUTED, fontSize: phone ? 15 : 13 }}>
          ({lo + 1}-{hi + 1})
        </span>
      </div>
      <div style={{ color: TEXT, fontSize: phone ? 17 : 14 }}>into {gd.powerById.get(swap.power)?.dn ?? 'a power'}</div>
      <div style={{ display: 'flex', gap: 2, marginTop: 2 }}>
        {swap.pieces.map((p) => {
          const b = gd.powerById.get(p.enh.boost);
          return b ? (
            <div key={p.slot} title={b.dn} style={{ flexShrink: 0 }}>
              <EnhIcon gd={gd} b={b} size={phone ? 34 : 28} lazy />
            </div>
          ) : null;
        })}
      </div>
    </div>
  );
}

/**
 * A box the player ticks: a native check box with its label, sized for a finger on phones. Its
 * hint is its hover text; on phones a long press shows it.
 */
function Tick({ label, checked, onChange, testId, title, phone, disabled }: { label: string; checked: boolean; onChange: (on: boolean) => void; testId: string; title?: string; phone: boolean; disabled?: boolean }) {
  return (
    <label
      title={title}
      {...longPress(phone && title ? pressText(title) : undefined)}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 8, minHeight: phone ? 44 : 28, cursor: disabled ? 'default' : 'pointer', marginRight: 16, opacity: disabled ? 0.45 : 1 }}
    >
      <input type="checkbox" data-testid={testId} checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} style={phone ? { width: 28, height: 28, margin: 0 } : { width: 18, height: 18, margin: 0 }} />
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

  /** Set, change or clear priority `i`; a goal can be picked once. */
  const setGoal = (i: number, goal: GoalId | '', importance?: Importance) => {
    const goals = query.goals.slice();
    if (!goal) goals.splice(i, 1);
    else goals[i] = { goal, importance: importance ?? goals[i]?.importance ?? 'medium' };
    setQuery({ goals: goals.filter((g, k) => goals.findIndex((x) => x.goal === g.goal) === k) });
  };
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
      {Array.from({ length: Math.min(MAX_GOALS, query.goals.length + 1) }, (_, i) => {
        const cur = query.goals[i];
        return (
          <div key={i} style={row}>
            <select data-testid={`finder:goal:${i}`} aria-label={`Priority ${i + 1}`} value={cur?.goal ?? ''} onChange={(e) => setGoal(i, e.target.value as GoalId | '')} style={{ ...select, flex: 3 }}>
              <option value="" style={option}>
                {i === 0 ? 'Choose a priority' : 'Add a priority'}
              </option>
              {GOALS.map((g) => (
                <option key={g.id} value={g.id} disabled={query.goals.some((x, k) => k !== i && x.goal === g.id)} style={option}>
                  {g.name}
                </option>
              ))}
            </select>
            <select
              data-testid={`finder:importance:${i}`}
              aria-label={`Importance of priority ${i + 1}`}
              value={cur?.importance ?? 'medium'}
              disabled={!cur}
              onChange={(e) => cur && setGoal(i, cur.goal, e.target.value as Importance)}
              style={{ ...select, flex: 2, opacity: cur ? 1 : 0.45 }}
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
            disabled={!!query.budget && t.id !== 'seasonal'}
            onChange={(on) => setQuery({ tags: on ? [...query.tags, t.id] : query.tags.filter((x) => x !== t.id) })}
          />
        ))}
      </div>
      <Tick testId="finder:attuned" label="Attuned pieces" title="Place attuned pieces instead of crafted ones at the highest level that works" phone={phone} checked={!!query.attuned} disabled={!!query.budget} onChange={(on) => setQuery({ attuned: on })} />
      <Tick testId="finder:budget" label="Budget" title="Rank swaps lower for the rarest salvage their recipes need" phone={phone} checked={!!query.budget} onChange={(on) => setQuery(on ? { budget: true, tags: [], attuned: false } : { budget: false })} />

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
        <select data-testid="finder:group" aria-label="Set type" value={query.groups?.[0] ?? ''} onChange={(e) => setQuery({ groups: e.target.value ? [e.target.value] : undefined })} style={{ ...select, flex: 1 }}>
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
  onKeep: (swap: RankedSwap, kept: boolean) => void; // keep it, or let it go when kept
  onSelect: (id: string) => void; // show its gains and losses, or stop showing them
}

/**
 * One swap in a list: the box that keeps it or lets it go, what it places, and its warnings.
 * Clicking the row (or Enter on its text) shows its gains and losses; pointing at it does on desktop.
 *
 * Drawn again only when what it is given changes (its handlers are the same ones every time), so
 * a click on one row doesn't draw the whole list again.
 */
const ResultRow = memo(function ResultRow({ gd, swap, kept, selected, phone, busy, onKeep, onSelect }: ResultRowProps) {
  const id = swapId(swap);
  const name = `${gd.boostSetById.get(swap.set)?.dn ?? 'Set'} into ${gd.powerById.get(swap.power)?.dn ?? 'a power'}`;
  const warned = swap.warnings.length ? `${swap.warnings.length} ${swap.warnings.length === 1 ? 'warning' : 'warnings'}` : '';
  const show = () => onSelect(id);
  // phones have no pointer to hover with: a tap would leave a hover behind that never clears.
  // The hover is taken off when the pointer leaves the lists (ResultList), not each row: between
  // two rows the pane keeps showing the last one instead of working out the summary in passing
  const hover = phone ? {} : { onMouseEnter: () => useHover.setState({ swap: id }) };
  return (
    <div
      data-testid={`finder:swap:${id}`}
      onClick={show}
      {...hover}
      className="body-text"
      style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', padding: phone ? '8px 8px' : '5px 8px', borderRadius: 10, border: `2px solid ${selected ? '#00d919' : 'transparent'}`, background: selected ? 'rgba(0,217,25,0.15)' : 'transparent' }}
    >
      <input
        type="checkbox"
        data-testid={`finder:keep:${id}`}
        data-keep={id}
        aria-label={kept ? `Kept: ${name}. Untick to let it go` : `Keep ${name}`}
        title={kept ? 'Kept: untick to let it go' : 'Keep this swap'}
        checked={kept}
        // while the list is being ranked again, what it offers may no longer fit
        disabled={busy && !kept}
        onClick={(e) => e.stopPropagation()}
        onChange={() => onKeep(swap, kept)}
        style={{ flexShrink: 0, width: phone ? 28 : 20, height: phone ? 28 : 20, margin: 0 }}
      />
      {/* the keyboard's way to the row: Enter on it shows the swap, as a click anywhere on the row does (its name stands in for its text, so it says the warnings too) */}
      <div {...pressKeys(show, undefined, `${name}${warned ? `, ${warned}` : ''}: show its gains and losses`)} data-row={id} style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 }}>
        <SwapLine gd={gd} swap={swap} phone={phone} />
        {swap.warnings.length ? (
          <div title={swap.warnings.map((w) => warningText(gd, w)).join('\n')} style={{ marginLeft: 'auto', flexShrink: 0, color: WARN, fontSize: phone ? 17 : 14 }}>
            {warned}
          </div>
        ) : null}
      </div>
    </div>
  );
});

/**
 * Tick or untick a swap's box. Its row then moves between the lists with no mouseleave, so the
 * hover it leaves behind is cleared; a keyboard's place goes with the box to where the row now is.
 *
 * @param s The swap.
 * @param isKept Whether it is kept now (it is then let go).
 */
function toggleKept(s: RankedSwap, isKept: boolean): void {
  const finder = useFinder.getState();
  const before = finder.kept;
  const id = swapId(s);
  const box = document.activeElement instanceof HTMLElement && document.activeElement.dataset.keep === id;
  if (isKept) finder.drop(s.key);
  else finder.keep(s);
  if (useFinder.getState().kept === before) return;
  useHover.setState({ swap: null });
  if (!box) return;
  // the box was drawn anew in the other list: without this the keyboard would start from the top
  // of the page. A box let go is off while the list is ranked again, and the row may not come
  // back at all: then the row's name takes the keyboard's place, or the lists themselves
  requestAnimationFrame(() => {
    const at = CSS.escape(id);
    const again = document.querySelector<HTMLInputElement>(`[data-keep="${at}"]`);
    const to = again && !again.disabled ? again : (document.querySelector<HTMLElement>(`[data-row="${at}"]`) ?? document.querySelector<HTMLElement>('[data-finder-lists]'));
    to?.focus({ preventScroll: true });
  });
}

/**
 * Show a swap's gains and losses, or stop showing them when they are the ones shown.
 *
 * @param id The swap's id.
 */
function toggleSelected(id: string): void {
  const finder = useFinder.getState();
  finder.select(finder.selected === id ? null : id);
}

/**
 * The lists: the kept swaps first, each with its box ticked, then the results, each set with its
 * best placement and its other placements folded under it.
 */
function ResultList({ gd, phone, hasSlots }: { gd: GameData; phone: boolean; hasSlots: boolean }) {
  // only what the lists draw from: of the form, why it can't be searched and whether it changed
  // since the list was made, not the form itself (changing it must not draw every row again)
  const { result, busy, kept, selected, problem, loading, unready, formChanged, searchedKept } = useFinder(
    useShallow((s) => ({
      result: s.result,
      busy: s.progress !== null,
      kept: s.kept,
      selected: s.selected,
      problem: s.problem,
      loading: s.loading,
      unready: s.result ? null : queryProblem(s.query),
      formChanged: s.searched !== s.query,
      searchedKept: s.searchedKept,
    })),
  );
  const [more, setMore] = useState<ReadonlySet<number>>(new Set());
  const keptIds = useMemo(() => new Set(kept.map(swapId)), [kept]);
  // a kept swap shows under Kept only (a list not ranked again since it was kept still holds it)
  const sets = useMemo(() => bySet((result?.swaps ?? []).filter((s) => !keptIds.has(swapId(s)))), [result, keptIds]);
  // a list ranked again has other rows under the pointer: the hover on a row of the old one goes
  useEffect(() => {
    useHover.setState((h) => (h.swap ? { swap: null } : h));
  }, [result]);
  if (loading) return <div className="desc-text">Loading the build statistics...</div>;
  if (problem) return <div className="desc-text">{problem}</div>;

  const row = (s: RankedSwap) => {
    const id = swapId(s);
    return <ResultRow key={id} gd={gd} swap={s} kept={keptIds.has(id)} selected={selected === id} phone={phone} busy={busy} onKeep={toggleKept} onSelect={toggleSelected} />;
  };
  const fold = (set: number) => setMore(new Set(more.has(set) ? [...more].filter((x) => x !== set) : [...more, set]));
  const small: CSSProperties = { fontSize: phone ? 16 : 13 };
  let results: ReactNode;
  if (!result) {
    results = <div className="desc-text">{busy ? <SearchLabel idle="" /> : (unready ?? 'Press Search to rank the sets this build could slot.')}</div>;
  } else if (result.problem) {
    results = <div className="desc-text">{result.problem}</div>;
  } else if (!result.swaps.length) {
    results = <div className="desc-text">{hasSlots ? 'Nothing found. Try another priority, or let more kinds of sets in.' : 'This build has no enhancement slots a set could go into yet.'}</div>;
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
    !result || busy ? null : formChanged ? 'The search has changed since this list was made.' : searchedKept !== kept ? 'Your kept swaps have changed since this list was made.' : null;
  return (
    // the pointer left the lists: no swap is pointed at any more (see ResultRow). The lists can
    // take the keyboard's place when a row that had it is gone (toggleKept)
    <div data-finder-lists tabIndex={-1} style={{ outline: 'none' }} onMouseLeave={phone ? undefined : () => useHover.setState((h) => (h.swap ? { swap: null } : h))}>
      <Note />
      {kept.length ? (
        <div data-testid="finder:kept" style={{ marginBottom: 10 }}>
          <TitleText style={{ fontSize: 18 }}>Kept</TitleText>
          {kept.map(row)}
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
 */
function Detail({ gd, build, rules, phone, summary }: { gd: GameData; build: Build; rules: BuildRules; phone: boolean; summary: boolean }) {
  // phones have no hover: only a tap selects
  const hovered = useHover((h) => (phone ? null : h.swap));
  const { result, kept, selected } = useFinder(useShallow((s) => ({ result: s.result, kept: s.kept, selected: s.selected })));
  const shown = useMemo(() => {
    if (summary) return null;
    const all = [...kept, ...(result?.swaps ?? [])];
    const find = (id: string | null) => (id ? all.find((s) => swapId(s) === id) : undefined);
    // a hover left over from a list that has since changed falls back to the selection
    return find(hovered) ?? find(selected) ?? null;
  }, [summary, kept, result, hovered, selected]);
  // the build with the kept swaps in: what every result pointed at is compared with. Its rules
  // and totals are worked out once (when first asked for), not again for each row the pointer
  // crosses: they were half of what a comparison cost
  const keptSide = useMemo(() => {
    let made: { rules: BuildRules; totals: Totals } | undefined;
    return () => {
      if (!made) {
        const r = kept.length ? rules.reslotted(applySwaps(build, kept)) : rules;
        made = { rules: r, totals: computeTotals(gd, r, r.b, r.lastLevel()) };
      }
      return made;
    };
  }, [gd, build, rules, kept]);
  const diff = useMemo(() => {
    if (!shown) return kept.length ? buildDiff(gd, rules, applySwaps(build, kept)) : null;
    const others = kept.filter((k) => k.key !== shown.key);
    const after = applySwaps(build, [...others, shown]);
    // a kept swap: what it adds to the others; a result: what it would change on top of the kept ones
    if (kept.some((k) => swapId(k) === swapId(shown))) return buildDiff(gd, rules.reslotted(applySwaps(build, others)), after);
    const side = keptSide();
    return buildDiff(gd, side.rules, after, side.totals);
  }, [gd, build, rules, kept, shown, keptSide]);
  // another swap's figures start from their top, not from where the last one's were scrolled to
  const top = useRef<HTMLDivElement>(null);
  const shownId = shown ? swapId(shown) : null;
  useEffect(() => {
    const pane = top.current?.parentElement;
    if (pane && pane.scrollTop) pane.scrollTop = 0;
  }, [shownId]);

  const text: CSSProperties = { fontSize: phone ? 19 : 16, color: TEXT };
  if (shown) {
    return (
      <div ref={top} className="body-text" style={text}>
        <SwapLine gd={gd} swap={shown} phone={phone} />
        {shown.displaced.length ? (
          <div style={{ color: MUTED, marginTop: 6, fontSize: phone ? 16 : 13 }}>Replaces: {shown.displaced.map((id) => gd.powerById.get(id)?.dn ?? 'an enhancement').join(', ')}</div>
        ) : (
          <div style={{ color: MUTED, marginTop: 6, fontSize: phone ? 16 : 13 }}>Goes into empty slots.</div>
        )}
        {shown.warnings.map((w, i) => (
          <div key={i} data-testid="finder:warning" style={{ color: WARN, marginTop: 6 }}>
            {warningText(gd, w)}
          </div>
        ))}
        {diff ? <Diff gd={gd} diff={diff} /> : null}
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
      {summary ? kept.map((k) => <KeptLine key={k.key} gd={gd} swap={k} />) : null}
      {diff ? <Diff gd={gd} diff={diff} /> : null}
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
 * @param props.shop The list and where its recipes stand (useShoppingList), put together once by
 *   whoever draws the parts.
 * @param props.part Which part to draw.
 * @param props.width The room the sets' bars have (stage px).
 */
function Shopping({ gd, skin, phone, width, part, shop }: { gd: GameData; skin: Skin; phone: boolean; width: number; part: 'sets' | 'needs' | 'both'; shop: { list: ShoppingList; recipes: RecipesState } }) {
  const { list, recipes } = shop;
  return (
    <>
      {part === 'needs' ? null : <Note />}
      {part === 'needs' ? null : <ShopSets gd={gd} skin={skin} list={list} phone={phone} width={width} />}
      {part === 'both' && list.sets.length ? <div style={{ height: 12 }} /> : null}
      {part === 'sets' ? null : <ShopNeeds gd={gd} list={list} phone={phone} recipes={recipes} />}
    </>
  );
}

/** The phone's List tab: the whole shopping list, one part under the other. */
function PhoneShopping({ gd, skin, width }: { gd: GameData; skin: Skin; width: number }) {
  const shop = useShoppingList(gd);
  return <Shopping gd={gd} skin={skin} phone width={width} part="both" shop={shop} />;
}

/** The desktop's shopping list: the sets on the left, what is still needed on the right, from one list. */
function DesktopShopping({ gd, skin, sets, needs, y, h }: { gd: GameData; skin: Skin; sets: { x: number; w: number }; needs: { x: number; w: number }; y: number; h: number }) {
  const shop = useShoppingList(gd);
  return (
    <>
      <MenuFrame x={sets.x} y={y} w={sets.w} h={h} skin={skin} />
      <div className="abs scroll-y" style={{ left: sets.x + 14, top: y + 12, width: sets.w - 28, height: h - 24 }}>
        <Shopping gd={gd} skin={skin} phone={false} width={sets.w - 44} part="sets" shop={shop} />
      </div>
      <MenuFrame x={needs.x} y={y} w={needs.w} h={h} skin={skin} />
      <div className="abs scroll-y" style={{ left: needs.x + 18, top: y + 14, width: needs.w - 36, height: h - 28 }}>
        <Shopping gd={gd} skin={skin} phone={false} width={needs.w - 36} part="needs" shop={shop} />
      </div>
    </>
  );
}

/** The phone's button under the results: keeps the swap whose gains and losses show, or lets it go when it is kept. */
function KeepSelectedButton({ width }: { width: number }) {
  // the swap and whether it is kept, read here so that selecting a row draws this button again, not the whole pane
  const { chosen, isKept, busy } = useFinder(
    useShallow((s) => {
      const chosen = s.selected ? [...s.kept, ...(s.result?.swaps ?? [])].find((x) => swapId(x) === s.selected) : undefined;
      return { chosen, isKept: !!chosen && s.kept.some((k) => swapId(k) === s.selected), busy: s.progress !== null };
    }),
  );
  return (
    <button
      data-testid="finder:keepselected"
      className="info-button"
      style={{ position: 'static', width }}
      disabled={!chosen || (busy && !isKept)}
      onClick={() => chosen && (isKept ? useFinder.getState().drop(chosen.key) : useFinder.getState().keep(chosen))}
    >
      {isKept ? 'Let it go' : 'Keep this swap'}
    </button>
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
  // (what only one part of the pane draws from, such as the selected swap, is read by that part)
  const { prepare, search, stop, stats, kept, link, apply, setQuery, openShopping, clearShopping, openedNewBuild, saved } = useFinder(
    useShallow((s) => ({
      prepare: s.prepare,
      search: s.search,
      stop: s.stop,
      stats: s.stats,
      kept: s.kept,
      link: s.link,
      apply: s.apply,
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
  // Escape closes the pane; from the desktop's shopping list it goes back to the search first
  useEscape(() => (shopping && !phone ? showShopping(false) : close()));
  useFreshHover();
  // the statistics, and whether the finder can work on this build at all
  useEffect(() => prepare(), [prepare, gd, build?.dataVersion]);
  // a search still running when the pane closes is given up
  useEffect(() => stop, [stop]);
  const rules = useMemo(() => (gd && build ? new BuildRules(gd, build) : null), [gd, build]);
  const sections = useMemo(() => (gd && build && stats ? bonusChoices(gd, stats, gd.archetype(build.at).n) : []), [gd, build, stats]);
  const groups = useMemo(() => (gd && rules ? setGroupsOf(gd, rules.entries()) : []), [gd, rules]);
  // a form kept from another build drops what this build's lists can't show
  useEffect(() => {
    if (!sections.length) return;
    const q = useFinder.getState().query;
    const fit = fitQuery(q, sections, groups);
    if (fit !== q) setQuery(fit);
  }, [sections, groups, setQuery]);
  const hasSlots = useMemo(() => !!rules && rules.entries().some((e) => e.slots.length > 0), [rules]);
  // desktop: the keyboard's place follows the switch between the search and the shopping list
  // (the button pressed is not drawn on the other side)
  const shoppingButton = useRef<HTMLButtonElement>(null);
  const backButton = useRef<HTMLButtonElement>(null);
  const switched = useRef(false);
  useEffect(() => {
    if (switched.current) (shopping ? backButton : shoppingButton).current?.focus({ preventScroll: true });
  }, [shopping]);
  const showShopping = (on: boolean) => {
    switched.current = true;
    setShopping(on);
  };
  // desktop: the lists' scrolling pane, wound back when a new search starts
  const listPane = useRef<HTMLDivElement>(null);
  if (!gd || !build || !rules) return null;

  const runSearch = () => {
    search();
    if (phone) setTab(1);
    else if (listPane.current) listPane.current.scrollTop = 0;
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
          // the changed build is being opened: its pieces go on the shopping list (a middle click
          // opens it too). The link has no menu of its own here: the stage keeps the right click
          // and a phone's long press for the planner (Stage.tsx)
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
    // four tabs sit in two rows
    const top = tabsY + PHONE_TAB_ROW * 1.5 + 8;
    const btnY = bottom - 14 - 56;
    const room = btnY - 10 - top;
    const listH = tab === 1 ? Math.round(room * 0.52) : room;
    const btnW = Math.floor((W - 32 - 2 * 10) / 3);
    return (
      // (no tap beside the frame closes it here: the frame fills the screen but for a strip under it)
      <div className="overlay">
        <div>
          <MenuFrame x={6} y={6} w={W - 12} h={bottom - 6} r25 style={{ background: skin.panel }} skin={skin} />
          <SetTitle x={18} y={18} size={24} width={W - 60} text={FINDER_NAME} skin={skin} />
          <PhoneTabs skin={skin} labels={PHONE_TABS.map((t, i) => (i === 2 && kept.length ? `Kept (${kept.length})` : t))} active={tab} onChange={setTab} y={tabsY} x={16} width={W - 20} clickSounds={['powerselect2']} />
          {/* each tab scrolls for itself: one's place is not the next one's */}
          <div key={tab} className="abs scroll-y" style={{ left: 16, top, width: W - 32, height: listH }}>
            {tab === 0 ? (
              <SearchForm skin={skin} sections={sections} groups={groups} phone />
            ) : tab === 1 ? (
              <ResultList gd={gd} phone hasSlots={hasSlots} />
            ) : tab === LIST_TAB ? (
              <PhoneShopping gd={gd} skin={skin} width={W - 32} />
            ) : (
              <Detail gd={gd} build={build} rules={rules} phone summary />
            )}
          </div>
          {tab === 1 ? (
            <>
              <MenuFrame x={10} y={top + listH + 8} w={W - 20} h={room - listH - 8} skin={skin} />
              <div className="abs scroll-y" style={{ left: 22, top: top + listH + 18, width: W - 44, height: room - listH - 28 }}>
                <Detail gd={gd} build={build} rules={rules} phone summary={false} />
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
                <KeepSelectedButton width={btnW * 2} />
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
          {/* the overview's own long-press tooltip is under this pane */}
          <PhoneTipLayer gd={gd} skin={skin} at={gd.archetype(build.at)} level={rules.lastLevel()} rules={rules} />
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
          <DesktopShopping gd={gd} skin={skin} sets={sets} needs={needs} y={paneY} h={paneH} />
          <div className="abs" style={{ left: sets.x, top: btnY, width: sets.w, display: 'flex', justifyContent: 'flex-start' }}>
            <button ref={backButton} data-testid="shop:back" className="info-button" style={{ position: 'static', width: 240 }} onClick={() => showShopping(false)}>
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
        <div ref={listPane} className="abs scroll-y" style={{ left: list.x + 14, top: paneY + 12, width: list.w - 28, height: paneH - 24 }}>
          <ResultList gd={gd} phone={false} hasSlots={hasSlots} />
        </div>
        <MenuFrame x={det.x} y={paneY} w={det.w} h={paneH} skin={skin} />
        <div className="abs scroll-y" style={{ left: det.x + 18, top: paneY + 14, width: det.w - 36, height: paneH - 28 }}>
          <Detail gd={gd} build={build} rules={rules} phone={false} summary={false} />
        </div>
        <div className="abs" style={{ left: form.x, top: btnY, width: form.w, display: 'flex', justifyContent: 'center' }}>
          <SearchButton width={220} onSearch={runSearch} />
        </div>
        <div className="abs" style={{ left: list.x, top: btnY, width: det.x + det.w - list.x, display: 'flex', justifyContent: 'flex-end', gap: 14 }}>
          <button ref={shoppingButton} data-testid="finder:shopping" className="info-button" title="What the kept and applied swaps need: recipes, salvage and enhancements" style={{ position: 'static', width: 190 }} onClick={() => showShopping(true)}>
            Shopping List
          </button>
          {applyButtons(210)}
          {closeButton(120)}
        </div>
      </div>
    </div>
  );
}
