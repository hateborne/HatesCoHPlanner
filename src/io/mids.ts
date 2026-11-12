/**
 * MidsReborn interop: .mbd JSON files, |MBD; share codes (Brotli + Base64) and legacy |MxDz;
 * data chunks (zlib + hex, .NET BinaryWriter payload, MidsCharacterFileFormat.cs v3.20).
 * Names and IDs go through mids-map.json; anything that can't be mapped is reported, never
 * silently dropped.
 */
import type { GameData } from '../data/gamedata.ts';
import { toAlignment, type Build, type Slot, type SlottedEnh } from '../engine/build.ts';
import { enhKind, shortName } from '../engine/enhance.ts';
import { BuildRules } from '../engine/rules.ts';
import { defaultOn, defaultsOf, exclusiveGroups } from '../engine/totals.ts';
import { ByteReader, ByteWriter, EndOfData, fromBase64, streamBytes, toBase64 } from './binary.ts';
import { ImportProblem, READABLE, readable, readablePower } from './importProblem.ts';
import { PLANNER_APP } from './midsPatches.ts';

export interface MidsMap {
  dbVersion: string;
  renames: Record<string, string>;
  powers: [number, number][]; // [mids StaticIndex, game power id]
  enh: { si: number; uid: string; name: string; long?: string; type: number; boost?: number; normal?: string }[];
}

export interface ImportResult {
  build: Build;
  warnings: string[];
}

const MIDS_ALIGN = ['Hero', 'Rogue', 'Vigilante', 'Villain', 'Loyalist', 'Resistance'];
const RELATIVE = ['None', 'MinusThree', 'MinusTwo', 'MinusOne', 'Even', 'PlusOne', 'PlusTwo', 'PlusThree', 'PlusFour', 'PlusFive'];
const GRADES = ['None', 'TrainingO', 'DualO', 'SingleO'];

const mapPromises = new Map<string, Promise<MidsMap>>(); // one per game version

/**
 * Load mids-map.json for the current data version (once). MidsReborn is an untrusted reference,
 * so a missing or broken map rejects with a readable message and the next call tries again.
 */
export function loadMidsMap(gd: GameData): Promise<MidsMap> {
  const version = gd.core.manifest.dataVersion;
  const hit = mapPromises.get(version);
  if (hit) return hit;
  const p = fetch(`${import.meta.env.BASE_URL}data/${version}/mids-map.json?v=${gd.core.manifest.hash ?? ''}`)
    .then(async (r) => {
      if (!r.ok) throw new Error(`Mids data is not available for this game version (HTTP ${r.status})`);
      const m = (await r.json()) as MidsMap;
      if (!m || !Array.isArray(m.enh) || !Array.isArray(m.powers)) throw new Error('Mids data is incomplete');
      return m;
    })
    .catch((e: unknown) => {
      mapPromises.delete(version);
      throw e instanceof Error ? e : new Error(String(e));
    });
  mapPromises.set(version, p);
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

/** Lookups built from the map + game data. */
class Translator {
  readonly renames = new Map<string, string>();
  readonly reverseRenames = new Map<string, string>();
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
    for (const e of map.enh) {
      this.byUid.set(e.uid.toLowerCase(), e);
      this.bySi.set(e.si, e);
      if (e.boost !== undefined) this.boostToMids.set(e.boost, e);
      if (e.normal) this.normalBySuffix.set(e.normal.toLowerCase(), e);
      if (e.long) this.byName.set(norm(e.long), e);
      if (e.type === 1) this.byName.set(norm(e.name), e);
    }
    for (const [si, pid] of map.powers) {
      this.powerBySi.set(si, pid);
      if (!this.siByPower.has(pid)) this.siByPower.set(pid, si);
    }
    for (const b of gd.boosts) {
      this.boostByDisplay.set(norm(b.dn), b.id);
      this.boostsByDisplay.set(norm(b.dn), [...(this.boostsByDisplay.get(norm(b.dn)) ?? []), b.id]);
    }
  }

  power(name: string): number | undefined {
    const n = this.renames.get(name.toLowerCase()) ?? swapEpic(name, EPIC_TO_GAME) ?? name;
    return this.gd.powerByName.get(n.toLowerCase())?.id;
  }

  midsPowerName(pid: number): string {
    const n = this.gd.power(pid).n;
    return this.reverseRenames.get(n.toLowerCase()) ?? swapEpic(n, EPIC_TO_MIDS) ?? n;
  }

  /** Game enhancement for a Mids enhancement (normal grades resolve by origin). */
  boostFor(entry: MidsMap['enh'][number] | undefined, grade: string, origin: string): number | undefined {
    if (!entry) return undefined;
    if (entry.boost !== undefined) return entry.boost;
    if (!entry.normal) return this.boostByLongName(entry);
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

  /** Mids record + grade for one of our enhancements. */
  midsFor(boostId: number): { entry: MidsMap['enh'][number]; grade: string } | undefined {
    const direct = this.boostToMids.get(boostId);
    if (direct) return { entry: direct, grade: 'None' };
    const b = this.gd.power(boostId);
    if (enhKind(this.gd, b) === 'Training' || enhKind(this.gd, b) === 'Origin') {
      const suffix = shortName(b).replace(/^(Generic|Magic|Mutation|Natural|Science|Technology)_/, '');
      const entry = this.normalBySuffix.get(suffix.toLowerCase());
      if (entry) return { entry, grade: enhKind(this.gd, b) === 'Training' ? 'TrainingO' : 'SingleO' };
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

/**
 * Convert a Mids .mbd object into a build.
 *
 * @param gd Game data.
 * @param map Mids map.
 * @param m Parsed .mbd JSON.
 */
export function importMbd(gd: GameData, map: MidsMap, m: Mbd): ImportResult {
  const t = new Translator(gd, map);
  const warn: string[] = [];
  const at = gd.archetypeByName.get(m.Class.toLowerCase());
  if (!at) throw new ImportProblem(`its archetype (${readable(m.Class.replace(/^Class_/i, ''))}) isn't one the planner has`, notOursHint(m));
  const origin = gd.core.origins.find((o) => o.n.toLowerCase() === (m.Origin ?? '').toLowerCase()) ?? gd.core.origins[0]!;
  const alignment = toAlignment(m.Alignment);
  const sets = Array.isArray(m.PowerSets) ? m.PowerSets : [];
  const primary = setIdFor(gd, t, sets[0] ?? '');
  const secondary = setIdFor(gd, t, sets[1] ?? '');
  if (primary === undefined || secondary === undefined) {
    const name = (s: string | undefined) => readable((s ?? '').split('.').pop() || 'none');
    throw new ImportProblem(`its power sets (${name(sets[0])} / ${name(sets[1])}) aren't ones the planner has`, notOursHint(m));
  }
  const sched = gd.core.schedule.power;
  const b: Build = {
    v: 1,
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
    if (!bp.bie && rel > 0) out.rel = rel - 4;
    if (bp.bb && rel > 4) out.boosters = rel - 4;
    return out;
  };
  // Mids' StatInclude, by entry key: applied once the build is put together (applyStats), since a
  // power's default can depend on the rest of the build
  const stats = new Map<string, boolean>();
  const toSlots = (p: MbdPower, where: string): Slot[] =>
    p.SlotEntries.map((s) => ({ level: Math.max(0, s.Level - 1), enh: toEnh(s.Enhancement, where) }));

  const used = new Set<number>();
  m.PowerEntries.forEach((p, i) => {
    if (!p.PowerName) return;
    const pid = t.power(p.PowerName);
    if (pid === undefined) {
      // Auto-granted powers Mids names differently only matter if they carried enhancements.
      if (i < sched.length || p.SlotEntries.some((s) => s.Enhancement)) {
        warn.push(`${readablePower(p.PowerName)} isn't in the planner's game data, so it was left out`);
      }
      return;
    }
    const level = Math.max(0, p.Level - 1);
    const name = gd.power(pid).dn;
    if (i < sched.length) {
      let idx = sched[i] === level && !used.has(i) ? i : -1;
      if (idx < 0) idx = sched.findIndex((l, k) => l === level && !used.has(k));
      if (idx < 0) {
        warn.push(`${name} was taken at level ${p.Level}, which has no free power pick, so it was left out`);
        return;
      }
      used.add(idx);
      b.picks[idx] = { power: pid, level, slots: toSlots(p, name) };
      if (typeof p.StatInclude === 'boolean') stats.set(`pick:${idx}`, p.StatInclude);
    } else {
      b.granted[pid] = { slots: toSlots(p, name) };
      if (typeof p.StatInclude === 'boolean') stats.set(`grant:${pid}`, p.StatInclude);
    }
  });
  applyStats(gd, b, stats);
  return { build: b, warnings: warn };
}

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
  for (const [key, on] of stats) {
    const pid = powerOf(key);
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
 */
export function exportMbd(gd: GameData, map: MidsMap, b: Build): { mbd: Mbd; warnings: string[] } {
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
  const enh = (s: Slot): MbdEnh | null => {
    if (!s.enh) return null;
    const m = t.midsFor(s.enh.boost);
    if (!m) {
      warn.push(`Enhancement ${gd.power(s.enh.boost).dn} has no Mids equivalent`);
      return null;
    }
    const bp = gd.power(s.enh.boost);
    const rel = bp.bie ? 4 + (s.enh.boosters ?? 0) : 4 + (s.enh.rel ?? 0);
    return { Uid: m.entry.uid, Grade: m.grade, IoLevel: s.enh.ioLevel ?? 49, RelativeLevel: RELATIVE[rel] ?? 'Even', Obtained: false };
  };
  const entries = rules.entries();
  const defaults = defaultsOf(gd, rules.entries());
  const entry = (key: string, pid: number | null, level: number, slots: Slot[], on: boolean | undefined): MbdPower => ({
    PowerName: pid === null ? '' : t.midsPowerName(pid),
    Level: pid === null ? -1 : level + 1,
    // Mids has no "default": write what the planner actually counts (defaultsOf)
    StatInclude: pid === null ? false : (on ?? defaults.get(key) ?? defaultOn(gd.power(pid))),
    ProcInclude: false,
    VariableValue: 0,
    InherentSlotsUsed: 0,
    SubPowerEntries: [],
    SlotEntries: slots.map((s) => ({ Level: s.level + 1, IsInherent: false, Enhancement: enh(s), FlippedEnhancement: null })),
  });
  const PowerEntries: MbdPower[] = b.picks.map((p, i) => {
    const e = entries.find((x) => x.key === `pick:${i}`);
    return p && e ? entry(e.key, p.power, p.level, e.slots, p.on ?? undefined) : entry('', null, 0, [], false);
  });
  for (const e of entries.filter((x) => x.source === 'grant')) {
    PowerEntries.push(entry(e.key, e.power.id, e.level, e.slots, e.on));
  }
  const mbd: Mbd = {
    BuiltWith: { App: PLANNER_APP, Version: '0.1.0', Database: 'Homecoming', DatabaseVersion: map.dbVersion, GameVersion: gd.core.manifest.dataVersion },
    Level: '49',
    Class: at.n,
    Origin: origin.n,
    // Mids has no plain Praetorian; Loyalist and Resistance only differ in its colors and labels
    Alignment: b.alignment === 'Praetorian' ? 'Loyalist' : b.alignment,
    Name: b.name,
    Comment: '',
    PowerSets: [gd.powerset(b.primary).n, gd.powerset(b.secondary).n, '', ...pools.slice(0, 4), epic],
    LastPower: b.picks.length,
    PowerEntries,
  };
  return { mbd, warnings: warn };
}

// ---- share codes ------------------------------------------------------------------------------

/** Mids BreakString(s, 67, bookend = true): "|<67 chars>|" lines joined by "\n". */
function breakString(s: string): string {
  const lines: string[] = [];
  for (let i = 0; i < s.length; i += 67) lines.push(`|${s.slice(i, i + 67)}|`);
  return lines.join('\n');
}

async function brotli() {
  const mod = await import('brotli-wasm');
  return mod.default;
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
  const { mbd, warnings } = exportMbd(gd, map, b);
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
  for (const p of mbd.PowerEntries) {
    const pid = p.PowerName ? t.power(p.PowerName) : undefined;
    const si = pid !== undefined ? t.siByPower.get(pid) : undefined;
    if (si === undefined) {
      if (p.PowerName && p.SlotEntries.some((s) => s.Enhancement)) warnings.push(`${p.PowerName}: no Mids index`);
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
  }
  const raw = w.done();
  const comp = await streamBytes(raw, 'deflate', true);
  const hex = [...comp].map((x) => x.toString(16).padStart(2, '0')).join('').toUpperCase();
  return { text: `|MxDz;${raw.length};${comp.length};${hex.length};HEX;|\r\n${breakString(hex)}`, warnings };
}

function payloadAfterHeader(text: string, header: RegExpMatchArray): string {
  return text.slice((header.index ?? 0) + header[0].length).replace(/[|\s]/g, '');
}

async function mxdzToMbd(gd: GameData, map: MidsMap, bytes: Uint8Array): Promise<{ mbd: Mbd; warnings: string[] }> {
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
  const sets: string[] = [];
  for (let i = 0; i <= nSets; i++) sets.push(r.netString());
  r.i32(); // last power
  const nPowers = r.i32();
  const v310 = version >= 3.1 - 1e-4;
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
  for (let i = 0; i <= nPowers; i++) {
    let powerName = '';
    let level = -1;
    let stat = false;
    let unknown = false;
    const si = qualified ? -2 : r.i32();
    const pname = qualified ? r.netString() : '';
    if (si >= 0 || (qualified && pname)) {
      const pid = qualified ? t.power(pname) : t.powerBySi.get(si);
      powerName = pid !== undefined ? gd.power(pid).n : '';
      unknown = pid === undefined;
      level = r.i8() + 1;
      stat = r.bool();
      if (v310) r.bool();
      r.i32();
      if (v310) r.i32();
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
    const slots: MbdSlot[] = [];
    held = false;
    for (let k = 0; k <= nSlots; k++) {
      const lv = r.i8() + 1;
      if (v310) r.bool();
      const enh = readSlot();
      if (r.bool()) readSlot();
      slots.push({ Level: lv, Enhancement: enh });
    }
    // as importMbd does: past the picks, an unknown power with no enhancements is one the game
    // grants that Mids names its own way (Afterburner) or the data lacks (Fast_Snipe), or one the
    // planner doesn't plan (Incarnate powers): nothing is lost, so it is left out without a warning
    if (unknown && (i < picks || held)) warn.push(`A power couldn't be identified${pname ? ` (${readablePower(pname)})` : ''}, so it was left out`);
    entries.push({ PowerName: powerName, Level: level, StatInclude: stat, SlotEntries: slots });
  }
  return { mbd: { Class: cls, Origin: origin, Alignment: align, Name: name, PowerSets: sets, PowerEntries: entries }, warnings: warn };
}

/** Mids text decoded into a build file, before it is matched against a game version's data. */
export type MidsParsed = { kind: 'mbd'; mbd: Mbd } | { kind: 'mxdz'; raw: Uint8Array };

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
      return { kind: 'mxdz', raw: await streamBytes(comp, 'deflate', false) };
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
  const br = await brotli(); // outside the try: the decoder failing to load is on our side
  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder().decode(br.decompress(fromBase64(b64))));
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

/** @return Whether parsed JSON has the fields a Mids build file needs. */
function isMbd(j: unknown): j is Mbd {
  const m = j as Partial<Mbd> | null;
  return !!m && typeof m === 'object' && typeof m.Class === 'string' && Array.isArray(m.PowerEntries);
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
 * @param m The build file.
 * @return A sentence for the user.
 */
function notOursHint(m: Mbd): string {
  const db = m.BuiltWith?.Database;
  return db && !/^homecoming$/i.test(db)
    ? `It was made with Mids' ${db} database, for another server; the planner covers Homecoming only.`
    : 'It may come from a newer patch than the planner has.';
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
  if (p.kind === 'mbd') return importMbd(gd, map, p.mbd);
  let legacy: { mbd: Mbd; warnings: string[] };
  try {
    legacy = await mxdzToMbd(gd, map, p.raw);
  } catch (e) {
    throw e instanceof EndOfData ? DAMAGED_CODE() : e; // the data ran out: a damaged code
  }
  const { mbd, warnings } = legacy;
  const res = importMbd(gd, map, mbd);
  return { build: res.build, warnings: [...warnings, ...res.warnings] };
}

/** Import any Mids text (parseMidsText, then importParsed) against one game version's data. */
export async function importMidsText(gd: GameData, map: MidsMap, text: string): Promise<ImportResult> {
  return importParsed(gd, map, await parseMidsText(text));
}
