/**
 * The touristy-spot taxonomy. Each category owns a set of OSM tag matchers used
 * both to BUILD the Overpass query and to CLASSIFY the results it returns, so the
 * two can never drift apart.
 */
export interface CategoryDef {
  id: string;
  label: string;
  color: string;
  /** Default minutes a visitor spends here, used to seed the schedule. */
  dwellMinutes: number;
  /** OSM key -> allowed values. `true` means "any value for this key". */
  match: Record<string, string[] | true>;
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
  },
  {
    id: "religious",
    label: "Religious sites",
    color: "#0891b2",
    dwellMinutes: 30,
    match: { amenity: ["place_of_worship"] },
  },
  {
    id: "nature",
    label: "Parks & nature",
    color: "#16a34a",
    dwellMinutes: 45,
    match: {
      leisure: ["park", "garden", "nature_reserve"],
      natural: ["beach", "peak", "waterfall"],
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
];

export const CATEGORY_IDS = CATEGORIES.map((c) => c.id);

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

/**
 * Classify raw OSM tags into a category. Order follows CATEGORIES, so the more
 * specific definitions (museum) win over the broad catch-alls (historic).
 */
export function classify(tags: Record<string, string>): { category: string; subcategory: string | null } | null {
  for (const cat of CATEGORIES) {
    for (const [key, values] of Object.entries(cat.match)) {
      const actual = tags[key];
      if (!actual) continue;
      if (values === true || values.includes(actual)) {
        return { category: cat.id, subcategory: actual };
      }
    }
  }
  return null;
}
