import { describe, expect, it } from "vitest";
import { encodePlan, decodePlan } from "../share";
import type { Leg, Place, PlannedTrip, ScheduledDay } from "@/lib/types";

function place(over: Partial<Place> = {}): Place {
  return {
    id: "node/1",
    name: "Heian Shrine",
    localName: null,
    lat: 35.01601,
    lon: 135.78249,
    category: "religious",
    subcategory: "place_of_worship",
    tags: { opening_hours: "Mo-Su 06:00-18:00" },
    wikidata: "Q1132612",
    wikipedia: "en:Heian Shrine",
    description: "A Shinto shrine in Kyoto.",
    imageUrl: "https://upload.wikimedia.org/x.jpg",
    popularity: 27,
    score: 9.5,
    ...over,
  };
}

const leg: Leg = { durationSec: 540, distanceM: 656, geometry: null, mode: "foot" };

function day(stops: Place[], over: Partial<ScheduledDay> = {}): ScheduledDay {
  return {
    dayId: "d1",
    dayIndex: 0,
    title: "Day 1",
    date: null,
    startTime: "09:00",
    stops: stops.map((p, i) => ({
      stopId: `s${i}`,
      place: p,
      order: i,
      dwellMinutes: 30 + i * 15,
      mode: "foot" as const,
      legFromPrevious: i === 0 ? null : leg,
      arrival: "09:00",
      departure: "09:30",
      closedWarning: null,
      dayOffset: 0,
    })),
    totalTravelSec: 0,
    totalDwellMin: 0,
    totalDistanceM: 0,
    endTime: "12:00",
    endDayOffset: 0,
    ...over,
  };
}

function plan(days: ScheduledDay[], kind: "city" | "roadtrip" = "city"): PlannedTrip {
  return {
    trip: {
      kind,
      id: "t1",
      title: "Trip to Kyoto",
      cityName: "Kyoto",
      cityLat: 35.0116,
      cityLon: 135.7681,
      radiusM: 1500,
      defaultMode: "foot",
    },
    days,
  };
}

describe("share link round-trip", () => {
  it("preserves the trip and its stops", async () => {
    const original = plan([day([place(), place({ id: "way/2", name: "Yasaka Shrine" })])]);
    const decoded = await decodePlan(await encodePlan(original));

    expect(decoded).not.toBeNull();
    expect(decoded!.title).toBe("Trip to Kyoto");
    expect(decoded!.cityName).toBe("Kyoto");
    expect(decoded!.mode).toBe("foot");
    expect(decoded!.days).toHaveLength(1);

    const stops = decoded!.days[0].stops;
    expect(stops.map((s) => s.place.name)).toEqual(["Heian Shrine", "Yasaka Shrine"]);
    expect(stops.map((s) => s.dwellMinutes)).toEqual([30, 45]);
    expect(stops[0].place.wikidata).toBe("Q1132612");
  });

  it("keeps coordinates accurate to about a metre", async () => {
    const decoded = await decodePlan(await encodePlan(plan([day([place()])])));
    const p = decoded!.days[0].stops[0].place;
    expect(p.lat).toBeCloseTo(35.01601, 4);
    expect(p.lon).toBeCloseTo(135.78249, 4);
  });

  it("survives unicode names", async () => {
    const original = plan([
      day([place({ name: "崇徳天皇御廟", localName: "崇徳天皇御廟" })]),
    ]);
    const decoded = await decodePlan(await encodePlan(original));
    expect(decoded!.days[0].stops[0].place.name).toBe("崇徳天皇御廟");
  });

  it("round-trips a localName distinct from the English name", async () => {
    const original = plan([day([place({ name: "Kiyomizu-dera", localName: "清水寺" })])]);
    const decoded = await decodePlan(await encodePlan(original));
    expect(decoded!.days[0].stops[0].place.localName).toBe("清水寺");
  });

  it("handles an empty day and a trip with no days", async () => {
    expect((await decodePlan(await encodePlan(plan([day([])]))))!.days[0].stops).toEqual([]);
    expect((await decodePlan(await encodePlan(plan([]))))!.days).toEqual([]);
  });

  it("preserves multiple days independently", async () => {
    const original = plan([
      day([place()], { dayId: "d1", dayIndex: 0, title: "Day 1", startTime: "09:00" }),
      day([place({ id: "node/9", name: "Nijo Castle" })], {
        dayId: "d2",
        dayIndex: 1,
        title: "Day 2",
        startTime: "10:30",
      }),
    ]);
    const decoded = await decodePlan(await encodePlan(original));
    expect(decoded!.days.map((d) => d.startTime)).toEqual(["09:00", "10:30"]);
    expect(decoded!.days[1].stops[0].place.name).toBe("Nijo Castle");
  });

  it("carries the trip kind, defaulting old links to city", async () => {
    const road = await decodePlan(await encodePlan(plan([day([place()])], "roadtrip")));
    expect(road!.kind).toBe("roadtrip");

    const city = await decodePlan(await encodePlan(plan([day([place()])])));
    expect(city!.kind).toBe("city");
  });

  it("stays short enough for a URL", async () => {
    // 20 stops is a generous trip; the link has to survive being pasted anywhere.
    const stops = Array.from({ length: 20 }, (_, i) =>
      place({ id: `node/${i}`, name: `A reasonably long place name ${i}` }),
    );
    const encoded = await encodePlan(plan([day(stops)]));
    expect(encoded.length).toBeLessThan(2000);
  });

  it("rejects malformed, truncated and foreign payloads", async () => {
    expect(await decodePlan("")).toBeNull();
    expect(await decodePlan("not-base64!!")).toBeNull();
    expect(await decodePlan("xSGVsbG8")).toBeNull(); // unknown prefix flag
    const good = await encodePlan(plan([day([place()])]));
    expect(await decodePlan(good.slice(0, good.length - 12))).toBeNull();
  });
});
