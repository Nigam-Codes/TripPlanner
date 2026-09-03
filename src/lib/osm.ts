import { CATEGORIES, classify } from './categories';
import { haversine } from './geo';
import type { Place } from './types';

export interface OverpassElement {
  type: 'node' | 'way' | 'relation';
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

/**
 * Build the Overpass QL query straight from the category taxonomy, so adding a
 * category to CATEGORIES automatically extends both the query and the classifier.
 */
/** Above this radius, unfiltered queries return truncated junk and take ~90s. */
export const NOTABLE_ONLY_ABOVE_M = 25_000;

export function buildOverpassQuery(
  lat: number,
  lon: number,
  radiusM: number,
  categoryIds: string[] = CATEGORIES.map((c) => c.id),
  /**
   * Restrict to features carrying a `wikidata` tag. At road-trip radii the
   * unfiltered query hits the element cap and returns an arbitrary slice; requiring
   * wikidata keeps the result both small and actually notable.
   */
  notableOnly = radiusM > NOTABLE_ONLY_ABOVE_M,
): string {
  const wanted = CATEGORIES.filter((c) => categoryIds.includes(c.id));
  const around = `around:${Math.round(radiusM)},${lat.toFixed(6)},${lon.toFixed(6)}`;

  const notable = notableOnly ? '["wikidata"]' : "";
  const clauses: string[] = [];
  for (const cat of wanted) {
    for (const [key, values] of Object.entries(cat.match)) {
      if (values === true) {
        clauses.push(`  nwr(${around})["${key}"]["name"]${notable};`);
      } else {
        const alt = values.map((v) => v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
        clauses.push(`  nwr(${around})["${key}"~"^(${alt})$"]["name"]${notable};`);
      }
    }
  }

  // `out center` collapses ways/relations to a centroid, so a park or a palace
  // becomes one pin instead of a polygon we would have to reduce client-side.
  return `[out:json][timeout:90];\n(\n${clauses.join("\n")}\n);\nout center tags 800;`;
}

/**
 * Prominence score. OSM carries no ratings, so without this the dashboard is an
 * alphabetical pile in which a bus shelter outranks a cathedral. Wikipedia and
 * Wikidata links are the strongest available signal that a feature is notable.
 */
export function scorePlace(tags: Record<string, string>, type: string): number {
  let s = 0;
  if (tags.wikidata) s += 3;
  if (tags.wikipedia) s += 3;
  if (tags.image || tags["image:url"]) s += 1;
  if (tags.tourism === "attraction" || tags.tourism === "museum") s += 2;
  if (type !== "node") s += 1; // mapped as an area => a substantial feature
  if (tags.website || tags["contact:website"]) s += 0.5;
  if (tags.opening_hours) s += 0.5;
  s += Math.min(Object.keys(tags).length / 10, 2);
  return Math.round(s * 100) / 100;
}

function normalizeName(n: string): string {
  return n.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

/**
 * Collapse duplicates. A landmark is very often mapped twice — once as a node and
 * once as the enclosing building way — and both come back from the same query.
 * Same normalized name within 60 m is treated as one place; the tag-richer wins.
 */
export function dedupePlaces(list: Place[]): Place[] {
  const kept: Place[] = [];
  const byName = new Map<string, Place[]>();

  for (const p of list) {
    const key = normalizeName(p.name);
    const near = byName.get(key) ?? [];
    const dup = near.find((q) => haversine(q, p) < 60);
    if (dup) {
      if (p.score > dup.score) {
        kept[kept.indexOf(dup)] = p;
        near[near.indexOf(dup)] = p;
      }
      continue;
    }
    near.push(p);
    byName.set(key, near);
    kept.push(p);
  }
  return kept;
}

export function normalizeElements(
  elements: OverpassElement[],
  centre: { lat: number; lon: number },
  radiusM: number,
): Place[] {
  const out: Place[] = [];

  for (const el of elements) {
    const tags = el.tags ?? {};
    // OSM's `name` is whatever the locals call it, so a Kyoto query returns
    // Japanese. Prefer an explicit English name and keep the local one for display.
    const name = tags["name:en"] || tags.name;
    if (!name) continue;
    const localName = tags.name && tags.name !== name ? tags.name : null;

    const lat = el.lat ?? el.center?.lat;
    const lon = el.lon ?? el.center?.lon;
    if (lat == null || lon == null) continue;

    const cls = classify(tags);
    if (!cls) continue;

    // Overpass measures `around` from the geometry; a large way's centroid can
    // land outside the circle the user actually drew, so re-check the centroid.
    const distance = haversine(centre, { lat, lon });
    if (distance > radiusM * 1.05) continue;

    out.push({
      id: `${el.type}/${el.id}`,
      name,
      localName,
      lat,
      lon,
      category: cls.category,
      subcategory: cls.subcategory,
      tags,
      wikidata: tags.wikidata ?? null,
      wikipedia: tags.wikipedia ?? null,
      description: tags.description ?? null,
      imageUrl: null,
      popularity: null,
      score: scorePlace(tags, el.type),
      distance,
    });
  }

  return dedupePlaces(out).sort((a, b) => b.score - a.score);
}
