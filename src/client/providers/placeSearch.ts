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
 * rather than the best places. For anywhere further out — a town five hours down the
 * coast — the user names the place and we geocode it directly, with no distance limit.
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
  category?: string;
  type?: string;
  addresstype?: string;
  extratags?: Record<string, string> | null;
  namedetails?: Record<string, string> | null;
}

export interface PlaceSearchResult {
  place: Place;
  /** Full Nominatim label, so the user can tell two same-named towns apart. */
  context: string;
  /** Metres from the trip centre, when one is known. */
  distance: number | null;
}

const OSM_PREFIX: Record<string, string> = { node: "node", way: "way", relation: "relation" };

export async function searchPlaces(
  query: string,
  origin?: LatLon | null,
): Promise<PlaceSearchResult[]> {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];

  const rows = await getOrFetch(`placesearch:${q}`, 30 * DAY_MS, async () => {
    const url =
      `${BASE}/search?format=jsonv2&limit=8&accept-language=en` +
      `&extratags=1&namedetails=1&q=${encodeURIComponent(q)}`;

    const res = await politeFetch(url, { timeoutMs: 20_000 });
    if (res.status === 429) throw new Error("Nominatim is rate-limiting you. Try again shortly.");
    if (!res.ok) throw new Error(`Nominatim returned ${res.status}`);
    return (await res.json()) as NominatimRow[];
  });

  return rows.map((r) => {
    const lat = Number(r.lat);
    const lon = Number(r.lon);
    const tags = r.extratags ?? {};

    // Nominatim reports its own class/type; reuse the OSM taxonomy where it lines up
    // and fall back to a generic landmark so the pin still gets a colour and a dwell.
    const cls = classify({ ...tags, [r.category ?? ""]: r.type ?? "" });

    const name =
      r.namedetails?.["name:en"] ||
      r.name ||
      r.namedetails?.name ||
      r.display_name.split(",")[0];
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
      distance: origin ? haversine(origin, { lat, lon }) : null,
    };
  });
}
