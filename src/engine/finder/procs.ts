/**
 * Damage procs: how often a slotted proc fires in the power that holds it, and what that is worth
 * a minute. The chance is the game's own (CalculateModChance, MapServer character_combat.c); the
 * rate assumes the power is used every time it is ready.
 */
import type { GameData } from '../../data/gamedata.ts';
import type { Archetype, Effect, Power } from '../../data/types.ts';
import type { Slot } from '../build.ts';
import type { SlottedNumbers } from './powerNumbers.ts';

// the least and the most a PPM proc's chance can be: 5% plus 1.5% per PPM, and 90%
const CHANCE_FLOOR = 0.05;
const CHANCE_FLOOR_PER_PPM = 0.015;
const CHANCE_CEILING = 0.9;
// a boost's own ActivatePeriod where the data has none: every enhancement's is 10 seconds
const BOOST_PERIOD = 10;
// the shortest cycle a click power is taken to have, in seconds: a power with no recharge and no
// cast time in the data would otherwise be used without end. The planner's own floor, not the
// game's (docs/game-rules.md, "Procs per minute")
const MIN_CYCLE = 0.5;

/**
 * The area factor a proc's chance is divided by: basepower_CalculateAreaFactor (powers.c), then
 * the x 0.75 + 0.25 CalculateModChance puts on it.
 *
 * @TODO the game gives 1 to a power with UseNonBoostTemplatesOnMainTarget; the data does not carry that flag.
 *
 * @param p The power the proc is slotted in.
 * @return 1 for a single-target power, more for a sphere or a cone.
 */
export function areaFactor(p: Power): number {
  const radius = p.rad ?? 0;
  let base = 1;
  if (p.area === 'Sphere') base = 1 + radius * 0.15;
  // the arc is in radians in the data; the game's formula reads degrees
  else if (p.area === 'Cone') base = 1 + radius * 0.15 - radius * 0.00036667 * (360 - ((p.arc ?? 0) * 180) / Math.PI);
  return base * 0.75 + 0.25;
}

/**
 * A PPM proc's chance each time its power lands (a click) or each of its own periods (a toggle or
 * an auto power).
 *
 * A click: PPM x (the power's recharge time with its own slotted recharge + its cast time) over
 * 60 x the area factor. Global recharge (set bonuses, Hasten) does not count. Any other power:
 * PPM x the enhancement's ActivatePeriod over 60 x the area factor. Then held between 5% + 1.5%
 * per PPM and 90%.
 *
 * @TODO the source's click line multiplies the base recharge by the power's recharge strength over
 * the character's, which would raise the chance with slotted recharge, against its own comment
 * ("boosted recharge to reduce proc chance but not global recharge") and the live game; the
 * comment's reading is used here.
 *
 * @param ppm The proc's procs per minute.
 * @param power The power it is slotted in.
 * @param boost The enhancement.
 * @param slottedRecharge The power's recharge time with its own slotted recharge only (seconds).
 * @return The chance, 0..1.
 */
export function procChance(ppm: number, power: Power, boost: Power, slottedRecharge: number): number {
  const time = power.type === 'Click' ? slottedRecharge + (power.cast ?? 0) : (boost.ap ?? BOOST_PERIOD);
  const chance = (ppm * time) / (60 * areaFactor(power));
  return Math.max(CHANCE_FLOOR + CHANCE_FLOOR_PER_PPM * ppm, Math.min(CHANCE_CEILING, chance));
}

/** One damage proc in one power. */
export interface ProcFigure {
  boost: number; // the enhancement's id
  type: number; // the damage type it deals (index into the damage type names)
  perMin: number; // how often it fires a minute, per target hit, with the power used whenever it is ready
  damage: number; // the damage that is a minute, before the target's resistance
}

/** A PPM group of an enhancement that deals damage. */
interface DamageProc {
  ppm: number; // its procs per minute
  hits: { type: number; tbl: string; sc: number }[]; // what it deals: damage type, class table and scale
}

/** @return The PPM groups of an enhancement that deal damage. */
function damageProcs(gd: GameData, boost: Power): DamageProc[] {
  const first = gd.attribByName.get('DamageType00') ?? 0;
  const hp = gd.attribByName.get('HitPoints') ?? 80;
  const heal = gd.attribByName.get('DamageType07');
  const out: DamageProc[] = [];
  const walk = (effs: Effect[] | undefined, ppm: number | undefined): void => {
    for (const e of effs ?? []) {
      const rate = e.ppm ?? ppm;
      if (rate) {
        const hits = (e.m ?? [])
          .filter((m) => m.asp === 'Absolute' && m.tg !== 'Caster')
          .flatMap((m) => m.a.filter((a) => a >= first && a < hp && a !== heal).map((a) => ({ type: (a - first) / 4, tbl: m.tbl, sc: m.sc })));
        if (hits.length) out.push({ ppm: rate, hits });
      }
      walk(e.sub, rate);
    }
  };
  walk(boost.eff, undefined);
  return out;
}

/**
 * Whether an enhancement is a damage proc the planner can put a number on.
 *
 * @param gd Game data.
 * @param boost The enhancement.
 * @return True when it has a PPM group that deals damage.
 */
export function isDamageProc(gd: GameData, boost: Power): boolean {
  return damageProcs(gd, boost).length > 0;
}

/**
 * The damage procs a power holds, each with its rate and its damage a minute.
 *
 * 1. The chance per use is procChance, from the power's recharge with its own slotting.
 * 2. A click is taken to be used whenever it is ready: once every cast time + recharge time with
 *    the build's global recharge. A toggle or an auto power rolls once every period of the
 *    enhancement.
 * 3. The damage is the proc's own at the character's level: it takes no enhancement.
 *
 * @param gd Game data.
 * @param at The character's archetype.
 * @param power The power.
 * @param slots Its slots.
 * @param level 0-based level the numbers are read at.
 * @param numbers The power's numbers with that slotting (slottedNumbers).
 * @return One figure per proc and damage type, in slot order.
 */
export function procFigures(gd: GameData, at: Archetype, power: Power, slots: readonly Slot[], level: number, numbers: SlottedNumbers): ProcFigure[] {
  const out: ProcFigure[] = [];
  const click = power.type === 'Click';
  for (const s of slots) {
    const boost = s.enh && s.level <= level ? gd.powerById.get(s.enh.boost) : undefined;
    if (!boost) continue;
    for (const proc of damageProcs(gd, boost)) {
      const chance = procChance(proc.ppm, power, boost, numbers.recharge.enh);
      const uses = 60 / (click ? Math.max(MIN_CYCLE, numbers.rechargeGlobal + (power.cast ?? 0)) : (boost.ap ?? BOOST_PERIOD));
      const perMin = chance * uses;
      for (const h of proc.hits) out.push({ boost: boost.id, type: h.type, perMin, damage: perMin * Math.abs(gd.table(at, h.tbl, level) * h.sc) });
    }
  }
  return out;
}
