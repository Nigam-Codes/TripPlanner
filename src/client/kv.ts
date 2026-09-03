/**
 * Minimal async key-value store backed by IndexedDB.
 *
 * localStorage would be simpler, but a single Overpass result for a dense city is
 * ~300 KB of place tags, so a few searches would exhaust its ~5 MB budget. IndexedDB
 * gets a share of free disk instead.
 *
 * Every operation degrades to an in-memory Map rather than throwing: private windows,
 * disabled site data and quota errors must never break the app.
 */

const DB_NAME = "trip-planner";
const STORE = "kv";
const VERSION = 1;

const memory = new Map<string, unknown>();
let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve) => {
    if (typeof indexedDB === "undefined") return resolve(null);
    try {
      const req = indexedDB.open(DB_NAME, VERSION);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });

  return dbPromise;
}

async function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest): Promise<T | null> {
  const db = await openDb();
  if (!db) return null;

  return new Promise((resolve) => {
    try {
      const t = db.transaction(STORE, mode);
      const req = run(t.objectStore(STORE));
      req.onsuccess = () => resolve(req.result as T);
      req.onerror = () => resolve(null);
      t.onabort = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function kvGet<T>(key: string): Promise<T | undefined> {
  const hit = await tx<T>("readonly", (s) => s.get(key));
  if (hit !== null && hit !== undefined) return hit;
  return memory.get(key) as T | undefined;
}

export async function kvSet(key: string, value: unknown): Promise<void> {
  memory.set(key, value);
  await tx("readwrite", (s) => s.put(value, key));
}

export async function kvDelete(key: string): Promise<void> {
  memory.delete(key);
  await tx("readwrite", (s) => s.delete(key));
}

export async function kvKeys(): Promise<string[]> {
  const keys = await tx<IDBValidKey[]>("readonly", (s) => s.getAllKeys());
  return (keys ?? [...memory.keys()]).map(String);
}
