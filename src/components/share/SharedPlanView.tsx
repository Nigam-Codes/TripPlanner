"use client";

import { useMemo, useState } from "react";
import { MapCanvas } from "@/components/map/MapCanvas";
import { categoryLabel } from "@/lib/categories";
import { formatDistance, formatDuration } from "@/lib/geo";
import { MODE_LABEL } from "@/lib/types";
import type { PlannedTrip } from "@/lib/types";
import { Clock, Footprints, Bike, Car, AlertTriangle, FileDown, MapPin } from "lucide-react";
import { ExportDialog } from "@/components/print/ExportDialog";
import { PrintableItinerary } from "@/components/print/PrintableItinerary";
import { usePrintExport } from "@/components/print/usePrintExport";

const MODE_ICON = { foot: Footprints, bike: Bike, car: Car } as const;

/**
 * Public, read-only itinerary.
 *
 * Interactive (day switching, map focus, printing) but deliberately without any
 * editing affordance. It renders purely from the plan snapshot handed in by the
 * server; there is no mutation endpoint reachable from this component.
 */
export function SharedPlanView({ plan }: { plan: PlannedTrip }) {
  const [activeDayId, setActiveDayId] = useState(plan.days[0]?.dayId ?? "");
  const [selected, setSelected] = useState<string | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const { printOptions, startPrint } = usePrintExport();

  const day = useMemo(
    () => plan.days.find((d) => d.dayId === activeDayId) ?? plan.days[0] ?? null,
    [plan.days, activeDayId],
  );

  const totals = useMemo(
    () => ({
      stops: plan.days.reduce((n, d) => n + d.stops.length, 0),
      travel: plan.days.reduce((n, d) => n + d.totalTravelSec, 0),
      distance: plan.days.reduce((n, d) => n + d.totalDistanceM, 0),
    }),
    [plan.days],
  );

  if (!day) {
    return (
      <main className="screen-only mx-auto max-w-2xl p-16 text-center text-muted">
        This plan has no stops yet.
      </main>
    );
  }

  const ModeIcon = MODE_ICON[plan.trip.defaultMode];

  return (
    <>
    <main className="screen-only mx-auto max-w-6xl px-5 py-8">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-medium tracking-wide text-accent uppercase">Trip plan</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">{plan.trip.title}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
            <span className="inline-flex items-center gap-1">
              <MapPin className="h-3.5 w-3.5" />
              {plan.trip.cityName}
            </span>
            <span>
              {plan.days.length} {plan.days.length === 1 ? "day" : "days"} · {totals.stops} stops
            </span>
            <span className="inline-flex items-center gap-1">
              <ModeIcon className="h-3.5 w-3.5" />
              {MODE_LABEL[plan.trip.defaultMode]}
            </span>
            <span>
              {formatDuration(totals.travel)} travel · {formatDistance(totals.distance)}
            </span>
          </p>
        </div>

        <button
          onClick={() => setExportOpen(true)}
          className="no-print inline-flex items-center gap-1.5 rounded-md border border-line bg-surface px-3 py-2 text-sm font-medium text-muted transition hover:border-accent hover:text-accent"
        >
          <FileDown className="h-4 w-4" />
          Export PDF
        </button>
      </header>

      {plan.days.length > 1 ? (
        <div className="no-print mb-4 flex flex-wrap gap-1.5">
          {plan.days.map((d) => (
            <button
              key={d.dayId}
              onClick={() => setActiveDayId(d.dayId)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
                d.dayId === day.dayId ? "bg-ink text-white" : "bg-surface text-muted hover:text-ink"
              }`}
            >
              {d.title ?? `Day ${d.dayIndex + 1}`}
              <span className="ml-1.5 opacity-60">{d.stops.length}</span>
            </button>
          ))}
        </div>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[1fr_380px]">
        <div className="no-print h-[560px] overflow-hidden rounded-xl border border-line bg-surface">
          <MapCanvas
            centre={{ lat: plan.trip.cityLat, lon: plan.trip.cityLon }}
            radiusM={plan.trip.radiusM}
            places={[]}
            day={day}
            selectedPlaceId={selected}
            hoveredPlaceId={null}
            stopPlaceIds={new Set(day.stops.map((s) => s.place.id))}
            onSelectPlace={setSelected}
            onAddPlace={() => {}}
            readOnly
            fitToStops={plan.trip.kind === "roadtrip"}
          />
        </div>

        <section>
          <div className="mb-3 flex items-center gap-2 rounded-lg bg-surface px-3 py-2 text-sm">
            <Clock className="h-4 w-4 text-muted" />
            <span className="font-medium">
              {day.title ?? `Day ${day.dayIndex + 1}`}
            </span>
            <span className="text-muted">
              {day.startTime} – {day.endTime}
              {day.endDayOffset > 0 ? ` (+${day.endDayOffset}d)` : ""}
            </span>
          </div>

          <ol className="space-y-2">
            {day.stops.map((s, i) => {
              const leg = s.legFromPrevious;
              const LegIcon = MODE_ICON[leg?.mode ?? plan.trip.defaultMode];
              return (
                <li key={s.stopId} className="print-break">
                  {leg ? (
                    <p className="flex items-center gap-1.5 py-1 pl-4 text-xs text-muted">
                      <LegIcon className="h-3 w-3" />
                      {formatDuration(leg.durationSec)} · {formatDistance(leg.distanceM)}
                      {leg.geometry ? null : <span className="italic">(estimated)</span>}
                    </p>
                  ) : null}

                  <button
                    onClick={() => setSelected(s.place.id)}
                    className={`flex w-full gap-3 rounded-lg border bg-surface p-3 text-left transition ${
                      selected === s.place.id ? "border-accent" : "border-line hover:border-accent/40"
                    }`}
                  >
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-semibold text-accent-fg">
                      {i + 1}
                    </span>

                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium">{s.place.name}</span>
                      {s.place.localName ? (
                        <span className="block text-xs text-muted">{s.place.localName}</span>
                      ) : null}
                      <span className="mt-0.5 block text-xs text-muted">
                        {s.arrival} – {s.departure}
                        {s.dayOffset > 0 ? ` (+${s.dayOffset}d)` : ""} ·{" "}
                        {categoryLabel(s.place.category)}
                      </span>
                      {s.place.description ? (
                        <span className="mt-1 block line-clamp-3 text-xs text-muted">
                          {s.place.description}
                        </span>
                      ) : null}
                      {s.closedWarning ? (
                        <span className="mt-1.5 flex items-start gap-1 rounded bg-amber-50 px-1.5 py-1 text-[11px] text-amber-700">
                          <AlertTriangle className="mt-px h-3 w-3 shrink-0" />
                          {s.closedWarning}
                        </span>
                      ) : null}
                    </span>

                    {s.place.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={s.place.imageUrl}
                        alt=""
                        loading="lazy"
                        className="h-16 w-16 shrink-0 rounded-md object-cover"
                      />
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ol>

          <dl className="mt-4 grid grid-cols-3 gap-2 text-center">
            {[
              ["Travel", formatDuration(day.totalTravelSec)],
              ["Distance", formatDistance(day.totalDistanceM)],
              ["Ends", day.endDayOffset > 0 ? `${day.endTime} +${day.endDayOffset}d` : day.endTime],
            ].map(([label, value]) => (
              <div key={label} className="rounded-md bg-surface px-2 py-2">
                <dt className="text-[10px] tracking-wide text-muted uppercase">{label}</dt>
                <dd className="mt-0.5 text-sm font-semibold">{value}</dd>
              </div>
            ))}
          </dl>
        </section>
      </div>

      <footer className="mt-10 border-t border-line pt-4 text-xs leading-relaxed text-muted">
        This is a read-only plan. Place data ©{" "}
        <a
          className="underline"
          href="https://www.openstreetmap.org/copyright"
          target="_blank"
          rel="noreferrer"
        >
          OpenStreetMap contributors
        </a>{" "}
        (ODbL). Descriptions and images from Wikipedia (CC BY-SA). Routing by the FOSSGIS OSRM
        service.
      </footer>

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
    </main>

    {printOptions ? <PrintableItinerary plan={plan} options={printOptions} /> : null}
    </>
  );
}
