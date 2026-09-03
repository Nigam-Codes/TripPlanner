"use client";

import { useEffect, useMemo, useState } from "react";
import { X, Printer } from "lucide-react";
import { formatDistance, formatDuration } from "@/lib/geo";
import type { PlannedTrip } from "@/lib/types";
import type { PrintOptions } from "./PrintableItinerary";

/**
 * Choose which days go into the PDF.
 *
 * Defaults to every day — exporting the whole trip is the common case, and the
 * per-day checkboxes exist for the times someone wants to hand one person a single
 * day's plan.
 */
export function ExportDialog({
  plan,
  onClose,
  onExport,
}: {
  plan: PlannedTrip;
  onClose: () => void;
  onExport: (options: PrintOptions) => void;
}) {
  const [selected, setSelected] = useState<string[]>(() => plan.days.map((d) => d.dayId));
  const [descriptions, setDescriptions] = useState(true);
  const [photos, setPhotos] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const summary = useMemo(() => {
    const days = plan.days.filter((d) => selected.includes(d.dayId));
    return {
      stops: days.reduce((n, d) => n + d.stops.length, 0),
      travel: days.reduce((n, d) => n + d.totalTravelSec, 0),
      distance: days.reduce((n, d) => n + d.totalDistanceM, 0),
    };
  }, [plan.days, selected]);

  const toggle = (dayId: string) =>
    setSelected((cur) =>
      cur.includes(dayId) ? cur.filter((id) => id !== dayId) : [...cur, dayId],
    );

  const allSelected = selected.length === plan.days.length;

  return (
    <div
      className="no-print fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Export as PDF"
      onClick={onClose}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-md flex-col rounded-xl bg-surface shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between p-5 pb-3">
          <div>
            <h2 className="text-base font-semibold">Export as PDF</h2>
            <p className="mt-0.5 text-sm text-muted">Choose the days to include.</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="text-muted hover:text-ink">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex items-center justify-between border-y border-line px-5 py-2 text-xs">
          <span className="text-muted">
            {selected.length} of {plan.days.length} {plan.days.length === 1 ? "day" : "days"}
          </span>
          <button
            onClick={() => setSelected(allSelected ? [] : plan.days.map((d) => d.dayId))}
            className="font-medium text-accent hover:underline"
          >
            {allSelected ? "Clear all" : "Select all"}
          </button>
        </div>

        <ul className="scrollbar-thin min-h-0 flex-1 divide-y divide-line overflow-y-auto">
          {plan.days.map((d, i) => (
            <li key={d.dayId}>
              <label className="flex cursor-pointer items-center gap-3 px-5 py-2.5 transition hover:bg-canvas">
                <input
                  type="checkbox"
                  checked={selected.includes(d.dayId)}
                  onChange={() => toggle(d.dayId)}
                  className="accent-teal-600"
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">
                    {d.title ?? `Day ${i + 1}`}
                  </span>
                  <span className="block text-xs text-muted">
                    {d.stops.length} {d.stops.length === 1 ? "stop" : "stops"}
                    {d.stops.length > 0 ? (
                      <>
                        {" "}
                        · {d.startTime}–{d.endTime}
                        {d.endDayOffset > 0 ? ` (+${d.endDayOffset}d)` : ""} ·{" "}
                        {formatDuration(d.totalTravelSec)}
                      </>
                    ) : null}
                  </span>
                </span>
              </label>
            </li>
          ))}
        </ul>

        <div className="border-t border-line px-5 py-3">
          <div className="flex flex-wrap gap-4 text-xs text-muted">
            <label className="inline-flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={descriptions}
                onChange={(e) => setDescriptions(e.target.checked)}
                className="accent-teal-600"
              />
              Descriptions
            </label>
            <label className="inline-flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={photos}
                onChange={(e) => setPhotos(e.target.checked)}
                className="accent-teal-600"
              />
              Photos
            </label>
          </div>

          {photos ? (
            <p className="mt-2 text-[11px] text-muted">
              Photos need “Background graphics” enabled in the browser’s print dialog.
            </p>
          ) : null}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-line p-5">
          <span className="text-xs text-muted">
            {summary.stops} stops · {formatDuration(summary.travel)} ·{" "}
            {formatDistance(summary.distance)}
          </span>
          <button
            onClick={() => onExport({ dayIds: selected, descriptions, photos })}
            disabled={selected.length === 0}
            className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-2 text-sm font-medium text-accent-fg transition hover:opacity-90 disabled:opacity-40"
          >
            <Printer className="h-4 w-4" />
            Export
          </button>
        </div>
      </div>
    </div>
  );
}
