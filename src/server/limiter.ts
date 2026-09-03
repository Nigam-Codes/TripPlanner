import "server-only";

/**
 * Per-host request gate. Public OSM services are donated infrastructure with
 * published limits; exceeding them gets an IP blocked, so every outbound call
 * routes through here.
 */
interface HostPolicy {
  minIntervalMs: number;
  maxConcurrent: number;
}

const POLICIES: Record<string, HostPolicy> = {
  // Nominatim: hard 1 req/sec, enforced by the operators.
  "nominatim.openstreetmap.org": { minIntervalMs: 1100, maxConcurrent: 1 },
  // Overpass: 2 slots; we use one and queue the rest.
  "overpass-api.de": { minIntervalMs: 1000, maxConcurrent: 1 },
  "routing.openstreetmap.de": { minIntervalMs: 200, maxConcurrent: 2 },
};

const DEFAULT_POLICY: HostPolicy = { minIntervalMs: 100, maxConcurrent: 4 };

const state = new Map<string, { last: number; active: number; queue: (() => void)[] }>();

function policyFor(host: string): HostPolicy {
  return POLICIES[host] ?? DEFAULT_POLICY;
}

function stateFor(host: string) {
  let s = state.get(host);
  if (!s) {
    s = { last: 0, active: 0, queue: [] };
    state.set(host, s);
  }
  return s;
}

function release(host: string) {
  const s = stateFor(host);
  s.active--;
  const next = s.queue.shift();
  if (next) next();
}

async function acquire(host: string): Promise<void> {
  const p = policyFor(host);
  const s = stateFor(host);

  if (s.active >= p.maxConcurrent) {
    await new Promise<void>((res) => s.queue.push(res));
  }
  s.active++;

  const wait = s.last + p.minIntervalMs - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  s.last = Date.now();
}

export interface FetchOptions extends RequestInit {
  timeoutMs?: number;
  retryOn429?: boolean;
}

/**
 * Rate-limited fetch that always identifies the app. Nominatim rejects generic
 * User-Agents outright, and the FOSSGIS services ask for an X-Client-Id.
 */
export async function politeFetch(url: string, opts: FetchOptions = {}): Promise<Response> {
  const { timeoutMs = 90_000, retryOn429 = true, ...init } = opts;
  const host = new URL(url).host;
  const ua = process.env.NOMINATIM_USER_AGENT ?? "TripPlanner/0.1";

  await acquire(host);
  try {
    const run = async () => {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      try {
        return await fetch(url, {
          ...init,
          signal: ctrl.signal,
          headers: {
            "User-Agent": ua,
            "X-Client-Id": ua,
            "Accept-Language": "en",
            ...(init.headers ?? {}),
          },
        });
      } finally {
        clearTimeout(timer);
      }
    };

    let res = await run();
    if (res.status === 429 && retryOn429) {
      const retryAfter = Number(res.headers.get("retry-after")) || 5;
      await new Promise((r) => setTimeout(r, Math.min(retryAfter, 15) * 1000));
      res = await run();
    }
    return res;
  } finally {
    release(host);
  }
}
