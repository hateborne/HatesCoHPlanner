/**
 * Build totals: defense, resistance, recharge, damage, accuracy, to-hit, HP, regeneration,
 * recovery, endurance and movement, with the source of every contribution.
 *
 * Mirrors MidsReborn's totals model on top of the game's own attribute math (mod_Fill):
 * magnitude = class table[level] x scale x (1 + enhancement strength unless IgnoreStrength).
 * Active powers: autos and toggles on, clicks off, each overridable per power.
 */
import { GameData } from '../data/gamedata.ts';
import type { Archetype, Effect, Mod, Power } from '../data/types.ts';
import type { Build } from './build.ts';
import { powerStrength } from './enhance.ts';
import { evalRequires, type EvalContext } from './requires.ts';
import type { BuildEntry, BuildRules } from './rules.ts';
import { earnedBonuses, type EarnedBonus } from './setbonus.ts';

export interface Source {
  name: string; // display name of the contributing power or bonus
  value: number;
}

export interface StatLine {
  key: string; // e.g. 'def.Smashing', 'res.Fire', 'rech'
  label: string;
  value: number; // raw sum (fractions: 0.45 = 45%)
  capped: number; // after the archetype cap
  cap?: number;
  sources: Source[];
}

export interface Totals {
  level: number;
  lines: Map<string, StatLine>;
  hpMax: number;
  hpBase: number;
  regenPerSec: number;
  recovPerSec: number;
  endMax: number;
  endUsePerSec: number;
  bonuses: EarnedBonus[];
}

/**
 * A granted toggle that runs one at a time with its siblings (Bio Armor's Adaptations, Dual
 * Pistols' ammunition, Staff Fighting's forms): auto-issued, with a GroupMembership the game uses
 * to switch the others off. These start off; the overview offers one switch per group.
 */
export function isExclusiveToggle(p: Power): boolean {
  return p.type === 'Toggle' && !!p.auto && (p.gm?.length ?? 0) > 0;
}

/**
 * Whether a power is counted in totals by default: autos and toggles, except the inherent
 * utility toggles (Rest, Walk, Sprint), which would otherwise apply their resting/walking
 * penalties, and exclusive granted toggles (none of a group runs until one is chosen). Every
 * power can still be switched on or off per build.
 */
export function defaultOn(p: Power): boolean {
  if (isExclusiveToggle(p)) return false;
  if (p.type === 'Auto') return true;
  if (p.type !== 'Toggle') return false;
  return !p.n.startsWith('Inherent.Inherent.');
}

/** @return Whether a mod lands on the caster (self buffs, own auras, PBAoE team buffs). */
function affectsSelf(p: Power, m: Mod): boolean {
  if (m.tg === 'Caster') return true;
  if (m.tg !== 'Affected') return false;
  const ea = p.ea ?? [p.tgt];
  return ea.includes('Caster');
}

function walkEffects(effs: Effect[] | undefined, ctx: EvalContext, fn: (m: Mod) => void): void {
  for (const e of effs ?? []) {
    if (e.ch !== undefined && e.ch < 1) continue;
    if (e.ppm) continue;
    if (!evalRequires(e.req, ctx)) continue;
    for (const m of e.m ?? []) fn(m);
    walkEffects(e.sub, ctx, fn);
  }
}

const SPEED_BASE = 21; // ft/s for base run/jump speed of 1.0

/**
 * Compute totals for a build.
 *
 * @param gd Game data.
 * @param rules Rules view of the build.
 * @param b The build (for per-power toggles).
 * @param level 0-based level to compute at (default 49, or the exemplar level).
 */
export function computeTotals(gd: GameData, rules: BuildRules, b: Build, level = b.exemplar ?? b.endLevel ?? 49): Totals {
  const at: Archetype = rules.at;
  const lines = new Map<string, StatLine>();
  const line = (key: string, label: string): StatLine => {
    let l = lines.get(key);
    if (!l) {
      l = { key, label, value: 0, capped: 0, sources: [] };
      lines.set(key, l);
    }
    return l;
  };
  const add = (key: string, label: string, v: number, src: string) => {
    if (!v) return;
    const l = line(key, label);
    l.value += v;
    l.sources.push({ name: src, value: v });
  };

  const damageName = (i: number) => gd.core.attribNames.Damage[i]?.dn ?? `Type ${i}`;
  const defenseName = (i: number) => gd.core.attribNames.Defense[i]?.dn ?? `Type ${i}`;

  const owned = rules.ownedAt(level);
  const ctx: EvalContext = { ...rules.ctx(level, owned), targetEntType: 'player' };

  const apply = (p: Power, m: Mod, strength: Map<number, number> | null, srcName: string) => {
    if (!affectsSelf(p, m)) return;
    if (m.t !== 'Magnitude' && m.t !== 'Duration') return;
    const base = gd.table(at, m.tbl, level) * m.sc;
    for (const a of m.a) {
      const name = gd.attribName.get(a) ?? '';
      let mag = m.t === 'Duration' ? (m.mag ?? 1) : base;
      if (m.t === 'Magnitude' && strength && !m.fl?.includes('IgnoreStrength')) {
        mag *= 1 + (strength.get(a) ?? 0);
      }
      const dm = /^DamageType(\d+)$/.exec(name);
      const df = /^DefenseType(\d+)$/.exec(name);
      switch (m.asp) {
        case 'Current':
          if (df) add(`def.${df[1]}`, defenseName(Number(df[1])), mag, srcName);
          else if (name === 'Defense') add('def.base', 'All', mag, srcName);
          else if (name === 'ToHit') add('tohit', 'ToHit', mag, srcName);
          else if (name === 'Regeneration') add('regen', 'Regeneration', mag, srcName);
          else if (name === 'Recovery') add('recov', 'Recovery', mag, srcName);
          else if (name === 'SpeedRunning') add('run', 'Run Speed', mag, srcName);
          else if (name === 'SpeedFlying') add('fly', 'Fly Speed', mag, srcName);
          else if (name === 'SpeedJumping') add('jumpspd', 'Jump Speed', mag, srcName);
          else if (name === 'JumpHeight') add('jumph', 'Jump Height', mag, srcName);
          else if (name === 'StealthRadius') add('stealth', 'Stealth', mag, srcName);
          else if (name === 'PerceptionRadius') add('perc', 'Perception', mag, srcName);
          else if (['Held', 'Stunned', 'Sleep', 'Immobilized', 'Confused', 'Terrorized', 'Knockup', 'Knock', 'Repel'].includes(name)) {
            if (mag < 0) add(`mezprot.${name}`, name, -mag, srcName);
          }
          break;
        case 'Resistance':
          if (dm) add(`res.${dm[1]}`, damageName(Number(dm[1])), mag, srcName);
          else if (['Held', 'Stunned', 'Sleep', 'Immobilized', 'Confused', 'Terrorized', 'Knockup', 'Knock', 'Repel'].includes(name)) {
            add(`mezres.${name}`, name, mag, srcName);
          } else add(`resx.${name}`, `${name} resistance`, mag, srcName);
          break;
        case 'Strength':
          if (dm) add(`dmg.${dm[1]}`, damageName(Number(dm[1])), mag, srcName);
          else if (name === 'RechargeTime') add('rech', 'Recharge', mag, srcName);
          else if (name === 'Accuracy') add('acc', 'Accuracy', mag, srcName);
          else if (name === 'EnduranceDiscount') add('endrdx', 'Endurance Reduction', mag, srcName);
          else if (name === 'Range') add('range', 'Range', mag, srcName);
          break;
        case 'Maximum':
          if (name === 'HitPoints') add('hp', 'Max HP', mag, srcName);
          else if (name === 'Endurance') add('endmax', 'Max Endurance', mag, srcName);
          else if (name === 'Absorb') add('absorb', 'Absorb', mag, srcName);
          break;
        case 'Absolute':
          if (name === 'Absorb') add('absorb', 'Absorb', mag, srcName);
          break;
        default:
          break;
      }
    }
  };

  // Active powers
  let endUse = 0;
  const entries: BuildEntry[] = rules.entries().filter((e) => e.level <= level);
  const isOn = (e: BuildEntry) => e.on ?? defaultOn(e.power);

  // Power modes the running powers set (SetMode, e.g. Bio Armor's Adaptations): other powers'
  // effects test them with `k<Mode> Source.Mode?`
  const setMode = gd.attribByName.get('SetMode') ?? 473;
  const modeNames = gd.core.attribNames.Mode ?? [];
  const modes = new Set<string>();
  for (const e of entries) {
    if (!isOn(e)) continue;
    for (const effs of [e.power.eff, e.power.act]) {
      walkEffects(effs, ctx, (m) => {
        if (m.a.includes(setMode) && m.mag !== undefined) {
          const n = modeNames[m.mag]?.n;
          if (n) modes.add(n.toLowerCase());
        }
      });
    }
  }
  ctx.inMode = (name) => {
    const n = name.toLowerCase();
    return modes.has(n) || (n.startsWith('k') && modes.has(n.slice(1)));
  };

  for (const e of entries) {
    const p = e.power;
    if (!isOn(e)) continue;
    const str = powerStrength(gd, at, p, e.slots.filter((s) => s.level <= level).map((s) => s.enh), level).post;
    walkEffects(p.eff, ctx, (m) => apply(p, m, str, p.dn));
    walkEffects(p.act, ctx, (m) => apply(p, m, str, p.dn));
    if (p.type === 'Toggle' && p.end && p.ap) {
      endUse += p.end / p.ap / (1 + (str.get(gd.attribByName.get('EnduranceDiscount') ?? 368) ?? 0));
    }
  }

  // Set bonuses
  const bonuses = earnedBonuses(gd, entries, level);
  for (const bn of bonuses) {
    if (bn.suppressed) continue;
    const label = `${bn.set.dn} (${bn.slotted})`;
    walkEffects(bn.power.eff, ctx, (m) => m.tg === 'Caster' && apply(bn.power, m, null, label));
    walkEffects(bn.power.act, ctx, (m) => apply(bn.power, m, null, label));
  }

  // Fold the "all types" defense into each typed defense, apply caps.
  const allDef = lines.get('def.base');
  for (let i = 0; i < gd.core.attribNames.Defense.length; i++) {
    const l = line(`def.${String(i).padStart(2, '0')}`, defenseName(i));
    if (allDef) {
      l.value += allDef.value;
      l.sources.push(...allDef.sources);
    }
  }
  const hpBase = GameData.attrAt(at.max, 'HitPoints', level);
  const hpCap = GameData.attrAt(at.maxMax, 'HitPoints', level);
  for (const l of lines.values()) {
    l.capped = l.value;
    const dm = /^res\.(\d+)$/.exec(l.key);
    if (dm) {
      l.cap = GameData.attrAt(at.resMax, `DamageType${dm[1]}`, level, 0.75);
      l.capped = Math.min(l.value, l.cap);
    }
    const dd = /^dmg\.(\d+)$/.exec(l.key);
    if (dd) {
      l.cap = GameData.attrAt(at.strMax, `DamageType${dd[1]}`, level, 5) - 1;
      l.capped = Math.min(l.value, l.cap);
    }
    if (l.key === 'rech') {
      l.cap = GameData.attrAt(at.strMax, 'RechargeTime', level, 5) - 1;
      l.capped = Math.min(l.value, l.cap);
    }
  }
  const hpMax = Math.min(hpBase + (lines.get('hp')?.value ?? 0), hpCap);
  const hpLine = line('hp', 'Max HP');
  hpLine.cap = hpCap;
  hpLine.capped = hpMax;
  const endMax = 100 + (lines.get('endmax')?.value ?? 0);
  const regenTotal = 1 + (lines.get('regen')?.value ?? 0);
  const recovTotal = 1 + (lines.get('recov')?.value ?? 0);
  const baseRegen = GameData.attrAt(at.base, 'Regeneration', level, 0.25);
  const baseRecov = GameData.attrAt(at.base, 'Recovery', level, 1);
  const regenCap = GameData.attrAt(at.max, 'Regeneration', level, 20);
  const recovCap = GameData.attrAt(at.max, 'Recovery', level, 5);
  return {
    level,
    lines,
    hpMax,
    hpBase,
    regenPerSec: Math.min(regenTotal, regenCap) * baseRegen * (1 / 0.6) * (hpMax / 100),
    recovPerSec: Math.min(recovTotal, recovCap) * baseRecov * (1 / 0.6) * (endMax / 100),
    endMax,
    endUsePerSec: endUse,
    bonuses,
  };
}

/** Run speed in ft/s for a line value (base 1.0 = 21 ft/s). */
export function speedFtPerSec(v: number, base = 1): number {
  return (base + v) * SPEED_BASE;
}
