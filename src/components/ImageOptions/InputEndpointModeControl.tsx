import { useTranslation } from "react-i18next";
import { cn } from "@/utils/cn";
import { useConfigStore } from "@/stores/useConfigStore";
import { useRuntimeImageState } from "@/hooks/useRuntimeImageState";
import type { InputEndpointMode } from "@/services/types";

const MODES: readonly InputEndpointMode[] = ["auto", "generations", "edits"];

/**
 * Which endpoint requests with input images use. The canvas, Simple and the
 * workflow generator all show this one setting, so they stay in sync. Managed
 * sessions never reach the upstream directly, so nothing renders there.
 */
export function InputEndpointModeControl({ className }: { className?: string }) {
  const { t } = useTranslation();
  const { mode: runtimeMode } = useRuntimeImageState();
  const value = useConfigStore(
    (state) => state.imageConfig.inputEndpointMode ?? "auto"
  );
  const updateImageConfig = useConfigStore((state) => state.updateImageConfig);

  if (runtimeMode === "managed") return null;

  return (
    <div className={cn("flex shrink-0 items-center gap-1", className)}>
      <span className="whitespace-nowrap text-[11px] font-medium text-zinc-400">
        {t("imageOptions.endpoint.label")}
      </span>
      <div
        role="radiogroup"
        aria-label={t("imageOptions.endpoint.label")}
        className="flex shrink-0 items-center gap-0.5 rounded-xl border border-white/10 bg-white/5 p-0.5"
      >
        {MODES.map((mode) => (
          <button
            key={mode}
            type="button"
            role="radio"
            aria-checked={value === mode}
            title={t(`imageOptions.endpoint.hint.${mode}`)}
            onClick={() => updateImageConfig({ inputEndpointMode: mode })}
            className={cn(
              "shrink-0 cursor-pointer whitespace-nowrap rounded-lg px-1.5 py-0.5 text-[11px] font-medium transition-colors",
              value === mode
                ? "bg-white/20 font-bold text-white"
                : "text-zinc-400 hover:text-white"
            )}
          >
            {t(`imageOptions.endpoint.mode.${mode}`)}
          </button>
        ))}
      </div>
    </div>
  );
}
