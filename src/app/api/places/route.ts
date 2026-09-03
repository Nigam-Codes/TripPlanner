import { NextResponse } from "next/server";
import { findPlaces } from "@/server/providers/places";
import { enrichPlaces } from "@/server/providers/enrich";

export const dynamic = "force-dynamic";

const MAX_RADIUS_M = 20_000;

export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const lat = Number(sp.get("lat"));
  const lon = Number(sp.get("lon"));
  const radius = Math.min(Number(sp.get("radius")) || 3000, MAX_RADIUS_M);
  const cats = (sp.get("categories") ?? "").split(",").filter(Boolean);

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return NextResponse.json({ error: "lat and lon are required" }, { status: 400 });
  }

  try {
    const found = await findPlaces(lat, lon, radius, cats.length ? cats : undefined);
    const ranked = await enrichPlaces(found);
    return NextResponse.json({ places: ranked, count: ranked.length });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Place search failed" },
      { status: 502 },
    );
  }
}
