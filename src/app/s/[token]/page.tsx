import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SharedPlanView } from "@/components/share/SharedPlanView";
import { getSharedPlan } from "@/server/trip/service";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ token: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { token } = await params;
  const plan = await getSharedPlan(token);
  return {
    title: plan ? `${plan.trip.title} — Trip Planner` : "Plan not found",
    // Shared links are unlisted; keep them out of search indexes.
    robots: { index: false, follow: false },
  };
}

export default async function SharedPlanPage({ params }: Props) {
  const { token } = await params;
  const plan = await getSharedPlan(token, { countView: true });
  if (!plan) notFound();

  return <SharedPlanView plan={plan} />;
}
