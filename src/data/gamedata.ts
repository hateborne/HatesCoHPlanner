import type { Archetype, BoostSet, BoostsFile, Core, Power, Powerset } from './types.ts';

/** Where an enhancement sits inside an IO set. */
export interface BoostSetRef {
  set: BoostSet;
  letter: number; // piece index (A = 0)
  variant: number; // index inside the piece's list (0 crafted, 1 attuned, ...)
}

/** Raw files as loaded from public/data/<version>/. */
export interface RawData {
  core: Core;
  powersets: Powerset[];
  powers: Power[];
  boosts: BoostsFile;
}

/**
 * Indexed, read-only view of the exported game data.
 *
 * Everything the rules engine and UI look up goes through here: powers by id or full name,
 * the powerset (and index) each power belongs to, IO-set membership of enhancements, and
 * per-archetype mod tables.
 */
export class GameData {
  readonly core: Core;
  readonly powerById = new Map<number, Power>();
  readonly powerByName = new Map<string, Power>();
  readonly setById = new Map<number, Powerset>();
  readonly setByName = new Map<string, Powerset>();
  readonly setOfPower = new Map<number, { set: Powerset; index: number }>();
  readonly archetypeById = new Map<number, Archetype>();
  readonly archetypeByName = new Map<string, Archetype>();
  readonly boostSetById = new Map<number, BoostSet>();
  readonly boostSetOf = new Map<number, BoostSetRef>();
  readonly categoryOfSet = new Map<number, string>();
  readonly boosts: Power[];
  readonly bonusPowers: Power[];
  readonly boostSets: BoostSet[];
  readonly attribName = new Map<number, string>();
  readonly attribByName = new Map<string, number>();

  constructor(raw: RawData) {
    this.core = raw.core;
    this.boosts = raw.boosts.boosts;
    this.bonusPowers = raw.boosts.bonusPowers;
    this.boostSets = raw.boosts.sets;
    for (const p of [...raw.powers, ...raw.boosts.boosts, ...raw.boosts.bonusPowers]) {
      this.powerById.set(p.id, p);
      this.powerByName.set(p.n.toLowerCase(), p);
    }
    for (const s of raw.powersets) {
      this.setById.set(s.id, s);
      this.setByName.set(s.n.toLowerCase(), s);
      s.p.forEach((pid, index) => {
        if (!this.setOfPower.has(pid)) this.setOfPower.set(pid, { set: s, index });
      });
    }
    for (const [cat, ids] of Object.entries(raw.core.categories)) {
      for (const id of ids) this.categoryOfSet.set(id, cat);
    }
    for (const a of raw.core.archetypes) {
      this.archetypeById.set(a.id, a);
      this.archetypeByName.set(a.n.toLowerCase(), a);
    }
    for (const bs of raw.boosts.sets) {
      this.boostSetById.set(bs.id, bs);
      bs.slots.forEach((variants, letter) => {
        variants.forEach((bid, variant) => this.boostSetOf.set(bid, { set: bs, letter, variant }));
      });
    }
    for (const [off, info] of Object.entries(raw.core.attribs)) {
      this.attribName.set(Number(off), info.name);
      this.attribByName.set(info.name, Number(off));
    }
  }

  /** @return The power with this id (throws if unknown). */
  power(id: number): Power {
    const p = this.powerById.get(id);
    if (!p) throw new Error(`unknown power id ${id}`);
    return p;
  }

  /** @return The powerset with this id (throws if unknown). */
  powerset(id: number): Powerset {
    const s = this.setById.get(id);
    if (!s) throw new Error(`unknown powerset id ${id}`);
    return s;
  }

  /** @return The archetype with this id (throws if unknown). */
  archetype(id: number): Archetype {
    const a = this.archetypeById.get(id);
    if (!a) throw new Error(`unknown archetype id ${id}`);
    return a;
  }

  /** @return Powersets in a power category (e.g. "Blaster_Ranged", "Pool", "Epic"). */
  setsInCategory(cat: string): Powerset[] {
    return (this.core.categories[cat] ?? []).map((id) => this.powerset(id));
  }

  /**
   * Value of an archetype's named mod table at a 0-based level.
   *
   * @param at Archetype.
   * @param table Table name (case-insensitive).
   * @param level 0-based level, clamped to the table length.
   * @return The table value, or 0 when the class lacks the table.
   */
  table(at: Archetype, table: string, level: number): number {
    const idx = at.mod[table.toLowerCase()];
    if (idx === undefined) return 0;
    const vals = this.core.modTables[idx];
    if (!vals || vals.length === 0) return 0;
    return vals[Math.max(0, Math.min(vals.length - 1, level))] ?? 0;
  }

  /** @return An archetype attribute table value (e.g. at.max.HitPoints) at a 0-based level. */
  static attrAt(tbl: Record<string, number | number[]>, name: string, level: number, dflt = 0): number {
    const v = tbl[name];
    if (v === undefined) return dflt;
    if (typeof v === 'number') return v;
    return v[Math.max(0, Math.min(v.length - 1, level))] ?? dflt;
  }
}

/**
 * Fetch the latest exported data set from the site.
 *
 * @param base Site base URL (import.meta.env.BASE_URL).
 * @return Indexed game data.
 */
export async function loadGameData(base: string): Promise<GameData> {
  const latest = (await (await fetch(`${base}data/latest.json`)).json()) as { dataVersion: string };
  const root = `${base}data/${latest.dataVersion}/`;
  const get = async <T,>(f: string): Promise<T> => (await (await fetch(root + f)).json()) as T;
  const [core, powersets, powers, boosts] = await Promise.all([
    get<Core>('core.json'),
    get<Powerset[]>('powersets.json'),
    get<Power[]>('powers.json'),
    get<BoostsFile>('boosts.json'),
  ]);
  return new GameData({ core, powersets, powers, boosts });
}
