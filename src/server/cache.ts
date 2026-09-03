import "server-only";
import { eq } from "drizzle-orm";
import { db } from "./db/client";
import { apiCache } from "./db/schema";

export const DAY_MS = 86_400_000;

/** In-flight requests, keyed identically to the cache. */
const inFlight = new Map<string, Promise<unknown>>();

/**
 * Cache-aside with single-flight.
 *
 * The single-flight map matters more than the cache here: a dashboard mount can
 * fire several identical Overpass queries at once, and Overpass allows only two
 * slots per IP. Without this, one page load can rate-limit itself.
 */
export async function getOrFetch<T>(
  key: string,
  ttlMs: number,
  fetcher: () => Promise<T>,
): Promise<T> {
  const now = Date.now();

  const hit = db.select().from(apiCache).where(eq(apiCache.key, key)).get();
  if (hit && hit.expiresAt > now) {
    return JSON.parse(hit.payloadJson) as T;
  }

  const pending = inFlight.get(key);
  if (pending) return pending as Promise<T>;

  const task = (async () => {
    try {
      const value = await fetcher();
      db.insert(apiCache)
        .values({
          key,
          payloadJson: JSON.stringify(value),
          fetchedAt: now,
          expiresAt: now + ttlMs,
        })
        .onConflictDoUpdate({
          target: apiCache.key,
          set: { payloadJson: JSON.stringify(value), fetchedAt: now, expiresAt: now + ttlMs },
        })
        .run();
      return value;
    } catch (err) {
      // Serve stale rather than fail: an expired Overpass result beats an error
      // page when the upstream is rate-limiting us.
      if (hit) return JSON.parse(hit.payloadJson) as T;
      throw err;
    } finally {
      inFlight.delete(key);
    }
  })();

  inFlight.set(key, task);
  return task;
}
