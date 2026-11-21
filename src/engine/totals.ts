/**
 * Build totals: defense, resistance, recharge, damage, accuracy, to-hit, HP, regeneration,
 * recovery, endurance and movement, with the source of every contribution.
 *
 * Mirrors MidsReborn's totals model on top of the game's own attribute math (mod_Fill):
 * magnitude = class table[level] x scale x (1 + enhancement strength unless IgnoreStrength).
 * Active powers: autos and toggles on, clicks off, each overridable per power (defaultsOf: no
 * emergency toggles, one toggle of each exclusive group). A running power
 * also applies its slotted pieces' own effects (Miracle's +Recovery, Kismet's +ToHit).
 */
import { GameData } from '../data/gamedata.ts';
import type { Archetype, BoostSet, Effect, Mod, Power } from '../data/types.ts';
import type { Build, Slot } from './build.ts';
import { boostMods, effectiveness, powerStrength, strengthMemo, type StrengthMemo } from './enhance.ts';
import { aimedAt } from './context.ts';
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

// what a last-ditch toggle does to its user while it runs: makes it untouchable, intangible, or
// able to affect only itself
const EMERGENCY = new Set(['Untouchable', 'Intangible', 'OnlyAffectsSelf']);

/**
 * Whether a toggle is an emergency mode (Hibernate, Icy Bastion, Geode, Phase Shift, Personal
 * Force Field, Nebulous Form): while it runs its user is untouchable, intangible or can affect only
 * itself. Players switch these on for a moment to survive, so counting one as always running
 * would swell regeneration, defense and resistance past anything a fight sees.
 *
 * @param gd Game data (attribute names).
 * @param p The power.
 * @return True for a toggle that gives its user one of those states.
 */
export function isEmergencyToggle(gd: GameData, p: Power): boolean {
  if (p.type !== 'Toggle') return false;
  const gives = (effs: Effect[] | undefined): boolean =>
    (effs ?? []).some((e) => (e.m ?? []).some((m) => m.tg === 'Caster' && m.a.some((a) => EMERGENCY.has(gd.attribName.get(a) ?? ''))) || gives(e.sub));
  return gives(p.eff) || gives(p.act);
}

/**
 * The build's toggles that switch each other off, as groups of two or more.
 *
 * Switching a toggle on shuts off every running toggle that shares any GroupMembership with it
 * (character_ShutOffAllTogglePowersInSameGroup, character_combat.c): Kheldian forms, the Rest
 * group (Phase Shift, Personal Force Field, Nebulous Form), travel toggles. Toggles join one group
 * through any shared membership. The granted exclusive toggles (isExclusiveToggle) have a switch
 * of their own and are left out.
 *
 * @param entries The build's entries.
 * @return Each group, earliest picked first.
 */
export function exclusiveGroups(entries: BuildEntry[]): BuildEntry[][] {
  const toggles = entries.filter((e) => e.power.type === 'Toggle' && (e.power.gm?.length ?? 0) > 0 && !isExclusiveToggle(e.power));
  const parent = toggles.map((_, i) => i);
  const root = (i: number): number => (parent[i] === i ? i : (parent[i] = root(parent[i]!)));
  const byGroup = new Map<string, number>(); // membership -> first toggle holding it
  toggles.forEach((e, i) => {
    for (const g of e.power.gm!) {
      const j = byGroup.get(String(g));
      if (j === undefined) byGroup.set(String(g), i);
      else parent[root(i)] = root(j);
    }
  });
  const groups = new Map<number, BuildEntry[]>();
  toggles.forEach((e, i) => groups.set(root(i), [...(groups.get(root(i)) ?? []), e]));
  const order = (e: BuildEntry) => e.level * 1000 + (e.pickIndex ?? 999);
  return [...groups.values()].filter((g) => g.length > 1).map((g) => g.sort((a, b) => order(a) - order(b)));
}

/**
 * Whether a power upgrades pets (Equip Robot, Train Ninjas, ...): one of its grant or revoke mods sits
 * in a group whose requirements name a pet (`MastermindPets_Droid target.VillainName>`).
 *
 * @param gd Game data (attribute offsets).
 * @param p The power.
 * @return True for a pet upgrade.
 */
export function isPetUpgrade(gd: GameData, p: Power): boolean {
  const known = upgrades.get(p);
  if (known !== undefined) return known;
  const grants = new Set(['GrantPower', 'GrantBoostedPower', 'RevokePower'].map((n) => gd.attribByName.get(n)).filter((a): a is number => a !== undefined));
  const walk = (effs: Effect[] | undefined, named: boolean): boolean =>
    (effs ?? []).some((e) => {
      const here = named || (e.req ?? []).some((t) => t.toLowerCase() === 'target.villainname>');
      return (here && (e.m ?? []).some((m) => m.a.some((a) => grants.has(a)))) || walk(e.sub, here);
    });
  const is = walk(p.eff, false) || walk(p.act, false);
  upgrades.set(p, is);
  return is;
}

// isPetUpgrade's answers, per power: defaultsOf asks for every power of a build on each change
const upgrades = new WeakMap<Power, boolean>();

/**
 * Whether each of a build's powers counts in the totals by default: defaultOn, except emergency
 * toggles (off), and in each exclusive group only the earliest picked of those still on. A pet
 * upgrade is on: switched off, its pets go without it (petcards.ts).
 *
 * @param gd Game data.
 * @param entries The build's entries.
 * @return Entry key -> on by default.
 */
export function defaultsOf(gd: GameData, entries: BuildEntry[]): Map<string, boolean> {
  const out = new Map<string, boolean>();
  for (const e of entries) out.set(e.key, (defaultOn(e.power) || isPetUpgrade(gd, e.power)) && !isEmergencyToggle(gd, e.power));
  for (const g of exclusiveGroups(entries)) {
    let kept = false;
    for (const e of g) {
      if (!out.get(e.key)) continue;
      if (kept) out.set(e.key, false);
      kept = true;
    }
  }
  return out;
}

/** @return Whether a mod lands on the caster (self buffs, own auras, PBAoE team buffs). */
export function affectsSelf(p: Power, m: Mod): boolean {
  if (m.tg === 'Caster') return true;
  if (m.tg !== 'Affected') return false;
  const ea = p.ea ?? [p.tgt];
  return ea.includes('Caster');
}

/**
 * Whether an effect group can land on the character while its power runs: not one that reaches
 * only targets other than the main one (SecondaryTargetsOnly: Group Fly's lift for teammates, a
 * toggle's slow on nearby foes), since a self power's main target is the character.
 */
const onCharacter = (e: Effect) => !e.fl?.includes('SecondaryTargetsOnly');

/**
 * Whether a mod is a standing effect of a running power: applied as it ticks or activates, not
 * the burst it gives when switched off or when it runs out (OnDeactivate, OnExpire).
 */
const standing = (m: Mod) => m.app !== 'OnDeactivate' && m.app !== 'OnExpire';

/**
 * Walk the standing mods of effect groups that always land: no chance below 1, no PPM, not only on
 * secondary targets, requirements met.
 *
 * A group tagged StealthCrit is left out: the bonus of a strike from stealth (Mask Presence's +50%
 * damage, Shinobi's +25%, each lasting 0.75 s), which a toggle would otherwise give as if always
 * there (the owner's decision, November 20, 2026).
 *
 * @param effs The groups.
 * @param ctx Requirement context.
 * @param fn Called per mod.
 */
export function walkEffects(effs: Effect[] | undefined, ctx: EvalContext, fn: (m: Mod) => void): void {
  for (const e of effs ?? []) {
    if (e.ch !== undefined && e.ch < 1) continue;
    if (e.ppm) continue;
    if (!onCharacter(e)) continue;
    if (e.tag?.some((t) => t.toLowerCase() === 'stealthcrit')) continue;
    if (!evalRequires(e.req, ctx)) continue;
    for (const m of e.m ?? []) if (standing(m)) fn(m);
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
    if (e.ppm || !onCharacter(e) || !evalRequires(e.req, ctx)) continue;
    const ch = chance * (e.ch ?? 1);
    if (ch < 1) {
      for (const m of e.m ?? []) {
        if (!standing(m)) continue;
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

/** What one mod adds to one totals line. */
export interface ModLine {
  key: string; // the line's key: 'def.03', 'res.00', 'rech', 'mezprot.Knock'
  label: string;
  value: number; // in the line's unit (fractions: 0.05 = 5%)
}

const damageNameOf = (gd: GameData, i: number) => gd.core.attribNames.Damage[i]?.dn ?? `Type ${i}`;
const defenseNameOf = (gd: GameData, i: number) => gd.core.attribNames.Defense[i]?.dn ?? `Type ${i}`;

/**
 * The totals lines one mod of a power adds to when it lands on the character.
 *
 * magnitude = class table[level] x scale x (1 + enhancement strength unless IgnoreStrength), filed
 * under the line its attribute and aspect belong to. "All" defense is filed under 'def.base';
 * computeTotals folds it into each typed defense at the end.
 *
 * @param gd Game data.
 * @param at The character's archetype (its mod tables).
 * @param level 0-based level the tables are read at.
 * @param p The power the mod belongs to.
 * @param m The mod.
 * @param strength The power's enhancement strength by attribute, or null for none (set bonuses).
 * @return One entry per line the mod touches (a zero value included).
 */
function modLines(gd: GameData, at: Archetype, level: number, p: Power, m: Mod, strength: Map<number, number> | null): ModLine[] {
  if (!affectsSelf(p, m)) return [];
  return attribLines(gd, m, gd.table(at, m.tbl, level) * m.sc, strength);
}

/**
 * The totals lines a mod adds to when it lands, its magnitude read from some class's table: the
 * character's own (modLines), or a pet's or its creator's (a pet's stats, petstats.ts).
 *
 * @param gd Game data.
 * @param m The mod.
 * @param base Its unenhanced magnitude: the caster's class table at its level x the mod's scale.
 * @param strength The caster's enhancement strength for the power by attribute, or null for none.
 * @return One entry per line the mod touches (a zero value included).
 */
export function attribLines(gd: GameData, m: Mod, base: number, strength: Map<number, number> | null): ModLine[] {
  if (m.t !== 'Magnitude' && m.t !== 'Duration') return [];
  const out: ModLine[] = [];
  const add = (key: string, label: string, value: number) => out.push({ key, label, value });
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
        if (df) add(`def.${df[1]}`, defenseNameOf(gd, Number(df[1])), mag);
        else if (name === 'Defense') add('def.base', 'All', mag);
        else if (name === 'ToHit') add('tohit', 'ToHit', mag);
        else if (name === 'Regeneration') add('regen', 'Regeneration', mag);
        else if (name === 'Recovery') add('recov', 'Recovery', mag);
        else if (name === 'SpeedRunning') add('run', 'Run Speed', mag);
        else if (name === 'SpeedFlying') add('fly', 'Fly Speed', mag);
        else if (name === 'SpeedJumping') add('jumpspd', 'Jump Speed', mag);
        else if (name === 'JumpHeight') add('jumph', 'Jump Height', mag);
        else if (name === 'StealthRadius') add('stealth', 'Stealth', mag);
        else if (name === 'PerceptionRadius') add('perc', 'Perception', mag);
        else if (MEZ_NAMES.includes(name)) {
          if (mag < 0) add(`mezprot.${name}`, MEZ[name]!, -mag);
        }
        break;
      case 'Resistance':
        if (dm) add(`res.${dm[1]}`, damageNameOf(gd, Number(dm[1])), mag);
        else if (MEZ_NAMES.includes(name)) {
          add(`mezres.${name}`, MEZ[name]!, mag);
        } else add(`resx.${name}`, `${name} resistance`, mag);
        break;
      case 'Strength':
        if (dm) add(`dmg.${dm[1]}`, damageNameOf(gd, Number(dm[1])), mag);
        else if (name === 'RechargeTime') add('rech', 'Recharge', mag);
        else if (name === 'Accuracy') add('acc', 'Accuracy', mag);
        else if (name === 'EnduranceDiscount') add('endrdx', 'Endurance Reduction', mag);
        else if (name === 'Range') add('range', 'Range', mag);
        else if (name === 'HitPoints') add('heal', 'Healing', mag);
        break;
      case 'Maximum':
        if (name === 'HitPoints') add('hp', 'Max HP', mag);
        else if (name === 'Endurance') add('endmax', 'Max Endurance', mag);
        else if (name === 'Absorb') add('absorb', 'Absorb', mag);
        else if (CAP_RAISE[name]) add(`max.${CAP_RAISE[name]}`, `${name} cap`, mag);
        break;
      case 'Absolute':
        if (name === 'Absorb') add('absorb', 'Absorb', mag);
        break;
      default:
        break;
    }
  }
  return out;
}

/**
 * Walk the mods of an earned bonus that land on its owner.
 *
 * A set bonus lands on its owner. Homecoming aims its effects at Caster (its Affected mods are the
 * share for pets, ea MyPet); Thunderspy's +Damage bonuses are Affected mods of a power whose target
 * is the caster, so they count by affectsSelf. A piece's global keeps to Caster: its other mods are
 * what it does to others when it fires.
 *
 * @param bn The earned bonus (its power, and whether it is a piece's global).
 * @param ctx Requirement context of the character.
 * @param fn Called with each mod.
 */
function walkBonusMods(bn: { power: Power; global: boolean }, ctx: EvalContext, fn: (m: Mod) => void): void {
  walkEffects(bn.power.eff, ctx, (m) => (m.tg === 'Caster' || (!bn.global && affectsSelf(bn.power, m))) && fn(m));
  walkEffects(bn.power.act, ctx, fn);
}

/**
 * What one earned bonus adds to the totals lines, as computeTotals counts it (the rule of 5 aside:
 * a suppressed copy is the caller's to leave out).
 *
 * "All" defense is folded into every typed defense line here, so the keys are the ones the
 * finished totals carry.
 *
 * @param gd Game data.
 * @param at The character's archetype.
 * @param bn The bonus: its power, and whether it is a unique piece's global.
 * @param level 0-based level the tables are read at.
 * @param ctx Requirement context of the character (BuildRules.ctx).
 * @return One entry per line, values summed; lines the bonus leaves at zero are left out.
 */
export function bonusLines(gd: GameData, at: Archetype, bn: { power: Power; global: boolean }, level: number, ctx: EvalContext): ModLine[] {
  const sum = lineSum(gd);
  walkBonusMods(bn, ctx, (m) => {
    for (const l of modLines(gd, at, level, bn.power, m, null)) sum.add(l);
  });
  return sum.lines();
}

/**
 * Sums mod lines by key, with "All" defense ('def.base') folded into every typed defense line, as
 * the finished totals carry it.
 *
 * @param gd Game data (the defense types).
 * @return `add` to take a line, `lines` for the sums (zero lines left out).
 */
function lineSum(gd: GameData): { add: (l: ModLine) => void; lines: () => ModLine[] } {
  const sum = new Map<string, ModLine>();
  const put = (l: ModLine) => {
    const cur = sum.get(l.key);
    if (cur) cur.value += l.value;
    else sum.set(l.key, { ...l });
  };
  return {
    add: (l) => {
      if (l.key !== 'def.base') put(l);
      else for (let i = 0; i < gd.core.attribNames.Defense.length; i++) put({ key: `def.${String(i).padStart(2, '0')}`, label: defenseNameOf(gd, i), value: l.value });
    },
    lines: () => [...sum.values()].filter((l) => l.value !== 0),
  };
}

/**
 * What a caller that reads the same running powers many times over one state (the set finder)
 * keeps between reads: everything here depends on the state's context and level alone, never on
 * what a power has slotted.
 */
export interface TotalsMemo {
  own: Map<Effect[], Mod[]>; // effect groups -> their standing mods that land, in walkEffects' order
  pieces: Map<number, Mod[]>; // enhancement id -> the mods of its own effects that count
  strength: StrengthMemo; // powerStrength's memo, for the state's archetype and level
}

/** @return An empty TotalsMemo. */
export function totalsMemo(): TotalsMemo {
  return { own: new Map(), pieces: new Map(), strength: strengthMemo() };
}

/** What the totals are worked out from: the powers counted at a level and whether each runs. */
export interface TotalsState {
  level: number; // 0-based level the totals are worked out at
  xpLevel: number; // the character's real level, which a slotted piece's own effects must work at
  ctx: EvalContext; // requirement context, with the modes the running powers set
  entries: BuildEntry[]; // the powers owned at the level
  isOn: (e: BuildEntry) => boolean; // whether a power counts as running
  memo?: TotalsMemo; // set by a caller that reads the state many times (the set finder's runningLines calls)
}

/**
 * The state computeTotals sums from: who is asking (requirement context), which powers the build
 * has at the level, and which of them run.
 *
 * @param gd Game data.
 * @param rules Rules view of the build.
 * @param b The build (for per-power toggles).
 * @param level 0-based level (default 49, or the exemplar or stop level).
 * @return The state.
 */
export function totalsState(gd: GameData, rules: BuildRules, b: Build, level = b.exemplar ?? b.endLevel ?? 49): TotalsState {
  const owned = rules.ownedAt(level);
  // what the totals count lands on the character: the target is a player, and is the source
  const ctx = aimedAt(rules.ctx(level, owned), { type: 'player', isSource: true });
  // defaults from the whole build, so which form of an exclusive group runs doesn't change with
  // the level the totals are worked out at
  const defaults = defaultsOf(gd, rules.entries());
  const entries: BuildEntry[] = rules.entries().filter((e) => e.level <= level);
  const isOn = (e: BuildEntry) => e.on ?? defaults.get(e.key) ?? defaultOn(e.power);

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

  // a slotted piece's own effects work at the character's real level, which exemplaring leaves alone
  const xpLevel = b.exemplar !== undefined && level === b.exemplar ? (b.endLevel ?? 49) : level;
  return { level, xpLevel, ctx, entries, isOn };
}

/**
 * Walk what one running power adds to the totals: its own effects at its slotted strength, then
 * its slotted pieces' own effects.
 *
 * A slotted piece's own effects (Miracle's +Recovery, Kismet's +ToHit, the travel sets' stealth)
 * land on the character each time the power holding it applies, while the piece works at the
 * character's real level (character_AccrueBoosts tests boost_Effectiveness at
 * character_CalcExperienceLevel and sets bBonusAttributes; character_ApplyPower attaches the
 * piece's non-boost templates). They stack by replacement, so a piece in two running powers counts
 * once: `pieceApplied` carries the pieces already counted.
 *
 * @param gd Game data.
 * @param at The character's archetype.
 * @param st The totals state.
 * @param e The power and its slots.
 * @param pieceApplied Boost ids whose own effects are already counted; this power's are added.
 * @param fn Called with each line and the display name of its source (the power, or the piece).
 * @return The power's enhancement strength by attribute (after ED).
 */
function walkRunning(
  gd: GameData,
  at: Archetype,
  st: TotalsState,
  e: { power: Power; slots: Slot[] },
  pieceApplied: Set<number>,
  fn: (l: ModLine, src: string) => void,
): Map<number, number> {
  const p = e.power;
  const memo = st.memo;
  const slots = e.slots.filter((s) => s.level <= st.level);
  const str = powerStrength(gd, at, p, slots.map((s) => s.enh), st.level, memo?.strength).post;
  const take = (m: Mod, src: string) => {
    for (const l of modLines(gd, at, st.level, p, m, str)) fn(l, src);
  };
  // the mods that land are the same on every read of a state: with a memo they are listed once
  const own = (effs: Effect[] | undefined): void => {
    if (!effs) return;
    if (!memo) return walkEffects(effs, st.ctx, (m) => take(m, p.dn));
    let mods = memo.own.get(effs);
    if (!mods) {
      const list: Mod[] = [];
      walkEffects(effs, st.ctx, (m) => list.push(m));
      memo.own.set(effs, (mods = list));
    }
    for (const m of mods) take(m, p.dn);
  };
  own(p.eff);
  own(p.act);
  for (const id of workingPieces(gd, st, e.slots)) {
    if (pieceApplied.has(id)) continue;
    pieceApplied.add(id);
    const boost = gd.power(id);
    let mods = memo?.pieces.get(id);
    if (!mods) {
      const list: Mod[] = [];
      const enhancing = new Set(boostMods(boost));
      walkEffects(boost.eff, st.ctx, (m) => m.tg === 'Caster' && !enhancing.has(m) && !isNullMod(gd, m) && list.push(m));
      memo?.pieces.set(id, list);
      mods = list;
    }
    for (const m of mods) take(m, boost.dn);
  }
  return str;
}

/**
 * The slotted pieces of a power whose own effects can count: in a slot the character has at the
 * totals' level, and working at the character's real level.
 *
 * @param gd Game data.
 * @param st The totals state.
 * @param slots The power's slots.
 * @return Their enhancement ids, in slot order (a piece slotted twice is listed twice).
 */
export function workingPieces(gd: GameData, st: TotalsState, slots: readonly Slot[]): number[] {
  const out: number[] = [];
  for (const s of slots) {
    const boost = s.enh && s.level <= st.level ? gd.powerById.get(s.enh.boost) : undefined;
    if (s.enh && boost && effectiveness(gd, boost, s.enh, st.xpLevel) > 0) out.push(boost.id);
  }
  return out;
}

/**
 * What one running power adds to the totals lines with a given slotting, as computeTotals counts
 * it: the power's own effects and its pieces' own effects (set bonuses and a toggle's endurance
 * cost aside).
 *
 * @param gd Game data.
 * @param at The character's archetype.
 * @param st The totals state of the build the power is in.
 * @param e The power and the slots to read it with.
 * @param skip Enhancement ids whose own effects another running power already gives (a piece in
 *   two running powers counts once).
 * @return The lines, summed by key ("All" defense folded into each type), and the power's
 *   enhancement strength by attribute.
 */
export function runningLines(
  gd: GameData,
  at: Archetype,
  st: TotalsState,
  e: { power: Power; slots: Slot[] },
  skip?: Iterable<number>,
): { lines: ModLine[]; strength: Map<number, number> } {
  const sum = lineSum(gd);
  const strength = walkRunning(gd, at, st, e, new Set<number>(skip), (l) => sum.add(l));
  return { lines: sum.lines(), strength };
}

/**
 * The attribute tables a character's totals read: an archetype's, or a pet's class's (PetClass,
 * whose missing tables are empty: every value then falls back to its default).
 */
export type ClassTables = Pick<Archetype, 'base' | 'min' | 'max' | 'maxMax' | 'strMax' | 'resMax'>;

/**
 * The archetype's cap on a totals line, for the lines that have one: damage resistance, damage
 * and recharge.
 *
 * @param at The archetype (or a pet's class tables).
 * @param key The line's key ('res.03', 'dmg.00', 'rech').
 * @param level 0-based level.
 * @return The cap in the line's unit, or undefined for a line without one.
 */
export function lineCap(at: ClassTables, key: string, level: number): number | undefined {
  const dm = /^res\.(\d+)$/.exec(key);
  if (dm) return GameData.attrAt(at.resMax, `DamageType${dm[1]}`, level, 0.75);
  const dd = /^dmg\.(\d+)$/.exec(key);
  if (dd) return GameData.attrAt(at.strMax, `DamageType${dd[1]}`, level, 5) - 1;
  if (key === 'rech') return GameData.attrAt(at.strMax, 'RechargeTime', level, 5) - 1;
  return undefined;
}

/** Totals lines being summed: each made on first use, every contribution kept as a source. */
export interface LineBook {
  lines: Map<string, StatLine>;
  line: (key: string, label: string) => StatLine; // the line, made on first use
  add: (key: string, label: string, v: number, src: string) => void; // a nonzero contribution and its source
}

/** @return An empty LineBook. */
export function lineBook(): LineBook {
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
  return { lines, line, add };
}

/**
 * Compute totals for a build.
 *
 * @param gd Game data.
 * @param rules Rules view of the build.
 * @param b The build (for per-power toggles).
 * @param level 0-based level to compute at (default 49, or the exemplar level).
 * @param state The totals state of that build at that level, when the caller has it already (totalsState).
 * @return The totals.
 */
export function computeTotals(gd: GameData, rules: BuildRules, b: Build, level = b.exemplar ?? b.endLevel ?? 49, state?: TotalsState): Totals {
  const at: Archetype = rules.at;
  const { lines, line, add } = lineBook();

  const damageName = (i: number) => damageNameOf(gd, i);
  const defenseName = (i: number) => defenseNameOf(gd, i);

  const st = state ?? totalsState(gd, rules, b, level);
  const { ctx, entries, isOn } = st;

  const apply = (p: Power, m: Mod, strength: Map<number, number> | null, srcName: string) => {
    for (const l of modLines(gd, at, level, p, m, strength)) add(l.key, l.label, l.value, srcName);
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
  // running toggles' base cost per second and their own slotted End Reduction; the cost needs the
  // character-wide End Discount too, known once set bonuses are in (below)
  const toggles: { name: string; perSec: number; slotted: number }[] = [];
  const pieceApplied = new Set<number>();
  for (const e of entries) {
    if (!isOn(e)) continue;
    const p = e.power;
    const str = walkRunning(gd, at, st, e, pieceApplied, (l, src) => add(l.key, l.label, l.value, src));
    if (p.type === 'Toggle' && p.end && p.ap) {
      toggles.push({ name: p.dn, perSec: p.end / p.ap, slotted: str.get(gd.attribByName.get('EnduranceDiscount') ?? 368) ?? 0 });
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
    walkBonusMods(bn, ctx, take);
    // a global's chance of a status effect at each tick is listed beside its line (walkChanceStatus)
    if (bn.global) walkChanceStatus(gd, bn.power.eff, ctx, (m, ch) => m.tg === 'Caster' && addChance(bn.power, m, ch, label));
  }
  // every list in alphabetical order, so a source is easy to find: the sets, each set's bonuses
  const setGroups: SetBonusGroup[] = [...groups.values()]
    .filter((g) => g.stats.size > 0)
    .map((g) => ({ set: g.set, counts: [...g.counts.values()].sort((a, b) => b - a), stats: [...g.stats.values()].sort((a, b) => byName(a.label, b.label)) }))
    .sort((a, b) => byName(a.set.dn, b.set.dn));

  // Toggle costs: a power's End Reduction is the character's End Discount (set bonuses, Conserve
  // Power, ...) plus its own slotted pieces, and its cost per activation is divided by 1 + that
  // (character_tick.c: fEnduranceCost / pattrStrength->fEnduranceDiscount, where the power's
  // strength starts from the character's, character_mods.c)
  const globalDiscount = lines.get('endrdx')?.value ?? 0;
  for (const t of toggles) {
    const cost = t.perSec / Math.max(0.01, 1 + globalDiscount + t.slotted);
    endUse += cost;
    add('enduse', 'End use', -cost, t.name); // per toggle, negative: what drains the endurance bar
  }

  return {
    ...finishTotals(gd, at, level, { lines, line, add }),
    setGroups,
    bonusesOver5,
    endUsePerSec: endUse,
    bonuses,
  };
}

/** What finishTotals works out from summed lines: everything in Totals but the set bonuses and toggle costs. */
export type FinishedTotals = Omit<Totals, 'setGroups' | 'bonusesOver5' | 'endUsePerSec' | 'bonuses'>;

/**
 * Finish summed totals lines against a class: "All" defense folded into each type, caps applied,
 * and hit points, endurance, regeneration, recovery, movement and perception worked out from the
 * class's base values, minimums and caps.
 *
 * @param gd Game data.
 * @param at The class's attribute tables (the character's archetype, or a pet's class).
 * @param level 0-based level.
 * @param book The summed lines; their sources are sorted and their caps set here.
 * @return The finished totals.
 */
export function finishTotals(gd: GameData, at: ClassTables, level: number, book: LineBook): FinishedTotals {
  const { lines, line } = book;
  const defenseName = (i: number) => defenseNameOf(gd, i);
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
    const cap = lineCap(at, l.key, level);
    if (cap !== undefined) {
      l.cap = cap;
      l.capped = Math.min(l.value, cap);
    }
  }
  const hpMax = Math.min(hpBase + (lines.get('hp')?.value ?? 0), hpCap);
  const hpLine = line('hp', 'Max HP');
  hpLine.cap = hpCap;
  hpLine.capped = hpMax;
  // a class's maximum endurance (every archetype's is 100) and what its powers add
  const endMax = GameData.attrAt(at.max, 'Endurance', level, 100) + (lines.get('endmax')?.value ?? 0);
  // CalcCur: the class base times (1 + the summed mods), e.g. Fly's 1.5 x (1 + 1.61)
  const cur = (attr: string, dflt: number, key: string) => GameData.attrAt(at.base, attr, level, dflt) * (1 + (lines.get(key)?.value ?? 0));
  // ClampCur against attrMax: the class maximum plus Maximum-aspect raises, which ClampMax holds
  // under the class's MaxMax (Super Speed lifts the run cap from 6.46 to 8.398)
  const capOf = (attr: string, key: string) =>
    Math.min(GameData.attrAt(at.max, attr, level, 1e9) + (lines.get(`max.${key}`)?.value ?? 0), GameData.attrAt(at.maxMax, attr, level, 1e9));
  // ClampCur against attrMin too: the class minimum (one it doesn't list is 0), so a class that
  // can't regenerate (the Maintenance Drone's -999999 regeneration) shows none, not a loss
  const floorOf = (attr: string) => GameData.attrAt(at.min, attr, level, 0);
  const capped = (attr: string, dflt: number, key: string) => Math.max(floorOf(attr), Math.min(cur(attr, dflt, key), capOf(attr, key)));
  const regenRaw = cur('Regeneration', 0.25, 'regen');
  const recovRaw = cur('Recovery', 1, 'recov');
  // per second: the regeneration or recovery value as a share of max HP or endurance
  const perSec = (v: number, max: number) => v * (1 / 0.6) * (max / 100);
  return {
    level,
    lines,
    hpMax,
    hpBase,
    regenPerSec: perSec(Math.max(floorOf('Regeneration'), Math.min(regenRaw, capOf('Regeneration', 'regen'))), hpMax),
    recovPerSec: perSec(Math.max(floorOf('Recovery'), Math.min(recovRaw, capOf('Recovery', 'recov'))), endMax),
    regenPerSecRaw: perSec(regenRaw, hpMax),
    recovPerSecRaw: perSec(recovRaw, endMax),
    hpRaw: hpBase + (lines.get('hp')?.value ?? 0),
    speeds: {
      run: capped('SpeedRunning', 1, 'run'),
      fly: capped('SpeedFlying', 1.5, 'fly'),
      jump: capped('SpeedJumping', 1, 'jumpspd'),
      jumpHeight: capped('JumpHeight', 1, 'jumph'),
    },
    // perception mods are fractions of the base radius (+0.6 = +60%), unlike stealth's feet
    perception: capped('PerceptionRadius', 500, 'perc'),
    endMax,
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
