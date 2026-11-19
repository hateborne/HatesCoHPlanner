/**
 * The shape check of a version's real pets file (henchmen/<version>.json, written by the
 * pipeline's Exporter.build_henchmen). The file is optional and loads apart from the version's own
 * files, so the planner takes it only when every part the Pets and Minions cards read has the right
 * type: anything else leaves the cards out rather than breaking the totals.
 */
import { isEffects } from './pets.ts';
import type { HenchmenFile, PetClass, PetCreation, PetKind, PetMake, Power } from './types.ts';

type Rec = Record<string, unknown>;

const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isStr = (v: unknown): v is string => typeof v === 'string';
const isList = <T,>(v: unknown, item: (x: unknown) => x is T): v is T[] => Array.isArray(v) && v.every(item);
const opt = (v: unknown, test: (x: unknown) => boolean) => v === undefined || test(v);
const isStrs = (v: unknown): v is string[] => isList(v, isStr);
const isNums = (v: unknown): v is number[] => isList(v, isNum);
const isNumOrNums = (v: unknown) => isNum(v) || isNums(v);

// the numeric fields of a pet's power the power info reads
const POWER_NUMS = ['acc', 'rech', 'end', 'rng', 'cast', 'ap', 'rad', 'arc', 'maxT', 'intr', 'ign', 'si', 'life'] as const;

/** @return Whether a pet's power has every field the power info and the cards read, with the right types. */
function isPetPower(v: unknown): boolean {
  return (
    isRec(v) &&
    isStr(v.dn) &&
    isStr(v.type) &&
    isStr(v.tgt) &&
    POWER_NUMS.every((k) => opt(v[k], isNum)) &&
    opt(v.area, isStr) &&
    opt(v.ea, isStrs) &&
    opt(v.atk, isNums) &&
    isEffects(v.eff) &&
    isEffects(v.act)
  );
}

/** @return Whether an EntCreate mod's entry is well formed. */
function isMake(v: unknown): v is PetMake {
  return (
    isRec(v) &&
    isStr(v.pet) &&
    opt(v.req, (r) => Array.isArray(r) && r.every(isStrs)) &&
    ['ch', 'dur', 'pseudo', 'del'].every((k) => opt(v[k], isNum))
  );
}

/** @return Whether a kind of pet is well formed. */
function isKind(v: unknown): v is PetKind {
  return isRec(v) && isStr(v.dn) && opt(v.vd, isStr) && opt(v.grp, isStr) && opt(v.cls, isStr) && isStrs(v.p) && opt(v.def, isNum);
}

/** @return Whether a pseudo-pet creation (the pets file's shape) is well formed. */
function isCreation(v: unknown): v is PetCreation {
  return (
    isRec(v) &&
    isStrs(v.p) &&
    ['dur', 'def', 'boosts', 'pseudo', 'hid'].every((k) => opt(v[k], isNum)) &&
    opt(v.cls, isStr)
  );
}

// a pet class's attribute tables (PetClass)
const CLASS_TABLES = ['base', 'min', 'max', 'maxMax', 'strMax', 'resMax'] as const;

/** @return A copy of a record without a prototype, so a name like "constructor" finds nothing. */
function bare<T>(r: Rec): Record<string, T> {
  return Object.assign(Object.create(null) as Record<string, T>, r);
}

/** @return A pet class with its lookup records (tables, mod tables) made without prototypes. */
function bareClass(c: PetClass): PetClass {
  const out: PetClass = { mod: bare(c.mod) };
  for (const k of CLASS_TABLES) if (c[k]) out[k] = bare(c[k] as Rec);
  return out;
}

/**
 * Check a parsed real pets file and make it safe to look names up in.
 *
 * Its powers become Power records (id -1, named by their key) so the power info can run them.
 *
 * @param raw The parsed JSON.
 * @return The file (its lookup records without prototypes), or null when any part is malformed or
 *   a pet or a power names something the file lacks.
 */
export function readHenchmenFile(raw: unknown): HenchmenFile | null {
  if (!isRec(raw) || !opt(raw.plus, isNum)) return null;
  const { makes, pets, powers, classes, tables, pseudo, collective } = raw;
  if (!isRec(makes) || !Object.values(makes).every((ms) => Array.isArray(ms) && ms.every(isMake))) return null;
  if (!isRec(pets) || !Object.values(pets).every(isKind)) return null;
  if (!isRec(powers) || !Object.values(powers).every(isPetPower)) return null;
  if (!opt(pseudo, (p) => isRec(p) && Object.values(p).every((cs) => Array.isArray(cs) && cs.every(isCreation)))) return null;
  if (!Array.isArray(tables) || !tables.every(isNums)) return null;
  if (!opt(collective, (c) => isRec(c) && Object.values(c).every(isNums))) return null;
  const isIndex = (i: unknown) => Number.isInteger(i) && (i as number) >= 0 && (i as number) < tables.length;
  const isAttrTable = (r: unknown) => isRec(r) && Object.values(r).every(isNumOrNums);
  const isClass = (c: unknown): c is PetClass =>
    isRec(c) && CLASS_TABLES.every((k) => opt(c[k], isAttrTable)) && isRec(c.mod) && Object.values(c.mod).every(isIndex);
  if (!isRec(classes) || !Object.values(classes).every(isClass)) return null;
  // every name the cards follow must be in the file
  const has = (r: Rec, k: string) => Object.prototype.hasOwnProperty.call(r, k);
  if (!Object.values(makes).every((ms) => (ms as PetMake[]).every((m) => has(pets, m.pet)))) return null;
  if (!Object.values(pets).every((k) => (k as PetKind).p.every((p) => has(powers, p)))) return null;
  const named: Record<string, Power> = Object.create(null) as Record<string, Power>;
  for (const [n, p] of Object.entries(powers)) named[n] = { ...(p as Omit<Power, 'id' | 'n' | 'sh' | 'lh' | 'icon'>), id: -1, n, sh: '', lh: '', icon: '' };
  const file: HenchmenFile = {
    makes: bare(makes),
    pets: bare(pets),
    powers: named,
    classes: bare(Object.fromEntries(Object.entries(classes).map(([k, c]) => [k, bareClass(c as PetClass)]))),
    tables: tables as number[][],
  };
  if (raw.plus !== undefined) file.plus = raw.plus as number;
  if (pseudo !== undefined) file.pseudo = bare(pseudo as Rec);
  if (collective !== undefined) file.collective = bare(collective as Rec);
  return file;
}
