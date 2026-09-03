import { getOrFetch, DAY_MS } from "../cache";
import { politeFetch } from "../limiter";
import type { Place } from "@/lib/types";

/**
 * Enrichment turns bare OSM names into a browsable dashboard: a sentence of
 * description, a photo, and a fame signal to rank by.
 *
 * Popularity uses Wikidata SITELINK COUNT (how many language Wikipedias cover the
 * subject) rather than pageviews. Both are good fame proxies, but sitelinks arrive
 * 50-at-a-time from a call we already make to resolve English titles, whereas
 * pageviews cost one request per article — 4 requests instead of 160 for 80 places.
 *
 * NOTE: `origin=*` is REQUIRED on every Wikimedia call here. Without it the API
 * returns no Access-Control-Allow-Origin header, the browser blocks the response, and
 * descriptions, images AND the popularity ranking all vanish silently — leaving the
 * unranked pile of raw OSM names that the ranking exists to fix.
 */

const WIKIDATA_API = "https://www.wikidata.org/w/api.php";
const WIKI_API = "https://en.wikipedia.org/w/api.php";

const BATCH = 50;
// The extracts API honours only `exlimit` titles per request and caps that at 20 when
// exintro is set. Batching 50 returns one description and nulls for the rest, which is
// easy to mistake for "Wikipedia has no article".
const SUMMARY_BATCH = 20;

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

interface WdInfo {
  title: string | null;
  sitelinks: number;
}

/** Resolve Wikidata ids to English Wikipedia titles + a sitelink-count fame score. */
async function fetchWikidata(ids: string[]): Promise<Map<string, WdInfo>> {
  const out = new Map<string, WdInfo>();

  for (const group of chunk(ids, BATCH)) {
    const data = await getOrFetch(`wd:${group.join(",")}`, 30 * DAY_MS, async () => {
      const url =
        `${WIKIDATA_API}?action=wbgetentities&format=json&formatversion=2&origin=*` +
        `&props=sitelinks&ids=${group.join("|")}`;
      const res = await politeFetch(url, { timeoutMs: 30_000 });
      if (!res.ok) throw new Error(`Wikidata returned ${res.status}`);
      return (await res.json()) as {
        entities?: Record<string, { sitelinks?: Record<string, { title: string }> }>;
      };
    }).catch(() => null);

    if (!data?.entities) continue;
    for (const [id, ent] of Object.entries(data.entities)) {
      const links = ent.sitelinks ?? {};
      out.set(id, { title: links.enwiki?.title ?? null, sitelinks: Object.keys(links).length });
    }
  }
  return out;
}

interface WikiSummary {
  extract: string | null;
  thumbnail: string | null;
}

/** Batch-fetch intro extracts and thumbnails for English Wikipedia titles. */
async function fetchSummaries(titles: string[]): Promise<Map<string, WikiSummary>> {
  const out = new Map<string, WikiSummary>();

  for (const group of chunk(titles, SUMMARY_BATCH)) {
    const data = await getOrFetch(`wp:${group.join("|")}`, 30 * DAY_MS, async () => {
      const url =
        `${WIKI_API}?action=query&format=json&formatversion=2&redirects=1&origin=*` +
        `&prop=extracts|pageimages&exintro=1&explaintext=1&exsentences=2` +
        `&exlimit=max&pilimit=max&piprop=thumbnail&pithumbsize=480` +
        `&titles=${encodeURIComponent(group.join("|"))}`;
      const res = await politeFetch(url, { timeoutMs: 30_000 });
      if (!res.ok) throw new Error(`Wikipedia returned ${res.status}`);
      return (await res.json()) as {
        query?: {
          pages?: { title: string; extract?: string; thumbnail?: { source: string } }[];
          normalized?: { from: string; to: string }[];
        };
      };
    }).catch(() => null);

    const pages = data?.query?.pages ?? [];
    const alias = new Map((data?.query?.normalized ?? []).map((n) => [n.to, n.from]));

    for (const p of pages) {
      const summary: WikiSummary = {
        extract: p.extract?.trim() || null,
        thumbnail: p.thumbnail?.source ?? null,
      };
      out.set(p.title, summary);
      const original = alias.get(p.title);
      if (original) out.set(original, summary);
    }
  }
  return out;
}

/** Parse an OSM `wikipedia` tag ("en:Kiyomizu-dera") into its English title, if any. */
function englishTitleFromTag(tag: string | null): string | null {
  if (!tag) return null;
  const m = /^([a-z-]+):(.+)$/.exec(tag);
  return m && m[1] === "en" ? m[2] : null;
}

export interface EnrichOptions {
  /** How many top-scoring places to enrich. */
  limit?: number;
}

export async function enrichPlaces(places: Place[], opts: EnrichOptions = {}): Promise<Place[]> {
  const limit = opts.limit ?? 80;

  const candidates = places
    .filter((p) => p.wikidata || p.wikipedia)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  if (candidates.length === 0) return places;

  const wdIds = [...new Set(candidates.map((p) => p.wikidata).filter((x): x is string => !!x))];
  const wd = await fetchWikidata(wdIds);

  const titleFor = new Map<string, string>();
  for (const p of candidates) {
    const title = englishTitleFromTag(p.wikipedia) ?? (p.wikidata ? wd.get(p.wikidata)?.title : null);
    if (title) titleFor.set(p.id, title);
  }

  const summaries = await fetchSummaries([...new Set(titleFor.values())]);

  const enrichedById = new Map<string, Place>();
  for (const p of candidates) {
    const title = titleFor.get(p.id);
    const sum = title ? summaries.get(title) : undefined;

    enrichedById.set(p.id, {
      ...p,
      description: sum?.extract ?? p.description,
      imageUrl: sum?.thumbnail ?? p.imageUrl,
      popularity: p.wikidata ? (wd.get(p.wikidata)?.sitelinks ?? 0) : 0,
    });
  }

  return rankPlaces(places.map((p) => enrichedById.get(p.id) ?? p));
}

/**
 * Final ordering. Sitelink count is heavily skewed (a world landmark has 60+, a local
 * shrine has 1), so it goes through a log before being combined with the tag score —
 * otherwise one famous site would dominate every comparison.
 */
export function rankPlaces(places: Place[]): Place[] {
  return places
    .map((p) => ({ p, rank: p.score + Math.log2(1 + (p.popularity ?? 0)) * 3 }))
    .sort((a, b) => b.rank - a.rank)
    .map((x) => x.p);
}

/**
 * Fill in descriptions and images for an exact set of places — used by the share page,
 * where stops arrive from the URL carrying only ids and coordinates.
 */
export async function hydratePlaces(places: Place[]): Promise<Place[]> {
  const withIds = places.filter((p) => p.wikidata);
  if (withIds.length === 0) return places;

  const wd = await fetchWikidata([...new Set(withIds.map((p) => p.wikidata!))]);
  const titleFor = new Map<string, string>();
  for (const p of withIds) {
    const title = wd.get(p.wikidata!)?.title;
    if (title) titleFor.set(p.id, title);
  }

  const summaries = await fetchSummaries([...new Set(titleFor.values())]);

  return places.map((p) => {
    const title = titleFor.get(p.id);
    const sum = title ? summaries.get(title) : undefined;
    if (!sum) return p;
    return {
      ...p,
      description: sum.extract ?? p.description,
      imageUrl: sum.thumbnail ?? p.imageUrl,
      popularity: p.wikidata ? (wd.get(p.wikidata)?.sitelinks ?? null) : null,
    };
  });
}
