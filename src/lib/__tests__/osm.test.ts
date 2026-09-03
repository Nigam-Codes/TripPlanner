import { describe, expect, it } from "vitest";
import { buildOverpassQuery, dedupePlaces, normalizeElements, scorePlace } from "../osm";
import type { OverpassElement } from "../osm";
import type { Place } from "../types";

const KYOTO = { lat: 35.0116, lon: 135.7681 };

function place(over: Partial<Place>): Place {
  return {
    id: "node/1",
    name: "Somewhere",
    localName: null,
    lat: KYOTO.lat,
    lon: KYOTO.lon,
    category: "landmark",
    subcategory: null,
    tags: {},
    wikidata: null,
    wikipedia: null,
    description: null,
    imageUrl: null,
    popularity: null,
    score: 0,
    ...over,
  };
}

describe("buildOverpassQuery", () => {
  it("emits one clause per tag key and requires a name", () => {
    const q = buildOverpassQuery(KYOTO.lat, KYOTO.lon, 1500, ["museum"]);
    expect(q).toContain('nwr(around:1500,35.011600,135.768100)["tourism"~"^(museum|gallery)$"]["name"];');
    // Unnamed features are useless in an itinerary, so they never leave Overpass.
    expect(q.split("\n").filter((l) => l.includes("nwr(")).every((l) => l.includes('["name"]'))).toBe(true);
  });

  it("only includes the requested categories", () => {
    const q = buildOverpassQuery(KYOTO.lat, KYOTO.lon, 1000, ["nature"]);
    expect(q).toContain('"leisure"');
    expect(q).not.toContain('"tourism"');
  });

  it("requests centroids so areas resolve to a single point", () => {
    expect(buildOverpassQuery(KYOTO.lat, KYOTO.lon, 1000)).toContain("out center tags");
  });
});

describe("scorePlace", () => {
  it("ranks a Wikipedia-linked landmark above a bare node", () => {
    const rich = scorePlace({ name: "X", wikidata: "Q1", wikipedia: "en:X", tourism: "museum" }, "way");
    const bare = scorePlace({ name: "Y" }, "node");
    expect(rich).toBeGreaterThan(bare);
  });
});

describe("dedupePlaces", () => {
  it("collapses a node and its enclosing way into the richer entry", () => {
    const asNode = place({ id: "node/1", name: "Kinkaku-ji", score: 4 });
    const asWay = place({ id: "way/2", name: "Kinkaku-ji", score: 9 });

    const out = dedupePlaces([asNode, asWay]);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("way/2");
  });

  it("keeps same-named places that are genuinely far apart", () => {
    const a = place({ id: "node/1", name: "Starbucks" });
    const b = place({ id: "node/2", name: "Starbucks", lat: KYOTO.lat + 0.01 });
    expect(dedupePlaces([a, b])).toHaveLength(2);
  });

  it("ignores punctuation and case when matching names", () => {
    const a = place({ id: "node/1", name: "Nijō Castle", score: 2 });
    const b = place({ id: "way/2", name: "nijō  castle!", score: 5 });
    expect(dedupePlaces([a, b])).toHaveLength(1);
  });
});

describe("normalizeElements", () => {
  const el = (over: Partial<OverpassElement>): OverpassElement => ({
    type: "node",
    id: 1,
    lat: KYOTO.lat,
    lon: KYOTO.lon,
    tags: { name: "Thing", tourism: "attraction" },
    ...over,
  });

  it("prefers name:en but keeps the local name", () => {
    const [p] = normalizeElements(
      [el({ tags: { name: "清水寺", "name:en": "Kiyomizu-dera", tourism: "attraction" } })],
      KYOTO,
      1000,
    );
    expect(p.name).toBe("Kiyomizu-dera");
    expect(p.localName).toBe("清水寺");
  });

  it("leaves localName null when there is no separate English name", () => {
    expect(normalizeElements([el({})], KYOTO, 1000)[0].localName).toBeNull();
  });

  it("drops unnamed and unclassifiable features", () => {
    const out = normalizeElements(
      [
        el({ id: 2, tags: { tourism: "attraction" } }), // no name
        el({ id: 3, tags: { name: "Bus stop", highway: "bus_stop" } }), // no category
      ],
      KYOTO,
      1000,
    );
    expect(out).toHaveLength(0);
  });

  it("uses the centroid of ways and relations", () => {
    const [p] = normalizeElements(
      [el({ type: "way", id: 7, lat: undefined, lon: undefined, center: { lat: KYOTO.lat, lon: KYOTO.lon } })],
      KYOTO,
      1000,
    );
    expect(p.id).toBe("way/7");
    expect(p.lat).toBe(KYOTO.lat);
  });

  it("excludes centroids that fall outside the requested radius", () => {
    // Overpass measures `around` against geometry, so a large area's centroid
    // can land well outside the circle the user actually drew.
    const far = el({ id: 9, lat: KYOTO.lat + 0.5, lon: KYOTO.lon });
    expect(normalizeElements([far], KYOTO, 1000)).toHaveLength(0);
  });

  it("returns places sorted by descending score", () => {
    const out = normalizeElements(
      [
        el({ id: 1, tags: { name: "Plain", tourism: "attraction" } }),
        el({ id: 2, lat: KYOTO.lat + 0.001, tags: { name: "Famous", tourism: "museum", wikidata: "Q1", wikipedia: "en:F" } }),
      ],
      KYOTO,
      1000,
    );
    expect(out[0].name).toBe("Famous");
  });
});
