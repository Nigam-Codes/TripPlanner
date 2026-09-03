import { NextResponse } from "next/server";
import { createTrip, listTrips } from "@/server/trip/service";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ trips: listTrips() });
}

export async function POST(req: Request) {
  const body = await req.json();
  const { cityName, cityLat, cityLon, radiusM, title } = body ?? {};

  if (typeof cityName !== "string" || !Number.isFinite(cityLat) || !Number.isFinite(cityLon)) {
    return NextResponse.json({ error: "cityName, cityLat and cityLon are required" }, { status: 400 });
  }

  const id = createTrip({ cityName, cityLat, cityLon, radiusM, title });
  return NextResponse.json({ id }, { status: 201 });
}
