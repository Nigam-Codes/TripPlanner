/**
 * Per-host request gate, ported from the server build.
 *
 * The public OSM services are donated infrastructure with published limits, and those
 * limits still apply when the requests come from a browser instead of a server.
 *
 * Two differences from the server version, both forced by the browser:
 *
 *  - `User-Agent` is a forbidden header in fetch and cannot be set from a page. The
 *    server build sent one to identify the app; here the browser sends a `Referer`
 *    automatically, which Nominatim's policy accepts as the alternative.
 *  - Sending any custom header would turn these into preflighted CORS requests. The
 *    Overpass POST is deliberately left as form-encoded so it stays a "simple request".
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
  s.queue.shift()?.();
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

export async function politeFetch(url: string, opts: FetchOptions = {}): Promise<Response> {
  const { timeoutMs = 90_000, retryOn429 = true, ...init } = opts;
  const host = new URL(url, location.href).host;

  await acquire(host);
  try {
    const run = async () => {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      try {
        return await fetch(url, { ...init, signal: ctrl.signal });
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
