import { getOrFetch, DAY_MS } from "../cache";
import { politeFetch } from "../limiter";
import { classify } from "@/lib/categories";
import { haversine } from "@/lib/geo";
import type { LatLon, Place } from "@/lib/types";

const BASE = process.env.NEXT_PUBLIC_NOMINATIM_URL ?? "https://nominatim.openstreetmap.org";

/**
 * Free-text place lookup, used to add a destination that radius discovery cannot reach.
 *
 * Radius discovery tops out around 50 km: an unfiltered Overpass query at 400 km takes
 * ~90 seconds and still truncates at the element cap, so it returns an arbitrary slice
 * rather than the best places. For anywhere further out — a national park, a lake, a
 * trailhead, a town five hours down the coast — the user names the place and we geocode
 * it directly, with no distance limit and no restriction on what kind of thing it is.
 *
 * `extratags=1` is what makes an added place look like a discovered one: it returns the
 * wikidata id, so the normal enrichment path can fill in a description and photo.
 */

interface NominatimRow {
  osm_type?: "node" | "way" | "relation";
  osm_id?: number;
  name?: string;
  display_name: string;
  lat: string;
  lon: string;
  /** Nominatim's OSM key, e.g. "water", "leisure", "boundary", "highway". */
  category?: string;
  /** Its value, e.g. "lake", "nature_reserve", "administrative", "path". */
  type?: string;
  addresstype?: string;
  importance?: number;
  extratags?: Record<string, string> | null;
  namedetails?: Record<string, string> | null;
}

export interface PlaceSearchResult {
  place: Place;
  /** Full Nominatim label, so the user can tell two same-named towns apart. */
  context: string;
  /** Human-readable feature type — "Lake", "National park", "Hiking trail". */
  typeLabel: string;
  /** Metres from the trip centre, when one is known. */
  distance: number | null;
}

const OSM_PREFIX: Record<string, string> = { node: "node", way: "way", relation: "relation" };

/** Nominatim class/type pairs whose plain-English name is not just the type. */
const TYPE_LABELS: Record<string, string> = {
  "leisure:nature_reserve": "Nature reserve",
  "boundary:national_park": "National park",
  "boundary:protected_area": "Protected area",
  "boundary:administrative": "Administrative area",
  "highway:path": "Trail",
  "highway:footway": "Footpath",
  "highway:track": "Track",
  "highway:bridleway": "Bridleway",
  "highway:residential": "Road",
  "highway:unclassified": "Road",
  "highway:service": "Service road",
  "highway:motorway": "Motorway",
  "highway:trunk": "Road",
  "highway:primary": "Road",
  "highway:secondary": "Road",
  "highway:tertiary": "Road",
  "route:hiking": "Hiking route",
  "man_made:bridge": "Bridge",
  "natural:peak": "Peak",
  "natural:water": "Water",
  "waterway:waterfall": "Waterfall",
  "amenity:place_of_worship": "Place of worship",
  "tourism:attraction": "Attraction",
};

const titleCase = (s: string) =>
  s.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());

export function featureLabel(cls: string | undefined, type: string | undefined): string {
  if (!type) return "Place";
  const exact = TYPE_LABELS[`${cls}:${type}`];
  if (exact) return exact;
  return titleCase(type);
}

/**
 * Roads rank highly in Nominatim because streets are frequently named after the
 * landmark beside them — "Angels Landing" returns the peak *and* two residential
 * streets. A road is rarely the thing someone means to visit, so it sinks below every
 * real feature rather than being dropped, in case it genuinely was the target.
 */
const ROAD_TYPES = new Set([
  "residential", "unclassified", "service", "tertiary", "secondary", "primary",
  "trunk", "motorway", "living_street", "pedestrian", "road",
]);

function isPlainRoad(r: NominatimRow): boolean {
  return r.category === "highway" && ROAD_TYPES.has(r.type ?? "");
}

export async function searchPlaces(
  query: string,
  origin?: LatLon | null,
): Promise<PlaceSearchResult[]> {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];

  const rows = await getOrFetch(`placesearch:v2:${q}`, 30 * DAY_MS, async () => {
    const url =
      `${BASE}/search?format=jsonv2&limit=12&accept-language=en` +
      `&extratags=1&namedetails=1&q=${encodeURIComponent(q)}`;

    const res = await politeFetch(url, { timeoutMs: 20_000 });
    if (res.status === 429) throw new Error("Nominatim is rate-limiting you. Try again shortly.");
    if (!res.ok) throw new Error(`Nominatim returned ${res.status}`);
    return (await res.json()) as NominatimRow[];
  });

  const results = rows.map((r) => {
    const lat = Number(r.lat);
    const lon = Number(r.lon);
    const tags = r.extratags ?? {};

    // Nominatim reports the feature's OSM key/value as class/type. Feeding that pair
    // through the same classifier the Overpass path uses is what lets a lake, a
    // national park or a trail get the right label, colour and default dwell.
    const cls = classify({ ...tags, ...(r.category ? { [r.category]: r.type ?? "" } : {}) });

    const name =
      r.namedetails?.["name:en"] || r.name || r.namedetails?.name || r.display_name.split(",")[0];
    const local = r.namedetails?.name;

    const place: Place = {
      id:
        r.osm_type && r.osm_id
          ? `${OSM_PREFIX[r.osm_type]}/${r.osm_id}`
          : `search/${lat.toFixed(5)},${lon.toFixed(5)}`,
      name,
      localName: local && local !== name ? local : null,
      lat,
      lon,
      category: cls?.category ?? "landmark",
      subcategory: cls?.subcategory ?? r.type ?? null,
      tags,
      wikidata: tags.wikidata ?? null,
      wikipedia: tags.wikipedia ?? null,
      description: null,
      imageUrl: null,
      popularity: null,
      score: 0,
    };

    return {
      place,
      context: r.display_name,
      typeLabel: featureLabel(r.category, r.type),
      distance: origin ? haversine(origin, { lat, lon }) : null,
      road: isPlainRoad(r),
      importance: r.importance ?? 0,
    };
  });

  // Stable sort: real features first, then Nominatim's own relevance.
  return results
    .sort((a, b) => Number(a.road) - Number(b.road) || b.importance - a.importance)
    .map(({ place, context, typeLabel, distance }) => ({ place, context, typeLabel, distance }));
}
