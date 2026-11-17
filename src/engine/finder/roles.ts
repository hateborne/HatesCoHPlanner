/**
 * What a power is for, read from the game data: the enhancement types it accepts (the designers'
 * own list of what its slots can improve) and what its effects do. The finder uses it to tell
 * what a power would lose or gain from other enhancements in its slots.
 */
import type { GameData } from '../../data/gamedata.ts';
import type { Effect, Mod, Power } from '../../data/types.ts';
import { ORIGIN_COUNT } from '../enhance.ts';

/**
 * A power's job: a single-target attack, an area attack, a heal for its own user, a control
 * (hold, stun, sleep, immobilize, confuse, fear), or anything else (buffs, debuffs, armor, travel).
 */
export type Role = 'st' | 'aoe' | 'heal' | 'ctrl' | 'other';

/** What enhancements can improve about a power in one of its roles. */
export type Aspect = 'out' | 'acc' | 'rech' | 'end';

/** One role of a power. */
export interface PowerRole {
  role: Role; // the job
  out: number[]; // attribute offsets whose enhancement strength is this role's output (damage, heal, hold duration)
}

/** A power's roles and the general aspects its slots can improve. */
export interface PowerRoles {
  roles: PowerRole[]; // an attack that also holds has two
  onSelf: boolean; // its effects land on its own user (a self buff, an aura that includes the caster)
  acc: boolean; // takes accuracy enhancements
  rech: boolean; // a click that takes recharge enhancements and has a recharge time
  end: boolean; // takes endurance reduction and has a cost
}

// enhancement type -> the status attribute whose duration it lengthens
const MEZ_OF_BOOST: Record<string, string> = {
  Hold_Boost: 'Held',
  Stunned_Boost: 'Stunned',
  Sleep_Boost: 'Sleep',
  Immobilized_Boost: 'Immobilized',
  Confuse_Boost: 'Confused',
  Fear_Boost: 'Terrorized',
};

// enhancement type -> an attribute its pieces strengthen, for the types no role above claims
// (uiCombineSpec.c boostLines pairs them the same way; see BOOST_LINES in enhance.ts)
const ATTRIB_OF_BOOST: Record<string, string> = {
  Buff_Defense_Boost: 'Defense',
  Debuff_Defense_Boost: 'Defense',
  Buff_ToHit_Boost: 'ToHit',
  Debuff_ToHit_Boost: 'ToHit',
  Res_Damage_Boost: 'DamageType00',
  Heal_Boost: 'DamageType07',
  Recovery_Boost: 'Recovery',
  Endurance_Drain_Boost: 'Endurance',
  SpeedRunning_Boost: 'SpeedRunning',
  SpeedFlying_Boost: 'SpeedFlying',
  Jump_Boost: 'SpeedJumping',
  Slow_Boost: 'SpeedRunning',
  Taunt_Boost: 'Taunt',
  Knockback_Boost: 'Knock',
  Range_Boost: 'Range',
  Intangible_Boost: 'Intangible',
};

const AREAS = new Set(['Sphere', 'Cone', 'Location', 'Chain']);

/** @return The first mod of a power's effects (sub effects included) that passes a test. */
function findMod(p: Power, test: (m: Mod) => boolean): Mod | undefined {
  const walk = (effs: Effect[] | undefined): Mod | undefined => {
    for (const e of effs ?? []) {
      const hit = (e.m ?? []).find(test) ?? walk(e.sub);
      if (hit) return hit;
    }
    return undefined;
  };
  return walk(p.eff) ?? walk(p.act);
}

/** @return The names of the enhancement types a power accepts ("Damage_Boost", "Accuracy_Boost"). */
export function boostTypes(gd: GameData, p: Power): Set<string> {
  const out = new Set<string>();
  for (const v of p.ba ?? []) {
    const n = v >= ORIGIN_COUNT ? gd.core.attribNames.Boost[v - ORIGIN_COUNT]?.n : undefined;
    if (n) out.add(n);
  }
  return out;
}

/**
 * Whether a power heals its own user when clicked (Healing Flames, Reconstruction, Aid Self): a
 * click with a heal (the Healing damage type as an absolute change) that lands on the caster.
 *
 * @param gd Game data.
 * @param p The power.
 * @return True for a self heal.
 */
export function isSelfHeal(gd: GameData, p: Power): boolean {
  if (p.type !== 'Click') return false;
  const heal = gd.attribByName.get('DamageType07');
  if (heal === undefined) return false;
  const onCaster = (m: Mod) => m.tg === 'Caster' || (m.tg === 'Affected' && (p.ea ?? [p.tgt]).includes('Caster'));
  return !!findMod(p, (m) => m.asp === 'Absolute' && m.a.includes(heal) && onCaster(m));
}

/**
 * A power's roles.
 *
 * 1. Attack: it accepts damage enhancements. An area attack has an area (sphere, cone, location,
 *    chain) or more than one target; any other is single-target. Its output is the strength of the
 *    damage type it deals.
 * 2. Heal: a self heal (isSelfHeal) that accepts heal enhancements.
 * 3. Control: it accepts hold, stun, sleep, immobilize, confuse or fear enhancements; its output is
 *    those durations.
 * 4. Anything else has the role 'other', with the remaining types it accepts as its output.
 *
 * @param gd Game data.
 * @param p The power.
 * @return Its roles and general aspects.
 */
export function rolesOf(gd: GameData, p: Power): PowerRoles {
  const types = boostTypes(gd, p);
  const attr = (name: string) => gd.attribByName.get(name);
  const roles: PowerRole[] = [];

  if (types.has('Damage_Boost')) {
    const heal = attr('DamageType07');
    const first = attr('DamageType00') ?? 0;
    const hp = attr('HitPoints') ?? 80;
    // the damage types sit before HitPoints in the attribute list
    const dealt = findMod(p, (m) => m.asp === 'Absolute' && m.tg !== 'Caster' && m.a.some((a) => a >= first && a < hp && a !== heal));
    const out = dealt ? dealt.a.filter((a) => a >= first && a < hp && a !== heal).slice(0, 1) : [first];
    roles.push({ role: AREAS.has(p.area ?? '') || (p.maxT ?? 1) > 1 ? 'aoe' : 'st', out });
  }
  if (types.has('Heal_Boost') && isSelfHeal(gd, p)) roles.push({ role: 'heal', out: [attr('DamageType07') ?? 28] });
  const mez = Object.entries(MEZ_OF_BOOST)
    .filter(([type]) => types.has(type))
    .map(([, name]) => attr(name))
    .filter((a): a is number => a !== undefined);
  if (mez.length) roles.push({ role: 'ctrl', out: mez });
  if (!roles.length) {
    const out = new Set<number>();
    for (const [type, name] of Object.entries(ATTRIB_OF_BOOST)) {
      const a = types.has(type) ? attr(name) : undefined;
      if (a !== undefined) out.add(a);
    }
    roles.push({ role: 'other', out: [...out] });
  }
  return {
    roles,
    onSelf: (p.ea ?? [p.tgt]).includes('Caster'),
    acc: types.has('Accuracy_Boost'),
    // a toggle or auto power recharges once and then stays on: its recharge is not worth a slot
    rech: p.type === 'Click' && types.has('Recharge_Boost') && (p.rech ?? 0) > 0,
    end: types.has('EnduranceDiscount_Boost') && (p.end ?? 0) > 0,
  };
}
