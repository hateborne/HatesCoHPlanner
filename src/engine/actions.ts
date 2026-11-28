/**
 * Pure edit operations on a Build. Each returns a new Build; validity problems are left in place
 * and reported by BuildRules.issues() (the build is flagged, never silently repaired).
 */
import type { GameData } from '../data/gamedata.ts';
import { cloneBuild, type Build, type Pick, type Slot, type SlottedEnh } from './build.ts';
import type { Power } from '../data/types.ts';
import { canSlot, ioLevelRange, levelsAbove, madeLevel } from './enhance.ts';
import { BuildRules, MAX_BOUGHT_SLOTS, MAX_LEVEL, type BuildEntry, type PowerOption } from './rules.ts';
import { lowestFreeLevels } from './schedule.ts';

function originIndex(gd: GameData, b: Build): number {
  return gd.core.origins.findIndex((o) => o.id === b.origin);
}

/** @return The slots array an entry key refers to (creating granted state on demand). */
export function slotsFor(b: Build, key: string): { slots: Slot[]; set: (s: Slot[]) => void } | null {
  const [kind, raw] = key.split(':');
  const n = Number(raw);
  if (kind === 'pick') {
    const p = b.picks[n];
    if (!p) return null;
    return { slots: p.slots, set: (s) => (p.slots = s) };
  }
  if (kind === 'grant') {
    const g = (b.granted[n] ??= { slots: [] });
    return { slots: g.slots, set: (s) => (g.slots = s) };
  }
  return null;
}

/**
 * Put a power in a pick. Replacing a power keeps its slots and the enhancements the new power
 * accepts (MidsReborn behaviour); the rest are emptied.
 *
 * @param gd Game data.
 * @param b Build.
 * @param i Pick index.
 * @param power Power id.
 * @param carry The pick being replaced when `b` no longer holds it (reopening a level from the
 *   overview clears the pick so the screen can offer it again); defaults to b.picks[i].
 */
export function setPick(gd: GameData, b: Build, i: number, power: number, carry?: Pick | null): Build {
  const nb = cloneBuild(b);
  const level = gd.core.schedule.power[i] ?? 49;
  const prev = nb.picks[i] ?? carry;
  const p = gd.power(power);
  const oi = originIndex(gd, nb);
  const slots: Slot[] = (prev?.slots ?? []).map((s) => {
    if (!s.enh) return { level: s.level };
    const boost = gd.powerById.get(s.enh.boost);
    return boost && canSlot(gd, p, boost, oi) ? { ...s } : { level: s.level };
  });
  if (slots[0]) slots[0].level = level;
  nb.picks[i] = { power, level, slots, on: undefined };
  return nb;
}

/** One enhancement a power swap drops or keeps. */
export interface SwapPiece {
  key: string; // the entry it sits in ('pick:<i>' or 'grant:<powerId>')
  slot: number; // its slot index there
  enh: SlottedEnh;
}

/** What swapping a pick's power does to the build (swapPick). */
export interface SwapResult {
  build: Build; // the build after the swap
  dropped: SwapPiece[]; // enhancements that leave the build (the new power can't take them, or their slot goes)
  kept: SwapPiece[]; // the pick's enhancements the new power keeps
  freed: number[]; // 0-based levels of the bought slots that leave the build, one per slot
}

/**
 * Swap the power in a pick, dropping what the new power can't hold.
 *
 * The pick keeps its slots and the enhancements the new power accepts (setPick). Slots past the new
 * power's maximum go, and a power that takes no slots keeps none; powers the old one granted
 * (Kheldian form attacks, ...) go with it, slots and all. The bought slots that leave are freed:
 * the caller has them placed again.
 *
 * @param gd Game data.
 * @param b The build with the old power still in the pick.
 * @param i 0-based pick index.
 * @param power The new power's id.
 * @return The new build, the enhancements dropped and kept, and the levels of the freed slots.
 */
export function swapPick(gd: GameData, b: Build, i: number, power: number): SwapResult {
  const before = new BuildRules(gd, b).entries();
  const nb = setPick(gd, b, i, power);
  const prev = b.picks[i]?.slots ?? [];
  const pick = nb.picks[i]!;
  const p = gd.power(power);
  const rules = new BuildRules(gd, nb);
  // a power that takes no slots holds none (the overview shows it without rings)
  pick.slots = rules.slottable(p) ? pick.slots.slice(0, Math.max(1, Math.min(p.maxB ?? 0, MAX_BOUGHT_SLOTS + 1))) : [];
  const key = `pick:${i}`;
  const dropped: SwapPiece[] = [];
  const kept: SwapPiece[] = [];
  const freed: number[] = [];
  prev.forEach((s, k) => {
    if (s.enh) (pick.slots[k]?.enh ? kept : dropped).push({ key, slot: k, enh: s.enh });
    if (k > 0 && k >= pick.slots.length) freed.push(s.level);
  });
  dropGoneGrants(gd, before, nb, dropped, freed);
  return { build: nb, dropped, kept, freed: freed.sort((x, y) => x - y) };
}

/**
 * Empty the slots of granted powers a change took out of the build (Kheldian form attacks, ...),
 * so they don't come back holding enhancements; their pieces count as dropped and their bought
 * slots as freed.
 *
 * @param gd Game data.
 * @param before The build's entries before the change.
 * @param nb The changed build (its granted slots are emptied in place).
 * @param dropped Collects the pieces dropped.
 * @param freed Collects the freed slots' levels.
 */
function dropGoneGrants(gd: GameData, before: BuildEntry[], nb: Build, dropped: SwapPiece[], freed: number[]): void {
  const after = new Set(new BuildRules(gd, nb).entries().map((e) => e.key));
  for (const e of before) {
    if (e.source !== 'grant' || after.has(e.key)) continue;
    e.slots.forEach((s, k) => {
      if (s.enh) dropped.push({ key: e.key, slot: k, enh: s.enh });
      if (k > 0) freed.push(s.level);
    });
    const g = nb.granted[e.power.id];
    if (g) g.slots = [];
  }
}

/**
 * @param b The build.
 * @param pick A pick index.
 * @param power A power id.
 * @return The later pick that holds the power, or -1 (also for one past the build's stop level,
 *   which the overview doesn't show).
 */
export function laterPick(b: Build, pick: number, power: number): number {
  const end = b.endLevel ?? MAX_LEVEL;
  return b.picks.findIndex((p, i) => i > pick && p?.power === power && p.level <= end);
}

/**
 * A power option on a pick reopened from the overview, for a power the build takes at a later pick:
 * offered (available) when it could be taken at this pick were that later pick empty, so it can be
 * taken earlier; else greyed with the reason. Every other option is returned as it is.
 *
 * @param gd Game data.
 * @param base The build without this pick.
 * @param pick The pick reopened.
 * @param o The option as the screen lists it.
 * @return The option to show.
 */
export function earlierOption(gd: GameData, base: Build, pick: number, o: PowerOption): PowerOption {
  if (o.state !== 'owned') return o;
  const later = laterPick(base, pick, o.power.id);
  if (later < 0) return o;
  const probe = new BuildRules(gd, { ...base, picks: base.picks.map((p, i) => (i === later ? null : p)) }).powerOption(o.power.id, pick);
  if (probe.state === 'available') return probe;
  const at = (gd.core.schedule.power[later] ?? 0) + 1;
  return { ...probe, state: 'unavailable', reason: `Your level ${at} power, and it can't be taken here: ${probe.reason ?? 'not allowed at this level'}` };
}

/**
 * Take a power the build has at a later pick at an earlier one instead: it moves with its slots and
 * enhancements (all gained at the later pick or after, so all still fine), the later pick is left
 * empty, and the earlier pick's own power leaves the build. Powers that one granted go with their
 * slots.
 *
 * @param gd Game data.
 * @param b The build as it is.
 * @param pick The earlier pick.
 * @param later The later pick holding the power.
 * @return The build, with the earlier pick's power (its enhancements, and those of powers it
 *   granted) dropped and its bought slots freed.
 */
export function takeEarlier(gd: GameData, b: Build, pick: number, later: number): SwapResult {
  const before = new BuildRules(gd, b).entries();
  const nb = cloneBuild(b);
  const moving = nb.picks[later];
  if (!moving) return { build: b, dropped: [], kept: [], freed: [] };
  const level = gd.core.schedule.power[pick] ?? 0;
  const slots = moving.slots.map((s) => ({ ...s }));
  if (slots[0]) slots[0].level = level;
  const old = b.picks[pick];
  nb.picks[pick] = { ...moving, level, slots };
  nb.picks[later] = null;
  const key = `pick:${pick}`;
  const dropped: SwapPiece[] = [];
  const freed: number[] = [];
  (old?.slots ?? []).forEach((s, k) => {
    if (s.enh) dropped.push({ key, slot: k, enh: s.enh });
    if (k > 0) freed.push(s.level);
  });
  dropGoneGrants(gd, before, nb, dropped, freed);
  return { build: nb, dropped, kept: [], freed: freed.sort((x, y) => x - y) };
}

/**
 * Put a power back at a later pick, as a leveling build's swap does with the power a later one
 * replaced: it keeps the slots gained at that pick's level or after (or in a respec), and their
 * enhancements; the slots gained before it can't belong to it and are freed, their enhancements
 * dropped.
 *
 * @param gd Game data.
 * @param b The build (the later pick empty).
 * @param later The later pick.
 * @param old The power as it was at its earlier pick.
 * @param key The entry key its pieces are reported under (its earlier pick's).
 * @return The build with it placed, the enhancements dropped and kept, and the freed slots' levels.
 */
export function putLater(gd: GameData, b: Build, later: number, old: Pick, key: string): SwapResult {
  const nb = cloneBuild(b);
  const level = gd.core.schedule.power[later] ?? 0;
  const rules = new BuildRules(gd, b);
  const dropped: SwapPiece[] = [];
  const kept: SwapPiece[] = [];
  const freed: number[] = [];
  const slots: Slot[] = [];
  old.slots.forEach((s, k) => {
    // a slot from a respec (an Arachnos build's forced one at 24) may sit on any power
    const stays = k === 0 || s.level >= level || rules.slotsAnyPower(s.level);
    if (s.enh) (stays ? kept : dropped).push({ key, slot: k, enh: s.enh });
    if (stays) slots.push(k === 0 ? { ...s, level } : { ...s });
    else freed.push(s.level);
  });
  nb.picks[later] = { power: old.power, level, slots, on: old.on };
  return { build: nb, dropped, kept, freed: freed.sort((x, y) => x - y) };
}

/**
 * A leveling build's "take it earlier": the power at a later pick (B) moves to the earlier pick, and
 * the earlier pick's power (A) moves up to the later one (putLater). Powers A grants (Kheldian form
 * attacks, ...) move up with it and keep their enhancements, but like A they lose the slots gained
 * before their new level (freed, their enhancements dropped).
 *
 * @param gd Game data.
 * @param b The build as it is.
 * @param pick The earlier pick.
 * @param later The later pick holding B.
 * @return The result, and why A can't be taken at the later pick (null when it can).
 */
export function moveLater(gd: GameData, b: Build, pick: number, later: number): { result: SwapResult; refusal: string | null } {
  const old = b.picks[pick];
  const moving = b.picks[later];
  if (!old || !moving) return { result: { build: b, dropped: [], kept: [], freed: [] }, refusal: 'nothing to move' };
  const before = new Map(new BuildRules(gd, b).entries().map((e) => [e.key, e.level] as const));
  const nb = cloneBuild(b);
  const level = gd.core.schedule.power[pick] ?? 0;
  const slots = moving.slots.map((s) => ({ ...s }));
  if (slots[0]) slots[0].level = level;
  nb.picks[pick] = { ...moving, level, slots };
  nb.picks[later] = null;
  const opt = new BuildRules(gd, nb).powerOption(old.power, later);
  const refusal = opt.state === 'available' ? null : (opt.reason ?? 'not allowed at that level');
  const put = putLater(gd, nb, later, old, `pick:${pick}`);
  // granted powers now granted later: the slots gained before their new level go
  const rules = new BuildRules(gd, put.build);
  for (const e of rules.entries()) {
    const was = before.get(e.key);
    const g = put.build.granted[e.power.id];
    if (e.source !== 'grant' || was === undefined || e.level <= was || !g?.slots.length) continue;
    g.slots = g.slots.filter((s, k) => {
      const stays = k === 0 || s.level >= e.level || rules.slotsAnyPower(s.level);
      if (!stays) {
        if (s.enh) put.dropped.push({ key: e.key, slot: k, enh: s.enh });
        put.freed.push(s.level);
      }
      return stays;
    });
  }
  put.freed.sort((x, y) => x - y);
  return { result: put, refusal };
}

/**
 * Raise every crafted IO and set piece to the highest level the build can use (Build Level or Set
 * Max Level): its set's top level, or the build's last level plus the levels an IO works above the
 * character, whichever is lower. Pieces already at or above it stay as they are.
 *
 * @param gd Game data.
 * @param b The build.
 * @return The build with the pieces raised (the same object when none moves).
 */
export function raiseToCap(gd: GameData, b: Build): Build {
  const last = b.endLevel ?? MAX_LEVEL;
  const raise = (s: Slot): Slot => {
    const boost = s.enh ? gd.powerById.get(s.enh.boost) : undefined;
    const cap = boost ? capLevel(gd, boost, last) : null;
    return s.enh && cap !== null && (s.enh.ioLevel ?? cap) < cap ? { ...s, enh: { ...s.enh, ioLevel: cap } } : s;
  };
  let moved = false;
  const mapSlots = (slots: Slot[]) => {
    const out = slots.map(raise);
    if (out.some((s, k) => s !== slots[k])) moved = true;
    return out;
  };
  const picks = b.picks.map((p) => (p ? { ...p, slots: mapSlots(p.slots) } : p));
  const granted = Object.fromEntries(Object.entries(b.granted).map(([k, g]) => [k, { ...g, slots: mapSlots(g.slots) }]));
  return moved ? { ...b, picks, granted } : b;
}

/**
 * @param gd Game data.
 * @param boost An enhancement.
 * @param last The build's last level (0-based).
 * @return The highest level (0-based) the piece is made at that the build can use, or null when its
 *   level can't be chosen (attuned pieces, TO/DO/SO, ...).
 */
export function capLevel(gd: GameData, boost: Power, last: number): number | null {
  const r = ioLevelRange(gd, boost);
  return r ? madeLevel(gd, boost, Math.max(r[0], Math.min(r[1], last + levelsAbove(gd)))) : null;
}

/** Remove the power from a pick (its slots go with it). */
export function clearPick(b: Build, i: number): Build {
  const nb = cloneBuild(b);
  nb.picks[i] = null;
  return nb;
}

/**
 * Add an enhancement slot gained at `level` to an entry, keeping slots sorted by level.
 *
 * @param b Build.
 * @param key Entry key ('pick:<i>' or 'grant:<powerId>').
 * @param level 0-based level the slot is gained at.
 * @param freeLevel Level of the entry's free slot (created first when missing).
 */
export function addSlot(b: Build, key: string, level: number, freeLevel: number): Build {
  const nb = cloneBuild(b);
  const ref = slotsFor(nb, key);
  if (!ref) return b;
  const slots = ref.slots.length ? [...ref.slots] : [{ level: freeLevel }];
  const free = slots[0]!;
  const rest = [...slots.slice(1), { level }].sort((a, c) => a.level - c.level);
  ref.set([free, ...rest]);
  return nb;
}

/**
 * Book a Respec build's slots within its respec again, so each sits at or after the level its power
 * is taken whenever the respec's slot levels allow it.
 *
 * The game keeps no level for a slot, so within the respec a slot's level is the planner's own
 * bookkeeping: the levels the respec's empty slots hold are handed out again among them with
 * lowestFreeLevels, powers taken earliest first. Slots kept from earlier screens can otherwise hold
 * the levels a later power needs, and that power gets levels below its own (Protector Bots, taken at
 * 12, with slots at 3 and 9). A slot holding an enhancement keeps its level (it is locked where it
 * is, as the slot screens treat it); slots after the respec level, and Leveling builds, are left as
 * they are. Each power's slots stay in level order.
 *
 * @param gd Game data.
 * @param b The build.
 * @return The build with the respec's empty slots booked again (the same build when nothing moves).
 */
export function rebookRespecSlots(gd: GameData, b: Build): Build {
  const top = b.respecTo;
  if (top === undefined) return b;
  const movable = (s: Slot, i: number) => i > 0 && s.level <= top && !s.enh;
  const held: { key: string; owned: number; level: number }[] = [];
  for (const e of new BuildRules(gd, b).entries()) {
    const raw = e.key.startsWith('grant:') ? b.granted[Number(e.key.slice(6))]?.slots : b.picks[Number(e.key.slice(5))]?.slots;
    raw?.forEach((s, i) => {
      if (movable(s, i)) held.push({ key: e.key, owned: e.level, level: s.level });
    });
  }
  const levels = lowestFreeLevels(
    held.map((h) => h.level),
    held.map((h) => h.owned),
    top,
  );
  if (levels.every((lv, k) => lv === held[k]!.level)) return b;
  const byKey = new Map<string, { was: number[]; now: number[] }>();
  held.forEach((h, k) => {
    const v = byKey.get(h.key) ?? { was: [], now: [] };
    v.was.push(h.level);
    v.now.push(levels[k]!);
    byKey.set(h.key, v);
  });
  const nb = cloneBuild(b);
  for (const [key, { was, now }] of byKey) {
    now.sort((x, y) => x - y);
    // a power whose empty slots keep the same levels is left exactly as it is
    if (now.join() === [...was].sort((x, y) => x - y).join()) continue;
    const ref = slotsFor(nb, key);
    if (!ref) continue;
    let j = 0;
    const moved = ref.slots.map((s, i) => (movable(s, i) ? { ...s, level: now[j++]! } : s));
    // bought slots stay in level order: re-sorted only when a new level breaks it (an empty slot
    // moving past a locked one), so a slotted ring moves place only then
    const sorted = moved.slice(1).every((s, i, all) => !i || all[i - 1]!.level <= s.level);
    ref.set(sorted ? moved : [moved[0]!, ...moved.slice(1).sort((x, y) => x.level - y.level)]);
  }
  return nb;
}

/** Remove one bought slot (index >= 1) from an entry. */
export function removeSlot(b: Build, key: string, slotIndex: number): Build {
  if (slotIndex < 1) return b;
  const nb = cloneBuild(b);
  const ref = slotsFor(nb, key);
  if (!ref) return b;
  ref.set(ref.slots.filter((_, i) => i !== slotIndex));
  return nb;
}

/** Remove the last slot an entry gained at a level (used by the slot screen's undo click). */
export function removeSlotAtLevel(b: Build, key: string, level: number): Build {
  const ref = slotsFor(b, key);
  if (!ref) return b;
  for (let i = ref.slots.length - 1; i >= 1; i--) {
    if (ref.slots[i]?.level === level) return removeSlot(b, key, i);
  }
  return b;
}

/**
 * Place (or clear) an enhancement in a slot.
 *
 * @param freeLevel Level of the entry's free slot (needed when the slot list doesn't exist yet).
 */
export function setEnh(b: Build, key: string, slotIndex: number, enh: SlottedEnh | undefined, freeLevel: number): Build {
  const nb = cloneBuild(b);
  const ref = slotsFor(nb, key);
  if (!ref) return b;
  const slots = ref.slots.length ? [...ref.slots] : [{ level: freeLevel }];
  const s = slots[slotIndex];
  if (!s) return b;
  slots[slotIndex] = enh ? { level: s.level, enh } : { level: s.level };
  ref.set(slots);
  return nb;
}

/** Switch a power's totals contribution on or off (undefined restores the default). */
export function setOn(b: Build, key: string, on: boolean | undefined): Build {
  const nb = cloneBuild(b);
  const [kind, raw] = key.split(':');
  const n = Number(raw);
  if (kind === 'pick' && nb.picks[n]) nb.picks[n]!.on = on;
  if (kind === 'grant') (nb.granted[n] ??= { slots: [] }).on = on;
  return nb;
}

/**
 * Switch a pet power's share of the pets' stats on or off (the pet pane).
 *
 * @param b Build.
 * @param name The pet power's full name.
 * @param on Whether it counts; undefined restores its default (petPowerDefault).
 * @return The build with the switch set.
 */
export function setPetOn(b: Build, name: string, on: boolean | undefined): Build {
  const nb = cloneBuild(b);
  const next = { ...(nb.petOn ?? {}) };
  if (on === undefined) delete next[name];
  else next[name] = on;
  if (Object.keys(next).length) nb.petOn = next;
  else delete nb.petOn;
  return nb;
}

/** Drop picks and slots above a level (the wizard's Back step). */
export function truncateAbove(b: Build, level: number): Build {
  const nb = cloneBuild(b);
  nb.picks = nb.picks.map((p) => (p && p.level > level ? null : p));
  for (const p of nb.picks) if (p) p.slots = p.slots.filter((s, i) => i === 0 || s.level <= level);
  for (const g of Object.values(nb.granted)) g.slots = g.slots.filter((s, i) => i === 0 || s.level <= level);
  return nb;
}

/**
 * Switch on one power of an exclusive toggle group and the rest off (they default to off, so
 * the others go back to their default).
 *
 * @param b Build.
 * @param members Power ids of the group.
 * @param chosen The power to switch on, or undefined for none.
 */
export function setExclusive(b: Build, members: number[], chosen: number | undefined): Build {
  const nb = cloneBuild(b);
  for (const pid of members) {
    const g = (nb.granted[pid] ??= { slots: [] });
    g.on = pid === chosen ? true : undefined;
  }
  return nb;
}
