/**
 * The client's "Show Detailed Info" power panel (PvE, enhanced and (base) values), as structured
 * data. Ported from uiPowerInfo.c (displayPowerInfo, power_AddBaseStats, power_AddTargetInfo,
 * power_AddEffects, translateEffect, addAttribValue, getTotalDamage, getRequiresString) with the
 * strings and colors of menuMessages.ms. Pets, PvP, the class selector and the level slider are
 * not ported.
 *
 * The output is UI-agnostic: runs of text with an optional color (the client's `<color #xxxxxx>`
 * tags), grouped into rows and effect sentences.
 */
import type { GameData } from '../data/gamedata.ts';
import type { Archetype, Effect, Mod, Power } from '../data/types.ts';
import { evalRequires, type EvalContext } from './requires.ts';

/** A run of text, optionally colored (CSS hex) and italic. */
export interface Seg {
  text: string;
  color?: string;
  italic?: boolean;
}

/** One "Label: value" line of the stats or target tables. */
export interface InfoRow {
  label: string;
  value: Seg[];
}

/** One effect sentence with its italic notes (requirements, "Ignores buffs and enhancements", ...). */
export interface InfoEffect {
  line: Seg[];
  notes: Seg[][];
}

/** The full detailed-info content of one power. */
export interface PowerInfo {
  title: Seg[];
  stats: InfoRow[];
  target: InfoRow[];
  effects: InfoEffect[];
}

/** Color of the row labels (the client's #aaaaaa). */
export const INFO_LABEL_COLOR = '#aaaaaa';

/** @return The plain text of a run list; line breaks (from `<br>`) become single spaces. */
export function segText(segs: readonly Seg[]): string {
  return segs
    .map((s) => s.text)
    .join('')
    .replace(/\n/g, ' ');
}

// ---- markup ------------------------------------------------------------------------------------

/** Parse the client's tiny markup (`<color #x>`, `<i>`, `<br>`, `&nbsp;`) into colored runs. */
function parseMarkup(s: string, startColor?: string): Seg[] {
  const out: Seg[] = [];
  let color = startColor;
  let italic = false;
  const re = /<([^>]*)>/g;
  let last = 0;
  const push = (t: string) => {
    const text = t.replace(/&nbsp;/g, ' ');
    if (!text) return;
    const prev = out[out.length - 1];
    if (prev && prev.color === color && !!prev.italic === italic) prev.text += text;
    else {
      const seg: Seg = { text };
      if (color) seg.color = color;
      if (italic) seg.italic = true;
      out.push(seg);
    }
  };
  for (let m = re.exec(s); m; m = re.exec(s)) {
    push(s.slice(last, m.index));
    last = m.index + m[0].length;
    const tag = (m[1] ?? '').trim();
    const cm = /^color\s+(#[0-9a-fA-F]{6})/i.exec(tag);
    if (cm) color = cm[1]?.toLowerCase();
    else if (tag === 'i') italic = true;
    else if (tag === '/i') italic = false;
    else if (tag === 'br') push('\n');
  }
  push(s.slice(last));
  return out;
}

const f2 = (n: number): string => n.toFixed(2);
const sf2 = (n: number): string => (n < 0 ? '-' : '+') + Math.abs(n).toFixed(2);

/** getPrettyDuration (uiPowerInfo.c), including its day/hour branch order. */
export function prettyDuration(time: number): string {
  if (time < 60) return `${f2(time)}s`;
  if (time < 3600) {
    const minutes = Math.floor(time / 60);
    const seconds = Math.floor(time - minutes * 60);
    return `${minutes}m ${seconds}s`;
  }
  if (time > 86400) {
    const hours = Math.floor(time / 3600);
    const minutes = Math.floor((time - hours * 3600) / 60);
    return `${hours}h ${minutes}m`;
  }
  const days = Math.floor(time / 86400);
  const hours = Math.floor((time - days * 86400) / 3600);
  return `${days}d ${hours}h`;
}

// ---- strings (menuMessages.ms) -----------------------------------------------------------------

const TXT = {
  title: '<color #ffffff>{PowerName} <color #aaaaaa>as used by level {level} <color #80e080>{className}',
  totalDamage: 'Average Damage:',
  activationTime: 'Activation Time:',
  rechargeTime: 'Recharge Time:',
  damagePerAct: 'Damage Per Activation Time:',
  damagePerCast: 'Damage Per Cast Cycle:',
  enduranceCost: 'Endurance Cost:',
  accuracy: 'Accuracy:',
  interruptTime: 'Interrupt Time:',
  availableLevel: 'Available Level:',
  powerType: 'Power Type:',
  targetType: 'Target Type:',
  powerRange: 'Power Range:',
  effectArea: 'Effect Area:',
  attackTypes: 'Attack Types:',
  ticksOf: '<color #ffffff>{ticks} <color #aaaaaa>Ticks of ',
  chanceForMiss: '<color #ffffff>{chance}% <color #aaaaaa>chance for ',
  forDuration: '<color #aaaaaa> for <color #ffffff>{duration}<color #aaaaaa>',
  overTime: '<color #aaaaaa> over <color #ffffff>{duration}<color #aaaaaa>',
  forDurationBoosted: '<color #aaaaaa> for <color #ffffff>{boostedDuration}',
  onSelf: ' on self',
  onTarget: ' on target',
  afterDelay: ' after <color #ffffff>{sec}<color #aaaaaa> delay',
  ignoresBuffs: 'Ignores buffs and enhancements',
  unresistable: 'Unresistable',
  singleTarget: 'Single Target',
  locationTarget: 'Location',
  maxTargets: '({max} targets max)',
  powerGrant: 'Grants power {powerName}',
} as const;

const NOTE_COLOR = '#aaaa88';

const POWER_TYPE: Record<string, string> = {
  Click: 'Click',
  Auto: 'Auto',
  Toggle: 'Toggle',
  Inspiration: 'Inspiration',
  Boost: 'Enhancement',
  GlobalBoost: 'Global Enhancement',
};

const TARGET_TYPE: Record<string, string> = {
  None: 'None',
  Caster: 'Self',
  Player: 'Target Player',
  PlayerHero: 'Target Hero Player',
  PlayerVillain: 'Target Villain Player',
  DeadPlayer: 'Target Incapacitated Player',
  DeadPlayerFriend: 'Target Incapacitated Friendly Player',
  DeadPlayerFoe: 'Target Incapacitated Enemy Player',
  Villain: 'Target Villain',
  DeadVillain: 'Target Incapacitated Villain',
  NPC: 'Target NPC',
  DeadOrAliveFriend: 'Friendlies',
  DeadFriend: 'Incapacitated Friendlies',
  Friend: 'Friendlies',
  DeadOrAliveFoe: 'Enemies',
  DeadFoe: 'Incapacitated Enemies',
  Foe: 'Enemies',
  Location: 'Location',
  Teleport: 'Location',
  Position: 'Position',
  Teammate: 'Teammates',
  DeadOrAliveTeammate: 'Teammates',
  DeadTeammate: 'Incapacitated Teammates',
  Leaguemate: 'Leaguemates',
  DeadOrAliveLeaguemate: 'Leaguemates',
  DeadLeaguemate: 'Incapacitated Leaguemates',
  DeadOrAliveMyPet: 'Pet',
  MyPet: 'Pet',
  DeadMyPet: 'Incapacitated Pets',
  Any: 'Any',
  DeadOrAliveAny: 'Any',
  LiterallyAnything: 'Any',
  MyOwner: 'Owner',
  MyCreator: 'Creator',
  MyCreation: 'Creator',
  DeadMyCreation: 'Incapacitated Creator',
  DeadOrAliveMyCreation: 'Creation',
};

const DAMAGE_NAMES = [
  'smashing damage',
  'lethal damage',
  'fire damage',
  'cold damage',
  'energy damage',
  'negative energy damage',
  'psionic damage',
  'healing',
  'special damage',
  'toxic damage',
];

// Homecoming's attack-type list reads "AoE defense, smashing defense".
const DEFENSE_NAMES = ['ranged', 'melee', 'AoE', 'smashing', 'lethal', 'fire', 'cold', 'energy', 'negative energy', 'psionic'];

const ATTR_NAMES: Record<string, string> = {
  Rage: 'rage',
  ToHit: 'to hit',
  HitPoints: 'hit points',
  Absorb: 'absorption',
  Endurance: 'endurance',
  Defense: 'defense',
  SpeedRunning: 'run speed',
  SpeedFlying: 'fly speed',
  SpeedSwimming: 'swim speed',
  SpeedJumping: 'jump speed',
  JumpHeight: 'jump height',
  StealthRadius: 'stealth radius',
  StealthRadiusPlayer: 'stealth radius',
  PerceptionRadius: 'perception radius',
  Regeneration: 'regeneration rate',
  Recovery: 'recovery rate',
  ThreatLevel: 'threat level',
  Taunt: 'taunt',
  Placate: 'placate',
  Confused: 'confuse',
  Afraid: 'fear',
  Terrorized: 'terrorize',
  Held: 'hold',
  Immobilized: 'immobilize',
  Stunned: 'stun',
  Sleep: 'sleep',
  Fly: 'fly',
  Jumppack: 'jumppack',
  Teleport: 'teleport',
  Untouchable: 'untouchable',
  Intangible: 'intangible',
  OnlyAffectsSelf: 'only affect self',
  Knockup: 'knockup',
  Knock: 'knockback',
  Repel: 'repel',
  Accuracy: 'accuracy',
  Range: 'range',
  RechargeTime: 'recharge',
  EnduranceDiscount: 'Endurance Cost',
};

// ---- attribute offsets -------------------------------------------------------------------------

const ATTR_FALLBACK: Record<string, number> = {
  HitPoints: 80,
  Defense: 184,
  DefenseType00: 104,
  Regeneration: 232,
  Recovery: 236,
  PerceptionRadius: 228,
  Confused: 256,
  OnlyAffectsSelf: 304,
  Fly: 284,
  Knockup: 324,
  Repel: 332,
  Accuracy: 336,
  Range: 348,
  RechargeTime: 360,
  InterruptTime: 364,
  EnduranceDiscount: 368,
  Translucency: 468,
  DropToggles: 480,
  MovementControl: 208,
  MovementFriction: 212,
  NullBool: 320,
  StealthRadius: 220,
  StealthRadiusPlayer: 224,
  Endurance: 88,
  ToHit: 100,
};

interface Offsets {
  [k: string]: number;
}

function offsets(gd: GameData): Offsets {
  const o: Offsets = {};
  for (const [k, v] of Object.entries(ATTR_FALLBACK)) o[k] = gd.attribByName.get(k) ?? v;
  return o;
}

type AType = 'Cur' | 'Max' | 'Str' | 'Res' | 'Abs';

const ASPECT: Record<string, AType> = {
  Current: 'Cur',
  Maximum: 'Max',
  Strength: 'Str',
  Resistance: 'Res',
  Absolute: 'Abs',
};

// Damage types that count as "all damage" (offset/4 bits 639) and defense types (1023).
const ALL_DAMAGE = [0, 4, 8, 12, 16, 20, 24, 36];

// ---- helpers -----------------------------------------------------------------------------------

/** Magnitude and duration of a mod at a level (modGetMagnitudeAndDuration), enhancement not applied. */
function magAndDur(gd: GameData, at: Archetype, m: Mod, level: number): { mag: number; dur: number } {
  const val = gd.table(at, m.tbl, level) * m.sc;
  switch (m.t) {
    case 'Duration':
      return { mag: m.mag ?? 1, dur: val };
    case 'Magnitude':
      return { mag: val, dur: m.dur ?? 0 };
    case 'Constant':
    case 'Expression':
      return { mag: m.mag ?? 0, dur: m.dur ?? 0 };
    default:
      return { mag: 0, dur: 0 };
  }
}

/** One mod applied to one attribute, with the chance/requirements of its effect group. */
interface Tmpl {
  m: Mod;
  attrib: number;
  all?: 'damage' | 'defense'; // collapses every damage / defense type into one "all" line
  chance: number; // 0..1, group chances times tick chance
  delay: number;
  reqs: string[][];
  tags: string[];
  evalOk: boolean;
}

/** Notes the client derives from requirement tokens (getRequiresString). */
function requiresNotes(reqs: readonly string[][], assumeDefaults: boolean): string[] {
  const notes: string[] = [];
  for (const req of reqs) {
    const s = req.join('').toLowerCase();
    const has = (t: string) => s.includes(t.toLowerCase());
    const add = (t: string) => {
      if (!notes.includes(t)) notes.push(t);
    };
    if (has('archtarget>Class_Minion_Grunteqarchtarget>Class_Minion_Smalleq||archtarget>Class_Minion_Petseq||archtarget>Class_Minion_Swarmeq||enttypetarget>playereq||!'))
      add('Only against targets tougher than minion class');
    else if (has('archtarget>Class_Minion_Grunteqarchtarget>Class_Minion_Smalleq||archtarget>Class_Minion_Petseq||archtarget>Class_Minion_Swarmeq||'))
      add('Only against minions and underlings');
    if (has('kMetersource>.9<') && has('kHeldtarget>0>kSleeptarget>0>||'))
      add('Only against held or sleeping targets when not hidden');
    else if (has('kMetersource>0>')) add('Only if hidden or target placated');
    if (has('kStealthsource>0.5>')) add('Only while domination is active');
    if (has('kHitPointstarget>10-100*5010-/0100minmaxrand100*'))
      add('2.5% chance per every percentage point targets health is below 50%');
    if (has('kImmobilizedtarget>0>') && has('kHeldtarget>0>') && has('kStunnedtarget>0>'))
      add('Only against immobilized, held, sleeping or stunned targets');
    if (has('originsource>')) {
      const origins: string[] = [];
      for (const o of ['Magic', 'Mutation', 'Natural', 'Science', 'Technology']) {
        if (has(`originsource>${o}`)) origins.push(o.toLowerCase());
      }
      add(`Only if the player's origin is ${origins.join(', ')}`);
    }
    if (has('Electronictarget.HasTag?')) add('Against electronic targets only');
    if (has('Undeadtarget.HasTag?')) add('Against undead targets only');
    if (has('Ghosttarget.HasTag?')) add('Against ghost targets only');
    if (has('kDD_BonusDotMode_2source.mode?')) add('Only when Attack Vitals combo is completed');
    if (has('kDD_DebuffMode_2source.mode?')) add('Only when Weaken combo is completed');
    if (has('kDD_BonusAoEMode_2source.mode?')) add('Only when Sweep combo is completed');
    if (has('kDD_StatusMode_2source.mode?')) add('Only when Empower combo is completed');
    const combo = (n: number) => `Temporary_Powers.Temporary_Powers.Combo_Level_${n}source.ownPower?`;
    const noCombo =
      has(combo(1) + '!' + combo(2) + '!&&' + combo(3) + '!&&') || has(combo(1) + '!&&' + combo(2) + '!&&' + combo(3) + '!&&');
    if (noCombo) {
      if (!assumeDefaults) add('Only at Combo Level 0');
    } else {
      for (const n of [1, 2, 3]) if (has(combo(n))) add(`Only at Combo Level ${n}`);
    }
    const toggled = (power: string, off: string, on: string) => {
      const base = `Temporary_Powers.Temporary_Powers.${power}target.ownPower?`;
      if (has(base + '!')) {
        if (!assumeDefaults) add(off);
      } else if (has(base)) add(on);
    };
    toggled('Temporal_Selection_Buff', 'Only when not Accelerated', 'Only when Accelerated');
    toggled('Time_Crawl_Debuff', 'Only when not Delayed', 'Only when Delayed');
    toggled('Beam_Rifle_Debuff', 'Only when not Disintegrated', 'Only when Disintegrated');
  }
  return notes;
}

/** Port of the client's attribute-value formatter (addAttribValue); returns markup. */
function attribValueMarkup(
  O: Offsets,
  eType: AType,
  m: Mod,
  offset: number,
  magIn: number,
  boosted: number,
  showBoth: boolean,
  pchMag: string | null,
): string {
  let fMag = magIn;
  const allowStr = !m.fl?.includes('IgnoreStrength');
  let both = showBoth && !!boosted && allowStr && m.t === 'Magnitude';
  if (offset === O['RechargeTime']) both = false;
  const isDamage = offset >= 0 && offset < (O['HitPoints'] ?? 80);
  const isDefense = offset >= (O['DefenseType00'] ?? 104) && offset <= (O['Defense'] ?? 184);
  const b1 = 1 + boosted;
  let s: string;

  if (offset === 28 || offset === O['HitPoints'] || offset === O['Regeneration']) {
    s = '<color #58e849>';
  } else if (offset === O['Endurance'] || offset === O['Recovery']) {
    s = '<color #45bdff>';
  } else if (offset === O['Accuracy'] || offset === O['ToHit']) {
    s = '<color #ffed61>';
  } else if (isDamage) {
    if (eType === 'Res') s = '<color #ff944e>';
    else {
      if (eType === 'Abs') fMag = -fMag; // flip damage for readability
      s = '<color #ff4b4b>';
    }
  } else if (isDefense) {
    s = '<color #bd54d9>';
  } else if (
    (offset >= (O['Confused'] ?? 256) && offset <= (O['OnlyAffectsSelf'] ?? 304)) ||
    (offset >= (O['Knockup'] ?? 324) && offset <= (O['Repel'] ?? 332))
  ) {
    s = '<color #b594ff>';
    if (eType === 'Cur') {
      if (fMag < 0) fMag *= -1;
      return `${s}${f2(fMag)}<color #aaaaaa> `;
    }
  } else if (offset >= (O['PerceptionRadius'] ?? 228)) {
    if (both) return `<color #ffffff>${sf2(fMag * 100 * b1)}% (${sf2(fMag * 100)}%)<color #aaaaaa> `;
    return `<color #ffffff>${sf2(fMag * 100 * (showBoth && !!boosted && allowStr && m.t === 'Magnitude' ? b1 : 1))}%<color #aaaaaa> `;
  } else {
    s = '<color #ffffff>';
  }

  if (pchMag) return `${s}${pchMag}<color #aaaaaa>`;

  const boostOnly = false; // ShowEnhance is "both" or "base" here, never "enhanced only"
  void boostOnly;
  switch (eType) {
    case 'Cur':
    case 'Str':
      return both
        ? `${s}${sf2(fMag * 100 * b1)}% (${sf2(fMag * 100)}%)<color #aaaaaa> `
        : `${s}${sf2(fMag * 100)}%<color #aaaaaa> `;
    case 'Res':
      return both
        ? `${s}${f2(fMag * b1 * 100)}% (${f2(fMag * 100)}%)<color #aaaaaa> `
        : `${s}${f2(fMag * 100)}%<color #aaaaaa> `;
    default:
      return both ? `${s}${f2(fMag * b1)} (${f2(fMag)})<color #aaaaaa> ` : `${s}${f2(fMag)}<color #aaaaaa> `;
  }
}

// ---- powerInfo ---------------------------------------------------------------------------------

/**
 * Build the detailed-info content of a power, PvE, with enhanced and (base) values.
 *
 * @param gd Game data.
 * @param at Character archetype (mod tables, class name).
 * @param power The power.
 * @param level 0-based character level (the "as used by level" slider; tables are read at it).
 * @param enh Enhancement strength per attribute offset (powerStrength(...).post); null = unenhanced
 *   (base values only, as for a power the character does not own).
 */
export function powerInfo(
  gd: GameData,
  at: Archetype,
  power: Power,
  level: number,
  enh: Map<number, number> | null,
): PowerInfo {
  const O = offsets(gd);
  const showBoth = enh !== null;
  const str = (off: number | undefined): number => (enh && off !== undefined ? (enh.get(off) ?? 0) : 0);

  const ctx: EvalContext = {
    ownsPower: () => false,
    ownsSet: () => false,
    prop: (name) => {
      if (name.startsWith('arch') || name.startsWith('rank') || name === 'class') return at.n;
      if (name === 'level') return level + 1;
      if (name === 'alignment' || name === 'type') return 'hero';
      return '';
    },
    inMode: () => false,
    targetEntType: 'critter',
  };

  const attrName = (offset: number): string | null => {
    if (offset >= 0 && offset < 80) {
      const nm = DAMAGE_NAMES[offset / 4];
      if (nm) return nm;
      const dn = gd.core.attribNames.Damage[offset / 4]?.dn;
      return dn ? (/unique/i.test(dn) ? 'unique' : `${dn.replace(/_/g, ' ').toLowerCase()} damage`) : null;
    }
    const d0 = O['DefenseType00'] ?? 104;
    if (offset >= d0 && offset < d0 + 80) {
      const i = (offset - d0) / 4;
      const nm = DEFENSE_NAMES[i];
      if (nm) return nm;
      const dn = gd.core.attribNames.Defense[i]?.dn;
      return dn ? dn.replace(/_/g, ' ').toLowerCase() : 'unique';
    }
    const raw = gd.attribName.get(offset);
    if (!raw) return null;
    const known = ATTR_NAMES[raw];
    if (known) return known;
    return raw.replace(/([a-z])([A-Z0-9])/g, '$1 $2').toLowerCase();
  };

  const eff = (off: number | undefined) => str(off);

  // ---- damage totals (getTotalDamage) ----
  const evalOk = (reqs: readonly string[][]): boolean => reqs.every((r) => evalRequires(r, ctx));

  /** Walk effect groups (PvE, visible, requirements met), yielding one template per mod x attribute. */
  const templates = (effs: Effect[] | undefined, chain: number, reqs: string[][], out: Tmpl[]): void => {
    for (const e of effs ?? []) {
      if (e.fl?.includes('PVPOnly') || e.fl?.includes('HideFromInfo')) continue;
      if (e.ppm) continue;
      const chance = chain * (e.ch ?? 1);
      const rq = e.req && e.req.length ? [...reqs, e.req] : reqs;
      if (!evalOk(rq)) continue;
      for (const m of e.m ?? []) {
        if (m.t === 'SkillMagnitude') continue;
        const tc = m.tc ?? 1;
        const base = { m, chance: chance * tc, delay: m.del ?? e.del ?? 0, reqs: rq, tags: e.tag ?? [], evalOk: true };
        const eType = ASPECT[m.asp];
        const hasAll = (offs: number[]) => offs.every((o) => m.a.includes(o));
        const d0 = O['DefenseType00'] ?? 104;
        const allDef = Array.from({ length: 10 }, (_, i) => d0 + i * 4);
        const rest = new Set(m.a);
        if (eType && eType !== 'Abs' && eType !== 'Max' && hasAll(ALL_DAMAGE)) {
          for (const o of ALL_DAMAGE) rest.delete(o);
          out.push({ ...base, attrib: ALL_DAMAGE[0] ?? 0, all: 'damage' });
        } else if ((eType === 'Cur' || eType === 'Str') && hasAll(allDef)) {
          for (const o of allDef) rest.delete(o);
          out.push({ ...base, attrib: d0, all: 'defense' });
        }
        for (const a of m.a) if (rest.has(a)) out.push({ ...base, attrib: a });
      }
      templates(e.sub, chance, rq, out);
    }
  };
  const all: Tmpl[] = [];
  templates(power.eff, 1, [], all);
  templates(power.act, 1, [], all);

  let dmgBase = 0;
  let dmgTotal = 0;
  const hp = O['HitPoints'] ?? 80;
  for (const t of all) {
    if (t.attrib < 0 || t.attrib >= hp || ASPECT[t.m.asp] !== 'Abs' || t.all) continue;
    if (requiresNotes(t.reqs, true).length) continue;
    const { mag, dur } = magAndDur(gd, at, t.m, level);
    if (!(mag < 0)) continue;
    const boost = t.m.fl?.includes('IgnoreStrength') ? 0 : eff(t.attrib);
    const chance = t.chance;
    let n = 1;
    if (dur) {
      const ticks = Math.floor(dur / (t.m.per ?? 1)) + 1;
      if (t.m.fl?.includes('CancelOnMiss')) {
        let avg = 0;
        let k = 1;
        for (; k < ticks; k++) avg += Math.pow(chance, k) * (1 - chance) * k;
        avg += Math.pow(chance, k) * ticks;
        n = avg;
        dmgBase += -mag * n;
        dmgTotal += -mag * n * (1 + boost);
        continue;
      }
      n = ticks * chance;
    } else n = chance;
    dmgBase += -mag * n;
    dmgTotal += -mag * n * (1 + boost);
  }

  // ---- base stats (power_AddBaseStats) ----
  const rechBoost = eff(O['RechargeTime']);
  const enhRech = power.rech !== undefined ? (power.rech ?? 0) / (1 + rechBoost) : 0;
  const baseRech = power.rech ?? 0;
  const baseEnd = power.end ?? 0;
  const enhEnd = baseEnd / (1 + eff(O['EnduranceDiscount']));
  const baseAcc = power.acc ?? 1;
  const enhAcc = baseAcc * (1 + eff(O['Accuracy']));
  const baseInt = power.intr ?? 0;
  const enhInt = baseInt / (1 + eff(O['InterruptTime']));
  const cast = power.cast ?? 0;

  const stats: InfoRow[] = [];
  const row = (label: string, markup: string): InfoRow => ({ label, value: parseMarkup(markup) });
  /** "enh (base)" when they differ and enhanced values are shown, else the base. */
  const pair = (enhV: number, baseV: number, fmt: (n: number) => string, suffix = ''): string =>
    showBoth && enhV !== baseV ? `${fmt(enhV)}${suffix} (${fmt(baseV)}${suffix})` : `${fmt(showBoth ? enhV : baseV)}${suffix}`;

  if (dmgBase) {
    stats.push(row(TXT.totalDamage, `<color #ff4b4b>${pair(dmgTotal, dmgBase, f2)}`));
  }
  if (power.type !== 'Auto') {
    if (dmgBase && cast) {
      stats.push(row(TXT.damagePerAct, `<color #ff4b4b>${pair(dmgTotal / cast, dmgBase / cast, f2)}`));
    }
    if (dmgBase) {
      const dpc = dmgBase / (cast + baseRech);
      const dpcEnh = dmgTotal / (cast + enhRech);
      stats.push(row(TXT.damagePerCast, `<color #ff4b4b>${pair(dpcEnh, dpc, f2)}`));
    }
    stats.push(row(TXT.activationTime, `<color #ffffff>${prettyDuration(cast)}`));
    stats.push(row(TXT.rechargeTime, `<color #ffffff>${pair(enhRech, baseRech, prettyDuration)}`));
    if (baseEnd) {
      if (power.type === 'Toggle') {
        const ap = power.ap || 1;
        stats.push(row(TXT.enduranceCost, `<color #45bdff>${pair(enhEnd / ap, baseEnd / ap, f2, '/s')}`));
      } else {
        stats.push(row(TXT.enduranceCost, `<color #45bdff>${pair(enhEnd, baseEnd, f2)}`));
      }
    }
  }
  if (baseAcc) stats.push(row(TXT.accuracy, `<color #ffed61>${pair(enhAcc, baseAcc, f2, 'X')}`));
  if (baseInt) stats.push(row(TXT.interruptTime, `<color #ffffff>${pair(enhInt, baseInt, prettyDuration)}`));
  const ref = gd.setOfPower.get(power.id);
  const av = ref?.set.av[ref.index] ?? 0;
  if (av > 0) stats.push(row(TXT.availableLevel, `<color #ffffff>${av + 1}`));

  // ---- target info (power_AddTargetInfo) ----
  const target: InfoRow[] = [];
  target.push(row(TXT.powerType, `<color #ffffff>${POWER_TYPE[power.type] ?? 'Unknown'}`));
  target.push(row(TXT.targetType, `<color #ffffff>${TARGET_TYPE[power.tgt] ?? 'Unknown'}`));
  if (power.rng) {
    const enhRng = power.rng * (1 + eff(O['Range']));
    target.push(row(TXT.powerRange, `<color #ffffff>${pair(enhRng, power.rng, f2, ' ft.')}`));
  }
  const area = power.area;
  if (area === undefined || area === 'Sphere' || area === 'Cone' || area === 'Location') {
    let a: string;
    if (area === 'Cone') {
      a = `Cone -- ${f2(power.rad ?? 0)} ft. radius<br>${f2(((power.arc ?? 0) * 180) / Math.PI)} degree arc`;
    } else if (area === 'Sphere') a = `AoE -- ${f2(power.rad ?? 0)} ft. radius`;
    else if (area === 'Location') a = TXT.locationTarget;
    else a = TXT.singleTarget;
    if (power.maxT) a += `<br>${TXT.maxTargets.replace('{max}', String(power.maxT))}`;
    target.push(row(TXT.effectArea, `<color #ffffff>${a}`));
  }
  if (power.atk && power.atk.length) {
    const names = power.atk.map((o) => {
      const n = attrName(o);
      const d0 = O['DefenseType00'] ?? 104;
      return n && o >= d0 && o < d0 + 80 ? `${n} defense` : (n ?? String(o));
    });
    target.push(row(TXT.attackTypes, `<color #ffffff>${names.join(', ')}`));
  }

  // ---- effects (power_AddEffects) ----
  const effects: InfoEffect[] = [];
  const isStatus = (o: number) =>
    (o >= (O['Confused'] ?? 256) && o <= (O['OnlyAffectsSelf'] ?? 304)) || (o >= (O['Knockup'] ?? 324) && o <= (O['Repel'] ?? 332));
  const isDamageOff = (o: number) => o >= 0 && o < hp;

  for (const t of all) {
    const m = t.m;
    const offset = t.attrib;
    const eType = ASPECT[m.asp];
    if (!eType) continue;
    if (!t.chance) continue;

    if (offset === 481 || offset === 486 || offset === (gd.attribByName.get('GrantPower') ?? 481) || offset === (gd.attribByName.get('GrantBoostedPower') ?? 486)) {
      const pw = m.pw?.[0] !== undefined ? gd.powerById.get(m.pw[0]) : undefined;
      if (pw) {
        effects.push({
          line: parseMarkup(`<color #52ff7d>${TXT.powerGrant.replace('{powerName}', pw.dn)}`),
          notes: [],
        });
      }
      continue;
    }

    const name = attrName(offset);
    if (
      !name ||
      (offset >= (O['Translucency'] ?? 468) && offset !== O['DropToggles']) ||
      offset === O['MovementControl'] ||
      offset === O['MovementFriction'] ||
      offset === O['NullBool'] ||
      offset === O['StealthRadiusPlayer'] || // PvE shows StealthRadius, PvP the player variant
      offset === O['Fly'] // Homecoming does not list the fly-status lines (screenshot)
    )
      continue;

    const { mag: fMag, dur: fDuration } = magAndDur(gd, at, m, level);
    if (m.fl?.includes('HideZero') && fMag === 0) continue;
    const boosted = enh ? eff(offset) : 0;
    const cancelOnMiss = !!m.fl?.includes('CancelOnMiss');
    const fChance = t.chance * 100;

    let pchChance = '';
    let pchTicks = '';
    let pchChance2 = '';
    if (Math.abs(fChance - 100) > 1e-6 && (!fDuration || !cancelOnMiss)) {
      pchChance = TXT.chanceForMiss.replace('{chance}', f2(fChance));
    }
    let iTicks = 0;
    if (isDamageOff(offset) && eType === 'Abs' && fDuration) {
      iTicks = Math.floor(fDuration / (m.per ?? 1)) + 1;
      if (iTicks > 1) {
        pchTicks = TXT.ticksOf.replace('{ticks}', String(iTicks));
        if (Math.abs(fChance - 100) > 1e-6 && cancelOnMiss) pchChance2 = TXT.chanceForMiss.replace('{chance}', f2(fChance));
      }
    }

    // typed name
    let pchType: string;
    const allKind = t.all;
    if (isDamageOff(offset)) {
      if (eType === 'Str') pchType = `strength to ${allKind ? 'all damage' : name}`;
      else if (eType === 'Cur') pchType = allKind ? 'all damage' : name;
      else if (eType === 'Res') pchType = `resistance to ${allKind ? 'all damage' : name}`;
      else if (eType === 'Abs') pchType = offset === 28 ? 'heal' : name;
      else pchType = name;
    } else if (offset >= (O['DefenseType00'] ?? 104) && offset < (O['Defense'] ?? 184)) {
      const defName = allKind ? 'all defense' : `${name} defense`;
      pchType = eType === 'Str' ? `strength to ${defName}` : eType === 'Cur' ? defName : name;
    } else if (isStatus(offset)) {
      if (eType === 'Cur') pchType = fMag < 0 ? `${name} protection` : `magnitude ${name}`;
      else if (eType === 'Str') pchType = `strength to ${name}`;
      else if (eType === 'Res') pchType = `resistance to ${name}`;
      else pchType = name;
    } else if (eType === 'Res') pchType = `resistance to ${name}`;
    else if (eType === 'Max') pchType = `max ${name}`;
    else if (eType === 'Str') pchType = `strength to ${name}`;
    else pchType = name;

    // special magnitude strings (expressions)
    let pchMag: string | null = null;
    if (m.mx && m.mx.length) {
      const joined = m.mx.join('');
      if (joined.toLowerCase() === '60kHitPointssource>-0100minmax60/0.2*'.toLowerCase())
        pchMag = '.3 per Health Percentage Point below 60% ';
      else if (joined.toLowerCase() === '75kHitPointssource>-0100minmax60/0.5*'.toLowerCase())
        pchMag = '.8 per Health Percentage Point below 75% ';
      else pchMag = 'Special';
    }

    const value = attribValueMarkup(O, eType, m, offset, fMag, boosted, showBoth, pchMag);

    let pchTail = '';
    if (iTicks > 1) {
      pchTail = TXT.overTime.replace('{duration}', prettyDuration(fDuration));
    } else if (power.type === 'Click' && fDuration) {
      if (showBoth && eType === 'Cur' && isStatus(offset)) {
        // boosted hold effects lengthen the duration instead of the magnitude
        pchTail =
          TXT.forDurationBoosted.replace('{boostedDuration}', prettyDuration(fDuration * (1 + boosted))) +
          `(${prettyDuration(fDuration)})<color #aaaaaa>`;
      } else pchTail = TXT.forDuration.replace('{duration}', prettyDuration(fDuration));
    }
    const pchTarget = m.tg === 'Caster' ? TXT.onSelf : TXT.onTarget;
    const pchDelay = t.delay ? TXT.afterDelay.replace('{sec}', prettyDuration(t.delay)) : '';

    const line = parseMarkup(pchChance + pchTicks + pchChance2 + value + pchType + pchTail + pchTarget + pchDelay);
    // the sentence starts in the default (white) color unless the markup says otherwise
    const notes: Seg[][] = [];
    const note = (txt: string) => notes.push([{ text: txt, color: NOTE_COLOR, italic: true }]);
    if (t.tags.includes('Overpower')) note('Overpower');
    for (const n of requiresNotes(t.reqs, false)) note(n);
    if (m.fl?.includes('IgnoreStrength')) note(TXT.ignoresBuffs);
    if (m.fl?.includes('IgnoreResistance')) note(TXT.unresistable);
    effects.push({ line, notes });
  }

  const title = parseMarkup(
    TXT.title
      .replace('{PowerName}', power.dn)
      .replace('{level}', String(level + 1))
      .replace('{className}', at.dn),
  );
  return { title, stats, target, effects };
}
