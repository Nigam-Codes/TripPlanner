import "server-only";
import { getOrFetch, DAY_MS } from "../cache";
import { politeFetch } from "../limiter";
import type { Place } from "@/lib/types";

/**
 * Enrichment turns bare OSM names into a browsable dashboard: a sentence of
 * description, a photo, and a fame signal to rank by.
 *
 * Popularity uses Wikidata SITELINK COUNT (how many language Wikipedias cover the
 * subject) rather than pageviews. Both are good fame proxies, but sitelinks come
 * back 50-at-a-time from a call we already have to make to resolve English titles,
 * whereas pageviews are one HTTP request per article. For 80 places that is
 * 4 requests instead of 160 against donated infrastructure.
 */

const WIKIDATA_API = "https://www.wikidata.org/w/api.php";
const WIKI_API = "https://en.wikipedia.org/w/api.php";
const BATCH = 50;
// The extracts API silently honours only `exlimit` titles per request and caps
// that at 20 when exintro is set — batching 50 here returns one description and
// nulls for the rest, which is easy to mistake for "Wikipedia has no article".
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
    const key = `wd:${group.join(",")}`;
    const data = await getOrFetch(key, 30 * DAY_MS, async () => {
      const url =
        `${WIKIDATA_API}?action=wbgetentities&format=json&formatversion=2` +
        `&props=sitelinks&ids=${group.join("|")}`;
      const res = await politeFetch(url, { timeoutMs: 30_000 });
      if (!res.ok) throw new Error(`Wikidata returned ${res.status}`);
      return (await res.json()) as { entities?: Record<string, { sitelinks?: Record<string, { title: string }> }> };
    }).catch(() => null);

    if (!data?.entities) continue;
    for (const [id, ent] of Object.entries(data.entities)) {
      const links = ent.sitelinks ?? {};
      out.set(id, {
        title: links.enwiki?.title ?? null,
        sitelinks: Object.keys(links).length,
      });
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
    const key = `wp:${group.join("|")}`;
    const data = await getOrFetch(key, 30 * DAY_MS, async () => {
      const url =
        `${WIKI_API}?action=query&format=json&formatversion=2&redirects=1` +
        `&prop=extracts|pageimages&exintro=1&explaintext=1&exsentences=2&exlimit=max&pilimit=max` +
        `&piprop=thumbnail&pithumbsize=480` +
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
  if (!m) return null;
  return m[1] === "en" ? m[2] : null;
}

export interface EnrichOptions {
  /** How many top-scoring places to enrich. */
  limit?: number;
}

/**
 * Enrich the most promising places, then re-rank the whole list so genuinely
 * famous sites float to the top.
 */
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
    const direct = englishTitleFromTag(p.wikipedia);
    const viaWd = p.wikidata ? wd.get(p.wikidata)?.title : null;
    const title = direct ?? viaWd;
    if (title) titleFor.set(p.id, title);
  }

  const summaries = await fetchSummaries([...new Set(titleFor.values())]);

  const enrichedById = new Map<string, Place>();
  for (const p of candidates) {
    const title = titleFor.get(p.id);
    const sum = title ? summaries.get(title) : undefined;
    const sitelinks = p.wikidata ? wd.get(p.wikidata)?.sitelinks ?? 0 : 0;

    enrichedById.set(p.id, {
      ...p,
      description: sum?.extract ?? p.description,
      imageUrl: sum?.thumbnail ?? p.imageUrl,
      popularity: sitelinks,
    });
  }

  const merged = places.map((p) => enrichedById.get(p.id) ?? p);
  return rankPlaces(merged);
}

/**
 * Final ordering. Sitelink count is heavily skewed (a world landmark has 60+, a
 * local shrine has 1), so it goes through a log before being combined with the
 * tag score — otherwise one famous site would dominate every comparison.
 */
export function rankPlaces(places: Place[]): Place[] {
  return places
    .map((p) => ({
      p,
      rank: p.score + Math.log2(1 + (p.popularity ?? 0)) * 3,
    }))
    .sort((a, b) => b.rank - a.rank)
    .map((x) => x.p);
}
