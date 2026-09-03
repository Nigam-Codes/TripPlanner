import { NextResponse } from "next/server";
import { planTrip, removeStop, shareStats, updateStop } from "@/server/trip/service";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** Mutating routes take tripId so they can return the freshly re-planned trip. */
async function replan(tripId: string | null) {
  if (!tripId) return NextResponse.json({ ok: true });
  const plan = await planTrip(tripId);
  return NextResponse.json({ ...plan, share: shareStats(tripId) });
}

export async function PATCH(req: Request, { params }: Ctx) {
  const { id } = await params;
  const { tripId, ...patch } = await req.json();
  updateStop(id, patch);
  return replan(tripId ?? null);
}

export async function DELETE(req: Request, { params }: Ctx) {
  const { id } = await params;
  const tripId = new URL(req.url).searchParams.get("tripId");
  removeStop(id);
  return replan(tripId);
}
