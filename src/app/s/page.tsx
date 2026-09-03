"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { SharedPlanView } from "@/components/share/SharedPlanView";
import { decodePlan } from "@/client/share";
import { hydratePlaces } from "@/client/providers/enrich";
import { getLegs } from "@/client/providers/routing";
import { buildSchedule } from "@/lib/schedule";
import type { PlannedTrip } from "@/lib/types";

/**
 * Public read-only plan, rebuilt entirely from the URL fragment.
 *
 * The fragment never leaves the browser — it is not sent to GitHub's servers — and it
 * carries only ids and coordinates. Descriptions, images and route geometry are
 * re-fetched here, which is what keeps the link short.
 */
export default function SharedPage() {
  const [plan, setPlan] = useState<PlannedTrip | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "invalid">("loading");

  useEffect(() => {
    void (async () => {
      const encoded = window.location.hash.slice(1);
      if (!encoded) return setState("invalid");

      const decoded = await decodePlan(encoded);
      if (!decoded) return setState("invalid");

      document.title = `${decoded.title} — Trip Planner`;

      const days = [];
      for (const [i, d] of decoded.days.entries()) {
        const places = await hydratePlaces(d.stops.map((s) => s.place));
        const legs = await getLegs(
          places.map((p) => ({ lat: p.lat, lon: p.lon })),
          decoded.mode,
        );

        days.push(
          buildSchedule({
            dayId: `d${i}`,
            dayIndex: i,
            title: d.title,
            date: null,
            startTime: d.startTime,
            stops: places.map((place, j) => ({
              stopId: `d${i}s${j}`,
              place,
              dwellMinutes: d.stops[j].dwellMinutes,
              mode: decoded.mode,
              legFromPrevious: j === 0 ? null : (legs[j - 1] ?? null),
            })),
          }),
        );
      }

      setPlan({
        trip: {
          id: "shared",
          title: decoded.title,
          cityName: decoded.cityName,
          cityLat: decoded.cityLat,
          cityLon: decoded.cityLon,
          radiusM: decoded.radiusM,
          defaultMode: decoded.mode,
        },
        days,
      });
      setState("ready");
    })();
  }, []);

  if (state === "loading") {
    return (
      <main className="flex h-screen items-center justify-center gap-2 text-sm text-muted">
        <Loader2 className="h-4 w-4 animate-spin" />
        Rebuilding plan…
      </main>
    );
  }

  if (state === "invalid" || !plan) {
    return (
      <main className="mx-auto max-w-md p-16 text-center">
        <p className="mb-2 font-medium">This link is not readable</p>
        <p className="mb-4 text-sm text-muted">
          It may have been truncated in transit — share links are long, and some apps cut
          them short. Ask for the full link.
        </p>
        <Link href="/" className="text-sm text-accent underline">
          Go to Trip Planner
        </Link>
      </main>
    );
  }

  return <SharedPlanView plan={plan} />;
}
