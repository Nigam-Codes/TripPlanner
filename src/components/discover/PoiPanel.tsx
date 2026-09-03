"use client";

import { Loader2, Plus, Check, Star, ExternalLink } from "lucide-react";
import { CATEGORIES, categoryColor, categoryLabel } from "@/lib/categories";
import { formatDistance } from "@/lib/geo";
import type { Place } from "@/lib/types";

export type SortKey = "relevance" | "distance" | "name";

export interface PoiPanelProps {
  places: Place[];
  loading: boolean;
  error: string | null;
  activeCategories: string[];
  sort: SortKey;
  query: string;
  stopPlaceIds: Set<string>;
  hoveredPlaceId: string | null;
  onToggleCategory: (id: string) => void;
  onSort: (s: SortKey) => void;
  onQuery: (q: string) => void;
  onHover: (id: string | null) => void;
  onSelect: (id: string) => void;
  onAdd: (p: Place) => void;
}

export function PoiPanel({
  places,
  loading,
  error,
  activeCategories,
  sort,
  query,
  stopPlaceIds,
  hoveredPlaceId,
  onToggleCategory,
  onSort,
  onQuery,
  onHover,
  onSelect,
  onAdd,
}: PoiPanelProps) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 space-y-3 border-b border-line p-4">
        <input
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          placeholder="Filter by name…"
          aria-label="Filter places by name"
          className="w-full rounded-md border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
        />

        <div className="flex flex-wrap gap-1.5">
          {CATEGORIES.map((c) => {
            const on = activeCategories.includes(c.id);
            return (
              <button
                key={c.id}
                onClick={() => onToggleCategory(c.id)}
                aria-pressed={on}
                className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition ${
                  on
                    ? "border-transparent bg-ink text-white"
                    : "border-line bg-surface text-muted hover:border-ink/30"
                }`}
              >
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ background: on ? c.color : "#cbd5e1" }}
                />
                {c.label}
              </button>
            );
          })}
        </div>

        <div className="flex items-center justify-between text-xs text-muted">
          <span>
            {loading ? "Searching…" : `${places.length} place${places.length === 1 ? "" : "s"}`}
          </span>
          <label className="flex items-center gap-1.5">
            Sort
            <select
              value={sort}
              onChange={(e) => onSort(e.target.value as SortKey)}
              className="rounded border border-line bg-surface px-1.5 py-1 text-xs"
            >
              <option value="relevance">Most notable</option>
              <option value="distance">Nearest</option>
              <option value="name">A–Z</option>
            </select>
          </label>
        </div>
      </div>

      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
        {error ? (
          <p className="m-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
        ) : null}

        {loading && places.length === 0 ? (
          <div className="flex items-center justify-center gap-2 p-8 text-sm text-muted">
            <Loader2 className="h-4 w-4 animate-spin" />
            Searching OpenStreetMap…
          </div>
        ) : null}

        {!loading && !error && places.length === 0 ? (
          <p className="p-8 text-center text-sm text-muted">
            Nothing found here. Try a wider radius or more categories.
          </p>
        ) : null}

        <ul className="divide-y divide-line">
          {places.map((p) => {
            const added = stopPlaceIds.has(p.id);
            return (
              <li
                key={p.id}
                onMouseEnter={() => onHover(p.id)}
                onMouseLeave={() => onHover(null)}
                className={`flex gap-3 p-3 transition ${
                  hoveredPlaceId === p.id ? "bg-accent/5" : ""
                }`}
              >
                {p.imageUrl ? (
                  // Remote Wikipedia thumbnails vary wildly in size; plain img with
                  // object-cover avoids layout shift without a loader round-trip.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={p.imageUrl}
                    alt=""
                    loading="lazy"
                    className="h-16 w-16 shrink-0 rounded-md object-cover"
                  />
                ) : (
                  <div
                    className="flex h-16 w-16 shrink-0 items-center justify-center rounded-md text-[10px] font-medium text-white"
                    style={{ background: categoryColor(p.category) }}
                  >
                    {categoryLabel(p.category).split(" ")[0]}
                  </div>
                )}

                <div className="min-w-0 flex-1">
                  <button
                    onClick={() => onSelect(p.id)}
                    className="block text-left text-sm leading-snug font-medium hover:underline"
                  >
                    {p.name}
                  </button>

                  <p className="mt-0.5 flex items-center gap-2 text-xs text-muted">
                    <span style={{ color: categoryColor(p.category) }}>
                      {categoryLabel(p.category)}
                    </span>
                    {p.distance != null ? <span>· {formatDistance(p.distance)}</span> : null}
                    {p.popularity ? (
                      <span className="inline-flex items-center gap-0.5" title={`Covered by ${p.popularity} Wikipedia languages`}>
                        · <Star className="h-3 w-3" /> {p.popularity}
                      </span>
                    ) : null}
                  </p>

                  {p.description ? (
                    <p className="mt-1 line-clamp-2 text-xs text-muted">{p.description}</p>
                  ) : null}

                  {p.tags.website ? (
                    <a
                      href={p.tags.website}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-1 inline-flex items-center gap-1 text-xs text-accent hover:underline"
                    >
                      Website <ExternalLink className="h-3 w-3" />
                    </a>
                  ) : null}
                </div>

                <button
                  onClick={() => onAdd(p)}
                  disabled={added}
                  title={added ? "Already in this day" : "Add to day"}
                  aria-label={added ? `${p.name} already added` : `Add ${p.name}`}
                  className={`h-8 w-8 shrink-0 self-center rounded-md border transition ${
                    added
                      ? "border-transparent bg-accent/10 text-accent"
                      : "border-line text-muted hover:border-accent hover:text-accent"
                  }`}
                >
                  {added ? (
                    <Check className="mx-auto h-4 w-4" />
                  ) : (
                    <Plus className="mx-auto h-4 w-4" />
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
