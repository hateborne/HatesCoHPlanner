import { memo, useState, type ReactElement, type ReactNode } from 'react';
import type { GameData } from '../../data/gamedata.ts';
import type { PetEntry } from '../../engine/petcards.ts';
import { MEZ, type ChanceSource, type SetBonusStat, type StatLine, type Totals } from '../../engine/totals.ts';
import { TitleText } from './GameText.tsx';
import { PetRow } from './PetCard.tsx';

const pct = (v: number) => `${(v * 100).toFixed(2)}%`;
const DEF_ORDER = [3, 4, 5, 6, 7, 8, 9, 10, 1, 0, 2]; // Smash, Lethal, Fire, Cold, Energy, Neg, Psi, Toxic, Melee, Ranged, AoE
const RES_ORDER = [0, 1, 2, 3, 4, 5, 6, 9]; // Smash, Lethal, Fire, Cold, Energy, Neg, Psi, Toxic
export const MPH = 21 * 0.681818; // a speed of 1.0 (21 ft/s) in mph

// bonus / penalty colors: more of every colored stat helps, so above its neutral value is good
const GOOD = '#5cff5c';
const BAD = '#ff5a5a';
const PLAIN = '#cfe8ff';
const CAPPED = '#ffd24a';
const SOURCE = '#8fb8e8';
const EPS = 1e-6;

/** @return A #rrggbb color darkened to `k` of its brightness. */
function darken(hex: string, k = 0.8): string {
  const n = parseInt(hex.slice(1), 16);
  const c = (sh: number) => Math.round(((n >> sh) & 255) * k).toString(16).padStart(2, '0');
  return `#${c(16)}${c(8)}${c(0)}`;
}

/** @return Green above the neutral value, red below, `plain` at it or when there is no tone. */
function toneColor(tone: number | undefined, plain: string): string {
  if (tone === undefined || Math.abs(tone) < EPS) return plain;
  return tone > 0 ? GOOD : BAD;
}

function nice(s: string): string {
  return s.replace(/_/g, ' ');
}

/** Source values: absolute numbers (HP) as such, fractions as percentages. */
const srcDefault = (v: number) => (Math.abs(v) >= 5 ? v.toFixed(1) : pct(v));

/** A number with at most two decimals and no trailing zeros: 100, 10.25, 0.5. */
const trim = (x: number) => String(Number(x.toFixed(2)));

/**
 * A chance source's roll, what it gives and for how long: "20% chance for 100% for 10.25s".
 *
 * @param c The chance source.
 * @param percent The line is a percentage (resistance); else a magnitude (protection).
 * @return The text after the source's name.
 */
function chanceText(c: ChanceSource, percent: boolean): string {
  const amount = percent ? `${trim(c.value * 100)}%` : trim(c.value);
  return `${trim(c.chance * 100)}% chance for ${amount}${c.duration ? ` for ${trim(c.duration)}s` : ''}`;
}
const MARK_W = 20; // the +/- column (a little wider than the + so it never touches the label)

interface RowProps {
  label: string;
  value: ReactNode; // collapsed value (the set finder marks a figure at its cap inside it)
  openValue?: ReactNode; // header value while expanded (default: value)
  tone?: number; // signed distance from the neutral value; undefined = never colored
  over?: string; // the uncapped value when it is past the cap: shown as "cap (actual)"
  line?: StatLine;
  fmt?: (v: number) => string; // source value format (default srcDefault)
  detail?: ReactNode; // expanded content in place of the source list
  cap?: boolean;
  noMark?: boolean; // no +/- column: a list where nothing expands (the enhancement picker)
  wrapRight?: boolean; // a value too long for its line wraps against the right edge (the set finder's "cap (actual)" figures)
}

/**
 * A clickable totals row that expands to list every source (the detailed breakdown). Also used
 * plain (no sources) wherever a stat should read like the totals pane: label left, value right.
 */
export function TotalsRow(props: RowProps) {
  return <Row {...props} />;
}

function Row({ label, value, openValue, tone, over, line, fmt = srcDefault, detail, cap, noMark, wrapRight }: RowProps) {
  const [open, setOpen] = useState(false);
  const chances = line?.chances ?? [];
  const has = !!detail || (!!line && (line.sources.length > 0 || chances.length > 0));
  const plain = cap ? CAPPED : PLAIN;
  return (
    <div>
      <div
        onClick={() => has && setOpen(!open)}
        style={{ display: 'flex', justifyContent: 'space-between', cursor: has ? 'pointer' : 'default', color: plain, padding: '1px 0' }}
        title={has ? 'Click to see where this comes from' : undefined}
      >
        {/* the marker sits in its own fixed column so every label starts at the same x */}
        <span style={{ display: 'flex' }}>
          {noMark ? null : <span style={{ width: MARK_W, flex: 'none', textAlign: 'center' }}>{has ? (open ? '-' : '+') : ''}</span>}
          <span>{label}</span>
        </span>
        <span style={{ color: toneColor(tone, plain), textAlign: wrapRight ? 'right' : undefined }}>
          {open ? (openValue ?? value) : value}
          {/* chance sources aren't in the value: they're listed under Chance */}
          {chances.length ? ' (*)' : null}
          {over ? <span style={{ color: darken(toneColor(tone, plain)) }}> ({over})</span> : null}
        </span>
      </div>
      {open && detail ? <div style={{ paddingLeft: MARK_W + 10, fontSize: 15, color: SOURCE }}>{detail}</div> : null}
      {open && !detail && line ? (
        <div style={{ paddingLeft: MARK_W + 10, fontSize: 15, color: SOURCE }}>
          {line.sources.map((s, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>{s.name}</span>
              <span style={{ color: tone === undefined ? SOURCE : toneColor(s.value, SOURCE) }}>{fmt(s.value)}</span>
            </div>
          ))}
          {/* always last, whatever the alphabet says: the sources that only sometimes apply */}
          {chances.length ? (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>Chance</span>
                <span>*</span>
              </div>
              {chances.map((c, i) => (
                <div key={`c${i}`} style={{ paddingLeft: MARK_W }}>
                  {`${c.name} - ${chanceText(c, !line.key.startsWith('mezprot.'))}`}
                </div>
              ))}
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

// section open / closed state, remembered per browser; Base starts open, the rest closed
const OPEN_KEY = 'hcp.totals.sections';
const OPEN_DEFAULT: Record<string, boolean> = { base: true };

/**
 * Read a panel's remembered section state.
 *
 * @param key Its localStorage key.
 * @param dflt The state when none is remembered (or the remembered value is damaged).
 * @return Section id -> open.
 */
function readOpen(key: string, dflt: Record<string, boolean>): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(key);
    const v: unknown = raw ? JSON.parse(raw) : null;
    // anything but a plain object (a corrupted value) falls back to the default
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, boolean>) : dflt;
  } catch {
    return dflt;
  }
}

/**
 * A section heading's +/- drawn as bars in the title colors with a 1 device px black outline,
 * centred on the title caps (0..0.8em above the baseline). Neither title font's hyphen works:
 * RedCircle's is a square block and Montreal's sits at x-height, half the plus's width. The
 * enhancement picker's collapsible groups use it too.
 *
 * @param props.open Whether the section is open (a minus) or closed (a plus).
 * @param props.size The heading's font size (px).
 */
export function HeadMark({ open, size = 20 }: { open: boolean; size?: number }) {
  const box = { position: 'absolute' as const };
  const fill = 'linear-gradient(var(--title-top), var(--title-bottom))';
  const ring = 'var(--dev-px, 1px)';
  const h = { left: '0.04em', top: '0.34em', width: '0.52em', height: '0.12em' };
  const v = { left: '0.24em', top: '0.14em', width: '0.12em', height: '0.52em' };
  const bars = open ? [h] : [h, v];
  return (
    <span style={{ display: 'inline-block', position: 'relative', width: '0.9em', height: '0.8em', fontSize: size, flex: 'none' }}>
      {/* outlines first, then fills, so the plus has no black seam where its bars cross */}
      {bars.map((b, i) => (
        <span key={`o${i}`} style={{ ...box, ...b, background: '#000', boxShadow: `0 0 0 ${ring} #000` }} />
      ))}
      {bars.map((b, i) => (
        <span key={`f${i}`} style={{ ...box, ...b, background: fill }} />
      ))}
    </span>
  );
}

/** A set bonus stat's value in its unit. */
const statText = (s: SetBonusStat) => (s.unit === '%' ? pct(s.value) : s.unit === 'ft' ? `${s.value.toFixed(1)} ft` : s.value.toFixed(2));

/** A section put ahead of the totals' own (the pet pane's Powers). */
export interface LeadSection {
  id: string;
  title: string;
  body: () => ReactNode;
}

/** How a panel remembers its sections: its storage key and the state it starts with. */
export interface SectionMemory {
  key: string;
  dflt: Record<string, boolean>;
}

/**
 * Totals in collapsible sections (Base, Movement, Damage Resistance, Defense, Debuff Resistance,
 * Status Protection, Status Resistance, Pets and Minions, Set Bonuses), every line expandable into
 * its sources. Pets and Minions lists each kind of pet the build makes; a click opens its pane
 * (PetPaneLayer). A build that makes none has no such section.
 * A value above its stat's neutral value is green, below it red; positive numbers carry no sign;
 * a value past its archetype cap reads "cap (actual)", the actual 20% darker. Set Bonuses lists
 * each set with the piece counts of every power where it earns a bonus (two or more pieces) and its
 * summed bonuses (rule-of-5 copies left out). A unique piece's global effect (Luck of the Gambler's
 * recharge) is no set bonus: it shows only in its stat's sources. A chance of a status effect
 * (Shield Wall's 20% chance of teleport resistance) adds nothing to its line's value, which reads
 * "0.00% (*)"; it is listed under "Chance", after the line's other sources. Section state is
 * remembered per browser.
 *
 * @param props.lead A section ahead of the rest (the pet pane's Powers).
 * @param props.nonZero Show only the rows whose value isn't zero, and no section left empty (a
 *   pet's stats).
 * @param props.memory Where the section state is remembered (default: the build's totals').
 */
export const TotalsPanel = memo(function TotalsPanel({
  gd,
  t,
  width,
  pets,
  lead,
  nonZero,
  memory,
}: {
  gd: GameData;
  t: Totals;
  width: number;
  pets?: readonly PetEntry[];
  lead?: LeadSection;
  nonZero?: boolean;
  memory?: SectionMemory;
}) {
  const mem = memory ?? { key: OPEN_KEY, dflt: OPEN_DEFAULT };
  const [openSec, setOpenSec] = useState(() => readOpen(mem.key, mem.dflt));
  const toggle = (id: string) => {
    const next = { ...openSec, [id]: !openSec[id] };
    setOpenSec(next);
    try {
      localStorage.setItem(mem.key, JSON.stringify(next));
    } catch {
      /* storage unavailable: the state just isn't remembered */
    }
  };
  const L = (k: string) => t.lines.get(k);
  const v = (k: string) => L(k)?.capped ?? 0;
  const capped = (k: string) => {
    const l = L(k);
    return !!l && l.cap !== undefined && l.value > l.cap;
  };
  /** @return The uncapped percentage of a line past its cap, else undefined. */
  const overPct = (k: string, add = 0) => (capped(k) ? pct(add + L(k)!.value) : undefined);
  const dn = gd.core.attribNames;
  /** @return A row, or null when it reads zero and only nonzero rows show. */
  const row = (zero: number, props: RowProps & { key?: string }): ReactElement | null => {
    if (nonZero && Math.abs(zero) < EPS) return null;
    const { key, ...rest } = props;
    return <Row key={key ?? props.label} {...rest} />;
  };
  const section = (id: string, title: string, rows: () => ReactNode) => {
    // a closed section's rows are not built; a pet's stats build them all the same, as they show
    // no section with nothing in it
    const body = openSec[id] || nonZero ? rows() : null;
    if (nonZero && Array.isArray(body) && !body.some(Boolean)) return null;
    return (
      <div key={id}>
        <div onClick={() => toggle(id)} style={{ cursor: 'pointer', display: 'flex', alignItems: 'baseline', marginTop: 8 }} title={openSec[id] ? 'Click to collapse' : 'Click to expand'}>
          <HeadMark open={!!openSec[id]} />
          <TitleText style={{ fontSize: 20 }}>{title}</TitleText>
        </div>
        {openSec[id] ? body : null}
      </div>
    );
  };

  const hp = t.hpMax.toFixed(1);
  const regen = `${t.regenPerSec.toFixed(2)}/s`;
  const recov = `${t.recovPerSec.toFixed(2)}/s`;
  const bal = t.recovPerSec - t.endUsePerSec;
  const past = (raw: number, shown: number, text: string) => (raw > shown + 1e-6 ? text : undefined);
  const hpOver = past(t.hpRaw, t.hpMax, t.hpRaw.toFixed(1));
  const regenOver = past(t.regenPerSecRaw, t.regenPerSec, `${t.regenPerSecRaw.toFixed(2)}/s`);
  const recovOver = past(t.recovPerSecRaw, t.recovPerSec, `${t.recovPerSecRaw.toFixed(2)}/s`);
  const ft = (x: number) => `${x.toFixed(1)} ft`;
  const speed = (label: string, key: string, mult: number) =>
    row(mult, { label, value: `${(mult * MPH).toFixed(2)} mph`, openValue: `${(mult * MPH).toFixed(2)} mph (${pct(mult)})`, tone: v(key), line: L(key) });
  // the strongest of several lines (defense debuff resistance is given per defense type)
  const strongest = (prefix: RegExp): StatLine | undefined => {
    let best: StatLine | undefined;
    for (const l of t.lines.values()) if (prefix.test(l.key) && (!best || l.value > best.value)) best = l;
    return best;
  };
  const resRow = (label: string, l: StatLine | undefined) => row(l?.value || (l?.chances?.length ?? 0), { label, value: pct(l?.value ?? 0), tone: l?.value ?? 0, line: l });
  const mezKeys = Object.keys(MEZ);
  const hasSets = t.setGroups.length > 0 || t.bonusesOver5 > 0;

  return (
    <div className="body-text" style={{ width, fontSize: 16, lineHeight: 1.3 }}>
      {lead ? section(lead.id, lead.title, lead.body) : null}
      {section('base', 'Base', () => [
        row(t.hpMax, { label: 'Max HP', value: hp, openValue: `${hp} (${pct(t.hpMax / t.hpBase)})`, tone: t.hpMax - t.hpBase, over: hpOver, line: L('hp'), cap: !!hpOver }),
        row(t.endMax, { label: 'Max End', value: t.endMax.toFixed(1), tone: v('endmax'), line: L('endmax') }),
        row(t.regenPerSec, { label: 'Regeneration', value: regen, openValue: `${regen} (${pct(1 + v('regen'))})`, tone: v('regen'), over: regenOver, line: L('regen'), cap: !!regenOver }),
        row(t.recovPerSec, { label: 'Recovery', value: recov, openValue: `${recov} (${pct(1 + v('recov'))})`, tone: v('recov'), over: recovOver, line: L('recov'), cap: !!recovOver }),
        // recovery minus what the running toggles drain; expands into each toggle's cost
        row(bal, {
          label: 'End Balance',
          value: `${bal.toFixed(2)}/s`,
          openValue: `${bal.toFixed(2)}/s (${t.recovPerSec.toFixed(2)} - ${t.endUsePerSec.toFixed(2)})`,
          tone: bal,
          line: L('enduse'),
          fmt: (x) => `${x.toFixed(2)}/s`,
        }),
        row(v('rech'), { label: 'Recharge', value: pct(v('rech')), tone: v('rech'), over: overPct('rech'), line: L('rech'), cap: capped('rech') }),
        row(v('dmg.00'), { label: 'Damage', value: pct(v('dmg.00')), tone: v('dmg.00'), over: overPct('dmg.00'), line: L('dmg.00'), cap: capped('dmg.00') }),
        row(v('acc'), { label: 'Accuracy', value: pct(v('acc')), tone: v('acc'), line: L('acc') }),
        row(v('tohit'), { label: 'ToHit', value: pct(v('tohit')), tone: v('tohit'), line: L('tohit') }),
        row(v('endrdx'), { label: 'End Discount', value: pct(v('endrdx')), tone: v('endrdx'), line: L('endrdx') }),
        row(v('heal'), { label: 'Healing', value: pct(v('heal')), tone: v('heal'), line: L('heal') }),
        row(v('range'), { label: 'Range', value: pct(v('range')), tone: v('range'), line: L('range') }),
        row(t.perception, { label: 'Perception', value: `${t.perception.toFixed(0)} ft`, tone: v('perc'), line: L('perc') }),
        row(v('stealth'), { label: 'Stealth (PvE)', value: `${v('stealth').toFixed(0)} ft`, tone: v('stealth'), line: L('stealth'), fmt: ft }),
      ])}
      {section('movement', 'Movement', () => [
        speed('Running Speed', 'run', t.speeds.run),
        speed('Flying Speed', 'fly', t.speeds.fly),
        speed('Jumping Speed', 'jumpspd', t.speeds.jump),
        row(t.speeds.jumpHeight, { label: 'Max Jump Height', value: `${(t.speeds.jumpHeight * 4).toFixed(2)} ft`, openValue: `${(t.speeds.jumpHeight * 4).toFixed(2)} ft (${pct(t.speeds.jumpHeight)})`, tone: v('jumph'), line: L('jumph') }),
      ])}
      {section('resistance', 'Damage Resistance', () =>
        RES_ORDER.map((i) => {
          const k = `res.${String(i).padStart(2, '0')}`;
          return row(v(k), { key: k, label: nice(dn.Damage[i]?.dn ?? ''), value: pct(v(k)), tone: v(k), over: overPct(k), line: L(k), cap: capped(k) });
        }),
      )}
      {section('defense', 'Defense', () =>
        DEF_ORDER.map((i) => {
          const k = `def.${String(i).padStart(2, '0')}`;
          return row(v(k), { key: k, label: nice(dn.Defense[i]?.dn ?? ''), value: pct(v(k)), tone: v(k), over: overPct(k), line: L(k), cap: capped(k) });
        }),
      )}
      {section('debuff', 'Debuff Resistance', () => [
        resRow('Regeneration', L('resx.Regeneration')),
        resRow('Recovery', L('resx.Recovery')),
        resRow('ToHit', L('resx.ToHit')),
        resRow('Recharge Time', L('resx.RechargeTime')),
        resRow('Defense', strongest(/^resx\.Defense(Type\d+)?$/)),
        resRow('Endurance', L('resx.Endurance')),
        resRow('Slow (Run/Fly Speed)', strongest(/^resx\.Speed(Running|Flying)$/)),
      ])}
      {section('protection', 'Status Protection', () =>
        mezKeys.map((a) => {
          const k = `mezprot.${a}`;
          // a line with only a chance source reads zero: it still shows, with its (*)
          return row(v(k) || (L(k)?.chances?.length ?? 0), { key: k, label: MEZ[a]!, value: v(k).toFixed(1), tone: v(k), line: L(k), fmt: (x) => x.toFixed(2) });
        }),
      )}
      {section('statusres', 'Status Resistance', () => mezKeys.map((a) => resRow(MEZ[a]!, L(`mezres.${a}`))))}
      {pets?.length ? section('pets', 'Pets and Minions', () => pets.map((c) => <PetRow key={c.key} entry={c} />)) : null}
      {nonZero && !hasSets
        ? null
        : section('sets', 'Set Bonuses', () => (
            <>
              {t.setGroups.length === 0 ? <Row label="No set bonuses yet" value="" /> : null}
              {t.setGroups.map((g) => (
                <Row
                  key={g.set.id}
                  label={`${g.set.dn} ${g.counts.map((c) => `(${c})`).join(' ')}`}
                  value=""
                  detail={g.stats.map((s, i) => (
                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span>{s.label}</span>
                      <span style={{ color: toneColor(s.value, SOURCE) }}>{statText(s)}</span>
                    </div>
                  ))}
                />
              ))}
              {t.bonusesOver5 > 0 ? <Row label="Over the rule of 5" value={String(t.bonusesOver5)} /> : null}
            </>
          ))}
    </div>
  );
});
