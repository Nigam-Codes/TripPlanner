import { sqliteTable, text, integer, real, index } from "drizzle-orm/sqlite-core";

/**
 * Permanent snapshot of every place ever shown or saved. Never evicted, because
 * trips reference these rows: a shared plan must render without touching Overpass.
 */
export const places = sqliteTable("places", {
  id: text("id").primaryKey(), // "node/240109189"
  name: text("name").notNull(),
  localName: text("local_name"),
  lat: real("lat").notNull(),
  lon: real("lon").notNull(),
  category: text("category").notNull(),
  subcategory: text("subcategory"),
  tagsJson: text("tags_json").notNull().default("{}"),
  wikidata: text("wikidata"),
  wikipedia: text("wikipedia"),
  description: text("description"),
  imageUrl: text("image_url"),
  popularity: integer("popularity"),
  score: real("score").notNull().default(0),
  enrichedAt: integer("enriched_at"),
  updatedAt: integer("updated_at").notNull(),
});

export const trips = sqliteTable("trips", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  cityName: text("city_name").notNull(),
  cityLat: real("city_lat").notNull(),
  cityLon: real("city_lon").notNull(),
  radiusM: integer("radius_m").notNull().default(3000),
  defaultMode: text("default_mode").notNull().default("foot"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const tripDays = sqliteTable(
  "trip_days",
  {
    id: text("id").primaryKey(),
    tripId: text("trip_id")
      .notNull()
      .references(() => trips.id, { onDelete: "cascade" }),
    dayIndex: integer("day_index").notNull(),
    date: text("date"),
    title: text("title"),
    startTime: text("start_time").notNull().default("09:00"),
  },
  (t) => [index("trip_days_trip_idx").on(t.tripId)],
);

export const stops = sqliteTable(
  "stops",
  {
    id: text("id").primaryKey(),
    dayId: text("day_id")
      .notNull()
      .references(() => tripDays.id, { onDelete: "cascade" }),
    placeId: text("place_id")
      .notNull()
      .references(() => places.id),
    orderIndex: integer("order_index").notNull(),
    dwellMinutes: integer("dwell_minutes").notNull().default(45),
    note: text("note"),
    modeOverride: text("mode_override"),
  },
  (t) => [index("stops_day_idx").on(t.dayId)],
);

export const shares = sqliteTable(
  "shares",
  {
    token: text("token").primaryKey(),
    tripId: text("trip_id")
      .notNull()
      .references(() => trips.id, { onDelete: "cascade" }),
    createdAt: integer("created_at").notNull(),
    revokedAt: integer("revoked_at"),
    viewCount: integer("view_count").notNull().default(0),
  },
  (t) => [index("shares_trip_idx").on(t.tripId)],
);

/** Persisted legs, so a shared plan renders offline and re-renders instantly. */
export const routeCache = sqliteTable("route_cache", {
  key: text("key").primaryKey(), // "mode:fromLat,fromLon>toLat,toLon" rounded to 5dp
  durationSec: real("duration_sec").notNull(),
  distanceM: real("distance_m").notNull(),
  geometryJson: text("geometry_json"),
  fetchedAt: integer("fetched_at").notNull(),
});

/** Generic TTL cache for geocode / Overpass / Wikipedia responses. */
export const apiCache = sqliteTable("api_cache", {
  key: text("key").primaryKey(),
  payloadJson: text("payload_json").notNull(),
  fetchedAt: integer("fetched_at").notNull(),
  expiresAt: integer("expires_at").notNull(),
});
