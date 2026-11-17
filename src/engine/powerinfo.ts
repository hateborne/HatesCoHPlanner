/**
 * The client's "Show Detailed Info" power panel (PvE, enhanced and (base) values), as structured
 * data. Ported from uiPowerInfo.c (displayPowerInfo, power_AddBaseStats, power_AddTargetInfo,
 * power_AddEffects, translateEffect, addAttribValue, getTotalDamage, getRequiresString) with the
 * strings and colors of menuMessages.ms. getTotalDamage's pseudo-pet damage follows the live
 * client (decompiled), which differs from that source. The list of real pets (power_AddPets), PvP,
 * the class selector and the level slider are not ported.
 *
 * The output is UI-agnostic: runs of text with an optional color (the client's `<color #xxxxxx>`
 * tags), grouped into rows and effect sentences.
 */
import type { GameData } from '../data/gamedata.ts';
import type { Archetype, Effect, Mod, PetPower, Power } from '../data/types.ts';
import { serverById } from '../data/servers.ts';
import { infoRequires, type EvalContext } from './requires.ts';

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

// ---- tag modes (getChanceModString, getChanceModValue) ------------------------------------------

// The note a tag mode adds, by the substrings (any case) that pick it, in the client's order
// (Homecoming i28p4 0x1404de5c0, i28p3 the same; Thunderspy 0x1404d1f90 has no ASTeamCrit). The
// texts are the client's messages (DualPistolsLethalMode, ..., FieryEmbraceMode, ASTeamCritStr).
const TAG_NOTES: readonly (readonly [readonly string[], string])[] = [
  [['Lethal', 'LethalKB10', 'LethalKB25', 'LethalKB50', 'LethalKB70', 'HailofBulletsKnockdown', 'HailofBulletsEndKnockback'], 'Only using Standard Ammo'],
  [['FireDamage', 'FireDamageDoT', 'HailofBulletsFire'], 'Only using Incendiary Ammo'],
  [['ColdDamage', 'HailofBulletsCold'], 'Only using Cryo Ammo'],
  [['ToxicDamage', 'HailofBulletsToxic'], 'Only using Chemical Ammo'],
  [['FieryEmbrace'], 'Only using Fiery Embrace'],
];
const TEAM_CRIT_NOTE: readonly [readonly string[], string] = [['ASTeamCrit'], 'Chance increases the more allies are nearby'];
// The chance a tag mode shows instead of its group's, in the client's order (Homecoming 0x1404de9f0,
// Thunderspy 0x1404d2720). "Lethal" and "FireDamage" come first, so a LethalKB* or FireDamageDoT
// tag reads 1 as in the client; ASTeamCrit has no entry, so it reads 0. Single precision, as there.
const TAG_CHANCES: readonly (readonly [string, number])[] = [
  ['Lethal', 1],
  ['FieryEmbrace', 1],
  ['LethalKB10', Math.fround(0.1)],
  ['LethalKB25', 0.25],
  ['LethalKB50', 0.5],
  ['LethalKB70', Math.fround(0.7)],
  ['HailofBulletsKnockdown', Math.fround(0.05)],
  ['HailofBulletsEndKnockback', Math.fround(0.4)],
  ['FireDamage', 1],
  ['FireDamageDoT', Math.fround(0.8)],
  ['HailofBulletsFire', Math.fround(0.6)],
  ['ColdDamage', 1],
  ['HailofBulletsCold', Math.fround(0.6)],
  ['ToxicDamage', 1],
  ['HailofBulletsToxic', Math.fround(0.6)],
];

// The tables above in lower case (the client compares in any case), with and without ASTeamCrit.
const lower = (names: readonly string[]) => names.map((n) => n.toLowerCase());
const NOTES_OWN_TAG = TAG_NOTES.map(([names, note]) => [lower(names), note] as const);
const NOTES_ALL = [...NOTES_OWN_TAG, [lower(TEAM_CRIT_NOTE[0]), TEAM_CRIT_NOTE[1]] as const];
const CHANCES = TAG_CHANCES.map(([name, chance]) => [name.toLowerCase(), chance] as const);

/** A group's tag mode: the note its line gets and the chance it shows. */
interface TagMode {
  note: string;
  chance: number; // 0..1, shown in place of the group's chance
}

/**
 * The tag mode of an effect group, as the client's power info reads it (getChanceModString and
 * getChanceModValue, decompiled).
 *
 * Only a group with tags has one. Homecoming's client reads the group's first tag, then each parent
 * group's first tag in turn (a parent without tags is passed over), until one names a mode; the
 * chance is looked up the same way, apart, so a mode with no chance entry (ASTeamCrit) reads 0.
 * Thunderspy's client (`ownTag`) reads the group's own first tag only and knows no ASTeamCrit.
 *
 * @param e The group.
 * @param parents Its parent groups, nearest first.
 * @param ownTag The server's client reads the group's own first tag only (`tagModes`).
 * @return The mode, or null when the group has none.
 */
function tagMode(e: Effect, parents: readonly Effect[], ownTag: boolean): TagMode | null {
  if (!e.tag?.length) return null;
  const firsts = (ownTag ? [e] : [e, ...parents]).flatMap((g) => (g.tag?.length ? [g.tag[0]!.toLowerCase()] : []));
  const notes = ownTag ? NOTES_OWN_TAG : NOTES_ALL;
  let note: string | undefined;
  for (const t of firsts) {
    note = notes.find(([names]) => names.some((n) => t.includes(n)))?.[1];
    if (note) break;
  }
  if (!note) return null;
  let chance = 0;
  for (const t of firsts) {
    const found = CHANCES.find(([name]) => t.includes(name));
    if (found) {
      chance = found[1];
      break;
    }
  }
  return { note, chance };
}

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

/**
 * Magnitude and duration of a mod (modGetMagnitudeAndDuration), enhancement not applied.
 *
 * @param table The mod's table value for the class running it, at the level shown.
 * @param m The mod.
 * @return Its magnitude and duration.
 */
function magAndDur(table: number, m: Mod): { mag: number; dur: number } {
  const val = table * m.sc;
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
  chance: number; // 0..1, its own group's chance (the client reads no parent's), the tick chance apart
  shown: number; // 0..1, the group chance its line reads: `chance`, or its group's tag mode's chance
  mode: string | null; // a tag mode's note (tagMode): its line is listed whatever its chance
  tick: number; // 0..1, the mod's tick chance
  hide: boolean; // a pet's HideFromInfo or PPM group: counted in its damage, not listed
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
    // one exact run of tokens, as the client and the source test it: Homecoming's own Containment
    // groups (kTerrorized first) carry no note, and their damage counts (Liquid Nitrogen, in game)
    if (has('kImmobilizedtarget>0>kHeldtarget>0>||kSleeptarget>0>||kStunnedtarget>0>||'))
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

// How many pets deep a pet's damage is followed (a pet whose power makes a pet ...): the data goes
// one deep, and a loop in damaged data must still end.
const MAX_PET_DEPTH = 4;
// How many ExecutePower steps deep the client follows (a recursion counter it checks before each).
const MAX_EXECUTE_DEPTH = 4;

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

  const isClassProp = (name: string) => name.startsWith('arch') || name.startsWith('rank') || name === 'class';
  /**
   * The requirement context of a power run by a class: the character's own powers (no creator),
   * or a pseudo-pet's, whose `source.owner>` / `source.creator>` read the class that made it.
   */
  const contextFor = (cls: string, creator: string | null): EvalContext => ({
    ownsPower: () => false,
    ownsSet: () => false,
    prop: (name) => {
      if (isClassProp(name)) return cls;
      if (name === 'level') return level + 1;
      if (name === 'alignment' || name === 'type') return 'hero';
      return '';
    },
    ...(creator === null ? {} : { ownerProp: (name: string) => (isClassProp(name) ? creator : 0) }),
    inMode: () => false,
    targetEntType: 'critter',
  });
  const ctx = contextFor(at.n, null);
  const ownTagModes = serverById(gd.server)?.tagModes === 'ownTag';
  const ownGroupRequires = serverById(gd.server)?.infoRequires === 'ownGroup';

  const attrName = (offset: number): string | null => {
    // the client names only the first ten damage types; it leaves out a line whose attribute it
    // can't name (AttrUnknown), so Vulnerability lists no radiation, electrical, sonic or quantum
    // resistance beside "all damage", as in game
    if (offset >= 0 && offset < 80) return DAMAGE_NAMES[offset / 4] ?? null;
    // likewise the first ten defense types only: Evasive Maneuvers lists no toxic defense beside
    // "all defense", as in game (the Attack Types row names them all: defenseTypeName)
    const d0 = O['DefenseType00'] ?? 104;
    if (offset >= d0 && offset < d0 + 80) return DEFENSE_NAMES[(offset - d0) / 4] ?? null;
    const raw = gd.attribName.get(offset);
    if (!raw) return null;
    const known = ATTR_NAMES[raw];
    if (known) return known;
    return raw.replace(/([a-z])([A-Z0-9])/g, '$1 $2').toLowerCase();
  };

  /** @return A defense type's name for the Attack Types row (toxic past the first ten), or null. */
  const defenseTypeName = (offset: number): string | null => {
    const i = (offset - (O['DefenseType00'] ?? 104)) / 4;
    if (i < 0 || i >= 20) return null;
    const nm = DEFENSE_NAMES[i];
    if (nm) return nm;
    const dn = gd.core.attribNames.Defense[i]?.dn;
    return dn ? dn.replace(/_/g, ' ').toLowerCase() : 'unique';
  };

  const eff = (off: number | undefined) => str(off);

  // ---- damage totals (getTotalDamage) ----
  /**
   * Walk effect groups (PvE, visible, requirements met by the client's power-info check), yielding
   * one template per mod x attribute.
   *
   * The templates come in the client's template-list order: each group's sub-groups before its
   * own mods (its loader, decompiled), so the lines read in the game's order.
   *
   * Each template keeps its own group's chance and its tick chance apart: the live client's
   * getTotalDamage and power_AddEffects read only the template's own group's chance, never a parent
   * group's (decompiled; confirmed in game: Executioner's Shot's crits, Thunder Strike's team crits).
   * A pseudo-pet's power (`pet`) is walked as getTotalDamage reads every template: its HideFromInfo
   * and PPM groups count too (marked `hide`, as they aren't listed).
   *
   * A group with a tag mode (tagMode) shows the mode's chance on its own lines in place of its own;
   * the damage total keeps the group's own chance.
   *
   * @param effs The groups.
   * @param reqs The parent groups' requirements.
   * @param out Where the templates go.
   * @param ec The requirement context of the class running the power.
   * @param pet The power is a pseudo-pet's.
   * @param hidden A parent group is HideFromInfo or PPM (a pet's).
   * @param parents The parent groups, nearest first.
   */
  const templates = (
    effs: Effect[] | undefined,
    reqs: string[][],
    out: Tmpl[],
    ec: EvalContext = ctx,
    pet = false,
    hidden = false,
    parents: readonly Effect[] = [],
  ): void => {
    const cls = String(ec.prop('archetype'));
    const owner = ec.ownerProp ? String(ec.ownerProp('archetype')) : null;
    for (const e of effs ?? []) {
      if (e.fl?.includes('PVPOnly')) continue;
      const hide = hidden || !!e.fl?.includes('HideFromInfo') || !!e.ppm;
      if (hide && !pet) continue;
      const chance = e.ch ?? 1;
      // the requirements its line and damage read: Homecoming's client reads every group above too
      // (its check and its notes walk the parents), Thunderspy's the group's own only
      const own = e.req && e.req.length ? [e.req] : [];
      const rq = ownGroupRequires ? own : [...reqs, ...own];
      // the client's own cut-down check (infoRequires), not the game's evaluator: it lists the
      // Combo Level and "Only if hidden" groups, and leaves out another archetype's. On Homecoming a
      // failing group hides its sub-groups; on Thunderspy they are checked on their own
      const met = rq.every((r) => infoRequires(r, cls, owner));
      if (!met && !ownGroupRequires) continue;
      // the client's template list: a group's sub-groups first, then its own mods
      if (e.sub?.length) templates(e.sub, rq, out, ec, pet, hide, [e, ...parents]);
      if (!met) continue;
      const mode = tagMode(e, parents, ownTagModes);
      for (const m of e.m ?? []) {
        if (m.t === 'SkillMagnitude') continue;
        const tc = m.tc ?? 1;
        const base = {
          m,
          chance,
          shown: mode ? mode.chance : chance,
          mode: mode?.note ?? null,
          tick: tc,
          hide,
          delay: m.del ?? e.del ?? 0,
          reqs: rq,
          tags: e.tag ?? [],
          evalOk: true,
        };
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
    }
  };
  /** @return A pseudo-pet's power's templates, walked with the pet's requirement context. */
  const petTemplates = (pp: PetPower, ec: EvalContext): Tmpl[] => {
    const out: Tmpl[] = [];
    templates(pp.eff, [], out, ec, /*pet=*/ true);
    templates(pp.act, [], out, ec, /*pet=*/ true);
    return out;
  };
  const all: Tmpl[] = [];
  templates(power.eff, [], all);
  templates(power.act, [], all);

  const hp = O['HitPoints'] ?? 80;
  const EXECUTE = gd.attribByName.get('ExecutePower') ?? 512;

  /** The class a power runs with: its tables, its requirement context, and whether it is a pet's. */
  interface Runner {
    cls: string;
    table: (tbl: string) => number;
    ec: EvalContext;
    pet: boolean;
  }

  /**
   * getTotalDamage: the average damage of a power's templates, base and enhanced, plus that of
   * every pseudo-pet it creates (petDamage) and every power it executes (execDamage).
   *
   * @param src The power: its full name (its pets are listed under it) and its effect groups.
   * @param tmpls Its templates, walked with the runner's requirement context.
   * @param run The class running it.
   * @param depth How many pets deep this power runs (0: the character's own).
   * @param execDepth How many ExecutePower steps deep it runs.
   * @return Base and enhanced damage.
   */
  const totalDamage = (
    src: { n: string; eff?: Effect[]; act?: Effect[] },
    tmpls: readonly Tmpl[],
    run: Runner,
    depth: number,
    execDepth: number,
  ): { base: number; total: number } => {
    const table = run.table;
    let base = 0;
    let total = 0;
    for (const t of tmpls) {
      if (t.attrib < 0 || t.attrib >= hp || ASPECT[t.m.asp] !== 'Abs' || t.all) continue;
      if (requiresNotes(t.reqs, true).length) continue;
      const { mag, dur } = magAndDur(table(t.m.tbl), t.m);
      if (!(mag < 0)) continue;
      const boost = t.m.fl?.includes('IgnoreStrength') ? 0 : eff(t.attrib);
      // the client takes a DoT at its tick chance and anything else at its own group's chance
      const chance = dur ? t.tick : t.chance;
      let n = 1;
      if (dur) {
        const ticks = Math.floor(dur / (t.m.per ?? 1)) + 1;
        if (t.m.fl?.includes('CancelOnMiss')) {
          let avg = 0;
          let k = 1;
          for (; k < ticks; k++) avg += Math.pow(chance, k) * (1 - chance) * k;
          avg += Math.pow(chance, k) * ticks;
          n = avg;
          base += -mag * n;
          total += -mag * n * (1 + boost);
          continue;
        }
        n = ticks * chance;
      } else n = chance;
      base += -mag * n;
      total += -mag * n * (1 + boost);
    }
    const pets = petDamage(src.n, run.cls, depth, execDepth);
    const exec = execDamage(src, run, depth, execDepth);
    return { base: base + pets.base + exec.base, total: total + pets.total + exec.total };
  };

  /** @return Every mod of these groups (and the groups in them) that executes a power, once per such attribute. */
  const executeMods = (effs: Effect[] | undefined, out: Mod[] = []): Mod[] => {
    for (const e of effs ?? []) {
      for (const m of e.m ?? []) for (const a of m.a) if (a === EXECUTE) out.push(m);
      executeMods(e.sub, out);
    }
    return out;
  };

  /**
   * The damage of the powers a power executes (ExecutePower), as the live client's getTotalDamage
   * adds it (both clients, decompiled): each one's own total, run by the same class, with its
   * enhanced damage only when the mod has CopyBoosts. Every executing mod counts, whatever its
   * group's chance, requirements or flags, as the client reads its whole template list: those of
   * PvP-only groups, which the export drops, come from the pets file (`exec`). Executions nest at
   * most four deep.
   *
   * @param src The executing power (its full name finds its PvP-only executions).
   * @param run The class running it.
   * @param depth How many pets deep it runs.
   * @param execDepth How many ExecutePower steps deep it runs.
   * @return Base and enhanced damage.
   */
  const execDamage = (
    src: { n: string; eff?: Effect[]; act?: Effect[] },
    run: Runner,
    depth: number,
    execDepth: number,
  ): { base: number; total: number } => {
    let base = 0;
    let total = 0;
    if (execDepth >= MAX_EXECUTE_DEPTH) return { base, total };
    const pvpOnly = (gd.pets?.exec?.[src.n] ?? []).map((x): Pick<Mod, 'pwn' | 'fl'> => ({ pwn: x.p, fl: x.boosts ? ['CopyBoosts'] : [] }));
    const mods: Pick<Mod, 'pw' | 'pwn' | 'fl'>[] = [...executeMods(src.eff), ...executeMods(src.act), ...pvpOnly];
    for (const m of mods) {
      // the character's powers name what they execute by id; a pet's (from the pets file) by name
      const named = m.pwn?.map((n) => ({ n, pp: gd.pets?.powers[n] ?? gd.powerByName.get(n.toLowerCase()) })) ?? [];
      const byId = m.pw?.map((id) => {
        const pp = gd.powerById.get(id);
        return { n: pp?.n ?? '', pp };
      }) ?? [];
      for (const { n, pp } of [...byId, ...named]) {
        if (!pp) continue;
        const tmpls: Tmpl[] = [];
        templates(pp.eff, [], tmpls, run.ec, run.pet);
        templates(pp.act, [], tmpls, run.ec, run.pet);
        const r = totalDamage({ n, eff: pp.eff, act: pp.act }, tmpls, run, depth, execDepth + 1);
        base += r.base;
        total += m.fl?.includes('CopyBoosts') ? r.total : r.base;
      }
    }
    return { base, total };
  };

  /**
   * The damage of the pseudo-pets a power creates, as the live client's getTotalDamage adds it
   * (its pet branch, decompiled; Homecoming's differs from the OuroV2 source's uiPowerInfo.c).
   *
   * 1. A pet counts only when every power it runs is Auto (pet_IsAutoOnly).
   * 2. It runs with its creator's class when it is a PseudoPet, else with its own class.
   * 3. Each pet power's damage is its own total (totalDamage, with the pet's class, its creator's
   *    class for `source.owner>`, and the character's enhancement strengths), times
   *    max(1, floor(the mod's Duration / the pet power's ActivatePeriod)) when that period isn't 0
   *    (Thunderspy's client adds one: the file's `plus`). The division is the client's
   *    single-precision one.
   * 4. Without CopyBoosts its enhanced damage is its base damage.
   * 5. Its templates follow the client's chance rules (templates, `pet`): a DoT at its tick
   *    chance, anything else at its own group's chance, HideFromInfo and PPM groups included.
   * 6. What its powers execute runs as the pet too (execDamage).
   *
   * @param name The creating power's full name.
   * @param cls The class running the creating power.
   * @param depth How many pets deep the creating power runs.
   * @param execDepth How many ExecutePower steps deep it runs.
   * @return Base and enhanced pet damage (none without the version's pet file).
   */
  const petDamage = (name: string, cls: string, depth: number, execDepth: number): { base: number; total: number } => {
    let base = 0;
    let total = 0;
    const file = gd.pets;
    if (!file || depth >= MAX_PET_DEPTH) return { base, total };
    const plus = typeof file.plus === 'number' ? file.plus : 0;
    for (const c of file.pets[name] ?? []) {
      const powers = c.p.map((pn) => [pn, file.powers[pn]] as const);
      if (powers.some(([, pp]) => pp && pp.type !== 'Auto')) continue;
      const petCls = c.pseudo ? cls : c.cls;
      if (!petCls) continue;
      const run: Runner = { cls: petCls, table: (tbl) => gd.classTable(petCls, tbl, level), ec: contextFor(petCls, cls), pet: true };
      for (const [pn, pp] of powers) {
        if (!pp) continue;
        const r = totalDamage({ n: pn, eff: pp.eff, act: pp.act }, petTemplates(pp, run.ec), run, depth + 1, execDepth);
        const ap = pp.ap ?? 0;
        const times = ap ? Math.max(1, Math.floor(Math.fround(Math.fround(c.dur ?? 0) / Math.fround(ap))) + plus) : 1;
        base += r.base * times;
        total += (c.boosts ? r.total : r.base) * times;
      }
    }
    return { base, total };
  };

  const own: Runner = { cls: at.n, table: (tbl) => gd.table(at, tbl, level), ec: ctx, pet: false };
  const { base: dmgBase, total: dmgTotal } = totalDamage(power, all, own, 0, 0);

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
  // the client's EffectArea row (power_AddTargetInfo): Character, Cone, Sphere, Location and Chain;
  // none for Map and later kinds
  if (area === undefined || area === 'Sphere' || area === 'Cone' || area === 'Location' || area === 'Chain') {
    let a: string;
    if (area === 'Chain') a = `Chain -- ${f2(power.rad ?? 0)} ft. jump distance`;
    else if (area === 'Cone') {
      a = `Cone -- ${f2(power.rad ?? 0)} ft. radius<br>${f2(((power.arc ?? 0) * 180) / Math.PI)} degree arc`;
    } else if (area === 'Sphere') a = `AoE -- ${f2(power.rad ?? 0)} ft. radius`;
    else if (area === 'Location') a = TXT.locationTarget;
    else a = TXT.singleTarget;
    if (power.maxT) a += `<br>${TXT.maxTargets.replace('{max}', String(power.maxT))}`;
    target.push(row(TXT.effectArea, `<color #ffffff>${a}`));
  }
  if (power.atk && power.atk.length) {
    const names = power.atk.map((o) => {
      const d = defenseTypeName(o);
      if (d) return `${d} defense`;
      return attrName(o) ?? String(o);
    });
    target.push(row(TXT.attackTypes, `<color #ffffff>${names.join(', ')}`));
  }

  // ---- effects (power_AddEffects) ----
  const effects: InfoEffect[] = [];
  const isStatus = (o: number) =>
    (o >= (O['Confused'] ?? 256) && o <= (O['OnlyAffectsSelf'] ?? 304)) || (o >= (O['Knockup'] ?? 324) && o <= (O['Repel'] ?? 332));
  const isDamageOff = (o: number) => o >= 0 && o < hp;

  const chanceText = (pct: number) => TXT.chanceForMiss.replace('{chance}', f2(pct));
  const off100 = (pct: number) => Math.abs(pct - 100) > 1e-6;

  /**
   * power_AddEffects: a power's effect sentences, after those of the pseudo-pets it makes
   * (petLines, the client's power_AddPetEffects pass at the start).
   *
   * A pet's power (`pet`) is listed as the live client lists it (decompiled): effects on the pet
   * itself are left out; its damage ticks for the pet's lifetime, floor(lifetime / its
   * ActivatePeriod) + 1 times; an effect that doesn't suppress itself lasts the lifetime, or as
   * many of its own durations as fit in it plus one; and every pet effect with a duration says so.
   *
   * Every line reads its chance by the live client's rule: its own group's chance when its
   * template's own Duration field is 0, else its tick chance unless it CancelOnMiss. A group with
   * tags is left out at chance 0 unless it has a tag mode (tagMode), which it then reads as its
   * group's chance, its note first; a group without tags is listed at any chance.
   *
   * @param name The power's full name (its pets are listed under it).
   * @param tmpls Its templates.
   * @param type Its power type.
   * @param ap Its ActivatePeriod.
   * @param table A mod table's value for the class running it, at the level shown.
   * @param cls That class's name.
   * @param both Show enhanced values with the base in parentheses.
   * @param pet The pet's lifetime (its EntCreate mod's Duration) when the power is a pet's.
   * @param depth How many pets deep the power runs.
   * @param out Where the sentences go.
   */
  const effectLines = (
    name: string,
    tmpls: readonly Tmpl[],
    type: string,
    ap: number,
    table: (tbl: string) => number,
    cls: string,
    both: boolean,
    pet: { dur: number } | null,
    depth: number,
    out: InfoEffect[],
  ): void => {
    petLines(name, cls, both, depth, out);
    for (const t of tmpls) {
      const m = t.m;
      const offset = t.attrib;
      const eType = ASPECT[m.asp];
      if (!eType) continue;
      if (t.hide) continue;
      if (!t.chance && t.tags.length && !t.mode) continue; // the client skips only a tagged group of chance 0
      if (pet && m.tg === 'Caster') continue; // the client doesn't list what a pet does to itself

      if (offset === 481 || offset === 486 || offset === (gd.attribByName.get('GrantPower') ?? 481) || offset === (gd.attribByName.get('GrantBoostedPower') ?? 486)) {
        // a pet's grant is named; one the version's own data lacks has its name in the pets file
        const pn = m.pwn?.[0];
        const dn =
          m.pw?.[0] !== undefined
            ? gd.powerById.get(m.pw[0])?.dn
            : pn !== undefined
              ? (gd.powerByName.get(pn.toLowerCase())?.dn ?? gd.pets?.names?.[pn])
              : undefined;
        if (dn) {
          out.push({
            line: parseMarkup(`<color #52ff7d>${TXT.powerGrant.replace('{powerName}', dn)}`),
            notes: [],
          });
        }
        continue;
      }

      const attr = attrName(offset);
      if (
        !attr ||
        (offset >= (O['Translucency'] ?? 468) && offset !== O['DropToggles']) ||
        offset === O['MovementControl'] ||
        offset === O['MovementFriction'] ||
        offset === O['NullBool'] ||
        offset === O['StealthRadiusPlayer'] || // PvE shows StealthRadius, PvP the player variant
        offset === O['Fly'] // Homecoming does not list the fly-status lines (screenshot)
      )
        continue;

      const { mag: fMag, dur: fDuration } = magAndDur(table(m.tbl), m);
      if (m.fl?.includes('HideZero') && fMag === 0) continue;
      const boosted = both ? eff(offset) : 0;
      const cancelOnMiss = !!m.fl?.includes('CancelOnMiss');
      const fChance = t.shown * 100;
      const fTick = t.tick * 100;

      let pchChance = '';
      let pchTicks = '';
      let pchChance2 = '';
      // the live client's rule: the group's chance when the template's own Duration field is 0 (a
      // duration from a table doesn't count), else the tick chance
      if (off100(fChance) && !m.dur) pchChance = chanceText(fChance);
      else if (off100(fTick) && !cancelOnMiss) pchChance = chanceText(fTick);
      let iTicks = 0;
      if (isDamageOff(offset) && eType === 'Abs') {
        if (pet && pet.dur && ap) iTicks = Math.floor(Math.fround(Math.fround(pet.dur) / Math.fround(ap))) + 1;
        else if (fDuration) iTicks = Math.floor(fDuration / (m.per ?? 1)) + 1;
        if (iTicks > 1) {
          pchTicks = TXT.ticksOf.replace('{ticks}', String(iTicks));
          if (off100(fTick) && cancelOnMiss) pchChance2 = chanceText(fTick);
        }
      }
      // how long it is shown to last: a pet's effect lasts its lifetime unless it suppresses itself
      let shownDur = fDuration;
      if (pet && pet.dur && !(Array.isArray(m.sup) && m.sup.length)) {
        if (iTicks > 1) shownDur = pet.dur;
        else shownDur = fDuration ? fDuration * (Math.trunc(Math.fround(Math.fround(pet.dur) / Math.fround(fDuration))) + 1) : 0;
      }

      // typed name
      let pchType: string;
      const allKind = t.all;
      if (isDamageOff(offset)) {
        if (eType === 'Str') pchType = `strength to ${allKind ? 'all damage' : attr}`;
        else if (eType === 'Cur') pchType = allKind ? 'all damage' : attr;
        else if (eType === 'Res') pchType = `resistance to ${allKind ? 'all damage' : attr}`;
        else if (eType === 'Abs') pchType = offset === 28 ? 'heal' : attr;
        else pchType = attr;
      } else if (offset >= (O['DefenseType00'] ?? 104) && offset < (O['Defense'] ?? 184)) {
        const defName = allKind ? 'all defense' : `${attr} defense`;
        // both live clients word a Current defense as a Strength one (GenericStr; Homecoming
        // 0x1404e37e0, Thunderspy 0x1404da680): "+9.75% strength to ranged defense", as in game
        pchType = eType === 'Str' || eType === 'Cur' ? `strength to ${defName}` : attr;
      } else if (isStatus(offset)) {
        if (eType === 'Cur') pchType = fMag < 0 ? `${attr} protection` : `magnitude ${attr}`;
        else if (eType === 'Str') pchType = `strength to ${attr}`;
        else if (eType === 'Res') pchType = `resistance to ${attr}`;
        else pchType = attr;
      } else if (eType === 'Res') pchType = `resistance to ${attr}`;
      else if (eType === 'Max') pchType = `max ${attr}`;
      else if (eType === 'Str') pchType = `strength to ${attr}`;
      else pchType = attr;

      // special magnitude strings (expressions)
      let pchMag: string | null = null;
      if (m.mx && m.mx.length) {
        const joined = m.mx.join('');
        if (joined.toLowerCase() === '60kHitPointssource>-0100minmax60/0.2*'.toLowerCase())
          pchMag = '.3 per Health Percentage Point below 60% ';
        else if (joined.toLowerCase() === '75kHitPointssource>-0100minmax60/0.5*'.toLowerCase())
          pchMag = '.8 per Health Percentage Point below 75% ';
        else pchMag = 'Special '; // trailing space like the two client strings above
      }

      const value = attribValueMarkup(O, eType, m, offset, fMag, boosted, both, pchMag);

      let pchTail = '';
      if (iTicks > 1) {
        pchTail = TXT.overTime.replace('{duration}', prettyDuration(shownDur));
      } else if ((pet || type === 'Click') && shownDur) {
        if (both && eType === 'Cur' && isStatus(offset)) {
          // boosted hold effects lengthen the duration instead of the magnitude
          pchTail =
            TXT.forDurationBoosted.replace('{boostedDuration}', prettyDuration(shownDur * (1 + boosted))) +
            `(${prettyDuration(shownDur)})<color #aaaaaa>`;
        } else pchTail = TXT.forDuration.replace('{duration}', prettyDuration(shownDur));
      }
      const pchTarget = m.tg === 'Caster' ? TXT.onSelf : TXT.onTarget;
      const pchDelay = t.delay ? TXT.afterDelay.replace('{sec}', prettyDuration(t.delay)) : '';

      const line = parseMarkup(pchChance + pchTicks + pchChance2 + value + pchType + pchTail + pchTarget + pchDelay);
      // the sentence starts in the default (white) color unless the markup says otherwise
      const notes: Seg[][] = [];
      const note = (txt: string) => notes.push([{ text: txt, color: NOTE_COLOR, italic: true }]);
      if (t.mode) note(t.mode); // the client adds it before the requirement notes
      if (t.tags.includes('Overpower')) note('Overpower');
      for (const n of requiresNotes(t.reqs, false)) note(n);
      if (m.fl?.includes('IgnoreStrength')) note(TXT.ignoresBuffs);
      if (m.fl?.includes('IgnoreResistance')) note(TXT.unresistable);
      out.push({ line, notes });
    }
  };

  /**
   * power_AddPetEffects as the live client runs it (decompiled): before a power's own sentences,
   * those of each pseudo-pet it makes, in the order of its template list.
   *
   * A pet whose EntCreate mod sits under a HideFromInfo group isn't listed (its damage still
   * counts), nor one that runs a power other than Auto. Each of its powers is listed as the pet's
   * (effectLines, `pet`), its villain def's powers first, then the mod's own (their order in the
   * file). Enhanced values show for the villain def's powers whenever the power's do, and for the
   * mod's own only with CopyBoosts.
   *
   * @param name The creating power's full name.
   * @param cls The class running it.
   * @param both The creating power shows enhanced values.
   * @param depth How many pets deep it runs.
   * @param out Where the sentences go.
   */
  const petLines = (name: string, cls: string, both: boolean, depth: number, out: InfoEffect[]): void => {
    const file = gd.pets;
    if (!file || depth >= MAX_PET_DEPTH) return;
    for (const c of file.pets[name] ?? []) {
      if (c.hid) continue;
      const powers = c.p.map((pn) => [pn, file.powers[pn]] as const);
      if (powers.some(([, pp]) => pp && pp.type !== 'Auto')) continue;
      const petCls = c.pseudo ? cls : c.cls;
      if (!petCls) continue;
      const pctx = contextFor(petCls, cls);
      powers.forEach(([pn, pp], i) => {
        if (!pp) return;
        const shown = both && (i < (c.def ?? 0) || !!c.boosts);
        const table = (tbl: string) => gd.classTable(petCls, tbl, level);
        effectLines(pn, petTemplates(pp, pctx), pp.type, pp.ap ?? 0, table, petCls, shown, { dur: c.dur ?? 0 }, depth + 1, out);
      });
    }
  };

  effectLines(power.n, all, power.type, power.ap ?? 0, (tbl) => gd.table(at, tbl, level), at.n, showBoth, null, 0, effects);

  const title = parseMarkup(
    TXT.title
      .replace('{PowerName}', power.dn)
      .replace('{level}', String(level + 1))
      .replace('{className}', at.dn),
  );
  return { title, stats, target, effects };
}
