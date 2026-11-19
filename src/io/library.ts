/** Builds saved in this browser (IndexedDB), with save / list / delete. */
import type { Build } from '../engine/build.ts';

export interface SavedBuild {
  id?: number;
  name: string;
  at: number;
  saved: string; // ISO time
  build: Build;
}

const DB = 'hates-coh-planner';
const STORE = 'builds';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB unavailable'));
  });
}

function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const req = fn(db.transaction(STORE, mode).objectStore(STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'));
      }),
  );
}

/** @return The name a build is saved under. */
export function savedName(b: Build): string {
  return b.name || 'Unnamed build';
}

/** Save (or overwrite when `id` is set) a build. @return Its id. */
export function saveBuild(b: Build, id?: number): Promise<number> {
  const rec: SavedBuild = { name: savedName(b), at: b.at, saved: new Date().toISOString(), build: b };
  if (id !== undefined) rec.id = id;
  return tx('readwrite', (s) => s.put(rec)) as Promise<number>;
}

/** @return All saved builds, newest first. */
export async function listBuilds(): Promise<SavedBuild[]> {
  const all = await tx<SavedBuild[]>('readonly', (s) => s.getAll() as IDBRequest<SavedBuild[]>);
  return all.sort((a, b) => b.saved.localeCompare(a.saved));
}

/**
 * A build as plain JSON with its keys sorted, so two copies of one build read the same whichever
 * order their fields were set in (a copy from IndexedDB, one rebuilt by an edit).
 *
 * @param v The build, or a part of it.
 * @return The text.
 */
export function canonicalJson(v: unknown): string {
  return JSON.stringify(v, (_k, x: unknown) =>
    x && typeof x === 'object' && !Array.isArray(x)
      ? Object.fromEntries(Object.entries(x as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : x,
  );
}

/**
 * Whether this browser's saved builds hold this very build, as it is now (its name, picks, slots
 * and everything else), so replacing it loses nothing.
 *
 * @param b The build.
 * @return True when a saved copy matches; false when none does, or the storage can't be read within
 *   SAVED_CHECK_MS (a question waiting on it never hangs).
 */
export async function isSavedHere(b: Build): Promise<boolean> {
  const name = savedName(b);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const check = listBuilds().then(
    (all) => {
      // only a build saved under its name can be it: the rest aren't read through
      const same = all.filter((s) => s.name === name);
      if (!same.length) return false;
      const key = canonicalJson(b);
      return same.some((s) => canonicalJson(s.build) === key);
    },
    () => false,
  );
  const late = new Promise<boolean>((resolve) => (timer = setTimeout(() => resolve(false), SAVED_CHECK_MS)));
  try {
    return await Promise.race([check, late]);
  } finally {
    clearTimeout(timer);
  }
}

// how long isSavedHere waits for the browser's storage before answering "not saved"
const SAVED_CHECK_MS = 1500;

/**
 * The sentence a question about replacing a build ends with: the advice to save it first, unless
 * it is saved in this browser just as it is.
 *
 * @param b The build that would be replaced.
 * @param how Where to save it, in brackets after "Save it first" (none: no brackets).
 * @return The sentence with a leading space, or nothing.
 */
export async function saveFirstText(b: Build, how?: string): Promise<string> {
  return (await isSavedHere(b)) ? '' : ` Save it first${how ? ` (${how})` : ''} if you want to keep it.`;
}

/** Delete a saved build. */
export function deleteBuild(id: number): Promise<undefined> {
  return tx('readwrite', (s) => s.delete(id)) as Promise<undefined>;
}
