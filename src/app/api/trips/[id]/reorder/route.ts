import { NextResponse } from "next/server";
import { planTrip, reorderStops, shareStats } from "@/server/trip/service";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params;
  const { dayId, stopIds } = await req.json();

  if (typeof dayId !== "string" || !Array.isArray(stopIds)) {
    return NextResponse.json({ error: "dayId and stopIds are required" }, { status: 400 });
  }

  reorderStops(dayId, stopIds);
  const plan = await planTrip(id);
  return NextResponse.json({ ...plan, share: shareStats(id) });
}
