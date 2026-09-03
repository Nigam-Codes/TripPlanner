"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Search, Loader2, MapPin } from "lucide-react";
import { searchPlaces, type PlaceSearchResult } from "@/client/providers/placeSearch";
import { createRoadTrip } from "@/client/store";

/**
 * Start a road trip from its first stop.
 *
 * A road trip has no centre and no radius, but the map still needs somewhere to point,
 * so the first stop is chosen up front. Every stop after this one is added the same way
 * from inside the planner.
 */
export function RoadTripStart() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PlaceSearchResult[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function search(e: React.FormEvent) {
    e.preventDefault();
    if (query.trim().length < 2) return;

    setBusy(true);
    setError(null);
    setResults(null);
    try {
      setResults(await searchPlaces(query));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Search failed");
    } finally {
      setBusy(false);
    }
  }

  function pick(r: PlaceSearchResult) {
    setCreating(r.place.id);
    try {
      router.push(`/plan/?id=${createRoadTrip(r.place)}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create trip");
      setCreating(null);
    }
  }

  return (
    <div>
      <form onSubmit={search} className="flex gap-2">
        <div className="relative flex-1">
          <Search
            className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted"
            aria-hidden
          />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Where does the trip start? — Lisbon, Denver, Queenstown…"
            aria-label="First stop"
            className="w-full rounded-lg border border-line bg-surface py-3 pr-3 pl-10 text-base outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
          />
        </div>
        <button
          type="submit"
          disabled={busy || query.trim().length < 2}
          className="inline-flex items-center gap-2 rounded-lg bg-accent px-5 py-3 font-medium text-accent-fg transition hover:opacity-90 disabled:opacity-40"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Search
        </button>
      </form>

      <p className="mt-2 text-sm text-muted">
        No radius, no browsing — you pick every stop, and the route is planned between
        exactly those.
      </p>

      {error ? (
        <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      ) : null}

      {results && results.length === 0 ? (
        <p className="mt-4 text-sm text-muted">No match. Try including the country.</p>
      ) : null}

      {results && results.length > 0 ? (
        <ul className="mt-4 divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface">
          {results.map((r) => (
            <li key={r.place.id}>
              <button
                onClick={() => pick(r)}
                disabled={creating !== null}
                className="flex w-full items-start gap-3 px-4 py-3 text-left transition hover:bg-canvas disabled:opacity-50"
              >
                <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden />
                <span className="min-w-0">
                  <span className="block font-medium">{r.place.name}</span>
                  <span className="block truncate text-sm text-muted">{r.context}</span>
                </span>
                {creating === r.place.id ? (
                  <Loader2 className="ml-auto h-4 w-4 shrink-0 animate-spin text-muted" />
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
