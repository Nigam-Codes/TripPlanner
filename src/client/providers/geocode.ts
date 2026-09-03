import { getOrFetch, DAY_MS } from "../cache";
import { politeFetch } from "../limiter";
import type { GeocodeResult } from "@/lib/types";

const BASE = process.env.NEXT_PUBLIC_NOMINATIM_URL ?? "https://nominatim.openstreetmap.org";

interface NominatimRow {
  name?: string;
  display_name: string;
  lat: string;
  lon: string;
  boundingbox?: [string, string, string, string];
  type: string;
  addresstype?: string;
}

/**
 * City search against Nominatim.
 *
 * Their policy forbids implementing autocomplete against the public API, so this only
 * ever runs on an explicit submit. Results cache for 30 days — clients repeating the
 * same query are treated as faulty and blocked.
 */
export async function geocode(query: string): Promise<GeocodeResult[]> {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];

  return getOrFetch(`geocode:${q}`, 30 * DAY_MS, async () => {
    const url =
      `${BASE}/search?format=jsonv2&addressdetails=1&limit=6&accept-language=en` +
      `&q=${encodeURIComponent(q)}`;

    const res = await politeFetch(url, { timeoutMs: 20_000 });

    if (res.status === 403) {
      throw new Error(
        "Nominatim rejected this request (403). Their public API blocks unidentified " +
          "clients; if this persists, the site may need its own geocoding provider.",
      );
    }
    if (res.status === 429) {
      throw new Error("Nominatim is rate-limiting you. Wait a moment and search again.");
    }
    if (!res.ok) throw new Error(`Nominatim returned ${res.status}`);

    const rows = (await res.json()) as NominatimRow[];

    return rows.map((r): GeocodeResult => {
      const bb = r.boundingbox?.map(Number);
      return {
        name: r.name || r.display_name.split(",")[0],
        displayName: r.display_name,
        lat: Number(r.lat),
        lon: Number(r.lon),
        bbox: bb && bb.length === 4 ? [bb[0], bb[1], bb[2], bb[3]] : null,
        type: r.addresstype || r.type,
      };
    });
  });
}
