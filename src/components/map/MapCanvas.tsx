"use client";

import { useEffect, useMemo, useRef } from "react";
import MapGL, { Layer, Marker, NavigationControl, Source, type MapRef } from "react-map-gl/maplibre";
import { setWorkerUrl } from "maplibre-gl";
import { withBasePath } from "@/lib/basePath";
import type { Feature, FeatureCollection, LineString } from "geojson";
import { categoryColor } from "@/lib/categories";
import type { Place, ScheduledDay } from "@/lib/types";

// Must run before any Map is constructed; the bundled worker path does not
// survive Next's bundling. See scripts/copy-maplibre-worker.mjs.
setWorkerUrl(withBasePath("/maplibre-gl-worker.mjs"));

const STYLE_URL =
  process.env.NEXT_PUBLIC_MAP_STYLE_URL ?? "https://tiles.openfreemap.org/styles/liberty";

/** Approximate a circle as a polygon; MapLibre has no native circle geometry. */
function circlePolygon(lat: number, lon: number, radiusM: number, steps = 96): Feature {
  const coords: [number, number][] = [];
  const latR = radiusM / 111_320;
  const lonR = radiusM / (111_320 * Math.cos((lat * Math.PI) / 180));

  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * 2 * Math.PI;
    coords.push([lon + lonR * Math.cos(a), lat + latR * Math.sin(a)]);
  }
  return { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [coords] } };
}

export interface MapCanvasProps {
  centre: { lat: number; lon: number };
  radiusM: number;
  places: Place[];
  day: ScheduledDay | null;
  selectedPlaceId: string | null;
  hoveredPlaceId: string | null;
  stopPlaceIds: Set<string>;
  onSelectPlace: (id: string | null) => void;
  onAddPlace: (place: Place) => void;
  /** Public share pages pass this so no add affordance can ever be rendered. */
  readOnly?: boolean;
}

export function MapCanvas({
  centre,
  radiusM,
  places,
  day,
  selectedPlaceId,
  hoveredPlaceId,
  stopPlaceIds,
  onSelectPlace,
  onAddPlace,
  readOnly = false,
}: MapCanvasProps) {
  const mapRef = useRef<MapRef>(null);

  // Keep the circle in view when the centre or radius changes.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const latPad = (radiusM * 1.25) / 111_320;
    const lonPad = (radiusM * 1.25) / (111_320 * Math.cos((centre.lat * Math.PI) / 180));
    map.fitBounds(
      [
        [centre.lon - lonPad, centre.lat - latPad],
        [centre.lon + lonPad, centre.lat + latPad],
      ],
      { padding: 40, duration: 600 },
    );
  }, [centre.lat, centre.lon, radiusM]);

  const circle = useMemo(
    () => circlePolygon(centre.lat, centre.lon, radiusM),
    [centre.lat, centre.lon, radiusM],
  );

  /** One line feature per leg, so each can be coloured by travel mode. */
  const routeFc = useMemo<FeatureCollection>(() => {
    const features: Feature[] = [];
    for (const stop of day?.stops ?? []) {
      const leg = stop.legFromPrevious;
      if (leg?.geometry) {
        features.push({
          type: "Feature",
          properties: { mode: leg.mode },
          geometry: leg.geometry as LineString,
        });
      }
    }
    return { type: "FeatureCollection", features };
  }, [day]);

  /** Legs the router could not draw are shown dashed, never as a solid route. */
  const estimatedFc = useMemo<FeatureCollection>(() => {
    const features: Feature[] = [];
    const stops = day?.stops ?? [];
    for (let i = 1; i < stops.length; i++) {
      if (!stops[i].legFromPrevious || stops[i].legFromPrevious?.geometry) continue;
      features.push({
        type: "Feature",
        properties: {},
        geometry: {
          type: "LineString",
          coordinates: [
            [stops[i - 1].place.lon, stops[i - 1].place.lat],
            [stops[i].place.lon, stops[i].place.lat],
          ],
        },
      });
    }
    return { type: "FeatureCollection", features };
  }, [day]);

  const stopOrder = useMemo(() => {
    const m = new Map<string, number>();
    (day?.stops ?? []).forEach((s, i) => m.set(s.place.id, i + 1));
    return m;
  }, [day]);

  // Markers are expensive; only render POIs that are not already stops.
  const poiMarkers = useMemo(
    () => places.filter((p) => !stopPlaceIds.has(p.id)).slice(0, 220),
    [places, stopPlaceIds],
  );

  return (
    <MapGL
      ref={mapRef}
      mapStyle={STYLE_URL}
      initialViewState={{ latitude: centre.lat, longitude: centre.lon, zoom: 13 }}
      style={{ width: "100%", height: "100%" }}
      attributionControl={{ compact: true }}
      onClick={() => onSelectPlace(null)}
    >
      <NavigationControl position="top-right" showCompass={false} />

      <Source id="radius" type="geojson" data={circle}>
        <Layer id="radius-fill" type="fill" paint={{ "fill-color": "#0d9488", "fill-opacity": 0.05 }} />
        <Layer
          id="radius-line"
          type="line"
          paint={{ "line-color": "#0d9488", "line-width": 1.5, "line-dasharray": [3, 2] }}
        />
      </Source>

      <Source id="route" type="geojson" data={routeFc}>
        <Layer
          id="route-casing"
          type="line"
          layout={{ "line-cap": "round", "line-join": "round" }}
          paint={{ "line-color": "#ffffff", "line-width": 7, "line-opacity": 0.9 }}
        />
        <Layer
          id="route-line"
          type="line"
          layout={{ "line-cap": "round", "line-join": "round" }}
          paint={{
            "line-width": 4,
            "line-color": [
              "match",
              ["get", "mode"],
              "foot",
              "#0d9488",
              "bike",
              "#7c3aed",
              "car",
              "#2563eb",
              "#0d9488",
            ],
          }}
        />
      </Source>

      <Source id="route-estimated" type="geojson" data={estimatedFc}>
        <Layer
          id="route-estimated-line"
          type="line"
          paint={{ "line-color": "#94a3b8", "line-width": 3, "line-dasharray": [2, 2] }}
        />
      </Source>

      {poiMarkers.map((p) => {
        const active = p.id === selectedPlaceId || p.id === hoveredPlaceId;
        return (
          <Marker
            key={p.id}
            latitude={p.lat}
            longitude={p.lon}
            anchor="center"
            onClick={(e) => {
              e.originalEvent.stopPropagation();
              onSelectPlace(p.id);
            }}
          >
            <button
              title={p.name}
              aria-label={p.name}
              className="block cursor-pointer rounded-full border-2 border-white transition-transform"
              style={{
                width: active ? 16 : 10,
                height: active ? 16 : 10,
                background: categoryColor(p.category),
                boxShadow: active ? "0 0 0 4px rgb(13 148 136 / 0.25)" : "0 1px 2px rgb(0 0 0 / 0.4)",
              }}
            />
          </Marker>
        );
      })}

      {(day?.stops ?? []).map((s) => (
        <Marker
          key={s.stopId}
          latitude={s.place.lat}
          longitude={s.place.lon}
          anchor="center"
          onClick={(e) => {
            e.originalEvent.stopPropagation();
            onSelectPlace(s.place.id);
          }}
        >
          <span
            className="flex items-center justify-center rounded-full border-2 border-white text-xs font-semibold text-white shadow-md"
            style={{
              width: 26,
              height: 26,
              background: s.place.id === selectedPlaceId ? "#0f172a" : "#0d9488",
            }}
          >
            {stopOrder.get(s.place.id)}
          </span>
        </Marker>
      ))}

      {selectedPlaceId ? (
        <SelectedCard
          place={
            places.find((p) => p.id === selectedPlaceId) ??
            day?.stops.find((s) => s.place.id === selectedPlaceId)?.place ??
            null
          }
          isStop={stopPlaceIds.has(selectedPlaceId)}
          readOnly={readOnly}
          onAdd={onAddPlace}
        />
      ) : null}
    </MapGL>
  );
}

function SelectedCard({
  place,
  isStop,
  readOnly,
  onAdd,
}: {
  place: Place | null;
  isStop: boolean;
  readOnly: boolean;
  onAdd: (p: Place) => void;
}) {
  if (!place) return null;

  return (
    <Marker latitude={place.lat} longitude={place.lon} anchor="bottom" offset={[0, -18]}>
      <div className="w-60 rounded-lg border border-line bg-surface p-3 shadow-lg">
        <p className="text-sm leading-snug font-semibold">{place.name}</p>
        {place.localName ? <p className="text-xs text-muted">{place.localName}</p> : null}
        {place.description ? (
          <p className="mt-1 line-clamp-3 text-xs text-muted">{place.description}</p>
        ) : null}
        {readOnly ? null : isStop ? (
          <p className="mt-2 text-xs font-medium text-accent">Already in this day</p>
        ) : (
          <button
            onClick={() => onAdd(place)}
            className="mt-2 w-full rounded-md bg-accent px-2 py-1.5 text-xs font-medium text-accent-fg hover:opacity-90"
          >
            Add to day
          </button>
        )}
      </div>
    </Marker>
  );
}
