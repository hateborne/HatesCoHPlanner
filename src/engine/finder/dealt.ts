/**
 * The damage types a build's own powers deal, so the gains and losses can set the others aside.
 */
import type { GameData } from '../../data/gamedata.ts';
import type { Effect, Power } from '../../data/types.ts';
import type { BuildRules } from '../rules.ts';

// how deep pets, executed powers and redirects are followed (a pet's power that runs another)
const MAX_DEPTH = 4;

/** What the walk reads of a power: a build's power, a pseudo-pet's or a real pet's. */
type Walked = Pick<Power, 'eff' | 'act' | 'redir'>;

/**
 * The damage types the powers of a build deal.
 *
 * A power counts for a type when one of its effects takes hit points of that type from someone
 * other than its user: its own effects, those of the powers it executes, those of the powers it
 * redirects to (a Titan Weapons attack is two powers, the slow one and the one with momentum; a
 * snipe has a quick form), and those of the pets it makes, pseudo-pets (Burn's patch) and real
 * ones (a Mastermind's henchmen). The archetype's inherent powers (Brawl) and the enhancements
 * in the slots (procs) do not count.
 *
 * Every pet counts, whether or not it takes its maker's damage bonuses: counting too much only
 * leaves a bonus out of the Unused Damage row, counting too little would call a bonus unused that
 * is not.
 *
 * A pet's damage is in files the app loads apart and never waits for (the pets file, and the
 * real pets file, fetched only for a build that may make one): a build with a power that makes a
 * pet whose powers are not at hand has no answer, so nothing is called unused on a guess. A power
 * may make a real pet when it has more EntCreate mods than the pets file lists pseudo-pets for it
 * (makesPets reads it the same way).
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
  /** @return How many pets these groups make (their EntCreate mods). */
  const walk = (effs: Effect[] | undefined, depth: number): number => {
    let made = 0;
    for (const e of effs ?? []) {
      for (const m of e.m ?? []) {
        if (m.a.includes(create)) made++;
        if (m.asp === 'Absolute' && m.tg !== 'Caster') for (const a of m.a) if (a >= first && a < hp && a !== heal) out.add((a - first) / 4);
        for (const id of m.pw ?? []) {
          const p = gd.powerById.get(id);
          if (p) power(p.n, p, depth + 1);
        }
        for (const n of m.pwn ?? []) {
          const p = gd.pets?.powers[n] ?? gd.powerByName.get(n.toLowerCase()) ?? gd.henchmen?.powers[n];
          if (p) power(n, p, depth + 1);
        }
      }
      made += walk(e.sub, depth);
    }
    return made;
  };
  const power = (name: string, p: Walked, depth: number): void => {
    if (depth > MAX_DEPTH || seen.has(name)) return;
    seen.add(name);
    const made = walk(p.eff, depth) + walk(p.act, depth);
    // the power stands for the ones it redirects to: the game runs one of them in its place
    for (const r of p.redir ?? []) {
      const to = gd.powerById.get(r.p);
      if (to) power(to.n, to, depth + 1);
    }
    const run = (names: readonly string[]) => {
      for (const n of names) {
        const q = gd.pets?.powers[n] ?? gd.henchmen?.powers[n];
        if (q) power(n, q, depth + 1);
        else unread = true;
      }
    };
    const pseudo = gd.pets?.pets[name] ?? gd.henchmen?.pseudo?.[name] ?? [];
    for (const c of pseudo) run(c.p);
    if (made <= pseudo.length) return;
    // the rest are real pets: their own powers, from the real pets file
    const real = gd.henchmen?.makes[name];
    if (!real?.length) unread = true;
    for (const m of real ?? []) {
      const kind = gd.henchmen?.pets[m.pet];
      if (kind) run(kind.p);
      else unread = true;
    }
  };
  const last = rules.lastLevel();
  for (const e of rules.entries()) {
    if (e.level > last || e.inherent || e.power.n.startsWith('Inherent.')) continue;
    power(e.power.n, e.power, 0);
  }
  return unread ? null : out;
}
