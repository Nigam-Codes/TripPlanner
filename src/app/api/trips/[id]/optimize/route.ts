import { NextResponse } from "next/server";
import { optimizeDay, planTrip, shareStats } from "@/server/trip/service";
import type { Mode } from "@/lib/types";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params;
  const { dayId, mode, pinStart, pinEnd } = await req.json();

  if (typeof dayId !== "string") {
    return NextResponse.json({ error: "dayId is required" }, { status: 400 });
  }

  const { savedSec } = await optimizeDay(dayId, (mode as Mode) ?? "foot", { pinStart, pinEnd });
  const plan = await planTrip(id);
  return NextResponse.json({ ...plan, share: shareStats(id), savedSec });
}
