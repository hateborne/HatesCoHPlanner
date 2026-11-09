import { useState } from 'react';
import type { GameData } from '../../data/gamedata.ts';
import type { StatLine, Totals } from '../../engine/totals.ts';

const pct = (v: number) => `${(v * 100).toFixed(2)}%`;
const DEF_ORDER = [3, 4, 5, 6, 7, 8, 9, 10, 1, 0, 2]; // Smash, Lethal, Fire, Cold, Energy, Neg, Psi, Toxic, Melee, Ranged, AoE
const RES_ORDER = [0, 1, 2, 3, 4, 5, 6, 9]; // Smash, Lethal, Fire, Cold, Energy, Neg, Psi, Toxic

function nice(s: string): string {
  return s.replace(/_/g, ' ');
}

/** A clickable totals row that expands to list every source (the detailed breakdown). */
function Row({ label, value, line, cap }: { label: string; value: string; line?: StatLine; cap?: boolean }) {
  const [open, setOpen] = useState(false);
  const has = !!line && line.sources.length > 0;
  return (
    <div>
      <div
        onClick={() => has && setOpen(!open)}
        style={{ display: 'flex', justifyContent: 'space-between', cursor: has ? 'pointer' : 'default', color: cap ? '#ffd24a' : '#cfe8ff', padding: '1px 0' }}
        title={has ? 'Click to see where this comes from' : undefined}
      >
        <span>
          {has ? (open ? '- ' : '+ ') : '  '}
          {label}
        </span>
        <span>{value}</span>
      </div>
      {open && line ? (
        <div style={{ paddingLeft: 18, fontSize: 15, color: '#8fb8e8' }}>
          {line.sources.map((s, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>{s.name}</span>
              <span>{Math.abs(s.value) >= 5 ? s.value.toFixed(1) : pct(s.value)}</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Compact totals (defense, resistance, recharge, damage, accuracy, to-hit, HP, regen, recovery,
 * endurance) with every line expandable into its sources. Provisional styling until the in-game
 * Combat Attributes reference is available.
 */
export function TotalsPanel({ gd, t, width }: { gd: GameData; t: Totals; width: number }) {
  const L = (k: string) => t.lines.get(k);
  const v = (k: string) => L(k)?.capped ?? 0;
  const capped = (k: string) => {
    const l = L(k);
    return !!l && l.cap !== undefined && l.value > l.cap;
  };
  const dn = gd.core.attribNames;
  const head = (s: string) => (
    <div className="title-text" style={{ fontSize: 20, marginTop: 8 }}>
      {s}
    </div>
  );
  return (
    <div className="body-text" style={{ width, fontSize: 16, lineHeight: 1.3 }}>
      {head('Defense')}
      {DEF_ORDER.map((i) => {
        const k = `def.${String(i).padStart(2, '0')}`;
        return <Row key={k} label={nice(dn.Defense[i]?.dn ?? '')} value={pct(v(k))} line={L(k)} />;
      })}
      {head('Resistance')}
      {RES_ORDER.map((i) => {
        const k = `res.${String(i).padStart(2, '0')}`;
        return <Row key={k} label={nice(dn.Damage[i]?.dn ?? '')} value={pct(v(k))} line={L(k)} cap={capped(k)} />;
      })}
      {head('Misc')}
      <Row label="Recharge" value={`+${pct(v('rech'))}`} line={L('rech')} cap={capped('rech')} />
      <Row label="Damage" value={`+${pct(v('dmg.00'))}`} line={L('dmg.00')} cap={capped('dmg.00')} />
      <Row label="Accuracy" value={`+${pct(v('acc'))}`} line={L('acc')} />
      <Row label="ToHit" value={`+${pct(v('tohit'))}`} line={L('tohit')} />
      <Row label="Max HP" value={`${t.hpMax.toFixed(1)} (${pct(t.hpMax / t.hpBase)})`} line={L('hp')} cap={capped('hp')} />
      <Row label="Regeneration" value={`${pct(1 + v('regen'))}  ${t.regenPerSec.toFixed(2)}/s`} line={L('regen')} />
      <Row label="Recovery" value={`${pct(1 + v('recov'))}  ${t.recovPerSec.toFixed(2)}/s`} line={L('recov')} />
      <Row label="End use" value={`${t.endUsePerSec.toFixed(2)}/s`} />
      <Row label="Max End" value={t.endMax.toFixed(1)} line={L('endmax')} />
      <Row label="Run speed" value={pct(1 + v('run'))} line={L('run')} />
      <Row label="Set bonuses" value={`${t.bonuses.filter((b) => !b.suppressed).length} (${t.bonuses.filter((b) => b.suppressed).length} over 5)`} />
    </div>
  );
}
