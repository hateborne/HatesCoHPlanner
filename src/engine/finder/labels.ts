/**
 * Words for the set finder's figures: a stat's name, an amount in the stat's unit, and a warning
 * as a sentence. Pure text, no markup; the screens decide how it is drawn.
 */
import type { GameData } from '../../data/gamedata.ts';
import type { Power } from '../../data/types.ts';
import { enhKind, pieceName } from '../enhance.ts';
import { MEZ } from '../totals.ts';
import { familyOf } from './goals.ts';
import type { Aspect, Role } from './roles.ts';
import type { Warning } from './warnings.ts';

// the totals lines that are one stat each
const SINGLE: Record<string, string> = {
  rech: 'Recharge',
  acc: 'Accuracy',
  endrdx: 'Endurance Reduction',
  range: 'Range',
  heal: 'Healing',
  hp: 'Max HP',
  endmax: 'Max Endurance',
  regen: 'Regeneration',
  recov: 'Recovery',
  tohit: 'ToHit',
  absorb: 'Absorb',
  enduse: 'End use',
  run: 'Run Speed',
  fly: 'Fly Speed',
  jumpspd: 'Jump Speed',
  jumph: 'Jump Height',
  stealth: 'Stealth',
  perc: 'Perception',
};

// what a debuff resistance resists, as the totals pane names it
const DEBUFF: Record<string, string> = {
  RechargeTime: 'Recharge',
  SpeedRunning: 'Run Speed',
  SpeedFlying: 'Fly Speed',
  SpeedJumping: 'Jump Speed',
  JumpHeight: 'Jump Height',
  PerceptionRadius: 'Perception',
  ToHit: 'ToHit',
};

/**
 * A stat key in words.
 *
 * @param gd Game data (damage and defense type names).
 * @param key The totals line key.
 * @return "Smashing (Dmg Res)", "Ranged (Def)", "Knockback (Status Prot)", "Run Speed (Debuff Res)", "Recharge".
 */
export function statLabel(gd: GameData, key: string): string {
  const [fam, rest = ''] = key.split('.');
  const named = (list: { dn: string }[]) => (list[Number(rest)]?.dn ?? rest).replace(/_/g, ' ');
  switch (fam) {
    case 'def':
      return `${named(gd.core.attribNames.Defense)} (Def)`;
    case 'res':
      return `${named(gd.core.attribNames.Damage)} (Dmg Res)`;
    case 'dmg':
      return `${named(gd.core.attribNames.Damage)} Damage`;
    case 'mezprot':
      return `${MEZ[rest] ?? rest} (Status Prot)`;
    case 'mezres':
      return `${MEZ[rest] ?? rest} (Status Res)`;
    case 'resx':
      // an attribute with no name here is its own name in words ("DefenseType03" stays as it is)
      return `${DEBUFF[rest] ?? rest.replace(/([a-z])([A-Z])/g, '$1 $2')} (Debuff Res)`;
    case 'max':
      return `${SINGLE[rest] ?? rest} cap`;
    default:
      return SINGLE[key] ?? key;
  }
}

// stats the totals keep as plain amounts (hit points, endurance, protection magnitude, feet)
const PLAIN = new Set(['hp', 'endmax', 'absorb', 'stealth', 'enduse', 'perc']);

/**
 * An amount in a stat's own unit, as the totals show that stat.
 *
 * @param key The totals line key.
 * @param value The amount (fractions for percentages: 0.075 = 7.5%).
 * @param signed Whether to put a plus sign on a gain.
 * @return "7.5%", "+30.1", "-4.00".
 */
export function statAmount(key: string, value: number, signed = false): string {
  const plain = PLAIN.has(key) || familyOf(key) === 'mezprot';
  const v = plain ? value : value * 100;
  const text = Math.abs(v) >= 10 ? v.toFixed(1) : v.toFixed(2);
  return `${signed && value > 0 ? '+' : ''}${text}${plain ? '' : '%'}`;
}

const ROLE_OUTPUT: Record<Role, string> = { st: 'damage', aoe: 'damage', heal: 'healing', ctrl: 'control duration', other: 'effect' };
const ROLE_NAME: Record<Role, string> = { st: 'single-target attack', aoe: 'area attack', heal: 'self heal', ctrl: 'control', other: 'power of its kind' };
const ASPECT_NAME: Record<Exclude<Aspect, 'out'>, string> = { acc: 'accuracy', rech: 'recharge', end: 'endurance reduction' };

/**
 * A warning as a sentence for the player.
 *
 * @param gd Game data (names).
 * @param w The warning.
 * @return The sentence, without the power's name (the screen shows the swap it belongs to).
 */
export function warningText(gd: GameData, w: Warning): string {
  switch (w.kind) {
    case 'needDropped':
      return `${statLabel(gd, w.stat)} falls from ${statAmount(w.stat, w.before)} to ${statAmount(w.stat, w.after)}, below the ${statAmount(w.stat, w.typical)} suggested for this build.`;
    case 'crippled': {
      const what = w.aspect === 'out' ? ROLE_OUTPUT[w.role] : ASPECT_NAME[w.aspect];
      const only = w.only ? ` It is the build's only ${ROLE_NAME[w.role]}.` : '';
      return `This power loses ${Math.round(w.lost * 100)}% of its ${what}.${only}`;
    }
    case 'globalLost':
      return `Takes out ${gd.powerById.get(w.boost)?.dn ?? 'a unique piece'} and the effect it has on its own.`;
    case 'procLost':
      return `Takes out ${gd.powerById.get(w.boost)?.dn ?? 'a proc'}. The planner has no numbers for this proc, so its worth is a guess.`;
    case 'overFive':
      return `The build already counts ${gd.powerById.get(w.bonus)?.dn ?? 'this bonus'} five times, so this copy adds nothing.`;
    case 'capLost':
      return familyOf(w.stat) === 'def' ? `${statLabel(gd, w.stat)} drops below the 45% soft cap.` : `${statLabel(gd, w.stat)} drops below its cap.`;
  }
}

// what an enhancement enhances, in short: the parts of a piece's name ("Accuracy/Damage")
const SHORT: Record<string, string> = {
  Accuracy: 'Acc',
  Damage: 'Dmg',
  Recharge: 'Rech',
  'Recharge Reduction': 'Rech',
  'Recharge Time': 'Rech',
  Endurance: 'End Cost',
  'Endurance Reduction': 'End Cost',
  'Endurance Modification': 'EndMod',
  Healing: 'Heal',
  Defense: 'Def',
  'Defense Buff': 'Def',
  Resistance: 'Res',
  'Resist Damage': 'Res',
  'Defense Debuff': 'Def Debuff',
  'Defense DeBuff': 'Def Debuff',
  'To Hit Buff': 'ToHit',
  'ToHit Buff': 'ToHit',
  'To Hit Debuff': 'ToHit Debuff',
  'ToHit DeBuff': 'ToHit Debuff',
  Immobilize: 'Immob',
  Immobilisation: 'Immob',
  Interrupt: 'Int',
  Knockback: 'KB',
  Confusion: 'Confuse',
  Disorient: 'Stun',
};

// what stands for the kind of an enhancement that belongs to no set; a kind with no short form
// (event and special pieces) is named by the piece alone
const KIND: Record<string, string> = { Invention: 'IO', Origin: 'SO', Training: 'TO', Hamidon: 'HO' };

/**
 * An enhancement's name cut down to what it enhances, in short.
 *
 * @param name The name without its set or kind in front ("Accuracy/Damage/Endurance").
 * @return "Acc/Dmg/End Cost"; a part with no short form stays as it is ("Chance for Smashing Damage").
 */
export function shortPiece(name: string): string {
  return name
    .split('/')
    .map((part) => {
      // "Recharge (Tanker)" and "Hold Duration" are Recharge and Hold
      const bare = part
        .trim()
        .replace(/ \([^)]*\)$/, '')
        .replace(/ (Duration|Bonus)$/, '');
      return SHORT[bare] ?? bare;
    })
    .join('/');
}

/** @return What an enhancement of no set enhances, from its name: after "Invention: ", or between the brackets of an origin's. */
function plainName(b: Power): string {
  const bracket = /\(([^)]+)\)\s*$/.exec(b.dn);
  if (bracket) return bracket[1]!;
  const i = b.dn.lastIndexOf(': ');
  return i >= 0 ? b.dn.slice(i + 2).trim() : b.dn;
}

/**
 * The enhancements a swap takes out, in a few short lines.
 *
 * 1. Every piece of a set: the set and its count, "Crushing Impact: 6/6".
 * 2. Two or more pieces of a set, not all of them: the set and the pieces in short, a line each,
 *    "Power Transfer: EndMod, Dmg/Rech".
 * 3. Everything else (one piece of a set, enhancements of no set) on one last line,
 *    "IO: Rech, IO: Acc, Lockdown: Acc/Rech".
 *
 * @param gd Game data (names, sets).
 * @param ids The enhancements' ids, in slot order.
 * @return The lines, whole sets first.
 */
export function replacedLines(gd: GameData, ids: readonly number[]): string[] {
  const bySet = new Map<number, { name: string; size: number; pieces: string[] }>();
  for (const id of ids) {
    const b = gd.powerById.get(id);
    const ref = b ? gd.boostSetOf.get(id) : undefined;
    if (!b || !ref) continue;
    const cur = bySet.get(ref.set.id) ?? { name: ref.set.dn, size: ref.set.slots.length, pieces: [] };
    cur.pieces.push(shortPiece(pieceName(b, ref.set.dn)));
    bySet.set(ref.set.id, cur);
  }
  const whole: string[] = [];
  const part: string[] = [];
  for (const g of bySet.values()) {
    if (g.pieces.length >= g.size) whole.push(`${g.name}: ${g.pieces.length}/${g.size}`);
    else if (g.pieces.length > 1) part.push(`${g.name}: ${g.pieces.join(', ')}`);
  }
  // the rest in slot order: a set's only piece, and the enhancements of no set
  const last: string[] = [];
  for (const id of ids) {
    const b = gd.powerById.get(id);
    const ref = b ? gd.boostSetOf.get(id) : undefined;
    if (!b) last.push('an enhancement');
    else if (!ref) {
      const kind = KIND[enhKind(gd, b)];
      last.push(kind ? `${kind}: ${shortPiece(plainName(b))}` : b.dn);
    }
    else if (bySet.get(ref.set.id)!.pieces.length === 1) last.push(`${ref.set.dn}: ${shortPiece(pieceName(b, ref.set.dn))}`);
  }
  return [...whole, ...part, ...(last.length ? [last.join(', ')] : [])];
}
