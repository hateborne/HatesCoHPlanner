/**
 * Golden numbers, the builds and what is recorded of them (tests/goldennumbers.test.ts; the format
 * is in golden.ts).
 *
 * The builds are made once and kept as share links: the forum builds, the links on record
 * (links.ts), and the sweep. For every archetype the sweep makes a build of each starting power
 * set, and further builds that take each pool, epic pool and branch set first; each is leveled to
 * 50 by the first choice on every screen and then slotted by a fixed rule.
 *
 * What is recorded of a build is what the screens show of it: its totals in combat, what differs
 * out of combat, the same as a level 30 exemplar, its damage boosts, each power's slotted
 * enhancements, their strength and its power info, and its pets' cards. The builds kept in full
 * also record their rule issues.
 */
import type { GameData } from '../../src/data/gamedata.ts';
import type { Archetype, Power, Powerset } from '../../src/data/types.ts';
import { setEnh, setOn } from '../../src/engine/actions.ts';
import { damageBoost, type DamageBoost } from '../../src/engine/boost.ts';
import { newBuild, type Build, type SlottedEnh } from '../../src/engine/build.ts';
import { boostHelpText, effectiveness, enhKind, enhLines, powerStrength } from '../../src/engine/enhance.ts';
import { enhFor, pieceFor } from '../../src/engine/finder/candidates.ts';
import { setsOfPower } from '../../src/engine/finder/eligible.ts';
import { petCards } from '../../src/engine/petcards.ts';
import { powerInfo } from '../../src/engine/powerinfo.ts';
import { BuildRules, MAX_LEVEL, setsGoTogether, startingSets, type BuildEntry } from '../../src/engine/rules.ts';
import { computeTotals } from '../../src/engine/totals.ts';
import { differences, digest, flatten, plain, type Plain } from './golden.ts';
import { walkTo50 } from './walk.ts';

// the level a build's totals are also recorded at, as an exemplar (0-based: level 30)
const EXEMPLAR_LEVEL = 29;
// the levels every power's unenhanced power info is recorded at (0-based: levels 50 and 10)
const INFO_LEVELS = [MAX_LEVEL, 9] as const;
// the pieces of one enhancement set a power takes: all its slots' worth, or half when it splits them
const WHOLE_BOOSTSET = 6;
const HALF_BOOSTSET = 3;
// one power in this many splits its slots between two enhancement sets, three pieces of each
const SPLIT_EVERY = 3;
// one power in this many takes no set piece: common IOs and origin enhancements only
const COMMONS_EVERY = 5;
// the most boosters a slotted enhancement is given (the game's +5)
const MAX_BOOSTERS = 5;
// the highest relative level an origin enhancement is given (the game's +3)
const MAX_RELATIVE_LEVEL = 3;
// one click power in this many is switched on, so the totals count some clicks
const CLICK_ON_EVERY = 3;
// the pool sets a build of the sweep takes first, beside one epic pool
const POOLS_PER_BUILD = 2;

/** A build the sweep makes: its name on record, and what it is leveled with. */
export interface SweepBuild {
  // "archetype/<archetype>" for an archetype's first pair (recorded in full), "pair/<archetype>/
  // <primary>/<secondary>" for its other pairs, "pool/<archetype>/<the sets taken first>" for the rest
  name: string;
  archetype: Archetype; // the archetype it is leveled as
  primary: Powerset; // its primary power set
  secondary: Powerset; // its secondary power set
  prefer: Powerset[]; // the pool, epic and branch sets it takes from before its primary (none: a plain pair)
}

/** A primary and a secondary power set the game lets one character have. */
interface PowersetPair {
  primary: Powerset; // the primary power set
  secondary: Powerset; // the secondary power set
}

/**
 * The builds the sweep covers on a version.
 *
 * 1. For every archetype, each of its starting primary and secondary power sets, paired in turn. A
 *    pair the game forbids (setsGoTogether: a server may keep some sets apart) takes the next
 *    secondary that goes with that primary, as New Build would have the player do.
 * 2. For every archetype, builds that take two pool sets, an epic pool and the archetype's branch
 *    sets before anything else, in turn, until each such set has been taken first once: a plain
 *    walk only reaches a pool once its primary and secondary run out.
 *
 * @param gd Game data.
 * @return The builds to make, an archetype's first pair first, each name once.
 */
export function sweepBuilds(gd: GameData): SweepBuild[] {
  const out = new Map<string, SweepBuild>();
  const add = (build: SweepBuild) => {
    if (!out.has(build.name)) out.set(build.name, build);
  };
  for (const archetype of gd.core.archetypes) {
    const pairs = startingPairs(gd, archetype);
    pairs.forEach((pair, index) => {
      const name = index === 0 ? `archetype/${archetype.n}` : `pair/${archetype.n}/${pair.primary.n}/${pair.secondary.n}`;
      add({ name, archetype, ...pair, prefer: [] });
    });
    if (pairs.length === 0) continue;
    preferredSets(gd, archetype, pairs[0]!).forEach((prefer, index) => {
      const name = `pool/${archetype.n}/${prefer.map((powerset) => powerset.n).join('+')}`;
      add({ name, archetype, ...pairs[index % pairs.length]!, prefer });
    });
  }
  return [...out.values()];
}

/**
 * An archetype's starting power sets, paired in turn (sweepBuilds, 1).
 *
 * @param gd Game data.
 * @param archetype The archetype.
 * @return The pairs, each once; none for an archetype New Build offers no sets.
 */
function startingPairs(gd: GameData, archetype: Archetype): PowersetPair[] {
  const primaries = startingSets(gd, archetype.cats.pri, archetype);
  const secondaries = startingSets(gd, archetype.cats.sec, archetype);
  const pairs = new Map<string, PowersetPair>();
  for (let index = 0; index < Math.max(primaries.length, secondaries.length) && primaries.length > 0; index++) {
    const primary = primaries[index % primaries.length]!;
    const secondary = secondaries.map((_, step) => secondaries[(index + step) % secondaries.length]!).find((candidate) => setsGoTogether(gd, archetype, primary, candidate));
    if (secondary) pairs.set(`${primary.id}/${secondary.id}`, { primary, secondary });
  }
  return [...pairs.values()];
}

/**
 * The sets each further build of an archetype takes first (sweepBuilds, 2).
 *
 * @param gd Game data.
 * @param archetype The archetype.
 * @param pair A pair of its starting power sets, to ask the rules what a character of it is offered.
 * @return One list per build: a branch set of its primary and of its secondary (an archetype that
 *   has them), two pool sets and an epic pool, each kind taken in turn.
 */
function preferredSets(gd: GameData, archetype: Archetype, pair: PowersetPair): Powerset[][] {
  const pickCount = gd.core.schedule.power.length;
  const blank = newBuild({ dataVersion: gd.core.manifest.dataVersion, at: archetype.id, origin: gd.core.origins[0]!.id, alignment: 'Hero', primary: pair.primary.id, secondary: pair.secondary.id, pickCount });
  const rules = new BuildRules(gd, blank);
  // what the last pick of a character with no pool yet could add
  const offered = (kind: 'pool' | 'epic') => rules.newSetChoices(kind, pickCount - 1).filter((choice) => choice.block === null).map((choice) => choice.set);
  const pools = offered('pool');
  const epics = offered('epic');
  const branches = [archetype.cats.pri, archetype.cats.sec].map((category) => gd.setsInCategory(category).filter((powerset) => powerset.spa));
  const inTurn = (powersets: Powerset[], index: number) => (powersets.length > 0 ? [powersets[index % powersets.length]!] : []);
  const builds = Math.max(Math.ceil(pools.length / POOLS_PER_BUILD), epics.length, ...branches.map((list) => list.length));
  const out: Powerset[][] = [];
  for (let index = 0; index < builds; index++) {
    const prefer = [...branches.flatMap((list) => inTurn(list, index)), ...inTurn(pools, POOLS_PER_BUILD * index), ...inTurn(pools, POOLS_PER_BUILD * index + 1), ...inTurn(epics, index)];
    out.push([...new Set(prefer)]);
  }
  return out;
}

/**
 * Make one of the sweep's builds: leveled to 50 by the first choice on every screen, then slotted.
 *
 * @param gd Game data.
 * @param sweep Which build.
 * @return The build.
 */
export function makeSweepBuild(gd: GameData, sweep: SweepBuild): Build {
  const walked = walkTo50(gd, sweep.archetype.n, sweep.primary.id, sweep.secondary.id, 'Hero', sweep.prefer.map((powerset) => powerset.id));
  return slotEverything(gd, walked);
}

/** A common enhancement the slotting rule may fall back on. */
interface CommonBoost {
  boost: Power; // the enhancement, as the game data defines it
  origin: boolean; // an origin enhancement (it has a relative level), not a common IO
}

/**
 * Fill a build's slots by a fixed rule, and switch some of its click powers on.
 *
 * The rule only has to be the same every time and reach every kind of enhancement:
 * 1. Power number k takes pieces of the k-th enhancement set it accepts (counting round): six of
 *    it, or, for one power in three, three of it and three of the next set. They are attuned for
 *    odd k and crafted at the build's cap for even k, with 0 to 5 boosters where a piece takes them.
 * 2. One power in five takes no set piece, and so does a slot no set piece may go in: a common IO
 *    (tried first for an even slot) or an origin enhancement (first for an odd slot) that the
 *    power accepts, the latter at a relative level of 0 to +3.
 * 3. Only what the game would take is placed (BuildRules.enhRefusal); a slot nothing fits stays empty.
 * 4. One click power in three is switched on.
 *
 * @param gd Game data.
 * @param start The build, with its slots placed and empty.
 * @return The slotted build.
 */
export function slotEverything(gd: GameData, start: Build): Build {
  let build = start;
  const lastLevel = build.endLevel ?? MAX_LEVEL;
  const commons: CommonBoost[] = [];
  for (const boost of gd.boosts) {
    const kind = enhKind(gd, boost);
    if (kind === 'Invention' || kind === 'Origin') commons.push({ boost, origin: kind === 'Origin' });
  }
  new BuildRules(gd, build).entries().forEach((first, powerIndex) => {
    for (let slotIndex = 0; slotIndex < first.slots.length; slotIndex++) {
      const rules = new BuildRules(gd, build);
      const entry = rules.entries().find((other) => other.key === first.key);
      if (!entry) return;
      for (const enh of candidates(gd, commons, entry.power, powerIndex, slotIndex, lastLevel)) {
        if (rules.enhRefusal(entry, slotIndex, enh) !== null) continue;
        build = setEnh(build, entry.key, slotIndex, enh, entry.level);
        break;
      }
    }
    if (first.power.type === 'Click' && powerIndex % CLICK_ON_EVERY === 0) build = setOn(build, first.key, /*on=*/ true);
  });
  return build;
}

/**
 * The enhancements the slotting rule would put in one slot, best first (slotEverything, 1 and 2).
 *
 * @param gd Game data.
 * @param commons Every common IO and origin enhancement of the data.
 * @param power The power the slot is on.
 * @param powerIndex The power's place among the build's powers.
 * @param slotIndex The slot's place on the power.
 * @param lastLevel The build's last level (0-based).
 * @return The set piece with boosters, the same piece without, then every common enhancement from a
 *   start that moves with the power and the slot (origin enhancements first for an odd slot, common
 *   IOs first for an even one); made one at a time, as most slots take the first.
 */
function* candidates(gd: GameData, commons: readonly CommonBoost[], power: Power, powerIndex: number, slotIndex: number, lastLevel: number): Generator<SlottedEnh> {
  const boostsets = setsOfPower(gd, power.id);
  if (boostsets.length > 0 && powerIndex % COMMONS_EVERY !== COMMONS_EVERY - 1) {
    const pieces = powerIndex % SPLIT_EVERY === 1 ? HALF_BOOSTSET : WHOLE_BOOSTSET;
    const boostset = boostsets[(powerIndex + Math.floor(slotIndex / pieces)) % boostsets.length]!;
    const boost = pieceFor(gd, boostset, slotIndex % boostset.slots.length, /*attuned=*/ powerIndex % 2 === 1);
    if (boost) {
      const enh = enhFor(gd, boost, lastLevel);
      const boosters = (powerIndex + slotIndex) % (MAX_BOOSTERS + 1);
      if (boosters > 0) yield { ...enh, boosters };
      yield enh;
    }
  }
  // odd slots try the origin enhancements first and even slots the common IOs, so both kinds get slotted
  for (const origin of [slotIndex % 2 === 1, slotIndex % 2 !== 1]) {
    for (let offset = 0; offset < commons.length; offset++) {
      const common = commons[(powerIndex + slotIndex + offset) % commons.length]!;
      if (common.origin !== origin) continue;
      const enh = enhFor(gd, common.boost, lastLevel);
      // a relative level of 0 is left unset, as the planner and a link leave it
      const rel = (powerIndex + slotIndex) % (MAX_RELATIVE_LEVEL + 1);
      yield common.origin && rel > 0 ? { ...enh, rel } : enh;
    }
  }
}

/**
 * The enhancement sets none of some builds has a piece of.
 *
 * @param gd Game data.
 * @param builds The builds.
 * @return Those sets' internal names, in alphabetical order.
 */
export function unslottedBoostsets(gd: GameData, builds: readonly Build[]): string[] {
  const held = new Set<number>();
  for (const build of builds) {
    const slots = [...build.picks.flatMap((pick) => pick?.slots ?? []), ...Object.values(build.granted).flatMap((granted) => granted.slots)];
    for (const slot of slots) {
      const boostset = slot.enh ? gd.boostSetOf.get(slot.enh.boost)?.set : undefined;
      if (boostset) held.add(boostset.id);
    }
  }
  return gd.boostSets.filter((boostset) => !held.has(boostset.id)).map((boostset) => boostset.n).sort();
}

/**
 * What the screens show of a build, as plain data.
 *
 * The rule issues take most of the time a record takes (every rule is tried on every pick and
 * slot), and they are rules, not figures: the builds kept in full have them, the hundreds kept as
 * digests leave them to tests/invariants.test.ts, which walks every power set.
 *
 * @param gd Game data (with its pets, info and real pets files, when the version has them).
 * @param build The build.
 * @param withIssues Whether the record holds the build's rule issues.
 * @return The record: what the build is, its rule issues, totals, damage boosts, powers and pets.
 */
export function buildRecord(gd: GameData, build: Build, withIssues: boolean): Plain {
  const rules = new BuildRules(gd, build);
  const lastLevel = build.endLevel ?? MAX_LEVEL;
  const totals: Record<string, Plain> = {};
  addTotals(totals, `level ${lastLevel + 1}`, gd, build, lastLevel);
  // as the planner shows a build exemplared down: the build itself says it is an exemplar
  if (lastLevel > EXEMPLAR_LEVEL) addTotals(totals, `level ${EXEMPLAR_LEVEL + 1} as an exemplar`, gd, { ...build, exemplar: EXEMPLAR_LEVEL }, EXEMPLAR_LEVEL);
  const damageBoosts = damageBoost(gd, rules, lastLevel);
  const powers: Record<string, unknown> = {};
  for (const entry of rules.entries()) powers[`${entry.key} ${entry.power.n}`] = powerRecord(gd, rules.at, entry, lastLevel, damageBoosts);
  const record = {
    build: {
      archetype: rules.at.n,
      origin: gd.core.origins.find((origin) => origin.id === build.origin)?.n,
      alignment: build.alignment,
      primary: gd.powerset(build.primary).n,
      secondary: gd.powerset(build.secondary).n,
      exemplar: build.exemplar,
      endLevel: build.endLevel,
      respecTo: build.respecTo,
      petOn: build.petOn,
    },
    issues: withIssues ? rules.issues() : undefined,
    totals,
    boost: damageBoosts,
    powers,
    pets: petCards(gd, rules, build, lastLevel),
  };
  return plain(record) ?? null;
}

/**
 * Record a build's totals at a level: in combat in full, and what differs out of combat.
 *
 * @param totals The record's totals, added to.
 * @param title What the totals are of ("level 50").
 * @param gd Game data.
 * @param build The build, as the planner would hold it for these totals.
 * @param level The level they are worked out at (0-based).
 */
function addTotals(totals: Record<string, Plain>, title: string, gd: GameData, build: Build, level: number): void {
  const rules = new BuildRules(gd, build);
  const inCombat = plain(computeTotals(gd, rules, build, level, /*outOfCombat=*/ false)) ?? null;
  const outOfCombat = plain(computeTotals(gd, rules, build, level, /*outOfCombat=*/ true)) ?? null;
  totals[`${title} in combat`] = inCombat;
  // nearly all of it is the same out of combat, so only what differs is written down
  totals[`${title} out of combat, where it differs`] = differences(inCombat, outOfCombat) ?? {};
}

/**
 * What is recorded of one power of a build: its slots, its enhancement strength and its power info.
 *
 * @param gd Game data.
 * @param archetype The build's archetype.
 * @param entry The power as the build has it.
 * @param lastLevel The build's last level (0-based): everything is worked out at it.
 * @param damageBoosts The build's damage boosts, counted in the power info as the screens count them.
 * @return The power's record, not yet plain.
 */
function powerRecord(gd: GameData, archetype: Archetype, entry: BuildEntry, lastLevel: number, damageBoosts: DamageBoost): unknown {
  const slotted = entry.slots.filter((slot) => slot.level <= lastLevel).map((slot) => slot.enh);
  const strength = powerStrength(gd, archetype, entry.power, slotted, lastLevel);
  const slots = entry.slots.map((slot) => {
    const enh = slot.enh;
    const definition = enh ? gd.powerById.get(enh.boost) : undefined;
    if (!enh || !definition) return { level: slot.level };
    return {
      level: slot.level,
      boost: definition.n,
      ioLevel: enh.ioLevel,
      rel: enh.rel,
      boosters: enh.boosters,
      effectiveness: effectiveness(gd, definition, enh, lastLevel),
      lines: enhLines(gd, archetype, entry.power, enh, lastLevel),
      help: boostHelpText(gd, archetype, enh, lastLevel),
    };
  });
  return {
    level: entry.level,
    on: entry.on,
    slots,
    strength,
    info: powerInfo(gd, archetype, entry.power, lastLevel, strength.post, /*runAs=*/ undefined, damageBoosts),
  };
}

/**
 * One power's unenhanced power info at two levels, as plain data.
 *
 * @param gd Game data.
 * @param archetype The archetype (its tables, its class requirements).
 * @param power The power.
 * @return The record: the power info at level 50 and at level 10.
 */
export function infoRecord(gd: GameData, archetype: Archetype, power: Power): Plain {
  const record: Record<string, unknown> = {};
  for (const level of INFO_LEVELS) record[`level ${level + 1}`] = powerInfo(gd, archetype, power, level, /*enh=*/ null);
  return plain(record) ?? null;
}

/** Every power's info digest on a version: archetype -> power set -> the power's own name -> digest. */
export type InfoDigests = Record<string, Record<string, Record<string, string>>>;

/**
 * The power sets an archetype's powers come from: its primaries, secondaries, pools, epic pools
 * and inherent sets.
 *
 * @param gd Game data.
 * @param archetype The archetype.
 * @return Those power sets, each once.
 */
export function powersetsOf(gd: GameData, archetype: Archetype): Powerset[] {
  const categories = [archetype.cats.pri, archetype.cats.sec, archetype.cats.pool, archetype.cats.epic, archetype.cats.inherent];
  return [...new Set(categories.flatMap((category) => gd.setsInCategory(category)))];
}

/**
 * The digest of every power's unenhanced power info, for every archetype that can own the power.
 *
 * @param gd Game data.
 * @param dump Called with each record's name and lines, for a full dump (none: digests only).
 * @return The digests.
 */
export function infoDigests(gd: GameData, dump?: (name: string, lines: string[]) => void): InfoDigests {
  const out: InfoDigests = {};
  for (const archetype of gd.core.archetypes) {
    const byPowerset: Record<string, Record<string, string>> = {};
    for (const powerset of powersetsOf(gd, archetype)) {
      const byPower: Record<string, string> = {};
      for (const id of powerset.p) {
        const power = gd.power(id);
        const lines = flatten(infoRecord(gd, archetype, power));
        byPower[power.n.startsWith(`${powerset.n}.`) ? power.n.slice(powerset.n.length + 1) : power.n] = digest(lines);
        dump?.(`info/${archetype.n}/${power.n}`, lines);
      }
      byPowerset[powerset.n] = byPower;
    }
    out[archetype.n] = byPowerset;
  }
  return out;
}
