import { kvGet, kvSet, kvDelete, kvKeys } from "./kv";

export const DAY_MS = 86_400_000;

interface Entry<T> {
  value: T;
  fetchedAt: number;
  expiresAt: number;
}

/** In-flight requests, keyed identically to the cache. */
const inFlight = new Map<string, Promise<unknown>>();

/**
 * Cache-aside with single-flight.
 *
 * The single-flight map matters more than the cache: mounting the dashboard can fire
 * several identical Overpass queries at once, and Overpass allows only two slots per
 * IP. Without this, one page load can rate-limit itself.
 */
export async function getOrFetch<T>(
  key: string,
  ttlMs: number,
  fetcher: () => Promise<T>,
): Promise<T> {
  const now = Date.now();
  const hit = await kvGet<Entry<T>>(key);

  if (hit && hit.expiresAt > now) return hit.value;

  const pending = inFlight.get(key);
  if (pending) return pending as Promise<T>;

  const task = (async () => {
    try {
      const value = await fetcher();
      await store(key, { value, fetchedAt: now, expiresAt: now + ttlMs });
      return value;
    } catch (err) {
      // Serve stale rather than fail: an expired Overpass result beats an error
      // screen when the upstream is rate-limiting us.
      if (hit) return hit.value;
      throw err;
    } finally {
      inFlight.delete(key);
    }
  })();

  inFlight.set(key, task);
  return task;
}

/** Write, evicting the oldest quarter of entries if the browser reports a full quota. */
async function store<T>(key: string, entry: Entry<T>): Promise<void> {
  try {
    await kvSet(key, entry);
  } catch (err) {
    const name = (err as { name?: string })?.name;
    if (name !== "QuotaExceededError") return;

    await evictOldest();
    try {
      await kvSet(key, entry);
    } catch {
      // Give up quietly — the app works without a cache, just more slowly.
    }
  }
}

async function evictOldest(): Promise<void> {
  try {
    const keys = await kvKeys();
    const dated = await Promise.all(
      keys.map(async (k) => ({ k, at: (await kvGet<Entry<unknown>>(k))?.fetchedAt ?? 0 })),
    );
    dated.sort((a, b) => a.at - b.at);
    await Promise.all(dated.slice(0, Math.ceil(dated.length / 4)).map((d) => kvDelete(d.k)));
  } catch {
    /* nothing further to try */
  }
}
