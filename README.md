# Trip Planner

Search a city, set a radius, browse the sights inside it, add destinations hours away by
name, and build a day-by-day itinerary with real walking / cycling / driving times — then
share it as a read-only page.

Runs entirely in the browser on free OpenStreetMap services. **No server, no database, no
API keys, no accounts.**

**Live:** https://nigam-codes.github.io/TripPlanner/

## Quick start

```bash
npm install
```

```bash
npm run dev
```

## How it works

| Concern | Service | Notes |
|---|---|---|
| City search | Nominatim | 1 req/s, **autocomplete is forbidden**, so search runs on submit only |
| Places nearby | Overpass | 2 slots/IP — results cached 7 days in IndexedDB, single-flighted |
| Places by name | Nominatim | Any distance; `extratags=1` returns the wikidata id so enrichment still works |
| Descriptions & photos | Wikipedia / Wikidata | Batched; ~4 requests to enrich 80 places |
| Routing | FOSSGIS OSRM | Separate `routed-foot` / `routed-bike` / `routed-car` engines |
| Basemap | OpenFreeMap | Vector tiles, no key |
| Storage | localStorage + IndexedDB | Trips in localStorage; API responses in IndexedDB |

### Two ways to add a stop

**Within ~50 km — browse by radius.** The dashboard lists everything touristy inside the
circle, ranked.

**Anywhere further — search by name.** Radius discovery does not scale: an unfiltered
Overpass query at 400 km takes ~90 s *and* still truncates at the element cap, so it
returns an arbitrary slice rather than the best places. Above 25 km the app automatically
restricts to places carrying a `wikidata` tag (i.e. notable ones), which is what keeps a
50 km search at ~13 s. Beyond that, name the place instead — "Add a place by name" has no
distance limit at all, so a stop 5–6 hours away is one search.

### Ranking

OpenStreetMap has no ratings, so a raw radius query is an unranked pile in which a bus
shelter outranks a cathedral. Places are scored on tag prominence (Wikipedia and Wikidata
links, core tourism tags, area vs. node), the top ~80 are enriched, and the list is then
re-sorted by **Wikidata sitelink count** — how many language Wikipedias cover the subject —
a good, cheaply-batched fame proxy.

### Why not the OSRM demo server

`router.project-osrm.org` serves the **car profile only**. It answers HTTP 200 for
`/foot/` and `/bike/` and returns identical car durations for all three, so a
walking-first planner built on it would silently show driving times labelled "walking".
The FOSSGIS instances run a separate graph per mode; the profile segment in the URL path
is always the literal `driving` and the *host* selects the mode.

### Share links

There is no server, so a plan travels inside the URL fragment. To keep links short it
stores **identity, not content**: ids and coordinates only. The viewer's browser re-fetches
descriptions and photos from Wikidata/Wikipedia and re-routes the legs via OSRM. A 3-stop
trip encodes to ~370 characters; 20 stops stays under 2 000.

The fragment never reaches GitHub's servers. The trade-off is that links **cannot be
revoked or updated** — editing a trip produces a new link.

## Deploying

Pushing to `main` builds and publishes the site automatically via
`.github/workflows/deploy.yml` (GitHub Pages source: GitHub Actions). There is no manual
publish step.

Three things silently break a Next static export on GitHub Pages, all handled here:

1. **`public/.nojekyll`** — without it, Pages runs Jekyll, which ignores the `_next/`
   directory (leading underscore) and every asset 404s. This bit us once during setup:
   the first deploy served a Jekyll-rendered README instead of the app.
2. **`basePath`** — a project site lives under `/<repo>/`, so `basePath` and `assetPrefix`
   come from `NEXT_PUBLIC_BASE_PATH` (set to `/${{ github.event.repository.name }}` in CI),
   defaulting to `""` for local dev.
3. **The maplibre worker URL must include the basePath**, or the map renders markers on a
   blank canvas.

To reproduce a production build locally:

```bash
NEXT_PUBLIC_BASE_PATH=/TripPlanner npm run build
```

> On Windows, Git Bash rewrites a leading `/` into a Windows path — prefix the command with
> `MSYS_NO_PATHCONV=1` or `/TripPlanner` becomes `C:/Program Files/Git/TripPlanner`.

## Scripts

```bash
npm run dev      # dev server
npm run build    # static export to out/
npm test         # 37 unit tests
```

## Notes on the browser rewrite

This started as a Next.js server with API routes and SQLite (see the first commit). Moving
it into the browser surfaced three things worth recording:

- **Wikipedia and Wikidata send no `Access-Control-Allow-Origin` header unless the request
  carries `origin=*`.** Without it the browser blocks the response and descriptions, images
  *and* the popularity ranking vanish silently.
- **Overpass rejects browser User-Agents with HTTP 406** unless a `Referer` is present.
  Browsers send one automatically on cross-origin requests, so this works — but never set
  a `no-referrer` policy on the page, or discovery breaks everywhere at once.
- **`User-Agent` cannot be set from `fetch`.** The server build identified itself that way;
  the browser build relies on the `Referer` instead, which both Nominatim and Overpass
  accept.

`src/lib/**` (query building, dedupe, optimizer, scheduler) stayed completely unchanged
through the rewrite, along with its tests.

## Attribution

Place data © OpenStreetMap contributors (ODbL). Descriptions and images from Wikipedia
(CC BY-SA). Routing by the FOSSGIS OSRM service. Basemap by OpenFreeMap / OpenMapTiles.
These credits are rendered on every map and share page and are a licensing requirement,
not decoration.

All upstreams are donated infrastructure on a best-effort basis. Every outbound request is
rate-limited in `src/client/limiter.ts` and cached in `src/client/cache.ts`; please keep it
that way.
