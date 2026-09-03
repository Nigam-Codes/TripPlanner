"use client";

import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  GripVertical,
  Trash2,
  Wand2,
  Plus,
  Clock,
  AlertTriangle,
  Loader2,
  Share2,
  Footprints,
  Bike,
  Car,
} from "lucide-react";
import { AddPlaceSearch } from "./AddPlaceSearch";
import { formatDistance, formatDuration } from "@/lib/geo";
import { MODE_LABEL, MODES, type Mode, type Place, type PlannedTrip, type ScheduledDay } from "@/lib/types";

const MODE_ICON: Record<Mode, typeof Footprints> = { foot: Footprints, bike: Bike, car: Car };

export interface ItineraryPanelProps {
  plan: PlannedTrip;
  day: ScheduledDay;
  busy: string | null;
  savedNotice: string | null;
  onSelectDay: (dayId: string) => void;
  onAddDay: () => void;
  onRemoveDay: (dayId: string) => void;
  onSetStartTime: (dayId: string, time: string) => void;
  onSetMode: (mode: Mode) => void;
  onReorder: (dayId: string, stopIds: string[]) => void;
  onRemoveStop: (stopId: string) => void;
  onSetDwell: (stopId: string, minutes: number) => void;
  onOptimize: (dayId: string) => void;
  onShare: () => void;
  onHover: (placeId: string | null) => void;
  onAddPlace: (place: Place) => void;
}

export function ItineraryPanel(props: ItineraryPanelProps) {
  const { plan, day, busy, savedNotice } = props;

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const ids = day.stops.map((s) => s.stopId);
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    if (from < 0 || to < 0) return;
    props.onReorder(day.dayId, arrayMove(ids, from, to));
  }

  const ModeIcon = MODE_ICON[plan.trip.defaultMode];

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 border-b border-line p-4">
        <div className="mb-3 flex items-center gap-1.5 overflow-x-auto">
          {plan.days.map((d) => (
            <button
              key={d.dayId}
              onClick={() => props.onSelectDay(d.dayId)}
              className={`shrink-0 rounded-md px-2.5 py-1.5 text-xs font-medium transition ${
                d.dayId === day.dayId
                  ? "bg-ink text-white"
                  : "bg-canvas text-muted hover:text-ink"
              }`}
            >
              {d.title ?? `Day ${d.dayIndex + 1}`}
              <span className="ml-1.5 opacity-60">{d.stops.length}</span>
            </button>
          ))}
          <button
            onClick={props.onAddDay}
            title="Add a day"
            aria-label="Add a day"
            className="shrink-0 rounded-md border border-line px-2 py-1.5 text-muted transition hover:border-accent hover:text-accent"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs">
          <label className="flex items-center gap-1.5 text-muted">
            <Clock className="h-3.5 w-3.5" />
            Start
            <input
              type="time"
              value={day.startTime}
              onChange={(e) => props.onSetStartTime(day.dayId, e.target.value)}
              className="rounded border border-line bg-surface px-1.5 py-1"
            />
          </label>

          <div className="flex overflow-hidden rounded-md border border-line">
            {MODES.map((m) => {
              const Icon = MODE_ICON[m];
              const on = plan.trip.defaultMode === m;
              return (
                <button
                  key={m}
                  onClick={() => props.onSetMode(m)}
                  title={MODE_LABEL[m]}
                  aria-label={MODE_LABEL[m]}
                  aria-pressed={on}
                  className={`px-2 py-1.5 transition ${
                    on ? "bg-ink text-white" : "bg-surface text-muted hover:text-ink"
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" />
                </button>
              );
            })}
          </div>

          <button
            onClick={() => props.onOptimize(day.dayId)}
            disabled={day.stops.length < 3 || busy !== null}
            title={
              day.stops.length < 3 ? "Add at least three stops to optimize" : "Reorder to cut travel time"
            }
            className="inline-flex items-center gap-1.5 rounded-md border border-line px-2 py-1.5 font-medium text-muted transition hover:border-accent hover:text-accent disabled:opacity-40"
          >
            {busy === "optimize" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Wand2 className="h-3.5 w-3.5" />
            )}
            Optimize
          </button>

          <button
            onClick={props.onShare}
            className="ml-auto inline-flex items-center gap-1.5 rounded-md bg-accent px-2.5 py-1.5 font-medium text-accent-fg transition hover:opacity-90"
          >
            <Share2 className="h-3.5 w-3.5" />
            Share
          </button>
        </div>

        {savedNotice ? (
          <p className="mt-2 rounded-md bg-accent/10 px-2.5 py-1.5 text-xs text-accent">
            {savedNotice}
          </p>
        ) : null}
      </div>

      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto p-3">
        {day.stops.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted">
            No stops yet. Add places from the list on the left, click a dot on the map, or
            search for somewhere by name below.
          </p>
        ) : (
          <DndContext
            id="itinerary"
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={day.stops.map((s) => s.stopId)}
              strategy={verticalListSortingStrategy}
            >
              <ol className="space-y-1.5">
                {day.stops.map((s, i) => (
                  <SortableStop
                    key={s.stopId}
                    index={i}
                    stop={s}
                    mode={plan.trip.defaultMode}
                    onRemove={props.onRemoveStop}
                    onSetDwell={props.onSetDwell}
                    onHover={props.onHover}
                  />
                ))}
              </ol>
            </SortableContext>
          </DndContext>
        )}

        <div className="mt-2">
          <AddPlaceSearch
            origin={{ lat: plan.trip.cityLat, lon: plan.trip.cityLon }}
            onAdd={props.onAddPlace}
          />
        </div>
      </div>

      <div className="shrink-0 border-t border-line bg-surface p-4">
        <dl className="grid grid-cols-3 gap-2 text-center">
          <Stat label="Travel" value={formatDuration(day.totalTravelSec)} icon={<ModeIcon className="h-3 w-3" />} />
          <Stat label="Distance" value={formatDistance(day.totalDistanceM)} />
          <Stat label="Ends" value={day.endTime} />
        </dl>
        {plan.days.length > 1 ? (
          <button
            onClick={() => props.onRemoveDay(day.dayId)}
            className="mt-3 w-full rounded-md border border-line py-1.5 text-xs text-muted transition hover:border-red-300 hover:text-red-600"
          >
            Remove this day
          </button>
        ) : null}
      </div>
    </div>
  );
}

function Stat({ label, value, icon }: { label: string; value: string; icon?: React.ReactNode }) {
  return (
    <div className="rounded-md bg-canvas px-2 py-2">
      <dt className="flex items-center justify-center gap-1 text-[10px] tracking-wide text-muted uppercase">
        {icon}
        {label}
      </dt>
      <dd className="mt-0.5 text-sm font-semibold">{value}</dd>
    </div>
  );
}

function SortableStop({
  stop,
  index,
  mode,
  onRemove,
  onSetDwell,
  onHover,
}: {
  stop: ScheduledDay["stops"][number];
  index: number;
  mode: Mode;
  onRemove: (id: string) => void;
  onSetDwell: (id: string, minutes: number) => void;
  onHover: (placeId: string | null) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: stop.stopId,
  });

  const leg = stop.legFromPrevious;
  const LegIcon = MODE_ICON[leg?.mode ?? mode];

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      onMouseEnter={() => onHover(stop.place.id)}
      onMouseLeave={() => onHover(null)}
      className={`rounded-lg border bg-surface ${
        isDragging ? "z-10 border-accent shadow-lg" : "border-line"
      }`}
    >
      {leg ? (
        <p className="flex items-center gap-1.5 border-b border-dashed border-line px-3 py-1.5 text-[11px] text-muted">
          <LegIcon className="h-3 w-3" />
          {formatDuration(leg.durationSec)} · {formatDistance(leg.distanceM)}
          {leg.geometry ? null : <span className="italic">(estimated)</span>}
        </p>
      ) : null}

      <div className="flex items-start gap-2 p-2.5">
        <button
          {...attributes}
          {...listeners}
          aria-label={`Reorder ${stop.place.name}`}
          className="mt-0.5 cursor-grab touch-none text-muted active:cursor-grabbing"
        >
          <GripVertical className="h-4 w-4" />
        </button>

        <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent text-[11px] font-semibold text-accent-fg">
          {index + 1}
        </span>

        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{stop.place.name}</p>
          <p className="text-xs text-muted">
            {stop.arrival} – {stop.departure}
          </p>

          <label className="mt-1 flex items-center gap-1.5 text-[11px] text-muted">
            Stay
            <input
              type="number"
              min={5}
              step={5}
              value={stop.dwellMinutes}
              onChange={(e) => onSetDwell(stop.stopId, Number(e.target.value))}
              className="w-16 rounded border border-line bg-surface px-1.5 py-0.5"
            />
            min
          </label>

          {stop.closedWarning ? (
            <p className="mt-1.5 flex items-start gap-1 rounded bg-amber-50 px-1.5 py-1 text-[11px] text-amber-700">
              <AlertTriangle className="mt-px h-3 w-3 shrink-0" />
              {stop.closedWarning}
            </p>
          ) : null}
        </div>

        <button
          onClick={() => onRemove(stop.stopId)}
          aria-label={`Remove ${stop.place.name}`}
          className="mt-0.5 text-muted transition hover:text-red-600"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </li>
  );
}
