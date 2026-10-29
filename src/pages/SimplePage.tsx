import React from "react";
import { SimpleGeneratePanel } from "../components/Simple/SimpleGeneratePanel";
import { ResultsDock } from "../components/FreeCanvas/ResultsDock";

/**
 * Simple Generate is its own navigation segment, next to the free canvas. The results
 * panel is the same ResultsDock component over the same queue store, so the
 * generation history never forks into a second implementation.
 */
export function SimplePage() {
  return (
    <div className="relative flex min-h-0 w-full flex-1 overflow-hidden">
      <SimpleGeneratePanel />
      <ResultsDock variant="simple" />
    </div>
  );
}
