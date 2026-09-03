import { describe, expect, it } from "vitest";
import { optimizeOrder, pathCost } from "../optimize";
import { buildSchedule, openingWarning } from "../schedule";
import { haversine, clockToMinutes, minutesToClock } from "../geo";
import type { Leg, Place } from "../types";

/* ------------------------------------------------------------------ helpers */

function place(over: Partial<Place> = {}): Place {
  return {
    id: "node/1",
    name: "Stop",
    localName: null,
    lat: 35.0,
    lon: 135.0,
    category: "museum",
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

const leg = (minutes: number): Leg => ({
  durationSec: minutes * 60,
  distanceM: minutes * 80,
  geometry: null,
  mode: "foot",
});

/** Symmetric matrix from 1-D positions, so the optimum is a simple sweep. */
const lineMatrix = (positions: number[]) =>
  positions.map((a) => positions.map((b) => Math.abs(a - b)));

/* ----------------------------------------------------------------- optimize */

describe("optimizeOrder", () => {
  it("straightens a zig-zag into a sweep", () => {
    const m = lineMatrix([0, 3, 1, 4, 2]);
    const order = optimizeOrder(m);
    expect(pathCost(order, m)).toBe(4); // 0 -> 1 -> 2 -> 3 -> 4
  });

  it("is never worse than the order it was given", () => {
    // Random matrices; the guarantee must hold for every one of them.
    for (let trial = 0; trial < 40; trial++) {
      const n = 3 + (trial % 6);
      const pts = Array.from({ length: n }, () => [Math.random() * 10, Math.random() * 10]);
      const m = pts.map((a) => pts.map((b) => Math.hypot(a[0] - b[0], a[1] - b[1])));
      const identity = pts.map((_, i) => i);
      expect(pathCost(optimizeOrder(m), m)).toBeLessThanOrEqual(pathCost(identity, m) + 1e-9);
    }
  });

  it("returns a permutation containing every stop exactly once", () => {
    const m = lineMatrix([5, 1, 9, 3, 7, 2]);
    expect([...optimizeOrder(m)].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("keeps the first stop pinned when asked", () => {
    const m = lineMatrix([9, 0, 1, 2]);
    expect(optimizeOrder(m, { pinStart: true })[0]).toBe(0);
  });

  it("keeps the last stop pinned when asked", () => {
    const m = lineMatrix([0, 5, 1, 2]);
    const order = optimizeOrder(m, { pinEnd: true });
    expect(order[order.length - 1]).toBe(3);
    expect([...order].sort((a, b) => a - b)).toEqual([0, 1, 2, 3]);
  });

  it("handles degenerate sizes without throwing", () => {
    expect(optimizeOrder([])).toEqual([]);
    expect(optimizeOrder([[0]])).toEqual([0]);
    expect(optimizeOrder(lineMatrix([1, 0]))).toEqual([0, 1]);
  });
});

/* ----------------------------------------------------------------- schedule */

describe("buildSchedule", () => {
  const base = {
    dayId: "d1",
    dayIndex: 0,
    title: "Day 1",
    date: "2026-09-02",
    startTime: "09:00",
  };

  it("accumulates travel and dwell into wall-clock times", () => {
    const day = buildSchedule({
      ...base,
      stops: [
        { stopId: "a", place: place({ id: "a" }), dwellMinutes: 30, mode: "foot", legFromPrevious: null },
        { stopId: "b", place: place({ id: "b" }), dwellMinutes: 45, mode: "foot", legFromPrevious: leg(15) },
        { stopId: "c", place: place({ id: "c" }), dwellMinutes: 20, mode: "foot", legFromPrevious: leg(10) },
      ],
    });

    expect(day.stops.map((s) => [s.arrival, s.departure])).toEqual([
      ["09:00", "09:30"], // start, 30m dwell
      ["09:45", "10:30"], // +15m travel, 45m dwell
      ["10:40", "11:00"], // +10m travel, 20m dwell
    ]);
    expect(day.endTime).toBe("11:00");
    expect(day.totalTravelSec).toBe(25 * 60);
    expect(day.totalDwellMin).toBe(95);
  });

  it("never counts a leg for the first stop", () => {
    const day = buildSchedule({
      ...base,
      stops: [
        { stopId: "a", place: place(), dwellMinutes: 10, mode: "foot", legFromPrevious: null },
      ],
    });
    expect(day.totalTravelSec).toBe(0);
    expect(day.stops[0].arrival).toBe("09:00");
  });

  it("copes with an empty day", () => {
    const day = buildSchedule({ ...base, stops: [] });
    expect(day.stops).toEqual([]);
    expect(day.endTime).toBe("09:00");
  });
});

describe("openingWarning", () => {
  // 2026-09-02 is a Wednesday.
  const wed = (hhmm: string) => new Date(`2026-09-02T${hhmm}:00`);

  it("stays silent when the place is open", () => {
    expect(openingWarning(place({ tags: { opening_hours: "We 10:00-18:00" } }), wed("10:09"))).toBeNull();
  });

  it("flags arriving before opening on the same day", () => {
    expect(openingWarning(place({ tags: { opening_hours: "We 10:00-18:00" } }), wed("09:30"))).toBe(
      "Closed on arrival — opens 10:00",
    );
  });

  it("says which day it reopens when shut for the whole weekday", () => {
    // Regression: reporting a bare "opens 10:00" for a 10:09 arrival read as a
    // contradiction, because the next opening was actually the following day.
    expect(openingWarning(place({ tags: { opening_hours: "Th-Tu 10:00-18:00" } }), wed("10:09"))).toBe(
      "Closed this day — next opens Thu 10:00",
    );
  });

  it("never throws on malformed or missing opening_hours", () => {
    expect(openingWarning(place({ tags: { opening_hours: "nonsense ~~ !!" } }), wed("10:00"))).toBeNull();
    expect(openingWarning(place({ tags: {} }), wed("10:00"))).toBeNull();
  });
});

/* ---------------------------------------------------------------------- geo */

describe("geo helpers", () => {
  it("measures a known distance", () => {
    // Kyoto Station to Kyoto Tower is roughly 300 m.
    const d = haversine({ lat: 34.9858, lon: 135.7588 }, { lat: 34.9876, lon: 135.7595 });
    expect(d).toBeGreaterThan(150);
    expect(d).toBeLessThan(400);
  });

  it("round-trips clock strings", () => {
    for (const t of ["00:00", "09:05", "13:37", "23:59"]) {
      expect(minutesToClock(clockToMinutes(t))).toBe(t);
    }
  });

  it("wraps past midnight rather than overflowing", () => {
    expect(minutesToClock(25 * 60)).toBe("01:00");
  });
});
