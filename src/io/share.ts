/**
 * Share-URL format: the whole build bit-packed with the pipeline's stable IDs, deflated and
 * base64url-encoded (zlib deflate) into `#b=...`. No server involved.
 *
 * Layout (v1): u8 version, varint at, origin, alignment, primary, secondary, name, exemplar+1,
 * varint pickCount, picks, varint grantedCount, granted; each pick/grant: varint power (0 empty),
 * u8 on (0 default, 1 on, 2 off), varint slotCount, slots: u8 level, enh.
 * enh: varint boost (0 none), u8 flags (1 ioLevel, 2 rel, 4 boosters), then the flagged values.
 * Optional trailer: varint endLevel+1 (0: planned to 50), then the game version id as a string.
 * Links made before the trailer end after the granted list or after endLevel; they open with
 * LEGACY_GAME_VERSION (the only data that existed then).
 */
import { LEGACY_GAME_VERSION } from '../data/versions.ts';
import { toAlignment, type Build, type Slot } from '../engine/build.ts';
import { ByteReader, ByteWriter, fromBase64Url, streamBytes, toBase64Url } from './binary.ts';

const VERSION = 1;

function writeSlots(w: ByteWriter, slots: Slot[]): void {
  w.varint(slots.length);
  for (const s of slots) {
    w.u8(s.level);
    const e = s.enh;
    w.varint(e ? e.boost : 0);
    if (!e) continue;
    const flags = (e.ioLevel !== undefined ? 1 : 0) | (e.rel ? 2 : 0) | (e.boosters ? 4 : 0);
    w.u8(flags);
    if (flags & 1) w.u8(e.ioLevel!);
    if (flags & 2) w.u8(e.rel! + 8);
    if (flags & 4) w.u8(e.boosters!);
  }
}

function readSlots(r: ByteReader): Slot[] {
  const n = r.varint();
  const out: Slot[] = [];
  for (let i = 0; i < n; i++) {
    const level = r.u8();
    const boost = r.varint();
    if (!boost) {
      out.push({ level });
      continue;
    }
    const flags = r.u8();
    const enh: Slot['enh'] = { boost };
    if (flags & 1) enh.ioLevel = r.u8();
    if (flags & 2) enh.rel = r.u8() - 8;
    if (flags & 4) enh.boosters = r.u8();
    out.push({ level, enh });
  }
  return out;
}

// v1 alignment codes, kept from before Vigilante / Rogue / Loyalist / Resistance were folded in
const SHARE_ALIGN = ['Hero', 'Vigilante', 'Villain', 'Rogue', 'Praetorian', 'Resistance'];

const onCode = (on: boolean | undefined) => (on === undefined ? 0 : on ? 1 : 2);
const onValue = (c: number) => (c === 0 ? undefined : c === 1);

/** Encode a build as the share fragment payload (without '#b='). */
export async function encodeShare(b: Build): Promise<string> {
  const w = new ByteWriter();
  w.u8(VERSION);
  w.varint(b.at);
  w.varint(b.origin);
  w.varint(Math.max(0, SHARE_ALIGN.indexOf(b.alignment)));
  w.varint(b.primary);
  w.varint(b.secondary);
  w.netString(b.name);
  w.varint(b.exemplar === undefined ? 0 : b.exemplar + 1);
  w.varint(b.picks.length);
  for (const p of b.picks) {
    w.varint(p ? p.power : 0);
    if (!p) continue;
    w.u8(p.level);
    w.u8(onCode(p.on));
    writeSlots(w, p.slots);
  }
  const grants = Object.entries(b.granted).filter(([, g]) => g.slots.length || g.on !== undefined);
  w.varint(grants.length);
  for (const [pid, g] of grants) {
    w.varint(Number(pid));
    w.u8(onCode(g.on));
    writeSlots(w, g.slots);
  }
  w.varint(b.endLevel === undefined ? 0 : b.endLevel + 1);
  w.netString(b.dataVersion);
  return toBase64Url(await streamBytes(w.done(), 'deflate', true));
}

/** Decode a share payload back into a build; dataVersion is the game version the link carries. */
export async function decodeShare(payload: string): Promise<Build> {
  const r = new ByteReader(await streamBytes(fromBase64Url(payload), 'deflate', false));
  const v = r.u8();
  if (v !== VERSION) throw new Error(`unsupported share version ${v}`);
  const at = r.varint();
  const origin = r.varint();
  const alignment = toAlignment(SHARE_ALIGN[r.varint()]);
  const primary = r.varint();
  const secondary = r.varint();
  const name = r.netString();
  const ex = r.varint();
  const n = r.varint();
  const picks: Build['picks'] = [];
  for (let i = 0; i < n; i++) {
    const power = r.varint();
    if (!power) {
      picks.push(null);
      continue;
    }
    const level = r.u8();
    const on = onValue(r.u8());
    picks.push({ power, level, on, slots: readSlots(r) });
  }
  const granted: Build['granted'] = {};
  const g = r.varint();
  for (let i = 0; i < g; i++) {
    const pid = r.varint();
    const on = onValue(r.u8());
    granted[pid] = { on, slots: readSlots(r) };
  }
  const end = r.left > 0 ? r.varint() : 0;
  const dataVersion = r.left > 0 ? r.netString() : LEGACY_GAME_VERSION;
  return { v: 1, dataVersion, name, at, origin, alignment, primary, secondary, picks, granted, exemplar: ex ? ex - 1 : undefined, endLevel: end ? end - 1 : undefined };
}

/** Full share link for the current page. */
export async function shareLink(b: Build): Promise<string> {
  const base = `${location.origin}${location.pathname}`;
  return `${base}#b=${await encodeShare(b)}`;
}
