/**
 * Words for the set finder's figures: a stat's name, an amount in the stat's unit, and a warning
 * as a sentence. Pure text, no markup; the screens decide how it is drawn.
 */
import type { GameData } from '../../data/gamedata.ts';
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

/**
 * A stat key in words.
 *
 * @param gd Game data (damage and defense type names).
 * @param key The totals line key.
 * @return "Smashing (Res)", "Ranged (Def)", "Knockback (Prot)", "Recharge".
 */
export function statLabel(gd: GameData, key: string): string {
  const [fam, rest = ''] = key.split('.');
  const named = (list: { dn: string }[]) => (list[Number(rest)]?.dn ?? rest).replace(/_/g, ' ');
  switch (fam) {
    case 'def':
      return `${named(gd.core.attribNames.Defense)} (Def)`;
    case 'res':
      return `${named(gd.core.attribNames.Damage)} (Res)`;
    case 'dmg':
      return `${named(gd.core.attribNames.Damage)} Damage`;
    case 'mezprot':
      return `${MEZ[rest] ?? rest} (Prot)`;
    case 'mezres':
      return `${MEZ[rest] ?? rest} (Res)`;
    case 'resx':
      return `${rest} (Res)`;
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
      return `${statLabel(gd, w.stat)} falls from ${statAmount(w.stat, w.before)} to ${statAmount(w.stat, w.after)}; builds like this one usually hold ${statAmount(w.stat, w.typical)}.`;
    case 'crippled': {
      const what = w.aspect === 'out' ? ROLE_OUTPUT[w.role] : ASPECT_NAME[w.aspect];
      const only = w.only ? ` It is the build's only ${ROLE_NAME[w.role]}.` : '';
      return `This power loses ${Math.round(w.lost * 100)}% of its ${what}.${only}`;
    }
    case 'globalLost':
      return `Takes out ${gd.powerById.get(w.boost)?.dn ?? 'a unique piece'} and the effect it has on its own.`;
    case 'procLost':
      return `Takes out ${gd.powerById.get(w.boost)?.dn ?? 'a proc'}. The planner has no numbers for procs, so its worth is a guess.`;
    case 'overFive':
      return `The build already counts ${gd.powerById.get(w.bonus)?.dn ?? 'this bonus'} five times, so this copy adds nothing.`;
    case 'overCap':
      return `${statLabel(gd, w.stat)} is at its cap: part of this gain is lost.`;
  }
}
