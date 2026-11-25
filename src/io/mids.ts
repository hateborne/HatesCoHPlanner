/**
 * MidsReborn interop: .mbd JSON files, |MBD; share codes (Brotli + Base64) and legacy |MxDz;
 * data chunks (zlib + hex, .NET BinaryWriter payload, MidsCharacterFileFormat.cs v3.20).
 * Names and IDs go through mids-map.json; anything that can't be mapped is reported, never
 * silently dropped.
 */
import type { GameData } from '../data/gamedata.ts';
import { dataRoot, DEFAULT_SERVER, defaultServer, serverById, serverByMidsDb, SERVERS, type GameServer } from '../data/servers.ts';
import { stripHidden, toAlignment, type Build, type Slot, type SlottedEnh } from '../engine/build.ts';
import { enhKind, ioLevelRange, shortName } from '../engine/enhance.ts';
import { BuildRules, isArchetypeInherent } from '../engine/rules.ts';
import { defaultOn, defaultsOf, exclusiveGroups, isPetUpgrade } from '../engine/totals.ts';
import { checkBuild } from '../engine/validate.ts';
import { ByteReader, ByteWriter, concatBytes, EndOfData, fromBase64, streamBytes, toBase64, TooLarge } from './binary.ts';
import { ImportProblem, noMids, READABLE, readable, readableOn, readablePower, tooLong } from './importProblem.ts';
import { IMPORT_LIMITS } from './limits.ts';
import { PLANNER_APP } from './midsPatches.ts';
import { decodeShare } from './share.ts';
import { numericVersion } from '../version.ts';

export interface MidsMap {
  dbVersion: string;
  renames: Record<string, string>;
  powers: [number, number][]; // [mids StaticIndex, game power id]
  enh: { si: number; uid: string; name: string; long?: string; type: number; boost?: number; normal?: string }[];
  // Mids power -> game power where the names differ ('' for one the game lacks); maps made before it have none
  names?: Record<string, string>;
  // game power -> the Mids name an export writes, where it isn't the game's own ('' for none)
  exportNames?: Record<string, string>;
}

export interface ImportResult {
  build: Build;
  warnings: string[];
}

const MIDS_ALIGN = ['Hero', 'Rogue', 'Vigilante', 'Villain', 'Loyalist', 'Resistance'];
const RELATIVE = ['None', 'MinusThree', 'MinusTwo', 'MinusOne', 'Even', 'PlusOne', 'PlusTwo', 'PlusThree', 'PlusFour', 'PlusFive'];
const GRADES = ['None', 'TrainingO', 'DualO', 'SingleO'];

const mapPromises = new Map<string, Promise<MidsMap>>(); // one per server and game version

/** @return The server a data set is for (Homecoming when it names one the site doesn't carry). */
const serverOfData = (gd: GameData): GameServer => serverById(gd.server) ?? defaultServer();

/** @return The problem for Mids on a server MidsReborn has no database for. */
export function midsUnavailable(s: GameServer): ImportProblem {
  return noMids(s, SERVERS.filter((x) => x.midsDb));
}

// the problem to report for pasted text too long to be a build
const TOO_LONG = tooLong;

/**
 * The problem to report for pasted text on a server MidsReborn has no database for, which reads
 * share links only: Mids text (a share code, or a .mbd file's JSON) is refused as Mids, anything
 * else as text the planner doesn't read there.
 *
 * @param s The server.
 * @param text The pasted text (no share link in it).
 * @return The problem.
 */
export function notReadableOn(s: GameServer, text: string): ImportProblem {
  const t = text.trim();
  // the same limits as everywhere (parseMidsText), before anything looks at the text
  if (!t) return new ImportProblem("there's nothing to import", 'Paste a share link.');
  if (t.length > IMPORT_LIMITS.text) return TOO_LONG();
  if (/\|(MBD|MxDz);/.test(t) || t.startsWith('{')) return midsUnavailable(s);
  return new ImportProblem("it isn't a build the planner recognizes", readableOn(s));
}

/**
 * Load mids-map.json for the current data version (once). MidsReborn is an untrusted reference,
 * so a missing or broken map rejects with a readable message and the next call tries again.
 */
export function loadMidsMap(gd: GameData): Promise<MidsMap> {
  const server = serverOfData(gd);
  // no Mids database for this server (Thunderspy): every Mids import and export stops here, in words
  if (!server.midsDb) return Promise.reject(midsUnavailable(server));
  const version = gd.core.manifest.dataVersion;
  const key = `${server.id}/${version}`;
  const hit = mapPromises.get(key);
  if (hit) return hit;
  const p = fetch(`${dataRoot(server, import.meta.env.BASE_URL)}${version}/mids-map.json?v=${gd.core.manifest.hash ?? ''}`)
    .then(async (r) => {
      if (!r.ok) throw new Error(`Mids data is not available for this game version (HTTP ${r.status})`);
      const m = (await r.json()) as MidsMap;
      if (!m || !Array.isArray(m.enh) || !Array.isArray(m.powers)) throw new Error('Mids data is incomplete');
      return m;
    })
    .catch((e: unknown) => {
      mapPromises.delete(key);
      throw e instanceof Error ? e : new Error(String(e));
    });
  mapPromises.set(key, p);
  return p;
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * Epic pools MidsReborn keeps under its own names, with the game's name for each. Its database and
 * a table in its code use these; CrypticPowerNames.mhd, which mids-map.json's renames come from,
 * lists none of them. Each was matched to the one game pool with its powers (tests/io.test.ts
 * checks that every target exists). Mids name first, as it writes it.
 */
export const MIDS_EPIC_POOLS: readonly (readonly [mids: string, game: string])[] = [
  ['Epic.Dark_Mastery_Blaster', 'Epic.Blaster_Dark_Mastery'],
  ['Epic.Dark_Mastery_Controller', 'Epic.Controller_Dark_Mastery'],
  ['Epic.Dark_Mastery_Dominator', 'Epic.Dominator_Dark_Mastery'],
  ['Epic.Dark_Mastery_Mastermind', 'Epic.Mastermind_Dark_Mastery'],
  ['Epic.Dark_Mastery_TankBrute', 'Epic.Tank_Dark_Mastery'],
  ['Epic.Ice_Mastery_DefCorr', 'Epic.Defender_Ice_Mastery'],
  ['Epic.Ice_Mastery_ScrapStalk', 'Epic.Scrapper_Ice_Mastery'],
  ['Epic.Psionic_Mastery_ScrapStalk', 'Epic.Melee_Psionic_Mastery'],
  ['Epic.Psionic_Mastery_TankBrute', 'Epic.Tank_Psionic_Mastery'],
];
const EPIC_TO_GAME = new Map(MIDS_EPIC_POOLS.map(([m, g]) => [m.toLowerCase(), g]));
const EPIC_TO_MIDS = new Map(MIDS_EPIC_POOLS.map(([m, g]) => [g.toLowerCase(), m]));

/** @return A full power or set name with its set part swapped through `table`, or undefined when it isn't listed. */
function swapEpic(name: string, table: Map<string, string>): string | undefined {
  const parts = name.split('.');
  const set = table.get(parts.slice(0, 2).join('.').toLowerCase());
  return set ? [set, ...parts.slice(2)].join('.') : undefined;
}

const ORIGIN_PREFIX = /^((Generic|Magic|Mutation|Natural|Science|Technology)_)+/;

/** How an enhancement Mids has no record of goes to Mids: the nearest piece it has, and why. */
interface StandIn {
  // the Mids record and grade written
  entry: MidsMap['enh'][number];
  grade: string;
  // the IO level written (a set piece's top level), when it has one
  ioLevel?: number;
  // the warning it is counted under, and its ending for one piece and for several ('#' is the count)
  key: string;
  one: string;
  many: string;
}

/** Lookups built from the map + game data. */
class Translator {
  readonly renames = new Map<string, string>();
  readonly reverseRenames = new Map<string, string>();
  // the map's names and exportNames, by lower-cased name
  readonly names = new Map<string, string>();
  readonly exportNames: Map<string, string> | undefined;
  readonly byUid = new Map<string, MidsMap['enh'][number]>();
  readonly bySi = new Map<number, MidsMap['enh'][number]>();
  readonly byName = new Map<string, MidsMap['enh'][number]>();
  readonly boostToMids = new Map<number, MidsMap['enh'][number]>();
  readonly normalBySuffix = new Map<string, MidsMap['enh'][number]>();
  readonly powerBySi = new Map<number, number>();
  readonly siByPower = new Map<number, number>();
  readonly boostByDisplay = new Map<string, number>();
  // every boost under its display name (a set piece's crafted and attuned versions share one)
  readonly boostsByDisplay = new Map<string, number[]>();

  constructor(
    readonly gd: GameData,
    readonly map: MidsMap,
  ) {
    for (const [a, b] of Object.entries(map.renames)) {
      this.renames.set(a.toLowerCase(), b);
      this.reverseRenames.set(b.toLowerCase(), a);
    }
    for (const [a, b] of Object.entries(map.names ?? {})) this.names.set(a.toLowerCase(), b);
    if (map.exportNames) this.exportNames = new Map(Object.entries(map.exportNames).map(([a, b]) => [a.toLowerCase(), b]));
    for (const b of gd.boosts) {
      this.boostByDisplay.set(norm(b.dn), b.id);
      this.boostsByDisplay.set(norm(b.dn), [...(this.boostsByDisplay.get(norm(b.dn)) ?? []), b.id]);
    }
    for (const e of map.enh) {
      this.byUid.set(e.uid.toLowerCase(), e);
      this.bySi.set(e.si, e);
      if (e.boost !== undefined) this.boostToMids.set(e.boost, e);
      if (e.normal) this.normalBySuffix.set(e.normal.toLowerCase(), e);
      if (e.long) this.byName.set(norm(e.long), e);
      if (e.type === 1) this.byName.set(norm(e.name), e);
    }
    // a set piece Mids keeps under another internal name (Crafted_Shrapnel_A is the game's
    // Crafted_Artillery_A) exports by the same full-name match the import uses
    for (const e of map.enh) {
      if (e.boost !== undefined || e.normal) continue;
      const boost = this.boostByLongName(e);
      if (boost !== undefined && !this.boostToMids.has(boost)) this.boostToMids.set(boost, e);
    }
    for (const [si, pid] of map.powers) {
      this.powerBySi.set(si, pid);
      if (!this.siByPower.has(pid)) this.siByPower.set(pid, si);
    }
  }

  /**
   * The game power a Mids power name is.
   *
   * Mids' names go through the map's names first: Mids and the game give some powers different
   * names, and the game has moved names around inside a set (pipeline/mids_map.py). The planner's
   * own exports from before the map had them wrote the game's names, and are read as they always
   * were (`legacy`).
   *
   * @param name A Mids power's full name.
   * @param legacy Read it as the planner's exports before the map's names did.
   * @return The power id, or undefined.
   */
  power(name: string, legacy = false): number | undefined {
    const named = legacy ? undefined : this.names.get(name.toLowerCase());
    if (named !== undefined) return named ? this.gd.powerByName.get(named.toLowerCase())?.id : undefined;
    const n = this.renames.get(name.toLowerCase()) ?? swapEpic(name, EPIC_TO_GAME) ?? name;
    return this.gd.powerByName.get(n.toLowerCase())?.id;
  }

  /** @return The name an export gives a power in Mids ('' when Mids has no such power and gives its name to another). */
  midsPowerName(pid: number): string {
    const n = this.gd.power(pid).n;
    if (this.exportNames) return this.exportNames.get(n.toLowerCase()) ?? n;
    return this.reverseRenames.get(n.toLowerCase()) ?? swapEpic(n, EPIC_TO_MIDS) ?? n;
  }

  /** @return Whether Mids has the power (the map gives it a Mids index). */
  midsHas(pid: number): boolean {
    return this.siByPower.has(pid);
  }

  /**
   * Game enhancement for a Mids enhancement (normal grades resolve by origin).
   *
   * A DualO is the game's two-origin piece of that type that the origin can use: each origin is
   * one of the two in two of them (Mutation_Magic, Natural_Magic), and the first in the data's
   * order is taken (they are the same strength).
   */
  boostFor(entry: MidsMap['enh'][number] | undefined, grade: string, origin: string): number | undefined {
    if (!entry) return undefined;
    if (entry.boost !== undefined) return entry.boost;
    if (!entry.normal) return this.boostByLongName(entry);
    if (grade === 'DualO') {
      const want = entry.normal.toLowerCase();
      const o = origin.toLowerCase();
      const dual = this.gd.boosts.find((b) => {
        const n = shortName(b);
        const prefix = ORIGIN_PREFIX.exec(n)?.[0] ?? '';
        const origins = prefix.toLowerCase().split('_').filter(Boolean);
        return origins.length === 2 && origins.includes(o) && n.slice(prefix.length).toLowerCase() === want;
      });
      if (dual) return dual.id;
    }
    const prefix = grade === 'TrainingO' ? 'Generic' : origin;
    return this.gd.powerByName.get(`boosts.${prefix}_${entry.normal}.${prefix}_${entry.normal}`.toLowerCase())?.id;
  }

  /**
   * A set piece the map couldn't link to the game data because Mids keeps another internal name
   * for it (its Crafted_Shrapnel_A is the game's Crafted_Artillery_A): matched by its full name
   * ("Artillery: Accuracy/Damage"), the version (crafted, attuned, superior) by the Mids id's prefix.
   *
   * @param entry The Mids enhancement record.
   * @return The game's boost id, or undefined.
   */
  boostByLongName(entry: MidsMap['enh'][number]): number | undefined {
    if (!entry.long) return undefined;
    const version = (n: string) => /^(Superior_Attuned|Superior|Attuned|Crafted)_/.exec(n)?.[1] ?? '';
    const want = version(entry.uid);
    return (this.boostsByDisplay.get(norm(entry.long)) ?? []).find((id) => version(shortName(this.gd.power(id))) === want);
  }

  /** Mids record + grade for one of our enhancements (a two-origin piece is a DO, one origin an SO). */
  midsFor(boostId: number): { entry: MidsMap['enh'][number]; grade: string } | undefined {
    const direct = this.boostToMids.get(boostId);
    if (direct) return { entry: direct, grade: 'None' };
    const b = this.gd.power(boostId);
    const kind = enhKind(this.gd, b);
    if (kind === 'Training' || kind === 'Origin') {
      const prefix = ORIGIN_PREFIX.exec(shortName(b))?.[0] ?? '';
      const entry = this.normalBySuffix.get(shortName(b).slice(prefix.length).toLowerCase());
      const origins = prefix.split('_').filter(Boolean).length;
      if (entry) return { entry, grade: kind === 'Training' ? 'TrainingO' : origins > 1 ? 'DualO' : 'SingleO' };
    }
    return undefined;
  }

  /**
   * The nearest Mids piece for an enhancement Mids has no record of: an attuned or superior set
   * piece goes as the crafted piece at the top of its set's range, a Synthetic Hamidon
   * enhancement as its Hamidon one, a Yin's talisman as the Single Origin piece of its type.
   *
   * @param boostId The enhancement.
   * @return The stand-in, or undefined when Mids has nothing near it.
   */
  standIn(boostId: number): StandIn | undefined {
    const n = shortName(this.gd.power(boostId));
    const piece = /^(Superior_Attuned|Superior|Attuned)_(.+)$/.exec(n);
    if (piece) {
      const crafted = this.gd.powerByName.get(`boosts.Crafted_${piece[2]}.Crafted_${piece[2]}`.toLowerCase());
      const m = crafted && this.midsFor(crafted.id);
      if (crafted && m) {
        const ioLevel = ioLevelRange(this.gd, crafted)?.[1] ?? 49;
        const kind = piece[1] === 'Attuned' ? 'attuned' : 'superior';
        const set = this.gd.boostSetOf.get(crafted.id)?.set.dn ?? crafted.dn;
        const tail = `to Mids as crafted at level ${ioLevel + 1}`;
        return { ...m, ioLevel, key: `${set}: Mids has no ${kind} version of this set, so`, one: `its ${kind} piece goes ${tail}`, many: `its # ${kind} pieces go ${tail}` };
      }
    }
    if (n.startsWith('Synthetic_')) {
      const real = this.gd.powerByName.get(`boosts.${n.slice(10)}.${n.slice(10)}`.toLowerCase());
      const m = real && this.midsFor(real.id);
      if (m) return { ...m, key: 'Synthetic Hamidon enhancements: Mids has none, so', one: 'one goes to Mids as the Hamidon enhancement it copies', many: '# go to Mids as the Hamidon enhancements they copy' };
    }
    if (n.startsWith('Yins_')) {
      const entry = this.normalBySuffix.get(n.slice(5).replace(ORIGIN_PREFIX, '').toLowerCase());
      if (entry) return { entry, grade: 'SingleO', key: "Yin's talismans: Mids has none, so", one: 'one goes to Mids as a Single Origin enhancement of its type', many: '# go to Mids as Single Origin enhancements of their types' };
    }
    return undefined;
  }
}

// ---- .mbd JSON --------------------------------------------------------------------------------

interface MbdEnh {
  Uid?: string;
  Enhancement?: string;
  Grade?: string;
  IoLevel?: number;
  RelativeLevel?: string;
  Obtained?: boolean;
}
interface MbdSlot {
  Level: number;
  IsInherent?: boolean;
  Enhancement: MbdEnh | null;
  FlippedEnhancement?: MbdEnh | null;
}
interface MbdPower {
  PowerName: string;
  Level: number;
  StatInclude?: boolean;
  ProcInclude?: boolean;
  VariableValue?: number;
  InherentSlotsUsed?: number;
  SubPowerEntries?: unknown[];
  SlotEntries: MbdSlot[];
}
export interface Mbd {
  // GameVersion: the planner's game version id, in its own exports (Mids ignores unknown fields)
  BuiltWith?: { App?: string; Version?: string; Database?: string; DatabaseVersion?: string; GameVersion?: string };
  Level?: string;
  Class: string;
  Origin: string;
  Alignment: string;
  Name?: string;
  // the build comment Mids shows and keeps; the planner's exports put the build's share link in it
  Comment?: string;
  PowerSets: string[];
  LastPower?: number;
  PowerEntries: MbdPower[];
}

function setIdFor(gd: GameData, t: Translator, name: string): number | undefined {
  const direct = gd.setByName.get(name.toLowerCase());
  if (direct) return direct.id;
  // a renamed set: find a renamed power under it
  for (const [from, to] of t.renames) {
    if (from.startsWith(`${name.toLowerCase()}.`)) {
      const s = gd.setOfPower.get(gd.powerByName.get(to.toLowerCase())?.id ?? -1);
      if (s) return s.set.id;
    }
  }
  return undefined;
}

/** How importMbd reads a build file beyond its Mids fields. */
export interface MbdReading {
  // the build behind the share link in the file's comment (linkedBuild): what Mids still holds
  // as the planner exported it comes back exactly from it
  link?: Build;
  // power names are the game's own (a legacy code read through the Mids database's indexes)
  gameNames?: boolean;
}

/** The label before the share link in the comment of the planner's Mids exports. */
const LINK_LABEL = "Hate's CoH Planner build: ";

/**
 * @return The share codes (after '#b=') the planner wrote in a Mids build's comment, at most a
 *   few: only links after its own label, never one a player pasted there.
 */
function linkCodes(m: Mbd): string[] {
  if (typeof m.Comment !== 'string') return [];
  return [...m.Comment.matchAll(new RegExp(`${LINK_LABEL}[^\\s#]*#b=([A-Za-z0-9_-]+)`, 'g'))].slice(0, 4).map((x) => x[1]!);
}

/**
 * The comment the planner writes in its Mids exports: the build's share link after its label, and
 * the game version alone on the last line, which Mids keeps when it saves the file over the
 * planner's `BuiltWith` (midsMadeOn). Lines end in CR LF: Mids' comment box shows a bare LF as
 * nothing, which would run the version into the link.
 *
 * @param link The build's share link.
 * @param version The game version id ("i28p4").
 * @return The comment.
 */
function linkComment(link: string, version: string): string {
  return `${LINK_LABEL}${link}\r\n${version}`;
}

/**
 * The build behind the share link in a Mids build's comment, when it is one this version's data
 * can read.
 *
 * The comment is text from outside: a code is only decoded (decodeShare) and checked (checkBuild),
 * never followed, and one made on another game version or server is ignored.
 *
 * @param gd The game version the file is read with.
 * @param m The build file.
 * @return The linked build, or undefined.
 */
export async function linkedBuild(gd: GameData, m: Mbd): Promise<Build | undefined> {
  for (const code of linkCodes(m)) {
    try {
      const b = await decodeShare(code);
      if (b.dataVersion !== gd.core.manifest.dataVersion) continue;
      const checked = checkBuild(gd, gd.server !== DEFAULT_SERVER ? { ...b, server: gd.server } : b).build;
      if (checked) return checked;
    } catch {
      // a damaged code: the file is read from its Mids fields alone
    }
  }
  return undefined;
}

/**
 * Convert a Mids .mbd object into a build.
 *
 * With the build behind the planner's share link in the file's comment, every power and slot Mids
 * still holds as the planner exported it comes back exactly from the link (attuned pieces, the
 * levels Mids moves), the powers Mids lacks come back where the file left their place empty, and
 * whatever was changed in Mids is read from the file.
 *
 * @param gd Game data.
 * @param map Mids map.
 * @param m Parsed .mbd JSON.
 * @param reading The linked build and how names are read.
 */
export function importMbd(gd: GameData, map: MidsMap, m: Mbd, reading: MbdReading = {}): ImportResult {
  if (!isMbd(m)) throw new ImportProblem("it isn't a Mids build file the planner can read (it looks damaged)", READABLE);
  const t = new Translator(gd, map);
  const warn: string[] = [];
  const at = gd.archetypeByName.get(m.Class.toLowerCase());
  if (!at) throw new ImportProblem(`its archetype (${readable(m.Class.replace(/^Class_/i, ''))}) isn't one the planner has`, notOursHint(gd, m));
  const origin = gd.core.origins.find((o) => o.n.toLowerCase() === (m.Origin ?? '').toLowerCase()) ?? gd.core.origins[0]!;
  const alignment = toAlignment(m.Alignment);
  const sets = Array.isArray(m.PowerSets) ? m.PowerSets : [];
  const primary = setIdFor(gd, t, sets[0] ?? '');
  const secondary = setIdFor(gd, t, sets[1] ?? '');
  if (primary === undefined || secondary === undefined) {
    const name = (s: string | undefined) => readable((s ?? '').split('.').pop() || 'none');
    throw new ImportProblem(`its power sets (${name(sets[0])} / ${name(sets[1])}) aren't ones the planner has`, notOursHint(gd, m));
  }
  const sched = gd.core.schedule.power;
  const b: Build = {
    v: 1,
    ...(gd.server !== DEFAULT_SERVER ? { server: gd.server } : {}), // mapped onto this server's data, so it is its build
    dataVersion: gd.core.manifest.dataVersion,
    name: m.Name ?? '',
    at: at.id,
    origin: origin.id,
    alignment,
    primary,
    secondary,
    picks: sched.map(() => null),
    granted: {},
  };

  // the planner's exports from before they carried a share link wrote the game's power names, and
  // are read as they were
  const legacy = m.BuiltWith?.App === PLANNER_APP && !linkCodes(m).length;
  const powerOf = (name: string): number | undefined => {
    if (!reading.gameNames) return t.power(name, legacy);
    const found = gd.powerByName.get(name.toLowerCase());
    return found && !/^boosts\./i.test(found.n) ? found.id : undefined;
  };
  // the linked build, when it is this build (same archetype and power sets), and what the planner
  // exports for it: the file's fields equal to those are as the planner wrote them
  const from = reading.link && reading.link.at === at.id && reading.link.primary === primary && reading.link.secondary === secondary ? reading.link : undefined;
  const ref = from ? exportMbd(gd, map, from) : undefined;
  const fromEntries = from ? new BuildRules(gd, from).entries() : [];
  const toEnh = (e: MbdEnh | null | undefined, where: string): SlottedEnh | undefined => {
    if (!e) return undefined;
    const entry = (e.Uid ? t.byUid.get(e.Uid.toLowerCase()) : undefined) ?? (e.Enhancement ? t.byName.get(norm(e.Enhancement)) : undefined);
    let boost = t.boostFor(entry, e.Grade ?? 'None', origin.n);
    if (boost === undefined && e.Enhancement) boost = t.boostByDisplay.get(norm(e.Enhancement));
    // a set the Mids database the map was built from doesn't have at all: Mids normally names an
    // IO set piece by the game's own boost name, so look that up in the game data itself
    if (boost === undefined && e.Uid) boost = gd.powerByName.get(`boosts.${e.Uid}.${e.Uid}`.toLowerCase())?.id;
    if (boost === undefined) {
      warn.push(`${where}: an enhancement (${readable(e.Uid ?? e.Enhancement ?? '?')}) isn't in the planner's game data, so its slot is empty`);
      return undefined;
    }
    const out: SlottedEnh = { boost };
    const bp = gd.power(boost);
    if (bp.bie && !bp.bup) out.ioLevel = Math.max(0, Math.min(52, e.IoLevel ?? 49));
    const rel = RELATIVE.indexOf(e.RelativeLevel ?? 'Even');
    if (!bp.bie && rel > 0 && rel !== 4) out.rel = rel - 4;
    if (bp.bb && rel > 4) out.boosters = rel - 4;
    return out;
  };
  // Mids' StatInclude, by entry key: applied once the build is put together (applyStats), since a
  // power's default can depend on the rest of the build
  const stats = new Map<string, boolean>();
  const toSlots = (p: MbdPower, where: string): Slot[] => p.SlotEntries.map((s) => ({ level: Math.max(0, s.Level - 1), enh: toEnh(s.Enhancement, where) }));
  /**
   * A power's slots: the linked build's own when Mids holds them as the planner exported them,
   * else slot by slot, the link's where the slot is unchanged and the file's where it was changed.
   */
  const mergedSlots = (p: MbdPower, refP: MbdPower | undefined, own: Slot[] | undefined, counted: Slot[] | undefined, where: string): Slot[] => {
    if (!refP || !counted) return toSlots(p, where);
    if (own && sameSlots(p, refP)) return own.map(copySlot);
    return p.SlotEntries.map((s, k) => {
      const r = refP.SlotEntries[k];
      const c = counted[k];
      return r && c && sameSlot(s, r) ? copySlot(c) : { level: Math.max(0, s.Level - 1), enh: toEnh(s.Enhancement, where) };
    });
  };

  // the link's picks by their Mids name and level, and its auto-granted powers: Mids may leave out
  // the entries of powers it can't read, so the file's entries are matched by name, not by place
  const linkPicks = new Map<string, number>();
  const linkGrants = new Set<number>();
  ref?.powers.forEach((pid, k) => {
    if (pid === null) return;
    const r = ref.mbd.PowerEntries[k]!;
    if (k >= sched.length) linkGrants.add(pid);
    else if (r.PowerName) linkPicks.set(`${r.PowerName.toLowerCase()}|${r.Level}`, k);
  });
  const matched = new Set<number>(); // the link's picks the file still holds
  let changed = false; // a pick was read from the file: the link's build-wide fields may not fit it

  const used = new Set<number>();
  const seen = new Set<number>(); // auto-granted powers the file holds
  m.PowerEntries.forEach((p, i) => {
    const k = from && p.PowerName ? linkPicks.get(`${p.PowerName.toLowerCase()}|${p.Level}`) : undefined;
    // a pick the file holds as the planner exported it: the link's, exactly
    if (k !== undefined && !used.has(k)) {
      const fromPick = from!.picks[k]!;
      const refP = ref!.mbd.PowerEntries[k]!;
      const counted = fromEntries.find((e) => e.key === `pick:${k}`);
      used.add(k);
      matched.add(k);
      b.picks[k] = { power: fromPick.power, level: fromPick.level, slots: mergedSlots(p, refP, fromPick.slots, counted?.slots, gd.power(fromPick.power).dn) };
      // the link's switch: Mids rewrites StatInclude for every power when it saves (MidsReborn 3.8)
      if (fromPick.on !== undefined) b.picks[k]!.on = fromPick.on;
      return;
    }
    if (!p.PowerName) return;
    const pid = powerOf(p.PowerName);
    if (pid === undefined) {
      // Auto-granted powers Mids names differently only matter if they carried enhancements.
      if (i < sched.length || p.SlotEntries.some((s) => s.Enhancement)) {
        warn.push(`${readablePower(p.PowerName)} isn't in the planner's game data, so it was left out`);
      }
      return;
    }
    const level = Math.max(0, p.Level - 1);
    const name = gd.power(pid).dn;
    // an auto-granted power of the link moved into the picks' places is still one
    if (i < sched.length && !linkGrants.has(pid)) {
      changed = true;
      let idx = sched[i] === level && !used.has(i) ? i : -1;
      if (idx < 0) idx = sched.findIndex((l, k) => l === level && !used.has(k));
      if (idx < 0) {
        warn.push(`${name} was taken at level ${readable(String(p.Level))}, which has no free power pick, so it was left out`);
        return;
      }
      used.add(idx);
      b.picks[idx] = { power: pid, level, slots: toSlots(p, name) };
      if (typeof p.StatInclude === 'boolean') stats.set(`pick:${idx}`, p.StatInclude);
    } else {
      seen.add(pid);
      const j = ref ? ref.powers.findIndex((x, k) => k >= sched.length && x === pid) : -1;
      const refG = j >= 0 ? ref!.mbd.PowerEntries[j] : undefined;
      const own = from?.granted[pid];
      if (refG && sameSlots(p, refG)) {
        // as the planner exported it: the link's record, or none where the link had none
        if (own) b.granted[pid] = { ...own, slots: own.slots.map(copySlot) };
        return;
      }
      const counted = fromEntries.find((e) => e.key === `grant:${pid}`);
      b.granted[pid] = { slots: mergedSlots(p, refG, own?.slots ?? [], counted?.slots, name) };
      if (refG) {
        if (own?.on !== undefined) b.granted[pid]!.on = own.on; // the link's switch, as for picks
      } else if (typeof p.StatInclude === 'boolean') stats.set(`grant:${pid}`, p.StatInclude);
    }
  });
  if (from) {
    from.picks.forEach((fromPick, k) => {
      if (!fromPick || matched.has(k)) return;
      if (t.midsHas(fromPick.power)) {
        changed = true; // taken out or changed in Mids
        return;
      }
      // a pick Mids has no record of: the link's, where its place is still free
      if (!b.picks[k] && !b.picks.some((x) => x?.power === fromPick.power)) b.picks[k] = { ...fromPick, slots: fromPick.slots.map(copySlot) };
      else warn.push(`${gd.power(fromPick.power).dn}, which Mids doesn't have, was left out: the build has another power in its place`);
    });
    // auto-granted powers Mids has no record of come back from the link
    for (const [key, g] of Object.entries(from.granted)) {
      const pid = Number(key);
      if (!seen.has(pid) && !t.midsHas(pid)) b.granted[pid] = { ...g, slots: g.slots.map(copySlot) };
    }
    // what Mids has no field for, while the picks are the link's
    if (m.Alignment === ref!.mbd.Alignment) b.alignment = from.alignment;
    if (from.petOn) b.petOn = { ...from.petOn };
    if (!changed) {
      if (from.exemplar !== undefined) b.exemplar = from.exemplar;
      if (from.endLevel !== undefined) b.endLevel = from.endLevel;
      if (from.respecTo !== undefined) b.respecTo = from.respecTo;
    }
  }
  applyStats(gd, b, stats);
  return { build: b, warnings: warn };
}

/** @return A copy of a slot. */
const copySlot = (s: Slot): Slot => (s.enh ? { level: s.level, enh: { ...s.enh } } : { level: s.level });

/** @return Whether two Mids enhancements are the same piece at the same level. */
function sameEnh(a: MbdEnh | null | undefined, b: MbdEnh | null | undefined): boolean {
  if (!a || !b) return !a && !b;
  return (
    (a.Uid ?? '').toLowerCase() === (b.Uid ?? '').toLowerCase() &&
    (a.Grade ?? 'None') === (b.Grade ?? 'None') &&
    // an IO's level; Mids rewrites the unused IoLevel of other grades (an SO's as 1)
    ((a.Grade ?? 'None') !== 'None' || (a.IoLevel ?? 49) === (b.IoLevel ?? 49)) &&
    (a.RelativeLevel ?? 'Even') === (b.RelativeLevel ?? 'Even')
  );
}

/** @return Whether two Mids slots are the same. */
const sameSlot = (a: MbdSlot, b: MbdSlot): boolean => a.Level === b.Level && sameEnh(a.Enhancement, b.Enhancement);

/** @return Whether two Mids power entries hold the same slots. */
const sameSlots = (a: MbdPower, b: MbdPower): boolean => a.SlotEntries.length === b.SlotEntries.length && a.SlotEntries.every((s, k) => sameSlot(s, b.SlotEntries[k]!));

/**
 * Set an imported build's on/off switches from Mids' StatInclude.
 *
 * Mids writes StatInclude for every power, so it is kept only where it differs from the
 * planner's default, and an export -> import round trip leaves the build unchanged. Mids counts
 * every toggle, so of toggles that switch each other off in the game (exclusiveGroups) only the
 * earliest one Mids counts stays on.
 *
 * @param gd Game data.
 * @param b The imported build (changed in place).
 * @param stats StatInclude by entry key ('pick:<index>' / 'grant:<powerId>').
 */
function applyStats(gd: GameData, b: Build, stats: Map<string, boolean>): void {
  const setOn = (key: string, on: boolean | undefined) => {
    const [kind, raw] = key.split(':');
    const n = Number(raw);
    if (kind === 'pick' && b.picks[n]) b.picks[n]!.on = on;
    if (kind === 'grant' && b.granted[n]) b.granted[n]!.on = on;
  };
  const powerOf = (key: string) => {
    const [kind, raw] = key.split(':');
    const n = Number(raw);
    return kind === 'pick' ? b.picks[n]?.power : n;
  };
  let defaults = new Map<string, boolean>();
  try {
    const counted = new BuildRules(gd, b).entries();
    defaults = defaultsOf(gd, counted);
    for (const g of exclusiveGroups(counted)) {
      let kept = false;
      for (const e of g) {
        if (!(stats.get(e.key) ?? defaults.get(e.key))) continue;
        if (kept) stats.set(e.key, false);
        kept = true;
      }
    }
  } catch {
    // a build the rules can't read yet: per-power defaults below, and checkBuild decides later
  }
  const at = gd.core.archetypes.find((a) => a.id === b.at);
  for (const [key, on] of stats) {
    const pid = powerOf(key);
    // a pet upgrade keeps its default (on): Mids leaves clicks out of its stats, upgrades included,
    // and its switch says nothing about the pets
    // so does the archetype's inherent: it always runs, and a switch stored for it would only grow links
    if (pid !== undefined && gd.powerById.has(pid) && (isPetUpgrade(gd, gd.power(pid)) || (at && isArchetypeInherent(gd, at, gd.power(pid))))) {
      setOn(key, undefined);
      continue;
    }
    const d = defaults.get(key) ?? (pid !== undefined && gd.powerById.has(pid) ? defaultOn(gd.power(pid)) : on);
    setOn(key, on === d ? undefined : on);
  }
}

/**
 * Convert a build into a Mids .mbd object (upstream format: enhancements by Uid).
 *
 * @param gd Game data.
 * @param map Mids map.
 * @param b Build.
 * @param link The build's share link, for the build comment (the planner reads it back on import).
 * @return The file, the warnings, and each power entry's power (null for an empty pick).
 */
export function exportMbd(gd: GameData, map: MidsMap, b: Build, link?: string): { mbd: Mbd; warnings: string[]; powers: (number | null)[] } {
  const t = new Translator(gd, map);
  const warn: string[] = [];
  const rules = new BuildRules(gd, b);
  const at = gd.archetype(b.at);
  const origin = gd.core.origins.find((o) => o.id === b.origin)!;
  const pools: string[] = [];
  let epic = '';
  for (const p of b.picks) {
    if (!p) continue;
    const ref = gd.setOfPower.get(p.power);
    if (!ref) continue;
    const kind = rules.setKind(ref.set);
    if (kind === 'pool' && !pools.includes(ref.set.n)) pools.push(ref.set.n);
    if (kind === 'epic') epic = swapEpic(ref.set.n, EPIC_TO_MIDS) ?? ref.set.n;
  }
  while (pools.length < 4) pools.push('');
  // pieces Mids has no record of, by warning: one warning per set or kind, not per piece
  const standIns = new Map<string, { one: string; many: string; count: number }>();
  const count = (key: string, one: string, many: string) => {
    const c = standIns.get(key);
    standIns.set(key, { one, many, count: (c?.count ?? 0) + 1 });
  };
  const enh = (s: Slot): MbdEnh | null => {
    if (!s.enh) return null;
    const bp = gd.power(s.enh.boost);
    const rel = bp.bie ? 4 + (s.enh.boosters ?? 0) : 4 + Math.max(-3, s.enh.rel ?? 0);
    const m = t.midsFor(s.enh.boost);
    if (!m) {
      // Mids has no such piece: the nearest one it has stands in, and the comment's link brings the real one back
      const sub = t.standIn(s.enh.boost);
      if (!sub) {
        // "Set: Aspect" reads as "Set (Aspect)" before the warning's own colon
        count(`${bp.dn.replace(/^([^:]+): (.+)$/, '$1 ($2)')}: Mids has no such enhancement, so`, 'its slot is empty in Mids (the planner keeps it)', '# slots are empty in Mids (the planner keeps them)');
        return null;
      }
      count(sub.key, sub.one, sub.many);
      return { Uid: sub.entry.uid, Grade: sub.grade, IoLevel: sub.ioLevel ?? 49, RelativeLevel: RELATIVE[rel] ?? 'Even', Obtained: false };
    }
    // Mids goes down to -3: an outleveled piece (it gives nothing in the game) goes out at -3
    if (!bp.bie && (s.enh.rel ?? 0) < -3) warn.push(`${bp.dn} is outleveled (it gives nothing); Mids has no level below -3, so it is exported at -3`);
    return { Uid: m.entry.uid, Grade: m.grade, IoLevel: s.enh.ioLevel ?? 49, RelativeLevel: RELATIVE[rel] ?? 'Even', Obtained: false };
  };
  // powers Mids has no record of, by set (Mids leaves them out, with their slots)
  const missing = new Map<number, number[]>();
  const entries = rules.entries();
  const defaults = defaultsOf(gd, rules.entries());
  const powers: (number | null)[] = [];
  const entry = (key: string, pid: number | null, level: number, slots: Slot[], on: boolean | undefined): MbdPower => {
    powers.push(pid);
    if (pid !== null && !t.midsHas(pid) && (key.startsWith('pick:') || slots.some((s) => s.enh))) {
      const set = gd.setOfPower.get(pid)?.set.id ?? -1;
      missing.set(set, [...(missing.get(set) ?? []), pid]);
    }
    return {
      PowerName: pid === null ? '' : t.midsPowerName(pid),
      Level: pid === null ? -1 : level + 1,
      // Mids has no "default": write what the planner actually counts (defaultsOf)
      StatInclude: pid === null ? false : (on ?? defaults.get(key) ?? defaultOn(gd.power(pid))),
      ProcInclude: false,
      VariableValue: 0,
      InherentSlotsUsed: 0,
      SubPowerEntries: [],
      SlotEntries: slots.map((s) => ({ Level: s.level + 1, IsInherent: false, Enhancement: enh(s), FlippedEnhancement: null })),
    };
  };
  const PowerEntries: MbdPower[] = b.picks.map((p, i) => {
    const e = entries.find((x) => x.key === `pick:${i}`);
    return p && e ? entry(e.key, p.power, p.level, e.slots, p.on ?? undefined) : entry('', null, 0, [], false);
  });
  for (const e of entries.filter((x) => x.source === 'grant')) {
    PowerEntries.push(entry(e.key, e.power.id, e.level, e.slots, e.on));
  }
  const mbd: Mbd = {
    // Version: the planner release, as X.Y.Z like the 0.1.0 it replaced
    BuiltWith: { App: PLANNER_APP, Version: numericVersion(), Database: serverOfData(gd).midsDb ?? '', DatabaseVersion: map.dbVersion, GameVersion: gd.core.manifest.dataVersion },
    Level: '49',
    Class: at.n,
    Origin: origin.n,
    // Mids has no plain Praetorian; Loyalist and Resistance only differ in its colors and labels
    Alignment: b.alignment === 'Praetorian' ? 'Loyalist' : b.alignment,
    Name: b.name,
    Comment: link ? linkComment(link, gd.core.manifest.dataVersion) : '',
    PowerSets: [gd.powerset(b.primary).n, gd.powerset(b.secondary).n, '', ...pools.slice(0, 4), epic],
    LastPower: b.picks.length,
    PowerEntries,
  };
  for (const [setId, pids] of missing) {
    const set = gd.setById.get(setId);
    const known = set?.p.some((p) => t.midsHas(p));
    if (set && !known) warn.push(`${set.dn}: Mids has no such power set, so Mids leaves out its powers and their enhancements (the planner keeps them)`);
    else if (pids.length === 1) warn.push(`${gd.power(pids[0]!).dn}${set ? ` (${set.dn})` : ''}: Mids has no such power, so Mids leaves it out with its enhancements (the planner keeps it)`);
    // several of one set (a Kheldian form's attacks): one warning naming them all
    else warn.push(`${set ? `${set.dn}: ` : ''}Mids has no ${pids.map((x) => gd.power(x).dn).join(', ')}, so Mids leaves them out with their enhancements (the planner keeps them)`);
  }
  for (const [key, { one, many, count: n }] of standIns) warn.push(`${key} ${n === 1 ? one : many.replace('#', String(n))}`);
  return { mbd, warnings: warn, powers };
}

// ---- share codes ------------------------------------------------------------------------------

/** Mids BreakString(s, 67, bookend = true): "|<67 chars>|" lines joined by "\n". */
function breakString(s: string): string {
  const lines: string[] = [];
  for (let i = 0; i < s.length; i += 67) lines.push(`|${s.slice(i, i + 67)}|`);
  return lines.join('\n');
}

/**
 * The Brotli decoder, loaded on first use (only Mids codes need it).
 *
 * @return The decoder.
 * @raise ImportProblem when it won't load: a page opened before the site was updated asks for a
 *   file the update replaced, and a reload fixes it.
 */
async function brotli() {
  try {
    const mod = await import('brotli-wasm');
    return await mod.default;
  } catch (e) {
    console.error("the Mids code reader didn't load", e);
    throw new ImportProblem("the planner couldn't load its Mids code reader (the site may have been updated since this page was opened)", 'Reload the page, then try again.');
  }
}

const BROTLI_STEP = 64 * 1024; // output bytes asked of the decoder per call

/**
 * Brotli-decompress, stopping once the output passes `limit`: Brotli packs gigabytes into a few
 * KB, so a hostile share code must not be decompressed in one go.
 *
 * @param input The compressed bytes.
 * @param limit The most bytes the output may hold.
 * @return The decompressed bytes.
 * @raise TooLarge past `limit`; an Error when the data is damaged or cut short.
 */
async function brotliDecompress(input: Uint8Array, limit: number): Promise<Uint8Array> {
  const br = await brotli();
  const codes = br.BrotliStreamResultCode;
  const ds = new br.DecompressStream();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let at = 0;
  try {
    for (;;) {
      const res = ds.decompress(input.subarray(at), BROTLI_STEP);
      const { buf, code } = res;
      at += res.input_offset;
      res.free();
      total += buf.length;
      if (total > limit) throw new TooLarge(`decompressed data passed ${limit} bytes`);
      chunks.push(buf);
      if (code === codes.ResultSuccess) return concatBytes(chunks, total);
      if (code === codes.NeedsMoreInput && at >= input.length) throw new Error('the data ends early');
    }
  } finally {
    ds.free();
  }
}

/** Encode a .mbd object as a Mids "|MBD;" data chunk (Brotli quality 11 + Base64). */
export async function mbdToChunk(mbd: Mbd): Promise<string> {
  const raw = new TextEncoder().encode(JSON.stringify(mbd));
  const br = await brotli();
  const comp = br.compress(raw, { quality: 11 });
  const b64 = toBase64(comp);
  return `|MBD;${raw.length};${comp.length};${b64.length};BASE64;|\r\n${breakString(b64)}`;
}

/** Encode the legacy |MxDz; chunk (zlib + uppercase hex) for older Mids versions. */
export async function buildToMxDz(gd: GameData, map: MidsMap, b: Build): Promise<{ text: string; warnings: string[] }> {
  const t = new Translator(gd, map);
  const { mbd, warnings, powers } = exportMbd(gd, map, b);
  const w = new ByteWriter();
  w.bytes(new Uint8Array([77, 120, 68, 12]));
  w.f32(3.2);
  w.bool(false); // qualified names
  w.bool(true); // old sub-power fields
  w.netString(mbd.Class);
  w.netString(mbd.Origin);
  w.i32(Math.max(0, MIDS_ALIGN.indexOf(mbd.Alignment)));
  w.netString(mbd.Name ?? '');
  w.i32(mbd.PowerSets.length - 1);
  for (const s of mbd.PowerSets) w.netString(s);
  w.i32(b.picks.length);
  w.i32(mbd.PowerEntries.length - 1);
  mbd.PowerEntries.forEach((p, i) => {
    const pid = powers[i];
    const si = pid !== null && pid !== undefined ? t.siByPower.get(pid) : undefined;
    if (si === undefined) {
      // a power Mids has no record of: exportMbd has warned about it
      w.i32(-1);
    } else {
      w.i32(si);
      w.i8(Math.max(0, p.Level - 1));
      w.bool(!!p.StatInclude);
      w.bool(false);
      w.i32(0);
      w.i32(0);
      w.i8(-1); // no sub powers
    }
    w.i8(p.SlotEntries.length - 1);
    for (const s of p.SlotEntries) {
      w.i8(s.Level - 1);
      w.bool(false);
      const e = s.Enhancement ? t.byUid.get((s.Enhancement.Uid ?? '').toLowerCase()) : undefined;
      if (!e) w.i32(-1);
      else {
        w.i32(e.si);
        if (e.type === 1 || e.type === 3) {
          w.i8(RELATIVE.indexOf(s.Enhancement!.RelativeLevel ?? 'Even'));
          w.i8(GRADES.indexOf(s.Enhancement!.Grade ?? 'None'));
        } else {
          w.i8(s.Enhancement!.IoLevel ?? 49);
          w.i8(RELATIVE.indexOf(s.Enhancement!.RelativeLevel ?? 'Even'));
        }
      }
      w.bool(false); // no flipped enhancement
    }
  });
  const raw = w.done();
  const comp = await streamBytes(raw, 'deflate', true);
  const hex = [...comp].map((x) => x.toString(16).padStart(2, '0')).join('').toUpperCase();
  return { text: `|MxDz;${raw.length};${comp.length};${hex.length};HEX;|\r\n${breakString(hex)}`, warnings };
}

function payloadAfterHeader(text: string, header: RegExpMatchArray): string {
  return text.slice((header.index ?? 0) + header[0].length).replace(/[|\s]/g, '');
}

/** One power line of a posted Hero Plan: the level it was taken at (1-based) and its display name. */
export interface PlanEntry {
  level: number;
  name: string;
}

/**
 * The power lines of a "Hero Plan by Mids' Hero Designer" post ("Level 8: Unyielding -- <enhancements>").
 *
 * @param head The text above the data chunk.
 * @return The lines' levels and names, in order (a power with no enhancements has no "--").
 */
function parseHeroPlan(head: string): PlanEntry[] {
  // it comes from a stranger: read within IMPORT_LIMITS.mids.plan
  const lim = IMPORT_LIMITS.mids.plan;
  const out: PlanEntry[] = [];
  for (const raw of head.slice(0, lim.chars).split('\n')) {
    if (out.length >= lim.entries) break;
    if (raw.length > lim.line) continue;
    const m = /^\s*Level\s+(\d{1,2})\s*:\s*(.*)$/.exec(stripHidden(raw));
    if (!m) continue;
    const level = Number(m[1]);
    const name = m[2]!.split(' -- ')[0]!.replace(/\s+/g, ' ').trim();
    if (level < 1 || level > 50 || !name || name.length > lim.name) continue;
    out.push({ level, name });
  }
  return out;
}

/**
 * Name the chunk's unidentified powers from the Hero Plan text.
 *
 * For each, the unused plan lines at its level are matched against the powers a player picks in
 * the chunk's own sets and the inherent sets (display name first, then the internal name's last
 * part). It is named only when that is exactly one power the chunk hasn't already identified.
 *
 * @param gd Game data.
 * @param t The translator.
 * @param sets The chunk's power set names.
 * @param cls The chunk's archetype name.
 * @param plan The Hero Plan's power lines.
 * @param known Powers the chunk identified itself (never reassigned).
 * @param lost The unidentified entries (their Level is 1-based).
 * @return The internal power name for each entry that could be named.
 */
function planNames(gd: GameData, t: Translator, sets: string[], cls: string, plan: readonly PlanEntry[], known: Set<number>, lost: MbdPower[]): Map<MbdPower, string> {
  const ids = new Set<number>();
  for (const n of sets) {
    const id = n ? setIdFor(gd, t, n) : undefined;
    if (id !== undefined) ids.add(id);
  }
  const inherent = gd.archetypeByName.get(cls.toLowerCase())?.cats.inherent;
  for (const id of (inherent && gd.core.categories[inherent]) || []) ids.add(id);
  const key = (x: string) => x.replace(/\s+/g, ' ').trim().toLowerCase();
  const byDisplay = new Map<string, Set<number>>();
  const byInternal = new Map<string, Set<number>>();
  const add = (m: Map<string, Set<number>>, k: string, pid: number) => m.set(k, (m.get(k) ?? new Set()).add(pid));
  for (const id of ids) {
    const s = gd.setById.get(id);
    s?.p.forEach((pid, i) => {
      if ((s.av[i] ?? -1) < 0) return; // only powers a player picks
      const pw = gd.power(pid);
      add(byDisplay, key(pw.dn), pid);
      add(byInternal, key((pw.n.split('.').pop() ?? '').replace(/_/g, ' ')), pid);
    });
  }
  const out = new Map<MbdPower, string>();
  const usedLines = new Set<number>();
  const taken = new Set<number>();
  for (const e of lost) {
    const found = new Map<number, number>(); // power id -> plan line, over the unused lines at its level
    plan.forEach((pl, li) => {
      if (pl.level !== e.Level || usedLines.has(li)) return;
      const k = key(pl.name);
      // a display name, even of a power already identified, is never read as an internal name
      const hit = byDisplay.has(k) ? byDisplay.get(k) : byInternal.get(k);
      for (const pid of hit ?? []) if (!taken.has(pid) && !known.has(pid)) found.set(pid, li);
    });
    if (found.size !== 1) continue;
    const [pid, li] = [...found][0]!;
    usedLines.add(li);
    taken.add(pid);
    out.set(e, gd.power(pid).n);
  }
  return out;
}

/**
 * Read a legacy |MxDz; chunk into a build file.
 *
 * @param gd Game data.
 * @param map Mids map.
 * @param bytes The inflated chunk.
 * @param plan The Hero Plan lines posted above the chunk, naming powers its indexes can't identify.
 * @return The build file and the warnings.
 */
async function mxdzToMbd(gd: GameData, map: MidsMap, bytes: Uint8Array, plan: readonly PlanEntry[] = []): Promise<{ mbd: Mbd; warnings: string[] }> {
  const t = new Translator(gd, map);
  const warn: string[] = [];
  const r = new ByteReader(bytes);
  const magic = r.bytes(4);
  if (magic[0] !== 77 || magic[1] !== 120 || magic[2] !== 68) throw DAMAGED_CODE();
  const version = r.f32();
  const qualified = r.bool();
  const hasSub = r.bool();
  const cls = r.netString();
  const origin = r.netString();
  const align = MIDS_ALIGN[r.i32()] ?? 'Hero';
  const name = r.netString();
  const nSets = r.i32();
  if (nSets >= LIMITS.sets) throw DAMAGED_CODE();
  const sets: string[] = [];
  for (let i = 0; i <= nSets; i++) sets.push(r.netString());
  r.i32(); // last power
  const nPowers = r.i32();
  if (nPowers >= LIMITS.powers) throw DAMAGED_CODE();
  // Mids added fields as its save format went on (MidsCharacterFileFormat: PriorVersion 3.10,
  // ThisVersion 3.20): a power's ProcInclude from 3.10, a power's InherentSlotsUsed and a slot's
  // IsInherent only from 3.20. A 3.10 code read with the 3.20 fields runs off its data.
  const hasProc = version >= 3.1 - 1e-4;
  const hasInherent = version >= 3.2 - 1e-4;
  const picks = gd.core.schedule.power.length;
  let held = false; // the current power's slots hold an enhancement (identified or not)
  const readSlot = (): MbdEnh | null => {
    const si = qualified ? -2 : r.i32();
    if (qualified) {
      const uid = r.netString();
      const e = t.byUid.get(uid.toLowerCase());
      if (!uid) return null;
      held = true;
      return readTail(e);
    }
    if (si < 0) return null;
    held = true;
    return readTail(t.bySi.get(si));
  };
  const readTail = (e: MidsMap['enh'][number] | undefined): MbdEnh | null => {
    const a = r.i8();
    const bb = r.i8();
    if (!e) {
      warn.push("An enhancement couldn't be identified, so its slot is empty");
      return null;
    }
    if (e.type === 1 || e.type === 3) return { Uid: e.uid, RelativeLevel: RELATIVE[a] ?? 'Even', Grade: GRADES[bb] ?? 'None' };
    return { Uid: e.uid, IoLevel: a, RelativeLevel: RELATIVE[bb] ?? 'Even', Grade: 'None' };
  };
  const entries: MbdPower[] = [];
  const knownPids = new Set<number>(); // powers the chunk itself identified
  const lost: { entry: MbdPower; text: string }[] = []; // unidentified powers; text is '' when they'd be left out quietly
  for (let i = 0; i <= nPowers; i++) {
    let powerName = '';
    let level = -1;
    let stat = false;
    let unknown = false;
    const si = qualified ? -2 : r.i32();
    const pname = qualified ? r.netString() : '';
    if (si >= 0 || (qualified && pname)) {
      const pid = qualified ? t.power(pname) : t.powerBySi.get(si);
      // the game's name: importMbd reads it as that (gameNames), not as a Mids name
      powerName = pid !== undefined ? gd.power(pid).n : '';
      unknown = pid === undefined;
      if (pid !== undefined) knownPids.add(pid);
      level = r.i8() + 1;
      stat = r.bool();
      if (hasProc) r.bool(); // ProcInclude
      r.i32(); // VariableValue
      if (hasInherent) r.i32(); // InherentSlotsUsed
      if (hasSub) {
        const ns = r.i8();
        for (let k = 0; k <= ns; k++) {
          if (qualified) r.netString();
          else r.i32();
          r.bool();
        }
      }
    }
    const nSlots = r.i8();
    if (nSlots >= LIMITS.slots) throw DAMAGED_CODE();
    const slots: MbdSlot[] = [];
    held = false;
    for (let k = 0; k <= nSlots; k++) {
      const lv = r.i8() + 1;
      if (hasInherent) r.bool(); // IsInherent
      const enh = readSlot();
      if (r.bool()) readSlot();
      slots.push({ Level: lv, Enhancement: enh });
    }
    // as importMbd does: past the picks, an unknown power with no enhancements is one the game
    // grants that Mids names its own way (Afterburner) or the data lacks (Fast_Snipe), or one the
    // planner doesn't plan (Incarnate powers): nothing is lost, so it is left out without a warning
    const entry: MbdPower = { PowerName: powerName, Level: level, StatInclude: stat, SlotEntries: slots };
    if (unknown) lost.push({ entry, text: i < picks || held ? `A power couldn't be identified${pname ? ` (${readablePower(pname)})` : ''}, so it was left out` : '' });
    entries.push(entry);
  }
  // the posted plan names what the chunk's indexes couldn't; a name that isn't exactly one power stays lost
  const named = plan.length > 0 && lost.length > 0 ? planNames(gd, t, sets, cls, plan, knownPids, lost.filter((l) => l.entry.Level >= 1).map((l) => l.entry)) : new Map<MbdPower, string>();
  for (const l of lost) {
    const n = named.get(l.entry);
    if (n) l.entry.PowerName = n;
    else if (l.text) warn.push(l.text);
  }
  return { mbd: { Class: cls, Origin: origin, Alignment: align, Name: name, PowerSets: sets, PowerEntries: entries }, warnings: warn };
}

/** Mids text decoded into a build file, before it is matched against a game version's data. */
export type MidsParsed = { kind: 'mbd'; mbd: Mbd } | { kind: 'mxdz'; raw: Uint8Array; plan?: PlanEntry[] };

/**
 * Decode any Mids text: a .mbd JSON document, a |MBD; chunk, a raw MBD share string, or a legacy
 * |MxDz; chunk. Separate from the import so the game version can be chosen from what it says.
 *
 * @param text The pasted or loaded text.
 * @return The decoded build file (a legacy chunk stays raw: reading it needs a version's data).
 */
export async function parseMidsText(text: string): Promise<MidsParsed> {
  const trimmed = text.trim();
  if (!trimmed) throw new ImportProblem("there's nothing to import", 'Paste a share link, a Mids share code or a build file, or drop a file on the box.');
  if (trimmed.length > IMPORT_LIMITS.text) throw TOO_LONG();
  if (trimmed.startsWith('{')) {
    let json: unknown;
    try {
      json = JSON.parse(trimmed);
    } catch {
      throw new ImportProblem("it isn't valid Mids build data (it looks damaged or cut short)", 'Open the build in MidsReborn, save it again, and import the new file.');
    }
    if (!isMbd(json)) throw new ImportProblem("it isn't a Mids build", READABLE);
    return { kind: 'mbd', mbd: json };
  }
  const mbdHead = trimmed.match(/\|MBD;(\d+);(\d+);(\d+);BASE64;\|/);
  const mxdHead = trimmed.match(/\|MxDz;(\d+);(\d+);(\d+);HEX;\|/);
  if (mxdHead) {
    const hex = codeBody(trimmed, mxdHead, /^[0-9A-Fa-f]*$/);
    const comp = new Uint8Array(hex.length / 2);
    for (let i = 0; i < comp.length; i++) comp[i] = parseInt(hex.substr(i * 2, 2), 16);
    try {
      const plan = parseHeroPlan(trimmed.slice(0, mxdHead.index ?? 0));
      return { kind: 'mxdz', raw: await streamBytes(comp, 'deflate', false), ...(plan.length ? { plan } : {}) };
    } catch {
      throw DAMAGED_CODE();
    }
  }
  let b64: string;
  if (mbdHead) b64 = codeBody(trimmed, mbdHead, /^[A-Za-z0-9+/=]*$/);
  else {
    // no header: a bare MBD share string, or nothing the planner reads
    if (looksBinary(trimmed)) throw new ImportProblem("it isn't a text file the planner can read", READABLE);
    b64 = trimmed.replace(/\s/g, '');
    if (!/^[A-Za-z0-9+/]{16,}={0,2}$/.test(b64)) throw new ImportProblem("it isn't a build the planner recognizes", READABLE);
  }
  await brotli(); // outside the try: a decoder that won't load says so itself (reload the page)
  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder().decode(await brotliDecompress(fromBase64(b64), /*limit=*/ IMPORT_LIMITS.text)));
  } catch {
    throw mbdHead ? DAMAGED_CODE() : new ImportProblem("it isn't a build the planner recognizes", READABLE);
  }
  if (!isMbd(json)) throw DAMAGED_CODE();
  return { kind: 'mbd', mbd: json };
}

/**
 * Whether text came from a binary file (an old .mxd, an image): control characters other than tabs
 * and line breaks, or the replacement character a binary file turns into when read as text.
 */
function looksBinary(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c < 9 || (c > 13 && c < 32) || c === 0xfffd) return true;
  }
  return false;
}

/** A Mids share code whose data won't decode. */
const DAMAGED_CODE = () => new ImportProblem('the Mids share code is damaged', 'Copy it again from where it was posted, or ask for a new one.');

// counts no real Mids build comes near
const LIMITS = IMPORT_LIMITS.mids;

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const optStr = (v: unknown) => v === undefined || v === null || typeof v === 'string';
const optNum = (v: unknown) => v === undefined || v === null || (typeof v === 'number' && Number.isFinite(v));

/** @return Whether a Mids slot entry has the shape importMbd reads. */
function isMbdSlot(s: unknown): boolean {
  if (!isObj(s) || typeof s.Level !== 'number' || !Number.isFinite(s.Level)) return false;
  const e = s.Enhancement;
  if (e === undefined || e === null) return true;
  return isObj(e) && optStr(e.Uid) && optStr(e.Enhancement) && optStr(e.Grade) && optStr(e.RelativeLevel) && optNum(e.IoLevel);
}

/**
 * Whether parsed JSON is a Mids build file importMbd can read: every field it reads has the type
 * it expects and no list is longer than a real build's, so a damaged or hostile file is refused
 * as such instead of failing part way through the import.
 *
 * @param j The parsed JSON.
 * @return True for a readable build file.
 */
function isMbd(j: unknown): j is Mbd {
  if (!isObj(j) || typeof j.Class !== 'string' || !optStr(j.Origin) || !optStr(j.Alignment) || !optStr(j.Name)) return false;
  if (j.BuiltWith !== undefined && j.BuiltWith !== null && !(isObj(j.BuiltWith) && optStr(j.BuiltWith.Database) && optStr(j.BuiltWith.GameVersion))) return false;
  if (j.PowerSets !== undefined && !(Array.isArray(j.PowerSets) && j.PowerSets.length <= LIMITS.sets && j.PowerSets.every(optStr))) return false;
  const entries = j.PowerEntries;
  if (!Array.isArray(entries) || entries.length > LIMITS.powers) return false;
  return entries.every(
    (p) =>
      isObj(p) &&
      optStr(p.PowerName) &&
      optNum(p.Level) &&
      (p.StatInclude === undefined || p.StatInclude === null || typeof p.StatInclude === 'boolean') &&
      Array.isArray(p.SlotEntries) &&
      p.SlotEntries.length <= LIMITS.slots &&
      p.SlotEntries.every(isMbdSlot),
  );
}

/**
 * The data of a |MBD; or |MxDz; chunk: the lines after its header, without the '|' bookends and
 * line breaks, cut to the length the header gives.
 *
 * @param text The pasted text.
 * @param header The header match; its third number is the data's length.
 * @param alphabet The characters the data may hold.
 * @return The data.
 * @raise ImportProblem when the data is shorter than the header says, or holds other characters.
 */
function codeBody(text: string, header: RegExpMatchArray, alphabet: RegExp): string {
  const want = Number(header[3]);
  const body = payloadAfterHeader(text, header).slice(0, want);
  if (!alphabet.test(body)) {
    throw new ImportProblem(
      "the Mids share code has characters a share code can't have",
      'It may have been changed while it was copied (a forum or chat app can do that). Copy it again from where it was posted.',
    );
  }
  if (body.length < want) throw new ImportProblem('part of the Mids share code is missing', 'Copy the whole code again, from its first line (|MBD; or |MxDz;) to its last.');
  return body;
}

/**
 * Why a Mids build's archetype or sets may be missing: another server's database, else a newer patch.
 *
 * @param gd The data it was imported against (its server).
 * @param m The build file.
 * @return A sentence for the user.
 */
function notOursHint(gd: GameData, m: Mbd): string {
  const db = m.BuiltWith?.Database;
  if (!db || db.toLowerCase() === serverOfData(gd).midsDb?.toLowerCase()) return 'It may come from a newer patch than the planner has.';
  const carried = serverByMidsDb(db);
  if (carried) return `It was made with Mids' ${carried.label} database: switch to ${carried.label} on New Build, then import it there.`;
  const ours = SERVERS.map((s) => s.label).join(', ');
  return `It was made with Mids' ${readable(db)} database, for another server; the planner covers ${ours} only.`;
}

/**
 * Import a decoded Mids build against one game version's data.
 *
 * @param gd That version's data.
 * @param map That version's mids-map.json.
 * @param p The decoded build (parseMidsText).
 * @return The build and the warnings for anything that could not be mapped.
 */
export async function importParsed(gd: GameData, map: MidsMap, p: MidsParsed): Promise<ImportResult> {
  if (p.kind === 'mbd') return importMbd(gd, map, p.mbd, { link: await linkedBuild(gd, p.mbd) });
  let legacy: { mbd: Mbd; warnings: string[] };
  try {
    legacy = await mxdzToMbd(gd, map, p.raw, p.plan);
  } catch (e) {
    throw e instanceof EndOfData ? DAMAGED_CODE() : e; // the data ran out: a damaged code
  }
  const { mbd, warnings } = legacy;
  const res = importMbd(gd, map, mbd, { gameNames: true });
  return { build: res.build, warnings: [...warnings, ...res.warnings] };
}

/** Import any Mids text (parseMidsText, then importParsed) against one game version's data. */
export async function importMidsText(gd: GameData, map: MidsMap, text: string): Promise<ImportResult> {
  return importParsed(gd, map, await parseMidsText(text));
}
