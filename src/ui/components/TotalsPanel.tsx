import { useState } from 'react';
import type { GameData } from '../../data/gamedata.ts';
import type { StatLine, Totals } from '../../engine/totals.ts';
import { TitleText } from './GameText.tsx';

const pct = (v: number) => `${(v * 100).toFixed(2)}%`;
const DEF_ORDER = [3, 4, 5, 6, 7, 8, 9, 10, 1, 0, 2]; // Smash, Lethal, Fire, Cold, Energy, Neg, Psi, Toxic, Melee, Ranged, AoE
const RES_ORDER = [0, 1, 2, 3, 4, 5, 6, 9]; // Smash, Lethal, Fire, Cold, Energy, Neg, Psi, Toxic

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

interface RowProps {
  label: string;
  value: string; // collapsed value
  openValue?: string; // header value while expanded (default: value)
  tone?: number; // signed distance from the neutral value; undefined = never colored
  over?: string; // the uncapped value when it is past the cap: shown as "cap (actual)"
  line?: StatLine;
  cap?: boolean;
}

/** A clickable totals row that expands to list every source (the detailed breakdown). */
function Row({ label, value, openValue, tone, over, line, cap }: RowProps) {
  const [open, setOpen] = useState(false);
  const has = !!line && line.sources.length > 0;
  const plain = cap ? CAPPED : PLAIN;
  return (
    <div>
      <div
        onClick={() => has && setOpen(!open)}
        style={{ display: 'flex', justifyContent: 'space-between', cursor: has ? 'pointer' : 'default', color: plain, padding: '1px 0' }}
        title={has ? 'Click to see where this comes from' : undefined}
      >
        <span>
          {has ? (open ? '- ' : '+ ') : '  '}
          {label}
        </span>
        <span style={{ color: toneColor(tone, plain) }}>
          {open ? (openValue ?? value) : value}
          {over ? <span style={{ color: darken(toneColor(tone, plain)) }}> ({over})</span> : null}
        </span>
      </div>
      {open && line ? (
        <div style={{ paddingLeft: 18, fontSize: 15, color: SOURCE }}>
          {line.sources.map((s, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>{s.name}</span>
              <span style={{ color: tone === undefined ? SOURCE : toneColor(s.value, SOURCE) }}>{Math.abs(s.value) >= 5 ? s.value.toFixed(1) : pct(s.value)}</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Compact totals (defense, resistance, recharge, damage, accuracy, to-hit, HP, regen, recovery,
 * endurance) with every line expandable into its sources. A value above its stat's neutral value
 * (0, the archetype's base HP, 100% regeneration / recovery / run speed) is green, below it red;
 * positive numbers carry no sign. A value past its archetype cap reads "cap (actual)", the actual
 * in a 20% darker shade. Provisional styling until the in-game Combat Attributes
 * reference is available.
 */
export function TotalsPanel({ gd, t, width }: { gd: GameData; t: Totals; width: number }) {
  const L = (k: string) => t.lines.get(k);
  const v = (k: string) => L(k)?.capped ?? 0;
  const capped = (k: string) => {
    const l = L(k);
    return !!l && l.cap !== undefined && l.value > l.cap;
  };
  /** @return The uncapped percentage of a line past its cap, else undefined. */
  const overPct = (k: string, add = 0) => (capped(k) ? pct(add + L(k)!.value) : undefined);
  const dn = gd.core.attribNames;
  const head = (s: string) => (
    <TitleText style={{ fontSize: 20, marginTop: 8 }}>
      {s}
    </TitleText>
  );
  const hp = t.hpMax.toFixed(1);
  const regen = `${t.regenPerSec.toFixed(2)}/s`;
  const recov = `${t.recovPerSec.toFixed(2)}/s`;
  const past = (raw: number, shown: number, text: string) => (raw > shown + 1e-6 ? text : undefined);
  const hpOver = past(t.hpRaw, t.hpMax, t.hpRaw.toFixed(1));
  const regenOver = past(t.regenPerSecRaw, t.regenPerSec, `${t.regenPerSecRaw.toFixed(2)}/s`);
  const recovOver = past(t.recovPerSecRaw, t.recovPerSec, `${t.recovPerSecRaw.toFixed(2)}/s`);
  return (
    <div className="body-text" style={{ width, fontSize: 16, lineHeight: 1.3 }}>
      {head('Defense')}
      {DEF_ORDER.map((i) => {
        const k = `def.${String(i).padStart(2, '0')}`;
        return <Row key={k} label={nice(dn.Defense[i]?.dn ?? '')} value={pct(v(k))} tone={v(k)} over={overPct(k)} line={L(k)} cap={capped(k)} />;
      })}
      {head('Resistance')}
      {RES_ORDER.map((i) => {
        const k = `res.${String(i).padStart(2, '0')}`;
        return <Row key={k} label={nice(dn.Damage[i]?.dn ?? '')} value={pct(v(k))} tone={v(k)} over={overPct(k)} line={L(k)} cap={capped(k)} />;
      })}
      {head('Misc')}
      <Row label="Recharge" value={pct(v('rech'))} tone={v('rech')} over={overPct('rech')} line={L('rech')} cap={capped('rech')} />
      <Row label="Damage" value={pct(v('dmg.00'))} tone={v('dmg.00')} over={overPct('dmg.00')} line={L('dmg.00')} cap={capped('dmg.00')} />
      <Row label="Accuracy" value={pct(v('acc'))} tone={v('acc')} line={L('acc')} />
      <Row label="ToHit" value={pct(v('tohit'))} tone={v('tohit')} line={L('tohit')} />
      <Row label="Max HP" value={hp} openValue={`${hp} (${pct(t.hpMax / t.hpBase)})`} tone={t.hpMax - t.hpBase} over={hpOver} line={L('hp')} cap={!!hpOver} />
      <Row label="Regeneration" value={regen} openValue={`${regen} (${pct(1 + v('regen'))})`} tone={v('regen')} over={regenOver} line={L('regen')} cap={!!regenOver} />
      <Row label="Recovery" value={recov} openValue={`${recov} (${pct(1 + v('recov'))})`} tone={v('recov')} over={recovOver} line={L('recov')} cap={!!recovOver} />
      <Row label="End use" value={`${t.endUsePerSec.toFixed(2)}/s`} />
      <Row label="Max End" value={t.endMax.toFixed(1)} tone={v('endmax')} line={L('endmax')} />
      <Row label="Run speed" value={pct(1 + v('run'))} tone={v('run')} line={L('run')} />
      <Row label="Set bonuses" value={`${t.bonuses.filter((b) => !b.suppressed).length} (${t.bonuses.filter((b) => b.suppressed).length} over 5)`} />
    </div>
  );
}
