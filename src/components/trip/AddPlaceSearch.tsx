"use client";

import { useState } from "react";
import { Search, Loader2, Plus, X } from "lucide-react";
import { searchPlaces, type PlaceSearchResult } from "@/client/providers/placeSearch";
import { formatDistance } from "@/lib/geo";
import type { LatLon, Place } from "@/lib/types";

/**
 * Add a destination by name, at any distance.
 *
 * Radius discovery cannot reach a town five hours away — an unfiltered Overpass query
 * at that range takes ~90 s and truncates arbitrarily. Naming the place instead is both
 * instant and exact, so this is the intended route for long-haul stops.
 */
export function AddPlaceSearch({
  origin,
  onAdd,
}: {
  origin: LatLon | null;
  onAdd: (place: Place) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PlaceSearchResult[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(e: React.FormEvent) {
    e.preventDefault();
    if (query.trim().length < 2) return;

    setBusy(true);
    setError(null);
    setResults(null);
    try {
      setResults(await searchPlaces(query, origin));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Search failed");
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setOpen(false);
    setQuery("");
    setResults(null);
    setError(null);
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-line py-2 text-xs font-medium text-muted transition hover:border-accent hover:text-accent"
      >
        <Plus className="h-3.5 w-3.5" />
        Add a place by name (any distance)
      </button>
    );
  }

  return (
    <div className="rounded-lg border border-accent/40 bg-canvas p-2.5">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-medium">Add any place</span>
        <button onClick={reset} aria-label="Close" className="text-muted hover:text-ink">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <form onSubmit={run} className="flex gap-1.5">
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Sintra, Évora, Cabo da Roca…"
          aria-label="Place name"
          className="min-w-0 flex-1 rounded border border-line bg-surface px-2 py-1.5 text-xs outline-none focus:border-accent"
        />
        <button
          type="submit"
          disabled={busy || query.trim().length < 2}
          className="inline-flex shrink-0 items-center gap-1 rounded bg-accent px-2.5 py-1.5 text-xs font-medium text-accent-fg disabled:opacity-40"
        >
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Search className="h-3 w-3" />}
          Find
        </button>
      </form>

      {error ? <p className="mt-2 text-xs text-red-600">{error}</p> : null}

      {results && results.length === 0 ? (
        <p className="mt-2 text-xs text-muted">No match. Try including the country.</p>
      ) : null}

      {results && results.length > 0 ? (
        <ul className="mt-2 max-h-56 divide-y divide-line overflow-y-auto rounded border border-line bg-surface">
          {results.map((r) => (
            <li key={r.place.id}>
              <button
                onClick={() => {
                  onAdd(r.place);
                  reset();
                }}
                className="w-full px-2.5 py-2 text-left transition hover:bg-canvas"
              >
                <span className="block text-xs font-medium">{r.place.name}</span>
                <span className="block truncate text-[11px] text-muted">{r.context}</span>
                {r.distance != null ? (
                  <span className="text-[11px] text-accent">
                    {formatDistance(r.distance)} from {"the city centre"}
                  </span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
