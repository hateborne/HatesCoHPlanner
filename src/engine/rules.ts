/**
 * Power-pick, auto-grant and slot rules, ported from the engine (see docs/game-rules.md).
 *
 * A BuildRules instance is a read-only view over one Build: create a new one after every edit.
 */
import { GameData } from '../data/gamedata.ts';
import type { Archetype, Power, Powerset } from '../data/types.ts';
import { toAlignment, type Build, type Pick, type Slot } from './build.ts';
import { evalRequires, type EvalContext } from './requires.ts';
import { countAtLevel, countForLevel } from './schedule.ts';

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

export class BuildRules {
  readonly at: Archetype;
  readonly pickLevels: number[];
  private grantedCache: Map<number, number> | null = null;

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
      ownsSet: (name) => {
        const s = this.gd.setByName.get(name.toLowerCase());
        return !!s && ownedSets.has(s.id);
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
      if (level < (set.spa ?? 0)) return `Available at level ${(set.spa ?? 0) + 1}`;
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
      if (pickIndex === 0 && kind !== 'primary') return fail('Choose a primary power first');
      if (pickIndex === 1 && kind !== 'secondary') return fail('Choose a secondary power now');
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
    const add = (set: Powerset) => {
      out.push({
        set,
        kind: this.setKind(set),
        column: this.column(set),
        owned: ownedSets.has(set.id),
        powers: set.p.map((pid) => this.powerOption(pid, pickIndex)),
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
   * @return Null when allowed, or the in-game refusal ('Full', 'No Slots', ...).
   */
  slotBlock(e: BuildEntry, level: number): string | null {
    if (!this.slottable(e.power)) return 'Full';
    if (e.level > level) return 'Not owned yet';
    const bought = Math.max(0, e.slots.length - 1);
    if (bought >= MAX_BOUGHT_SLOTS || e.slots.length >= (e.power.maxB ?? 0)) return 'Full';
    if (this.slotsUsed(level) >= this.slotsGranted(level)) return 'No Slots';
    return null;
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
        if (s.level < e.level) out.push({ key: e.key, slot: si, message: 'Slot is below the power level' });
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
    return out;
  }
}

export { GameData };
