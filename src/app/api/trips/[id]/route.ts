import { NextResponse } from "next/server";
import { deleteTrip, planTrip, updateTrip, shareStats } from "@/server/trip/service";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const plan = await planTrip(id);
  if (!plan) return NextResponse.json({ error: "Trip not found" }, { status: 404 });
  return NextResponse.json({ ...plan, share: shareStats(id) });
}

export async function PATCH(req: Request, { params }: Ctx) {
  const { id } = await params;
  const body = await req.json();
  updateTrip(id, body ?? {});
  const plan = await planTrip(id);
  if (!plan) return NextResponse.json({ error: "Trip not found" }, { status: 404 });
  return NextResponse.json({ ...plan, share: shareStats(id) });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const { id } = await params;
  deleteTrip(id);
  return NextResponse.json({ ok: true });
}
