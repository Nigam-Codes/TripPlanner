# Trip Planner

Search a city, set a radius, browse the sights inside it, and build a day-by-day
itinerary with real walking / cycling / driving times — then publish it as a
read-only page anyone can open.

Built entirely on free OpenStreetMap services. **No API keys, no billing account.**

## Quick start

```bash
npm install
```

Set a real contact address in `.env.local` before first run — Nominatim blocks
generic User-Agents, and a placeholder will get the IP banned:

```
NOMINATIM_USER_AGENT="TripPlanner/0.1 (you@example.com)"
```

```bash
npm run db:push
```

```bash
npm run dev
```

Then open http://localhost:3000.

## How it works

| Concern | Service | Notes |
|---|---|---|
| City search | Nominatim | 1 req/s, **autocomplete is forbidden**, so search runs on submit only |
| Places | Overpass | 2 slots/IP — results cached 7 days, single-flighted |
| Descriptions & photos | Wikipedia / Wikidata | Batched; ~4 requests to enrich 80 places |
| Routing | FOSSGIS OSRM | Separate `routed-foot` / `routed-bike` / `routed-car` engines |
| Basemap | OpenFreeMap | Vector tiles, no key |
| Storage | SQLite (`data/tripplanner.db`) | Created by `npm run db:push` |

### Ranking

OpenStreetMap has no ratings, so a raw radius query is an unranked pile in which a
bus shelter outranks a cathedral. Places are scored on tag prominence (Wikipedia
and Wikidata links, core tourism tags, area vs. node), the top ~80 are enriched,
and the list is then re-sorted by **Wikidata sitelink count** — how many language
Wikipedias cover the subject — which is a good, cheaply-batched fame proxy.

### Why not the OSRM demo server

`router.project-osrm.org` serves the **car profile only**. It returns HTTP 200 for
`/foot/` and `/bike/` and gives identical car durations for all three, so a
walking-first planner built on it would silently show driving times labelled
"walking". The FOSSGIS instances run a separate graph per mode; the profile
segment in the URL path is always the literal `driving` and the *host* selects the
mode.

Valhalla was evaluated first (it would also have given isochrones) but
`valhalla1.openstreetmap.de` was unreachable during development. `ors.ts`
implements the same interface as an opt-in fallback:

```
ROUTING_PROVIDER=ors
ORS_API_KEY=<free key, no card>
```

### Shared plans work offline

Stops reference permanently-stored `places` rows and routed legs are persisted in
`route_cache`, so `/s/<token>` renders entirely from the database. Verified: with
Overpass, Nominatim and the routers all pointed at an unreachable host, the share
page still returns 200 in ~80 ms with every name, time, total and description
intact. A shared plan cannot break because a POI changed upstream or Overpass
rate-limited you.

Links are unguessable 22-character tokens, `noindex`, and revocable.

## Scripts

```bash
npm run dev      # dev server
npm run build    # production build
npm test         # 29 unit tests: query building, dedupe, optimizer, scheduler
npm run db:push  # apply the schema
```

## A note on the map worker

`scripts/copy-maplibre-worker.mjs` (wired to `predev`/`prebuild`) copies
maplibre's worker and its shared chunk into `public/`. maplibre resolves its
worker relative to `import.meta.url`; once Next bundles the library that sibling
path no longer exists, the request falls through to the HTML 404 page, and the
browser rejects it for having a `text/html` MIME type. The map then renders
markers but never a single tile. `setWorkerUrl()` in `MapCanvas.tsx` points at the
copied file.

## Attribution

Place data © OpenStreetMap contributors (ODbL). Descriptions and images from
Wikipedia (CC BY-SA). Routing by the FOSSGIS OSRM service. Basemap by OpenFreeMap
/ OpenMapTiles. These credits are rendered on every map and share page and are a
licensing requirement, not decoration.

All upstreams are donated infrastructure on a best-effort basis. Every outbound
request is rate-limited and identified in `src/server/limiter.ts`; please keep it
that way.
