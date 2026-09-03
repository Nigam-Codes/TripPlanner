"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { PlanDashboard } from "@/components/PlanDashboard";

/**
 * `/plan?id=…` rather than `/plan/[tripId]`.
 *
 * A static export cannot emit a dynamic segment without knowing every id at build
 * time, and trip ids are created in the browser.
 */
function Plan() {
  const id = useSearchParams().get("id");
  if (!id) {
    return (
      <main className="mx-auto max-w-md p-16 text-center text-sm text-muted">
        No trip selected.
      </main>
    );
  }
  return <PlanDashboard tripId={id} />;
}

export default function PlanPage() {
  return (
    <Suspense fallback={null}>
      <Plan />
    </Suspense>
  );
}
