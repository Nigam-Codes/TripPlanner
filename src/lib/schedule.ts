import OpeningHours from "opening_hours";
import { clockToMinutes, minutesToClock } from "./geo";
import type { Leg, Place, ScheduledDay, ScheduledStop } from "./types";

export interface ScheduleInput {
  dayId: string;
  dayIndex: number;
  title: string | null;
  date: string | null;
  startTime: string;
  stops: {
    stopId: string;
    place: Place;
    dwellMinutes: number;
    mode: Leg["mode"];
    /** Leg travelled to reach this stop; null for the first stop. */
    legFromPrevious: Leg | null;
  }[];
}

/**
 * Check a planned arrival against the place's OSM opening_hours.
 *
 * OSM opening_hours syntax is large and frequently malformed, and the parser
 * throws on values it cannot read. An unparseable value must never break the
 * itinerary, so failures fall through to "no warning".
 */
export function openingWarning(
  place: Place,
  when: Date,
): string | null {
  const spec = place.tags?.opening_hours;
  if (!spec) return null;
  try {
    const oh = new OpeningHours(spec);
    if (oh.getState(when)) return null;

    const next = oh.getNextChange(when);
    if (!next) return "Closed at this time";

    const hh = String(next.getHours()).padStart(2, "0");
    const mm = String(next.getMinutes()).padStart(2, "0");

    // Distinguish "you are early today" from "shut on this weekday entirely".
    // Reporting a bare time for a next-day reopening reads as a contradiction
    // when the arrival time is already past it.
    const sameDay = next.toDateString() === when.toDateString();
    if (sameDay) return `Closed on arrival — opens ${hh}:${mm}`;

    const weekday = next.toLocaleDateString("en", { weekday: "short" });
    const soon = next.getTime() - when.getTime() < 7 * 24 * 3600 * 1000;
    return soon
      ? `Closed this day — next opens ${weekday} ${hh}:${mm}`
      : "Closed at this time";
  } catch {
    return null;
  }
}

function dayDate(date: string | null): Date {
  const d = date ? new Date(`${date}T00:00:00`) : new Date();
  return Number.isNaN(d.getTime()) ? new Date() : d;
}

/**
 * Walk a day start-to-finish, accumulating travel and dwell into wall-clock
 * arrival and departure times.
 */
export function buildSchedule(input: ScheduleInput): ScheduledDay {
  const base = dayDate(input.date);
  let cursor = clockToMinutes(input.startTime);

  let totalTravelSec = 0;
  let totalDwellMin = 0;
  let totalDistanceM = 0;

  const stops: ScheduledStop[] = input.stops.map((s, i) => {
    if (s.legFromPrevious) {
      cursor += s.legFromPrevious.durationSec / 60;
      totalTravelSec += s.legFromPrevious.durationSec;
      totalDistanceM += s.legFromPrevious.distanceM;
    }

    const arrivalMin = cursor;
    cursor += s.dwellMinutes;
    totalDwellMin += s.dwellMinutes;

    const arrivalDate = new Date(base);
    arrivalDate.setHours(0, Math.round(arrivalMin), 0, 0);

    return {
      stopId: s.stopId,
      place: s.place,
      order: i,
      dwellMinutes: s.dwellMinutes,
      mode: s.mode,
      legFromPrevious: s.legFromPrevious,
      arrival: minutesToClock(arrivalMin),
      departure: minutesToClock(cursor),
      closedWarning: openingWarning(s.place, arrivalDate),
    };
  });

  return {
    dayId: input.dayId,
    dayIndex: input.dayIndex,
    title: input.title,
    date: input.date,
    startTime: input.startTime,
    stops,
    totalTravelSec,
    totalDwellMin,
    totalDistanceM,
    endTime: minutesToClock(cursor),
  };
}
