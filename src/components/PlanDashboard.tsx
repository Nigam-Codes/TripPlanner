"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2, Copy, Check, X, AlertTriangle } from "lucide-react";
import { MapCanvas } from "@/components/map/MapCanvas";
import { PoiPanel, type SortKey } from "@/components/discover/PoiPanel";
import { ItineraryPanel } from "@/components/trip/ItineraryPanel";
import { CATEGORY_IDS } from "@/lib/categories";
import { NOTABLE_ONLY_ABOVE_M } from "@/lib/osm";
import { formatDistance, formatDuration } from "@/lib/geo";
import { findPlaces } from "@/client/providers/places";
import { enrichPlaces, hydratePlaces } from "@/client/providers/enrich";
import { encodePlan } from "@/client/share";
import { ExportDialog } from "@/components/print/ExportDialog";
import { PrintableItinerary } from "@/components/print/PrintableItinerary";
import { usePrintExport } from "@/components/print/usePrintExport";
import { BASE_PATH } from "@/lib/basePath";
import * as store from "@/client/store";
import type { Mode, Place, PlannedTrip } from "@/lib/types";

const MAX_RADIUS_M = 50_000;

export function PlanDashboard({ tripId }: { tripId: string }) {
  const [plan, setPlan] = useState<PlannedTrip | null>(null);
  const [missing, setMissing] = useState(false);

  const [radius, setRadius] = useState(3000);
  const [categories, setCategories] = useState<string[]>(CATEGORY_IDS);
  const [sort, setSort] = useState<SortKey>("relevance");
  const [query, setQuery] = useState("");

  const [places, setPlaces] = useState<Place[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [activeDayId, setActiveDayId] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const { printOptions, startPrint } = usePrintExport();
  // A road trip usually has a fixed departure point; the finish is often open.
  const [pinStart, setPinStart] = useState(true);
  const [pinEnd, setPinEnd] = useState(false);

  /* ------------------------------------------------------------------ loading */

  const refresh = useCallback(async () => {
    const next = await store.planTrip(tripId);
    if (!next) {
      setMissing(true);
      return null;
    }
    setPlan(next);
    setActiveDayId((cur) => (next.days.some((d) => d.dayId === cur) ? cur : next.days[0]?.dayId ?? ""));
    return next;
  }, [tripId]);

  // localStorage is only readable on the client, so the trip loads after mount.
  useEffect(() => {
    void (async () => {
      const loaded = await refresh();
      if (loaded) setRadius(loaded.trip.radiusM);
    })();
  }, [refresh]);

  const isRoadTrip = plan?.trip.kind === "roadtrip";
  const stopCount = plan?.days.reduce((n, d) => n + d.stops.length, 0) ?? 0;

  const day = useMemo(
    () => plan?.days.find((d) => d.dayId === activeDayId) ?? plan?.days[0] ?? null,
    [plan, activeDayId],
  );

  const stopPlaceIds = useMemo(
    () => new Set((day?.stops ?? []).map((s) => s.place.id)),
    [day],
  );

  /* ---------------------------------------------------------------- discovery */

  const cityLat = plan?.trip.cityLat;
  const cityLon = plan?.trip.cityLon;

  // Debounced so dragging the radius slider does not fire an Overpass query per pixel —
  // the public instance allows only two concurrent slots.
  useEffect(() => {
    // A road trip has no radius and no browsing, so it never queries Overpass.
    if (isRoadTrip) {
      setPlaces([]);
      setLoading(false);
      return;
    }
    if (cityLat == null || cityLon == null) return;
    let cancelled = false;

    const timer = setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const found = await findPlaces(cityLat, cityLon, radius, categories);
        if (cancelled) return;
        setPlaces(found);
        const ranked = await enrichPlaces(found);
        if (!cancelled) setPlaces(ranked);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Search failed");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 500);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [cityLat, cityLon, radius, categories, isRoadTrip]);

  const visiblePlaces = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? places.filter(
          (p) => p.name.toLowerCase().includes(q) || (p.localName ?? "").toLowerCase().includes(q),
        )
      : places;

    const sorted = filtered.slice();
    if (sort === "distance") sorted.sort((a, b) => (a.distance ?? 0) - (b.distance ?? 0));
    else if (sort === "name") sorted.sort((a, b) => a.name.localeCompare(b.name));
    return sorted;
  }, [places, query, sort]);

  /* --------------------------------------------------------------- enrichment */

  // Places added by name skip discovery, so they arrive with no description or photo.
  // Road trips are built entirely that way, which would otherwise leave every stop
  // bare — in the planner and in the exported PDF.
  //
  // The attempted set is what stops this looping: a place with a wikidata id but no
  // English article never gains a description, so without it the effect would refetch
  // on every re-plan.
  const hydrationAttempted = useRef(new Set<string>());

  useEffect(() => {
    if (!plan) return;

    const pending = plan.days
      .flatMap((day) => day.stops.map((s) => s.place))
      .filter((p) => p.wikidata && !p.description && !hydrationAttempted.current.has(p.id));

    if (pending.length === 0) return;
    for (const p of pending) hydrationAttempted.current.add(p.id);

    let cancelled = false;
    void (async () => {
      try {
        const hydrated = await hydratePlaces(pending);
        if (cancelled) return;

        const gained = hydrated.filter((p) => p.description || p.imageUrl);
        if (gained.length === 0) return;

        store.savePlaces(gained);
        await refresh();
      } catch {
        // Enrichment is decoration; a failure must not disturb the itinerary.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [plan, refresh]);

  /* ---------------------------------------------------------------- mutations */

  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flash = useCallback((msg: string) => {
    setNotice(msg);
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(null), 5000);
  }, []);

  /** Every mutation is synchronous against localStorage, then re-plans for new legs. */
  const act = useCallback(
    async (label: string, mutation: () => void | Promise<void>) => {
      setBusy(label);
      try {
        await mutation();
        await refresh();
      } catch (err) {
        flash(err instanceof Error ? err.message : "Something went wrong");
      } finally {
        setBusy(null);
      }
    },
    [refresh, flash],
  );

  const addPlace = useCallback(
    (p: Place) => {
      if (!day) return;
      void act("add", () => store.addStop(tripId, day.dayId, p));
    },
    [act, day, tripId],
  );

  const optimize = useCallback(
    async (dayId: string) => {
      if (!plan) return;
      let saved = 0;
      await act("optimize", async () => {
        ({ savedSec: saved } = await store.optimizeDay(tripId, dayId, plan.trip.defaultMode, {
          pinStart: isRoadTrip ? pinStart : false,
          pinEnd: isRoadTrip ? pinEnd : false,
        }));
      });
      flash(
        saved > 0
          ? `Reordered — saves ${formatDuration(saved)} of travel.`
          : "Already the shortest order found.",
      );
    },
    [act, flash, plan, tripId, isRoadTrip, pinStart, pinEnd],
  );

  const share = useCallback(async () => {
    if (!plan) return;
    const encoded = await encodePlan(plan);
    setShareUrl(`${window.location.origin}${BASE_PATH}/s/#${encoded}`);
  }, [plan]);

  /* ------------------------------------------------------------------- render */

  if (missing) {
    return (
      <main className="mx-auto max-w-md p-16 text-center">
        <p className="mb-2 font-medium">Trip not found</p>
        <p className="mb-4 text-sm text-muted">
          Trips are stored in this browser only, so a link from another device or a cleared
          cache will not resolve.
        </p>
        <Link href="/" className="text-sm text-accent underline">
          Back to all trips
        </Link>
      </main>
    );
  }

  if (!plan || !day) {
    return (
      <main className="flex h-screen items-center justify-center gap-2 text-sm text-muted">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading trip…
      </main>
    );
  }

  return (
    <>
    <div className="screen-only flex h-screen flex-col">
      <header className="flex shrink-0 items-center gap-3 border-b border-line bg-surface px-4 py-2.5">
        <Link href="/" className="text-muted transition hover:text-ink" aria-label="All trips">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div className="min-w-0">
          <h1 className="truncate text-sm font-semibold">{plan.trip.title}</h1>
          <p className="text-xs text-muted">
            {isRoadTrip
              ? `Road trip · ${stopCount} ${stopCount === 1 ? "stop" : "stops"}`
              : `${plan.trip.cityName} · ${formatDistance(radius)} radius`}
          </p>
        </div>

        {isRoadTrip ? null : (
        <label className="ml-auto flex items-center gap-2 text-xs text-muted">
          Radius
          <input
            type="range"
            min={500}
            max={MAX_RADIUS_M}
            step={500}
            value={radius}
            onChange={(e) => setRadius(Number(e.target.value))}
            onPointerUp={() => store.updateTrip(tripId, { radiusM: radius })}
            className="w-32 accent-teal-600"
            aria-label="Search radius in metres"
          />
          <input
            type="number"
            min={0.5}
            max={MAX_RADIUS_M / 1000}
            step={0.5}
            value={radius / 1000}
            onChange={(e) =>
              setRadius(Math.min(MAX_RADIUS_M, Math.max(500, Number(e.target.value) * 1000)))
            }
            onBlur={() => store.updateTrip(tripId, { radiusM: radius })}
            className="w-16 rounded border border-line bg-surface px-1.5 py-1"
            aria-label="Search radius in kilometres"
          />
          km
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
        </label>
        )}
      </header>

      {!isRoadTrip && radius > NOTABLE_ONLY_ABOVE_M ? (
        <p className="flex items-center justify-center gap-1.5 border-b border-amber-200 bg-amber-50 px-4 py-1.5 text-xs text-amber-800">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          Beyond {formatDistance(NOTABLE_ONLY_ABOVE_M)}, only notable places are listed so the
          search stays fast. For somewhere further out, use “Add a place by name”.
        </p>
      ) : null}

      <div
        className={`grid min-h-0 flex-1 grid-cols-1 ${
          isRoadTrip ? "lg:grid-cols-[1fr_380px]" : "lg:grid-cols-[340px_1fr_360px]"
        }`}
      >
        <aside
          className={`min-h-0 border-r border-line bg-surface ${
            isRoadTrip ? "hidden" : "hidden lg:block"
          }`}
        >
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
            centre={{ lat: plan.trip.cityLat, lon: plan.trip.cityLon }}
            radiusM={radius}
            places={visiblePlaces}
            day={day}
            selectedPlaceId={selected}
            hoveredPlaceId={hovered}
            stopPlaceIds={stopPlaceIds}
            onSelectPlace={setSelected}
            onAddPlace={addPlace}
            fitToStops={isRoadTrip}
          />
        </div>

        <aside className="min-h-0 border-l border-line bg-surface">
          <ItineraryPanel
            plan={plan}
            day={day}
            busy={busy}
            savedNotice={notice}
            onSelectDay={setActiveDayId}
            onAddDay={() => void act("day", () => void store.addDay(tripId))}
            onRemoveDay={(dayId) => void act("day", () => store.removeDay(tripId, dayId))}
            onSetStartTime={(dayId, startTime) =>
              void act("day", () => store.updateDay(tripId, dayId, { startTime }))
            }
            onSetMode={(mode: Mode) => void act("mode", () => store.updateTrip(tripId, { defaultMode: mode }))}
            onReorder={(dayId, stopIds) =>
              void act("reorder", () => store.reorderStops(tripId, dayId, stopIds))
            }
            onRemoveStop={(stopId) => void act("stop", () => store.removeStop(tripId, stopId))}
            onSetDwell={(stopId, dwellMinutes) =>
              void act("stop", () => store.updateStop(tripId, stopId, { dwellMinutes }))
            }
            onOptimize={optimize}
            onShare={share}
            onExport={() => setExportOpen(true)}
            onHover={setHovered}
            onAddPlace={addPlace}
            roadTrip={isRoadTrip}
            pinStart={pinStart}
            pinEnd={pinEnd}
            onPinStart={setPinStart}
            onPinEnd={setPinEnd}
          />
        </aside>
      </div>

      {shareUrl ? <ShareDialog url={shareUrl} onClose={() => setShareUrl(null)} /> : null}

      {exportOpen ? (
        <ExportDialog
          plan={plan}
          onClose={() => setExportOpen(false)}
          onExport={(opts) => {
            setExportOpen(false);
            startPrint(opts);
          }}
        />
      ) : null}
    </div>

    {printOptions ? <PrintableItinerary plan={plan} options={printOptions} /> : null}
    </>
  );
}


function ShareDialog({ url, onClose }: { url: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Share this plan"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-xl bg-surface p-5 shadow-xl"
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
            className="min-w-0 flex-1 rounded-md border border-line bg-canvas px-3 py-2 text-xs"
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

        <p className="mt-3 text-xs text-muted">
          The whole plan is encoded in the link itself, so it keeps working without a server —
          but it cannot be revoked, and editing the trip produces a new link.
        </p>
      </div>
    </div>
  );
}
