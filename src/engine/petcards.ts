/**
 * The Pets and Minions cards of the totals: each kind of real pet a build's powers make at a level
 * (Mastermind henchmen, Phantom Army, a patron pool's summon), with its stats (petstats.ts), its
 * attacks and what its other powers do.
 *
 * What the game does, and the planner follows:
 * - A pet spawns at its creator's combat level (character_CreatePet: a negative scale gives
 *   combat level + 1, 1-based; every Homecoming henchman since Issue 28 Page 3), and its class's
 *   tables are read there.
 * - A summon's EntCreate mods spawn as their groups allow: Battle Drones' second drone needs
 *   `combatlevel source> 5 >`. A group with a chance below 1 (Gang War's extra posse) may spawn.
 * - Every pet power, those an upgrade grants later included, is slotted from the power that made
 *   the pet (character_PetSlotPower): the summon's enhancements enhance them all.
 * - Upgrades (Equip Robot, Train Ninjas, ...) are the build's powers whose grant and revoke mods sit
 *   in a group naming the pet (`MastermindPets_Droid target.VillainName>`). They apply in the
 *   order the build takes them (the game applies them in order: character_ApplyPetUpgrade), each
 *   mod in its power's order: Upgrade Equipment revokes an Enforcer's Maneuvers and grants it back.
 *   An upgrade switched off in the overview (they start on) applies to no pet. A grant that needs a
 *   meter of the pet's (a Grave Knight's rage) is shown with its condition.
 * - A pet's stats count what lands on it: its own powers, the other pets' and the creator's that
 *   reach it, and the build's pet aura IOs (petstats.ts). The pets that cast on the others are those
 *   the build keeps out for sure: not a temporary one (Gang War's posse), a maybe or one made from a
 *   fallen henchman.
 */
import type { GameData } from '../data/gamedata.ts';
import type { Archetype, Effect, HenchmenFile, Mod, PetKind, PetMake, Power } from '../data/types.ts';
import type { Build } from './build.ts';
import { powerStrength } from './enhance.ts';
import { petStats, type FieldPet, type OwnerPower, type PetStatsInput } from './petstats.ts';
import { powerInfo, prettyDuration, type BaseAndEnhanced, type InfoEffect, type RunAs } from './powerinfo.ts';
import { aimedAt, nobody, withModes, withOwner, withProps } from './context.ts';
import { evalRequires, type EvalContext } from './requires.ts';
import type { BuildEntry, BuildRules } from './rules.ts';
import { earnedBonuses } from './setbonus.ts';
import { totalsState, walkEffects, type Totals } from './totals.ts';

/** One attack of a pet: its damage per activation and how often it can use it. */
export interface PetAttack {
  power: Power; // the attack itself (its power info, its switch)
  name: string;
  type: string; // Click | Toggle | Auto: only a Click has a cast and a recharge worth showing
  damage: BaseAndEnhanced; // average damage per activation (the power info's "Average Damage")
  cast: number; // activation time in seconds
  recharge: BaseAndEnhanced; // seconds
  dpa: BaseAndEnhanced; // damage per second of casting (damage / cast); 0 without a cast time
  lines: InfoEffect[]; // what it does, as the power info's effect lines give it ("3 Ticks of 2.28 energy damage")
  users?: number; // how many of the card's pets have it, when not all do (Gang War's posse each carry one weapon)
  when?: string; // the condition it needs, for a power granted only then ("while its Rage is above 0.5")
}

/** A pet power that deals no damage, with the effect lines the power info gives it. */
export interface PetPowerLines {
  power: Power; // the power itself (its power info, its switch)
  name: string;
  lines: InfoEffect[]; // what it does to others and to the pet, except the pet's own resistance, defense and regeneration
  when?: string; // the condition it needs, as PetAttack.when
}

/** A power of the build that makes a card's pets, and how many. */
export interface PetSource {
  from: string; // the power's name
  count: number; // how many it makes at this level for sure
  extra: number; // how many more it may make (groups with a chance below 1)
  dur?: number; // their lifetime in seconds, for pets that don't stay
  over?: number; // seconds over which it makes them, when it spreads them out (Hell on Earth)
  on?: string; // the pet it must be used on (Soul Extraction on a fallen Lich)
}

/**
 * One kind of real pet the build makes, as its card shows it. Pets of one name and the same
 * numbers but other attacks (Gang War's posse, each with its own weapon) share a card.
 */
export interface PetCard {
  key: string; // stable: the first creating power's id and the pet kind's key
  name: string; // the pet's name
  sources: PetSource[]; // the powers that make it, in the order the build takes them
  level: number; // 0-based level it runs at
  run: RunAs; // the class its powers run with, for their power info
  strength: Map<number, number>; // its summon's enhancement strength by attribute (every pet power has it)
  stats: Totals; // its stats, as the totals pane reads a character's
  attacks: PetAttack[];
  powers: PetPowerLines[];
}

/**
 * A row of the totals' Pets and Minions section: what it lists at once (the pet's name and how many
 * the build makes), with its card worked out only when first shown.
 */
export interface PetEntry {
  key: string; // stable: the first creating power's id and the pet kind's key
  name: string;
  sources: PetSource[];
  card: () => PetCard; // the card, worked out once on first call
}

// the most passes taken over the build's upgrades (a grant's requirement may test a mode another sets)
const MAX_UPGRADE_PASSES = 4;
// spawn delays up to this many seconds are the summon's animation (Battle Drones' 2 to 4 s), longer
// ones spread the pets out over time (Hell on Earth's every 10 s)
const SPREAD_MIN = 5;

/**
 * Whether a build has a power that may make a real pet, so the real pets file is worth fetching for
 * it: one with more EntCreate mods than the pets file lists pseudo-pets for it (Rain of Fire's only
 * pet is a pseudo-pet). Without the pets file, any power with an EntCreate mod counts.
 *
 * @param gd Game data (its pets file, when there).
 * @param entries The build's powers.
 * @return True when one of them may make a real pet.
 */
export function makesPets(gd: GameData, entries: readonly BuildEntry[]): boolean {
  const ent = gd.attribByName.get('EntCreate') ?? 469;
  const count = (effs: Effect[] | undefined): number =>
    (effs ?? []).reduce((n, e) => n + (e.m ?? []).filter((m) => m.a.includes(ent)).length + count(e.sub), 0);
  return entries.some((e) => {
    const made = count(e.power.eff) + count(e.power.act);
    return made > 0 && made > (gd.pets?.pets[e.power.n]?.length ?? 0);
  });
}

type Chain = readonly (readonly string[])[];

/**
 * Walk effect groups with the requirements of the groups around each, calling fn for each mod.
 *
 * @param effs The groups.
 * @param chain The requirements of the groups around them.
 * @param fn Called per mod of a group whose chance isn't 0, with its group's requirement chain.
 */
function walkChains(effs: Effect[] | undefined, chain: Chain, fn: (m: Mod, chain: Chain) => void): void {
  for (const e of effs ?? []) {
    if (e.ch === 0) continue;
    const c = e.req?.length ? [...chain, e.req] : chain;
    for (const m of e.m ?? []) fn(m, c);
    walkChains(e.sub, c, fn);
  }
}

/** @return Whether a requirement chain names a pet (`<villain def> target.VillainName>`). */
const namesPet = (chain: Chain): boolean => chain.some((r) => r.some((t) => t.toLowerCase() === 'target.villainname>'));

/** @return The villain defs a requirement chain names as the target (`<name> target.VillainName>`). */
function targetsNamed(chain: Chain): string[] {
  const out: string[] = [];
  for (const r of chain) r.forEach((t, i) => i > 0 && t.toLowerCase() === 'target.villainname>' && out.push(r[i - 1]!));
  return out;
}

/** A test of a target's meter in a requirement (`kRage target> .5 >`). */
interface MeterTest {
  name: string; // the meter, lower case with its k ("krage")
  shown: string; // as a player reads it ("Rage")
  op: string; // > >= < <=
  value: number;
}

/** @return The meter tests of a requirement chain (`k<Name> target> <number> <op>`). */
function meterTests(chain: Chain): MeterTest[] {
  const out: MeterTest[] = [];
  for (const r of chain) {
    for (let i = 0; i + 3 < r.length; i++) {
      const [name, fn, num, op] = [r[i]!, r[i + 1]!, r[i + 2]!, r[i + 3]!];
      const value = Number(num);
      if (fn.toLowerCase() !== 'target>' || !/^k\w+$/i.test(name) || !Number.isFinite(value) || !['>', '>=', '<', '<='].includes(op)) continue;
      out.push({ name: name.toLowerCase(), shown: name.slice(1).replace(/_/g, ' '), op, value });
    }
  }
  return out;
}

/** One kind of pet one power of the build makes, as petEntries finds it. */
interface Variant {
  e: BuildEntry; // the power that makes it
  kind: PetKind;
  key: string; // the kind's key in the real pets file
  source: PetSource;
  pseudo: boolean; // it runs with its creator's class
  strength: Map<number, number>; // the power's enhancement strength by attribute
  powers: Upgraded;
}

/** @return The class a pet runs with: its own, else (a PseudoPet) its creator's archetype. */
const classOf = (at: Archetype, v: Variant): string => (v.pseudo ? at.n : (v.kind.cls ?? at.n));

/**
 * A pet's requirement context: its class for `arch` tests, its creator's for `source.owner>`, the
 * modes its powers set.
 *
 * @param cls The pet's class.
 * @param at The creator's archetype.
 * @param level 0-based level.
 * @param modes The modes its always-on powers set (Upgraded.modes).
 * @return The context.
 */
function petCtxOf(cls: string, at: Archetype, level: number, modes: ReadonlySet<string>): EvalContext {
  const isClass = (name: string) => name.startsWith('arch') || name.startsWith('rank') || name === 'class';
  const pet = nobody((name) => (isClass(name) ? cls : name === 'level' ? level + 1 : 0));
  // until a card aims it (petStats: at the pet itself, or at another), its powers land on a foe
  const run = withModes(aimedAt(pet, { type: 'critter', isSource: false }), (name) => {
    const n = name.toLowerCase();
    return modes.has(n) || (n.startsWith('k') && modes.has(n.slice(1)));
  });
  return withOwner(run, (name) => (isClass(name) ? at.n : 0));
}

/**
 * The pets the build keeps out, whose powers reach the others: what each summon makes for sure,
 * not a temporary pet (Gang War's posse), a maybe or one made from a fallen henchman.
 *
 * @param at The creator's archetype.
 * @param level 0-based level.
 * @param variants Every kind of pet each of the build's powers makes.
 * @return One per kind, its counts summed over the powers that make it.
 */
function fieldOf(at: Archetype, level: number, variants: readonly Variant[]): FieldPet[] {
  const out = new Map<string, FieldPet>();
  for (const v of variants) {
    if (v.source.dur || v.source.on || v.source.count <= 0) continue;
    const had = out.get(v.key);
    if (had) {
      had.count += v.source.count;
      continue;
    }
    const cls = classOf(at, v);
    out.set(v.key, { key: v.key, name: v.kind.dn || v.e.power.dn, cls, count: v.source.count, powers: [...v.powers.powers.values()], strength: v.strength, ctx: petCtxOf(cls, at, level, v.powers.modes) });
  }
  return [...out.values()];
}

/**
 * The Pets and Minions rows of a build at a level: one per kind of real pet its powers make there,
 * in the order of the build's powers, each card worked out only when asked for (PetEntry.card).
 *
 * Pets of one name, class and powers other than attacks share a row (Gang War's posse); attacks are
 * the powers that reach foes.
 *
 * @param gd Game data (its real pets file: none, no rows).
 * @param rules Rules view of the build.
 * @param b The build.
 * @param level 0-based level (the totals' level).
 * @return The rows.
 */
export function petEntries(gd: GameData, rules: BuildRules, b: Build, level: number): PetEntry[] {
  const file = gd.henchmen;
  if (!file) return [];
  const at = rules.at;
  const st = totalsState(gd, rules, b, level);
  // the creator's combat level decides which of a summon's pets spawn (`combatlevel source>`); a
  // pet's target is a critter, and a test of which one (Soul Extraction's fallen henchman) is taken
  // as met: the row says which it must be
  // (whether that target is the caster is left as the totals have it: the creator casts the summon)
  const spawnCtx = aimedAt(
    withProps(st.ctx, (n) => (n === 'combatlevel' ? level + 1 : undefined)),
    { type: 'critter', isSource: true, villain: () => true },
  );
  const ordered = [...st.entries].sort((x, y) => x.level - y.level);
  // an upgrade switched off in the overview applies to no pet
  const upgrades = ordered.filter((e) => st.isOn(e));
  // an upgrade is aimed at a pet: its target is a critter, and not its caster (the totals' context says it is)
  const upgradeCtx = aimedAt(st.ctx, { type: 'critter', isSource: false });
  const nameOfVillain = (vd: string) => Object.values(file.pets).find((k) => k.vd?.toLowerCase() === vd.toLowerCase())?.dn ?? vd;

  const rows = new Map<string, { entry: PetEntry; variants: Variant[] }>();
  // what every card's stats read, worked out when the first card is: the build's pets, the
  // creator's running powers and its pet aura IOs
  let input: PetStatsInput | null = null;
  const inputOf = (): PetStatsInput =>
    (input ??= {
      gd,
      file,
      at,
      level,
      build: b,
      field: fieldOf(at, level, [...rows.values()].flatMap((r) => r.variants)),
      owner: st.entries
        .filter((e) => st.isOn(e))
        .map((e): OwnerPower => ({ power: e.power, strength: powerStrength(gd, at, e.power, e.slots.filter((x) => x.level <= level).map((x) => x.enh), level).post })),
      ownerCtx: st.ctx,
      auras: petAuras(gd, st.entries, level, st.ctx),
    });
  for (const e of ordered) {
    const makes = file.makes[e.power.n];
    if (!makes) continue;
    const enhs = e.slots.filter((s) => s.level <= level).map((s) => s.enh);
    const strength = powerStrength(gd, at, e.power, enhs, level).post;
    // a summon's pets of one kind share a source (its EntCreate mods, sure and maybe)
    const kinds = new Map<string, { kind: PetKind; key: string; makes: PetMake[]; pseudo: boolean }>();
    for (const m of makes) {
      const kind = file.pets[m.pet];
      if (!kind || !(m.req ?? []).every((r) => evalRequires(r, spawnCtx))) continue;
      const on = targetsNamed(m.req ?? []).map(nameOfVillain).join(' or ');
      const same = `${kind.dn}|${kind.cls ?? ''}|${kind.p.join(',')}|${m.pseudo ? 1 : 0}|${on}`;
      const k = kinds.get(same) ?? { kind, key: m.pet, makes: [], pseudo: !!m.pseudo };
      k.makes.push(m);
      kinds.set(same, k);
    }
    for (const k of kinds.values()) {
      const maybe = (m: PetMake) => m.ch !== undefined && m.ch < 1;
      // spread out when the spawns' delays differ by more than an animation's: over the last one's
      const dels = k.makes.map((m) => m.del ?? 0);
      const over = Math.max(...dels) - Math.min(...dels) > SPREAD_MIN ? Math.max(...dels) : 0;
      const on = targetsNamed(k.makes[0]!.req ?? []).map(nameOfVillain).join(' or ');
      const dur = k.makes.find((m) => m.dur)?.dur;
      const source: PetSource = {
        from: e.power.dn,
        count: k.makes.filter((m) => !maybe(m)).length,
        extra: k.makes.filter(maybe).length,
        ...(dur ? { dur } : {}),
        ...(over ? { over } : {}),
        ...(on ? { on } : {}),
      };
      const powers = upgradedPowers(gd, file, k.kind, upgrades, upgradeCtx);
      const variant: Variant = { e, kind: k.kind, key: k.key, source, pseudo: k.pseudo, strength, powers };
      // pets share a row when everything but their attacks is the same (a foe-reaching power is
      // taken as an attack here; the card itself decides by its damage)
      const cls = k.pseudo ? at.n : (k.kind.cls ?? at.n);
      const others = [...variant.powers.powers.keys(), ...variant.powers.cond.keys()].filter((n) => {
        const p = variant.powers.powers.get(n) ?? variant.powers.cond.get(n)?.power;
        return !!p && !(p.ea ?? [p.tgt]).includes('Foe');
      });
      const sig = JSON.stringify([k.kind.dn, cls, k.pseudo, others.sort(), [...strength.entries()].sort()]);
      const row = rows.get(sig);
      if (row) {
        row.variants.push(variant);
        const same = row.entry.sources.find((s) => s.from === source.from && s.dur === source.dur && s.on === source.on);
        if (same) {
          same.count += source.count;
          same.extra += source.extra;
        } else row.entry.sources.push({ ...source });
        continue;
      }
      const variants: Variant[] = [variant];
      let made: PetCard | null = null;
      const entry: PetEntry = {
        key: `${e.power.id}:${k.key}`,
        name: k.kind.dn || e.power.dn,
        sources: [{ ...source }],
        card: () => (made ??= combine(variants.map((v) => card(gd, file, at, v, level, inputOf())), entry.sources)),
      };
      rows.set(sig, { entry, variants });
    }
  }
  return [...rows.values()].map((r) => r.entry);
}

/**
 * The Pets and Minions cards of a build at a level, all worked out (petEntries' cards).
 *
 * @param gd Game data (its real pets file: none, no cards).
 * @param rules Rules view of the build.
 * @param b The build.
 * @param level 0-based level (the totals' level).
 * @return The cards.
 */
export function petCards(gd: GameData, rules: BuildRules, b: Build, level: number): PetCard[] {
  return petEntries(gd, rules, b, level).map((e) => e.card());
}

/** @return How many pets a card stands for, sure and maybe. */
const petsOf = (c: PetCard): number => c.sources.reduce((t, s) => t + s.count + s.extra, 0);

/**
 * One card from the cards of the pets a row shares: the first's numbers, every attack (one only some
 * of them have says how many), the row's sources.
 *
 * @param cards One card per kind of pet per creating power, in the build's order.
 * @param sources The row's sources (merged).
 * @return The card.
 */
function combine(cards: readonly PetCard[], sources: PetSource[]): PetCard {
  const first = cards[0]!;
  const key = (a: PetAttack) => `${a.name}|${a.damage.base}|${a.damage.enh}|${a.recharge.base}|${a.when ?? ''}`;
  const attacks: PetAttack[] = [];
  for (const c of cards) {
    const n = petsOf(c);
    for (const a of c.attacks) {
      const same = attacks.find((x) => key(x) === key(a));
      if (same) same.users = (same.users ?? 0) + n;
      else attacks.push({ ...a, users: n });
    }
  }
  const total = sources.reduce((t, s) => t + s.count + s.extra, 0);
  return {
    ...first,
    sources,
    attacks: attacks.map(({ users, ...a }) => (users !== undefined && users < total ? { ...a, users } : a)),
  };
}

/** A pet aura IO's mod, with the piece it comes from. */
interface AuraMod {
  name: string;
  mod: Mod;
}

/**
 * The mods the build's pet aura IOs give its pets: the earned bonuses (a unique piece's global, or
 * any set bonus) whose power affects "MyPet", their mods that land on the affected.
 *
 * Every earned copy of a set bonus counts, as it does for the character (the rule of 5 left out
 * the rest): each is a power of its own, and the game keeps a mod per power. A unique piece's
 * global counts once, however many powers hold the piece.
 *
 * @param gd Game data.
 * @param entries The build's powers at the level.
 * @param level 0-based level.
 * @param ctx The character's requirement context.
 * @return The mods, with the piece or set each comes from.
 */
function petAuras(gd: GameData, entries: BuildEntry[], level: number, ctx: EvalContext): AuraMod[] {
  const out: AuraMod[] = [];
  const seen = new Set<number>();
  for (const bn of earnedBonuses(gd, entries, level)) {
    if (bn.suppressed || !(bn.power.ea ?? []).includes('MyPet')) continue;
    if (bn.global) {
      if (seen.has(bn.power.id)) continue;
      seen.add(bn.power.id); // a unique piece's aura counts once
    }
    // named as the totals name them: a set bonus by its set and piece count, a global by its power
    const name = bn.global ? bn.power.dn : `${bn.set.dn} (${bn.slotted})`;
    walkEffects(bn.power.eff, ctx, (m) => {
      if (m.tg === 'Affected') out.push({ name, mod: m });
    });
  }
  return out;
}

/** A pet's powers once the build's upgrades are applied. */
interface Upgraded {
  powers: Map<string, Power>; // its powers: its own first, then what upgrades grant, less what they revoke
  cond: Map<string, { power: Power; when: string }>; // powers granted only while one of its meters allows
  modes: Set<string>; // the modes its always-on powers set (lower case)
}

/**
 * The powers a pet has once the build's upgrades are applied to it.
 *
 * Each pass applies every upgrade from the pet's own powers, in the order the build takes them and
 * each mod in its power's order, so a power revoked and granted back (Upgrade Equipment's
 * Maneuvers) is kept. A pass reads the modes the previous pass's powers set; passes repeat until
 * the powers stop changing. A grant whose chain only holds when one of the pet's meters is past a
 * mark (`kRage target> .5 >`; meters start at 0) is kept apart with its condition.
 *
 * @param gd Game data.
 * @param file The real pets file.
 * @param kind The pet.
 * @param entries The build's powers at the level, in the order it takes them.
 * @param ctx The character's requirement context (the upgrade's source), its target a critter.
 * @return The pet's powers, those it has only under a condition, and the modes it is in.
 */
function upgradedPowers(gd: GameData, file: HenchmenFile, kind: PetKind, entries: readonly BuildEntry[], ctx: EvalContext): Upgraded {
  const own = new Map<string, Power>();
  for (const n of kind.p) {
    const p = file.powers[n];
    if (p) own.set(n, p);
  }
  const setMode = gd.attribByName.get('SetMode') ?? 473;
  const modeNames = gd.core.attribNames.Mode ?? [];
  /** @return The modes a pet's always-on powers set (`kMastermind_Upgrade_1 target.mode?`). */
  const modesOf = (powers: Map<string, Power>): Set<string> => {
    const out = new Set<string>();
    for (const p of powers.values()) {
      if (p.type !== 'Auto') continue;
      walkChains(p.eff, [], (m) => {
        const n = m.a.includes(setMode) && m.mag !== undefined ? modeNames[m.mag]?.n : undefined;
        if (n) out.add(n.toLowerCase());
      });
    }
    return out;
  };
  if (!kind.vd) return { powers: own, cond: new Map(), modes: modesOf(own) };
  const vd = kind.vd.toLowerCase();
  const grant = new Set([gd.attribByName.get('GrantPower') ?? 481, gd.attribByName.get('GrantBoostedPower') ?? 486]);
  const revoke = gd.attribByName.get('RevokePower') ?? 482;
  let powers = own;
  let cond = new Map<string, { power: Power; when: string }>();
  let last = '';
  for (let pass = 0; pass < MAX_UPGRADE_PASSES; pass++) {
    const on = modesOf(powers);
    // the upgrade's caster aimed at this kind of pet (not its caster), in the modes its powers so far set
    const thisPet = (prop?: (name: string) => number | undefined): EvalContext =>
      withModes(aimedAt(ctx, { type: 'critter', isSource: false, villain: (name) => name.toLowerCase() === vd, prop }), (name) => {
        const n = name.toLowerCase();
        return on.has(n) || (n.startsWith('k') && on.has(n.slice(1)));
      });
    const petCtx = thisPet();
    const next = new Map(own);
    const nextCond = new Map<string, { power: Power; when: string }>();
    for (const e of entries) {
      for (const effs of [e.power.eff, e.power.act]) {
        walkChains(effs, [], (m, chain) => {
          const gives = m.a.some((a) => grant.has(a));
          const takes = m.a.includes(revoke);
          if ((!gives && !takes) || !namesPet(chain)) return;
          const ids = (m.pw ?? []).map((id) => gd.powerById.get(id)).filter((p): p is Power => !!p);
          if (chain.every((r) => evalRequires(r as string[], petCtx))) {
            for (const p of ids) {
              if (takes) next.delete(p.n);
              else next.set(p.n, p);
            }
            return;
          }
          // a grant that needs a meter past a mark: kept with its condition
          const tests = meterTests(chain);
          if (!gives || !tests.length) return;
          const meters = new Map(tests.map((t) => [t.name, t.op.startsWith('>') ? t.value + 1e-3 : t.value - 1e-3]));
          // the same pet with its meters just past their marks
          const marked = thisPet((n) => meters.get(n));
          if (!chain.every((r) => evalRequires(r as string[], marked))) return;
          const when = `while its ${tests.map((t) => `${t.shown} is ${t.op.startsWith('>') ? 'above' : 'below'} ${t.value}`).join(' and ')}`;
          for (const p of ids) {
            const had = nextCond.get(p.n);
            nextCond.set(p.n, { power: p, when: had && had.when !== when ? `${had.when} or ${when.replace(/^while its /, '')}` : when });
          }
        });
      }
    }
    for (const n of next.keys()) nextCond.delete(n);
    powers = next;
    cond = nextCond;
    const sig = [...next.keys(), '|', ...nextCond.keys()].join(',');
    if (sig === last) break;
    last = sig;
  }
  return { powers, cond, modes: modesOf(powers) };
}

/**
 * One pet's card: its stats (petstats.ts) and, through the power info run as the pet, its attacks
 * and what its other powers do.
 *
 * @param gd Game data.
 * @param file The real pets file.
 * @param at The character's archetype.
 * @param v The pet and the power that makes it.
 * @param level 0-based level.
 * @param input What its stats read besides itself (the build's pets, the creator's running powers).
 * @return The card.
 */
function card(gd: GameData, file: HenchmenFile, at: Archetype, v: Variant, level: number, input: PetStatsInput): PetCard {
  const cls = classOf(at, v);
  const run: RunAs = { cls, creator: at.n };
  const name = v.kind.dn || v.e.power.dn;
  const own = [...v.powers.powers.values()];
  const stats = petStats(input, { key: v.key, name, cls, count: v.source.count, powers: own, strength: v.strength, ctx: petCtxOf(cls, at, level, v.powers.modes), vd: v.kind.vd, grp: v.kind.grp });

  // attacks and other powers, as the power info lists them for the pet
  const attacks: PetAttack[] = [];
  const others: PetPowerLines[] = [];
  const hp = gd.attribByName.get('HitPoints') ?? 80;
  const d0 = gd.attribByName.get('DefenseType00') ?? 104;
  const allDef = gd.attribByName.get('Defense') ?? d0 + 80;
  const regen = gd.attribByName.get('Regeneration') ?? 232;
  // the pet's own resistance, defense and regeneration are its stats': its other powers' lines leave
  // them out (the Maintenance Drone's "can't regenerate", -1000000 x Melee_Ones, reads as none there)
  const selfResDef = (m: Mod, a: number) =>
    m.tg === 'Caster' && ((m.asp === 'Resistance' && a >= 0 && a < hp) || (m.asp === 'Current' && ((a >= d0 && a <= allDef) || a === regen)));
  const listed: [Power, string | undefined][] = [
    ...own.map((p): [Power, undefined] => [p, undefined]),
    ...[...v.powers.cond.values()].map(({ power, when }): [Power, string] => [power, when]),
  ];
  for (const [p, when] of listed) {
    // the client's power info lists neither a hidden power (costume and mode changes) nor, here, one
    // that only lasts a while after the pet spawns (Materialization)
    if (p.si === 0 || p.life) continue;
    const info = powerInfo(gd, at, p, level, v.strength, { ...run, omit: selfResDef, noFlagNotes: true });
    const num = info.numbers;
    // an attack hurts foes (the Maintenance Drone's Repair takes its own hit points to heal a friend)
    if (num.damage.base > 0 && (p.ea ?? [p.tgt]).includes('Foe')) {
      const dpa = (x: number) => (num.cast > 0 ? x / num.cast : 0);
      attacks.push({
        power: p,
        name: p.dn,
        type: p.type,
        damage: num.damage,
        cast: num.cast,
        recharge: num.recharge,
        dpa: { base: dpa(num.damage.base), enh: dpa(num.damage.enh) },
        lines: info.effects,
        ...(when ? { when } : {}),
      });
      continue;
    }
    // a power that makes pets of its own (Upgrade Robot's Seeker Drones) says what it makes
    const lines = [...info.effects, ...summonLines(file, p.n)];
    if (lines.length) others.push({ power: p, name: p.dn, lines, ...(when ? { when } : {}) });
  }
  return { key: `${v.e.power.id}:${v.key}`, name, sources: [v.source], level, run, strength: v.strength, stats, attacks, powers: others };
}

/**
 * The lines saying what pets a pet's power makes ("Summons 2 Seeker Drone for 4m"), from the real
 * pets file.
 *
 * @param file The real pets file.
 * @param power The pet's power.
 * @return One line per kind of pet it makes (none for a power that makes none).
 */
function summonLines(file: HenchmenFile, power: string): InfoEffect[] {
  const byKind = new Map<string, { dn: string; n: number; dur?: number }>();
  for (const m of file.makes[power] ?? []) {
    const kind = file.pets[m.pet];
    if (!kind) continue;
    const k = byKind.get(kind.dn) ?? { dn: kind.dn, n: 0, ...(m.dur ? { dur: m.dur } : {}) };
    k.n++;
    byKind.set(kind.dn, k);
  }
  return [...byKind.values()].map((k) => ({
    line: [{ text: `Summons ${k.n} ${k.dn}${k.dur ? ` for ${prettyDuration(k.dur)}` : ''}` }],
    notes: [],
  }));
}
