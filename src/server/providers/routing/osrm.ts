import "server-only";
import { politeFetch } from "../../limiter";
import type { LatLon, Leg, Mode } from "@/lib/types";
import type { RoutingProvider } from "./types";
import type { LineString } from "geojson";

/**
 * FOSSGIS public OSRM. Each travel mode is a SEPARATE server with its own graph;
 * the profile segment inside the path is always the literal "driving" regardless
 * of mode. The single public demo at router.project-osrm.org is car-only and
 * returns identical durations for every profile, so it is deliberately not used.
 */
const BASE: Record<Mode, string> = {
  foot: process.env.OSRM_FOOT_URL ?? "https://routing.openstreetmap.de/routed-foot",
  bike: process.env.OSRM_BIKE_URL ?? "https://routing.openstreetmap.de/routed-bike",
  car: process.env.OSRM_CAR_URL ?? "https://routing.openstreetmap.de/routed-car",
};

const coord = (p: LatLon) => `${p.lon.toFixed(6)},${p.lat.toFixed(6)}`;

export const osrmProvider: RoutingProvider = {
  name: "osrm",

  async leg(from, to, mode) {
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
    };
  },

  async matrix(points, mode) {
    if (points.length < 2) return [[0]];
    const url =
      `${BASE[mode]}/table/v1/driving/${points.map(coord).join(";")}` +
      `?annotations=duration`;

    const res = await politeFetch(url, { timeoutMs: 45_000 });
    if (!res.ok) throw new Error(`OSRM matrix (${mode}) returned ${res.status}`);

    const json = (await res.json()) as { code: string; durations?: (number | null)[][] };
    if (json.code !== "Ok" || !json.durations) throw new Error("OSRM matrix failed");

    // Unroutable pairs come back null; a large finite penalty keeps the optimizer
    // working (and simply avoiding those pairs) instead of producing NaN.
    return json.durations.map((row) => row.map((d) => d ?? 6 * 3600));
  },
};
