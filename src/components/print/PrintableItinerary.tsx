"use client";

import { categoryLabel } from "@/lib/categories";
import { formatDistance, formatDuration } from "@/lib/geo";
import { MODE_LABEL, type PlannedTrip, type ScheduledDay } from "@/lib/types";

export interface PrintOptions {
  /** Day ids to include, in trip order. */
  dayIds: string[];
  descriptions: boolean;
  photos: boolean;
}

/**
 * The document that actually gets printed.
 *
 * Rendered off-screen and revealed only by the print stylesheet. Building a separate
 * linear document — rather than restyling the three-pane app — is what makes
 * pagination predictable: the planner's panes are independently scrolling flex
 * children, which browsers paginate very badly.
 */
export function PrintableItinerary({
  plan,
  options,
}: {
  plan: PlannedTrip;
  options: PrintOptions;
}) {
  const days = plan.days.filter((d) => options.dayIds.includes(d.dayId));
  if (days.length === 0) return null;

  const totals = days.reduce(
    (acc, d) => ({
      stops: acc.stops + d.stops.length,
      travel: acc.travel + d.totalTravelSec,
      distance: acc.distance + d.totalDistanceM,
    }),
    { stops: 0, travel: 0, distance: 0 },
  );

  return (
    <div className="print-only mx-auto max-w-3xl bg-white p-8 text-ink">
      <header className="mb-6 border-b border-line pb-4">
        <h1 className="text-2xl font-semibold tracking-tight">{plan.trip.title}</h1>
        <p className="mt-1 text-sm text-muted">
          {plan.trip.cityName} · {days.length} of {plan.days.length}{" "}
          {plan.days.length === 1 ? "day" : "days"} · {totals.stops} stops ·{" "}
          {MODE_LABEL[plan.trip.defaultMode]} · {formatDuration(totals.travel)} travel ·{" "}
          {formatDistance(totals.distance)}
        </p>
      </header>

      {days.map((day, i) => (
        <PrintDay
          key={day.dayId}
          day={day}
          index={plan.days.indexOf(day)}
          options={options}
          // Each day after the first starts on a fresh page.
          className={i > 0 ? "page-break-before" : ""}
        />
      ))}

      <footer className="mt-8 border-t border-line pt-3 text-[10px] leading-relaxed text-muted">
        Place data © OpenStreetMap contributors (ODbL). Descriptions and images from
        Wikipedia (CC BY-SA). Routing by the FOSSGIS OSRM service.
      </footer>
    </div>
  );
}

function PrintDay({
  day,
  index,
  options,
  className,
}: {
  day: ScheduledDay;
  index: number;
  options: PrintOptions;
  className: string;
}) {
  return (
    <section className={`mb-8 ${className}`}>
      <div className="mb-3 flex items-baseline justify-between border-b border-line pb-1.5">
        <h2 className="text-lg font-semibold">{day.title ?? `Day ${index + 1}`}</h2>
        <span className="text-xs text-muted">
          {day.date ? `${day.date} · ` : ""}
          {day.startTime} – {day.endTime}
          {day.endDayOffset > 0 ? ` (+${day.endDayOffset}d)` : ""} ·{" "}
          {formatDuration(day.totalTravelSec)} travel · {formatDistance(day.totalDistanceM)}
        </span>
      </div>

      {day.stops.length === 0 ? (
        <p className="text-sm text-muted">No stops planned.</p>
      ) : (
        <ol className="space-y-3">
          {day.stops.map((s, i) => (
            <li key={s.stopId} className="print-break">
              {s.legFromPrevious ? (
                <p className="mb-1.5 pl-9 text-[11px] text-muted">
                  ↓ {MODE_LABEL[s.legFromPrevious.mode]}{" "}
                  {formatDuration(s.legFromPrevious.durationSec)} ·{" "}
                  {formatDistance(s.legFromPrevious.distanceM)}
                  {s.legFromPrevious.geometry ? "" : " (estimated)"}
                </p>
              ) : null}

              <div className="flex gap-3">
                <span className="print-ink mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-ink text-xs font-semibold text-white">
                  {i + 1}
                </span>

                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">
                    {s.place.name}
                    {s.place.localName ? (
                      <span className="ml-1.5 font-normal text-muted">{s.place.localName}</span>
                    ) : null}
                  </p>

                  <p className="text-xs text-muted">
                    {s.arrival} – {s.departure}
                    {s.dayOffset > 0 ? ` (+${s.dayOffset}d)` : ""} · stay {s.dwellMinutes} min ·{" "}
                    {categoryLabel(s.place.category)}
                  </p>

                  {s.place.tags?.opening_hours ? (
                    <p className="text-[11px] text-muted">
                      Hours: {s.place.tags.opening_hours}
                    </p>
                  ) : null}

                  {s.closedWarning ? (
                    <p className="text-[11px] font-medium">⚠ {s.closedWarning}</p>
                  ) : null}

                  {options.descriptions && s.place.description ? (
                    <p className="mt-1 text-[11px] leading-snug text-muted">
                      {s.place.description}
                    </p>
                  ) : null}
                </div>

                {options.photos && s.place.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={s.place.imageUrl}
                    alt=""
                    className="h-20 w-20 shrink-0 rounded object-cover"
                  />
                ) : null}
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
