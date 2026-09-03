import type { Mode, Place, PlannedTrip } from "@/lib/types";

/**
 * Share links without a server.
 *
 * The plan travels inside the URL, so the payload has to stay small. Two decisions do
 * almost all of that work:
 *
 *  - Store IDENTITY, not content. Descriptions and thumbnails are re-fetched by the
 *    viewer from Wikidata/Wikipedia using the stored ids.
 *  - Omit route geometry entirely. Full polylines are by far the largest field, and the
 *    viewer's browser can re-route from the coordinates via OSRM.
 *
 * Result: roughly 75 bytes per stop before compression, so even a 20-stop trip encodes
 * to well under 1 kB.
 *
 * Everything is a positional array rather than an object — field names would otherwise
 * be repeated for every stop.
 */

const VERSION = 1;

type StopTuple = [
  id: string,
  name: string,
  lat: number,
  lon: number,
  category: string,
  dwell: number,
  wikidata?: string,
  localName?: string,
];

type DayTuple = [title: string, startTime: string, stops: StopTuple[]];

type Payload = [
  version: number,
  title: string,
  cityName: string,
  cityLat: number,
  cityLon: number,
  radiusM: number,
  mode: Mode,
  days: DayTuple[],
];

/** Five decimals is ~1 m — more than enough to re-route, and shorter than a full float. */
const round = (n: number) => Number(n.toFixed(5));

/* ------------------------------------------------------------------- encoding */

function toPayload(plan: PlannedTrip): Payload {
  return [
    VERSION,
    plan.trip.title,
    plan.trip.cityName,
    round(plan.trip.cityLat),
    round(plan.trip.cityLon),
    plan.trip.radiusM,
    plan.trip.defaultMode,
    plan.days.map((d): DayTuple => [
      d.title ?? "",
      d.startTime,
      d.stops.map((s): StopTuple => {
        const tuple: StopTuple = [
          s.place.id,
          s.place.name,
          round(s.place.lat),
          round(s.place.lon),
          s.place.category,
          s.dwellMinutes,
        ];
        // Trailing optionals are only paid for when present.
        if (s.place.wikidata || s.place.localName) tuple[6] = s.place.wikidata ?? "";
        if (s.place.localName) tuple[7] = s.place.localName;
        return tuple;
      }),
    ]),
  ];
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(s: string): Uint8Array {
  const padded = s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

async function gzip(text: string): Promise<Uint8Array | null> {
  if (typeof CompressionStream === "undefined") return null;
  try {
    const stream = new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch {
    return null;
  }
}

async function gunzip(bytes: Uint8Array): Promise<string | null> {
  if (typeof DecompressionStream === "undefined") return null;
  try {
    const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream("gzip"));
    return await new Response(stream).text();
  } catch {
    return null;
  }
}

/**
 * Encode a plan for a URL fragment. The prefix records whether the body is compressed,
 * so browsers without CompressionStream still produce a readable (longer) link.
 */
export async function encodePlan(plan: PlannedTrip): Promise<string> {
  const json = JSON.stringify(toPayload(plan));
  const packed = await gzip(json);

  if (packed) return `z${base64UrlEncode(packed)}`;
  return `u${base64UrlEncode(new TextEncoder().encode(json))}`;
}

/* ------------------------------------------------------------------- decoding */

function place(t: StopTuple): Place {
  return {
    id: t[0],
    name: t[1],
    localName: t[7] || null,
    lat: t[2],
    lon: t[3],
    category: t[4],
    subcategory: null,
    tags: {},
    wikidata: t[6] || null,
    wikipedia: null,
    description: null,
    imageUrl: null,
    popularity: null,
    score: 0,
  };
}

export interface DecodedPlan {
  title: string;
  cityName: string;
  cityLat: number;
  cityLon: number;
  radiusM: number;
  mode: Mode;
  days: { title: string | null; startTime: string; stops: { place: Place; dwellMinutes: number }[] }[];
}

/** Returns null for anything unparseable — a truncated or edited link must 404, not crash. */
export async function decodePlan(encoded: string): Promise<DecodedPlan | null> {
  try {
    const flag = encoded[0];
    const body = encoded.slice(1);
    if (flag !== "z" && flag !== "u") return null;

    const bytes = base64UrlDecode(body);
    const json = flag === "z" ? await gunzip(bytes) : new TextDecoder().decode(bytes);
    if (!json) return null;

    const p = JSON.parse(json) as Payload;
    if (!Array.isArray(p) || p[0] !== VERSION) return null;

    const [, title, cityName, cityLat, cityLon, radiusM, mode, days] = p;
    if (!Array.isArray(days)) return null;

    return {
      title,
      cityName,
      cityLat,
      cityLon,
      radiusM,
      mode,
      days: days.map((d) => ({
        title: d[0] || null,
        startTime: d[1],
        stops: (d[2] ?? []).map((s) => ({ place: place(s), dwellMinutes: s[5] })),
      })),
    };
  } catch {
    return null;
  }
}
