"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Map, ArrowRight, Building2, Route } from "lucide-react";
import { CitySearch } from "@/components/CitySearch";
import { RoadTripStart } from "@/components/RoadTripStart";
import { listTrips } from "@/client/store";
import { formatDistance } from "@/lib/geo";

export default function Home() {
  // localStorage is client-only, so the list fills in after hydration.
  const [trips, setTrips] = useState<ReturnType<typeof listTrips>>([]);
  useEffect(() => setTrips(listTrips()), []);

  const [mode, setMode] = useState<"city" | "roadtrip">("city");

  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <header className="mb-10">
        <div className="mb-4 inline-flex items-center gap-2 rounded-full bg-accent/10 px-3 py-1 text-sm font-medium text-accent">
          <Map className="h-4 w-4" aria-hidden />
          Trip Planner
        </div>
        <h1 className="text-4xl font-semibold tracking-tight text-balance">
          Find what is worth seeing, then plan the route between it.
        </h1>
        <p className="mt-3 text-lg text-muted">
          Search a city, choose how far you are willing to roam, and build a day-by-day
          itinerary with real walking, cycling and driving times.
        </p>
      </header>

      <div className="mb-4 inline-flex rounded-lg border border-line bg-surface p-1">
        {(
          [
            ["city", "Explore a city", Building2],
            ["roadtrip", "Plan a road trip", Route],
          ] as const
        ).map(([value, label, Icon]) => (
          <button
            key={value}
            onClick={() => setMode(value)}
            aria-pressed={mode === value}
            className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition ${
              mode === value ? "bg-ink text-white" : "text-muted hover:text-ink"
            }`}
          >
            <Icon className="h-4 w-4" />
            {label}
          </button>
        ))}
      </div>

      {mode === "city" ? <CitySearch /> : <RoadTripStart />}

      {trips.length > 0 ? (
        <section className="mt-14">
          <h2 className="mb-3 text-sm font-semibold tracking-wide text-muted uppercase">
            Your trips
          </h2>
          <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface">
            {trips.map((t) => (
              <li key={t.id}>
                <Link
                  href={`/plan/?id=${t.id}`}
                  className="flex items-center gap-3 px-4 py-3 transition hover:bg-canvas"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{t.title}</span>
                    <span className="block text-sm text-muted">
                      {t.kind === "roadtrip" ? (
                        <>
                          Road trip · {t.stopCount} {t.stopCount === 1 ? "stop" : "stops"}
                        </>
                      ) : (
                        <>
                          {t.cityName} · {t.stopCount} {t.stopCount === 1 ? "stop" : "stops"} ·{" "}
                          {formatDistance(t.radiusM)} radius
                        </>
                      )}
                    </span>
                  </span>
                  <ArrowRight className="h-4 w-4 shrink-0 text-muted" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-muted">
            Trips are saved in this browser only — they are not synced between devices.
          </p>
        </section>
      ) : null}

      <footer className="mt-16 text-xs leading-relaxed text-muted">
        Place data ©{" "}
        <a
          className="underline"
          href="https://www.openstreetmap.org/copyright"
          target="_blank"
          rel="noreferrer"
        >
          OpenStreetMap contributors
        </a>{" "}
        (ODbL). Descriptions and images from Wikipedia (CC BY-SA). Routing by the FOSSGIS
        OSRM service. Basemap by OpenFreeMap.
      </footer>
    </main>
  );
}
