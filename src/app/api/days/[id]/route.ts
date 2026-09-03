import { NextResponse } from "next/server";
import { planTrip, removeDay, shareStats, updateDay } from "@/server/trip/service";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, { params }: Ctx) {
  const { id } = await params;
  const { tripId, ...patch } = await req.json();
  updateDay(id, patch);
  const plan = await planTrip(tripId);
  return NextResponse.json({ ...plan, share: shareStats(tripId) });
}

export async function DELETE(req: Request, { params }: Ctx) {
  const { id } = await params;
  const tripId = new URL(req.url).searchParams.get("tripId");
  removeDay(id);
  if (!tripId) return NextResponse.json({ ok: true });
  const plan = await planTrip(tripId);
  return NextResponse.json({ ...plan, share: shareStats(tripId) });
}
