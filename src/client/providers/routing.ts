import type { LineString } from "geojson";
import { getOrFetch, DAY_MS } from "../cache";
import { politeFetch } from "../limiter";
import { haversine } from "@/lib/geo";
import type { LatLon, Leg, Mode } from "@/lib/types";

/**
 * FOSSGIS public OSRM. Each travel mode is a SEPARATE server with its own graph; the
 * profile segment inside the path is always the literal "driving" regardless of mode.
 *
 * The single demo at router.project-osrm.org is car-only — it answers 200 for /foot/
 * and /bike/ and returns identical car durations for all three — so it is deliberately
 * not used.
 *
 * The server build also shipped an OpenRouteService fallback. It is dropped here: ORS
 * needs an API key, and a key embedded in a static site is a published key.
 */
const BASE: Record<Mode, string> = {
  foot: process.env.NEXT_PUBLIC_OSRM_FOOT_URL ?? "https://routing.openstreetmap.de/routed-foot",
  bike: process.env.NEXT_PUBLIC_OSRM_BIKE_URL ?? "https://routing.openstreetmap.de/routed-bike",
  car: process.env.NEXT_PUBLIC_OSRM_CAR_URL ?? "https://routing.openstreetmap.de/routed-car",
};

/** Rough fallback speeds, metres per second. */
const SPEED: Record<Mode, number> = { foot: 1.35, bike: 4.2, car: 11 };
/** Streets are not straight lines; scale crow-flies distance before estimating. */
const DETOUR = 1.35;

const coord = (p: LatLon) => `${p.lon.toFixed(6)},${p.lat.toFixed(6)}`;

/**
 * Last-resort estimate when the router is unreachable. Marked by a null geometry so
 * the UI can show the leg as approximate rather than presenting a guess as a real
 * route.
 */
function estimate(from: LatLon, to: LatLon, mode: Mode): Leg {
  const distanceM = haversine(from, to) * DETOUR;
  return { durationSec: distanceM / SPEED[mode], distanceM, geometry: null, mode };
}

export async function getLeg(from: LatLon, to: LatLon, mode: Mode): Promise<Leg> {
  const key = `leg:${mode}:${coord(from)}>${coord(to)}`;

  try {
    return await getOrFetch(key, 30 * DAY_MS, async () => {
      const url =
        `${BASE[mode]}/route/v1/driving/${coord(from)};${coord(to)}` +
        `?overview=full&geometries=geojson&alternatives=false&steps=false`;

      const res = await politeFetch(url, { timeoutMs: 30_000 });
      if (!res.ok) throw new Error(`OSRM (${mode}) returned ${res.status}`);

      const json = (await res.json()) as {
        code: string;
        routes?: { duration: number; distance: number; geometry: LineString }[];
      };
      const route = json.routes?.[0];
      if (json.code !== "Ok" || !route) throw new Error(`No ${mode} route found`);

      return {
        durationSec: route.duration,
        distanceM: route.distance,
        geometry: route.geometry,
        mode,
      } satisfies Leg;
    });
  } catch {
    // Never cache an estimate — we want the real route on the next attempt.
    return estimate(from, to, mode);
  }
}

/** Legs for an ordered list of points, sequentially so the rate limiter applies. */
export async function getLegs(points: LatLon[], mode: Mode): Promise<Leg[]> {
  const legs: Leg[] = [];
  for (let i = 1; i < points.length; i++) {
    legs.push(await getLeg(points[i - 1], points[i], mode));
  }
  return legs;
}

export async function getMatrix(points: LatLon[], mode: Mode): Promise<number[][]> {
  if (points.length < 2) return [[0]];

  try {
    const url =
      `${BASE[mode]}/table/v1/driving/${points.map(coord).join(";")}?annotations=duration`;
    const res = await politeFetch(url, { timeoutMs: 45_000 });
    if (!res.ok) throw new Error(`OSRM matrix (${mode}) returned ${res.status}`);

    const json = (await res.json()) as { code: string; durations?: (number | null)[][] };
    if (json.code !== "Ok" || !json.durations) throw new Error("OSRM matrix failed");

    // Unroutable pairs come back null; a large finite penalty keeps the optimizer
    // working (and simply avoiding those pairs) instead of producing NaN.
    return json.durations.map((row) => row.map((d) => d ?? 6 * 3600));
  } catch {
    return points.map((a) => points.map((b) => (haversine(a, b) * DETOUR) / SPEED[mode]));
  }
}
