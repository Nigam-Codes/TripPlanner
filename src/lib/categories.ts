/**
 * The touristy-spot taxonomy.
 *
 * `match` does double duty: it BUILDS the Overpass query and CLASSIFIES the results,
 * so the two can never drift apart.
 *
 * `classifyAlso` is label-only. Name search (Nominatim) returns feature classes that
 * would be ruinous to query by radius — `highway=path` would drag in every footpath,
 * `place=city` every hamlet — but which must still be labelled correctly when the user
 * names one explicitly. Keeping them out of `match` is what lets road-trip search
 * understand lakes, trails and bridges without bloating city discovery.
 */
export interface CategoryDef {
  id: string;
  label: string;
  color: string;
  /** Default minutes a visitor spends here, used to seed the schedule. */
  dwellMinutes: number;
  /** OSM key -> allowed values. `true` means "any value for this key". */
  match: Record<string, string[] | true>;
  /** Label-only matchers. Never contribute Overpass clauses. */
  classifyAlso?: Record<string, string[] | true>;
  /** false = not offered as a radius-discovery filter. Defaults to true. */
  discoverable?: boolean;
}

export const CATEGORIES: CategoryDef[] = [
  {
    id: "landmark",
    label: "Landmarks",
    color: "#e11d48",
    dwellMinutes: 45,
    match: { tourism: ["attraction", "viewpoint", "artwork"] },
  },
  {
    id: "museum",
    label: "Museums & galleries",
    color: "#7c3aed",
    dwellMinutes: 90,
    match: { tourism: ["museum", "gallery"] },
  },
  {
    id: "historic",
    label: "Historic sites",
    color: "#b45309",
    dwellMinutes: 45,
    match: {
      historic: [
        "castle", "palace", "monument", "memorial", "ruins", "fort", "city_gate",
        "archaeological_site", "tower", "manor", "aqueduct", "citywalls", "shrine",
      ],
    },
    classifyAlso: {
      building: ["castle", "palace", "cathedral", "chapel", "monastery"],
    },
  },
  {
    id: "religious",
    label: "Religious sites",
    color: "#0891b2",
    dwellMinutes: 30,
    match: { amenity: ["place_of_worship"] },
    classifyAlso: { building: ["church", "mosque", "temple", "synagogue"] },
  },
  {
    id: "nature",
    label: "Parks & nature",
    color: "#16a34a",
    dwellMinutes: 60,
    match: {
      leisure: ["park", "garden", "nature_reserve"],
      natural: ["beach", "peak", "volcano", "cliff", "cave_entrance", "glacier"],
    },
    classifyAlso: {
      // A named national park arrives as a boundary relation, not a leisure area.
      boundary: ["national_park", "protected_area"],
      landuse: ["forest", "meadow"],
      natural: ["wood", "valley", "ridge", "dune", "geyser", "hot_spring", "arch"],
      place: ["island", "islet"],
    },
  },
  {
    id: "water",
    label: "Lakes & waterways",
    color: "#0284c7",
    dwellMinutes: 45,
    match: { natural: ["waterfall", "spring"] },
    classifyAlso: {
      // Nominatim reports a lake as class "water", not "natural".
      water: ["lake", "reservoir", "pond", "lagoon", "oxbow"],
      waterway: ["waterfall", "river", "stream", "canal", "riverbank"],
      natural: ["water", "bay", "strait", "hot_spring"],
    },
  },
  {
    id: "trail",
    label: "Trails & hikes",
    color: "#65a30d",
    dwellMinutes: 180,
    // Never radius-queried: every pavement in a city is a highway=footway.
    discoverable: false,
    match: {},
    classifyAlso: {
      highway: ["path", "footway", "bridleway", "track", "steps"],
      route: ["hiking", "foot", "bicycle", "mtb"],
    },
  },
  {
    id: "structure",
    label: "Bridges & structures",
    color: "#475569",
    dwellMinutes: 30,
    discoverable: false,
    match: {},
    classifyAlso: {
      man_made: [
        "bridge", "tower", "lighthouse", "obelisk", "windmill", "watermill",
        "pier", "water_tower", "observatory", "communications_tower",
      ],
      building: ["stadium", "train_station"],
      aeroway: ["terminal"],
      bridge: true,
    },
  },
  {
    id: "entertainment",
    label: "Entertainment",
    color: "#db2777",
    dwellMinutes: 120,
    match: {
      tourism: ["zoo", "theme_park", "aquarium"],
      amenity: ["theatre"],
    },
  },
  {
    id: "market",
    label: "Markets",
    color: "#ca8a04",
    dwellMinutes: 45,
    match: { amenity: ["marketplace"] },
  },
  {
    id: "place",
    label: "Towns & cities",
    color: "#334155",
    dwellMinutes: 120,
    discoverable: false,
    match: {},
    classifyAlso: {
      place: ["city", "town", "village", "hamlet", "suburb", "borough", "quarter"],
      boundary: ["administrative"],
    },
  },
];

/** Categories offered as radius-discovery filters. */
export const DISCOVERABLE_CATEGORIES = CATEGORIES.filter((c) => c.discoverable !== false);

export const CATEGORY_IDS = DISCOVERABLE_CATEGORIES.map((c) => c.id);

const BY_ID = new Map(CATEGORIES.map((c) => [c.id, c]));

export function getCategory(id: string): CategoryDef | undefined {
  return BY_ID.get(id);
}

export function categoryColor(id: string): string {
  return BY_ID.get(id)?.color ?? "#64748b";
}

export function categoryLabel(id: string): string {
  return BY_ID.get(id)?.label ?? "Other";
}

export function defaultDwell(categoryId: string): number {
  return BY_ID.get(categoryId)?.dwellMinutes ?? 45;
}

function matches(
  tags: Record<string, string>,
  table: Record<string, string[] | true> | undefined,
): { subcategory: string | null } | null {
  if (!table) return null;

  for (const [key, values] of Object.entries(table)) {
    const actual = tags[key];
    if (!actual) continue;
    if (values === true || values.includes(actual)) return { subcategory: actual };
  }
  return null;
}

/**
 * Classify raw OSM tags into a category.
 *
 * Every category's `match` is tried before any `classifyAlso`, so a feature that is
 * genuinely discoverable is never mislabelled by a broad label-only rule — a park
 * tagged both `leisure=park` and `boundary=protected_area` stays a park.
 */
export function classify(
  tags: Record<string, string>,
): { category: string; subcategory: string | null } | null {
  for (const cat of CATEGORIES) {
    const hit = matches(tags, cat.match);
    if (hit) return { category: cat.id, subcategory: hit.subcategory };
  }
  for (const cat of CATEGORIES) {
    const hit = matches(tags, cat.classifyAlso);
    if (hit) return { category: cat.id, subcategory: hit.subcategory };
  }
  return null;
}
