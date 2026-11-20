/**
 * A real pet's stats, worked out as the totals work out a character's (computeTotals' lines and
 * finishTotals), for the pet pane.
 *
 * What lands on a pet, as the game applies it:
 * - Its own powers that are switched on (by default autos, toggles and a click buff the pet can
 *   keep up: petPowerDefault): the mods that land on their caster, and those aimed at the owner and all its
 *   pets (a Protector Bot's Force Shield). Read from the pet's class at its level, enhanced by the
 *   summon's slotting (character_PetSlotPower).
 * - Other pets' powers that are switched on and reach friends (an Enforcer's Maneuvers, a Protector
 *   Bot's Force Shield): one copy per pet that casts it, as the game stacks a mod for each caster
 *   (kCasterStackType_Individual); a mod the client marks Collective counts once whoever casts it
 *   (HenchmenFile.collective). Read from the caster's class, enhanced by its own summon's slotting.
 * - The creator's powers that are switched on in the overview and reach friends or its pets
 *   (Leadership, a secondary's shields, Supremacy, an upgrade's buffs): read from the creator's
 *   archetype at its level, enhanced by its own slotting.
 * - The build's pet aura IOs (Edict of the Master, ...), unenhanced.
 * Every pet is taken as in range of every aura and as the one a targeted buff is aimed at.
 */
import type { GameData } from '../data/gamedata.ts';
import type { Archetype, Effect, HenchmenFile, Mod, Power } from '../data/types.ts';
import type { Build } from './build.ts';
import { evalRequires, type EvalContext } from './requires.ts';
import { affectsSelf, attribLines, finishTotals, lineBook, type ClassTables, type Totals } from './totals.ts';

// mod targets that reach the caster's (or the affected's) owner and every pet it has: a pet is among them
const OWNER_AND_PETS = new Set(['CastersOwnerAndAllPets', 'AffectedsOwnerAndAllPets', 'FocusOwnerAndAllPets']);
// what a power aimed at friends may reach that a pet of the build is
const FRIENDLY = ['Friend', 'Teammate', 'Leaguemate', 'Any', 'DeadOrAliveAny', 'DeadOrAliveLeaguemate', 'DeadOrAliveTeammate'];
// ... from another pet, and from the creator (whose "MyPet" powers reach its pets)
const FROM_PET = new Set(FRIENDLY);
const FROM_OWNER = new Set([...FRIENDLY, 'MyPet']);
// a power aimed at one of these lands on the chosen one: a pet is taken as that one
const AIMED_ELSEWHERE = new Set(['Caster', 'MyOwner']);
// an empty class: every value falls back to its default
const NO_TABLES: ClassTables = { base: {}, min: {}, max: {}, maxMax: {}, strMax: {}, resMax: {} };

/**
 * Whether a pet's power counts in the pets' stats until switched: autos and toggles do, and a click
 * whose buff lasts at least as long as its recharge, so the pet can keep it up (a Protector Bot's
 * Force Shield: 240 s, recharging in 8 s; a Medic's Stimulant). A click it can't keep up (a wolf's
 * Howl: 15 s, recharging in 60 s; Wild Charge) doesn't. Read from the power's own numbers, before
 * the summon's slotting.
 *
 * @param gd Game data (attribute names).
 * @param p The pet's power.
 * @return Whether it counts by default.
 */
export function petPowerDefault(gd: GameData, p: Power): boolean {
  if (p.type === 'Auto' || p.type === 'Toggle') return true;
  if (p.type !== 'Click') return false;
  let lasts = 0;
  const walk = (effs: Effect[] | undefined) => {
    for (const e of effs ?? []) {
      for (const m of e.m ?? []) if (movesStat(gd, p, m)) lasts = Math.max(lasts, m.dur ?? 0);
      walk(e.sub);
    }
  };
  walk(p.eff);
  walk(p.act);
  return lasts > 0 && lasts >= (p.rech ?? 0);
}

/**
 * Whether a pet's power counts in the pets' stats: the build's switch for it (the pet pane), else
 * its default (petPowerDefault).
 *
 * @param gd Game data (attribute names).
 * @param b The build.
 * @param p The pet's power.
 * @return Whether it counts.
 */
export function petPowerOn(gd: GameData, b: Build, p: Power): boolean {
  const on = b.petOn && Object.prototype.hasOwnProperty.call(b.petOn, p.n) ? b.petOn[p.n] : undefined;
  return on ?? petPowerDefault(gd, p);
}

/** A pet the build keeps out, whose powers may reach the others. */
export interface FieldPet {
  key: string; // its kind's key in the real pets file: pets with one key are the same pet
  name: string; // as the sources name it ("Enforcer")
  cls: string; // the class its powers' tables are read from
  count: number; // how many the build keeps out for sure
  powers: readonly Power[]; // its powers, the build's upgrades applied
  strength: Map<number, number>; // its summon's enhancement strength by attribute
  ctx: EvalContext; // its requirement context as a caster
}

/** The pet whose stats are worked out: a FieldPet, with what tests of it as a target read. */
export interface StatPet extends FieldPet {
  vd?: string; // its villain def (`<name> target.VillainName>`)
  grp?: string; // its villain group (`group target>`)
}

/** A power of the creator that runs (switched on in the overview), with its slotting's strength. */
export interface OwnerPower {
  power: Power;
  strength: Map<number, number>;
}

/** What a pet's stats are worked out from, besides the pet itself. */
export interface PetStatsInput {
  gd: GameData;
  file: HenchmenFile;
  at: Archetype; // the creator's archetype
  level: number; // 0-based level: the pets' and the creator's
  build: Build; // its pet switches
  field: readonly FieldPet[]; // every pet the build keeps out (the one worked out included)
  owner: readonly OwnerPower[]; // the creator's running powers
  ownerCtx: EvalContext; // the creator's requirement context
  auras: readonly { name: string; mod: Mod }[]; // the build's pet aura IO mods
}

/** @return Whether a mod applies while its power runs, not as it ends (OnDeactivate, OnExpire). */
const standing = (m: Mod) => m.app !== 'OnDeactivate' && m.app !== 'OnExpire';

/**
 * Walk the standing mods of effect groups that always land on a target: no chance below 1, no
 * PPM, not a missed roll's, requirements met, and only the main target's or only the others'
 * groups as the target is.
 *
 * @param effs The groups.
 * @param ctx Requirement context (the caster's, its target the pet).
 * @param main The pet is the power's main target: groups only for others are left out, else groups
 *   only for the main target are.
 * @param fn Called per mod.
 */
function walkLanding(effs: Effect[] | undefined, ctx: EvalContext, main: boolean, fn: (m: Mod) => void): void {
  for (const e of effs ?? []) {
    if ((e.ch !== undefined && e.ch < 1) || e.ppm || e.fl?.includes('HitRollFail')) continue;
    if (e.fl?.includes(main ? 'SecondaryTargetsOnly' : 'MainTargetOnly')) continue;
    if (!evalRequires(e.req, ctx)) continue;
    // a mod's own delayed requirement is tested as it lands (Supremacy's low-level henchmen, its leash)
    for (const m of e.m ?? []) if (standing(m) && evalRequires(m.dreq, ctx)) fn(m);
    walkLanding(e.sub, ctx, main, fn);
  }
}

// each power's mods by place, as HenchmenFile.collective counts them
const modPlaces = new WeakMap<Power, Map<Mod, number>>();

/** @return A mod's place in its power: its eff groups then its act groups, each group's mods before its sub-groups. */
function placeOf(p: Power, m: Mod): number {
  let places = modPlaces.get(p);
  if (!places) {
    const map = new Map<Mod, number>();
    let i = 0;
    const walk = (effs: Effect[] | undefined) => {
      for (const e of effs ?? []) {
        for (const x of e.m ?? []) map.set(x, i++);
        walk(e.sub);
      }
    };
    walk(p.eff);
    walk(p.act);
    modPlaces.set(p, map);
    places = map;
  }
  return places.get(m) ?? -1;
}

/**
 * Whether a mod of a power reaches a pet other than its caster.
 *
 * @param p The power.
 * @param m The mod.
 * @param from What a pet is among the power's targets (FROM_PET, FROM_OWNER).
 * @return True for a mod on the owner and all its pets, or on the affected of a power aimed at friends.
 */
function reaches(p: Power, m: Mod, from: ReadonlySet<string>): boolean {
  if (OWNER_AND_PETS.has(m.tg)) return true;
  return m.tg === 'Affected' && (p.ea ?? [p.tgt]).some((t) => from.has(t));
}

/**
 * Whether a pet's power can change a pet's stats, so the pet pane offers its switch: one of its
 * mods moves a totals line and lands on its caster, on the owner and its pets, or on friends.
 *
 * @param gd Game data (attribute names).
 * @param p The pet's power.
 * @return True when switching it can move a stat.
 */
export function buffsPets(gd: GameData, p: Power): boolean {
  if (p.life) return false;
  const any = (effs: Effect[] | undefined): boolean => (effs ?? []).some((e) => (e.m ?? []).some((m) => movesStat(gd, p, m)) || any(e.sub));
  return any(p.eff) || any(p.act);
}

/** @return Whether a mod of a pet's power moves a totals line of its caster, its owner and pets, or friends. */
function movesStat(gd: GameData, p: Power, m: Mod): boolean {
  // either sign: a status protection only moves its line when its magnitude is negative
  return (affectsSelf(p, m) || reaches(p, m, FROM_PET)) && (attribLines(gd, m, 1, null).length > 0 || attribLines(gd, m, -1, null).length > 0);
}

/** @return A class's attribute tables: a pet class's from the real pets file, an archetype's, else none. */
export function classTables(gd: GameData, file: HenchmenFile, cls: string): ClassTables {
  const c = file.classes[cls];
  if (c?.max) return { base: c.base ?? {}, min: c.min ?? {}, max: c.max, maxMax: c.maxMax ?? {}, strMax: c.strMax ?? {}, resMax: c.resMax ?? {} };
  return gd.archetypeByName.get(cls.toLowerCase()) ?? NO_TABLES;
}

/**
 * A pet's stats: the totals lines of what lands on it (see the module's notes), finished against
 * its class.
 *
 * @param input The build's pets, the creator's running powers and pet aura IOs.
 * @param pet The pet.
 * @return Its totals (no set bonuses).
 */
export function petStats(input: PetStatsInput, pet: StatPet): Totals {
  const { gd, file, at, level, build, field, owner, ownerCtx, auras } = input;
  const book = lineBook();
  const vd = pet.vd?.toLowerCase();
  // a caster's context with the pet as its target: its villain def, group, class and combat level
  // (taken as in range: a distance test reads 0). Only a pet's own power has its caster for its
  // target: for another pet's or the creator's, a group "not for the caster" (the defense Grant
  // Cover gives the others) reaches the pet and one "for the caster only" doesn't. Said here for
  // every caster, as the creator's context comes from the totals, where the target is the source.
  const isClass = (n: string) => n.startsWith('arch') || n === 'class';
  const aimedAt = (ctx: EvalContext, own: boolean): EvalContext => ({
    ...ctx,
    targetEntType: 'critter',
    targetIsSource: own,
    targetVillain: (n) => n.toLowerCase() === vd,
    targetProp: (n) => (n === 'group' ? (pet.grp ?? '') : n === 'combatlevel' ? level + 1 : isClass(n) ? pet.cls : undefined),
  });
  const collective = (p: Power, m: Mod) => !!file.collective?.[p.n]?.includes(placeOf(p, m));
  // collective mods already counted, by power and place: a second caster adds nothing
  const once = new Set<string>();
  const firstCopy = (p: Power, m: Mod) => {
    const k = `${p.n}#${placeOf(p, m)}`;
    if (once.has(k)) return false;
    once.add(k);
    return true;
  };
  /** Add a mod at a caster's table and strength, `copies` times, under one source. */
  const take = (m: Mod, p: Power, table: number, strength: Map<number, number>, copies: number, src: string) => {
    for (const l of attribLines(gd, m, table * m.sc, p.ign ? null : strength)) book.add(l.key, l.label, l.value * copies, src);
  };

  // its own powers: what lands on itself
  let endUse = 0;
  const toggles: { name: string; perSec: number; slotted: number }[] = [];
  for (const p of pet.powers) {
    if (p.life || !petPowerOn(gd, build, p)) continue;
    const self = aimedAt(pet.ctx, /*own=*/ true);
    const own = (m: Mod) => {
      if (!affectsSelf(p, m) && !OWNER_AND_PETS.has(m.tg)) return;
      if (collective(p, m)) firstCopy(p, m);
      take(m, p, gd.classTable(pet.cls, m.tbl, level), pet.strength, 1, p.dn);
    };
    walkLanding(p.eff, self, /*main=*/ true, own);
    walkLanding(p.act, self, /*main=*/ true, own);
    if (p.type === 'Toggle' && p.end && p.ap) toggles.push({ name: p.dn, perSec: p.end / p.ap, slotted: pet.strength.get(gd.attribByName.get('EnduranceDiscount') ?? 368) ?? 0 });
  }

  // other pets' powers that reach it: one copy per caster (the same kind: the others of it)
  for (const f of field) {
    const casters = f.count - (f.key === pet.key ? 1 : 0);
    if (casters <= 0) continue;
    const ctx = aimedAt(f.ctx, /*own=*/ false);
    for (const p of f.powers) {
      if (p.life || !petPowerOn(gd, build, p)) continue;
      const main = !AIMED_ELSEWHERE.has(p.tgt);
      const other = (m: Mod) => {
        if (!reaches(p, m, FROM_PET)) return;
        const copies = collective(p, m) ? (firstCopy(p, m) ? 1 : 0) : casters;
        if (copies) take(m, p, gd.classTable(f.cls, m.tbl, level), f.strength, copies, `${p.dn} (${f.name}${copies > 1 ? ` x${copies}` : ''})`);
      };
      walkLanding(p.eff, ctx, main, other);
      walkLanding(p.act, ctx, main, other);
    }
  }

  // the creator's running powers that reach friends or its pets
  const fromOwner = aimedAt(ownerCtx, /*own=*/ false);
  for (const { power: p, strength } of owner) {
    const main = !AIMED_ELSEWHERE.has(p.tgt);
    const mine = (m: Mod) => {
      if (reaches(p, m, FROM_OWNER)) take(m, p, gd.table(at, m.tbl, level), strength, 1, `${p.dn} (yours)`);
    };
    walkLanding(p.eff, fromOwner, main, mine);
    walkLanding(p.act, fromOwner, main, mine);
  }

  // the build's pet aura IOs: the piece's own power, unenhanced
  for (const { name, mod } of auras) {
    for (const l of attribLines(gd, mod, gd.table(at, mod.tbl, level) * mod.sc, null)) book.add(l.key, l.label, l.value, name);
  }

  // its toggles' cost, as computeTotals works a character's out
  const discount = book.lines.get('endrdx')?.value ?? 0;
  for (const t of toggles) {
    const cost = t.perSec / Math.max(0.01, 1 + discount + t.slotted);
    endUse += cost;
    book.add('enduse', 'End use', -cost, t.name);
  }
  return { ...finishTotals(gd, classTables(gd, file, pet.cls), level, book), setGroups: [], bonusesOver5: 0, endUsePerSec: endUse, bonuses: [] };
}
