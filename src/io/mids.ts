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
import { defaultOn } from '../engine/totals.ts';
import { ByteReader, ByteWriter, fromBase64, streamBytes, toBase64 } from './binary.ts';
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
    const n = this.renames.get(name.toLowerCase()) ?? name;
    return this.gd.powerByName.get(n.toLowerCase())?.id;
  }

  midsPowerName(pid: number): string {
    const n = this.gd.power(pid).n;
    return this.reverseRenames.get(n.toLowerCase()) ?? n;
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
  if (!at) throw new Error(`Unknown archetype ${m.Class}`);
  const origin = gd.core.origins.find((o) => o.n.toLowerCase() === m.Origin.toLowerCase()) ?? gd.core.origins[0]!;
  const alignment = toAlignment(m.Alignment);
  const primary = setIdFor(gd, t, m.PowerSets[0] ?? '');
  const secondary = setIdFor(gd, t, m.PowerSets[1] ?? '');
  if (primary === undefined || secondary === undefined) throw new Error(`Unknown power sets ${m.PowerSets[0]} / ${m.PowerSets[1]}`);
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
      warn.push(`${where}: enhancement "${e.Uid ?? e.Enhancement}" not found`);
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
  // Mids' StatInclude is always explicit; keep it only when it differs from the planner's
  // default for the power, so an export -> import round trip leaves the build unchanged
  const onOverride = (pid: number, stat: boolean | undefined): boolean | undefined =>
    stat === undefined || stat === defaultOn(gd.power(pid)) ? undefined : stat;
  const toSlots = (p: MbdPower, where: string): Slot[] =>
    p.SlotEntries.map((s) => ({ level: Math.max(0, s.Level - 1), enh: toEnh(s.Enhancement, where) }));

  const used = new Set<number>();
  m.PowerEntries.forEach((p, i) => {
    if (!p.PowerName) return;
    const pid = t.power(p.PowerName);
    if (pid === undefined) {
      // Auto-granted powers Mids names differently only matter if they carried enhancements.
      if (i < sched.length || p.SlotEntries.some((s) => s.Enhancement)) {
        warn.push(`Power "${p.PowerName}" not found in the current game data`);
      }
      return;
    }
    const level = Math.max(0, p.Level - 1);
    const name = gd.power(pid).dn;
    if (i < sched.length) {
      let idx = sched[i] === level && !used.has(i) ? i : -1;
      if (idx < 0) idx = sched.findIndex((l, k) => l === level && !used.has(k));
      if (idx < 0) {
        warn.push(`${name}: no free pick at level ${p.Level}`);
        return;
      }
      used.add(idx);
      b.picks[idx] = { power: pid, level, slots: toSlots(p, name), on: onOverride(pid, p.StatInclude) };
    } else {
      b.granted[pid] = { slots: toSlots(p, name), on: onOverride(pid, p.StatInclude) };
    }
  });
  return { build: b, warnings: warn };
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
    if (kind === 'epic') epic = ref.set.n;
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
  const entry = (pid: number | null, level: number, slots: Slot[], on: boolean | undefined): MbdPower => ({
    PowerName: pid === null ? '' : t.midsPowerName(pid),
    Level: pid === null ? -1 : level + 1,
    // Mids has no "default": write what the planner actually counts (autos and toggles on)
    StatInclude: pid === null ? false : (on ?? defaultOn(gd.power(pid))),
    ProcInclude: false,
    VariableValue: 0,
    InherentSlotsUsed: 0,
    SubPowerEntries: [],
    SlotEntries: slots.map((s) => ({ Level: s.level + 1, IsInherent: false, Enhancement: enh(s), FlippedEnhancement: null })),
  });
  const entries = rules.entries();
  const PowerEntries: MbdPower[] = b.picks.map((p, i) => {
    const e = entries.find((x) => x.key === `pick:${i}`);
    return p && e ? entry(p.power, p.level, e.slots, p.on ?? undefined) : entry(null, 0, [], false);
  });
  for (const e of entries.filter((x) => x.source === 'grant')) {
    PowerEntries.push(entry(e.power.id, e.level, e.slots, e.on));
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
  if (magic[0] !== 77 || magic[1] !== 120 || magic[2] !== 68) throw new Error('Not a Mids MxD build');
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
  const readSlot = (): MbdEnh | null => {
    const si = qualified ? -2 : r.i32();
    if (qualified) {
      const uid = r.netString();
      const e = t.byUid.get(uid.toLowerCase());
      if (!uid) return null;
      return readTail(e);
    }
    if (si < 0) return null;
    return readTail(t.bySi.get(si));
  };
  const readTail = (e: MidsMap['enh'][number] | undefined): MbdEnh | null => {
    const a = r.i8();
    const bb = r.i8();
    if (!e) {
      warn.push('Unknown enhancement index in MxD data');
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
    const si = qualified ? -2 : r.i32();
    const pname = qualified ? r.netString() : '';
    if (si >= 0 || (qualified && pname)) {
      const pid = qualified ? t.power(pname) : t.powerBySi.get(si);
      powerName = pid !== undefined ? gd.power(pid).n : '';
      if (pid === undefined) warn.push(`Unknown power index ${si}${pname ? ` (${pname})` : ''}`);
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
    for (let k = 0; k <= nSlots; k++) {
      const lv = r.i8() + 1;
      if (v310) r.bool();
      const enh = readSlot();
      if (r.bool()) readSlot();
      slots.push({ Level: lv, Enhancement: enh });
    }
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
  if (trimmed.startsWith('{')) return { kind: 'mbd', mbd: JSON.parse(trimmed) as Mbd };
  const mbdHead = trimmed.match(/\|MBD;(\d+);(\d+);(\d+);BASE64;\|/);
  const mxdHead = trimmed.match(/\|MxDz;(\d+);(\d+);(\d+);HEX;\|/);
  if (mxdHead) {
    const hex = payloadAfterHeader(trimmed, mxdHead).slice(0, Number(mxdHead[3]));
    const comp = new Uint8Array(hex.length / 2);
    for (let i = 0; i < comp.length; i++) comp[i] = parseInt(hex.substr(i * 2, 2), 16);
    return { kind: 'mxdz', raw: await streamBytes(comp, 'deflate', false) };
  }
  const b64 = mbdHead ? payloadAfterHeader(trimmed, mbdHead).slice(0, Number(mbdHead[3])) : trimmed.replace(/\s/g, '');
  const br = await brotli();
  return { kind: 'mbd', mbd: JSON.parse(new TextDecoder().decode(br.decompress(fromBase64(b64)))) as Mbd };
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
  const { mbd, warnings } = await mxdzToMbd(gd, map, p.raw);
  const res = importMbd(gd, map, mbd);
  return { build: res.build, warnings: [...warnings, ...res.warnings] };
}

/** Import any Mids text (parseMidsText, then importParsed) against one game version's data. */
export async function importMidsText(gd: GameData, map: MidsMap, text: string): Promise<ImportResult> {
  return importParsed(gd, map, await parseMidsText(text));
}
