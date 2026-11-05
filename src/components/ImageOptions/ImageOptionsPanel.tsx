import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDownIcon, SlidersHorizontalIcon } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/utils/cn";
import { usePromptStore } from "@/stores/usePromptStore";
import {
  DEFAULT_SVG_MODEL,
  GIF_FRAME_COUNT_DEFAULT,
  GIF_FRAME_COUNT_MAX,
  GIF_FRAME_COUNT_MIN,
  GIF_FRAME_DURATION_DEFAULT_MS,
  GIF_FRAME_DURATION_MIN_MS,
  IMAGE_BACKGROUNDS,
  IMAGE_COMPLEXITIES,
  IMAGE_MODERATIONS,
  IMAGE_QUALITIES,
  IMAGE_VERSIONS,
  SAFETY_IDENTIFIER_MAX_LENGTH,
  SVG_REASONING_EFFORTS,
  getImageModelCaps,
  gifFrameSize,
  parseExactSize,
  validateExactSize,
  type ImageOptions,
  type ImageOutputFormat,
} from "../../../shared/imageModels";

const SELECT_CLASS =
  "h-7 min-w-0 cursor-pointer rounded-lg border border-white/10 bg-black/30 px-2 text-xs text-zinc-200 outline-none hover:bg-white/10";
const INPUT_CLASS = "h-7 border-white/10 bg-black/30 text-xs";

function Field({
  label,
  hint,
  className,
  children,
}: {
  label: string;
  hint?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <label className={cn("flex min-w-0 flex-col gap-1", className)}>
      <span className="text-[11px] font-medium text-zinc-400">{label}</span>
      {children}
      {hint && <span className="text-[10px] leading-tight text-zinc-500">{hint}</span>}
    </label>
  );
}

type ImageOptionsPanelProps = {
  model: string;
  /** Managed sessions: the server fixes the SVG text model. */
  managed: boolean;
  value: ImageOptions;
  onChange: (patch: Partial<ImageOptions>) => void;
  /** Current aspect ratio / exact size, edited from the "more options" block. */
  size: string;
  onSizeChange: (size: string) => void;
  className?: string;
};

/**
 * Parameter panel for APIMart gpt-image-2.5 / 2.6 models (and their `-ext`
 * variants): output format (PNG/JPEG/WebP/GIF/SVG), quality, GIF frames, SVG
 * model, and a collapsible block with everything else. What shows up follows
 * `getImageModelCaps`, so each model only exposes what it really accepts.
 * Renders nothing for any other model. Controlled so the prompt store and the
 * workflow node data share one UI.
 */
export function ImageOptionsPanel({
  model,
  managed,
  value,
  onChange,
  size,
  onSizeChange,
  className,
}: ImageOptionsPanelProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const [customDraft, setCustomDraft] = useState("");

  const exactSize = parseExactSize(size);
  useEffect(() => {
    // Keep the custom field in sync when the size is changed elsewhere
    // (ratio pills, another model, a restored workflow). Depends on `size`
    // only, so half-typed text is not overwritten while the size is unchanged.
    setCustomDraft(parseExactSize(size) ? size : "");
  }, [size]);

  const caps = getImageModelCaps(model);
  if (!caps) return null;

  const format: ImageOutputFormat = value.outputFormat ?? "png";
  const lossy = format === "jpeg" || format === "webp";
  const showBackground = caps.background && (format === "png" || format === "webp");
  const customSizeError =
    customDraft.trim() && caps.customSize ? validateExactSize(customDraft) : null;
  const sizeSelectValue = exactSize
    ? "custom"
    : caps.ratios.includes(size)
      ? size
      : "auto";

  const set = <K extends keyof ImageOptions>(key: K, next: ImageOptions[K]) =>
    onChange({ [key]: next } as Partial<ImageOptions>);
  const numberOrUndefined = (raw: string) => {
    if (raw.trim() === "") return undefined;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : undefined;
  };

  const hasMore =
    showBackground ||
    caps.moderation ||
    caps.complexity ||
    caps.version ||
    caps.safetyIdentifier ||
    caps.ratios.length > 0;

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        {caps.formats.length > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-medium text-zinc-400">
              {t("imageOptions.output")}
            </span>
            <div className="flex shrink-0 items-center gap-0.5 rounded-xl border border-white/10 bg-white/5 p-0.5">
              {caps.formats.map((item) => (
                <button
                  key={item}
                  type="button"
                  className={cn(
                    "shrink-0 cursor-pointer whitespace-nowrap rounded-lg px-2 py-0.5 text-[11px] font-medium uppercase transition-colors",
                    format === item
                      ? "bg-white/20 font-bold text-white"
                      : "text-zinc-400 hover:text-white"
                  )}
                  onClick={() => set("outputFormat", item === "png" ? undefined : item)}
                >
                  {item}
                </button>
              ))}
            </div>
          </div>
        )}

        {caps.quality && (
          <label className="flex items-center gap-2 text-[11px] font-medium text-zinc-400">
            {t("imageOptions.quality")}
            <select
              value={value.quality ?? ""}
              onChange={(event) =>
                set("quality", (event.target.value || undefined) as ImageOptions["quality"])
              }
              className={SELECT_CLASS}
            >
              <option value="" className="bg-zinc-900 text-white">
                {t("imageOptions.auto")}
              </option>
              {IMAGE_QUALITIES.map((item) => (
                <option key={item} value={item} className="bg-zinc-900 text-white">
                  {item}
                </option>
              ))}
            </select>
          </label>
        )}

        {hasMore && (
          <button
            type="button"
            className={cn(
              "flex h-7 shrink-0 cursor-pointer items-center gap-1 rounded-xl border px-2 text-[11px] transition-colors",
              expanded
                ? "border-white/30 bg-white/20 font-semibold text-white"
                : "border-white/10 bg-white/5 text-zinc-400 hover:bg-white/10 hover:text-white"
            )}
            onClick={() => setExpanded((open) => !open)}
            aria-expanded={expanded}
          >
            <SlidersHorizontalIcon className="size-3" />
            {t("imageOptions.more")}
            <ChevronDownIcon
              className={cn("size-3 transition-transform", expanded && "rotate-180")}
            />
          </button>
        )}
      </div>

      {/* Format-specific controls stay visible: they are the point of picking the format. */}
      {lossy && caps.compression && (
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between text-[11px] text-zinc-400">
            <span>{t("imageOptions.compression")}</span>
            <span className="flex items-center gap-2 font-mono text-zinc-200">
              {value.outputCompression ?? t("imageOptions.providerDefault")}
              {value.outputCompression !== undefined && (
                <button
                  type="button"
                  onClick={() => set("outputCompression", undefined)}
                  className="cursor-pointer font-sans text-[10px] text-primary hover:underline"
                >
                  {t("imageOptions.reset")}
                </button>
              )}
            </span>
          </div>
          <Slider
            min={0}
            max={100}
            step={1}
            value={[value.outputCompression ?? 100]}
            onValueChange={([next]) => set("outputCompression", next)}
          />
        </div>
      )}

      {format === "gif" && caps.gifFrames && (
        <div className="flex flex-wrap items-end gap-2">
          <Field label={t("imageOptions.gifFrames")} className="w-20">
            <Input
              type="number"
              min={GIF_FRAME_COUNT_MIN}
              max={GIF_FRAME_COUNT_MAX}
              step={1}
              placeholder={String(GIF_FRAME_COUNT_DEFAULT)}
              value={value.frameCount ?? ""}
              onChange={(event) => set("frameCount", numberOrUndefined(event.target.value))}
              onBlur={() => {
                if (value.frameCount === undefined) return;
                set(
                  "frameCount",
                  Math.min(
                    GIF_FRAME_COUNT_MAX,
                    Math.max(GIF_FRAME_COUNT_MIN, Math.round(value.frameCount))
                  )
                );
              }}
              className={cn(INPUT_CLASS, "font-mono")}
            />
          </Field>
          <Field label={t("imageOptions.gifFrameDuration")} className="w-24">
            <Input
              type="number"
              min={GIF_FRAME_DURATION_MIN_MS}
              step={10}
              placeholder={String(GIF_FRAME_DURATION_DEFAULT_MS)}
              value={value.frameDurationMs ?? ""}
              onChange={(event) =>
                set("frameDurationMs", numberOrUndefined(event.target.value))
              }
              onBlur={() => {
                if (value.frameDurationMs === undefined) return;
                set(
                  "frameDurationMs",
                  Math.max(
                    GIF_FRAME_DURATION_MIN_MS,
                    Math.round(value.frameDurationMs / 10) * 10
                  )
                );
              }}
              className={cn(INPUT_CLASS, "font-mono")}
            />
          </Field>
          <span className="pb-1.5 text-[10px] text-zinc-500">
            {t("imageOptions.gifFrameSize", { size: gifFrameSize(size) })}
          </span>
        </div>
      )}

      {format === "svg" && caps.svg && (
        <div className="flex flex-wrap items-end gap-2">
          {!managed && (
            <Field label={t("imageOptions.svgModel")} className="w-40">
              <Input
                value={value.svgModel ?? ""}
                onChange={(event) => set("svgModel", event.target.value || undefined)}
                placeholder={DEFAULT_SVG_MODEL}
                className={cn(INPUT_CLASS, "font-mono")}
              />
            </Field>
          )}
          <Field label={t("imageOptions.svgEffort")}>
            <select
              value={value.svgReasoningEffort ?? ""}
              onChange={(event) =>
                set(
                  "svgReasoningEffort",
                  (event.target.value || undefined) as ImageOptions["svgReasoningEffort"]
                )
              }
              className={SELECT_CLASS}
            >
              <option value="" className="bg-zinc-900 text-white">
                {t("imageOptions.providerDefault")}
              </option>
              {SVG_REASONING_EFFORTS.map((item) => (
                <option key={item} value={item} className="bg-zinc-900 text-white">
                  {item}
                </option>
              ))}
            </select>
          </Field>
        </div>
      )}

      {(format === "gif" || format === "svg") && (
        <p className="text-[10px] leading-tight text-zinc-500">
          {format === "gif" && caps.ext
            ? t("imageOptions.gifExtHint")
            : format === "gif"
              ? t("imageOptions.gifHint")
              : t("imageOptions.svgHint")}
        </p>
      )}

      {expanded && hasMore && (
        <div className="grid animate-in grid-cols-2 gap-2.5 rounded-xl border border-white/10 bg-black/20 p-2.5 fade-in-0 sm:grid-cols-3">
          {caps.ratios.length > 0 && (
            <Field label={t("imageOptions.aspect")}>
              <select
                value={sizeSelectValue}
                onChange={(event) => {
                  if (event.target.value !== "custom") onSizeChange(event.target.value);
                }}
                className={SELECT_CLASS}
              >
                {sizeSelectValue === "custom" && (
                  <option value="custom" className="bg-zinc-900 text-white">
                    {t("imageOptions.customSizeOption")}
                  </option>
                )}
                {caps.ratios.map((ratio) => (
                  <option key={ratio} value={ratio} className="bg-zinc-900 text-white">
                    {ratio === "auto" ? t("imageOptions.auto") : ratio}
                  </option>
                ))}
              </select>
            </Field>
          )}

          {caps.customSize && format !== "gif" && (
            <Field
              label={t("imageOptions.customSize")}
              hint={
                customSizeError
                  ? t(`imageOptions.sizeError.${customSizeError}`)
                  : t("imageOptions.customSizeHint")
              }
            >
              <Input
                value={customDraft}
                placeholder="1600x1200"
                onChange={(event) => {
                  const next = event.target.value;
                  setCustomDraft(next);
                  if (next.trim() === "") onSizeChange("auto");
                  else if (parseExactSize(next)) onSizeChange(next.trim());
                }}
                className={cn(
                  INPUT_CLASS,
                  "font-mono",
                  customSizeError && "border-amber-400/60"
                )}
              />
            </Field>
          )}

          {caps.version && (
            <Field label={t("imageOptions.version")}>
              <select
                value={value.version ?? ""}
                onChange={(event) =>
                  set("version", (event.target.value || undefined) as ImageOptions["version"])
                }
                className={SELECT_CLASS}
              >
                <option value="" className="bg-zinc-900 text-white">
                  {t("imageOptions.providerDefault")}
                </option>
                {IMAGE_VERSIONS.map((item) => (
                  <option key={item} value={item} className="bg-zinc-900 text-white">
                    {item}
                  </option>
                ))}
              </select>
            </Field>
          )}

          {caps.complexity && (
            <Field label={t("imageOptions.complexity")}>
              <select
                value={value.complexity ?? ""}
                onChange={(event) =>
                  set(
                    "complexity",
                    (event.target.value || undefined) as ImageOptions["complexity"]
                  )
                }
                className={SELECT_CLASS}
              >
                <option value="" className="bg-zinc-900 text-white">
                  {t("imageOptions.providerDefault")}
                </option>
                {IMAGE_COMPLEXITIES.map((item) => (
                  <option key={item} value={item} className="bg-zinc-900 text-white">
                    {item}
                  </option>
                ))}
              </select>
            </Field>
          )}

          {showBackground && (
            <Field label={t("imageOptions.background")}>
              <select
                value={value.background ?? ""}
                onChange={(event) =>
                  set(
                    "background",
                    (event.target.value || undefined) as ImageOptions["background"]
                  )
                }
                className={SELECT_CLASS}
              >
                <option value="" className="bg-zinc-900 text-white">
                  {t("imageOptions.providerDefault")}
                </option>
                {IMAGE_BACKGROUNDS.map((item) => (
                  <option
                    key={item}
                    value={item}
                    disabled={item === "transparent" && format !== "png" && format !== "webp"}
                    className="bg-zinc-900 text-white"
                  >
                    {item}
                  </option>
                ))}
              </select>
            </Field>
          )}

          {caps.moderation && (
            <Field label={t("imageOptions.moderation")}>
              <select
                value={value.moderation ?? ""}
                onChange={(event) =>
                  set(
                    "moderation",
                    (event.target.value || undefined) as ImageOptions["moderation"]
                  )
                }
                className={SELECT_CLASS}
              >
                <option value="" className="bg-zinc-900 text-white">
                  {t("imageOptions.providerDefault")}
                </option>
                {IMAGE_MODERATIONS.map((item) => (
                  <option key={item} value={item} className="bg-zinc-900 text-white">
                    {item}
                  </option>
                ))}
              </select>
            </Field>
          )}

          {caps.safetyIdentifier && (
            <Field
              label={t("imageOptions.safetyId")}
              hint={t("imageOptions.safetyIdHint")}
              className="col-span-2 sm:col-span-1"
            >
              <Input
                value={value.safetyIdentifier ?? ""}
                maxLength={SAFETY_IDENTIFIER_MAX_LENGTH}
                onChange={(event) =>
                  set("safetyIdentifier", event.target.value || undefined)
                }
                className={cn(INPUT_CLASS, "font-mono")}
              />
            </Field>
          )}
        </div>
      )}
    </div>
  );
}

/** Prompt-store bound variant used by Simple and the free canvas. */
export function PromptImageOptions({
  model,
  managed,
  className,
}: {
  model: string;
  managed: boolean;
  className?: string;
}) {
  const imageOptions = usePromptStore((state) => state.imageOptions);
  const setImageOptions = usePromptStore((state) => state.setImageOptions);
  const size = usePromptStore((state) => state.size);
  const setSize = usePromptStore((state) => state.setSize);

  return (
    <ImageOptionsPanel
      model={model}
      managed={managed}
      value={imageOptions}
      onChange={setImageOptions}
      size={size}
      onSizeChange={setSize}
      className={className}
    />
  );
}
