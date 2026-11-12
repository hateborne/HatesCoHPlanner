/**
 * Share-URL format: the whole build bit-packed with the pipeline's stable IDs, deflated and
 * base64url-encoded (zlib deflate) into `#b=...`. No server involved.
 *
 * Layout (v1): u8 version, varint at, origin, alignment, primary, secondary, name, exemplar+1,
 * varint pickCount, picks, varint grantedCount, granted; each pick/grant: varint power (0 empty),
 * u8 on (0 default, 1 on, 2 off), varint slotCount, slots: u8 level, enh.
 * enh: varint boost (0 none), u8 flags (1 ioLevel, 2 rel, 4 boosters), then the flagged values.
 * Optional trailer: varint endLevel+1 (0: planned to 50), then the game version id as a string,
 * then varint respecTo+1 (0: a leveling build).
 * Links made before the trailer end after the granted list or after endLevel; they open with
 * LEGACY_GAME_VERSION (the only data that existed then).
 */
import { LEGACY_GAME_VERSION } from '../data/versions.ts';
import { toAlignment, type Build, type Slot } from '../engine/build.ts';
import { ByteReader, ByteWriter, fromBase64Url, streamBytes, toBase64Url } from './binary.ts';
import { ImportProblem } from './importProblem.ts';

const VERSION = 1;

// Counts no real build comes near (24 picks, 6 slots a power, a few dozen granted powers): a link
// past them is damaged, refused before it can grow huge arrays
const MAX_PICKS = 64;
const MAX_SLOTS = 32;
const MAX_GRANTED = 512;
// a full level-50 build's code is under 1,000 characters
const MAX_PAYLOAD = 64 * 1024;

/**
 * Read a count from the link, refusing one past `max`.
 *
 * @param r The reader.
 * @param max The largest count a real build could have.
 * @return The count.
 * @raise RangeError when it is larger (decodeShare reports it as a damaged link).
 */
function count(r: ByteReader, max: number): number {
  const n = r.varint();
  if (n > max) throw new RangeError(`count ${n} past ${max}`);
  return n;
}

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
  const n = count(r, MAX_SLOTS);
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
  w.varint(b.respecTo === undefined ? 0 : b.respecTo + 1);
  return toBase64Url(await streamBytes(w.done(), 'deflate', true));
}

/**
 * Decode a share payload back into a build; dataVersion is the game version the link carries.
 *
 * @param payload The code after '#b='.
 * @return The build, not yet checked against its game data (checkBuild).
 * @raise ImportProblem when the link is damaged, cut short, or from a newer planner.
 */
export async function decodeShare(payload: string): Promise<Build> {
  try {
    return await readShare(payload);
  } catch (e) {
    if (e instanceof ImportProblem) throw e;
    // bad Base64, a stream that won't inflate (or inflates past MAX_INFLATED), bytes that run out
    // or counts no build has: all a damaged link
    throw new ImportProblem('the share link is damaged or cut short', 'Copy the whole link again (it ends with the long code after #b=) and paste it.');
  }
}

async function readShare(payload: string): Promise<Build> {
  if (payload.length > MAX_PAYLOAD) throw new RangeError(`link ${payload.length} characters long`);
  const r = new ByteReader(await streamBytes(fromBase64Url(payload), 'deflate', false));
  const v = r.u8();
  if (v !== VERSION) throw new ImportProblem('the share link was made by a newer version of the planner', 'Reload the page to get the newest version, then try again.');
  const at = r.varint();
  const origin = r.varint();
  const alignment = toAlignment(SHARE_ALIGN[r.varint()]);
  const primary = r.varint();
  const secondary = r.varint();
  const name = r.netString();
  const ex = r.varint();
  const n = count(r, MAX_PICKS);
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
  const g = count(r, MAX_GRANTED);
  for (let i = 0; i < g; i++) {
    const pid = r.varint();
    const on = onValue(r.u8());
    granted[pid] = { on, slots: readSlots(r) };
  }
  const end = r.left > 0 ? r.varint() : 0;
  const dataVersion = r.left > 0 ? r.netString() : LEGACY_GAME_VERSION;
  const rs = r.left > 0 ? r.varint() : 0;
  return { v: 1, dataVersion, name, at, origin, alignment, primary, secondary, picks, granted, exemplar: ex ? ex - 1 : undefined, endLevel: end ? end - 1 : undefined, ...(rs ? { respecTo: rs - 1 } : {}) };
}

/** Full share link for the current page. */
export async function shareLink(b: Build): Promise<string> {
  const base = `${location.origin}${location.pathname}`;
  return `${base}#b=${await encodeShare(b)}`;
}
