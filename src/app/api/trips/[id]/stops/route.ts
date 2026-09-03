import { NextResponse } from "next/server";
import { addStop, planTrip, shareStats } from "@/server/trip/service";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params;
  const { dayId, place } = await req.json();

  if (typeof dayId !== "string" || !place?.id) {
    return NextResponse.json({ error: "dayId and place are required" }, { status: 400 });
  }

  addStop(dayId, place);
  const plan = await planTrip(id);
  return NextResponse.json({ ...plan, share: shareStats(id) });
}
