/**
 * Power-pick, auto-grant and slot rules, ported from the engine (see docs/game-rules.md).
 *
 * A BuildRules instance is a read-only view over one Build: create a new one after every edit.
 */
import { GameData } from '../data/gamedata.ts';
import type { Archetype, Power, Powerset } from '../data/types.ts';
import { toAlignment, type Build, type Pick, type Slot, type SlottedEnh } from './build.ts';
import { canSlot, ioLevelRange, levelsAbove, shortName } from './enhance.ts';
import { evalRequires, type EvalContext } from './requires.ts';
import { countAtLevel, countForLevel } from './schedule.ts';
import { isExclusiveToggle } from './totals.ts';

export const MAX_LEVEL = 49;
export const MAX_BOUGHT_SLOTS = 5;

export type SetKind = 'primary' | 'secondary' | 'branch' | 'pool' | 'epic' | 'inherent' | 'other';
export type PowerState = 'owned' | 'available' | 'unavailable';

/** A power as shown on a "Choose a New Power" panel. */
export interface PowerOption {
  power: Power;
  av: number;
  state: PowerState;
  reason?: string;
}

/** One powerset column/section on the power-pick screen. */
export interface SetOption {
  set: Powerset;
  kind: SetKind;
  column: 0 | 1 | 2; // screen column: primary category, secondary category, everything else
  owned: boolean;
  powers: PowerOption[];
}

/** A power that exists in the build (picked or auto-granted) with its slots. */
export interface BuildEntry {
  key: string; // 'pick:<index>' | 'grant:<powerId>'
  power: Power;
  level: number;
  slots: Slot[]; // includes the free slot first when the power is slottable
  source: 'pick' | 'grant';
  pickIndex?: number;
  on?: boolean;
}

export interface Issue {
  key: string; // entry key or 'build'
  slot?: number;
  message: string;
}

const INHERENT_SETS = ['Inherent.Inherent', 'Inherent.Fitness'];
// Badges a plan takes as earned (`Owned?`): the Patron arcs' accolades. Any one of them opens all
// four Patron Power Pools (each pool's first two powers ask for one), and a character keeps them
// after changing alignment, so a build planning a Patron pool has done an arc. Every other badge
// counts as not earned (the veteran sprints' VetSprints, the beta server's Beta_AutoLevel50).
const PLANNED_BADGES = new Set(['spiderskisspatron', 'thestingerpatron', 'bloodinthewaterpatron', 'miragepatron']);

/**
 * Whether a set is a Patron Power Pool: one of its powers asks for a Patron arc's accolade.
 *
 * @param gd Game data.
 * @param set The set.
 * @return True for the Patron pools (Leviathan, Mace, Mu and Soul Mastery, every archetype's).
 */
export function isPatronSet(gd: GameData, set: Powerset): boolean {
  return set.p.some((pid) => {
    const br = gd.power(pid).br ?? [];
    return br.some((t, i) => PLANNED_BADGES.has(t.toLowerCase()) && br[i + 1]?.toLowerCase() === 'owned?');
  });
}

// the Homecoming wiki's page on the Patron pools, linked from the hero note
export const PATRON_WIKI = 'https://homecoming.wiki/wiki/Patron_Power_Pools';

/**
 * What a hero build choosing a Patron pool should know: in game the pools unlock through a villain
 * story arc.
 *
 * @param gd Game data.
 * @param b The build.
 * @param set The epic set chosen.
 * @return The note, with "Patron pool" linking to the wiki's page, or null when there is nothing
 *   to say (not a Patron pool, or not a hero).
 */
export function patronArcNote(gd: GameData, b: Build, set: Powerset): { text: string; link: { phrase: string; href: string } } | null {
  if (toAlignment(b.alignment) !== 'Hero' || !isPatronSet(gd, set)) return null;
  return {
    text: `${set.dn} is a Patron pool. In the game, Patron pools unlock by finishing a Patron story arc, a villain arc offered from level 35. Heroes have to switch to villain to run it; the pools stay unlocked after switching back.`,
    link: { phrase: 'Patron pool', href: PATRON_WIKI },
  };
}

/**
 * The power sets a new character can start with in a category (New Build's lists).
 *
 * The game's own tests at level 1: SetRequires (false for a set the game hides, such as Wind
 * Control) and SetBuyRequires. VEAT branches (SpecializeAt) and empty sets are left out.
 *
 * @param gd Game data.
 * @param cat The category (the archetype's primary or secondary).
 * @param at The archetype.
 * @return The sets, in the data's order.
 */
export function startingSets(gd: GameData, cat: string, at: Archetype): Powerset[] {
  const ctx: EvalContext = {
    ownsPower: () => false,
    ownsSet: () => false,
    prop: (n: string) => (n === 'archetype' ? at.n : n === 'level' ? 1 : 0),
  };
  return gd
    .setsInCategory(cat)
    .filter((s) => !s.spa && s.p.length > 0 && evalRequires(s.sr, ctx) && evalRequires(s.sbr, ctx))
    .filter((s) => s.av.some((a) => a === 0));
}

export class BuildRules {
  readonly at: Archetype;
  readonly pickLevels: number[];
  private grantedCache: Map<number, number> | null = null;
  private slottedCache: { counts: Map<string, number>; ctx: EvalContext } | null = null;

  constructor(
    readonly gd: GameData,
    readonly b: Build,
  ) {
    this.at = gd.archetype(b.at);
    this.pickLevels = gd.core.schedule.power;
  }

  // ---- basic lookups ---------------------------------------------------------------------------

  /** @return The 0-based level of pick `i`. */
  pickLevel(i: number): number {
    return this.pickLevels[i] ?? MAX_LEVEL;
  }

  /** @return How the build relates to a powerset (primary, pool, branch, ...). */
  setKind(set: Powerset): SetKind {
    if (set.id === this.b.primary) return 'primary';
    if (set.id === this.b.secondary) return 'secondary';
    const cat = this.gd.categoryOfSet.get(set.id) ?? '';
    const cats = this.at.cats;
    if (cat === cats.pri || cat === cats.sec) return set.spa ? 'branch' : 'other';
    if (cat === cats.pool) return 'pool';
    if (cat === cats.epic) return 'epic';
    if (cat === cats.inherent) return 'inherent';
    return 'other';
  }

  /**
   * The screen column a set is drawn in. The client places sets by their category (pcatParent):
   * the AT's primary category (the primary and its VEAT branches), its secondary category, and
   * everything else (pools, epics, inherents).
   *
   * @param set The powerset.
   * @return 0, 1 or 2.
   */
  column(set: Powerset): 0 | 1 | 2 {
    const cat = this.gd.categoryOfSet.get(set.id) ?? '';
    if (cat === this.at.cats.pri) return 0;
    if (cat === this.at.cats.sec) return 1;
    return 2;
  }

  /** @return Whether a power can take enhancement slots at all. */
  slottable(p: Power): boolean {
    return (p.maxB ?? 0) > 0 && (p.ba?.length ?? 0) > 0;
  }

  /** @return Picks with a power, at or below level L, optionally excluding one pick index. */
  picksAt(level: number, exclude?: number): { i: number; pick: Pick }[] {
    const out: { i: number; pick: Pick }[] = [];
    this.b.picks.forEach((pick, i) => {
      if (pick && i !== exclude && pick.level <= level) out.push({ i, pick });
    });
    return out;
  }

  /** @return Powerset ids owned at level L given a set of owned powers. */
  ownedSets(owned: Set<number>): Set<number> {
    const sets = new Set<number>([this.b.primary, this.b.secondary]);
    for (const n of INHERENT_SETS) {
      const s = this.gd.setByName.get(n.toLowerCase());
      if (s) sets.add(s.id);
    }
    for (const pid of owned) {
      const ref = this.gd.setOfPower.get(pid);
      if (ref) sets.add(ref.set.id);
    }
    return sets;
  }

  /**
   * Evaluation context for requirement expressions at a level.
   *
   * @param level 0-based level.
   * @param owned Power ids owned at that level.
   */
  ctx(level: number, owned: Set<number>): EvalContext {
    const ownedSets = this.ownedSets(owned);
    const origin = this.gd.core.origins.find((o) => o.id === this.b.origin);
    const align = toAlignment(this.b.alignment).toLowerCase();
    return {
      ownsPower: (name) => {
        const p = this.gd.powerByName.get(name.toLowerCase());
        return !!p && owned.has(p.id);
      },
      hasBadge: (name) => PLANNED_BADGES.has(name.toLowerCase()),
      ownsSet: (name) => {
        const s = this.gd.setByName.get(name.toLowerCase());
        return !!s && ownedSets.has(s.id);
      },
      ownsPowerNum: (name) => {
        const n = name.toLowerCase();
        const p = this.gd.powerByName.get(n);
        if (p) return owned.has(p.id) ? 1 : 0;
        let count = 0;
        for (const pid of owned) {
          const ref = this.gd.setOfPower.get(pid);
          if (!ref) continue;
          const cat = (this.gd.categoryOfSet.get(ref.set.id) ?? '').toLowerCase();
          if (cat === n || ref.set.n.toLowerCase() === n) count++;
        }
        return count;
      },
      prop: (name) => {
        // engine: anything starting with "arch" or "rank" is the class name ($archtype appears in data)
        if (name.startsWith('arch') || name.startsWith('rank')) return this.at.n;
        switch (name) {
          case 'class':
            return this.at.n;
          case 'origin':
            return origin?.n ?? '';
          case 'level':
            return level + 1;
          case 'alignment':
            return align === 'villain' ? 'villain' : 'hero';
          case 'type':
            return align === 'villain' ? 'villain' : 'hero';
          case 'subtype':
            return align === 'praetorian' ? 'paragon' : 'normal';
          default:
            return 0;
        }
      },
      targetEntType: 'critter',
    };
  }

  // ---- auto-granted powers ---------------------------------------------------------------------

  /**
   * Auto-issued powers and the level each is granted (engine character_GrantAutoIssuePowers,
   * run level by level to a fixpoint).
   *
   * @return Map of power id to 0-based grant level.
   */
  granted(): Map<number, number> {
    if (this.grantedCache) return this.grantedCache;
    const granted = new Map<number, number>();
    const picked = new Map<number, number>();
    this.b.picks.forEach((p) => {
      if (p) picked.set(p.power, p.level);
    });
    for (let level = 0; level <= MAX_LEVEL; level++) {
      let changed = true;
      while (changed) {
        changed = false;
        const owned = new Set<number>();
        for (const [pid, l] of picked) if (l <= level) owned.add(pid);
        for (const pid of granted.keys()) owned.add(pid);
        const ctx = this.ctx(level, owned);
        for (const sid of this.ownedSets(owned)) {
          const set = this.gd.setById.get(sid);
          if (!set) continue;
          set.p.forEach((pid, idx) => {
            if (owned.has(pid) || granted.has(pid)) return;
            const p = this.gd.powerById.get(pid);
            if (!p || !p.auto) return;
            const av = set.av[idx] ?? 0;
            if (av > level) return;
            if (!evalRequires(p.br, ctx)) return;
            granted.set(pid, level);
            changed = true;
          });
        }
      }
    }
    this.grantedCache = granted;
    return granted;
  }

  /** @return Power ids owned at a level (picks at or below it plus grants), minus one pick. */
  ownedAt(level: number, excludePick?: number): Set<number> {
    const owned = new Set<number>();
    for (const { pick } of this.picksAt(level, excludePick)) owned.add(pick.power);
    for (const [pid, l] of this.granted()) if (l <= level) owned.add(pid);
    return owned;
  }

  // ---- picking powers --------------------------------------------------------------------------

  /** @return Pool (or epic) sets owned through picks at or below a level. */
  private ownedOfKind(kind: SetKind, level: number, excludePick?: number): Set<number> {
    const out = new Set<number>();
    for (const { pick } of this.picksAt(level, excludePick)) {
      const ref = this.gd.setOfPower.get(pick.power);
      if (ref && this.setKind(ref.set) === kind) out.add(ref.set.id);
    }
    return out;
  }

  /**
   * Whether a new (not yet owned) pool/epic/branch set may be added at this pick.
   *
   * @param set Candidate set.
   * @param pickIndex Pick being made.
   * @return Null when allowed, otherwise the reason.
   */
  newSetBlock(set: Powerset, pickIndex: number): string | null {
    const level = this.pickLevel(pickIndex);
    const kind = this.setKind(set);
    const owned = this.ownedAt(level, pickIndex);
    const ctx = this.ctx(level, owned);
    if (!evalRequires(set.sr, ctx)) return 'Not available';
    if (kind === 'pool' || kind === 'epic') {
      const sched = kind === 'pool' ? this.gd.core.schedule.pool : this.gd.core.schedule.epic;
      const have = this.ownedOfKind(kind, level, pickIndex);
      if (have.has(set.id)) return null;
      if (have.size >= countForLevel(level, sched)) {
        return kind === 'pool' ? 'No more power pools at this level' : 'No epic pool at this level';
      }
    } else if (kind === 'branch') {
      if (this.specLevel(level) < (set.spa ?? 0)) return `Available at level ${(set.spa ?? 0) + 1}`;
      if (!evalRequires(set.spr, ctx)) return 'Another specialization is chosen';
    } else if (kind !== 'primary' && kind !== 'secondary') {
      return 'Not available to this archetype';
    }
    if (!evalRequires(set.sbr, ctx)) return set.sbrt || 'Requirements not met';
    const anyOk = set.p.some((pid, idx) => {
      const p = this.gd.powerById.get(pid);
      const av = set.av[idx] ?? 0;
      return !!p && !p.auto && av >= 0 && av <= level && evalRequires(p.br, ctx);
    });
    return anyOk ? null : 'No powers available yet';
  }

  /**
   * State of one power for a pick (owned / available / unavailable + reason).
   *
   * @param pid Power id.
   * @param pickIndex Pick being made.
   */
  powerOption(pid: number, pickIndex: number): PowerOption {
    const p = this.gd.power(pid);
    const ref = this.gd.setOfPower.get(pid);
    const av = ref ? (ref.set.av[ref.index] ?? 0) : 0;
    const level = this.pickLevel(pickIndex);
    const current = this.b.picks[pickIndex];
    const owned = this.ownedAt(level, pickIndex);
    // Owned anywhere in the build (later picks too) shows as owned; it can't be picked twice.
    const ownedLater = this.b.picks.some((pk, i) => pk && i !== pickIndex && pk.power === pid);
    if (current?.power === pid) return { power: p, av, state: 'owned' };
    if (owned.has(pid) || ownedLater) return { power: p, av, state: 'owned' };
    const fail = (reason: string): PowerOption => ({ power: p, av, state: 'unavailable', reason });
    if (!ref) return fail('Unknown powerset');
    if (p.auto || av < 0) return fail('Granted automatically');
    if (av > level) return fail(`Available at level ${av + 1}`);
    const kind = this.setKind(ref.set);
    if (level === this.pickLevel(0) && (pickIndex === 0 || pickIndex === 1)) {
      // the level-1 picks lock a column (category), not a set: a branch in the primary category
      // (a respec at 24+) may take the primary pick, as its trunk may
      const cat = this.gd.categoryOfSet.get(ref.set.id);
      const isPri = kind === 'primary' || (kind === 'branch' && cat === this.at.cats.pri);
      const isSec = kind === 'secondary' || (kind === 'branch' && cat === this.at.cats.sec);
      if (pickIndex === 0 && !isPri) return fail('Choose a primary power now');
      if (pickIndex === 1 && !isSec) return fail('Choose a secondary power now');
    }
    const block = this.newSetBlock(ref.set, pickIndex);
    if (block) return fail(block);
    if (!evalRequires(p.br, this.ctx(level, owned))) return fail('Requirements not met');
    return { power: p, av, state: 'available' };
  }

  /**
   * Panels for the "Choose a New Power" screen at a pick: the primary and the other sets of its
   * category (VEAT branches, always listed and greyed until they unlock, as the client lists
   * every set the character has), the same for the secondary, then owned pool / epic sets.
   *
   * @param pickIndex Pick being made.
   */
  setOptions(pickIndex: number): SetOption[] {
    const level = this.pickLevel(pickIndex);
    const owned = this.ownedAt(level, pickIndex);
    const ownedSets = this.ownedSets(owned);
    const out: SetOption[] = [];
    // granted powers (Bio Armor's Adaptations, Jaunt, Kheldian form attacks) can't be bought,
    // so they are left off the lists
    const buyable = (set: Powerset) =>
      set.p.filter((pid, idx) => (set.av[idx] ?? 0) >= 0 && !this.gd.powerById.get(pid)?.auto);
    const add = (set: Powerset) => {
      out.push({
        set,
        kind: this.setKind(set),
        column: this.column(set),
        owned: ownedSets.has(set.id),
        powers: buyable(set).map((pid) => this.powerOption(pid, pickIndex)),
      });
    };
    for (const [main, cat] of [
      [this.b.primary, this.at.cats.pri],
      [this.b.secondary, this.at.cats.sec],
    ] as const) {
      add(this.gd.powerset(main));
      for (const s of this.gd.setsInCategory(cat)) if (s.spa) add(s);
    }
    for (const kind of ['pool', 'epic'] as const) {
      const cat = kind === 'pool' ? this.at.cats.pool : this.at.cats.epic;
      for (const s of this.gd.setsInCategory(cat)) if (ownedSets.has(s.id)) add(s);
    }
    return out;
  }

  /**
   * Pool or epic sets that could be newly added at this pick (the "Choose a Pool Power Set"
   * screen), with the reason each one is blocked.
   */
  newSetChoices(kind: 'pool' | 'epic', pickIndex: number): { set: Powerset; block: string | null }[] {
    const level = this.pickLevel(pickIndex);
    const ownedSets = this.ownedSets(this.ownedAt(level, pickIndex));
    const cat = kind === 'pool' ? this.at.cats.pool : this.at.cats.epic;
    const ctx = this.ctx(level, this.ownedAt(level, pickIndex));
    return this.gd
      .setsInCategory(cat)
      .filter((s) => !ownedSets.has(s.id))
      // Hide sets the game hides: SetRequires ['0'] (Gadgetry, Utility Belt), the retired
      // Pool.Fitness, AT-gated epics. Sets blocked only by SetBuyRequires (one specialized pool)
      // stay listed but greyed with the game's reason.
      .filter((s) => evalRequires(s.sr, ctx))
      .filter((s) => !s.spa || evalRequires(s.spr, ctx))
      .filter((s) => kind === 'pool' || s.p.some((pid) => evalRequires(this.gd.power(pid).br, ctx)))
      .map((s) => ({ set: s, block: this.newSetBlock(s, pickIndex) }));
  }

  /** @return Whether another pool (or epic) set can be added at this pick. */
  canAddNewSet(kind: 'pool' | 'epic', pickIndex: number): boolean {
    return this.newSetChoices(kind, pickIndex).some((c) => c.block === null);
  }

  /**
   * Exclusive granted toggles (see isExclusiveToggle) the build owns, grouped under the power
   * that grants them (the power named in their BuyRequires), in set order. Only groups of two or
   * more are returned.
   *
   * @return Map of granting power id to its group members.
   */
  toggleGroups(): Map<number, Power[]> {
    const by = new Map<string, { owner: number; members: Power[] }>();
    for (const pid of this.granted().keys()) {
      const p = this.gd.power(pid);
      if (!isExclusiveToggle(p)) continue;
      const owner = (p.br ?? []).map((t) => this.gd.powerByName.get(t.toLowerCase())).find((x) => !!x);
      if (!owner) continue;
      const key = `${owner.id}:${p.gm!.join(',')}`;
      const g = by.get(key) ?? { owner: owner.id, members: [] };
      g.members.push(p);
      by.set(key, g);
    }
    const idx = (p: Power) => this.gd.setOfPower.get(p.id)?.index ?? 0;
    const out = new Map<number, Power[]>();
    for (const g of by.values()) {
      if (g.members.length >= 2) out.set(g.owner, [...(out.get(g.owner) ?? []), ...g.members].sort((a, b) => idx(a) - idx(b)));
    }
    return out;
  }

  // ---- entries and slots -----------------------------------------------------------------------

  /** Slots for a power, with the free first slot materialised at the power's level. */
  private normSlots(p: Power, level: number, slots: Slot[] | undefined): Slot[] {
    if (!this.slottable(p)) return [];
    const s = (slots ?? []).map((x) => ({ ...x }));
    if (s.length === 0) s.push({ level });
    const first = s[0];
    if (first) first.level = level;
    return s;
  }

  /** Every power in the build (picks in order, then auto-granted powers by grant level). */
  entries(): BuildEntry[] {
    const out: BuildEntry[] = [];
    this.b.picks.forEach((pick, i) => {
      if (!pick) return;
      const power = this.gd.power(pick.power);
      out.push({
        key: `pick:${i}`,
        power,
        level: pick.level,
        slots: this.normSlots(power, pick.level, pick.slots),
        source: 'pick',
        pickIndex: i,
        on: pick.on,
      });
    });
    const grants = [...this.granted()].sort((a, b) => a[1] - b[1] || a[0] - b[0]);
    for (const [pid, level] of grants) {
      const power = this.gd.power(pid);
      const st = this.b.granted[pid];
      out.push({
        key: `grant:${pid}`,
        power,
        level,
        slots: this.normSlots(power, level, st?.slots),
        source: 'grant',
        on: st?.on,
      });
    }
    return out;
  }

  /** @return Enhancement slots the schedule grants at exactly this level. */
  slotsGranted(level: number): number {
    return countAtLevel(level, this.gd.core.schedule.slot);
  }

  /** @return Bought (non-free) slots already placed at exactly this level. */
  slotsUsed(level: number): number {
    let n = 0;
    for (const e of this.entries()) {
      e.slots.forEach((s, i) => {
        if (i > 0 && s.level === level) n++;
      });
    }
    return n;
  }

  /**
   * Whether a slot may be added to an entry at a slot level.
   *
   * @param e The entry.
   * @param level The slot level (a respec screen: the last of its merged levels).
   * @param levels Every level the screen places slots at (a respec's merged levels; default `level`).
   * @return Null when allowed, or the in-game refusal ('Full', 'No Slots', ...).
   */
  slotBlock(e: BuildEntry, level: number, levels: number[] = [level]): string | null {
    if (!this.slottable(e.power)) return 'Full';
    if (e.level > level && !this.slotsAnyPower(level)) return 'Not owned yet';
    const bought = Math.max(0, e.slots.length - 1);
    if (bought >= MAX_BOUGHT_SLOTS || e.slots.length >= (e.power.maxB ?? 0)) return 'Full';
    if (this.slotsLeft(levels) <= 0) return 'No Slots';
    return null;
  }

  /**
   * The level a specialization (VEAT branch) set's SpecializeAt is checked against.
   *
   * The game checks the character's own level, never the level of the pick being made: the
   * level-up screen passes the current level, and a respec its pre-respec level (uiReSpec.c
   * powerLevelSelector with respec.maxLevel; character_respec.c with iExpLevel). So a leveling
   * build opens the branches at their level, while a respec at that level or above takes branch
   * powers from its first pick.
   *
   * @param level 0-based level of the pick.
   * @return The pick's level, or for a Respec build the level it respecs to.
   */
  specLevel(level: number): number {
    return this.b.respecTo ?? level;
  }

  /**
   * @return Whether slots gained at this level may go on any power, even one taken after it: a
   *   respec's (Homecoming's respec places every slot on one screen; see respecSteps).
   */
  slotsAnyPower(level: number): boolean {
    return this.b.respecTo !== undefined && level <= this.b.respecTo;
  }

  /** @return Slots granted at these levels and not yet placed. */
  slotsLeft(levels: number[]): number {
    return levels.reduce((n, l) => n + this.slotsGranted(l) - this.slotsUsed(l), 0);
  }

  // ---- validation ------------------------------------------------------------------------------

  /** Every rule the build currently breaks (flagged, never auto-fixed). */
  issues(): Issue[] {
    const out: Issue[] = [];
    this.b.picks.forEach((pick, i) => {
      if (!pick) return;
      const opt = this.powerOption(pick.power, i);
      // powerOption reports the current pick as 'owned'; re-check it as if unpicked.
      const probe = new BuildRules(this.gd, {
        ...this.b,
        picks: this.b.picks.map((p, j) => (j === i ? null : p)),
      }).powerOption(pick.power, i);
      if (opt.state !== 'owned' || probe.state !== 'available') {
        out.push({ key: `pick:${i}`, message: probe.reason ?? 'Not allowed at this level' });
      }
    });
    const used = new Map<number, number>();
    for (const e of this.entries()) {
      e.slots.forEach((s, si) => {
        if (si === 0) return;
        if (s.level < e.level && !this.slotsAnyPower(s.level)) out.push({ key: e.key, slot: si, message: 'Slot is below the power level' });
        used.set(s.level, (used.get(s.level) ?? 0) + 1);
      });
      if (e.slots.length > (e.power.maxB ?? 0) || e.slots.length - 1 > MAX_BOUGHT_SLOTS) {
        out.push({ key: e.key, message: 'Too many slots' });
      }
    }
    for (const [lvl, n] of used) {
      if (n > this.slotsGranted(lvl)) {
        out.push({ key: 'build', message: `Level ${lvl + 1} has ${n} slots placed but grants ${this.slotsGranted(lvl)}` });
      }
    }
    out.push(...this.pieceIssues());
    return out;
  }

  // ---- enhancement pieces ----------------------------------------------------------------------

  /** @return The build's last level (0-based): its stop level, else 50. Slotting is judged there. */
  lastLevel(): number {
    return this.b.endLevel ?? MAX_LEVEL;
  }

  /** @return Every slotted enhancement the game would refuse in its slot (see enhRefusal). */
  private pieceIssues(): Issue[] {
    const out: Issue[] = [];
    const last = this.lastLevel();
    for (const e of this.entries()) {
      if (e.level > last) continue;
      e.slots.forEach((s, si) => {
        const why = s.enh && s.level <= last ? this.enhRefusal(e, si, s.enh) : null;
        if (why) out.push({ key: e.key, slot: si, message: why });
      });
    }
    return out;
  }

  /**
   * Why the game would refuse a slotted enhancement as the build stands, if it would.
   *
   * In order: the power must take it (power_IsValidBoost), its own settings must be possible
   * (valueRefusal), and the build must allow the piece (slotRefusal). The app never makes the first
   * two; share links, saved builds and imports can carry them.
   *
   * @param e The power.
   * @param slot Index into e.slots.
   * @param enh The enhancement in that slot.
   * @return Null when allowed, else a short reason.
   */
  enhRefusal(e: BuildEntry, slot: number, enh: SlottedEnh): string | null {
    const gd = this.gd;
    const boost = gd.powerById.get(enh.boost);
    if (!boost) return 'Unknown enhancement';
    const oi = gd.core.origins.findIndex((o) => o.id === this.b.origin);
    if (!canSlot(gd, e.power, boost, oi)) {
      return gd.core.origins.some((_, i) => canSlot(gd, e.power, boost, i)) ? 'Not for this origin' : "This power can't take it";
    }
    return this.valueRefusal(enh, boost) ?? this.slotRefusal(e, slot, boost, enh.ioLevel);
  }

  /**
   * Why an enhancement's own settings are impossible, if they are.
   *
   * Boosters go on boostable pieces only (attuned pieces, procs and TO/DO/SO take none), +5 at most
   * (boost_IsBoostable: the boosters table). A TO/DO/SO-style piece works from 3 levels below the
   * character to 3 above: Homecoming combines one 3 times (its client refuses a 4th), so a level-50
   * SO reaches 50+3 (boost_IsValidCombination, boost_EffectivenessLevel). An IO is made only at its
   * set's levels (a common IO from 10).
   *
   * @param enh The enhancement as slotted.
   * @param boost Its enhancement power.
   * @return Null when possible, else a short reason.
   */
  private valueRefusal(enh: SlottedEnh, boost: Power): string | null {
    const be = this.gd.core.boostEffect;
    const boosters = enh.boosters ?? 0;
    if (boosters !== 0) {
      if (!boost.bb) return boost.bup ? 'Attuned pieces take no boosters' : 'Takes no boosters';
      if (boosters < 0 || boosters > be.boosters.length - 1) return `Boosters go from +0 to +${be.boosters.length - 1}`;
    }
    if (!boost.bie) {
      const rel = enh.rel ?? 0;
      const lo = -(be.below.length - 1);
      const hi = be.above.length - 1;
      if (rel < lo || rel > hi) return `Relative level goes from ${lo} to +${hi}`;
    }
    const range = ioLevelRange(this.gd, boost);
    if (range && enh.ioLevel !== undefined && (enh.ioLevel < range[0] || enh.ioLevel > range[1])) {
      return `Made at levels ${range[0] + 1} to ${range[1] + 1}`;
    }
    return null;
  }

  /**
   * Why a piece can't be used at the build's last level, if it can't (boost_IsValidToSlotAtLevel).
   *
   * The character's level must be within the piece's MinSlotLevel..MaxSlotLevel, and an IO works
   * from 3 levels below its own (boost_Effectiveness); attuned pieces and TO/DO/SO-style pieces
   * follow the character.
   *
   * @param boost The piece.
   * @param ioLevel Its IO level when it has one; else the lowest level it is made at.
   * @return Null when usable, else a short reason.
   */
  private levelRefusal(boost: Power, ioLevel: number | undefined): string | null {
    const last = this.lastLevel();
    const [minSlot, maxSlot] = boost.slot ?? [-3, MAX_LEVEL];
    const lvl = ioLevelRange(this.gd, boost) ? (ioLevel ?? ioLevelRange(this.gd, boost)![0]) : undefined;
    const from = lvl === undefined ? minSlot : Math.max(minSlot, lvl - levelsAbove(this.gd));
    if (last < from) return `Usable from level ${from + 1}`;
    if (last > maxSlot) return `Usable up to level ${maxSlot + 1}`;
    return null;
  }

  /** @return Pieces slotted in the build by short name (lower case) and the context their requirements read. */
  private slotted(): { counts: Map<string, number>; ctx: EvalContext } {
    if (this.slottedCache) return this.slottedCache;
    const last = this.b.endLevel ?? MAX_LEVEL;
    const counts = new Map<string, number>();
    for (const e of this.entries()) {
      if (e.level > last) continue;
      for (const s of e.slots) {
        const b = s.enh && s.level <= last ? this.gd.powerById.get(s.enh.boost) : undefined;
        if (!b) continue;
        const k = shortName(b).toLowerCase();
        counts.set(k, (counts.get(k) ?? 0) + 1);
      }
    }
    this.slottedCache = { counts, ctx: this.ctx(last, this.ownedAt(last)) };
    return this.slottedCache;
  }

  /**
   * Why the game would refuse a piece in a power's slot as the build stands, if it would.
   *
   * A power holds one of each set piece, any version of it (power_ValidBoostSlotRequired). Then the
   * piece's slot requirements (power_BoostCheckRequires): unique pieces may not already be in the
   * build (`BoostsSlotted>` counts every power), archetype origin pieces need their archetype, and
   * superior and very rare pieces need level 50 (the build's last level: the game checks the
   * character's level when the piece goes in). The slot's current piece is left out of the counts,
   * as it would be replaced. Last, the piece must work at the build's last level (levelRefusal).
   *
   * @param e The power.
   * @param slot Index into e.slots.
   * @param boost The piece to test (the slot's own piece to check the build).
   * @param ioLevel The piece's IO level when known (one already slotted); else its lowest.
   * @return Null when allowed, else a short reason.
   */
  slotRefusal(e: BuildEntry, slot: number, boost: Power, ioLevel?: number): string | null {
    return this.pieceRefusal(e, slot, boost) ?? this.levelRefusal(boost, ioLevel);
  }

  /** @return slotRefusal without the level test: one of each piece per power, and the piece's SlotRequires. */
  private pieceRefusal(e: BuildEntry, slot: number, boost: Power): string | null {
    const gd = this.gd;
    const ref = gd.boostSetOf.get(boost.id);
    const others = e.slots.filter((s, i) => i !== slot && s.enh).map((s) => gd.power(s.enh!.boost));
    if (ref && others.some((o) => { const r = gd.boostSetOf.get(o.id); return r?.set.id === ref.set.id && r.letter === ref.letter; })) {
      return 'Set piece slotted twice';
    }
    if (!boost.slr?.length) return null;
    const { counts, ctx: base } = this.slotted();
    const last = this.lastLevel();
    const cur = e.slots[slot];
    const curName = cur?.enh && cur.level <= last && e.level <= last ? shortName(gd.power(cur.enh.boost)).toLowerCase() : '';
    const inPower = others.map((o) => shortName(o).toLowerCase());
    const ctx: EvalContext = {
      ...base,
      boostsSlotted: (n) => {
        const k = n.toLowerCase();
        return (counts.get(k) ?? 0) - (k === curName ? 1 : 0);
      },
      powerBoostsSlotted: (n) => inPower.filter((x) => x === n.toLowerCase()).length,
    };
    if (evalRequires(boost.slr, ctx)) return null;

    // which part failed: the same test with nothing else slotted, then also at level 50
    const alone: EvalContext = { ...ctx, boostsSlotted: () => 0, powerBoostsSlotted: () => 0 };
    if (evalRequires(boost.slr, alone)) {
      const named = new Set(boost.slr.map((t) => t.toLowerCase()));
      const where = this.entries().find((o) =>
        o.slots.some((s, i) => (o.key !== e.key || i !== slot) && !!s.enh && named.has(shortName(gd.power(s.enh.boost)).toLowerCase())),
      );
      return where ? `Unique, also slotted in ${where.power.dn}` : 'Unique piece';
    }
    if (evalRequires(boost.slr, { ...alone, prop: (n) => (n === 'level' ? MAX_LEVEL + 1 : base.prop(n)) })) return 'Needs level 50';
    const classes = boost.slr.filter((t) => /^Class_/i.test(t)).map((t) => gd.archetypeByName.get(t.toLowerCase())?.dn ?? t);
    return classes.length ? `Only for ${classes.join(' or ')}` : 'Not slottable by this character';
  }
}

export { GameData };
