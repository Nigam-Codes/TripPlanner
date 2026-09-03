"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Search, Loader2, MapPin } from "lucide-react";
import type { GeocodeResult } from "@/lib/types";

/**
 * City search.
 *
 * Deliberately submit-driven rather than type-ahead: the Nominatim usage policy
 * forbids implementing autocomplete against the public API, so we only issue a
 * request when the user actually asks for one.
 */
export function CitySearch() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GeocodeResult[] | null>(null);
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
      const res = await fetch(`/api/geocode?q=${encodeURIComponent(query)}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Search failed");
      setResults(json.results as GeocodeResult[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Search failed");
    } finally {
      setBusy(false);
    }
  }

  async function pick(r: GeocodeResult) {
    setCreating(r.displayName);
    try {
      const res = await fetch("/api/trips", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cityName: r.name, cityLat: r.lat, cityLon: r.lon, radiusM: 3000 }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Could not create trip");
      router.push(`/plan/${json.id}`);
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
            placeholder="Search a city — Kyoto, Lisbon, Mexico City…"
            aria-label="City"
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

      {error ? (
        <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      ) : null}

      {results && results.length === 0 ? (
        <p className="mt-4 text-sm text-muted">No matches. Try a different spelling.</p>
      ) : null}

      {results && results.length > 0 ? (
        <ul className="mt-4 divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface">
          {results.map((r) => (
            <li key={`${r.lat},${r.lon}`}>
              <button
                onClick={() => pick(r)}
                disabled={creating !== null}
                className="flex w-full items-start gap-3 px-4 py-3 text-left transition hover:bg-canvas disabled:opacity-50"
              >
                <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden />
                <span className="min-w-0">
                  <span className="block font-medium">{r.name}</span>
                  <span className="block truncate text-sm text-muted">{r.displayName}</span>
                </span>
                {creating === r.displayName ? (
                  <Loader2 className="ml-auto h-4 w-4 shrink-0 animate-spin text-muted" />
                ) : (
                  <span className="ml-auto shrink-0 self-center text-xs text-muted capitalize">
                    {r.type.replace(/_/g, " ")}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
