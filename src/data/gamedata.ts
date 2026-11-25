import { readHenchmenFile } from './henchmen.ts';
import { readInfoFile } from './info.ts';
import { fetchJson } from './packed.ts';
import { readPetsFile } from './pets.ts';
import { dataRoot, DEFAULT_SERVER, type GameServer } from './servers.ts';
import type { GameVersion } from './versions.ts';
import type { Watch } from './watch.ts';
import type { Archetype, BoostSet, BoostsFile, Core, HenchmenFile, InfoFile, PetsFile, Power, Powerset } from './types.ts';

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
  // whether the pets file's fetch has ended (taken, refused or failed): the Pets and Minions cards
  // read it to tell a power's real pets from its pseudo-pets before asking for the real pets file
  petsSettled = false;
  // who to tell when the pets file arrives, or its fetch ends (subscribePets)
  private readonly petsListeners = new Set<() => void>();
  // the version's power-info extras (info/<version>.json): set when that optional file arrives, so
  // the power info shows the client's effect notes, grants and wording from then on; null while missing
  info: InfoFile | null = null;
  // who to tell when the info file arrives (subscribeInfo)
  private readonly infoListeners = new Set<() => void>();
  // the version's real pets (henchmen/<version>.json): set when that optional file arrives, so the
  // Pets and Minions cards show from then on; null while it is missing or not asked for yet
  henchmen: HenchmenFile | null = null;
  // who to tell when the real pets file arrives (subscribeHenchmen)
  private readonly henchmenListeners = new Set<() => void>();
  // fetches the real pets file (set by loadGameData); requestHenchmen calls it once
  private henchmenLoader: (() => void) | null = null;

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
    this.petsSettled = true;
    for (const l of [...this.petsListeners]) l();
    return true;
  }

  /** Mark the pets file's fetch as ended, taken or not, and tell those waiting (subscribePets). */
  settlePets(): void {
    if (this.petsSettled) return;
    this.petsSettled = true;
    for (const l of [...this.petsListeners]) l();
  }

  /**
   * Take the version's power-info extras file, when it is one, and tell those waiting for it.
   *
   * Optional and loaded apart, like the pets file: a file with any part malformed is ignored (the
   * power info then shows none of its extras) rather than trusted (readInfoFile).
   *
   * @param raw The parsed info/<version>.json.
   * @param version The id of the version it was fetched for (a file naming another is refused).
   * @return Whether it was taken.
   */
  setInfo(raw: unknown, version: string): boolean {
    const file = readInfoFile(raw, version);
    if (!file) return false;
    this.info = file;
    for (const l of [...this.infoListeners]) l();
    return true;
  }

  /**
   * Take the version's real pets file, when it is one, and tell those waiting for it.
   *
   * Optional and loaded apart, like the pets file: a file with any part malformed is ignored (the
   * Pets and Minions cards then don't show) rather than trusted (readHenchmenFile).
   *
   * @param raw The parsed henchmen/<version>.json.
   * @return Whether it was taken.
   */
  setHenchmen(raw: unknown): boolean {
    const file = readHenchmenFile(raw);
    if (!file) return false;
    this.henchmen = file;
    for (const l of [...this.henchmenListeners]) l();
    return true;
  }

  /**
   * Set how the real pets file is fetched; requestHenchmen runs it the first time a build needs it.
   *
   * @param load Starts the fetch (and takes the file through setHenchmen when it comes).
   */
  setHenchmenLoader(load: () => void): void {
    this.henchmenLoader = load;
  }

  /**
   * Fetch the version's real pets file, once: only a build with a power that makes a pet asks for
   * it, so other builds download nothing more. Never waited for (subscribeHenchmen hears it).
   */
  requestHenchmen(): void {
    const load = this.henchmenLoader;
    this.henchmenLoader = null;
    load?.();
  }

  /**
   * Hear when the real pets file arrives, so the totals show the Pets and Minions cards (for
   * useSyncExternalStore, with `henchmen` as the snapshot).
   *
   * @param listener Called once the file is taken.
   * @return Stops listening.
   */
  readonly subscribeHenchmen = (listener: () => void): (() => void) => {
    this.henchmenListeners.add(listener);
    return () => this.henchmenListeners.delete(listener);
  };

  /**
   * Hear when the info file arrives, so a panel open by then shows its extras (for
   * useSyncExternalStore, with `info` as the snapshot).
   *
   * @param listener Called once the file is taken.
   * @return Stops listening.
   */
  readonly subscribeInfo = (listener: () => void): (() => void) => {
    this.infoListeners.add(listener);
    return () => this.infoListeners.delete(listener);
  };

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
   * Value of a class's named mod table at a 0-based level, for a pet's power: the pets file's table
   * for that class first (a villain class's, or one core.json lacks for an archetype), then the real
   * pets file's, else the archetype's from core.json.
   *
   * @param cls Class name (Class_Brute, Class_Minion_Pets).
   * @param table Table name (case-insensitive).
   * @param level 0-based level, clamped to the table length.
   * @return The table value; when the class lacks the table, 1 for a pet class (as the client) and 0
   *   for an archetype.
   */
  classTable(cls: string, table: string, level: number): number {
    const t = table.toLowerCase();
    const fromPets = this.pets?.classes[cls]?.[t];
    const fromHenchmen = this.henchmen?.classes[cls]?.mod[t];
    const vals =
      fromPets !== undefined ? this.pets?.tables[fromPets] : fromHenchmen !== undefined ? this.henchmen?.tables[fromHenchmen] : undefined;
    if (fromPets !== undefined || fromHenchmen !== undefined) {
      if (!Array.isArray(vals) || vals.length === 0) return 0;
      const v = vals[Math.max(0, Math.min(vals.length - 1, level))];
      return typeof v === 'number' ? v : 0;
    }
    const at = this.archetypeByName.get(cls.toLowerCase());
    if (at) return this.table(at, table, level);
    // a pet class lacking the table reads 1, the client's fallback (classes.c class_GetNamedTableValue):
    // the Assault Bot's Conserve Power names Melee_One, which no pet class has, and gives +100%
    return this.henchmen?.classes[cls] || this.pets?.classes[cls] ? 1 : 0;
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
/** Folder beside them holding each version's power-info extras (info/<version>.json). */
export const INFO_FOLDER = 'info';
/** Folder beside them holding each version's real pets (henchmen/<version>.json). */
export const HENCHMEN_FOLDER = 'henchmen';

/**
 * Fetch one game version's exported data set from the site.
 *
 * The version's pseudo-pet and power-info extras files are fetched once these four have arrived,
 * and never waited for: each is attached when it comes (GameData.setPets, setInfo), and a slow,
 * missing or damaged one only leaves pet damage or the extras out. The real pets file is fetched
 * the same way, but only when a build first asks for it (GameData.requestHenchmen), and asked for
 * again after a network failure. The build
 * always opens on the four files alone, and a load that fails on them fetches no extra file.
 *
 * @param server The server the version belongs to.
 * @param base Site base URL (import.meta.env.BASE_URL).
 * @param version The version to load (its hash keeps browsers from mixing in stale cached files).
 * @param watch A watch on the four files' downloads (watch.ts): it hears of what they receive, and
 *   giving it up fails the load at once. The extra files are not under it.
 * @return Indexed game data.
 */
export async function loadGameData(server: GameServer, base: string, version: GameVersion, watch?: Watch): Promise<GameData> {
  const data = dataRoot(server, base);
  const root = `${data}${version.id}/`;
  const q = version.hash ? `?v=${version.hash}` : '';
  // the four files every build opens on: by their brotli copies where the site has them (packed.ts)
  const get = async <T,>(f: string): Promise<T> => {
    const r = await fetchJson(root + f, q, /*copies=*/ undefined, watch);
    if (!r.ok) throw new Error(`game data ${version.id}/${f} is missing (HTTP ${r.status})`);
    return (await r.json()) as T;
  };
  let files: [Core, Powerset[], Power[], BoostsFile];
  try {
    files = await Promise.all([get<Core>('core.json'), get<Powerset[]>('powersets.json'), get<Power[]>('powers.json'), get<BoostsFile>('boosts.json')]);
  } catch (e) {
    // one file failed, so the load has: the others are not left under way with nobody waiting
    watch?.cancel();
    throw e;
  }
  const [core, powersets, powers, boosts] = files;
  // given up just as its last file arrived: nobody waits for it, so its extra files aren't fetched
  if (watch?.signal.aborted) throw new Error(`the download of ${version.id} was given up`);
  const gd = new GameData({ core, powersets, powers, boosts }, server.id);
  // the optional files beside the version folder: fetched now, never waited for
  const extra = (folder: string, take: (raw: unknown) => boolean, done?: () => void): void => {
    void (async (): Promise<unknown> => {
      const r = await fetch(`${data}${folder}/${version.id}.json${q}`);
      return r.ok ? await r.json() : null;
    })()
      .then((raw) => take(raw))
      .catch(() => undefined)
      .finally(() => done?.());
  };
  extra(PETS_FOLDER, (raw) => gd.setPets(raw), () => gd.settlePets());
  extra(INFO_FOLDER, (raw) => gd.setInfo(raw, version.id));
  // the real pets file only once a build asks for it (requestHenchmen); a fetch the network fails
  // is armed again for the next ask (a missing, refused or unreadable file is not)
  const loadHenchmen = (): void => {
    void (async (): Promise<void> => {
      const r = await fetch(`${data}${HENCHMEN_FOLDER}/${version.id}.json${q}`);
      if (r.ok) gd.setHenchmen(await r.json());
    })().catch((e: unknown) => {
      // a file that answers but is not JSON (damaged, or another page served in its place) is like a
      // refused one: asked for again, it would be fetched anew on every change to the build
      if (!(e instanceof SyntaxError)) gd.setHenchmenLoader(loadHenchmen);
    });
  };
  gd.setHenchmenLoader(loadHenchmen);
  return gd;
}
