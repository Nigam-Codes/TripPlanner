import 'server-only';
import { getOrFetch, DAY_MS } from '../cache';
import { politeFetch } from '../limiter';
import { CATEGORIES } from '@/lib/categories';
import { buildOverpassQuery, normalizeElements, type OverpassElement } from '@/lib/osm';
import type { Place } from '@/lib/types';

const BASE = process.env.OVERPASS_URL ?? 'https://overpass-api.de/api/interpreter';

export async function findPlaces(
  lat: number,
  lon: number,
  radiusM: number,
  categoryIds?: string[],
): Promise<Place[]> {
  const cats = (categoryIds?.length ? categoryIds : CATEGORIES.map((c) => c.id)).slice().sort();
  // Round the centre so small map nudges reuse the cached result.
  const key = `overpass:${lat.toFixed(3)},${lon.toFixed(3)}:${Math.round(radiusM)}:${cats.join(",")}`;

  return getOrFetch(key, 7 * DAY_MS, async () => {
    const query = buildOverpassQuery(lat, lon, radiusM, cats);
    const res = await politeFetch(BASE, {
      method: "POST",
      body: new URLSearchParams({ data: query }),
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      timeoutMs: 120_000,
    });

    if (res.status === 429) throw new Error("Overpass is rate-limiting this IP. Try again shortly.");
    if (res.status === 504) throw new Error("Overpass timed out. Try a smaller radius.");
    if (!res.ok) throw new Error(`Overpass returned ${res.status}`);

    const json = (await res.json()) as { elements: OverpassElement[] };
    return normalizeElements(json.elements ?? [], { lat, lon }, radiusM);
  });
}
