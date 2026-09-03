import { NextResponse } from "next/server";
import { addDay, planTrip, shareStats } from "@/server/trip/service";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const { tripId } = await req.json();
  if (typeof tripId !== "string") {
    return NextResponse.json({ error: "tripId is required" }, { status: 400 });
  }

  addDay(tripId);
  const plan = await planTrip(tripId);
  return NextResponse.json({ ...plan, share: shareStats(tripId) });
}
