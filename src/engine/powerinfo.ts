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
import type { Archetype, Effect, InfoNode, Mod, PetCreation, PetPower, Power } from '../data/types.ts';
import { serverById } from '../data/servers.ts';
import type { DamageBoost } from './boost.ts';
import { aimedAt, nobody, withModes, withOwner } from './context.ts';
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
  bonus?: number; // the strength of the power's own enhancements behind the value (0.587 = +58.7%), when they change it
}

/** One effect sentence with its italic notes (requirements, "Ignores buffs and enhancements", ...). */
export interface InfoEffect {
  line: Seg[];
  notes: Seg[][];
  bonus?: number; // the strength of the power's own enhancements behind its value, when they change it
}

/** A number of a power without its enhancements and with them. */
export interface BaseAndEnhanced {
  base: number;
  enh: number; // equal to base when the power is shown unenhanced
}

/** The numbers behind a power's stats rows, for code that compares two slottings of it. */
export interface PowerNumbers {
  damage: BaseAndEnhanced; // average damage per activation (the "Average Damage" row)
  damageBoosted: number; // the same with the build's damage boosts (equal to damage.enh without any)
  heal: BaseAndEnhanced; // hit points its heal gives the caster back per activation
  recharge: BaseAndEnhanced; // seconds
  endurance: BaseAndEnhanced; // cost per activation (a toggle's: per activation period)
  accuracy: BaseAndEnhanced; // multiplier
  cast: number; // activation time in seconds
}

/** The full detailed-info content of one power. */
export interface PowerInfo {
  title: Seg[];
  stats: InfoRow[];
  target: InfoRow[];
  effects: InfoEffect[];
  numbers: PowerNumbers; // what the stats rows are written from
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
    else if (tag === '/color') color = startColor;
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
  tag: string; // the tag that named the mode, in lower case
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
  let tag = '';
  for (const t of firsts) {
    note = notes.find(([names]) => names.some((n) => t.includes(n)))?.[1];
    tag = t;
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
  return { note, chance, tag };
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
    // the mod's own magnitude, as for Duration: the pipeline leaves it out when it is 1 (the
    // Singularity's Gravitational Pull reads "1.00 magnitude repel" in game)
    case 'Constant':
    case 'Expression':
      return { mag: m.mag ?? 1, dur: m.dur ?? 0 };
    default:
      return { mag: 0, dur: 0 };
  }
}

/** A kind of attribute the client prints as "all ..." when a power covers every type of it alike. */
interface AllKind {
  name: 'damage' | 'defense';
  has: (offset: number, O: Offsets) => boolean; // the attribute is of this kind (damage 0..79, defense types 104..183)
  bit: (offset: number, O: Offsets) => number; // its type's bit in the mask
  all: number; // the mask of every type the group needs (the source's damageTypes, defenseTypes)
  count: number; // how many types a group spans (damageTypesCount, defenseTypesCount)
}

const ALL_KINDS: readonly AllKind[] = [
  // smashing, lethal, fire, cold, energy, negative energy, psionic and toxic: 639
  { name: 'damage', has: (o, O) => o >= 0 && o < (O['HitPoints'] ?? 80), bit: (o) => o / 4, all: 0x27f, count: 8 },
  // the first ten defense types: 1023
  {
    name: 'defense',
    has: (o, O) => o >= (O['DefenseType00'] ?? 104) && o < (O['Defense'] ?? 184),
    bit: (o, O) => (o - (O['DefenseType00'] ?? 104)) / 4,
    all: 0x3ff,
    count: 10,
  },
];

/** The state of one "all" group: the source's equalForAllTypes, equalSetsForAllTypes, displayedForAllTypes. */
interface AllGroup {
  flag: number; // 0 none, 1 the next type reads "all", 2 a group is being shown
  sets: number; // how many groups the power holds
  shown: number; // how many types of the current group have been passed
}

/** @return The key of a mod's "all" group: its target, kind and aspect. */
const allKey = (m: Mod, k: AllKind) => `${m.tg}|${k.name}|${m.asp}`;

/**
 * The client's markAllTypes: which target, kind and aspect of a power hold "all damage" / "all
 * defense" groups (uiPowerInfo.c; Homecoming's live client walks each effect's attribute list,
 * 0x1404e1540, decompiled).
 *
 * 1. For each target, kind and aspect, walk the power's effects in order, attribute by attribute.
 * 2. An attribute of that kind and aspect takes the group's value (Magnitude + Scale) when none is
 *    set; a different value passes over the rest of that effect. Otherwise it adds its type's bit.
 * 3. After each attribute of the target's effects, a mask that holds exactly every type counts one
 *    more group and clears the value, so a completed mask keeps counting until another type joins.
 *
 * @param tmpls The power's templates, one per mod x attribute, in the client's order.
 * @param O The attribute offsets.
 * @return The groups by allKey; a key with none is absent.
 */
function markAllTypes(tmpls: readonly Tmpl[], O: Offsets): Map<string, AllGroup> {
  const out = new Map<string, AllGroup>();
  const targets = new Set(tmpls.map((t) => t.m.tg));
  const aspects = new Set(tmpls.map((t) => t.m.asp));
  for (const tg of targets) {
    for (const kind of ALL_KINDS) {
      for (const asp of aspects) {
        let value = 0;
        let mask = 0;
        let sets = 0;
        let passed: Mod | null = null;
        for (const t of tmpls) {
          if (t.m.tg !== tg || t.m === passed) continue;
          if (t.m.asp === asp && kind.has(t.attrib, O)) {
            const v = (t.m.mag ?? 1) + t.m.sc;
            if (!value) value = v;
            else if (value !== v) {
              passed = t.m;
              continue;
            }
            mask |= 1 << kind.bit(t.attrib, O);
          }
          if (mask === kind.all) {
            value = 0;
            sets++;
          }
        }
        if (sets) out.set(`${tg}|${kind.name}|${asp}`, { flag: 1, sets, shown: 0 });
      }
    }
  }
  return out;
}

/** One mod applied to one attribute, with the chance/requirements of its effect group. */
interface Tmpl {
  m: Mod;
  attrib: number;
  chance: number; // 0..1, its own group's chance (the client reads no parent's), the tick chance apart
  shown: number; // 0..1, the group chance its line reads: `chance`, or its group's tag mode's chance
  mode: string | null; // a tag mode's note (tagMode): its line is listed whatever its chance
  modeTag: string | null; // the tag that named the mode, in lower case
  tick: number; // 0..1, the mod's tick chance
  info: string | null; // the mod's own note (Messages.DisplayInfo, from the version's info file)
  hide: boolean; // a HideFromInfo or PPM group: not listed
  counted: boolean; // its damage counts in the total (a pet's hidden groups' does, the character's own don't)
  delay: number;
  reqs: string[][];
  tags: string[];
  evalOk: boolean;
}

/**
 * Notes the client derives from requirement tokens (getRequiresString).
 *
 * Thunderspy's client adds whom a line applies to, after the origin note (its getRequiresString,
 * 0x1404d2f00, decompiled): a requirement that names the target reads "Applies to enemies" when it
 * holds `target.isFriend?!` or `enttypetarget>crittereq`, else "Applies to allies" (its Stygian
 * Circle's heals vs lieutenants and bosses, in game). Its power_AddEffects asks for it; its
 * getTotalDamage doesn't, so it never takes a group out of the damage total.
 *
 * @param reqs The requirements the notes read (the group's and, on Homecoming, its parents').
 * @param assumeDefaults Leave out the notes of the default case (the damage total; Combo Level 0).
 * @param friendNotes Add Thunderspy's "Applies to" note (infoFriendNotes).
 * @return The notes, in the client's order, each once.
 */
function requiresNotes(reqs: readonly string[][], assumeDefaults: boolean, friendNotes = false): string[] {
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
    if (friendNotes && has('target'))
      add(has('target.isFriend?!') || has('enttypetarget>crittereq') ? 'Applies to enemies' : 'Applies to allies');
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
  seen?: (enhV: number, baseV: number) => void,
): string {
  let fMag = magIn;
  const allowStr = !m.fl?.includes('IgnoreStrength');
  let both = showBoth && !!boosted && allowStr && m.t === 'Magnitude';
  if (offset === O['RechargeTime']) both = false;
  const isDamage = offset >= 0 && offset < (O['HitPoints'] ?? 80);
  const isDefense = offset >= (O['DefenseType00'] ?? 104) && offset <= (O['Defense'] ?? 184);
  const b1 = 1 + boosted;
  let s: string;
  /** "enh (base)", told to `seen` (whether the enhancements move the value). */
  const two = (fmt: (n: number) => string, enhV: number, baseV: number, suffix: string): string => {
    seen?.(enhV, baseV);
    return `${fmt(enhV)}${suffix} (${fmt(baseV)}${suffix})`;
  };

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
    if (both) return `<color #ffffff>${two(sf2, fMag * 100 * b1, fMag * 100, '%')}<color #aaaaaa> `;
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
        ? `${s}${two(sf2, fMag * 100 * b1, fMag * 100, '%')}<color #aaaaaa> `
        : `${s}${sf2(fMag * 100)}%<color #aaaaaa> `;
    case 'Res':
      return both
        ? `${s}${two(f2, fMag * b1 * 100, fMag * 100, '%')}<color #aaaaaa> `
        : `${s}${f2(fMag * 100)}%<color #aaaaaa> `;
    default:
      return both ? `${s}${two(f2, fMag * b1, fMag, '')}<color #aaaaaa> ` : `${s}${f2(fMag)}<color #aaaaaa> `;
  }
}

// ---- powerInfo ---------------------------------------------------------------------------------

// How many pets deep a pet's damage is followed (a pet whose power makes a pet ...): the data goes
// one deep, and a loop in damaged data must still end.
const MAX_PET_DEPTH = 4;
// How many ExecutePower steps deep the client follows (a recursion counter it checks before each).
const MAX_EXECUTE_DEPTH = 4;
// The most ticks one effect is counted for. Real effects tick a few hundred times at the very most
// (Rain of Fire: 76); the cap only keeps a damaged tick period (0, or next to it) from making the
// averages below count without end.
export const MAX_TICKS = 100_000;

/**
 * How many times an effect with a duration ticks: the client's floor(duration / period) + 1.
 *
 * @param dur The effect's duration in seconds.
 * @param per Its tick period in seconds (none: 1).
 * @return The ticks, MAX_TICKS at most.
 */
export function tickCount(dur: number, per: number | undefined): number {
  return Math.min(MAX_TICKS, Math.floor(dur / (per ?? 1)) + 1);
}

/** Who runs a power that isn't the character's own: a real pet, with its class and its creator's. */
export interface RunAs {
  cls: string; // the class it runs with (its tables, `arch` requirements)
  creator: string; // the class of the character that made it (`source.owner>` requirements)
  // effect lines of the power itself to leave out, by mod and attribute (a pet card shows the pet's
  // own resistance and defense in its rows); none: every line
  omit?: (m: Mod, attrib: number) => boolean;
  // leave out the flag notes ("Ignores buffs and enhancements", "Unresistable"): nearly every
  // effect of a pet's own powers has them, and a card has no room for them
  noFlagNotes?: boolean;
}

/**
 * Build the detailed-info content of a power, PvE, with enhanced and (base) values.
 *
 * @param gd Game data.
 * @param at Character archetype (mod tables, class name).
 * @param power The power.
 * @param level 0-based character level (the "as used by level" slider; tables are read at it).
 * @param enh Enhancement strength per attribute offset (powerStrength(...).post); null = unenhanced
 *   (base values only, as for a power the character does not own).
 * @param runAs A real pet that runs the power in the character's place (the client's power_AddPets
 *   lists a pet's powers so: its class's tables, the creator's class for `source.owner>`, every
 *   effect listed as for the character's own power); none: the character runs it.
 * @param boost The build's damage boosts (damageBoost): the tag modes its running powers raise
 *   count in the damage, and the damage rows and damage lines read the boosted damage in place of
 *   the enhanced one; none: neither.
 */
export function powerInfo(
  gd: GameData,
  at: Archetype,
  power: Power,
  level: number,
  enh: Map<number, number> | null,
  runAs?: RunAs,
  boost?: DamageBoost,
): PowerInfo {
  const O = offsets(gd);
  const showBoth = enh !== null;
  const str = (off: number | undefined): number => (enh && off !== undefined ? (enh.get(off) ?? 0) : 0);

  const isClassProp = (name: string) => name.startsWith('arch') || name.startsWith('rank') || name === 'class';
  /**
   * The requirement context of a power run by a class: the character's own powers (no creator),
   * or a pseudo-pet's, whose `source.owner>` / `source.creator>` read the class that made it.
   */
  const contextFor = (cls: string, creator: string | null): EvalContext => {
    const who = nobody((name) => {
      if (isClassProp(name)) return cls;
      if (name === 'level') return level + 1;
      if (name === 'alignment' || name === 'type') return 'hero';
      return '';
    });
    // the client's power info reads no modes, and an attack lands on a foe
    const run = withModes(aimedAt(who, { type: 'critter', isSource: false }), () => false);
    return creator === null ? run : withOwner(run, (name) => (isClassProp(name) ? creator : 0));
  };
  const runCls = runAs?.cls ?? at.n;
  const ctx = contextFor(runCls, runAs ? runAs.creator : null);
  /** @return A table's value for the class running the power. */
  const ownTable = (tbl: string): number => (runAs ? gd.classTable(runAs.cls, tbl, level) : gd.table(at, tbl, level));
  /**
   * @return The pseudo-pets a power makes: the pets file's, else (a real pet's power) the real pets
   *   file's; never both, so none counts twice.
   */
  const creationsOf = (name: string): readonly PetCreation[] => gd.pets?.pets[name] ?? gd.henchmen?.pseudo?.[name] ?? [];
  /** @return A pseudo-pet's power, or what a pet's power executes, by full name. */
  const petPower = (name: string): PetPower | undefined => gd.pets?.powers[name] ?? gd.henchmen?.powers[name];
  // the server client's extra pseudo-pet activation (Thunderspy's 1)
  const plusOf = (): number => (typeof gd.pets?.plus === 'number' ? gd.pets.plus : typeof gd.henchmen?.plus === 'number' ? gd.henchmen.plus : 0);
  const ownTagModes = serverById(gd.server)?.tagModes === 'ownTag';
  const ownGroupRequires = serverById(gd.server)?.infoRequires === 'ownGroup';
  const pvpListed = serverById(gd.server)?.infoPvp === 'listed';
  const friendNotes = !!serverById(gd.server)?.infoFriendNotes;
  // granted powers whose grant the client lists no line for (the info file's ShowInInventory 0)
  const hiddenGrants = new Set((gd.info?.hiddenGrants ?? []).map((n) => n.toLowerCase()));

  /**
   * An attribute's name as the power info writes it: the client's own ("Attr" + its field name, from
   * the version's info file: "knock", "defense debuff") when the file has it, else the planner's.
   *
   * @param offset The attribute's offset.
   * @return The name (a typed defense's with " defense"), or null for one the planner can't name.
   */
  const attrName = (offset: number): string | null => {
    const client = gd.info?.attr[String(offset)];
    if (client) return client;
    if (offset >= 0 && offset < 80) {
      const nm = DAMAGE_NAMES[offset / 4];
      if (nm) return nm;
      const dn = gd.core.attribNames.Damage[offset / 4]?.dn;
      return dn ? (/unique/i.test(dn) ? 'unique' : `${dn.replace(/_/g, ' ').toLowerCase()} damage`) : null;
    }
    const d0 = O['DefenseType00'] ?? 104;
    if (offset >= d0 && offset < d0 + 80) {
      const i = (offset - d0) / 4;
      const dn = DEFENSE_NAMES[i] ?? gd.core.attribNames.Defense[i]?.dn.replace(/_/g, ' ').toLowerCase();
      return `${dn || 'unique'} defense`;
    }
    const raw = gd.attribName.get(offset);
    if (!raw) return null;
    const known = ATTR_NAMES[raw];
    if (known) return known;
    return raw.replace(/([a-z])([A-Z0-9])/g, '$1 $2').toLowerCase();
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
   * HideFromInfo and PPM groups are walked too (marked `hide`, as they aren't listed): the client's
   * markAllTypes counts them, and so does a pseudo-pet's damage (`pet`; the character's own powers'
   * stay out of the total, the owner's decision).
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
   * @param notes The groups' own notes from the info file, laid out as the groups.
   */
  const templates = (
    effs: Effect[] | undefined,
    reqs: string[][],
    out: Tmpl[],
    ec: EvalContext = ctx,
    pet = false,
    hidden = false,
    parents: readonly Effect[] = [],
    notes?: readonly InfoNode[],
  ): void => {
    const cls = String(ec.prop('archetype'));
    const owner = ec.ownerProp ? String(ec.ownerProp('archetype')) : null;
    for (const [gi, e] of (effs ?? []).entries()) {
      // a PvP-only group only comes from the info file, for a client that lists it (Thunderspy's)
      if (e.fl?.includes('PVPOnly') && !pvpListed) continue;
      const node = notes?.[gi] ?? null;
      // a hidden group is walked too: the client's markAllTypes counts it, and a pet's damage does
      const hide = hidden || !!e.fl?.includes('HideFromInfo') || !!e.ppm;
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
      if (e.sub?.length) templates(e.sub, rq, out, ec, pet, hide, [e, ...parents], node?.s);
      if (!met) continue;
      const mode = tagMode(e, parents, ownTagModes);
      for (const [mi, m] of (e.m ?? []).entries()) {
        if (m.t === 'SkillMagnitude') continue;
        const tc = m.tc ?? 1;
        const base = {
          m,
          chance,
          shown: mode ? mode.chance : chance,
          mode: mode?.note ?? null,
          modeTag: mode?.tag ?? null,
          tick: tc,
          info: node?.m?.[mi] ?? null,
          hide,
          counted: pet || !hide,
          delay: m.del ?? e.del ?? 0,
          reqs: rq,
          tags: e.tag ?? [],
          evalOk: true,
        };
        for (const a of m.a) out.push({ ...base, attrib: a });
      }
    }
  };
  /**
   * A power's groups as the client lists them (the info file's, where they differ from the version's
   * own: Thunderspy's PvP-only groups) and their own notes.
   *
   * @param name The power's full name.
   * @param eff Its groups in the version's own files.
   * @param act Its activation groups there.
   * @return The groups, the activation groups and the notes laid out as each.
   */
  const groupsOf = (name: string, eff: Effect[] | undefined, act: Effect[] | undefined) => {
    const g = gd.info?.groups?.[name];
    const n = gd.info?.notes[name];
    return { eff: g ? g.eff : eff, act: g ? g.act : act, ne: n?.e, na: n?.a };
  };
  /** @return A pseudo-pet's power's templates, walked with the pet's requirement context. */
  const petTemplates = (name: string, pp: PetPower, ec: EvalContext): Tmpl[] => {
    const out: Tmpl[] = [];
    const g = groupsOf(name, pp.eff, pp.act);
    templates(g.eff, [], out, ec, /*pet=*/ true, false, [], g.ne);
    templates(g.act, [], out, ec, /*pet=*/ true, false, [], g.na);
    return out;
  };
  const all: Tmpl[] = [];
  const shown = groupsOf(power.n, power.eff, power.act);
  templates(shown.eff, [], all, ctx, false, false, [], shown.ne);
  templates(shown.act, [], all, ctx, false, false, [], shown.na);

  const hp = O['HitPoints'] ?? 80;
  const EXECUTE = gd.attribByName.get('ExecutePower') ?? 512;

  /** The class a power runs with: its tables, its requirement context, and whether it is a pet's. */
  interface Runner {
    cls: string;
    table: (tbl: string) => number;
    ec: EvalContext;
    pet: boolean;
    mods: boolean; // it takes the character's damage strength: the character, or a pet that copies its creator's mods
  }

  /**
   * How many times a template's magnitude counts in an average, as getTotalDamage counts damage:
   * once at its chance, or once per tick of its duration, a CancelOnMiss effect stopping at its
   * first missed tick. The client takes a DoT at its tick chance and anything else at its own
   * group's chance.
   *
   * With the build's boosts, a group whose tag mode a power switches (Fiery Embrace) follows the
   * switch: raised, it lands at the mode's chance in place of its own (a DoT at its tick chance, as
   * ever); not raised, it never lands, a DoT included.
   *
   * @param t The template.
   * @param dur Its duration in seconds (0: applied once).
   * @return The expected number of times it lands.
   */
  const expectedHits = (t: Tmpl, dur: number): number => {
    const tag = t.modeTag;
    const switched = tag !== null && !!boost?.switchTags.some((x) => tag.includes(x));
    const raised = switched && boost!.tags.some((x) => tag!.includes(x));
    if (switched && !raised) return 0;
    const chance = dur ? t.tick : raised ? t.shown : t.chance;
    if (!dur) return chance;
    const ticks = tickCount(dur, t.m.per);
    if (!t.m.fl?.includes('CancelOnMiss')) return ticks * chance;
    let avg = 0;
    let k = 1;
    for (; k < ticks; k++) avg += Math.pow(chance, k) * (1 - chance) * k;
    return avg + Math.pow(chance, k) * ticks;
  };

  /**
   * Whether a template's mode requirements hold for the build's boosts: a requirement that is only
   * tests of power modes (`kUnleashMight Source.Mode?`, joined by `&&`, each perhaps negated) is
   * read against the modes the build's running powers set, when a power of the build sets one of
   * them at all (Super Strength's Might groups count only while Rage is switched on). Any other
   * requirement, and every one without boosts, holds: the client's damage total reads no modes.
   *
   * @param t The template.
   * @return False when a mode it needs is switched off.
   */
  const modesHold = (t: Tmpl): boolean => {
    if (!boost?.switchModes.size) return true;
    const known = (name: string) => boost.switchModes.has(name) || (name.startsWith('k') && boost.switchModes.has(name.slice(1)));
    const set = (name: string) => boost.modes.has(name) || (name.startsWith('k') && boost.modes.has(name.slice(1)));
    for (const req of t.reqs) {
      const toks = req.map((x) => x.toLowerCase());
      let ok = true;
      let any = false;
      let i = 0;
      while (i < toks.length) {
        if (toks[i] === '&&') {
          i++;
          continue;
        }
        if (toks[i + 1] !== 'source.mode?') break;
        const name = toks[i]!;
        const not = toks[i + 2] === '!';
        if (known(name)) {
          any = true;
          if (set(name) === not) ok = false;
        }
        i += not ? 3 : 2;
      }
      // not a plain list of mode tests: left to the client's rule
      if (i < toks.length) continue;
      if (any && !ok) return false;
    }
    return true;
  };

  /** A power's average damage, summed four ways. */
  interface Damage {
    base: number; // no enhancements
    total: number; // with the power's enhancements
    boosted: number; // with its enhancements and the build's damage strength, capped
    bare: number; // with the build's damage strength alone (an executed power without CopyBoosts)
  }

  /**
   * The multiplier a damage template takes with the build's damage strength: 1 + its enhancement
   * strength + the character's strength for its damage type, held between 0 and the archetype's
   * cap. A template that ignores strength takes none of the character's, nor does a pet's unless
   * the pet copies its creator's mods (`Runner.mods`); such a pet is held under the creator's cap
   * (its own class's isn't in the data).
   *
   * @param t The template.
   * @param mods Its power's runner takes the character's damage strength (`Runner.mods`).
   * @param enhStr Its enhancement strength (0 for a power run without its enhancements).
   * @return The multiplier.
   */
  const strengthWith = (t: Tmpl, mods: boolean, enhStr: number): number => {
    if (t.m.fl?.includes('IgnoreStrength')) return 1;
    if (!boost || !mods) return 1 + enhStr;
    const cap = boost.cap.get(t.attrib) ?? Infinity;
    return Math.max(0, Math.min(1 + enhStr + (boost.str.get(t.attrib) ?? 0), cap));
  };

  /**
   * getTotalDamage: the average damage of a power's templates, base and enhanced, plus that of
   * every pseudo-pet it creates (petDamage) and every power it executes (execDamage).
   *
   * @param src The power: its full name (its pets are listed under it) and its effect groups.
   * @param tmpls Its templates, walked with the runner's requirement context.
   * @param run The class running it.
   * @param depth How many pets deep this power runs (0: the character's own).
   * @param execDepth How many ExecutePower steps deep it runs.
   * @return The damage sums.
   */
  const totalDamage = (
    src: { n: string; eff?: Effect[]; act?: Effect[] },
    tmpls: readonly Tmpl[],
    run: Runner,
    depth: number,
    execDepth: number,
  ): Damage => {
    const table = run.table;
    let base = 0;
    let total = 0;
    let boosted = 0;
    let bare = 0;
    for (const t of tmpls) {
      if (!t.counted || t.attrib < 0 || t.attrib >= hp || ASPECT[t.m.asp] !== 'Abs') continue;
      if (requiresNotes(t.reqs, true).length) continue;
      if (!modesHold(t)) continue;
      const { mag, dur } = magAndDur(table(t.m.tbl), t.m);
      if (!(mag < 0)) continue;
      const enhStr = t.m.fl?.includes('IgnoreStrength') ? 0 : eff(t.attrib);
      const n = expectedHits(t, dur);
      base += -mag * n;
      total += -mag * n * (1 + enhStr);
      boosted += -mag * n * strengthWith(t, run.mods, enhStr);
      bare += -mag * n * strengthWith(t, run.mods, 0);
    }
    const pets = petDamage(src, run, depth, execDepth);
    const exec = execDamage(src, run, depth, execDepth);
    return {
      base: base + pets.base + exec.base,
      total: total + pets.total + exec.total,
      boosted: boosted + pets.boosted + exec.boosted,
      bare: bare + pets.bare + exec.bare,
    };
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
   * @return The damage sums.
   */
  const execDamage = (
    src: { n: string; eff?: Effect[]; act?: Effect[] },
    run: Runner,
    depth: number,
    execDepth: number,
  ): Damage => {
    let base = 0;
    let total = 0;
    let boosted = 0;
    let bare = 0;
    if (execDepth >= MAX_EXECUTE_DEPTH) return { base, total, boosted, bare };
    const pvpOnly = (gd.pets?.exec?.[src.n] ?? []).map((x): Pick<Mod, 'pwn' | 'fl'> => ({ pwn: x.p, fl: x.boosts ? ['CopyBoosts'] : [] }));
    const mods: Pick<Mod, 'pw' | 'pwn' | 'fl'>[] = [...executeMods(src.eff), ...executeMods(src.act), ...pvpOnly];
    for (const m of mods) {
      // the character's powers name what they execute by id; a pet's (from the pets file) by name
      const named = m.pwn?.map((n) => ({ n, pp: gd.pets?.powers[n] ?? gd.powerByName.get(n.toLowerCase()) ?? gd.henchmen?.powers[n] })) ?? [];
      const byId = m.pw?.map((id) => {
        const pp = gd.powerById.get(id);
        return { n: pp?.n ?? '', pp };
      }) ?? [];
      for (const { n, pp } of [...byId, ...named]) {
        if (!pp) continue;
        const tmpls: Tmpl[] = [];
        const g = groupsOf(n, pp.eff, pp.act);
        templates(g.eff, [], tmpls, run.ec, run.pet);
        templates(g.act, [], tmpls, run.ec, run.pet);
        const r = totalDamage({ n, eff: pp.eff, act: pp.act }, tmpls, run, depth, execDepth + 1);
        base += r.base;
        total += m.fl?.includes('CopyBoosts') ? r.total : r.base;
        boosted += m.fl?.includes('CopyBoosts') ? r.boosted : r.bare;
        bare += r.bare;
      }
    }
    return { base, total, boosted, bare };
  };

  const ENT_CREATE = gd.attribByName.get('EntCreate') ?? 469;
  /**
   * Whether a pseudo-pet copies its creator's mods (CopyCreatorMods): the pets file says so
   * (`mods`, from the EntCreate mod's flag or its villain def's). For a file made before it carried
   * that, the EntCreate mods of the creating power that match the creation (duration, CopyBoosts,
   * PseudoPet) all have the flag (Homecoming's mods; a villain def's isn't in the version's files).
   *
   * @param src The creating power's effect groups.
   * @param c The creation.
   * @return True when it does.
   */
  const copiesMods = (src: { eff?: Effect[]; act?: Effect[] }, c: PetCreation): boolean => {
    if (c.mods) return true;
    const found: Mod[] = [];
    const walk = (effs: Effect[] | undefined): void => {
      for (const e of effs ?? []) {
        for (const m of e.m ?? []) {
          const fl = m.fl ?? [];
          if (m.a.includes(ENT_CREATE) && (m.dur ?? 0) === (c.dur ?? 0) && fl.includes('CopyBoosts') === !!c.boosts && fl.includes('PseudoPet') === !!c.pseudo) found.push(m);
        }
        walk(e.sub);
      }
    };
    walk(src.eff);
    walk(src.act);
    return found.length > 0 && found.every((m) => m.fl?.includes('CopyCreatorMods'));
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
   * 7. The boosted damage (the planner's own): a pet whose EntCreate mod has CopyCreatorMods gets a
   *    copy of its creator's strength mods when it is made (character_CreatePet, character_pet.c),
   *    so it takes the build's damage strength when its creator does (copiesMods).
   *
   * @param src The creating power: its full name and its effect groups.
   * @param by The class running the creating power.
   * @param depth How many pets deep the creating power runs.
   * @param execDepth How many ExecutePower steps deep it runs.
   * @return The pet damage sums (none without the version's pet file).
   */
  const petDamage = (src: { n: string; eff?: Effect[]; act?: Effect[] }, by: Runner, depth: number, execDepth: number): Damage => {
    const name = src.n;
    const cls = by.cls;
    let base = 0;
    let total = 0;
    let boosted = 0;
    let bare = 0;
    if (depth >= MAX_PET_DEPTH) return { base, total, boosted, bare };
    const plus = plusOf();
    for (const c of creationsOf(name)) {
      const powers = c.p.map((pn) => [pn, petPower(pn)] as const);
      if (powers.some(([, pp]) => pp && pp.type !== 'Auto')) continue;
      const petCls = c.pseudo ? cls : c.cls;
      if (!petCls) continue;
      const run: Runner = { cls: petCls, table: (tbl) => gd.classTable(petCls, tbl, level), ec: contextFor(petCls, cls), pet: true, mods: by.mods && copiesMods(src, c) };
      for (const [pn, pp] of powers) {
        if (!pp) continue;
        const r = totalDamage({ n: pn, eff: pp.eff, act: pp.act }, petTemplates(pn, pp, run.ec), run, depth + 1, execDepth);
        const ap = pp.ap ?? 0;
        const times = ap ? Math.max(1, Math.floor(Math.fround(Math.fround(c.dur ?? 0) / Math.fround(ap))) + plus) : 1;
        base += r.base * times;
        total += (c.boosts ? r.total : r.base) * times;
        boosted += (c.boosts ? r.boosted : r.bare) * times;
        bare += r.bare * times;
      }
    }
    return { base, total, boosted, bare };
  };

  const own: Runner = { cls: runCls, table: ownTable, ec: ctx, pet: false, mods: true };
  const { base: dmgBase, total: dmgTotal, boosted: dmgBoosted } = totalDamage(power, all, own, 0, 0);

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

  // the heal it gives its caster (the "heal ... on self" sentences), counted as getTotalDamage
  // counts damage: effects that need a condition left out, chances and ticks by expectedHits
  const HEAL = gd.attribByName.get('DamageType07') ?? 28;
  const healsCaster = (m: Mod) => m.tg === 'Caster' || (m.tg === 'Affected' && (power.ea ?? [power.tgt]).includes('Caster'));
  let healBase = 0;
  let healEnh = 0;
  for (const t of all) {
    if (!t.counted || t.attrib !== HEAL || ASPECT[t.m.asp] !== 'Abs' || !healsCaster(t.m)) continue;
    if (requiresNotes(t.reqs, true).length) continue;
    const { mag, dur } = magAndDur(own.table(t.m.tbl), t.m);
    if (!(mag > 0)) continue;
    const n = expectedHits(t, dur);
    healBase += mag * n;
    healEnh += mag * n * (1 + (t.m.fl?.includes('IgnoreStrength') ? 0 : eff(t.attrib)));
  }
  const numbers: PowerNumbers = {
    damage: { base: dmgBase, enh: dmgTotal },
    damageBoosted: dmgBoosted,
    heal: { base: healBase, enh: healEnh },
    recharge: { base: baseRech, enh: enhRech },
    endurance: { base: baseEnd, enh: enhEnd },
    accuracy: { base: baseAcc, enh: enhAcc },
    cast,
  };

  /**
   * @return A stat's bonus: its own enhancements' strength, when enhanced values show and they move it.
   */
  const bonusOf = (strength: number, enhV: number, baseV: number): number | undefined => (showBoth && strength && enhV !== baseV ? strength : undefined);

  const stats: InfoRow[] = [];
  const row = (label: string, markup: string, bonus?: number): InfoRow => (bonus === undefined ? { label, value: parseMarkup(markup) } : { label, value: parseMarkup(markup), bonus });
  /** "enh (base)" when they differ and enhanced values are shown, else the base. */
  const pair = (enhV: number, baseV: number, fmt: (n: number) => string, suffix = ''): string =>
    showBoth && enhV !== baseV ? `${fmt(enhV)}${suffix} (${fmt(baseV)}${suffix})` : `${fmt(showBoth ? enhV : baseV)}${suffix}`;

  // with the build's damage boosts the damage rows read the boosted damage in place of the
  // enhanced one: "boosted (base)"
  const dmgShown = boost ? dmgBoosted : dmgTotal;
  if (dmgBase) {
    // its bonus is read back from the damage: parts of it (a pet's) may take no enhancement
    stats.push(row(TXT.totalDamage, `<color #ff4b4b>${pair(dmgShown, dmgBase, f2)}`, bonusOf(dmgTotal / dmgBase - 1, dmgTotal, dmgBase)));
  }
  const timed = power.type !== 'Auto';
  if (timed && dmgBase && cast) {
    stats.push(row(TXT.damagePerAct, `<color #ff4b4b>${pair(dmgShown / cast, dmgBase / cast, f2)}`));
  }
  // a power with neither a cast time nor a recharge has no cycle to divide by (a pet's Self
  // Destruct): the row is left out, as the one above is for a power with no cast time
  if (timed && dmgBase && cast + baseRech > 0 && cast + enhRech > 0) {
    const dpc = dmgBase / (cast + baseRech);
    const dpcEnh = dmgShown / (cast + enhRech);
    stats.push(row(TXT.damagePerCast, `<color #ff4b4b>${pair(dpcEnh, dpc, f2)}`));
  }
  if (timed) {
    stats.push(row(TXT.activationTime, `<color #ffffff>${prettyDuration(cast)}`));
    stats.push(row(TXT.rechargeTime, `<color #ffffff>${pair(enhRech, baseRech, prettyDuration)}`, bonusOf(rechBoost, enhRech, baseRech)));
    if (baseEnd) {
      if (power.type === 'Toggle') {
        const ap = power.ap || 1;
        stats.push(row(TXT.enduranceCost, `<color #45bdff>${pair(enhEnd / ap, baseEnd / ap, f2, '/s')}`, bonusOf(eff(O['EnduranceDiscount']), enhEnd, baseEnd)));
      } else {
        stats.push(row(TXT.enduranceCost, `<color #45bdff>${pair(enhEnd, baseEnd, f2)}`, bonusOf(eff(O['EnduranceDiscount']), enhEnd, baseEnd)));
      }
    }
  }
  if (baseAcc) stats.push(row(TXT.accuracy, `<color #ffed61>${pair(enhAcc, baseAcc, f2, 'X')}`, bonusOf(eff(O['Accuracy']), enhAcc, baseAcc)));
  if (baseInt) stats.push(row(TXT.interruptTime, `<color #ffffff>${pair(enhInt, baseInt, prettyDuration)}`, bonusOf(eff(O['InterruptTime']), enhInt, baseInt)));
  const ref = gd.setOfPower.get(power.id);
  const av = ref?.set.av[ref.index] ?? 0;
  if (av > 0) stats.push(row(TXT.availableLevel, `<color #ffffff>${av + 1}`));

  // ---- target info (power_AddTargetInfo) ----
  const target: InfoRow[] = [];
  target.push(row(TXT.powerType, `<color #ffffff>${POWER_TYPE[power.type] ?? 'Unknown'}`));
  target.push(row(TXT.targetType, `<color #ffffff>${TARGET_TYPE[power.tgt] ?? 'Unknown'}`));
  if (power.rng) {
    const enhRng = power.rng * (1 + eff(O['Range']));
    target.push(row(TXT.powerRange, `<color #ffffff>${pair(enhRng, power.rng, f2, ' ft.')}`, bonusOf(eff(O['Range']), enhRng, power.rng)));
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
      return attrName(o) ?? String(o);
    });
    target.push(row(TXT.attackTypes, `<color #ffffff>${names.join(', ')}`));
  }
  // the "Aggro Type" row (AIReport), from the version's info file
  const aggro = gd.info?.aggro[power.n];
  if (aggro) target.push(row(gd.info?.text.AggroReport ?? 'Aggro Type:', `<color #ffffff>${aggro}`));

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
   * @param mods Its runner takes the character's damage strength: with the build's boosts, its
   *   damage lines read the boosted value in place of the enhanced one (strengthWith).
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
    mods: boolean,
  ): void => {
    petLines(name, cls, both, depth, out, mods);
    const groups = markAllTypes(tmpls, O);
    // the power's own notes came from the info file (none until it arrives, or where its groups differ)
    const noted = !!gd.info?.notes[name];
    for (const t of tmpls) {
      const m = t.m;
      const offset = t.attrib;
      const eType = ASPECT[m.asp];
      if (!eType) continue;
      if (t.hide) continue;
      if (!t.chance && t.tags.length && !t.mode) continue; // the client skips only a tagged group of chance 0
      if (pet && m.tg === 'Caster') continue; // the client doesn't list what a pet does to itself
      if (!pet && depth === 0 && runAs?.omit?.(m, offset)) continue;

      if (offset === 481 || offset === 486 || offset === (gd.attribByName.get('GrantPower') ?? 481) || offset === (gd.attribByName.get('GrantBoostedPower') ?? 486)) {
        // a pet's grant is named; one the version's own data lacks has its name in the pets file
        const pn = m.pwn?.[0];
        // the client lists a grant only when the granted power shows in the inventory (info file)
        const granted = m.pw?.[0] !== undefined ? gd.powerById.get(m.pw[0])?.n : pn;
        if (granted && hiddenGrants.has(granted.toLowerCase())) continue;
        const dn =
          m.pw?.[0] !== undefined
            ? gd.powerById.get(m.pw[0])?.dn
            : pn !== undefined
              ? (gd.powerByName.get(pn.toLowerCase())?.dn ?? gd.pets?.names?.[pn] ?? gd.henchmen?.powers[pn]?.dn)
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
      // damage dealt only (a negative magnitude): a heal is a damage type too, and takes no damage boost
      const dmgLine = isDamageOff(offset) && eType === 'Abs' && fMag < 0;
      const boosted = !both ? 0 : dmgLine ? strengthWith(t, mods, eff(offset)) - 1 : eff(offset);
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
      // "all damage" / "all defense" (markAllTypes): a group's first type reads "all", the rest of
      // its kind for the same target and aspect are left out
      let allKind: AllKind['name'] | null = null;
      const kind = ALL_KINDS.find((k) => k.has(offset, O));
      const st = kind && groups.get(allKey(m, kind));
      if (kind && st && st.flag > 1) {
        if (++st.shown >= kind.count && --st.sets > 0) {
          st.flag = 1;
          st.shown = 0;
        }
        continue;
      }
      if (kind && st && st.flag === 1) {
        st.flag++;
        st.shown++;
        allKind = kind.name;
      }
      let iTicks = 0;
      if (isDamageOff(offset) && eType === 'Abs') {
        if (pet && pet.dur && ap) iTicks = Math.floor(Math.fround(Math.fround(pet.dur) / Math.fround(ap))) + 1;
        else if (fDuration) iTicks = tickCount(fDuration, m.per);
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
      if (isDamageOff(offset)) {
        if (eType === 'Str') pchType = `strength to ${allKind ? 'all damage' : attr}`;
        else if (eType === 'Cur') pchType = allKind ? 'all damage' : attr;
        else if (eType === 'Res') pchType = `resistance to ${allKind ? 'all damage' : attr}`;
        else if (eType === 'Abs') pchType = offset === 28 ? 'heal' : attr;
        else pchType = attr;
      } else if (offset >= (O['DefenseType00'] ?? 104) && offset < (O['Defense'] ?? 184)) {
        const defName = allKind ? 'all defense' : attr;
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

      // whether the line prints an enhanced value apart from its base
      let moved = false;
      const value = attribValueMarkup(O, eType, m, offset, fMag, boosted, both, pchMag, (enhV, baseV) => {
        if (enhV !== baseV) moved = true;
      });

      let pchTail = '';
      if (iTicks > 1) {
        pchTail = TXT.overTime.replace('{duration}', prettyDuration(shownDur));
      } else if ((pet || type === 'Click') && shownDur) {
        if (both && eType === 'Cur' && isStatus(offset)) {
          // boosted hold effects lengthen the duration instead of the magnitude
          pchTail =
            TXT.forDurationBoosted.replace('{boostedDuration}', prettyDuration(shownDur * (1 + boosted))) +
            `(${prettyDuration(shownDur)})<color #aaaaaa>`;
          if (boosted) moved = true;
        } else pchTail = TXT.forDuration.replace('{duration}', prettyDuration(shownDur));
      }
      const pchTarget = m.tg === 'Caster' ? TXT.onSelf : TXT.onTarget;
      const pchDelay = t.delay ? TXT.afterDelay.replace('{sec}', prettyDuration(t.delay)) : '';

      const line = parseMarkup(pchChance + pchTicks + pchChance2 + value + pchType + pchTail + pchTarget + pchDelay);
      // the power's own enhancements behind the value: a damage line's `boosted` counts the build's boosts too
      const own = dmgLine ? eff(offset) : boosted;
      // the sentence starts in the default (white) color unless the markup says otherwise
      const notes: Seg[][] = [];
      const note = (txt: string) => notes.push([{ text: txt, color: NOTE_COLOR, italic: true }]);
      // the client's order: the tag mode, the requirement notes, the effect's own note, the flags
      if (t.mode) note(t.mode);
      if (t.tags.includes('Overpower') && !noted) note('Overpower'); // else the effect's own note says it, as in game
      for (const n of requiresNotes(t.reqs, false, friendNotes)) note(n);
      if (t.info) notes.push(parseMarkup(t.info, NOTE_COLOR).map((g) => ({ ...g, italic: true })));
      const flagNotes = !runAs?.noFlagNotes;
      if (flagNotes && m.fl?.includes('IgnoreStrength')) note(gd.info?.text.IgnoresBuffsAndEnhancements ?? TXT.ignoresBuffs);
      if (flagNotes && m.fl?.includes('IgnoreResistance')) note(gd.info?.text.Unresistable ?? TXT.unresistable);
      out.push(moved && own ? { line, notes, bonus: own } : { line, notes });
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
   * @param mods The creating power's runner takes the character's damage strength.
   */
  const petLines = (name: string, cls: string, both: boolean, depth: number, out: InfoEffect[], mods: boolean): void => {
    if (depth >= MAX_PET_DEPTH) return;
    const src = name === power.n ? power : (petPower(name) ?? {});
    for (const c of creationsOf(name)) {
      if (c.hid) continue;
      const powers = c.p.map((pn) => [pn, petPower(pn)] as const);
      if (powers.some(([, pp]) => pp && pp.type !== 'Auto')) continue;
      const petCls = c.pseudo ? cls : c.cls;
      if (!petCls) continue;
      const pctx = contextFor(petCls, cls);
      powers.forEach(([pn, pp], i) => {
        if (!pp) return;
        const shown = both && (i < (c.def ?? 0) || !!c.boosts);
        const table = (tbl: string) => gd.classTable(petCls, tbl, level);
        effectLines(pn, petTemplates(pn, pp, pctx), pp.type, pp.ap ?? 0, table, petCls, shown, { dur: c.dur ?? 0 }, depth + 1, out, mods && copiesMods(src, c));
      });
    }
  };

  effectLines(power.n, all, power.type, power.ap ?? 0, ownTable, runCls, showBoth, null, 0, effects, /*mods=*/ true);

  const title = parseMarkup(
    TXT.title
      .replace('{PowerName}', power.dn)
      .replace('{level}', String(level + 1))
      .replace('{className}', at.dn),
  );
  return { title, stats, target, effects, numbers };
}
