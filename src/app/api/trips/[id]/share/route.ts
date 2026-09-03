import { NextResponse } from "next/server";
import { createShare, revokeShare, shareStats } from "@/server/trip/service";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(_req: Request, { params }: Ctx) {
  const { id } = await params;
  return NextResponse.json({ token: createShare(id) });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const { id } = await params;
  revokeShare(id);
  return NextResponse.json({ share: shareStats(id) });
}
