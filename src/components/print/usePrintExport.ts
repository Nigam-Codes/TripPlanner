"use client";

import { useCallback, useEffect, useState } from "react";
import type { PrintOptions } from "./PrintableItinerary";

/**
 * Drives the two-step export: render the printable document, then open the print
 * dialog once it has actually painted.
 *
 * Calling window.print() in the same tick as the state update prints the previous
 * frame — the printable block is not in the DOM yet — so it is deferred by a short
 * timeout. A timeout rather than requestAnimationFrame: a throttled frame loop would
 * mean the button silently did nothing, and this path must not depend on the tab
 * being actively animating.
 *
 * `afterprint` clears the block again; browsers that never fire it are harmless,
 * since the block is display:none on screen anyway.
 */
export function usePrintExport() {
  const [printOptions, setPrintOptions] = useState<PrintOptions | null>(null);

  const startPrint = useCallback((next: PrintOptions) => setPrintOptions(next), []);

  useEffect(() => {
    if (!printOptions) return;

    const clear = () => setPrintOptions(null);
    window.addEventListener("afterprint", clear);

    const timer = setTimeout(() => window.print(), 80);

    return () => {
      clearTimeout(timer);
      window.removeEventListener("afterprint", clear);
    };
  }, [printOptions]);

  return { printOptions, startPrint };
}
