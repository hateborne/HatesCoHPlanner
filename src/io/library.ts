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

/** Save (or overwrite when `id` is set) a build. @return Its id. */
export function saveBuild(b: Build, id?: number): Promise<number> {
  const rec: SavedBuild = { name: b.name || 'Unnamed build', at: b.at, saved: new Date().toISOString(), build: b };
  if (id !== undefined) rec.id = id;
  return tx('readwrite', (s) => s.put(rec)) as Promise<number>;
}

/** @return All saved builds, newest first. */
export async function listBuilds(): Promise<SavedBuild[]> {
  const all = await tx<SavedBuild[]>('readonly', (s) => s.getAll() as IDBRequest<SavedBuild[]>);
  return all.sort((a, b) => b.saved.localeCompare(a.saved));
}

/** Delete a saved build. */
export function deleteBuild(id: number): Promise<undefined> {
  return tx('readwrite', (s) => s.delete(id)) as Promise<undefined>;
}
