import type { LineString } from "geojson";
export type Mode = "foot" | "bike" | "car";

export const MODES: Mode[] = ["foot", "bike", "car"];

export const MODE_LABEL: Record<Mode, string> = {
  foot: "Walking",
  bike: "Cycling",
  car: "Driving",
};

export interface LatLon {
  lat: number;
  lon: number;
}

export interface GeocodeResult {
  name: string;
  displayName: string;
  lat: number;
  lon: number;
  bbox: [number, number, number, number] | null; // [south, north, west, east]
  type: string;
}

export interface Place {
  id: string; // "node/240109189"
  name: string;
  localName: string | null;
  lat: number;
  lon: number;
  category: string;
  subcategory: string | null;
  tags: Record<string, string>;
  wikidata: string | null;
  wikipedia: string | null;
  description: string | null;
  imageUrl: string | null;
  popularity: number | null;
  score: number;
  /** Metres from the search centre. Computed per-query, not persisted. */
  distance?: number;
}

export interface Leg {
  durationSec: number;
  distanceM: number;
  geometry: LineString | null;
  mode: Mode;
}

export interface ScheduledStop {
  stopId: string;
  place: Place;
  order: number;
  dwellMinutes: number;
  mode: Mode;
  /** Leg travelled to reach this stop; null for the first stop of a day. */
  legFromPrevious: Leg | null;
  arrival: string; // "HH:MM"
  departure: string; // "HH:MM"
  closedWarning: string | null;
}

export interface ScheduledDay {
  dayId: string;
  dayIndex: number;
  title: string | null;
  date: string | null;
  startTime: string;
  stops: ScheduledStop[];
  totalTravelSec: number;
  totalDwellMin: number;
  totalDistanceM: number;
  endTime: string;
}

export interface TripSummary {
  id: string;
  title: string;
  cityName: string;
  cityLat: number;
  cityLon: number;
  radiusM: number;
  defaultMode: Mode;
}

export interface PlannedTrip {
  trip: TripSummary;
  days: ScheduledDay[];
}
