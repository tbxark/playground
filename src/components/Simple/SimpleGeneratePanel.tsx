import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useHotkeys } from "react-hotkeys-hook";
import {
  AlertTriangleIcon,
  ArrowDownIcon,
  ArrowUpIcon,
  ChevronDownIcon,
  DicesIcon,
  ImagePlusIcon,
  Loader2Icon,
  PlayIcon,
  SlidersHorizontalIcon,
  SparklesIcon,
  XIcon,
} from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Slider } from "../ui/slider";
import { ConfirmDialog } from "../ui/confirm-dialog";
import { modelDisplayName } from "../../services/imageService";
import {
  MAX_SIMPLE_IMAGES,
  SimpleImage,
  useFreeCanvasStore,
} from "../../stores/useFreeCanvasStore";
import { usePromptStore } from "../../stores/usePromptStore";
import { useConfigStore } from "../../stores/useConfigStore";
import { useLightboxStore } from "../../stores/useLightboxStore";
import { useGenerateAction } from "../../hooks/useGenerateAction";
import { isImeComposing, isOverlayOpen } from "@/utils/keyboard";
import { cn } from "@/utils/cn";

const RATIOS = ["1:1", "16:9", "9:16", "4:3", "3:4", "auto"];
const RESOLUTIONS = ["1k", "2k", "4k"];
const COUNTS = [1, 2, 4];

/**
 * The plainest generation entry: optional images + optional prompt, straight to
 * the queue. Shares the prompt store, the queue and the results panel with the
 * free canvas, so switching segments never loses input or results.
 */
export function SimpleGeneratePanel() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { generate } = useGenerateAction("simple");
  const openLightbox = useLightboxStore((state) => state.open);

  const { imageConfig, selectedModel, setSelectedModel } = useConfigStore();
  const {
    prompt,
    negativePrompt,
    size,
    resolution,
    batchCount,
    seed,
    cfgScale,
    steps,
    setPrompt,
    setNegativePrompt,
    setSize,
    setResolution,
    setBatchCount,
    setSeed,
    setCfgScale,
    setSteps,
  } = usePromptStore();

  const {
    simpleImages,
    addSimpleImages,
    removeSimpleImage,
    moveSimpleImage,
    clearSimpleImages,
  } = useFreeCanvasStore(
    useShallow((state) => ({
      simpleImages: state.simpleImages,
      addSimpleImages: state.addSimpleImages,
      removeSimpleImage: state.removeSimpleImage,
      moveSimpleImage: state.moveSimpleImage,
      clearSimpleImages: state.clearSimpleImages,
    }))
  );

  const [showAdvanced, setShowAdvanced] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [confirmClearImages, setConfirmClearImages] = useState(false);

  const activeModels = imageConfig.models.filter((model) =>
    imageConfig.enabledModelIds.includes(model.id)
  );
  const modelAvailable = activeModels.some(
    (model) => model.id === selectedModel
  );

  // Missing/unrestored slots still render, but they cannot feed a request.
  const usableImages = simpleImages.filter(
    (image) => Boolean(image.url) && !image.missing
  );
  const hasInput = prompt.trim().length > 0 || usableImages.length > 0;
  const canGenerate = hasInput && modelAvailable;

  const handleGenerate = async () => {
    if (!canGenerate || isSubmitting) return;
    setIsSubmitting(true);
    try {
      await generate();
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleFiles = (files: FileList | null) => {
    if (!files?.length) return;
    void addSimpleImages(files);
  };

  // Same shortcut as the free canvas prompt: submit from the textarea, but
  // never while an IME is composing or a dialog/lightbox is open.
  useHotkeys(
    "mod+enter",
    () => {
      void handleGenerate();
    },
    {
      enableOnFormTags: ["textarea"],
      ignoreEventWhen: (event) => isImeComposing(event) || isOverlayOpen(),
    }
  );

  const openSimpleImage = (image: SimpleImage) => {
    if (!image.url) return;
    openLightbox({
      url: image.url,
      title: image.name,
      subtitle: t("simple.imagesLabel"),
      fileName: image.name.includes(".") ? image.name : `${image.name}.png`,
    });
  };

  return (
    <section className="flex min-h-0 w-full flex-1 flex-col bg-zinc-950 text-zinc-100">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-5 px-4 pb-8 pt-6 sm:pt-10">
          {/* pr-24 keeps the intro clear of the results-dock trigger button,
              which floats in the top-right corner below the lg breakpoint. */}
          <header className="min-w-0 pr-24 lg:pr-0">
            <h1 className="flex items-center gap-2 text-base font-bold tracking-tight text-zinc-50">
              <SparklesIcon className="size-4 fill-current text-primary" />
              {t("simple.title")}
            </h1>
            <p className="mt-1 text-xs leading-relaxed text-zinc-400">
              {t("simple.subtitle")}
            </p>
          </header>

          {/* Optional input images: the first is the base image. */}
          <section className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-zinc-200">
                {t("simple.imagesLabel")}
              </span>
              <div className="flex items-center gap-2">
                <span className="font-mono text-[10px] text-zinc-500">
                  {t("simple.imageCount", {
                    used: simpleImages.length,
                    max: MAX_SIMPLE_IMAGES,
                  })}
                </span>
                {simpleImages.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setConfirmClearImages(true)}
                    className="cursor-pointer text-[10px] text-zinc-500 hover:text-red-300"
                  >
                    {t("simple.clearImages")}
                  </button>
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
              {simpleImages.map((image, index) => {
                const unavailable = image.missing || !image.url;
                return (
                  <div
                    key={image.id}
                    className={cn(
                      "group relative aspect-square overflow-hidden rounded-xl border bg-zinc-900",
                      index === 0
                        ? "border-primary/50"
                        : "border-white/10"
                    )}
                  >
                    {unavailable ? (
                      <div className="flex h-full w-full flex-col items-center justify-center gap-1 p-2 text-center">
                        <AlertTriangleIcon className="size-4 text-amber-400" />
                        <span className="text-[10px] leading-tight text-amber-200">
                          {t("simple.missingImageHint")}
                        </span>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => openSimpleImage(image)}
                        className="absolute inset-0 cursor-zoom-in"
                        aria-label={t("preview.openAria", { name: image.name })}
                      >
                        <img
                          src={image.url}
                          alt={image.name}
                          className="h-full w-full object-cover"
                          draggable={false}
                        />
                      </button>
                    )}

                    <span
                      className={cn(
                        "pointer-events-none absolute left-1.5 top-1.5 z-10 rounded-md border px-1.5 py-0.5 text-[9px] font-bold",
                        index === 0
                          ? "border-primary/50 bg-primary/20 text-primary"
                          : "border-cyan-400/40 bg-cyan-500/15 text-cyan-200"
                      )}
                    >
                      {index === 0
                        ? t("simple.mainImageSlot")
                        : t("simple.referenceSlot", { index })}
                    </span>

                    <button
                      type="button"
                      onClick={() => removeSimpleImage(image.id)}
                      className="absolute right-1 top-1 z-10 flex size-6 cursor-pointer items-center justify-center rounded-md bg-black/70 text-zinc-300 backdrop-blur-md transition-colors hover:bg-red-500/80 hover:text-white"
                      title={t("simple.removeImage")}
                      aria-label={t("simple.removeImage")}
                    >
                      <XIcon className="size-3" />
                    </button>

                    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex items-end gap-1 bg-gradient-to-t from-black/85 to-transparent px-1.5 pb-1 pt-4">
                      <p
                        className="min-w-0 flex-1 truncate text-[9px] text-zinc-300"
                        title={image.persist === "memory"
                          ? t("simple.persistMemoryHint")
                          : image.name}
                      >
                        {image.name}
                      </p>
                      {image.persist === "memory" && (
                        <span
                          className="mb-0.5 size-1.5 shrink-0 rounded-full bg-amber-400"
                          title={t("simple.persistMemoryHint")}
                        />
                      )}
                      {simpleImages.length > 1 && (
                        <div className="pointer-events-auto flex shrink-0 items-center gap-0.5">
                          <button
                            type="button"
                            onClick={() => moveSimpleImage(image.id, -1)}
                            disabled={index === 0}
                            className="flex size-5 cursor-pointer items-center justify-center rounded bg-black/70 text-zinc-200 transition-colors hover:bg-black/90 hover:text-white disabled:cursor-default disabled:opacity-35"
                            title={t("simple.moveEarlier")}
                            aria-label={t("simple.moveEarlier")}
                          >
                            <ArrowUpIcon className="size-3" />
                          </button>
                          <button
                            type="button"
                            onClick={() => moveSimpleImage(image.id, 1)}
                            disabled={index === simpleImages.length - 1}
                            className="flex size-5 cursor-pointer items-center justify-center rounded bg-black/70 text-zinc-200 transition-colors hover:bg-black/90 hover:text-white disabled:cursor-default disabled:opacity-35"
                            title={t("simple.moveLater")}
                            aria-label={t("simple.moveLater")}
                          >
                            <ArrowDownIcon className="size-3" />
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}

              {simpleImages.length < MAX_SIMPLE_IMAGES && (
                <label
                  htmlFor="simpleImageUpload"
                  className="flex aspect-square cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-white/20 bg-white/[0.03] text-center transition-colors hover:border-primary/50 hover:bg-white/[0.06]"
                  title={t("simple.addImages")}
                >
                  <ImagePlusIcon className="size-4 text-primary" />
                  <span className="px-1 text-[10px] leading-tight text-zinc-400">
                    {t("simple.addImages")}
                  </span>
                  <input
                    id="simpleImageUpload"
                    type="file"
                    accept="image/*"
                    multiple
                    className="hidden"
                    onChange={(event) => {
                      handleFiles(event.target.files);
                      event.target.value = "";
                    }}
                  />
                </label>
              )}
            </div>

            {simpleImages.some((image) => image.persist === "memory") && (
              <p className="text-[10px] leading-relaxed text-amber-300/90">
                {t("simple.persistMemoryHint")}
              </p>
            )}
          </section>

          {/* Optional prompt */}
          <section className="flex flex-col gap-1.5">
            <label
              htmlFor="simplePrompt"
              className="text-xs font-semibold text-zinc-200"
            >
              {t("simple.promptLabel")}
            </label>
            <textarea
              id="simplePrompt"
              autoFocus
              rows={3}
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder={t("simple.promptPlaceholder")}
              className="w-full resize-y rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-sm leading-relaxed text-zinc-100 outline-none transition-colors placeholder:text-zinc-500 focus:border-primary/60"
            />
          </section>

          {/* Model / size / resolution / count */}
          <section className="flex flex-col gap-2.5 rounded-2xl border border-white/10 bg-white/[0.03] p-3">
            <div className="flex flex-col gap-1">
              <span className="text-[11px] font-medium text-zinc-400">
                {t("simple.modelLabel")}
              </span>
              <select
                value={selectedModel}
                onChange={(event) => setSelectedModel(event.target.value)}
                disabled={activeModels.length === 0}
                className="h-9 w-full cursor-pointer truncate rounded-xl border border-white/10 bg-white/5 px-2.5 text-xs font-medium text-zinc-200 outline-none hover:bg-white/10 disabled:cursor-default disabled:text-zinc-500"
              >
                {!modelAvailable && (
                  <option value={selectedModel} className="bg-zinc-900 text-white">
                    {selectedModel || t("controls.selectModel")}
                  </option>
                )}
                {activeModels.map((model) => (
                  <option key={model.id} value={model.id} className="bg-zinc-900 text-white">
                    {modelDisplayName(model)}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="flex shrink-0 items-center gap-0.5 rounded-xl border border-white/10 bg-white/5 p-0.5">
                {RATIOS.map((ratio) => (
                  <button
                    key={ratio}
                    type="button"
                    className={cn(
                      "shrink-0 cursor-pointer whitespace-nowrap rounded-lg px-2 py-1 text-[11px] font-medium transition-colors",
                      size === ratio
                        ? "bg-white/20 font-bold text-white"
                        : "text-zinc-400 hover:text-white"
                    )}
                    onClick={() => setSize(ratio)}
                  >
                    {ratio === "auto" ? t("freeCanvas.sizeAuto") : ratio}
                  </button>
                ))}
              </div>

              <div className="flex shrink-0 items-center gap-0.5 rounded-xl border border-white/10 bg-white/5 p-0.5">
                {RESOLUTIONS.map((item) => (
                  <button
                    key={item}
                    type="button"
                    className={cn(
                      "shrink-0 cursor-pointer whitespace-nowrap rounded-lg px-2 py-1 text-[11px] font-medium uppercase transition-colors",
                      resolution === item
                        ? "bg-white/20 font-bold text-white"
                        : "text-zinc-400 hover:text-white"
                    )}
                    onClick={() => setResolution(item)}
                  >
                    {item}
                  </button>
                ))}
              </div>

              <div className="flex shrink-0 items-center gap-0.5 rounded-xl border border-white/10 bg-white/5 p-0.5">
                {COUNTS.map((count) => (
                  <button
                    key={count}
                    type="button"
                    className={cn(
                      "shrink-0 cursor-pointer whitespace-nowrap rounded-lg px-2 py-1 text-[11px] font-medium transition-colors",
                      batchCount === count
                        ? "bg-white/20 font-bold text-white"
                        : "text-zinc-400 hover:text-white"
                    )}
                    onClick={() => setBatchCount(count)}
                  >
                    {t("freeCanvas.countPill", { count })}
                  </button>
                ))}
              </div>

              <button
                type="button"
                className={cn(
                  "flex h-7 shrink-0 cursor-pointer items-center gap-1 rounded-xl border px-2 text-[11px] transition-colors",
                  showAdvanced
                    ? "border-white/30 bg-white/20 font-semibold text-white"
                    : "border-white/10 bg-white/5 text-zinc-400 hover:bg-white/10 hover:text-white"
                )}
                onClick={() => setShowAdvanced((value) => !value)}
                title={t("freeCanvas.advancedParamsTitle")}
                aria-expanded={showAdvanced}
              >
                <SlidersHorizontalIcon className="size-3" />
                {t("freeCanvas.params")}
                <ChevronDownIcon
                  className={cn(
                    "size-3 transition-transform",
                    showAdvanced && "rotate-180"
                  )}
                />
              </button>
            </div>

            {showAdvanced && (
              <div className="grid grid-cols-1 gap-3 border-t border-white/10 pt-2.5 text-xs sm:grid-cols-2">
                <div className="flex flex-col gap-1">
                  <span className="text-[11px] font-medium text-zinc-400">
                    {t("freeCanvas.negativePromptLabel")}
                  </span>
                  <Input
                    placeholder={t("freeCanvas.negativePromptPlaceholder")}
                    value={negativePrompt}
                    onChange={(event) => setNegativePrompt(event.target.value)}
                    className="h-8 border-white/10 bg-black/30 text-xs"
                  />
                </div>

                <div className="flex flex-col gap-1">
                  <div className="flex items-center justify-between text-[11px] text-zinc-400">
                    <span>{t("freeCanvas.seedLabel")}</span>
                    {seed !== undefined && (
                      <button
                        type="button"
                        onClick={() => setSeed(undefined)}
                        className="cursor-pointer text-[10px] text-primary hover:underline"
                      >
                        {t("freeCanvas.random")}
                      </button>
                    )}
                  </div>
                  <div className="flex gap-1">
                    <Input
                      type="number"
                      placeholder={t("freeCanvas.random")}
                      value={seed ?? ""}
                      onChange={(event) =>
                        setSeed(
                          event.target.value
                            ? Number(event.target.value)
                            : undefined
                        )
                      }
                      className="h-8 border-white/10 bg-black/30 font-mono text-xs"
                    />
                    <Button
                      variant="outline"
                      size="icon-sm"
                      className="h-8 w-8 shrink-0 border-white/10 bg-black/30 text-zinc-300"
                      onClick={() =>
                        setSeed(Math.floor(Math.random() * 999999999))
                      }
                      title={t("freeCanvas.randomizeSeedTitle")}
                    >
                      <DicesIcon className="size-3" />
                    </Button>
                  </div>
                </div>

                <div className="flex flex-col gap-1">
                  <div className="flex items-center justify-between text-[11px] text-zinc-400">
                    <span>{t("freeCanvas.cfgLabel")}</span>
                    <span className="font-mono text-zinc-200">{cfgScale ?? 7}</span>
                  </div>
                  <Slider
                    min={1}
                    max={20}
                    step={0.5}
                    value={[cfgScale ?? 7]}
                    onValueChange={([value]) => setCfgScale(value)}
                  />
                </div>

                <div className="flex flex-col gap-1">
                  <div className="flex items-center justify-between text-[11px] text-zinc-400">
                    <span>{t("freeCanvas.stepsLabel")}</span>
                    <span className="font-mono text-zinc-200">{steps ?? 30}</span>
                  </div>
                  <Slider
                    min={10}
                    max={60}
                    step={1}
                    value={[steps ?? 30]}
                    onValueChange={([value]) => setSteps(value)}
                  />
                </div>
              </div>
            )}
          </section>
        </div>
      </div>

      {/* Sticky CTA: always visible, safe-area aware, never hover-only. */}
      <div className="shrink-0 border-t border-white/10 bg-zinc-950/95 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur-2xl">
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-1.5">
          {!modelAvailable && (
            <div className="flex items-center justify-between gap-2 rounded-lg border border-amber-400/30 bg-amber-500/10 px-2.5 py-1.5 text-[11px] text-amber-200">
              <span className="flex min-w-0 items-center gap-1.5">
                <AlertTriangleIcon className="size-3.5 shrink-0" />
                <span className="truncate">{t("simple.needModel")}</span>
              </span>
              <Button
                type="button"
                size="xs"
                variant="outline"
                className="shrink-0 border-amber-400/40 bg-transparent text-amber-100 hover:bg-amber-500/20 hover:text-white"
                onClick={() => navigate("/settings#image")}
              >
                {t("simple.goSettings")}
              </Button>
            </div>
          )}
          {!hasInput && (
            <p className="text-[11px] text-amber-300">{t("simple.needInput")}</p>
          )}
          <Button
            type="button"
            size="lg"
            disabled={!canGenerate || isSubmitting}
            onClick={() => void handleGenerate()}
            className="h-11 w-full gap-1.5 bg-white text-sm font-bold text-zinc-950 shadow-lg shadow-white/10 hover:bg-zinc-200"
          >
            {isSubmitting ? (
              <Loader2Icon className="size-4 animate-spin" />
            ) : (
              <PlayIcon className="size-4 fill-current" />
            )}
            <span>
              {t("simple.generate")}
              {batchCount > 1 ? ` (${batchCount})` : ""}
            </span>
          </Button>
        </div>
      </div>

      <ConfirmDialog
        open={confirmClearImages}
        title={t("simple.clearImagesTitle")}
        description={t("simple.clearImagesDesc")}
        confirmLabel={t("simple.clearImages")}
        busy={false}
        onCancel={() => setConfirmClearImages(false)}
        onConfirm={() => {
          clearSimpleImages();
          setConfirmClearImages(false);
        }}
      />
    </section>
  );
}
