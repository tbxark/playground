import React from "react";
import { Navigate, useSearchParams } from "react-router-dom";
import { useHotkeys } from "react-hotkeys-hook";
import { FreeCanvasViewport } from "../components/FreeCanvas/FreeCanvasViewport";
import { FreeCanvasToolbar } from "../components/FreeCanvas/FreeCanvasToolbar";
import { FreeCanvasCommandBar } from "../components/FreeCanvas/FreeCanvasCommandBar";
import { ResultsDock } from "../components/FreeCanvas/ResultsDock";
import { FreeCanvasBridgeProvider } from "../components/FreeCanvas/FreeCanvasBridge";
import { useGenerateAction } from "../hooks/useGenerateAction";
import { isImeComposing, isOverlayOpen } from "@/utils/keyboard";

/**
 * The card-based free canvas. Simple Generate lives on its own route (`/simple`); the
 * old `/?mode=simple` deep link is redirected there so bookmarks keep working.
 */
export function FreeCanvasPage() {
  const [searchParams] = useSearchParams();
  const { generate } = useGenerateAction("canvas");

  // Quick generate whenever the caret is inside a prompt textarea. IME
  // composition keeps Enter for confirming candidates; an open confirm dialog
  // or the lightbox must swallow the shortcut instead of submitting a paid
  // request from underneath the overlay.
  useHotkeys(
    "mod+enter",
    () => {
      void generate();
    },
    {
      enableOnFormTags: ["textarea"],
      ignoreEventWhen: (event) => isImeComposing(event) || isOverlayOpen(),
    },
    [generate]
  );

  // Hooks above must stay unconditional: navigating from `/` to
  // `/?mode=simple` re-renders this same component before the redirect wins.
  if (searchParams.get("mode") === "simple") {
    return <Navigate to="/simple" replace />;
  }

  return (
    <FreeCanvasBridgeProvider>
      <div className="relative flex min-h-0 w-full flex-1 overflow-hidden">
        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <FreeCanvasToolbar />

          <FreeCanvasViewport />

          <div className="pointer-events-none absolute inset-x-0 bottom-4 z-20 flex justify-center">
            <FreeCanvasCommandBar />
          </div>
        </div>

        <ResultsDock />
      </div>
    </FreeCanvasBridgeProvider>
  );
}
