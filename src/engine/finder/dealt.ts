/**
 * The damage types a build's own powers deal, so the gains and losses can set the others aside.
 */
import type { GameData } from '../../data/gamedata.ts';
import type { Effect } from '../../data/types.ts';
import type { BuildRules } from '../rules.ts';

// how deep pets and executed powers are followed (a pet's power that runs another)
const MAX_DEPTH = 4;

/**
 * The damage types the powers of a build deal.
 *
 * A power counts for a type when one of its effects takes hit points of that type from someone
 * other than its user: its own effects, those of the powers it executes, and those of the
 * pseudo-pets it makes (Burn's patch). The archetype's inherent powers (Brawl) and the
 * enhancements in the slots (procs) do not count.
 *
 * A pet's damage is in files the app loads apart and never waits for (the pets and henchmen
 * files), and the planner reads no real pet's attacks here: a build with a power that makes a
 * pet whose powers are not at hand has no answer, so nothing is called unused on a guess.
 *
 * @param gd Game data.
 * @param rules Rules of the build.
 * @return The damage type indexes (into the damage type names), or null when a pet's damage can't be read.
 */
export function damageTypesDealt(gd: GameData, rules: BuildRules): Set<number> | null {
  const first = gd.attribByName.get('DamageType00') ?? 0;
  const hp = gd.attribByName.get('HitPoints') ?? 80;
  const heal = gd.attribByName.get('DamageType07');
  const create = gd.attribByName.get('EntCreate') ?? 469;
  const out = new Set<number>();
  const seen = new Set<string>();
  let unread = false; // a power makes a pet whose powers are not at hand
  /** @return Whether any of these groups makes a pet. */
  const walk = (effs: Effect[] | undefined, depth: number): boolean => {
    let makes = false;
    for (const e of effs ?? []) {
      for (const m of e.m ?? []) {
        if (m.a.includes(create)) makes = true;
        if (m.asp === 'Absolute' && m.tg !== 'Caster') for (const a of m.a) if (a >= first && a < hp && a !== heal) out.add((a - first) / 4);
        for (const id of m.pw ?? []) {
          const p = gd.powerById.get(id);
          if (p) power(p.n, p.eff, p.act, depth + 1);
        }
        for (const n of m.pwn ?? []) {
          const p = gd.pets?.powers[n] ?? gd.powerByName.get(n.toLowerCase()) ?? gd.henchmen?.powers[n];
          if (p) power(n, p.eff, p.act, depth + 1);
        }
      }
      if (walk(e.sub, depth)) makes = true;
    }
    return makes;
  };
  const power = (name: string, eff: Effect[] | undefined, act: Effect[] | undefined, depth: number): void => {
    if (depth > MAX_DEPTH || seen.has(name)) return;
    seen.add(name);
    const makes = [walk(eff, depth), walk(act, depth)].some(Boolean);
    const pets = gd.pets?.pets[name] ?? gd.henchmen?.pseudo?.[name] ?? [];
    if (makes && !pets.length) unread = true;
    for (const c of pets) {
      for (const n of c.p) {
        const p = gd.pets?.powers[n] ?? gd.henchmen?.powers[n];
        if (p) power(n, p.eff, p.act, depth + 1);
        else unread = true;
      }
    }
  };
  const last = rules.lastLevel();
  for (const e of rules.entries()) {
    if (e.level > last || e.inherent || e.power.n.startsWith('Inherent.')) continue;
    power(e.power.n, e.power.eff, e.power.act, 0);
  }
  return unread ? null : out;
}
