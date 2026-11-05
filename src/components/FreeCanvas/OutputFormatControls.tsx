import { useTranslation } from "react-i18next";
import { Input } from "@/components/ui/input";
import { supportsRichOutput } from "@/services/imageService";
import type { OutputFormat } from "@/services/types";
import { usePromptStore } from "@/stores/usePromptStore";
import { cn } from "@/utils/cn";

const FORMATS: OutputFormat[] = ["default", "gif", "svg"];

type OutputFormatControlsProps = {
  model: string;
  /** Managed sessions: the server fixes the SVG text model. */
  managed: boolean;
  /** Whether image inputs are present (GIF/SVG are text-to-image only). */
  hasImageInputs: boolean;
  className?: string;
};

/**
 * Output container picker for gpt-image-2.6 (raster / animated GIF / SVG).
 * Renders nothing for other models; the stored choice is ignored for them by
 * `effectiveOutputFormat`, so switching models never sends a stale format.
 */
export function OutputFormatControls({
  model,
  managed,
  hasImageInputs,
  className,
}: OutputFormatControlsProps) {
  const { t } = useTranslation();
  const {
    outputFormat,
    frameCount,
    frameDurationMs,
    svgModel,
    setOutputFormat,
    setFrameCount,
    setFrameDurationMs,
    setSvgModel,
  } = usePromptStore();

  if (!supportsRichOutput(model)) return null;

  const labelFor = (format: OutputFormat) =>
    format === "default" ? t("freeCanvas.outputFormatDefault") : format.toUpperCase();

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] font-medium text-zinc-400">
          {t("freeCanvas.outputFormatLabel")}
        </span>
        <div className="flex shrink-0 items-center gap-0.5 rounded-xl border border-white/10 bg-white/5 p-0.5">
          {FORMATS.map((format) => (
            <button
              key={format}
              type="button"
              className={cn(
                "shrink-0 cursor-pointer whitespace-nowrap rounded-lg px-2 py-0.5 text-[11px] font-medium transition-colors",
                outputFormat === format
                  ? "bg-white/20 font-bold text-white"
                  : "text-zinc-400 hover:text-white"
              )}
              onClick={() => setOutputFormat(format)}
            >
              {labelFor(format)}
            </button>
          ))}
        </div>

        {outputFormat === "gif" && (
          <>
            <label className="flex items-center gap-1 text-[11px] text-zinc-400">
              {t("freeCanvas.gifFrames")}
              <Input
                type="number"
                min={2}
                max={16}
                step={1}
                value={frameCount}
                onChange={(event) => {
                  const value = Math.round(Number(event.target.value));
                  if (Number.isFinite(value)) {
                    setFrameCount(Math.min(16, Math.max(2, value)));
                  }
                }}
                className="h-7 w-14 border-white/10 bg-black/30 font-mono text-xs"
              />
            </label>
            <label className="flex items-center gap-1 text-[11px] text-zinc-400">
              {t("freeCanvas.gifFrameDuration")}
              <Input
                type="number"
                min={20}
                step={10}
                value={frameDurationMs}
                onChange={(event) => {
                  const value = Math.round(Number(event.target.value) / 10) * 10;
                  if (Number.isFinite(value)) setFrameDurationMs(Math.max(20, value));
                }}
                className="h-7 w-16 border-white/10 bg-black/30 font-mono text-xs"
              />
              <span>ms</span>
            </label>
          </>
        )}

        {outputFormat === "svg" && !managed && (
          <label className="flex items-center gap-1 text-[11px] text-zinc-400">
            {t("freeCanvas.svgModelLabel")}
            <Input
              value={svgModel}
              onChange={(event) => setSvgModel(event.target.value)}
              placeholder="gpt-5.4-mini"
              className="h-7 w-36 border-white/10 bg-black/30 font-mono text-xs"
            />
          </label>
        )}
      </div>

      {outputFormat !== "default" && (
        <p
          className={cn(
            "text-[11px]",
            hasImageInputs ? "text-amber-300" : "text-zinc-500"
          )}
        >
          {hasImageInputs
            ? t("freeCanvas.richOutputImagesBlocked")
            : outputFormat === "gif"
              ? t("freeCanvas.gifHint")
              : t("freeCanvas.svgHint")}
        </p>
      )}
    </div>
  );
}
