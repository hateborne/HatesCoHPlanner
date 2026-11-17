/**
 * A power's own numbers with a slotting: the figures its detailed info is written from
 * (powerInfo), plus its recharge time with the build's global recharge counted.
 */
import type { GameData } from '../../data/gamedata.ts';
import type { Archetype, Power } from '../../data/types.ts';
import type { Slot } from '../build.ts';
import { powerStrength } from '../enhance.ts';
import { powerInfo, type PowerNumbers } from '../powerinfo.ts';

/** A power's numbers for the finder. */
export interface SlottedNumbers extends PowerNumbers {
  rechargeGlobal: number; // seconds to recharge with the build's global recharge added to its own
}

/**
 * A power's numbers with a slotting.
 *
 * The game divides a power's recharge time by 1 + its recharge strength, and a power's strength
 * starts from the character's (character_mods.c), so the build's global recharge adds to the
 * slotted enhancement.
 *
 * @param gd Game data.
 * @param at The character's archetype.
 * @param power The power.
 * @param slots Its slots.
 * @param level 0-based level the numbers are read at.
 * @param globalRecharge The build's recharge total (the 'rech' line, after its cap).
 * @return The numbers.
 */
export function slottedNumbers(gd: GameData, at: Archetype, power: Power, slots: readonly Slot[], level: number, globalRecharge: number): SlottedNumbers {
  const usable = slots.filter((s) => s.level <= level).map((s) => s.enh);
  const strength = powerStrength(gd, at, power, usable, level).post;
  const numbers = powerInfo(gd, at, power, level, strength).numbers;
  const own = strength.get(gd.attribByName.get('RechargeTime') ?? 360) ?? 0;
  return { ...numbers, rechargeGlobal: numbers.recharge.base / (1 + own + globalRecharge) };
}
