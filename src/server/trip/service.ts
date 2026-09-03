import "server-only";
import { and, asc, eq, inArray } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "../db/client";
import { places, shares, stops, tripDays, trips } from "../db/schema";
import { getLegs, getMatrix } from "../routing";
import { buildSchedule } from "@/lib/schedule";
import { optimizeOrder } from "@/lib/optimize";
import { defaultDwell } from "@/lib/categories";
import type { Mode, Place, PlannedTrip, ScheduledDay, TripSummary } from "@/lib/types";

const MODES = new Set<Mode>(["foot", "bike", "car"]);

const asMode = (v: string | null | undefined, fallback: Mode = "foot"): Mode =>
  v && MODES.has(v as Mode) ? (v as Mode) : fallback;

type PlaceRow = typeof places.$inferSelect;

function rowToPlace(r: PlaceRow): Place {
  return {
    id: r.id,
    name: r.name,
    localName: r.localName,
    lat: r.lat,
    lon: r.lon,
    category: r.category,
    subcategory: r.subcategory,
    tags: JSON.parse(r.tagsJson) as Record<string, string>,
    wikidata: r.wikidata,
    wikipedia: r.wikipedia,
    description: r.description,
    imageUrl: r.imageUrl,
    popularity: r.popularity,
    score: r.score,
  };
}

/**
 * Persist a place permanently. Stops reference these rows, so a shared plan can
 * render later without re-querying Overpass.
 */
export function upsertPlace(p: Place): void {
  const row = {
    id: p.id,
    name: p.name,
    localName: p.localName ?? null,
    lat: p.lat,
    lon: p.lon,
    category: p.category,
    subcategory: p.subcategory ?? null,
    tagsJson: JSON.stringify(p.tags ?? {}),
    wikidata: p.wikidata ?? null,
    wikipedia: p.wikipedia ?? null,
    description: p.description ?? null,
    imageUrl: p.imageUrl ?? null,
    popularity: p.popularity ?? null,
    score: p.score ?? 0,
    enrichedAt: p.description ? Date.now() : null,
    updatedAt: Date.now(),
  };
  db.insert(places).values(row).onConflictDoUpdate({ target: places.id, set: row }).run();
}

export function createTrip(input: {
  title?: string;
  cityName: string;
  cityLat: number;
  cityLon: number;
  radiusM?: number;
}): string {
  const id = nanoid(12);
  const now = Date.now();

  db.insert(trips)
    .values({
      id,
      title: input.title ?? `Trip to ${input.cityName}`,
      cityName: input.cityName,
      cityLat: input.cityLat,
      cityLon: input.cityLon,
      radiusM: input.radiusM ?? 3000,
      defaultMode: "foot",
      createdAt: now,
      updatedAt: now,
    })
    .run();

  db.insert(tripDays)
    .values({ id: nanoid(12), tripId: id, dayIndex: 0, title: "Day 1", startTime: "09:00" })
    .run();

  return id;
}

export function getTripSummary(tripId: string): TripSummary | null {
  const t = db.select().from(trips).where(eq(trips.id, tripId)).get();
  if (!t) return null;
  return {
    id: t.id,
    title: t.title,
    cityName: t.cityName,
    cityLat: t.cityLat,
    cityLon: t.cityLon,
    radiusM: t.radiusM,
    defaultMode: asMode(t.defaultMode),
  };
}

export function updateTrip(
  tripId: string,
  patch: Partial<{ title: string; radiusM: number; defaultMode: Mode }>,
): void {
  db.update(trips)
    .set({ ...patch, updatedAt: Date.now() })
    .where(eq(trips.id, tripId))
    .run();
}

export function deleteTrip(tripId: string): void {
  db.delete(trips).where(eq(trips.id, tripId)).run();
}

export function listTrips(): (TripSummary & { stopCount: number; updatedAt: number })[] {
  const rows = db.select().from(trips).all();

  return rows
    .map((t) => {
      const dayIds = db
        .select({ id: tripDays.id })
        .from(tripDays)
        .where(eq(tripDays.tripId, t.id))
        .all()
        .map((d) => d.id);

      const stopCount = dayIds.length
        ? db.select().from(stops).where(inArray(stops.dayId, dayIds)).all().length
        : 0;

      return {
        id: t.id,
        title: t.title,
        cityName: t.cityName,
        cityLat: t.cityLat,
        cityLon: t.cityLon,
        radiusM: t.radiusM,
        defaultMode: asMode(t.defaultMode),
        stopCount,
        updatedAt: t.updatedAt,
      };
    })
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export function addDay(tripId: string): string {
  const existing = db.select().from(tripDays).where(eq(tripDays.tripId, tripId)).all();
  const id = nanoid(12);

  db.insert(tripDays)
    .values({
      id,
      tripId,
      dayIndex: existing.length,
      title: `Day ${existing.length + 1}`,
      startTime: "09:00",
    })
    .run();

  return id;
}

export function removeDay(dayId: string): void {
  db.delete(tripDays).where(eq(tripDays.id, dayId)).run();
}

export function updateDay(
  dayId: string,
  patch: Partial<{ title: string; date: string | null; startTime: string }>,
): void {
  db.update(tripDays).set(patch).where(eq(tripDays.id, dayId)).run();
}

export function addStop(dayId: string, place: Place): string {
  upsertPlace(place);

  const existing = db.select().from(stops).where(eq(stops.dayId, dayId)).all();
  const already = existing.find((s) => s.placeId === place.id);
  if (already) return already.id;

  const id = nanoid(12);
  db.insert(stops)
    .values({
      id,
      dayId,
      placeId: place.id,
      orderIndex: existing.length,
      dwellMinutes: defaultDwell(place.category),
    })
    .run();

  return id;
}

export function removeStop(stopId: string): void {
  const stop = db.select().from(stops).where(eq(stops.id, stopId)).get();
  db.delete(stops).where(eq(stops.id, stopId)).run();
  if (stop) compactOrder(stop.dayId);
}

export function updateStop(
  stopId: string,
  patch: Partial<{ dwellMinutes: number; note: string | null; modeOverride: string | null }>,
): void {
  db.update(stops).set(patch).where(eq(stops.id, stopId)).run();
}

/** Persist an explicit visiting order for one day. */
export function reorderStops(dayId: string, orderedStopIds: string[]): void {
  orderedStopIds.forEach((id, i) => {
    db.update(stops)
      .set({ orderIndex: i })
      .where(and(eq(stops.id, id), eq(stops.dayId, dayId)))
      .run();
  });
  compactOrder(dayId);
}

function compactOrder(dayId: string): void {
  const rows = db
    .select()
    .from(stops)
    .where(eq(stops.dayId, dayId))
    .orderBy(asc(stops.orderIndex))
    .all();

  rows.forEach((r, i) => {
    if (r.orderIndex !== i) {
      db.update(stops).set({ orderIndex: i }).where(eq(stops.id, r.id)).run();
    }
  });
}

interface DayWithStops {
  day: typeof tripDays.$inferSelect;
  rows: (typeof stops.$inferSelect)[];
  placeById: Map<string, Place>;
}

function loadDays(tripId: string): DayWithStops[] {
  const days = db
    .select()
    .from(tripDays)
    .where(eq(tripDays.tripId, tripId))
    .orderBy(asc(tripDays.dayIndex))
    .all();

  return days.map((day) => {
    const rows = db
      .select()
      .from(stops)
      .where(eq(stops.dayId, day.id))
      .orderBy(asc(stops.orderIndex))
      .all();

    const ids = rows.map((r) => r.placeId);
    const placeRows = ids.length
      ? db.select().from(places).where(inArray(places.id, ids)).all()
      : [];

    return { day, rows, placeById: new Map(placeRows.map((p) => [p.id, rowToPlace(p)])) };
  });
}

/**
 * Build the full plan: resolve every stop, route the legs, and lay each day out
 * on a clock. Legs come from the persisted cache when available, so re-rendering
 * an unchanged trip costs no network calls at all.
 */
export async function planTrip(tripId: string): Promise<PlannedTrip | null> {
  const trip = getTripSummary(tripId);
  if (!trip) return null;

  const days: ScheduledDay[] = [];

  for (const { day, rows, placeById } of loadDays(tripId)) {
    const resolved = rows.flatMap((row) => {
      const place = placeById.get(row.placeId);
      return place ? [{ row, place }] : [];
    });

    const dayMode = asMode(resolved[0]?.row.modeOverride, trip.defaultMode);
    const legs = await getLegs(
      resolved.map((r) => ({ lat: r.place.lat, lon: r.place.lon })),
      dayMode,
    );

    days.push(
      buildSchedule({
        dayId: day.id,
        dayIndex: day.dayIndex,
        title: day.title,
        date: day.date,
        startTime: day.startTime,
        stops: resolved.map((r, i) => ({
          stopId: r.row.id,
          place: r.place,
          dwellMinutes: r.row.dwellMinutes,
          mode: asMode(r.row.modeOverride, dayMode),
          legFromPrevious: i === 0 ? null : (legs[i - 1] ?? null),
        })),
      }),
    );
  }

  return { trip, days };
}

/** Reorder one day to minimise travel time. Returns the seconds saved. */
export async function optimizeDay(
  dayId: string,
  mode: Mode,
  opts: { pinStart?: boolean; pinEnd?: boolean } = {},
): Promise<{ savedSec: number }> {
  const rows = db
    .select()
    .from(stops)
    .where(eq(stops.dayId, dayId))
    .orderBy(asc(stops.orderIndex))
    .all();

  if (rows.length < 3) return { savedSec: 0 };

  const placeRows = db
    .select()
    .from(places)
    .where(
      inArray(
        places.id,
        rows.map((r) => r.placeId),
      ),
    )
    .all();

  const byId = new Map(placeRows.map((p) => [p.id, p]));
  const resolved = rows.flatMap((r) => {
    const p = byId.get(r.placeId);
    return p ? [{ row: r, place: p }] : [];
  });
  if (resolved.length !== rows.length) return { savedSec: 0 };

  const matrix = await getMatrix(
    resolved.map((r) => ({ lat: r.place.lat, lon: r.place.lon })),
    mode,
  );

  const order = optimizeOrder(matrix, opts);

  const costOf = (seq: number[]) =>
    seq.slice(1).reduce((acc, node, i) => acc + matrix[seq[i]][node], 0);

  const before = costOf(rows.map((_, i) => i));
  const after = costOf(order);

  reorderStops(
    dayId,
    order.map((i) => rows[i].id),
  );

  return { savedSec: Math.max(0, Math.round(before - after)) };
}

export function createShare(tripId: string): string {
  const active = db
    .select()
    .from(shares)
    .where(eq(shares.tripId, tripId))
    .all()
    .find((s) => !s.revokedAt);
  if (active) return active.token;

  const token = nanoid(22);
  db.insert(shares).values({ token, tripId, createdAt: Date.now(), viewCount: 0 }).run();
  return token;
}

export function revokeShare(tripId: string): void {
  db.update(shares).set({ revokedAt: Date.now() }).where(eq(shares.tripId, tripId)).run();
}

export function getActiveShareToken(tripId: string): string | null {
  const rows = db.select().from(shares).where(eq(shares.tripId, tripId)).all();
  return rows.find((s) => !s.revokedAt)?.token ?? null;
}

export function shareStats(tripId: string): { token: string; viewCount: number } | null {
  const rows = db.select().from(shares).where(eq(shares.tripId, tripId)).all();
  const active = rows.find((s) => !s.revokedAt);
  return active ? { token: active.token, viewCount: active.viewCount } : null;
}

/**
 * Resolve a share token to a rendered plan. Read-only by construction: this is
 * the only entry point the public page uses, and it exposes no mutation.
 */
export async function getSharedPlan(
  token: string,
  opts: { countView?: boolean } = {},
): Promise<PlannedTrip | null> {
  const share = db.select().from(shares).where(eq(shares.token, token)).get();
  if (!share || share.revokedAt) return null;

  // Next calls generateMetadata and the page component separately for the same
  // request, so counting on every read would double every visit.
  if (opts.countView) {
    db.update(shares)
      .set({ viewCount: share.viewCount + 1 })
      .where(eq(shares.token, token))
      .run();
  }

  return planTrip(share.tripId);
}
