/**
 * In combat or out of it: which power events a fight sets off, for the totals' Out of Combat
 * switch. A power that is stronger out of combat says so in one of two ways, and both are read here:
 * a group's requirement on the time since an event (`Attacked source.EventTimeSince> 10 >`: pool
 * Stealth's defense) and a mod's suppression, the seconds it stops after an event (Hide's defense,
 * a travel power's speed after an attack). In combat, every combat event has just happened; out of
 * combat, none has for as long as any power asks. See docs/game-rules.md, "Combat state".
 */

import { DEFAULT_SERVER } from '../data/servers.ts';

/**
 * Homecoming's power events by number, as its live client names them (the StaticDefine table of
 * kPowerEvent names in Issue 28 Page 4's executable). The data's suppressions name events by these
 * numbers, which differ by patch and by server.
 */
const HOMECOMING_EVENTS: readonly string[] = [
  'Activate', 'ActivateAttackClick', 'Attacked', 'AttackedNoException', 'Helped', 'Hit', 'Miss', 'QueuedClick',
  'EndActivateClick', 'EndActivateToggle', 'EndActivateInsp', 'EndActivate', 'AttackedByOther', 'AttackedByOtherClick',
  'HelpedByOther', 'HitByOther', 'HitByFriend', 'HitByFoe', 'MissByOther', 'MissByFriend', 'MissByFoe', 'Damaged',
  'Healed', 'Stunned', 'Immobilized', 'Held', 'Sleep', 'Terrorized', 'Confused', 'Untouchable', 'Intangible',
  'OnlyAffectsSelf', 'Taunted', 'AnyStatus', 'Knocked', 'Repelled', 'Teleported', 'Defeated', 'MissionObjectClick',
  'Moved', 'NearGround', 'Defiant', 'CommandedPet', 'PetAttacked', 'PetHelped', 'PetHit', 'PetMiss', 'PetDefeated',
  'PseudoPetAttacked', 'PseudoPetHelped', 'PseudoPetHit', 'PseudoPetMiss',
];

/** Thunderspy's (its 9.6 executable's table): the older order, without Homecoming's additions. */
const THUNDERSPY_EVENTS: readonly string[] = [
  'Activate', 'ActivateAttackClick', 'Attacked', 'AttackedNoException', 'Helped', 'Hit', 'Miss', 'EndActivate',
  'AttackedByOther', 'AttackedByOtherClick', 'HelpedByOther', 'HitByOther', 'HitByFriend', 'HitByFoe', 'MissByOther',
  'MissByFriend', 'MissByFoe', 'Damaged', 'Healed', 'Stunned', 'Immobilized', 'Held', 'Sleep', 'Terrorized',
  'Confused', 'Untouchable', 'Intangible', 'OnlyAffectsSelf', 'AnyStatus', 'Knocked', 'Defeated', 'MissionObjectClick',
  'Moved', 'Teleported', 'Defiant',
];

/**
 * Each published game version's event numbers, read from that version's own executable. A new
 * version gets its entry with its data (tests/combat.test.ts checks every published one is here).
 */
export const VERSION_EVENTS: Record<string, readonly string[]> = {
  i28p4: HOMECOMING_EVENTS,
  // Issue 28 Page 3 had no Taunted event, so every event after OnlyAffectsSelf is one lower
  i28p3: HOMECOMING_EVENTS.filter((n) => n !== 'Taunted'),
  'ts9-6': THUNDERSPY_EVENTS,
};

// a version not in VERSION_EVENTS (a patch not yet checked) reads with its server's latest numbers
const SERVER_EVENTS: Record<string, readonly string[]> = {
  [DEFAULT_SERVER]: HOMECOMING_EVENTS,
  thunderspy: THUNDERSPY_EVENTS,
};

/**
 * The events a fight sets off: attacking, helping, being attacked, hit or damaged, and the same by
 * the character's pets. Not the status events, a mission object's click, moving or landing, which
 * a fight doesn't decide (they keep the answer the planner gave before the switch).
 */
const COMBAT_EVENTS = new Set(
  [
    'ActivateAttackClick', 'Attacked', 'AttackedNoException', 'Helped', 'Hit', 'Miss', 'AttackedByOther',
    'AttackedByOtherClick', 'HitByOther', 'HitByFoe', 'MissByOther', 'MissByFoe', 'Damaged', 'CommandedPet',
    'PetAttacked', 'PetHelped', 'PetHit', 'PetMiss', 'PseudoPetAttacked', 'PseudoPetHelped', 'PseudoPetHit', 'PseudoPetMiss',
  ].map((n) => n.toLowerCase()),
);

/**
 * The character's combat state for the totals: in combat (false, the default), out of it (true, the
 * Out of Combat switch), or `'travel'`: in combat but moving and hiding as out of it, so travel speed
 * and stealth count and nothing else a fight stops does (the set finder: slotting a travel power is
 * for getting around, not for a fight).
 */
export type CombatState = boolean | 'travel';

// the attributes 'travel' counts out of combat: the speeds, jump height and stealth radius
const TRAVEL_ATTRIBS = ['SpeedRunning', 'SpeedFlying', 'SpeedJumping', 'JumpHeight', 'StealthRadius', 'StealthRadiusPlayer'];

/**
 * @param attribByName The data's attribute offsets by name.
 * @return The offsets of the attributes `'travel'` counts out of combat.
 */
export function travelAttribs(attribByName: ReadonlyMap<string, number>): ReadonlySet<number> {
  let set = travelByData.get(attribByName);
  if (!set) travelByData.set(attribByName, (set = new Set(TRAVEL_ATTRIBS.map((n) => attribByName.get(n)).filter((a): a is number => a !== undefined))));
  return set;
}

// travelAttribs per data's attribute map
const travelByData = new WeakMap<ReadonlyMap<string, number>, ReadonlySet<number>>();

// seconds since an event that never happened: longer than any requirement or suppression asks
const LONG_AGO = 1e9;

/** One suppression of a mod: it stops for `Seconds` after `Event` (the data's Suppress pairs). */
interface Suppress {
  Event: number; // the version's power event number (VERSION_EVENTS)
  Seconds: number; // how long it stops for
  Always?: number; // 1: also stops when already applied; 0: only blocks applying (combatHooks)
}

/** What the totals' requirement context is told about the fight (EvalContext.sinceEvent, .suppressed). */
export interface CombatHooks {
  sinceEvent: (event: string) => number | undefined; // seconds since an event; undefined: not a fight's
  suppressed: (sup: unknown, attribs?: readonly number[]) => boolean; // whether a mod's suppressions stop it now
}

/**
 * The combat answers for a server's data, in combat or out of it.
 *
 * Out of combat a mission object's click is long ago too: the out-of-combat bonuses all ask for it
 * (pool Stealth's `MissionObjectClick source.EventTimeSince> 10 >`), and it is no part of a fight,
 * so it reads the same in combat.
 *
 * A suppression's Always flag isn't read: 1 also stops a mod already applied, 0 only blocks it from
 * applying, and either way a buff a fight sets off doesn't count in combat.
 *
 * @param server The data's server id.
 * @param version The data's game version id (its event numbering).
 * @param state In combat, out of it, or in it but travelling (CombatState).
 * @param travel The attributes `'travel'` counts out of combat (travelAttribs).
 * @return The time since an event (undefined: not a fight's, keep the evaluator's old answer) and
 *   whether a mod's suppressions stop it (given its attributes).
 */
export function combatHooks(server: string, version: string, state: CombatState, travel: ReadonlySet<number> = new Set()): CombatHooks {
  const names = VERSION_EVENTS[version] ?? SERVER_EVENTS[server];
  const out = state === true;
  const fought = (name: string | undefined) => !out && !!name && COMBAT_EVENTS.has(name.toLowerCase());
  return {
    sinceEvent: (event) => {
      const n = event.toLowerCase();
      if (n === 'missionobjectclick') return LONG_AGO;
      if (!COMBAT_EVENTS.has(n)) return undefined;
      return out ? LONG_AGO : 0;
    },
    suppressed: (sup, attribs) => {
      // a server whose event numbers aren't known: no suppression applies, as before the switch
      if (!names || !Array.isArray(sup)) return false;
      if (state === 'travel' && attribs?.length && attribs.every((a) => travel.has(a))) return false;
      return sup.some((s: Suppress) => !!s && typeof s.Event === 'number' && s.Seconds > 0 && fought(names[s.Event]));
    },
  };
}
