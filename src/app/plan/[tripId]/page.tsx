import { notFound } from "next/navigation";
import { PlanDashboard } from "@/components/PlanDashboard";
import { planTrip, shareStats } from "@/server/trip/service";

export const dynamic = "force-dynamic";

export default async function PlanPage({ params }: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await params;
  const plan = await planTrip(tripId);
  if (!plan) notFound();

  return <PlanDashboard initial={{ ...plan, share: shareStats(tripId) }} />;
}
