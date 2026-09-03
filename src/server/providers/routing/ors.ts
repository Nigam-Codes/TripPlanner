import "server-only";
import { politeFetch } from "../../limiter";
import type { LatLon, Leg, Mode } from "@/lib/types";
import type { RoutingProvider } from "./types";
import type { LineString } from "geojson";

/** Opt-in fallback if the FOSSGIS instances degrade. Needs a free API key. */
const PROFILE: Record<Mode, string> = {
  foot: "foot-walking",
  bike: "cycling-regular",
  car: "driving-car",
};

const BASE = "https://api.openrouteservice.org/v2";

function key(): string {
  const k = process.env.ORS_API_KEY;
  if (!k) throw new Error("ROUTING_PROVIDER=ors but ORS_API_KEY is not set");
  return k;
}

export const orsProvider: RoutingProvider = {
  name: "ors",

  async leg(from, to, mode) {
    const res = await politeFetch(`${BASE}/directions/${PROFILE[mode]}/geojson`, {
      method: "POST",
      headers: { Authorization: key(), "Content-Type": "application/json" },
      body: JSON.stringify({ coordinates: [[from.lon, from.lat], [to.lon, to.lat]] }),
      timeoutMs: 30_000,
    });
    if (!res.ok) throw new Error(`ORS returned ${res.status}`);

    const json = (await res.json()) as {
      features?: { geometry: LineString; properties: { summary: { duration: number; distance: number } } }[];
    };
    const f = json.features?.[0];
    if (!f) throw new Error(`No ${mode} route found`);

    return {
      durationSec: f.properties.summary.duration,
      distanceM: f.properties.summary.distance,
      geometry: f.geometry,
      mode,
    };
  },

  async matrix(points, mode) {
    if (points.length < 2) return [[0]];
    const res = await politeFetch(`${BASE}/matrix/${PROFILE[mode]}`, {
      method: "POST",
      headers: { Authorization: key(), "Content-Type": "application/json" },
      body: JSON.stringify({
        locations: points.map((p) => [p.lon, p.lat]),
        metrics: ["duration"],
      }),
      timeoutMs: 45_000,
    });
    if (!res.ok) throw new Error(`ORS matrix returned ${res.status}`);

    const json = (await res.json()) as { durations?: (number | null)[][] };
    if (!json.durations) throw new Error("ORS matrix failed");
    return json.durations.map((row) => row.map((d) => d ?? 6 * 3600));
  },
};
