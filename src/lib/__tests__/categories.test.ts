import { describe, expect, it } from "vitest";
import {
  CATEGORIES,
  DISCOVERABLE_CATEGORIES,
  classify,
  defaultDwell,
} from "../categories";
import { buildOverpassQuery } from "../osm";
import { featureLabel } from "@/client/providers/placeSearch";

/**
 * The class/type pairs below are what Nominatim actually returned for these queries,
 * captured live rather than guessed — they are the reason the label-only matchers exist.
 */
const REAL_NOMINATIM_RESULTS: [name: string, cls: string, type: string, expected: string][] = [
  ["Yosemite National Park", "leisure", "nature_reserve", "nature"],
  ["Cuyahoga Valley National Park", "leisure", "park", "nature"],
  ["Lake Tahoe", "water", "lake", "water"],
  ["Niagara Falls", "waterway", "waterfall", "water"],
  ["Angels Landing", "natural", "peak", "nature"],
  ["Appalachian Trail", "highway", "path", "trail"],
  ["Golden Gate Bridge", "man_made", "bridge", "structure"],
  ["Lisbon", "boundary", "administrative", "place"],
  ["Évora", "place", "city", "place"],
];

describe("classify", () => {
  it.each(REAL_NOMINATIM_RESULTS)(
    "labels %s (%s=%s) as %s",
    (_name, cls, type, expected) => {
      expect(classify({ [cls]: type })?.category).toBe(expected);
    },
  );

  it("returns null for things that are not destinations", () => {
    expect(classify({ highway: "bus_stop" })).toBeNull();
    expect(classify({ amenity: "atm" })).toBeNull();
    expect(classify({})).toBeNull();
  });

  it("prefers a discoverable match over a label-only one", () => {
    // A national park mapped as both a park and a protected area is still a park,
    // not something the label-only boundary rule gets to claim.
    const tags = { leisure: "park", boundary: "protected_area" };
    expect(classify(tags)?.subcategory).toBe("park");
  });

  it("gives long-visit categories a longer default dwell than a quick stop", () => {
    expect(defaultDwell("trail")).toBeGreaterThan(defaultDwell("structure"));
    expect(defaultDwell("place")).toBeGreaterThan(defaultDwell("religious"));
  });
});

describe("discovery vs labelling", () => {
  it("never lets a label-only category into the Overpass query", () => {
    const all = CATEGORIES.map((c) => c.id);
    const q = buildOverpassQuery(38.7, -9.1, 3000, all);

    // These would each match millions of features across a city.
    for (const key of ["highway", "place", "boundary", "building", "man_made"]) {
      expect(q).not.toContain(`"${key}"`);
    }
  });

  it("excludes label-only categories from the discovery filters", () => {
    const ids = DISCOVERABLE_CATEGORIES.map((c) => c.id);
    expect(ids).not.toContain("trail");
    expect(ids).not.toContain("place");
    expect(ids).not.toContain("structure");
    expect(ids).toContain("nature");
  });

  it("still queries the water features that are worth discovering", () => {
    expect(buildOverpassQuery(38.7, -9.1, 3000, ["water"])).toContain("waterfall");
  });
});

describe("featureLabel", () => {
  it("names the types a road-tripper actually searches for", () => {
    expect(featureLabel("boundary", "national_park")).toBe("National park");
    expect(featureLabel("leisure", "nature_reserve")).toBe("Nature reserve");
    expect(featureLabel("highway", "path")).toBe("Trail");
    expect(featureLabel("man_made", "bridge")).toBe("Bridge");
  });

  it("humanises anything it has no special name for", () => {
    expect(featureLabel("natural", "hot_spring")).toBe("Hot spring");
    expect(featureLabel("water", "lake")).toBe("Lake");
  });

  it("falls back rather than throwing on a missing type", () => {
    expect(featureLabel(undefined, undefined)).toBe("Place");
  });
});
