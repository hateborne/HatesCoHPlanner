/**
 * Build totals: defense, resistance, recharge, damage, accuracy, to-hit, HP, regeneration,
 * recovery, endurance and movement, with the source of every contribution.
 *
 * Mirrors MidsReborn's totals model on top of the game's own attribute math (mod_Fill):
 * magnitude = class table[level] x scale x (1 + enhancement strength unless IgnoreStrength).
 * Active powers: autos and toggles on, clicks off, each overridable per power. A running power
 * also applies its slotted pieces' own effects (Miracle's +Recovery, Kismet's +ToHit).
 */
import { GameData } from '../data/gamedata.ts';
import type { Archetype, BoostSet, Effect, Mod, Power } from '../data/types.ts';
import type { Build } from './build.ts';
import { boostMods, effectiveness, powerStrength } from './enhance.ts';
import { evalRequires, type EvalContext } from './requires.ts';
import type { BuildEntry, BuildRules } from './rules.ts';
import { earnedBonuses, type EarnedBonus } from './setbonus.ts';

export interface Source {
  name: string; // display name of the contributing power or bonus
  value: number;
}

/** A source that only sometimes applies (a roll each time its power ticks): listed, never summed. */
export interface ChanceSource {
  name: string; // display name of the piece or power
  chance: number; // 0..1, rolled each time the power applies
  value: number; // what it gives when the roll succeeds, in the line's unit
  duration?: number; // seconds it lasts once it lands
}

export interface StatLine {
  key: string; // e.g. 'def.Smashing', 'res.Fire', 'rech'
  label: string;
  value: number; // raw sum (fractions: 0.45 = 45%)
  capped: number; // after the archetype cap
  cap?: number;
  sources: Source[];
  chances?: ChanceSource[]; // chance sources, kept out of value and sources (alphabetical)
}

/** One aggregated stat of a set's bonuses ("Energy (Res)" 1.5%, "Max HP" 1.13%, "Knockback (Prot)" 4). */
export interface SetBonusStat {
  label: string;
  value: number; // fraction for '%', magnitude for 'mag', feet for 'ft'
  unit: '%' | 'mag' | 'ft';
}

/** Every bonus one set gives the build, summed over the powers it is slotted in. */
export interface SetBonusGroup {
  set: BoostSet;
  counts: number[]; // pieces slotted per power that earns a set bonus (2+), largest first: Decimation (6) (3) (2)
  stats: SetBonusStat[];
}

export interface Totals {
  level: number;
  lines: Map<string, StatLine>;
  hpMax: number;
  hpBase: number;
  regenPerSec: number;
  recovPerSec: number;
  regenPerSecRaw: number; // before the archetype's regeneration cap
  recovPerSecRaw: number; // before the recovery cap
  hpRaw: number; // max HP before the HP cap
  setGroups: SetBonusGroup[]; // active set bonuses by set (rule-of-5 copies and unique pieces' globals left out)
  bonusesOver5: number; // bonus copies suppressed by the rule of 5
  speeds: { run: number; fly: number; jump: number; jumpHeight: number }; // x 21 ft/s (height: x 4 ft), capped
  perception: number; // feet, capped
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

/**
 * Walk the status-effect mods (protection or resistance) of a power's chance effects, with the
 * chance each lands at: the effects walkEffects leaves out.
 *
 * A unique piece's global power is an auto power that rolls its chance every time it ticks, for
 * an effect lasting until the next tick (Shield Wall's and Gladiator's Armor's 20% chance of
 * teleport resistance). The game rolls each power's chance on its own, so these are listed beside
 * the line rather than summed or averaged into it. Chance damage, heals and absorbs are procs, not
 * standing protection, and are left out.
 *
 * @param gd Game data (attribute names).
 * @param effs The effects.
 * @param ctx Requirement context.
 * @param fn Called per status-effect mod with the chance it lands at (0..1).
 * @param chance The chance of the effect holding these (for sub effects).
 */
function walkChanceStatus(gd: GameData, effs: Effect[] | undefined, ctx: EvalContext, fn: (m: Mod, chance: number) => void, chance = 1): void {
  for (const e of effs ?? []) {
    if (e.ppm || !evalRequires(e.req, ctx)) continue;
    const ch = chance * (e.ch ?? 1);
    if (ch < 1) {
      for (const m of e.m ?? []) {
        const status = m.a.every((a) => MEZ_NAMES.includes(gd.attribName.get(a) ?? ''));
        if (status && (m.asp === 'Resistance' || m.asp === 'Current')) fn(m, ch);
      }
    }
    walkChanceStatus(gd, e.sub, ctx, fn, ch);
  }
}

/** Compare display names alphabetically, ignoring case ("Positron's Blast" before "Preventive Medicine"). */
const byName = (a: string, b: string): number => a.localeCompare(b, 'en', { sensitivity: 'base', numeric: true });

/**
 * Whether a mod only carries a number for help text: a unique piece's "Null" attribute effect
 * (Luck of the Gambler's 7.5% recharge, whose real effect is the set's global bonus power).
 *
 * @param gd Game data.
 * @param m The mod.
 * @return True when every attribute it touches is Null.
 */
function isNullMod(gd: GameData, m: Mod): boolean {
  return m.a.every((a) => gd.attribName.get(a) === 'Null');
}

// Maximum-aspect mods that raise a current value's cap (Super Speed, Fly, Long Jump): attribute
// name -> the line key the raise is kept under, `max.<key>`
const CAP_RAISE: Record<string, string> = {
  SpeedRunning: 'run',
  SpeedFlying: 'fly',
  SpeedJumping: 'jumpspd',
  JumpHeight: 'jumph',
  Regeneration: 'regen',
  Recovery: 'recov',
  PerceptionRadius: 'perc',
};

// status effects: attribute name -> label (Current aspect: protection, Resistance aspect: resistance)
export const MEZ: Record<string, string> = {
  Held: 'Hold',
  Immobilized: 'Immobilize',
  Stunned: 'Stun',
  Sleep: 'Sleep',
  Knock: 'Knockback',
  Knockup: 'Knockup',
  Confused: 'Confuse',
  Terrorized: 'Terrorize',
  Repel: 'Repel',
  Teleport: 'Teleport',
};
const MEZ_NAMES = Object.keys(MEZ);

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
          else if (MEZ_NAMES.includes(name)) {
            if (mag < 0) add(`mezprot.${name}`, MEZ[name]!, -mag, srcName);
          }
          break;
        case 'Resistance':
          if (dm) add(`res.${dm[1]}`, damageName(Number(dm[1])), mag, srcName);
          else if (MEZ_NAMES.includes(name)) {
            add(`mezres.${name}`, MEZ[name]!, mag, srcName);
          } else add(`resx.${name}`, `${name} resistance`, mag, srcName);
          break;
        case 'Strength':
          if (dm) add(`dmg.${dm[1]}`, damageName(Number(dm[1])), mag, srcName);
          else if (name === 'RechargeTime') add('rech', 'Recharge', mag, srcName);
          else if (name === 'Accuracy') add('acc', 'Accuracy', mag, srcName);
          else if (name === 'EnduranceDiscount') add('endrdx', 'Endurance Reduction', mag, srcName);
          else if (name === 'Range') add('range', 'Range', mag, srcName);
          else if (name === 'HitPoints') add('heal', 'Healing', mag, srcName);
          break;
        case 'Maximum':
          if (name === 'HitPoints') add('hp', 'Max HP', mag, srcName);
          else if (name === 'Endurance') add('endmax', 'Max Endurance', mag, srcName);
          else if (name === 'Absorb') add('absorb', 'Absorb', mag, srcName);
          else if (CAP_RAISE[name]) add(`max.${CAP_RAISE[name]}`, `${name} cap`, mag, srcName);
          break;
        case 'Absolute':
          if (name === 'Absorb') add('absorb', 'Absorb', mag, srcName);
          break;
        default:
          break;
      }
    }
  };
  // a chance status effect (walkChanceStatus) on the protection or resistance line it would
  // raise, listed apart: the line's value counts only what is always there
  const addChance = (p: Power, m: Mod, chance: number, srcName: string) => {
    if (!affectsSelf(p, m) || m.t !== 'Magnitude') return;
    const mag = gd.table(at, m.tbl, level) * m.sc;
    for (const a of m.a) {
      const name = gd.attribName.get(a) ?? '';
      const key = m.asp === 'Resistance' ? 'mezres' : m.asp === 'Current' && mag < 0 ? 'mezprot' : undefined;
      if (!key || !MEZ[name]) continue;
      (line(`${key}.${name}`, MEZ[name]).chances ??= []).push({ name: srcName, chance, value: Math.abs(mag), duration: m.dur });
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

  // A slotted piece's own effects (Miracle's +Recovery, Kismet's +ToHit, the travel sets' stealth)
  // land on the character each time the power holding it applies, while the piece works at the
  // character's real level, which exemplaring leaves alone (character_AccrueBoosts tests
  // boost_Effectiveness at character_CalcExperienceLevel and sets bBonusAttributes;
  // character_ApplyPower attaches the piece's non-boost templates). They stack by replacement, so
  // a piece in two running powers counts once.
  const xpLevel = b.exemplar !== undefined && level === b.exemplar ? (b.endLevel ?? 49) : level;
  const pieceApplied = new Set<number>();
  for (const e of entries) {
    const p = e.power;
    if (!isOn(e)) continue;
    const slots = e.slots.filter((s) => s.level <= level);
    const str = powerStrength(gd, at, p, slots.map((s) => s.enh), level).post;
    walkEffects(p.eff, ctx, (m) => apply(p, m, str, p.dn));
    walkEffects(p.act, ctx, (m) => apply(p, m, str, p.dn));
    for (const s of slots) {
      const boost = s.enh ? gd.powerById.get(s.enh.boost) : undefined;
      if (!s.enh || !boost || pieceApplied.has(boost.id) || effectiveness(gd, boost, s.enh, xpLevel) <= 0) continue;
      pieceApplied.add(boost.id);
      const enhancing = new Set(boostMods(boost));
      walkEffects(boost.eff, ctx, (m) => m.tg === 'Caster' && !enhancing.has(m) && !isNullMod(gd, m) && apply(p, m, str, boost.dn));
    }
    if (p.type === 'Toggle' && p.end && p.ap) {
      const cost = p.end / p.ap / (1 + (str.get(gd.attribByName.get('EnduranceDiscount') ?? 368) ?? 0));
      endUse += cost;
      add('enduse', 'End use', -cost, p.dn); // per toggle, negative: what drains the endurance bar
    }
  }

  // Set bonuses, also summed per set for the breakdown (rule-of-5 copies count for neither). A
  // unique piece's global effect (Luck of the Gambler's recharge) counts under the piece's name but
  // is no set bonus: it adds no piece count or stat to its set's group.
  const hpBase0 = GameData.attrAt(at.max, 'HitPoints', level);
  const bonuses = earnedBonuses(gd, entries, level);
  type Group = { set: BoostSet; counts: Map<string, number>; stats: Map<string, SetBonusStat> };
  const groups = new Map<number, Group>();
  const groupOf = (set: BoostSet): Group => {
    let g = groups.get(set.id);
    if (!g) groups.set(set.id, (g = { set, counts: new Map(), stats: new Map() }));
    return g;
  };
  const bonusStats = (p: Power, m: Mod): SetBonusStat[] => describeBonusMod(gd, at, p, m, level, hpBase0, damageName, defenseName);
  let bonusesOver5 = 0;
  for (const bn of bonuses) {
    const g = bn.global ? undefined : groupOf(bn.set);
    g?.counts.set(bn.entryKey, bn.slotted);
    if (bn.suppressed) {
      bonusesOver5++;
      continue;
    }
    // a set bonus is named by its set and piece count; a piece's global by the piece itself
    const label = g ? `${bn.set.dn} (${bn.slotted})` : (bn.piece ?? bn.power).dn;
    const take = (m: Mod) => {
      apply(bn.power, m, null, label);
      if (!g) return;
      for (const st of bonusStats(bn.power, m)) {
        const cur = g.stats.get(st.label);
        if (cur) cur.value += st.value;
        else g.stats.set(st.label, { ...st });
      }
    };
    walkEffects(bn.power.eff, ctx, (m) => m.tg === 'Caster' && take(m));
    walkEffects(bn.power.act, ctx, take);
    // a global's chance of a status effect at each tick is listed beside its line (walkChanceStatus)
    if (bn.global) walkChanceStatus(gd, bn.power.eff, ctx, (m, ch) => m.tg === 'Caster' && addChance(bn.power, m, ch, label));
  }
  // every list in alphabetical order, so a source is easy to find: the sets, each set's bonuses
  const setGroups: SetBonusGroup[] = [...groups.values()]
    .filter((g) => g.stats.size > 0)
    .map((g) => ({ set: g.set, counts: [...g.counts.values()].sort((a, b) => b - a), stats: [...g.stats.values()].sort((a, b) => byName(a.label, b.label)) }))
    .sort((a, b) => byName(a.set.dn, b.set.dn));

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
    l.sources.sort((a, b) => byName(a.name, b.name)); // stable: one name's entries keep their order
    l.chances?.sort((a, b) => byName(a.name, b.name));
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
  // CalcCur: the class base times (1 + the summed mods), e.g. Fly's 1.5 x (1 + 1.61)
  const cur = (attr: string, dflt: number, key: string) => GameData.attrAt(at.base, attr, level, dflt) * (1 + (lines.get(key)?.value ?? 0));
  // ClampCur against attrMax: the class maximum plus Maximum-aspect raises, which ClampMax holds
  // under the class's MaxMax (Super Speed lifts the run cap from 6.46 to 8.398)
  const capOf = (attr: string, key: string) =>
    Math.min(GameData.attrAt(at.max, attr, level, 1e9) + (lines.get(`max.${key}`)?.value ?? 0), GameData.attrAt(at.maxMax, attr, level, 1e9));
  const capped = (attr: string, dflt: number, key: string) => Math.min(cur(attr, dflt, key), capOf(attr, key));
  const regenRaw = cur('Regeneration', 0.25, 'regen');
  const recovRaw = cur('Recovery', 1, 'recov');
  // per second: the regeneration or recovery value as a share of max HP or endurance
  const perSec = (v: number, max: number) => v * (1 / 0.6) * (max / 100);
  return {
    level,
    lines,
    hpMax,
    hpBase,
    regenPerSec: perSec(Math.min(regenRaw, capOf('Regeneration', 'regen')), hpMax),
    recovPerSec: perSec(Math.min(recovRaw, capOf('Recovery', 'recov')), endMax),
    regenPerSecRaw: perSec(regenRaw, hpMax),
    recovPerSecRaw: perSec(recovRaw, endMax),
    hpRaw: hpBase + (lines.get('hp')?.value ?? 0),
    setGroups,
    bonusesOver5,
    speeds: {
      run: capped('SpeedRunning', 1, 'run'),
      fly: capped('SpeedFlying', 1.5, 'fly'),
      jump: capped('SpeedJumping', 1, 'jumpspd'),
      jumpHeight: capped('JumpHeight', 1, 'jumph'),
    },
    // perception mods are fractions of the base radius (+0.6 = +60%), unlike stealth's feet
    perception: capped('PerceptionRadius', 500, 'perc'),
    endMax,
    endUsePerSec: endUse,
    bonuses,
  };
}

/**
 * A set bonus mod as readable stats for the per-set breakdown: damage and defense types one by
 * one, a mod covering five or more status effects as "Mez", Max HP as a share of the base HP.
 */
function describeBonusMod(
  gd: GameData,
  at: Archetype,
  p: Power,
  m: Mod,
  level: number,
  hpBase: number,
  damageName: (i: number) => string,
  defenseName: (i: number) => string,
): SetBonusStat[] {
  if (!affectsSelf(p, m) || (m.t !== 'Magnitude' && m.t !== 'Duration')) return [];
  const mag = m.t === 'Duration' ? (m.mag ?? 1) : gd.table(at, m.tbl, level) * m.sc;
  const names = m.a.map((a) => gd.attribName.get(a) ?? '');
  const out: SetBonusStat[] = [];
  const pct = (label: string, v = mag) => out.push({ label, value: v, unit: '%' });
  const mez = names.filter((n) => MEZ_NAMES.includes(n));
  const dmgTypes = names.filter((n) => /^DamageType\d+$/.test(n));
  const defTypes = names.filter((n) => /^DefenseType\d+$/.test(n));
  const other = names.filter((n) => !mez.includes(n) && !dmgTypes.includes(n) && !defTypes.includes(n));
  const dmgLabel = (n: string) => damageName(Number(n.slice('DamageType'.length))).replace(/_/g, ' ');
  const defLabel = (n: string) => defenseName(Number(n.slice('DefenseType'.length))).replace(/_/g, ' ');
  const nice = (n: string) => BONUS_LABEL[n] ?? n.replace(/([a-z])([A-Z])/g, '$1 $2');
  switch (m.asp) {
    case 'Resistance':
      for (const n of dmgTypes) pct(`${dmgLabel(n)} (Res)`);
      if (mez.length >= 5) pct('Mez (Res)');
      else for (const n of mez) pct(`${MEZ[n]} (Res)`);
      if (defTypes.length) pct('Defense (Res)');
      for (const n of other) pct(`${/^Speed(Running|Flying)$/.test(n) ? 'Slow' : nice(n)} (Res)`);
      break;
    case 'Current':
      for (const n of defTypes) pct(`${defLabel(n)} (Def)`);
      if (mag < 0 && mez.length >= 5) out.push({ label: 'Mez (Prot)', value: -mag, unit: 'mag' });
      else if (mag < 0) for (const n of mez) out.push({ label: `${MEZ[n]} (Prot)`, value: -mag, unit: 'mag' });
      for (const n of other) {
        if (n === 'Defense') pct('All (Def)');
        else if (n === 'StealthRadius') out.push({ label: 'Stealth', value: mag, unit: 'ft' });
        else if (n === 'PerceptionRadius') pct('Perception');
        else pct(nice(n));
      }
      break;
    case 'Strength':
      if (dmgTypes.length >= 8) pct('Damage');
      else for (const n of dmgTypes) pct(`${dmgLabel(n)} Damage`);
      for (const n of other) pct(nice(n));
      break;
    case 'Maximum':
      for (const n of other) {
        if (n === 'HitPoints') pct('Max HP', mag / hpBase);
        else if (n === 'Endurance') pct('Max End', mag / 100);
        else pct(`Max ${nice(n)}`);
      }
      break;
    default:
      break;
  }
  return out;
}

const BONUS_LABEL: Record<string, string> = {
  Regeneration: 'Regeneration',
  Recovery: 'Recovery',
  ToHit: 'ToHit',
  RechargeTime: 'Recharge',
  Accuracy: 'Accuracy',
  EnduranceDiscount: 'End Discount',
  Range: 'Range',
  SpeedRunning: 'Run Speed',
  SpeedFlying: 'Fly Speed',
  SpeedJumping: 'Jump Speed',
  JumpHeight: 'Jump Height',
  HitPoints: 'Healing',
  Endurance: 'Endurance',
};
