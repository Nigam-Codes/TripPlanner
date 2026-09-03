import { buildSchedule } from "@/lib/schedule";
import { optimizeOrder } from "@/lib/optimize";
import { defaultDwell } from "@/lib/categories";
import { getLegs, getMatrix } from "./providers/routing";
import type { Mode, Place, PlannedTrip, ScheduledDay, TripKind, TripSummary } from "@/lib/types";

/**
 * Trip storage, replacing the SQLite service from the server build.
 *
 * The whole database is one JSON blob in localStorage: trips are small (a few
 * kilobytes even with many stops) and always read and written together, so a
 * key-per-row scheme would buy nothing. The large data — Overpass results, routed
 * legs — lives in IndexedDB via `cache.ts` instead.
 *
 * Function signatures deliberately mirror the old server service so the components did
 * not have to change.
 */

const KEY = "trip-planner:db";
const MODES = new Set<Mode>(["foot", "bike", "car"]);

const asMode = (v: string | null | undefined, fallback: Mode = "foot"): Mode =>
  v && MODES.has(v as Mode) ? (v as Mode) : fallback;

const asKind = (v: string | null | undefined): TripKind => (v === "roadtrip" ? "roadtrip" : "city");

interface StopRow {
  id: string;
  placeId: string;
  orderIndex: number;
  dwellMinutes: number;
  note: string | null;
  modeOverride: string | null;
}

interface DayRow {
  id: string;
  dayIndex: number;
  date: string | null;
  title: string | null;
  startTime: string;
  stops: StopRow[];
}

interface TripRow {
  id: string;
  /** Absent on trips saved before road-trip mode existed; treated as "city". */
  kind?: TripKind;
  title: string;
  cityName: string;
  cityLat: number;
  cityLon: number;
  radiusM: number;
  defaultMode: string;
  createdAt: number;
  updatedAt: number;
  days: DayRow[];
}

interface Db {
  trips: TripRow[];
  /** Snapshot of every place ever added, so a trip renders without re-querying. */
  places: Record<string, Place>;
}

const EMPTY: Db = { trips: [], places: {} };

/* -------------------------------------------------------------------- storage */

function read(): Db {
  if (typeof localStorage === "undefined") return structuredClone(EMPTY);
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return structuredClone(EMPTY);
    const parsed = JSON.parse(raw) as Db;
    return { trips: parsed.trips ?? [], places: parsed.places ?? {} };
  } catch {
    // Corrupt or unreadable storage must not brick the app.
    return structuredClone(EMPTY);
  }
}

function write(db: Db): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(KEY, JSON.stringify(db));
  } catch {
    /* private window or quota exhausted — the session still works in memory */
  }
}

/** Collision-resistant enough for ids that only ever exist in one browser. */
function id(size = 12): string {
  const bytes = new Uint8Array(size);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => "abcdefghijklmnopqrstuvwxyz0123456789"[b % 36]).join("");
}

/* ---------------------------------------------------------------------- trips */

export function createTrip(input: {
  title?: string;
  cityName: string;
  cityLat: number;
  cityLon: number;
  radiusM?: number;
  kind?: TripKind;
}): string {
  const db = read();
  const tripId = id();
  const now = Date.now();

  const kind = input.kind ?? "city";

  db.trips.push({
    id: tripId,
    kind,
    title: input.title ?? (kind === "roadtrip" ? `Road trip from ${input.cityName}` : `Trip to ${input.cityName}`),
    cityName: input.cityName,
    cityLat: input.cityLat,
    cityLon: input.cityLon,
    radiusM: input.radiusM ?? 3000,
    // A road trip is between towns, so driving is the only sensible default.
    defaultMode: kind === "roadtrip" ? "car" : "foot",
    createdAt: now,
    updatedAt: now,
    days: [{ id: id(), dayIndex: 0, date: null, title: "Day 1", startTime: "09:00", stops: [] }],
  });

  write(db);
  return tripId;
}

function findTrip(db: Db, tripId: string): TripRow | undefined {
  return db.trips.find((t) => t.id === tripId);
}

function touch(trip: TripRow): void {
  trip.updatedAt = Date.now();
}

export function getTripSummary(tripId: string): TripSummary | null {
  const t = findTrip(read(), tripId);
  if (!t) return null;
  return {
    id: t.id,
    title: t.title,
    cityName: t.cityName,
    cityLat: t.cityLat,
    cityLon: t.cityLon,
    radiusM: t.radiusM,
    defaultMode: asMode(t.defaultMode),
    kind: asKind(t.kind),
  };
}

export function updateTrip(
  tripId: string,
  patch: Partial<{ title: string; radiusM: number; defaultMode: Mode }>,
): void {
  const db = read();
  const trip = findTrip(db, tripId);
  if (!trip) return;
  Object.assign(trip, patch);
  touch(trip);
  write(db);
}

export function deleteTrip(tripId: string): void {
  const db = read();
  db.trips = db.trips.filter((t) => t.id !== tripId);
  write(db);
}

export function listTrips(): (TripSummary & { stopCount: number; updatedAt: number })[] {
  return read()
    .trips.map((t) => ({
      id: t.id,
      title: t.title,
      cityName: t.cityName,
      cityLat: t.cityLat,
      cityLon: t.cityLon,
      radiusM: t.radiusM,
      defaultMode: asMode(t.defaultMode),
      kind: asKind(t.kind),
      stopCount: t.days.reduce((n, d) => n + d.stops.length, 0),
      updatedAt: t.updatedAt,
    }))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

/**
 * Create a road trip already seeded with its first stop, so the map has somewhere to
 * point and the trip is immediately useful.
 */
export function createRoadTrip(first: Place, title?: string): string {
  const tripId = createTrip({
    kind: "roadtrip",
    title,
    cityName: first.name,
    cityLat: first.lat,
    cityLon: first.lon,
  });

  const dayId = read().trips.find((t) => t.id === tripId)!.days[0].id;
  addStop(tripId, dayId, first);
  return tripId;
}

/* ----------------------------------------------------------------------- days */

export function addDay(tripId: string): string | null {
  const db = read();
  const trip = findTrip(db, tripId);
  if (!trip) return null;

  const dayId = id();
  trip.days.push({
    id: dayId,
    dayIndex: trip.days.length,
    date: null,
    title: `Day ${trip.days.length + 1}`,
    startTime: "09:00",
    stops: [],
  });
  touch(trip);
  write(db);
  return dayId;
}

export function removeDay(tripId: string, dayId: string): void {
  const db = read();
  const trip = findTrip(db, tripId);
  if (!trip) return;

  trip.days = trip.days.filter((d) => d.id !== dayId);
  trip.days.forEach((d, i) => (d.dayIndex = i));
  touch(trip);
  write(db);
}

export function updateDay(
  tripId: string,
  dayId: string,
  patch: Partial<{ title: string; date: string | null; startTime: string }>,
): void {
  const db = read();
  const day = findTrip(db, tripId)?.days.find((d) => d.id === dayId);
  if (!day) return;
  Object.assign(day, patch);
  write(db);
}

/* ---------------------------------------------------------------------- stops */

export function addStop(tripId: string, dayId: string, place: Place): void {
  const db = read();
  const trip = findTrip(db, tripId);
  const day = trip?.days.find((d) => d.id === dayId);
  if (!trip || !day) return;

  // Snapshot the place so the trip survives cache eviction.
  db.places[place.id] = place;

  if (day.stops.some((s) => s.placeId === place.id)) {
    write(db);
    return;
  }

  day.stops.push({
    id: id(),
    placeId: place.id,
    orderIndex: day.stops.length,
    dwellMinutes: defaultDwell(place.category),
    note: null,
    modeOverride: null,
  });
  touch(trip);
  write(db);
}

export function removeStop(tripId: string, stopId: string): void {
  const db = read();
  const trip = findTrip(db, tripId);
  if (!trip) return;

  for (const day of trip.days) {
    const before = day.stops.length;
    day.stops = day.stops.filter((s) => s.id !== stopId);
    if (day.stops.length !== before) day.stops.forEach((s, i) => (s.orderIndex = i));
  }
  touch(trip);
  write(db);
}

export function updateStop(
  tripId: string,
  stopId: string,
  patch: Partial<{ dwellMinutes: number; note: string | null; modeOverride: string | null }>,
): void {
  const db = read();
  const trip = findTrip(db, tripId);
  if (!trip) return;

  for (const day of trip.days) {
    const stop = day.stops.find((s) => s.id === stopId);
    if (stop) Object.assign(stop, patch);
  }
  touch(trip);
  write(db);
}

export function reorderStops(tripId: string, dayId: string, orderedStopIds: string[]): void {
  const db = read();
  const trip = findTrip(db, tripId);
  const day = trip?.days.find((d) => d.id === dayId);
  if (!trip || !day) return;

  const byId = new Map(day.stops.map((s) => [s.id, s]));
  const reordered = orderedStopIds.flatMap((sid) => {
    const s = byId.get(sid);
    if (s) byId.delete(sid);
    return s ? [s] : [];
  });
  // Anything the caller omitted keeps its relative position at the end.
  day.stops = [...reordered, ...byId.values()];
  day.stops.forEach((s, i) => (s.orderIndex = i));

  touch(trip);
  write(db);
}

/* -------------------------------------------------------------------- planning */

/**
 * Build the full plan: resolve every stop, route the legs, and lay each day out on a
 * clock. Legs come from the IndexedDB cache when available, so re-rendering an
 * unchanged trip costs no network calls.
 */
export async function planTrip(tripId: string): Promise<PlannedTrip | null> {
  const db = read();
  const t = findTrip(db, tripId);
  if (!t) return null;

  const trip: TripSummary = {
    id: t.id,
    title: t.title,
    cityName: t.cityName,
    cityLat: t.cityLat,
    cityLon: t.cityLon,
    radiusM: t.radiusM,
    defaultMode: asMode(t.defaultMode),
    kind: asKind(t.kind),
  };

  const days: ScheduledDay[] = [];

  for (const day of [...t.days].sort((a, b) => a.dayIndex - b.dayIndex)) {
    const resolved = [...day.stops]
      .sort((a, b) => a.orderIndex - b.orderIndex)
      .flatMap((row) => {
        const place = db.places[row.placeId];
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
  tripId: string,
  dayId: string,
  mode: Mode,
  opts: { pinStart?: boolean; pinEnd?: boolean } = {},
): Promise<{ savedSec: number }> {
  const db = read();
  const day = findTrip(db, tripId)?.days.find((d) => d.id === dayId);
  if (!day || day.stops.length < 3) return { savedSec: 0 };

  const rows = [...day.stops].sort((a, b) => a.orderIndex - b.orderIndex);
  const points = rows.flatMap((r) => {
    const p = db.places[r.placeId];
    return p ? [{ lat: p.lat, lon: p.lon }] : [];
  });
  if (points.length !== rows.length) return { savedSec: 0 };

  const matrix = await getMatrix(points, mode);
  const order = optimizeOrder(matrix, opts);

  const costOf = (seq: number[]) =>
    seq.slice(1).reduce((acc, node, i) => acc + matrix[seq[i]][node], 0);

  const savedSec = Math.max(
    0,
    Math.round(costOf(rows.map((_, i) => i)) - costOf(order)),
  );

  reorderStops(tripId, dayId, order.map((i) => rows[i].id));
  return { savedSec };
}

/* ------------------------------------------------------------------- portability */

/** localStorage is not synced between devices, so offer a manual escape hatch. */
export function exportDb(): string {
  return JSON.stringify(read(), null, 2);
}

export function importDb(json: string): { trips: number } {
  const parsed = JSON.parse(json) as Db;
  if (!Array.isArray(parsed.trips)) throw new Error("Not a Trip Planner export");

  const db = read();
  const existing = new Set(db.trips.map((t) => t.id));
  const incoming = parsed.trips.filter((t) => !existing.has(t.id));

  db.trips.push(...incoming);
  Object.assign(db.places, parsed.places ?? {});
  write(db);

  return { trips: incoming.length };
}
