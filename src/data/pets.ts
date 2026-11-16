/**
 * The shape check of a version's pseudo-pet file (pets/<version>.json, written by the pipeline's
 * Exporter.build_pets). The file is optional and loads apart from the version's own files, so the
 * planner takes it only when every part the power info reads has the right type: anything else
 * leaves pet damage out rather than breaking a tooltip.
 */
import type { PetsFile } from './types.ts';

type Rec = Record<string, unknown>;

const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isStr = (v: unknown): v is string => typeof v === 'string';
const isList = <T,>(v: unknown, item: (x: unknown) => x is T): v is T[] => Array.isArray(v) && v.every(item);
const opt = (v: unknown, test: (x: unknown) => boolean) => v === undefined || test(v);
const isStrs = (v: unknown): v is string[] => isList(v, isStr);
const isNums = (v: unknown): v is number[] => isList(v, isNum);

// how deep effect groups may nest (the client's deepest is a few levels)
const MAX_NESTING = 32;

/** @return Whether a mod has every field the power info reads, with the right types. */
function isMod(v: unknown): boolean {
  if (!isRec(v)) return false;
  return (
    isNums(v.a) &&
    isStr(v.asp) &&
    isStr(v.t) &&
    isStr(v.tbl) &&
    isNum(v.sc) &&
    opt(v.tg, isStr) &&
    ['dur', 'mag', 'del', 'per', 'tc'].every((k) => opt(v[k], isNum)) &&
    ['fl', 'mx', 'pwn'].every((k) => opt(v[k], isStrs)) &&
    opt(v.pw, isNums) &&
    opt(v.sup, Array.isArray)
  );
}

/** @return Whether an effect group (and every group in it) is well formed. */
function isEffect(v: unknown, depth: number): boolean {
  if (!isRec(v) || depth > MAX_NESTING) return false;
  return (
    ['ch', 'ppm', 'del'].every((k) => opt(v[k], isNum)) &&
    ['req', 'tag', 'fl'].every((k) => opt(v[k], isStrs)) &&
    opt(v.m, (m) => Array.isArray(m) && m.every(isMod)) &&
    opt(v.sub, (sub) => Array.isArray(sub) && sub.every((e) => isEffect(e, depth + 1)))
  );
}

const isEffects = (v: unknown) => opt(v, (effs) => Array.isArray(effs) && effs.every((e) => isEffect(e, 0)));

/** @return Whether a pet power is well formed. */
function isPetPower(v: unknown): boolean {
  return isRec(v) && isStr(v.type) && opt(v.ap, isNum) && isEffects(v.eff) && isEffects(v.act);
}

/** @return Whether a pet creation is well formed. */
function isCreation(v: unknown): boolean {
  return (
    isRec(v) &&
    isStrs(v.p) &&
    ['dur', 'def', 'boosts', 'pseudo', 'hid'].every((k) => opt(v[k], isNum)) &&
    opt(v.cls, isStr)
  );
}

/** @return A copy of a record without a prototype, so a name like "constructor" finds nothing. */
function bare<T>(r: Rec): Record<string, T> {
  return Object.assign(Object.create(null) as Record<string, T>, r);
}

/**
 * Check a parsed pets file and make it safe to look names up in.
 *
 * @param raw The parsed JSON.
 * @return The file (its lookup records without prototypes), or null when any part is malformed.
 */
export function readPetsFile(raw: unknown): PetsFile | null {
  if (!isRec(raw) || !opt(raw.plus, isNum)) return null;
  const { pets, powers, classes, tables } = raw;
  if (!isRec(pets) || !Object.values(pets).every((cs) => Array.isArray(cs) && cs.every(isCreation))) return null;
  if (!isRec(powers) || !Object.values(powers).every(isPetPower)) return null;
  if (!Array.isArray(tables) || !tables.every(isNums)) return null;
  if (!opt(raw.names, (n) => isRec(n) && Object.values(n).every(isStr))) return null;
  const isIndex = (i: unknown) => Number.isInteger(i) && (i as number) >= 0 && (i as number) < tables.length;
  if (!isRec(classes) || !Object.values(classes).every((t) => isRec(t) && Object.values(t).every(isIndex))) return null;
  const file: PetsFile = {
    pets: bare(pets),
    powers: bare(powers),
    classes: bare(Object.fromEntries(Object.entries(classes).map(([k, t]) => [k, bare(t as Rec)]))),
    tables: tables as number[][],
  };
  if (raw.plus !== undefined) file.plus = raw.plus as number;
  if (raw.names !== undefined) file.names = bare(raw.names as Rec);
  return file;
}
