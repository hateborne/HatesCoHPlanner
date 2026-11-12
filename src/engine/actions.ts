/**
 * Pure edit operations on a Build. Each returns a new Build; validity problems are left in place
 * and reported by BuildRules.issues() (the build is flagged, never silently repaired).
 */
import type { GameData } from '../data/gamedata.ts';
import { cloneBuild, type Build, type Pick, type Slot, type SlottedEnh } from './build.ts';
import { canSlot } from './enhance.ts';
import { BuildRules } from './rules.ts';

/**
 * Whether taking pick `i` out of the build would take enhancements with it.
 *
 * Counts the pick's own slots and the slots of powers it grants (Kheldian form attacks, Bright
 * Nova's blasts, ...), which disappear with it: the build's enhancements are compared with and
 * without the pick.
 *
 * @param gd Game data.
 * @param b The build.
 * @param i 0-based pick index.
 * @return True when the pick (or anything it grants) holds an enhancement.
 */
export function pickHoldsEnhancements(gd: GameData, b: Build, i: number): boolean {
  if (b.picks[i]?.slots.some((s) => s.enh)) return true;
  const count = (x: Build) => new BuildRules(gd, x).entries().reduce((n, e) => n + e.slots.filter((s) => s.enh).length, 0);
  return count({ ...b, picks: b.picks.map((p, k) => (k === i ? null : p)) }) < count(b);
}

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
