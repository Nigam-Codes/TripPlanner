"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2, Copy, Check, X } from "lucide-react";
import { MapCanvas } from "@/components/map/MapCanvas";
import { PoiPanel, type SortKey } from "@/components/discover/PoiPanel";
import { ItineraryPanel } from "@/components/trip/ItineraryPanel";
import { CATEGORY_IDS } from "@/lib/categories";
import { formatDistance, formatDuration } from "@/lib/geo";
import type { Mode, Place, PlannedTrip } from "@/lib/types";

interface PlanResponse extends PlannedTrip {
  share: { token: string; viewCount: number } | null;
  savedSec?: number;
}

export function PlanDashboard({ initial }: { initial: PlanResponse }) {
  const [plan, setPlan] = useState<PlanResponse>(initial);
  const [radius, setRadius] = useState(initial.trip.radiusM);
  const [categories, setCategories] = useState<string[]>(CATEGORY_IDS);
  const [sort, setSort] = useState<SortKey>("relevance");
  const [query, setQuery] = useState("");

  const [places, setPlaces] = useState<Place[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [activeDayId, setActiveDayId] = useState(initial.days[0]?.dayId ?? "");
  const [selected, setSelected] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [shareOpen, setShareOpen] = useState(false);

  const { cityLat, cityLon } = plan.trip;

  const day = useMemo(
    () => plan.days.find((d) => d.dayId === activeDayId) ?? plan.days[0] ?? null,
    [plan.days, activeDayId],
  );

  const stopPlaceIds = useMemo(
    () => new Set((day?.stops ?? []).map((s) => s.place.id)),
    [day],
  );

  /* ---------------------------------------------------------------- discovery */

  // Debounced so dragging the radius slider does not fire an Overpass query per
  // pixel — the public instance allows only two concurrent slots.
  useEffect(() => {
    const ctrl = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const url =
          `/api/places?lat=${cityLat}&lon=${cityLon}&radius=${radius}` +
          `&categories=${categories.join(",")}`;
        const res = await fetch(url, { signal: ctrl.signal });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? "Search failed");
        setPlaces(json.places as Place[]);
      } catch (err) {
        if ((err as Error).name === "AbortError") return;
        setError(err instanceof Error ? err.message : "Search failed");
      } finally {
        setLoading(false);
      }
    }, 500);

    return () => {
      ctrl.abort();
      clearTimeout(timer);
    };
  }, [cityLat, cityLon, radius, categories]);

  const visiblePlaces = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? places.filter(
          (p) =>
            p.name.toLowerCase().includes(q) || (p.localName ?? "").toLowerCase().includes(q),
        )
      : places;

    const sorted = filtered.slice();
    if (sort === "distance") sorted.sort((a, b) => (a.distance ?? 0) - (b.distance ?? 0));
    else if (sort === "name") sorted.sort((a, b) => a.name.localeCompare(b.name));
    return sorted;
  }, [places, query, sort]);

  /* ---------------------------------------------------------------- mutations */

  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flash = useCallback((msg: string) => {
    setNotice(msg);
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(null), 5000);
  }, []);

  const mutate = useCallback(
    async (label: string, url: string, init: RequestInit) => {
      setBusy(label);
      try {
        const res = await fetch(url, {
          ...init,
          headers: { "Content-Type": "application/json", ...(init.headers ?? {}) },
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? "Request failed");
        if (json.trip) setPlan(json as PlanResponse);
        return json;
      } catch (err) {
        flash(err instanceof Error ? err.message : "Request failed");
        return null;
      } finally {
        setBusy(null);
      }
    },
    [flash],
  );

  const tripId = plan.trip.id;

  const addPlace = useCallback(
    (p: Place) => {
      if (!day) return;
      void mutate("add", `/api/trips/${tripId}/stops`, {
        method: "POST",
        body: JSON.stringify({ dayId: day.dayId, place: p }),
      });
    },
    [day, mutate, tripId],
  );

  const optimize = useCallback(
    async (dayId: string) => {
      const json = await mutate("optimize", `/api/trips/${tripId}/optimize`, {
        method: "POST",
        body: JSON.stringify({ dayId, mode: plan.trip.defaultMode }),
      });
      if (json) {
        flash(
          json.savedSec > 0
            ? `Reordered — saves ${formatDuration(json.savedSec)} of travel.`
            : "Already the shortest order found.",
        );
      }
    },
    [mutate, tripId, plan.trip.defaultMode, flash],
  );

  const share = useCallback(async () => {
    if (!plan.share) {
      const json = await mutate("share", `/api/trips/${tripId}/share`, { method: "POST" });
      if (json?.token) {
        setPlan((p) => ({ ...p, share: { token: json.token, viewCount: 0 } }));
      }
    }
    setShareOpen(true);
  }, [plan.share, mutate, tripId]);

  if (!day) return null;

  return (
    <div className="flex h-screen flex-col">
      <header className="flex shrink-0 items-center gap-3 border-b border-line bg-surface px-4 py-2.5">
        <Link href="/" className="text-muted transition hover:text-ink" aria-label="All trips">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div className="min-w-0">
          <h1 className="truncate text-sm font-semibold">{plan.trip.title}</h1>
          <p className="text-xs text-muted">
            {plan.trip.cityName} · {formatDistance(radius)} radius
          </p>
        </div>

        <label className="ml-auto flex items-center gap-2 text-xs text-muted">
          Radius
          <input
            type="range"
            min={500}
            max={20000}
            step={500}
            value={radius}
            onChange={(e) => setRadius(Number(e.target.value))}
            className="w-32 accent-teal-600"
            aria-label="Search radius in metres"
          />
          <input
            type="number"
            min={0.5}
            max={20}
            step={0.5}
            value={radius / 1000}
            onChange={(e) =>
              setRadius(Math.min(20000, Math.max(500, Number(e.target.value) * 1000)))
            }
            className="w-16 rounded border border-line bg-surface px-1.5 py-1"
            aria-label="Search radius in kilometres"
          />
          km
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
        </label>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[340px_1fr_360px]">
        <aside className="hidden min-h-0 border-r border-line bg-surface lg:block">
          <PoiPanel
            places={visiblePlaces}
            loading={loading}
            error={error}
            activeCategories={categories}
            sort={sort}
            query={query}
            stopPlaceIds={stopPlaceIds}
            hoveredPlaceId={hovered}
            onToggleCategory={(id) =>
              setCategories((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]))
            }
            onSort={setSort}
            onQuery={setQuery}
            onHover={setHovered}
            onSelect={setSelected}
            onAdd={addPlace}
          />
        </aside>

        <div className="relative min-h-0">
          <MapCanvas
            centre={{ lat: cityLat, lon: cityLon }}
            radiusM={radius}
            places={visiblePlaces}
            day={day}
            selectedPlaceId={selected}
            hoveredPlaceId={hovered}
            stopPlaceIds={stopPlaceIds}
            onSelectPlace={setSelected}
            onAddPlace={addPlace}
          />
        </div>

        <aside className="min-h-0 border-l border-line bg-surface">
          <ItineraryPanel
            plan={plan}
            day={day}
            busy={busy}
            savedNotice={notice}
            onSelectDay={setActiveDayId}
            onAddDay={() => void mutate("day", "/api/days", { method: "POST", body: JSON.stringify({ tripId }) })}
            onRemoveDay={(dayId) =>
              void mutate("day", `/api/days/${dayId}?tripId=${tripId}`, { method: "DELETE" })
            }
            onSetStartTime={(dayId, startTime) =>
              void mutate("day", `/api/days/${dayId}`, {
                method: "PATCH",
                body: JSON.stringify({ tripId, startTime }),
              })
            }
            onSetMode={(mode: Mode) =>
              void mutate("mode", `/api/trips/${tripId}`, {
                method: "PATCH",
                body: JSON.stringify({ defaultMode: mode }),
              })
            }
            onReorder={(dayId, stopIds) =>
              void mutate("reorder", `/api/trips/${tripId}/reorder`, {
                method: "POST",
                body: JSON.stringify({ dayId, stopIds }),
              })
            }
            onRemoveStop={(stopId) =>
              void mutate("stop", `/api/stops/${stopId}?tripId=${tripId}`, { method: "DELETE" })
            }
            onSetDwell={(stopId, dwellMinutes) =>
              void mutate("stop", `/api/stops/${stopId}`, {
                method: "PATCH",
                body: JSON.stringify({ tripId, dwellMinutes }),
              })
            }
            onOptimize={optimize}
            onShare={share}
            onHover={setHovered}
          />
        </aside>
      </div>

      {shareOpen && plan.share ? (
        <ShareDialog
          token={plan.share.token}
          viewCount={plan.share.viewCount}
          onClose={() => setShareOpen(false)}
          onRevoke={async () => {
            await mutate("share", `/api/trips/${tripId}/share`, { method: "DELETE" });
            setPlan((p) => ({ ...p, share: null }));
            setShareOpen(false);
            flash("Share link revoked. The old link no longer works.");
          }}
        />
      ) : null}
    </div>
  );
}

function ShareDialog({
  token,
  viewCount,
  onClose,
  onRevoke,
}: {
  token: string;
  viewCount: number;
  onClose: () => void;
  onRevoke: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const url = typeof window === "undefined" ? "" : `${window.location.origin}/s/${token}`;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Share this plan"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-xl bg-surface p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-start justify-between">
          <h2 className="text-base font-semibold">Share this plan</h2>
          <button onClick={onClose} aria-label="Close" className="text-muted hover:text-ink">
            <X className="h-4 w-4" />
          </button>
        </div>

        <p className="mb-3 text-sm text-muted">
          Anyone with this link can view the itinerary and explore it on a map. They cannot
          change it.
        </p>

        <div className="flex gap-2">
          <input
            readOnly
            value={url}
            onFocus={(e) => e.currentTarget.select()}
            className="min-w-0 flex-1 rounded-md border border-line bg-canvas px-3 py-2 text-sm"
          />
          <button
            onClick={async () => {
              await navigator.clipboard.writeText(url);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            }}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-accent px-3 py-2 text-sm font-medium text-accent-fg hover:opacity-90"
          >
            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            {copied ? "Copied" : "Copy"}
          </button>
        </div>

        <div className="mt-4 flex items-center justify-between text-xs text-muted">
          <span>
            {viewCount} {viewCount === 1 ? "view" : "views"}
          </span>
          <button onClick={onRevoke} className="font-medium text-red-600 hover:underline">
            Revoke link
          </button>
        </div>
      </div>
    </div>
  );
}
