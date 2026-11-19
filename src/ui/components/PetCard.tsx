import { Fragment, useEffect, useMemo, useRef, useSyncExternalStore, type ReactNode } from 'react';
import { create } from 'zustand';
import type { GameData } from '../../data/gamedata.ts';
import type { Archetype, Power } from '../../data/types.ts';
import type { Build } from '../../engine/build.ts';
import { makesPets, petEntries, type PetAttack, type PetCard, type PetEntry, type PetSource } from '../../engine/petcards.ts';
import { buffsPets, petPowerOn } from '../../engine/petstats.ts';
import { INFO_LABEL_COLOR, powerInfo, prettyDuration, type BaseAndEnhanced } from '../../engine/powerinfo.ts';
import type { BuildRules } from '../../engine/rules.ts';
import { useTipLevel } from '../../state/store.ts';
import { useEscape } from '../escape.ts';
import { POPUP_LAYER } from '../floating.ts';
import { useHover } from '../hover.ts';
import { longPress, pressKeys } from '../press.ts';
import type { Skin } from '../skin/skin.ts';
import { smf } from '../smf.tsx';
import { OnSwitch } from './CheckBar.tsx';
import { MenuFrame } from './Chrome.tsx';
import { GameScroll } from './GameScroll.tsx';
import { TitleText } from './GameText.tsx';
import { InfoBlocks, Segs, useInfoFiles } from './PowerInfoView.tsx';
import { Floating, TIP, TIP_PX } from './PowerTip.tsx';
import { useStage } from './Stage.tsx';
import { TotalsPanel, type SectionMemory } from './TotalsPanel.tsx';

const NONE: readonly PetEntry[] = [];
const noSubscribe = () => () => undefined;
const DAMAGE = '#ff4b4b'; // the power info's damage color (power_AddBaseStats)
const NOTE = '#aaaa88'; // its note color
const W = 760; // a pet power's tooltip width (the Advanced tooltip's)
const MARK_W = 20; // the totals rows' +/- column (TotalsPanel), so a pet's name lines up with theirs
const SWITCH = 18; // a pet power's switch, the size of the text beside it
// the pet pane's sections, remembered apart from the build's totals: Powers and Base start open
const PANE_SECTIONS: SectionMemory = { key: 'hcp.petpane.sections', dflt: { powers: true, base: true } };

/**
 * The Pets and Minions rows of a build at a level (petEntries; each card is worked out when first
 * shown), once the version's real pets file is there. The file is asked for only when one of the
 * build's powers may make a real pet (makesPets, decided once the pets file's fetch has ended), and
 * the rows show when it arrives.
 *
 * @param gd Game data.
 * @param rules Rules view of the build (none: no rows).
 * @param build The build.
 * @param level 0-based level (the totals' level).
 * @return The rows (none while the file is missing or the build makes no pet).
 */
export function usePetCards(gd: GameData | null | undefined, rules: BuildRules | null, build: Build | null | undefined, level: number): readonly PetEntry[] {
  const file = useSyncExternalStore(gd?.subscribeHenchmen ?? noSubscribe, () => gd?.henchmen ?? null);
  const petsReady = useSyncExternalStore(gd?.subscribePets ?? noSubscribe, () => !!gd?.petsSettled);
  const wants = useMemo(() => petsReady && !!gd && !!rules && makesPets(gd, rules.entries()), [gd, rules, petsReady]);
  // asked again as the build changes: a fetch the network failed is retried then (a no-op otherwise)
  useEffect(() => {
    if (gd && wants) gd.requestHenchmen();
  }, [gd, wants, rules]);
  // a build that makes no pet has no rows, even with the file there from an earlier build
  return useMemo(() => (file && wants && gd && rules && build ? petEntries(gd, rules, build, level) : NONE), [file, wants, gd, rules, build, level]);
}

/** Which pet's pane is open: its row's key (PetEntry.key), or null. */
export const usePetPane = create<{ key: string | null }>(() => ({ key: null }));

/** Close the pet pane. */
const closePane = () => usePetPane.setState({ key: null });

// how many PetPaneLayers are drawn: the pane closes once none is
let paneHosts = 0;

// the pet pane on the desktop stage: the enhancement picker's top and height (its frame), at a width
// that fits the attacks' five columns; no client screen has such a pane
const PANE = { x: 520, y: 90, w: 960, h: 940 };

const f2 = (n: number) => n.toFixed(2);

/** @return "enhanced (base)" when they differ, else the one value, as the power info writes them. */
function pair(v: BaseAndEnhanced, fmt: (n: number) => string): string {
  return Math.abs(v.enh - v.base) > 1e-9 ? `${fmt(v.enh)} (${fmt(v.base)})` : fmt(v.base);
}

/** @return How many a row's pets are: the sure ones, and how many more may come ("x6 (+7)", "up to 2"). */
export function petCount(sources: readonly PetSource[]): string {
  const sure = sources.reduce((t, s) => t + s.count, 0);
  const extra = sources.reduce((t, s) => t + s.extra, 0);
  if (!sure) return `up to ${extra}`;
  return `x${sure}${extra ? ` (+${extra})` : ''}`;
}

/** @return A source's line: the power, whom it is used on, how many, over and for how long. */
function sourceText(s: PetSource): string {
  const n = s.count ? `${s.count}${s.extra ? ` (up to ${s.extra} more)` : ''}` : `up to ${s.extra}`;
  return `${s.from}${s.on ? ` on a ${s.on}` : ''}: ${n}${s.over ? ` over ${prettyDuration(s.over)}` : ''}${s.dur ? `, for ${prettyDuration(s.dur)}` : ''}`;
}

/**
 * A pet's row in the totals' Pets and Minions section: its name and how many the build makes. A
 * click (a tap on a phone) opens its pane (PetPaneLayer).
 *
 * @param props.entry The pet's row (its card is worked out when its pane opens).
 */
export function PetRow({ entry }: { entry: PetEntry }) {
  const open = () => usePetPane.setState({ key: entry.key });
  return (
    <div
      data-testid={`pet:${entry.key}`}
      onClick={open}
      {...pressKeys(open, undefined, `${entry.name} ${petCount(entry.sources)}`)}
      style={{ display: 'flex', justifyContent: 'space-between', padding: '1px 0', cursor: 'pointer' }}
    >
      <span style={{ paddingLeft: MARK_W }}>{entry.name}</span>
      <span>{petCount(entry.sources)}</span>
    </div>
  );
}

/**
 * The pet pane of the pet whose row was clicked (usePetPane): its stats read like the build's
 * totals, only the stats that aren't zero, under a Powers section with its attacks and other powers.
 * It closes on Escape, a click (a tap) outside it, or when the build no longer makes the pet; it goes
 * with the screen. It holds the keyboard focus while open.
 *
 * @param props.entries The build's Pets and Minions rows (usePetCards).
 * @param props.build The build (its archetype and pet switches).
 * @param props.onSwitch Switch a pet power's share of the stats (none: the pane shows no switches).
 */
export function PetPaneLayer({ gd, skin, entries, build, onSwitch }: { gd: GameData; skin: Skin; entries: readonly PetEntry[]; build: Build | null | undefined; onSwitch?: (p: Power, on: boolean) => void }) {
  const key = usePetPane((s) => s.key);
  const entry = key ? entries.find((e) => e.key === key) : undefined;
  // the pane goes with the screen that drew it, and with a pet the build no longer makes; a layout
  // flip (phone and desktop) swaps one layer for another in one commit, which keeps it open
  useEffect(() => {
    paneHosts++;
    return () => {
      paneHosts--;
      setTimeout(() => paneHosts || closePane(), 0);
    };
  }, []);
  useEffect(() => {
    if (key && !entry) closePane();
  }, [key, entry]);
  if (!entry || !build) return null;
  return <PetPane gd={gd} skin={skin} entry={entry} build={build} onSwitch={onSwitch} />;
}

function PetPane({ gd, skin, entry, build, onSwitch }: { gd: GameData; skin: Skin; entry: PetEntry; build: Build; onSwitch?: (p: Power, on: boolean) => void }) {
  const stage = useStage();
  useEscape(closePane);
  // the hovered power's card goes with the pane
  useEffect(() => () => useHover.setState({ petPower: null }), []);
  const card = entry.card();
  const at = gd.archetype(build.at);
  const phone = stage.phone;
  // a phone keeps a strip above and below the pane, where a tap closes it
  const box = phone ? { x: 8, y: 64, w: stage.w - 16, h: stage.h - 150 } : PANE;
  const head = phone ? 30 : 34; // title size
  const sub = 16 + 20 * (card.sources.length + 1); // the count, level and sources
  const top = 18 + head + 8 + sub;
  const zoom = phone ? 1.05 : 1.15;
  const inner = { left: 24, top, width: box.w - 56, height: box.h - top - 20 };
  // focus moves into the pane while it is open (Tab stays inside it) and back where it was after
  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.current?.focus({ preventScroll: true });
    return () => before?.focus({ preventScroll: true });
  }, []);
  return (
    <>
      {/* a click outside closes it; under the tooltips (65) and the phone's long-press card (66) */}
      <div {...POPUP_LAYER} className="abs" onClick={closePane} style={{ left: 0, top: 0, width: stage.w, height: stage.h, zIndex: 61, background: 'rgba(0,0,0,0.55)' }} />
      <div
        ref={dialog}
        className="abs"
        role="dialog"
        aria-modal="true"
        aria-label={card.name}
        tabIndex={-1}
        onKeyDown={(e) => keepFocusIn(e, dialog.current)}
        data-testid="pet-pane"
        style={{ left: box.x, top: box.y, width: box.w, height: box.h, zIndex: 62, outline: 'none' }}
      >
        <MenuFrame x={0} y={0} w={box.w} h={box.h} skin={skin} style={{ background: 'rgba(0,3,20,0.96)' }} />
        <div className="abs body-text" style={{ left: 24, top: 18, width: box.w - 48 }}>
          <TitleText style={{ fontSize: head }}>{card.name}</TitleText>
          <div style={{ color: TIP.list, fontSize: 16, marginTop: 8, lineHeight: '20px' }}>
            <div>{`${petCount(card.sources)}, level ${card.level + 1}`}</div>
            {card.sources.map((s, i) => (
              <div key={i}>{sourceText(s)}</div>
            ))}
          </div>
        </div>
        <GameScroll skin={skin} left={inner.left} top={inner.top} width={inner.width} height={inner.height} barX={box.w - 8}>
          <div style={{ zoom }}>
            <TotalsPanel
              gd={gd}
              t={card.stats}
              width={(inner.width - 12) / zoom}
              nonZero
              memory={PANE_SECTIONS}
              lead={{ id: 'powers', title: 'Powers', body: () => <PetPowers gd={gd} skin={skin} card={card} build={build} onSwitch={onSwitch} /> }}
            />
          </div>
        </GameScroll>
      </div>
      <PetPowerTipLayer gd={gd} at={at} />
    </>
  );
}

/**
 * Keep Tab and Shift+Tab inside a dialog: from its last focusable part back to its first, and the
 * other way round.
 *
 * @param e The key press.
 * @param box The dialog.
 */
function keepFocusIn(e: React.KeyboardEvent, box: HTMLElement | null): void {
  if (e.key !== 'Tab' || !box) return;
  const parts = [...box.querySelectorAll<HTMLElement>('[tabindex="0"], button, input, select, a[href]')];
  if (!parts.length) {
    e.preventDefault();
    return;
  }
  const first = parts[0]!;
  const last = parts[parts.length - 1]!;
  const at = document.activeElement;
  if (e.shiftKey && (at === first || at === box)) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && at === last) {
    e.preventDefault();
    first.focus();
  }
}

/** A heading inside the Powers section. */
const SubHead = ({ text }: { text: string }) => <div style={{ color: TIP.name, marginTop: 6 }}>{text}</div>;

/**
 * A pet power's name: the pointer over it shows the power's card (PetPowerTipLayer), and so does
 * keyboard focus on it; a long press on a phone does (PhoneTipLayer).
 */
function PowerName({ card, power, children }: { card: PetCard; power: Power; children: ReactNode }) {
  const stage = useStage();
  /** Show the card at a window point (the pointer, or the name's own corner for keyboard focus). */
  const showAt = (cx: number, cy: number, at: DOMRect) => {
    const wrap = document.querySelector('.stage')?.parentElement;
    const r = wrap?.getBoundingClientRect();
    const x = r && r.width ? ((cx - r.left) / r.width) * stage.w : 0;
    const y = r && r.height ? ((cy - r.top) / r.height) * stage.h : 0;
    useHover.setState({ petPower: { card, power, x, y, at } });
  };
  const show = (e: React.MouseEvent<HTMLElement>) => showAt(e.clientX, e.clientY, e.currentTarget.getBoundingClientRect());
  const focus = (e: React.FocusEvent<HTMLElement>) => {
    const at = e.currentTarget.getBoundingClientRect();
    showAt(at.left, at.bottom, at);
  };
  const hide = () => useHover.setState((h) => (h.petPower?.power === power ? { petPower: null } : h));
  // a name that goes (the section closed, the build changed) takes its card with it
  useEffect(() => () => useHover.setState((h) => (h.petPower?.power === power ? { petPower: null } : h)), [power]);
  return (
    <span
      data-testid={`petpower:${power.n}`}
      tabIndex={stage.phone ? undefined : 0}
      onMouseEnter={stage.phone ? undefined : show}
      onMouseLeave={stage.phone ? undefined : hide}
      onFocus={stage.phone ? undefined : focus}
      onBlur={stage.phone ? undefined : hide}
      {...longPress(stage.phone ? (pt) => useHover.setState({ press: { kind: 'petPower', card, power, ...pt } }) : undefined)}
      style={{ cursor: 'default' }}
    >
      {children}
    </span>
  );
}

/**
 * A pet power's switch: whether it counts in the pets' stats (petPowerOn), drawn like the
 * overview's. Only a power that can move a stat (buffsPets) has one.
 */
function PetSwitch({ gd, skin, power, build, onSwitch }: { gd: GameData; skin: Skin; power: Power; build: Build; onSwitch?: (p: Power, on: boolean) => void }) {
  if (!onSwitch || !buffsPets(gd, power)) return <span style={{ display: 'inline-block', width: SWITCH + 8 }} />;
  const on = petPowerOn(gd, build, power);
  const flip = () => onSwitch(power, !on);
  return (
    <span
      data-testid={`petswitch:${power.n}`}
      title={on ? "Counted in the pets' stats (click to leave it out)" : "Not counted in the pets' stats (click to count it)"}
      onClick={flip}
      {...pressKeys(flip, undefined, on ? "Counted in the pets' stats" : "Not counted in the pets' stats")}
      aria-pressed={on}
      style={{ position: 'relative', display: 'inline-block', width: SWITCH, height: SWITCH, marginRight: 8, verticalAlign: -SWITCH / 4, borderRadius: SWITCH / 2, cursor: 'pointer' }}
    >
      <OnSwitch skin={skin} on={on} size={SWITCH} />
    </span>
  );
}

/** One attack's row: name (its damage types under it), damage, cast, recharge and damage per activation. */
function AttackRow({ gd, skin, card, a, build, onSwitch }: { gd: GameData; skin: Skin; card: PetCard; a: PetAttack; build: Build; onSwitch?: (p: Power, on: boolean) => void }) {
  const click = a.type === 'Click';
  return (
    <>
      <div>
        <PetSwitch gd={gd} skin={skin} power={a.power} build={build} onSwitch={onSwitch} />
        <PowerName card={card} power={a.power}>
          {a.users ? `${a.name} (${a.users} of them)` : a.name}
        </PowerName>
        {a.types.length ? <div style={{ color: INFO_LABEL_COLOR, fontSize: '0.85em', paddingLeft: SWITCH + 8 }}>{a.types.join(', ')}</div> : null}
        {a.when ? <div style={{ color: NOTE, fontStyle: 'italic', paddingLeft: SWITCH + 8 }}>{a.when}</div> : null}
      </div>
      <div style={{ color: DAMAGE, textAlign: 'right' }}>{pair(a.damage, f2)}</div>
      <div style={{ textAlign: 'right' }}>{click ? prettyDuration(a.cast) : ''}</div>
      <div style={{ textAlign: 'right' }}>{click ? pair(a.recharge, prettyDuration) : ''}</div>
      <div style={{ color: DAMAGE, textAlign: 'right' }}>{click && a.cast > 0 ? pair(a.dpa, f2) : ''}</div>
    </>
  );
}

/**
 * The pet pane's Powers section: its attacks (damage per activation, enhanced by the summon's
 * slotting with the base in parentheses, and the damage types) and what its other powers do, each
 * name showing the power's card on hover, and a switch on each power that can move a stat.
 */
function PetPowers({ gd, skin, card, build, onSwitch }: { gd: GameData; skin: Skin; card: PetCard; build: Build; onSwitch?: (p: Power, on: boolean) => void }) {
  const stage = useStage();
  return (
    <div style={{ paddingLeft: MARK_W, fontSize: stage.phone ? 14 : 16 }}>
      {card.attacks.length ? (
        <>
          <SubHead text="Attacks" />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto auto auto auto', columnGap: stage.phone ? 8 : 14 }}>
            {/* the power info's own rows, shortened: Average Damage, Activation Time, Recharge Time, Damage Per Activation Time */}
            {['', 'Damage', 'Activation', 'Recharge', 'Per Act. Time'].map((h, i) => (
              <div key={i} style={{ color: INFO_LABEL_COLOR, textAlign: i ? 'right' : 'left' }}>
                {h}
              </div>
            ))}
            {card.attacks.map((a, i) => (
              <AttackRow key={i} gd={gd} skin={skin} card={card} a={a} build={build} onSwitch={onSwitch} />
            ))}
          </div>
        </>
      ) : null}
      {card.powers.length ? (
        <>
          <SubHead text="Other Powers" />
          {card.powers.map((p, i) => (
            <div key={i} style={{ marginTop: i ? 6 : 0 }}>
              <div>
                <PetSwitch gd={gd} skin={skin} power={p.power} build={build} onSwitch={onSwitch} />
                <PowerName card={card} power={p.power}>
                  <span style={{ color: INFO_LABEL_COLOR }}>{p.name}</span>
                </PowerName>
              </div>
              <div style={{ paddingLeft: SWITCH + 8 }}>
                {p.when ? <div style={{ color: NOTE, fontStyle: 'italic' }}>{p.when}</div> : null}
                {p.lines.map((l, j) => (
                  <Fragment key={j}>
                    <div>
                      <Segs segs={l.line} />
                    </div>
                    {l.notes.map((n, k) => (
                      <div key={k} style={{ fontStyle: 'italic', color: NOTE }}>
                        <Segs segs={n} />
                      </div>
                    ))}
                  </Fragment>
                ))}
              </div>
            </div>
          ))}
        </>
      ) : null}
    </div>
  );
}

/**
 * A pet power's card: its name, short help when it has one, and its detailed info run as the pet
 * (its class, its level, its summon's slotting), as a power's Advanced tooltip shows it.
 *
 * @param props.at The creator's archetype.
 * @param props.card The pet's card (what the power runs as).
 * @param props.power The power.
 */
export function PetPowerDetails({ gd, at, card, power }: { gd: GameData; at: Archetype; card: PetCard; power: Power }) {
  const files = useInfoFiles(gd);
  const info = useMemo(() => {
    void files; // read through gd: worked out again when the pets or info file arrives
    return powerInfo(gd, at, power, card.level, card.strength, card.run);
  }, [gd, at, power, card, files]);
  return (
    <>
      <div style={{ color: TIP.name, fontWeight: 700, fontSize: '1.1em' }}>{power.dn}</div>
      {power.sh ? <div style={{ color: TIP.text }}>{smf(power.sh)}</div> : null}
      <div style={{ borderTop: '1px solid #6d7fd8', margin: `${TIP_PX * 0.8}px 0` }} />
      <InfoBlocks info={info} />
    </>
  );
}

/**
 * The desktop's card of the pet power under the pointer in the pet pane (useHover.petPower), drawn
 * like the Advanced tooltip. It takes every wheel turn while it shows (Floating's lock), so the
 * pane under it never scrolls away from the pointer. Phones show it on a long press instead.
 */
function PetPowerTipLayer({ gd, at }: { gd: GameData; at: Archetype }) {
  const tip = useHover((h) => h.petPower);
  const tipLevel = useTipLevel();
  const stage = useStage();
  if (!tip || tipLevel === 'off' || stage.phone) return null;
  return (
    <Floating
      key={`${tip.card.key}:${tip.power.n}`}
      lock
      x={tip.x}
      y={tip.y}
      w={W}
      gap={34}
      left={30}
      avoid={tip.at}
      render={(b, ref) => (
        <div
          ref={ref}
          className="abs scroll-y"
          role="tooltip"
          style={{ left: b.x, top: b.y, width: W + b.bar, maxHeight: b.maxH, boxSizing: 'border-box', padding: `${TIP_PX * 0.6}px ${TIP_PX * 0.8 + b.gutter}px ${TIP_PX * 0.6}px ${TIP_PX * 0.8}px`, background: 'rgba(0,2,24,0.97)', border: '2px solid #3a55d6', borderRadius: TIP_PX * 0.6, fontFamily: "'Montreal'", fontSize: TIP_PX, lineHeight: 1.3, color: TIP.text }}
        >
          <PetPowerDetails gd={gd} at={at} card={tip.card} power={tip.power} />
        </div>
      )}
    />
  );
}
