import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  ChevronDownIcon,
  ChevronUpIcon,
  CopyIcon,
  DicesIcon,
  HelpCircleIcon,
  ImagePlusIcon,
  LanguagesIcon,
  Loader2Icon,
  PlayIcon,
  PlusIcon,
  ScanEyeIcon,
  SlidersHorizontalIcon,
  SparklesIcon,
  XIcon,
} from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { modelDisplayName } from "../../services/imageService";
import {
  Button,
} from "../ui/button";
import { Input } from "../ui/input";
import { Slider } from "../ui/slider";
import { ConfirmDialog } from "../ui/confirm-dialog";
import { usePromptStore } from "../../stores/usePromptStore";
import { usePromptLibraryStore } from "../../stores/usePromptLibraryStore";
import { useConfigStore } from "../../stores/useConfigStore";
import {
  MAX_REFERENCE_PARTICIPATION,
  getReferenceCards,
  useFreeCanvasStore,
} from "../../stores/useFreeCanvasStore";
import { useLightboxStore } from "../../stores/useLightboxStore";
import { useGenerateAction } from "../../hooks/useGenerateAction";
import { useCardEdit } from "../../hooks/useCardEdit";
import { imageToPrompt, polishPrompt } from "../../services/llmAssistant";
import { applyServerLlmOverlay } from "../../services/effectiveConfig";
import { resolveCardDataUrl } from "../../utils/cardSource";
import { ReferenceHelpDialog } from "./ReferenceHelpDialog";
import { cn } from "@/utils/cn";

const RATIOS = [
  { label: "1:1", value: "1:1" },
  { label: "16:9", value: "16:9" },
  { label: "9:16", value: "9:16" },
  { label: "4:3", value: "4:3" },
  { label: "3:4", value: "3:4" },
  { label: "auto", value: "auto" },
];

const RESOLUTIONS = ["1k", "2k", "4k"];

export function FreeCanvasCommandBar() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { generate } = useGenerateAction();
  const { buildEditable } = useCardEdit();

  // The prompt starts at two rows, grows with its content and caps at six rows
  // (then scrolls) so a long prompt never swallows the whole canvas.
  const promptRowsMin = 2;
  const promptRowsMax = 6;
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const promptObserverRef = useRef<ResizeObserver | null>(null);
  const lastPromptWidthRef = useRef(0);

  const resizePrompt = useCallback(() => {
    const el = promptRef.current;
    if (!el) return;
    const styles = getComputedStyle(el);
    const lineHeight = parseFloat(styles.lineHeight) || 22;
    const padding =
      (parseFloat(styles.paddingTop) || 0) +
      (parseFloat(styles.paddingBottom) || 0);
    const minHeight = Math.round(lineHeight * promptRowsMin + padding);
    const maxHeight = Math.round(lineHeight * promptRowsMax + padding);
    el.style.height = "auto";
    const contentHeight = el.scrollHeight;
    el.style.height = `${Math.min(Math.max(contentHeight, minHeight), maxHeight)}px`;
    el.style.overflowY = contentHeight > maxHeight ? "auto" : "hidden";
  }, []);

  // Callback ref: the bar remounts the textarea when it is collapsed and
  // expanded again, so observation is attached on every mount.
  const observePrompt = useCallback(
    (el: HTMLTextAreaElement | null) => {
      promptObserverRef.current?.disconnect();
      promptObserverRef.current = null;
      promptRef.current = el;
      if (!el) return;
      lastPromptWidthRef.current = el.clientWidth;
      resizePrompt();
      if (typeof ResizeObserver === "undefined") return;
      const observer = new ResizeObserver(() => {
        // Only re-wrap on width changes; height changes are our own writes.
        if (el.clientWidth === lastPromptWidthRef.current) return;
        lastPromptWidthRef.current = el.clientWidth;
        resizePrompt();
      });
      observer.observe(el);
      promptObserverRef.current = observer;
    },
    [resizePrompt]
  );

  useEffect(() => () => promptObserverRef.current?.disconnect(), []);

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
    toggleTag,
    activeTagIds,
  } = usePromptStore();

  // Grow/shrink with the text itself (also covers programmatic writes from
  // polish / translate / image-to-prompt, which do not fire onChange on the textarea).
  useLayoutEffect(() => {
    resizePrompt();
  }, [prompt, resizePrompt]);

  const { imageConfig, selectedModel, setSelectedModel, llmConfig, corsProxy, corsProxyMode } =
    useConfigStore();

  const promptLibraryEntries = usePromptLibraryStore((state) => state.entries);

  const activeModels = imageConfig.models.filter((model) =>
    imageConfig.enabledModelIds.includes(model.id)
  );
  const selectedModelAvailable = activeModels.some(
    (model) => model.id === selectedModel
  );
  const canGenerate = selectedModelAvailable && activeModels.length > 0;

  const openLightbox = useLightboxStore((state) => state.open);

  const {
    cards,
    main,
    maskStrokes,
    isBarCollapsed,
    setIsBarCollapsed,
    clearMain,
    removeCard,
    addFiles,
    isCommittingMain,
  } = useFreeCanvasStore(
    useShallow((state) => ({
      cards: state.cards,
      main: state.cards.find((card) => card.role === "main"),
      maskStrokes: state.maskStrokes,
      isBarCollapsed: state.isBarCollapsed,
      setIsBarCollapsed: state.setIsBarCollapsed,
      clearMain: state.clearMain,
      removeCard: state.removeCard,
      addFiles: state.addFiles,
      isCommittingMain: state.isCommittingMain,
    }))
  );

  const references = getReferenceCards(cards);

  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showStyleTags, setShowStyleTags] = useState(false);
  const [isPolishing, setIsPolishing] = useState(false);
  const [isTranslating, setIsTranslating] = useState(false);
  // One assistant request at a time. The previous request is aborted when the
  // user leaves the page or starts another action, instead of locking the
  // button for the SDK's 10-minute default.
  const llmAbortRef = useRef<AbortController | null>(null);

  const beginLlmRequest = () => {
    llmAbortRef.current?.abort();
    const controller = new AbortController();
    llmAbortRef.current = controller;
    return controller;
  };

  const isLlmAbort = (error: unknown, controller: AbortController) =>
    controller.signal.aborted ||
    (error instanceof DOMException && error.name === "AbortError");

  useEffect(() => () => llmAbortRef.current?.abort(), []);
  const [isVisionAnalyzing, setIsVisionAnalyzing] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [confirmClearOpen, setConfirmClearOpen] = useState(false);
  const [pendingRemoveRef, setPendingRemoveRef] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const hasInpaintMask = maskStrokes.length > 0;
  const hasImage = Boolean(main);

  let modeTitle = t("freeCanvas.modeInspire");
  let modeBadge = t("freeCanvas.badgeText2img");
  let buttonStyle =
    "bg-white hover:bg-zinc-200 text-zinc-950 font-bold shadow-white/10";

  if (hasInpaintMask) {
    modeTitle = t("freeCanvas.modeInpaint");
    modeBadge = t("freeCanvas.badgeInpaint");
    buttonStyle =
      "bg-amber-500 hover:bg-amber-400 text-zinc-950 font-bold shadow-amber-500/25";
  } else if (hasImage || references.length > 0) {
    modeTitle = t("freeCanvas.modeImg2img");
    modeBadge = t("freeCanvas.badgeImg2img");
    buttonStyle =
      "bg-blue-600 hover:bg-blue-500 text-white font-bold shadow-blue-500/25";
  }

  const handleGenerateClick = () => {
    void generate();
  };

  const handlePolish = async () => {
    if (!prompt.trim()) return toast.warning(t("freeCanvas.toastNeedBasePrompt"));
    const controller = beginLlmRequest();
    setIsPolishing(true);
    try {
      const response = await polishPrompt(
        prompt,
        applyServerLlmOverlay({ ...llmConfig, corsProxy, corsProxyMode }),
        "enhance",
        controller.signal
      );
      setPrompt(response);
      toast.success(t("freeCanvas.toastPolishSuccess"));
    } catch (error) {
      if (isLlmAbort(error, controller)) return;
      toast.error(
        t("freeCanvas.toastPolishFailed", {
          message: error instanceof Error ? error.message : String(error),
        })
      );
    } finally {
      setIsPolishing(false);
    }
  };

  const handleTranslate = async () => {
    if (!prompt.trim()) return toast.warning(t("freeCanvas.toastNeedPrompt"));
    const controller = beginLlmRequest();
    setIsTranslating(true);
    try {
      const response = await polishPrompt(
        prompt,
        applyServerLlmOverlay({ ...llmConfig, corsProxy, corsProxyMode }),
        "translate",
        controller.signal
      );
      setPrompt(response);
      toast.success(t("freeCanvas.toastTranslateSuccess"));
    } catch (error) {
      if (isLlmAbort(error, controller)) return;
      toast.error(
        t("freeCanvas.toastTranslateFailed", {
          message: error instanceof Error ? error.message : String(error),
        })
      );
    } finally {
      setIsTranslating(false);
    }
  };

  const handleVisionReverse = async () => {
    const targetCard = main ?? references[0];
    if (!targetCard?.url) {
      return toast.warning(t("freeCanvas.toastNoImageForReverse"));
    }
    const controller = beginLlmRequest();
    setIsVisionAnalyzing(true);
    try {
      const targetUrl = await resolveCardDataUrl(targetCard, corsProxy, corsProxyMode);
      if (!targetUrl) {
        toast.error(t("freeCanvas.toastVisionFailed", { message: targetCard.name }));
        return;
      }
      const response = await imageToPrompt(
        targetUrl,
        applyServerLlmOverlay({ ...llmConfig, corsProxy, corsProxyMode }),
        controller.signal
      );
      setPrompt(response);
      toast.success(t("freeCanvas.toastVisionReverseSuccess"));
    } catch (error) {
      if (isLlmAbort(error, controller)) return;
      toast.error(
        t("freeCanvas.toastVisionFailed", {
          message: error instanceof Error ? error.message : String(error),
        })
      );
    } finally {
      setIsVisionAnalyzing(false);
    }
  };

  const handleCopyPrompt = async () => {
    if (!prompt.trim()) return toast.warning(t("freeCanvas.cards.noPromptToCopy"));
    try {
      await navigator.clipboard.writeText(prompt);
      toast.success(t("freeCanvas.cards.promptCopied"));
    } catch {
      toast.error(t("freeCanvas.cards.copyFailed"));
    }
  };

  const handleConfirmClear = async () => {
    setBusy(true);
    const ok = await clearMain({ discardMask: maskStrokes.length > 0 });
    setBusy(false);
    if (ok) setConfirmClearOpen(false);
  };

  const handleConfirmRemoveRef = () => {
    if (!pendingRemoveRef) return;
    removeCard(pendingRemoveRef);
    setPendingRemoveRef(null);
  };

  if (isBarCollapsed) {
    return (
      <>
        <div
          data-free-canvas-command-bar="true"
          className="pointer-events-auto z-20 flex w-full max-w-xl select-none justify-center px-4"
        >
          <div className="flex w-full items-center gap-2.5 rounded-2xl border border-white/10 bg-zinc-950/90 px-3 py-1.5 shadow-2xl backdrop-blur-2xl transition-all sm:w-auto">
            <div className="flex size-6 shrink-0 items-center justify-center rounded-lg bg-primary/20 text-primary">
              <SparklesIcon className="size-3.5 fill-current" />
            </div>

            <span className="max-w-[200px] truncate text-xs font-medium text-zinc-300">
              {prompt.trim() || t("freeCanvas.collapsedPromptPlaceholder")}
            </span>

            <span className="hidden max-w-[180px] shrink-0 truncate rounded-lg border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] font-mono text-zinc-400 sm:inline-flex">
              {selectedModel || t("controls.selectModel")} · {size}
            </span>

            <Button
              size="xs"
              onClick={handleGenerateClick}
              title={
                canGenerate
                  ? t("freeCanvas.generateCurrentTitle")
                  : t("freeCanvas.goSettingsEnableModelTitle")
              }
              className="h-9 w-auto shrink-0 cursor-pointer bg-primary px-3 text-xs font-bold text-zinc-950 shadow-md shadow-primary/20 hover:bg-primary/90 sm:h-7"
            >
              <PlayIcon className="mr-1 size-3 fill-current" />
              <span>{t("freeCanvas.generate")}</span>
            </Button>

            <button
              type="button"
              onClick={() => setHelpOpen(true)}
              className="flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-xl text-cyan-300 transition-colors hover:bg-white/10 hover:text-cyan-200"
              title={t("freeCanvas.cards.referenceHelpTitle")}
              aria-label={t("freeCanvas.cards.referenceHelp")}
            >
              <HelpCircleIcon className="size-3.5" />
            </button>

            <button
              type="button"
              onClick={() => setIsBarCollapsed(false)}
              className="flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-xl bg-white/5 text-zinc-400 transition-colors hover:bg-white/10 hover:text-white"
              title={t("freeCanvas.expandCommandBar")}
            >
              <ChevronUpIcon className="size-3.5" />
            </button>
          </div>
        </div>
        <ReferenceHelpDialog open={helpOpen} onOpenChange={setHelpOpen} />
      </>
    );
  }

  return (
    <>
      <div
        data-free-canvas-command-bar="true"
        className="pointer-events-auto z-20 flex w-full max-w-4xl select-none flex-col gap-2 px-4"
      >
        <div className="flex flex-col gap-2.5 rounded-3xl border border-white/10 bg-zinc-950/90 p-2.5 shadow-2xl backdrop-blur-2xl transition-all sm:p-3">
          {(main || references.length > 0) && (
            <div className="flex flex-wrap items-center gap-2 border-b border-white/5 pb-2 text-xs">
              {main && (
                <div className="inline-flex items-center gap-1.5 rounded-xl border border-primary/30 bg-zinc-900 px-2.5 py-1 text-zinc-300">
                  <span className="size-2 rounded-full bg-primary" />
                  <span className="text-[11px] text-zinc-400">
                    {t("freeCanvas.cards.mainBadge")}
                  </span>
                  <span className="max-w-[140px] truncate text-[11px] font-bold text-zinc-200">
                    {main.name || t("freeCanvas.currentBaseImage")}
                  </span>
                  <button
                    type="button"
                    onClick={() => setConfirmClearOpen(true)}
                    className="ml-0.5 inline-flex size-5 cursor-pointer items-center justify-center rounded-full text-zinc-400 hover:bg-white/10 hover:text-white"
                    title={t("freeCanvas.cards.unsetMain")}
                  >
                    <XIcon className="size-3" />
                  </button>
                </div>
              )}

              {references.map((reference, index) => {
                const participates = index < MAX_REFERENCE_PARTICIPATION;
                const openReference = () => {
                  if (!reference.url) return;
                  // The same reference opens with the same capabilities here and
                  // on its canvas card; a bare preview made editing look broken.
                  openLightbox({
                    url: reference.url,
                    title: reference.name,
                    subtitle: t("freeCanvas.cards.referenceBadge", {
                      index: index + 1,
                    }),
                    compareSrc: reference.originalUrl,
                    fileName: `playground_reference_${index + 1}.png`,
                    editable: buildEditable({
                      cardId: reference.id,
                      name: reference.name,
                      allowCopy: true,
                    }),
                  });
                };
                return (
                  <div
                    key={reference.id}
                    className={cn(
                      "group relative inline-flex items-center gap-1.5 rounded-xl border py-0.5 pl-1 pr-2 text-zinc-300 shadow-xs",
                      participates
                        ? "border-cyan-400/30 bg-zinc-900"
                        : "border-amber-400/30 bg-zinc-900/80"
                    )}
                    title={
                      participates
                        ? t("freeCanvas.cards.referenceHint", { index: index + 1 })
                        : t("freeCanvas.cards.referenceAlternateHint")
                    }
                  >
                    <button
                      type="button"
                      onClick={openReference}
                      className="size-7 overflow-hidden rounded-md bg-zinc-800"
                      aria-label={t("freeCanvas.cards.openLargeAria", {
                        name: reference.name,
                      })}
                    >
                      {reference.url ? (
                        <img
                          src={reference.url}
                          alt={reference.name}
                          className="size-7 object-cover"
                        />
                      ) : null}
                    </button>
                    <button
                      type="button"
                      onClick={openReference}
                      className={cn(
                        "cursor-pointer font-mono text-[11px] font-semibold hover:underline",
                        participates ? "text-cyan-300" : "text-amber-300"
                      )}
                      title={t("preview.viewLarge")}
                    >
                      {participates
                        ? t("freeCanvas.refIndex", { count: index + 1 })
                        : t("freeCanvas.cards.referenceAlternateBadge")}
                    </button>
                    <button
                      type="button"
                      onClick={() => setPendingRemoveRef(reference.id)}
                      className="ml-0.5 inline-flex size-5 cursor-pointer items-center justify-center rounded-full text-zinc-500 hover:text-red-400"
                      title={t("freeCanvas.removeReferenceTitle")}
                      aria-label={t("freeCanvas.removeReferenceTitle")}
                    >
                      <XIcon className="size-3" />
                    </button>
                  </div>
                );
              })}

              <label
                htmlFor="commandBarRefUploadMore"
                className="inline-flex cursor-pointer items-center gap-1 rounded-xl border border-dashed border-white/20 px-2 py-1 text-[11px] text-zinc-400 transition-colors hover:border-primary/50 hover:text-white"
                title={t("freeCanvas.addMoreReferencesTitle")}
              >
                <PlusIcon className="size-3" />
                <span>{t("freeCanvas.addReference")}</span>
                <input
                  id="commandBarRefUploadMore"
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={(event) => {
                    if (event.target.files?.length) {
                      void addFiles(event.target.files, { forceReference: true });
                      event.target.value = "";
                    }
                  }}
                />
              </label>

              <span className="rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-[10px] font-mono text-zinc-400">
                {t("freeCanvas.cards.referenceCount", {
                  active: Math.min(
                    MAX_REFERENCE_PARTICIPATION,
                    references.length
                  ),
                  total: references.length,
                })}
              </span>
            </div>
          )}

          <div className="flex flex-col gap-1">
            <textarea
              ref={observePrompt}
              rows={2}
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder={t("freeCanvas.promptPlaceholder")}
              className="w-full resize-none overflow-y-hidden bg-transparent px-2 py-1 text-sm leading-relaxed text-zinc-100 outline-none placeholder:text-zinc-500"
            />

            {/* Tools get their own row: sharing a row with the prompt squeezed
                the input into a narrow column on wide screens. */}
            <div className="no-scrollbar flex items-center gap-1 overflow-x-auto">
              <label
                htmlFor="commandBarRefUploadBtn"
                className={cn(
                  "inline-flex h-7 shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 text-xs transition-colors",
                  references.length > 0
                    ? "border-cyan-400/30 bg-cyan-500/10 font-medium text-cyan-300"
                    : "border-white/10 bg-white/5 text-zinc-400 hover:bg-white/10 hover:text-white"
                )}
                title={t("freeCanvas.addHelperReferencesTitle")}
              >
                <ImagePlusIcon className="size-3.5 text-cyan-300" />
                <span className="text-[11px]">
                  {t("freeCanvas.reference")}
                  {references.length > 0 ? ` (${references.length})` : ""}
                </span>
                <input
                  id="commandBarRefUploadBtn"
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={(event) => {
                    if (event.target.files?.length) {
                      void addFiles(event.target.files, { forceReference: true });
                      event.target.value = "";
                    }
                  }}
                />
              </label>

              {/* Always reachable, whatever cards the canvas currently holds. */}
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                onClick={() => setHelpOpen(true)}
                className="h-7 w-7 shrink-0 cursor-pointer text-cyan-300 hover:bg-cyan-500/10 hover:text-cyan-200"
                title={t("freeCanvas.cards.referenceHelpTitle")}
                aria-label={t("freeCanvas.cards.referenceHelp")}
              >
                <HelpCircleIcon className="size-3.5" />
              </Button>

              <Button
                type="button"
                variant="ghost"
                size="xs"
                disabled={isPolishing}
                onClick={handlePolish}
                className="h-7 cursor-pointer text-zinc-400 hover:text-amber-400"
                title={t("freeCanvas.polishTitle")}
              >
                {isPolishing ? (
                  <Loader2Icon className="mr-1 size-3 animate-spin text-amber-400" />
                ) : (
                  <SparklesIcon className="mr-1 size-3 text-amber-400" />
                )}
                <span className="text-[11px]">{t("freeCanvas.polish")}</span>
              </Button>

              <Button
                type="button"
                variant="ghost"
                size="xs"
                disabled={isTranslating}
                onClick={handleTranslate}
                className="h-7 cursor-pointer text-zinc-400 hover:text-blue-400"
                title={t("freeCanvas.translateTitle")}
              >
                {isTranslating ? (
                  <Loader2Icon className="mr-1 size-3 animate-spin text-blue-400" />
                ) : (
                  <LanguagesIcon className="mr-1 size-3 text-blue-400" />
                )}
                <span className="text-[11px]">{t("freeCanvas.translateToEn")}</span>
              </Button>

              <Button
                type="button"
                variant="ghost"
                size="xs"
                onClick={() => void handleCopyPrompt()}
                className="h-7 cursor-pointer text-zinc-400 hover:text-white"
                title={t("freeCanvas.cards.copyPrompt")}
              >
                <CopyIcon className="mr-1 size-3" />
                <span className="text-[11px]">{t("freeCanvas.cards.copyPrompt")}</span>
              </Button>

              {(main || references[0]) && (
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  disabled={isVisionAnalyzing}
                  onClick={handleVisionReverse}
                  className="h-7 cursor-pointer text-zinc-400 hover:text-emerald-400"
                  title={t("freeCanvas.visionReverseTitle")}
                >
                  {isVisionAnalyzing ? (
                    <Loader2Icon className="mr-1 size-3 animate-spin text-emerald-400" />
                  ) : (
                    <ScanEyeIcon className="mr-1 size-3 text-emerald-400" />
                  )}
                  <span className="text-[11px]">{t("freeCanvas.reversePrompt")}</span>
                </Button>
              )}

              <Button
                type="button"
                variant="ghost"
                size="xs"
                onClick={() => setShowStyleTags(!showStyleTags)}
                className={cn(
                  "h-7 cursor-pointer rounded-lg text-xs transition-colors",
                  showStyleTags
                    ? "bg-primary/10 text-primary"
                    : "text-zinc-400 hover:text-white"
                )}
                title={t("freeCanvas.styleTagsTitle")}
              >
                {t("freeCanvas.inspiration")}
              </Button>

              <div className="ml-auto flex shrink-0 items-center gap-1 pl-1">
                <div className="h-4 w-px bg-white/10" />

                <button
                  type="button"
                  onClick={() => setIsBarCollapsed(true)}
                  className="flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-lg text-zinc-400 transition-colors hover:bg-white/10 hover:text-white"
                  title={t("freeCanvas.collapseCommandBarTitle")}
                >
                  <ChevronDownIcon className="size-4" />
                </button>
              </div>
            </div>
          </div>

          {showStyleTags && (
            <div className="animate-in fade-in-0 flex max-h-28 flex-wrap gap-1.5 overflow-y-auto rounded-2xl border border-white/10 bg-zinc-900/90 p-2.5">
              {promptLibraryEntries.length === 0 ? (
                <button
                  type="button"
                  className="cursor-pointer text-xs text-zinc-400 hover:text-primary"
                  onClick={() => navigate("/settings#prompts")}
                >
                  {t("freeCanvas.libraryEmptyHint")}
                </button>
              ) : (
                promptLibraryEntries.map((entry) => {
                  const isSelected = activeTagIds.includes(entry.id);
                  return (
                    <button
                      key={entry.id}
                      type="button"
                      className={cn(
                        "cursor-pointer rounded-lg border px-2 py-0.5 text-xs font-medium transition-all",
                        isSelected
                          ? "border-primary bg-primary/20 font-bold text-primary"
                          : "border-transparent bg-white/5 text-zinc-400 hover:bg-white/10 hover:text-white"
                      )}
                      onClick={() =>
                        toggleTag({ id: entry.id, prompt: entry.prompt })
                      }
                    >
                      {entry.title}
                    </button>
                  );
                })
              )}
            </div>
          )}

          <div className="flex flex-col gap-2 border-t border-white/5 pt-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="no-scrollbar flex w-full min-w-0 items-center gap-1.5 overflow-x-auto py-0.5 sm:flex-1">
              <select
                value={selectedModel}
                onChange={(event) => setSelectedModel(event.target.value)}
                className="max-w-[132px] shrink-0 cursor-pointer truncate rounded-xl border border-white/10 bg-white/5 px-2.5 py-1 text-xs font-medium text-zinc-200 outline-none hover:bg-white/10 sm:max-w-[190px]"
                title={t("freeCanvas.switchModelTitle")}
              >
                {!selectedModelAvailable && (
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

              <div className="flex shrink-0 items-center gap-0.5 rounded-xl border border-white/10 bg-white/5 p-0.5">
                {RATIOS.map((ratio) => (
                  <button
                    key={ratio.value}
                    type="button"
                    className={cn(
                      "shrink-0 cursor-pointer whitespace-nowrap rounded-lg px-1.5 py-0.5 text-[11px] font-medium transition-colors",
                      size === ratio.value
                        ? "bg-white/20 font-bold text-white"
                        : "text-zinc-400 hover:text-white"
                    )}
                    onClick={() => setSize(ratio.value)}
                  >
                    {ratio.value === "auto" ? t("freeCanvas.sizeAuto") : ratio.label}
                  </button>
                ))}
              </div>

              <div className="flex shrink-0 items-center gap-0.5 rounded-xl border border-white/10 bg-white/5 p-0.5">
                {RESOLUTIONS.map((item) => (
                  <button
                    key={item}
                    type="button"
                    className={cn(
                      "shrink-0 cursor-pointer whitespace-nowrap rounded-lg px-1.5 py-0.5 text-[11px] font-medium uppercase transition-colors",
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
                {[1, 2, 4].map((count) => (
                  <button
                    key={count}
                    type="button"
                    className={cn(
                      "shrink-0 cursor-pointer whitespace-nowrap rounded-lg px-1.5 py-0.5 text-[11px] font-medium transition-colors",
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
                  "flex h-7 shrink-0 cursor-pointer items-center gap-1 whitespace-nowrap rounded-xl border px-2 text-xs transition-colors",
                  showAdvanced
                    ? "border-white/30 bg-white/20 font-semibold text-white"
                    : "border-white/10 bg-white/5 text-zinc-400 hover:bg-white/10 hover:text-white"
                )}
                onClick={() => setShowAdvanced(!showAdvanced)}
                title={t("freeCanvas.advancedParamsTitle")}
              >
                <SlidersHorizontalIcon className="size-3.5" />
                <span className="text-[11px]">{t("freeCanvas.params")}</span>
              </button>
            </div>

            <div className="flex w-full shrink-0 items-center gap-2 sm:ml-auto sm:w-auto">
              <Button
                size="sm"
                onClick={handleGenerateClick}
                title={
                  canGenerate
                    ? `${modeTitle} · ${modeBadge}`
                    : t("freeCanvas.goSettingsEnableModelTitle")
                }
                className={cn(
                  "h-10 w-full shrink-0 cursor-pointer gap-1.5 whitespace-nowrap rounded-xl text-xs font-bold shadow-lg transition-transform hover:scale-[1.01] active:scale-[0.98] sm:h-9 sm:w-auto sm:px-4",
                  buttonStyle
                )}
              >
                <PlayIcon className="size-3.5 fill-current" />
                <span>
                  {canGenerate
                    ? `${modeTitle}${batchCount > 1 ? ` (${batchCount})` : ""}`
                    : t("freeCanvas.goSettingsEnableModelShort")}
                </span>
                {canGenerate && (
                  <span className="ml-0.5 rounded border border-black/10 bg-black/10 px-1 py-0.5 font-mono text-[10px]">
                    ⌘↵
                  </span>
                )}
              </Button>
            </div>
          </div>

          {showAdvanced && (
            <div className="animate-in fade-in-0 grid grid-cols-1 gap-3 rounded-2xl border border-white/10 bg-zinc-900/60 p-3 text-xs sm:grid-cols-5">
              <div className="flex flex-col gap-1 sm:col-span-2">
                <span className="text-[11px] font-medium text-zinc-400">
                  {t("freeCanvas.negativePromptLabel")}
                </span>
                <Input
                  placeholder={t("freeCanvas.negativePromptPlaceholder")}
                  value={negativePrompt}
                  onChange={(event) => setNegativePrompt(event.target.value)}
                  className="h-7 border-white/10 bg-black/30 text-xs"
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
                        event.target.value ? Number(event.target.value) : undefined
                      )
                    }
                    className="h-7 border-white/10 bg-black/30 font-mono text-xs"
                  />
                  <Button
                    variant="outline"
                    size="icon-xs"
                    className="h-7 w-7 cursor-pointer border-white/10 bg-black/30 text-zinc-300"
                    onClick={() => setSeed(Math.floor(Math.random() * 999999999))}
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
                  className="mt-1"
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
                  className="mt-1"
                />
              </div>
            </div>
          )}
        </div>
      </div>

      <ReferenceHelpDialog open={helpOpen} onOpenChange={setHelpOpen} />

      <ConfirmDialog
        open={confirmClearOpen}
        title={t("freeCanvas.cards.clearMainTitle")}
        description={
          maskStrokes.length > 0
            ? t("freeCanvas.cards.discardMaskDesc")
            : t("freeCanvas.cards.clearMainDesc")
        }
        confirmLabel={t("freeCanvas.cards.unsetMain")}
        busy={busy || isCommittingMain}
        onCancel={() => setConfirmClearOpen(false)}
        onConfirm={() => void handleConfirmClear()}
      />

      <ConfirmDialog
        open={Boolean(pendingRemoveRef)}
        title={t("freeCanvas.cards.removeReferenceTitle")}
        description={t("freeCanvas.cards.removeReferenceDesc")}
        confirmLabel={t("freeCanvas.cards.removeCard")}
        busy={false}
        onCancel={() => setPendingRemoveRef(null)}
        onConfirm={handleConfirmRemoveRef}
      />
    </>
  );
}
