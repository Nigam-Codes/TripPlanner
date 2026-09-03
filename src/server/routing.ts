import "server-only";
import { eq } from "drizzle-orm";
import { db } from "./db/client";
import { routeCache } from "./db/schema";
import { routingProvider } from "./providers/routing";
import { haversine } from "@/lib/geo";
import type { LatLon, Leg, Mode } from "@/lib/types";
import type { LineString } from "geojson";

/** Rough fallback speeds, metres per second. */
const SPEED: Record<Mode, number> = { foot: 1.35, bike: 4.2, car: 11 };
/** Streets are not straight lines; scale crow-flies distance before estimating. */
const DETOUR = 1.35;

function cacheKey(from: LatLon, to: LatLon, mode: Mode): string {
  return `${mode}:${from.lat.toFixed(5)},${from.lon.toFixed(5)}>${to.lat.toFixed(5)},${to.lon.toFixed(5)}`;
}

/**
 * Last-resort estimate when the router is unreachable. Clearly marked by a null
 * geometry so the UI can show the leg as approximate rather than silently
 * presenting a guess as a real route.
 */
function estimate(from: LatLon, to: LatLon, mode: Mode): Leg {
  const distanceM = haversine(from, to) * DETOUR;
  return { durationSec: distanceM / SPEED[mode], distanceM, geometry: null, mode };
}

export async function getLeg(from: LatLon, to: LatLon, mode: Mode): Promise<Leg> {
  const key = cacheKey(from, to, mode);

  const hit = db.select().from(routeCache).where(eq(routeCache.key, key)).get();
  if (hit) {
    return {
      durationSec: hit.durationSec,
      distanceM: hit.distanceM,
      geometry: hit.geometryJson ? (JSON.parse(hit.geometryJson) as LineString) : null,
      mode,
    };
  }

  let leg: Leg;
  try {
    leg = await routingProvider().leg(from, to, mode);
  } catch {
    // Do not persist estimates — we want the real route on the next attempt.
    return estimate(from, to, mode);
  }

  db.insert(routeCache)
    .values({
      key,
      durationSec: leg.durationSec,
      distanceM: leg.distanceM,
      geometryJson: leg.geometry ? JSON.stringify(leg.geometry) : null,
      fetchedAt: Date.now(),
    })
    .onConflictDoNothing()
    .run();

  return leg;
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
  try {
    return await routingProvider().matrix(points, mode);
  } catch {
    return points.map((a) => points.map((b) => (haversine(a, b) * DETOUR) / SPEED[mode]));
  }
}
