import { readPetsFile } from './pets.ts';
import { dataRoot, DEFAULT_SERVER, type GameServer } from './servers.ts';
import type { GameVersion } from './versions.ts';
import type { Archetype, BoostSet, BoostsFile, Core, PetsFile, Power, Powerset } from './types.ts';

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

// Attribute names the engine uses (Homecoming's client's), keyed by another name a server's client
// gives the same attribute: Thunderspy's calls Knock (knockback) "Knockback", which Homecoming
// lists as Knock's alias. Without this, Thunderspy's knockback protection and resistance would be
// missing from the totals.
const ATTRIB_CANON: Record<string, string> = { Knockback: 'Knock' };

/**
 * Indexed, read-only view of the exported game data.
 *
 * Everything the rules engine and UI look up goes through here: powers by id or full name,
 * the powerset (and index) each power belongs to, IO-set membership of enhancements, and
 * per-archetype mod tables.
 */
export class GameData {
  readonly core: Core;
  readonly server: string; // the server the data is for (builds checked against it are tied to it)
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
  // the version's pseudo-pets (pets/<version>.json): set when that optional file arrives, so a
  // power's pet damage shows from then on; null while it is missing
  pets: PetsFile | null = null;
  // who to tell when the pets file arrives (subscribePets)
  private readonly petsListeners = new Set<() => void>();

  /**
   * Index a loaded data set.
   *
   * @param raw The exported files.
   * @param server The server they are for (default: Homecoming).
   */
  constructor(raw: RawData, server: string = DEFAULT_SERVER) {
    this.core = raw.core;
    this.server = server;
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
        variants.forEach((bid, variant) => {
          this.boostSetOf.set(bid, { set: bs, letter, variant });
          // a piece whose name the client's text lacks (Thunderspy's Scourging Blast proc) is
          // shown by its set and letter, never as a blank tile
          const p = this.powerById.get(bid);
          if (p && !p.dn.trim()) p.dn = `${bs.dn}: Unnamed piece ${String.fromCharCode(65 + letter)}`;
        });
      });
    }
    const names = new Set(Object.values(raw.core.attribs).map((a) => a.name));
    for (const [off, info] of Object.entries(raw.core.attribs)) {
      // a server that calls an attribute by another of its names is read under the engine's name
      const canon = ATTRIB_CANON[info.name];
      const name = canon && !names.has(canon) ? canon : info.name;
      this.attribName.set(Number(off), name);
      this.attribByName.set(name, Number(off));
      if (name !== info.name) this.attribByName.set(info.name, Number(off));
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

  /**
   * Take the version's pseudo-pet file, when it is one, and tell those waiting for it.
   *
   * It comes from the site, but it is optional and loads apart from the rest, so a file with any
   * part malformed is ignored (the powers then show no pet damage) rather than trusted
   * (readPetsFile).
   *
   * @param raw The parsed pets/<version>.json.
   * @return Whether it was taken.
   */
  setPets(raw: unknown): boolean {
    const file = readPetsFile(raw);
    if (!file) return false;
    this.pets = file;
    for (const l of [...this.petsListeners]) l();
    return true;
  }

  /**
   * Hear when the pets file arrives, so a panel open by then shows pet damage (for
   * useSyncExternalStore, with `pets` as the snapshot).
   *
   * @param listener Called once the file is taken.
   * @return Stops listening.
   */
  readonly subscribePets = (listener: () => void): (() => void) => {
    this.petsListeners.add(listener);
    return () => this.petsListeners.delete(listener);
  };

  /**
   * Value of a class's named mod table at a 0-based level, for a pseudo-pet's power: the pet file's
   * table for that class first (a villain class's, or one core.json lacks for an archetype), else
   * the archetype's from core.json.
   *
   * @param cls Class name (Class_Brute, Class_Minion_Pets).
   * @param table Table name (case-insensitive).
   * @param level 0-based level, clamped to the table length.
   * @return The table value, or 0 when the class lacks the table.
   */
  classTable(cls: string, table: string, level: number): number {
    const idx = this.pets?.classes[cls]?.[table.toLowerCase()];
    if (idx !== undefined) {
      const vals = this.pets?.tables[idx];
      if (!Array.isArray(vals) || vals.length === 0) return 0;
      const v = vals[Math.max(0, Math.min(vals.length - 1, level))];
      return typeof v === 'number' ? v : 0;
    }
    const at = this.archetypeByName.get(cls.toLowerCase());
    return at ? this.table(at, table, level) : 0;
  }

  /** @return An archetype attribute table value (e.g. at.max.HitPoints) at a 0-based level. */
  static attrAt(tbl: Record<string, number | number[]>, name: string, level: number, dflt = 0): number {
    const v = tbl[name];
    if (v === undefined) return dflt;
    if (typeof v === 'number') return v;
    return v[Math.max(0, Math.min(v.length - 1, level))] ?? dflt;
  }
}

/** Folder beside a server's version folders holding each version's pseudo-pets (pets/<version>.json). */
export const PETS_FOLDER = 'pets';

/**
 * Fetch one game version's exported data set from the site.
 *
 * The version's pseudo-pet file is fetched once these four have arrived, and never waited for: it
 * is attached when it comes (GameData.setPets), and a slow, missing or damaged one only leaves pet
 * damage out. The build always opens on the four files alone, and a load that fails on them
 * fetches no pet file.
 *
 * @param server The server the version belongs to.
 * @param base Site base URL (import.meta.env.BASE_URL).
 * @param version The version to load (its hash keeps browsers from mixing in stale cached files).
 * @return Indexed game data.
 */
export async function loadGameData(server: GameServer, base: string, version: GameVersion): Promise<GameData> {
  const data = dataRoot(server, base);
  const root = `${data}${version.id}/`;
  const q = version.hash ? `?v=${version.hash}` : '';
  const get = async <T,>(f: string): Promise<T> => {
    const r = await fetch(root + f + q);
    if (!r.ok) throw new Error(`game data ${version.id}/${f} is missing (HTTP ${r.status})`);
    return (await r.json()) as T;
  };
  const [core, powersets, powers, boosts] = await Promise.all([
    get<Core>('core.json'),
    get<Powerset[]>('powersets.json'),
    get<Power[]>('powers.json'),
    get<BoostsFile>('boosts.json'),
  ]);
  const gd = new GameData({ core, powersets, powers, boosts }, server.id);
  void (async (): Promise<unknown> => {
    const r = await fetch(`${data}${PETS_FOLDER}/${version.id}.json${q}`);
    return r.ok ? await r.json() : null;
  })()
    .then((raw) => gd.setPets(raw))
    .catch(() => undefined);
  return gd;
}
