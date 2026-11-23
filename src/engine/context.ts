/**
 * Requirement contexts, built in one place.
 *
 * A requirement expression asks about whoever runs a power (what it owns, its class and level),
 * what it has slotted, which modes it is in, who made it, and who the power lands on. Every context
 * the engine evaluates with is put together here from those parts, so none is copied by hand from
 * another context. The target above all: the totals' context says its target is the caster, and a
 * context made from it by hand went on saying so for a pet (Grant Cover's defense never reached a
 * Mu Striker). `aimedAt` therefore takes the whole target, and keeps nothing of the old one.
 */
import type { GameData } from '../data/gamedata.ts';
import { combatHooks, travelAttribs, type CombatState } from './combat.ts';
import type { EvalContext } from './requires.ts';

/** Who a power lands on, as a requirement can ask about it. Always given whole (aimedAt). */
export interface EvalTarget {
  type: 'player' | 'critter'; // its entity type (`enttype target>`): a critter in PvE
  isSource: boolean; // whether it is the caster itself (`entref target> entref source> eq`)
  villain?: (name: string) => boolean; // whether it is the named villain def (`target.VillainName>`); absent: none
  prop?: (name: string) => number | string | undefined; // its other properties (`group target>`); absent: 0
}

/**
 * The context of someone who owns no power and no set: what New Build's lists, a set bonus's own
 * requirement and the power info start from.
 *
 * @param prop Its properties (archetype, level, ...); 0 for every one when omitted.
 * @return The context, with no target.
 */
export function nobody(prop: EvalContext['prop'] = () => 0): EvalContext {
  return { ownsPower: () => false, ownsSet: () => false, prop };
}

/**
 * A context aimed at a target.
 *
 * Every answer about the target is replaced, the ones the new target leaves out included: nothing
 * of the old target survives, whichever context this starts from.
 *
 * @param ctx The context of whoever runs the power.
 * @param target Who the power lands on.
 * @return The same context with that target.
 */
export function aimedAt(ctx: EvalContext, target: EvalTarget): EvalContext {
  return { ...ctx, targetEntType: target.type, targetIsSource: target.isSource, targetVillain: target.villain, targetProp: target.prop };
}

/**
 * A context with some properties answered differently.
 *
 * @param ctx The context.
 * @param over The new answer for a property, or undefined to keep the context's own.
 * @return The same context with those answers.
 */
export function withProps(ctx: EvalContext, over: (name: string) => string | number | undefined): EvalContext {
  return { ...ctx, prop: (name) => over(name) ?? ctx.prop(name) };
}

/**
 * A context with its slotted enhancements counted.
 *
 * @param ctx The context.
 * @param slotted How many of a named enhancement the whole character has slotted (`all`), and how
 *   many the power being evaluated holds (`inPower`); one left out keeps the context's own count.
 * @return The same context with those counts.
 */
export function withSlotted(ctx: EvalContext, slotted: { all?: (name: string) => number; inPower?: (name: string) => number }): EvalContext {
  return {
    ...ctx,
    ...(slotted.all ? { boostsSlotted: slotted.all } : {}),
    ...(slotted.inPower ? { powerBoostsSlotted: slotted.inPower } : {}),
  };
}

/**
 * A context with its power modes told.
 *
 * @param ctx The context.
 * @param inMode Whether a mode is on (the name comes with the data's `k` prefix).
 * @return The same context with those modes.
 */
export function withModes(ctx: EvalContext, inMode: (name: string) => boolean): EvalContext {
  return { ...ctx, inMode };
}

/**
 * A pseudo-pet's context: one that has a creator to ask about.
 *
 * @param ctx The pseudo-pet's own context.
 * @param ownerProp A property of the character that made it (`source.owner>`, `source.creator>`).
 * @return The same context with that creator.
 */
export function withOwner(ctx: EvalContext, ownerProp: (name: string) => string | number): EvalContext {
  return { ...ctx, ownerProp };
}

/**
 * A context in a combat state: the time since each power event and the suppressions that stop a
 * mod, in combat or out of it (combatHooks), with the event numbers of the data's own version.
 *
 * @param ctx The context.
 * @param gd Game data (its server, version and attributes).
 * @param state In combat, out of it, or travelling (CombatState).
 * @return The same context in that state.
 */
export function inCombatState(ctx: EvalContext, gd: GameData, state: CombatState): EvalContext {
  return { ...ctx, ...combatHooks(gd.server, gd.core.manifest.dataVersion, state, travelAttribs(gd.attribByName)) };
}
