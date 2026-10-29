import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  AlertTriangleIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  DownloadIcon,
  EyeIcon,
  HistoryIcon,
  ImagePlusIcon,
  ImagesIcon,
  Loader2Icon,
  LocateFixedIcon,
  PencilIcon,
  PlusIcon,
  RotateCcwIcon,
  SaveIcon,
  SparklesIcon,
  XIcon,
} from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";
import { Progress } from "../ui/progress";
import { ConfirmDialog } from "../ui/confirm-dialog";
import { useQueueStore } from "../../stores/useQueueStore";
import { useFreeCanvasStore } from "../../stores/useFreeCanvasStore";
import { useLightboxStore } from "../../stores/useLightboxStore";
import { useConfigStore } from "../../stores/useConfigStore";
import { useCardEdit } from "../../hooks/useCardEdit";
import { useFreeCanvasBridge } from "./FreeCanvasBridge";
import { downloadFile } from "../../utils/file";
import * as cardSource from "../../utils/cardSource";
import { GenerationResult } from "../../services/types";
import { cn } from "@/utils/cn";

type ResultsDockProps = {
  /**
   * "simple" is the same history panel on the Simple page: same queue data source
   * and result actions, minus the canvas-only ones (add to canvas, set as
   * main/reference, locate) — there is no canvas to act on there.
   */
  variant?: "canvas" | "simple";
};

export function ResultsDock({ variant = "canvas" }: ResultsDockProps) {
  const { t } = useTranslation();
  const isCanvas = variant === "canvas";
  const navigate = useNavigate();
  const bridge = useFreeCanvasBridge();
  const openLightbox = useLightboxStore((state) => state.open);
  const { buildEditable } = useCardEdit();
  const [isMobileOpen, setIsMobileOpen] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [pendingPromoteId, setPendingPromoteId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const drawerRef = useRef<HTMLElement>(null);

  // Derive each list with a shallow selector: a progress tick for one task
  // creates a new array but keeps every other task object identical, so the
  // completed history stops re-rendering on every tick.
  const completedTasks = useQueueStore(
    useShallow((state) =>
      state.tasks.filter((task) => task.status === "done" && task.result)
    )
  );
  const activeTasks = useQueueStore(
    useShallow((state) =>
      state.tasks.filter(
        (task) =>
          task.status === "submitting" ||
          task.status === "processing" ||
          task.status === "pending"
      )
    )
  );
  const failedTasks = useQueueStore(
    useShallow((state) => state.tasks.filter((task) => task.status === "failed"))
  );
  // A stable string: changes only when the set of task ids changes, not on
  // every progress update.
  const taskIdKey = useQueueStore((state) =>
    state.tasks.map((task) => task.id).join("|")
  );
  const clearFinished = useQueueStore((state) => state.clearFinished);
  const cancelTask = useQueueStore((state) => state.cancelTask);
  const retryTask = useQueueStore((state) => state.retryTask);
  const removeTask = useQueueStore((state) => state.removeTask);
  const saveResultToGallery = useQueueStore((state) => state.saveResultToGallery);
  const {
    cards,
    addResultCard,
    addResultAsReference,
    promoteToMain,
    retrySaveCard,
    maskStrokes,
    selectCard,
    isCommittingMain,
  } = useFreeCanvasStore(
    useShallow((state) => ({
      cards: state.cards,
      addResultCard: state.addResultCard,
      addResultAsReference: state.addResultAsReference,
      promoteToMain: state.promoteToMain,
      retrySaveCard: state.retrySaveCard,
      maskStrokes: state.maskStrokes,
      selectCard: state.selectCard,
      isCommittingMain: state.isCommittingMain,
    }))
  );

  const completedCount = completedTasks.length;
  const unsavedCards = useMemo(
    () =>
      cards.filter(
        (card) => Boolean(card.resultMeta) && card.saveStatus !== "saved"
      ),
    [cards]
  );
  const finishedCount = completedCount + failedTasks.length;
  const totalCount = completedCount + activeTasks.length + failedTasks.length;
  const orphanUnsavedCount = useMemo(() => {
    const ids = new Set(taskIdKey ? taskIdKey.split("|") : []);
    return unsavedCards.filter(
      (card) => !card.resultTaskId || !ids.has(card.resultTaskId)
    ).length;
  }, [taskIdKey, unsavedCards]);
  const displayCount = totalCount + (isCanvas ? orphanUnsavedCount : 0);

  const cardByNanoid = useMemo(() => {
    const map = new Map<string, string>();
    cards.forEach((card) => {
      // Reference cards can share a gallery id with the result they came from;
      // this map only tracks the result cards a completed task produced.
      if (card.role !== "result") return;
      if (card.nanoid) map.set(card.nanoid, card.id);
      if (card.galleryNanoid) map.set(card.galleryNanoid, card.id);
    });
    return map;
  }, [cards]);

  const cardStatusById = useMemo(
    () => new Map(cards.map((card) => [card.id, card.saveStatus])),
    [cards]
  );

  // The mobile drawer is a hand-rolled overlay, not a Radix dialog: give it
  // Escape handling, focus entry/return and an overlay marker so canvas
  // hotkeys stay inert while it covers the canvas.
  useEffect(() => {
    if (!isMobileOpen) return;
    const previous = document.activeElement as HTMLElement | null;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setIsMobileOpen(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    const frame = requestAnimationFrame(() => drawerRef.current?.focus());
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      cancelAnimationFrame(frame);
      previous?.focus?.();
    };
  }, [isMobileOpen]);

  const selectedCardId = useFreeCanvasStore((state) => state.selectedCardId);

  const ensureCard = async (task: (typeof completedTasks)[number]): Promise<string | null> => {
    const result = task.result!;
    const existing = cardByNanoid.get(result.nanoid);
    if (existing) return existing;
    // An explicit dock action may bring back a result the user removed earlier.
    return addResultCard(result, task.id, { restoreDismissed: true });
  };

  const handleOpenLarge = async (task: (typeof completedTasks)[number]) => {
    const result = task.result!;
    if (isCanvas) {
      const cardId = await ensureCard(task);
      if (cardId) selectCard(cardId);
    }
    openLightbox({
      url: result.url,
      title: result.prompt || t("freeCanvas.resultName", { id: result.nanoid }),
      subtitle: `${result.model} · ${result.size}`,
      fileName: `playground_${result.nanoid}.png`,
    });
    setIsMobileOpen(false);
  };

  const handleAddToCanvas = async (task: (typeof completedTasks)[number]) => {
    const cardId = await ensureCard(task);
    if (!cardId) return;
    selectCard(cardId);
    bridge?.focusCard(cardId);
    setIsMobileOpen(false);
  };

  const handleEdit = async (task: (typeof completedTasks)[number]) => {
    const result = task.result!;
    const cardId = await ensureCard(task);
    if (!cardId) return;
    selectCard(cardId);
    const name =
      result.prompt || t("freeCanvas.resultName", { id: result.nanoid });
    openLightbox({
      url: result.url,
      title: name,
      subtitle: `${result.model} · ${result.size}`,
      fileName: `playground_${result.nanoid}.png`,
      initialMode: "edit",
      editable: buildEditable({ cardId, name }),
    });
    setIsMobileOpen(false);
  };

  const handleSetMain = async (task: (typeof completedTasks)[number]) => {
    const cardId = await ensureCard(task);
    if (!cardId) return;
    if (maskStrokes.length > 0) {
      setPendingPromoteId(cardId);
      return;
    }
    const ok = await promoteToMain(cardId, { discardMask: false });
    if (ok) bridge?.focusCard(cardId);
  };

  const handleConfirmPromote = async () => {
    if (!pendingPromoteId) return;
    const ok = await promoteToMain(pendingPromoteId, { discardMask: true });
    if (ok) bridge?.focusCard(pendingPromoteId);
    setPendingPromoteId(null);
  };

  const handleLocateLatest = () => {
    const latest = completedTasks[0];
    if (!latest) return;
    const cardId = cardByNanoid.get(latest.result!.nanoid);
    if (cardId) {
      selectCard(cardId);
      bridge?.focusCard(cardId);
    }
  };

  const handleRetrySave = async (
    task: (typeof completedTasks)[number]
  ) => {
    setBusyId(task.id);
    const result = task.result!;
    // Retrying the save must not resurrect a card the user removed; save the
    // queue result directly in that case.
    const cardId = cardByNanoid.get(result.nanoid);
    if (cardId) {
      await retrySaveCard(cardId);
    } else {
      await saveResultToGallery(task.id);
    }
    setBusyId(null);
  };

  const renderSaveLabel = (
    status: GenerationResult["gallerySaveStatus"] | "local"
  ) => {
    switch (status) {
      case "saved":
        return t("freeCanvas.saveStatusSaved");
      case "saving":
        return t("freeCanvas.saveStatusSaving");
      case "failed":
        return t("freeCanvas.saveStatusFailed");
      case "unavailable":
        return t("freeCanvas.cards.cannotRetrySave");
      case "local":
        return t("freeCanvas.cards.localResultHint");
      default:
        return t("freeCanvas.saveStatusNotSaved");
    }
  };

  const handleDownloadResult = async (result: GenerationResult) => {
    try {
      let blob = result.blob;
      if (!blob) {
        const { corsProxy, corsProxyMode } = useConfigStore.getState();
        blob =
          (await cardSource.resolveCardBlob(
            { url: result.url },
            corsProxy,
            corsProxyMode
          )) ?? undefined;
      }
      // Cross-origin URLs cannot be saved with <a download>; surface an error
      // instead of navigating the tab away and losing unsaved state.
      if (!blob || !downloadFile(blob, `playground_${result.nanoid}.png`)) {
        toast.error(t("err.downloadBlocked"));
      }
    } catch {
      toast.error(t("err.downloadBlocked"));
    }
  };

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        aria-expanded={isMobileOpen}
        onClick={() => setIsMobileOpen(true)}
        className={cn(
          "absolute right-4 z-20 border-white/10 bg-zinc-950/85 text-zinc-200 shadow-lg lg:hidden",
          isCanvas ? "top-20" : "top-4"
        )}
      >
        <ImagesIcon className="size-3.5 text-primary" />
        {t("freeCanvas.results")}
        {displayCount > 0 && (
          <Badge className="ml-1 h-4 min-w-4 px-1 text-[9px]">{displayCount}</Badge>
        )}
      </Button>

      {isMobileOpen && (
        <button
          type="button"
          aria-label={t("freeCanvas.closeResultsPanel")}
          onClick={() => setIsMobileOpen(false)}
          className="absolute inset-0 z-30 bg-black/50 lg:hidden"
        />
      )}

      <aside
        ref={drawerRef}
        aria-label={t("freeCanvas.generatedResults")}
        role={isMobileOpen ? "dialog" : undefined}
        aria-modal={isMobileOpen ? true : undefined}
        // Registered with isOverlayOpen: while the drawer covers the canvas,
        // Esc must close it and Delete must not reach a card behind it.
        data-canvas-overlay={isMobileOpen ? "true" : undefined}
        tabIndex={isMobileOpen ? -1 : undefined}
        className={cn(
          "z-40 flex-col border-l border-white/10 bg-zinc-950/95 text-zinc-100 backdrop-blur-2xl transition-[width] duration-200",
          isMobileOpen
            ? "absolute inset-y-0 right-0 flex w-[min(22rem,calc(100%-1rem))] shadow-2xl lg:static lg:shrink-0 lg:shadow-none"
            : "hidden lg:static lg:flex lg:shrink-0",
          isCollapsed ? "lg:w-12" : "lg:w-[300px]"
        )}
      >
        {isCollapsed && !isMobileOpen ? (
          <div className="hidden h-full flex-col items-center gap-3 py-3 lg:flex">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={t("freeCanvas.expandResultsPanel")}
              title={t("freeCanvas.expandResultsPanel")}
              onClick={() => setIsCollapsed(false)}
              className="cursor-pointer text-zinc-300 hover:text-white"
            >
              <ChevronLeftIcon />
            </Button>
            <div
              className="flex flex-col items-center gap-2 text-primary"
              title={t("freeCanvas.resultsCount", { count: displayCount })}
            >
              <HistoryIcon className="size-4" />
              <span className="text-[10px] font-medium [writing-mode:vertical-rl]">
                {t("freeCanvas.resultsItems", { count: displayCount })}
              </span>
            </div>
          </div>
        ) : (
          <>
            <header className="flex shrink-0 items-center justify-between gap-2 border-b border-white/10 px-3 py-3">
              <div className="flex min-w-0 items-center gap-2">
                <HistoryIcon className="size-4 shrink-0 text-primary" />
                <span className="truncate text-sm font-semibold">
                  {t("freeCanvas.results")}
                </span>
                <Badge
                  variant="outline"
                  className="h-5 shrink-0 border-white/10 text-[10px] text-zinc-300"
                >
                  {displayCount}
                </Badge>
                {activeTasks.length > 0 && (
                  <span className="flex items-center gap-1 text-[10px] text-primary">
                    <Loader2Icon className="size-3 animate-spin" />
                    {activeTasks.length}
                  </span>
                )}
                {failedTasks.length > 0 && (
                  <span className="flex items-center gap-1 text-[10px] text-red-400">
                    <AlertTriangleIcon className="size-3" />
                    {failedTasks.length}
                  </span>
                )}
              </div>

              <div className="flex shrink-0 items-center gap-1">
                {isCanvas && completedTasks.length > 0 && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    aria-label={t("freeCanvas.cards.locateLatest")}
                    title={t("freeCanvas.cards.locateLatest")}
                    onClick={handleLocateLatest}
                    className="cursor-pointer text-zinc-400 hover:text-white"
                  >
                    <LocateFixedIcon />
                  </Button>
                )}
                {finishedCount > 0 && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    onClick={clearFinished}
                    className="cursor-pointer text-[10px] text-zinc-400 hover:text-white"
                    title={t("freeCanvas.cards.clearFinishedHint")}
                  >
                    {t("common.clear")}
                  </Button>
                )}
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label={t("freeCanvas.openGallery")}
                  title={t("freeCanvas.openGallery")}
                  onClick={() => navigate("/gallery")}
                  className="cursor-pointer text-zinc-400 hover:text-white"
                >
                  <ImagesIcon />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label={t("freeCanvas.collapseResultsPanel")}
                  title={t("freeCanvas.collapseResultsPanel")}
                  onClick={() => setIsCollapsed(true)}
                  className="hidden cursor-pointer text-zinc-400 hover:text-white lg:inline-flex"
                >
                  <ChevronRightIcon />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label={t("freeCanvas.closeResultsPanel")}
                  onClick={() => setIsMobileOpen(false)}
                  className="cursor-pointer text-zinc-400 hover:text-white lg:hidden"
                >
                  <XIcon />
                </Button>
              </div>
            </header>

            <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
              {activeTasks.map((task) => (
                <div
                  key={task.id}
                  className="rounded-xl border border-primary/25 bg-primary/5 p-3"
                >
                  <div className="mb-2 flex items-center gap-2">
                    <Loader2Icon className="size-4 shrink-0 animate-spin text-primary" />
                    <span className="min-w-0 flex-1 truncate text-xs font-medium">
                      {task.title}
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      aria-label={t("freeCanvas.cancelTask")}
                      onClick={() => cancelTask(task.id)}
                      className="cursor-pointer text-zinc-500 hover:text-white"
                    >
                      <XIcon />
                    </Button>
                  </div>
                  <Progress value={task.progress} />
                  <div className="mt-1 flex justify-between gap-2 text-[10px] text-zinc-400">
                    <span className="truncate">{task.statusText}</span>
                    <span>{task.progress}%</span>
                  </div>
                </div>
              ))}

              {failedTasks.map((task) => (
                <div
                  key={task.id}
                  className="rounded-xl border border-red-500/25 bg-red-950/20 p-3"
                >
                  <div className="flex items-start gap-2">
                    <AlertTriangleIcon className="mt-0.5 size-4 shrink-0 text-red-400" />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-semibold text-red-300">
                        {task.title} · {t("freeCanvas.taskFailed")}
                      </p>
                      <p className="mt-1 line-clamp-3 text-[10px] text-red-200/75">
                        {task.error || task.statusText}
                      </p>
                    </div>
                  </div>
                  <div className="mt-2 flex justify-end gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="xs"
                      onClick={() => retryTask(task.id)}
                      className="cursor-pointer"
                    >
                      <RotateCcwIcon />
                      {t("common.retry")}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="xs"
                      onClick={() => removeTask(task.id)}
                      className="cursor-pointer"
                    >
                      {t("freeCanvas.remove")}
                    </Button>
                  </div>
                </div>
              ))}

              {isCanvas && unsavedCards.length > 0 && (
                <section className="space-y-1.5 rounded-xl border border-amber-400/25 bg-amber-500/5 p-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-amber-300">
                      <SaveIcon className="size-3" />
                      {t("freeCanvas.cards.unsavedGroup")}
                    </span>
                    <span className="text-[10px] text-amber-300/70">
                      {unsavedCards.length}
                    </span>
                  </div>
                  {unsavedCards.map((card) => (
                    <div
                      key={`unsaved-${card.id}`}
                      className="flex items-center gap-2 rounded-lg bg-black/20 px-2 py-1.5"
                    >
                      <button
                        type="button"
                        className="size-8 shrink-0 overflow-hidden rounded-md bg-zinc-900"
                        onClick={() => {
                          selectCard(card.id);
                          if (card.url) {
                            openLightbox({
                              url: card.url,
                              title: card.name,
                              subtitle: t("freeCanvas.cards.resultBadge"),
                              fileName: `playground_${card.nanoid || card.id}.png`,
                              editable: buildEditable({
                                cardId: card.id,
                                name: card.name,
                                allowCopy: true,
                              }),
                            });
                          }
                        }}
                        aria-label={t("freeCanvas.cards.openLargeAria", {
                          name: card.name,
                        })}
                      >
                        {card.url ? (
                          <img
                            src={card.url}
                            alt={card.name}
                            className="size-full object-cover"
                          />
                        ) : null}
                      </button>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[10px] text-zinc-300">
                          {card.prompt || t("freeCanvas.noPrompt")}
                        </p>
                        <p
                          className="truncate text-[9px] text-amber-300/80"
                          title={card.saveError || undefined}
                        >
                          {card.saveStatus === "unavailable"
                            ? t("freeCanvas.cards.cannotRetrySave")
                            : card.saveError ||
                              t("freeCanvas.saveStatusNotSaved")}
                        </p>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="xs"
                        disabled={
                          card.saveStatus === "unavailable" ||
                          card.saveStatus === "saving" ||
                          (!card.url && !card.galleryNanoid) ||
                          busyId === card.id
                        }
                        onClick={() => {
                          void (async () => {
                            setBusyId(card.id);
                            await retrySaveCard(card.id);
                            setBusyId(null);
                          })();
                        }}
                        className="h-6 shrink-0 cursor-pointer px-1.5 text-[10px] text-primary"
                        title={t("freeCanvas.cards.retrySave")}
                      >
                        {busyId === card.id ||
                        card.saveStatus === "saving" ? (
                          <Loader2Icon className="size-3 animate-spin" />
                        ) : (
                          t("freeCanvas.cards.retrySave")
                        )}
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        className="cursor-pointer text-zinc-400 hover:text-white"
                        title={t("freeCanvas.cards.locateLatest")}
                        aria-label={t("freeCanvas.cards.locateLatest")}
                        onClick={() => {
                          selectCard(card.id);
                          bridge?.focusCard(card.id);
                        }}
                      >
                        <LocateFixedIcon />
                      </Button>
                    </div>
                  ))}
                </section>
              )}

              {completedTasks.map((task) => {
                const result = task.result!;
                const cardId = cardByNanoid.get(result.nanoid);
                const isSelected =
                  isCanvas && cardId != null && cardId === selectedCardId;
                const saveStatus =
                  (cardId != null ? cardStatusById.get(cardId) : undefined) ??
                  result.gallerySaveStatus;

                return (
                  <article
                    key={task.id}
                    className={cn(
                      "flex gap-2 rounded-xl border bg-white/[0.03] p-2 transition-colors",
                      isSelected
                        ? "border-primary/70 ring-1 ring-primary/40"
                        : "border-white/10 hover:border-white/20"
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => void handleOpenLarge(task)}
                      aria-label={t("freeCanvas.cards.openLargeAria", {
                        name: result.prompt || result.nanoid,
                      })}
                      className="relative aspect-square w-24 shrink-0 overflow-hidden rounded-lg bg-zinc-900"
                    >
                      <img
                        src={result.url}
                        alt={result.prompt || t("freeCanvas.generatedResultAlt")}
                        className="size-full object-cover"
                      />
                      {isSelected && (
                        <span className="absolute inset-x-0 bottom-0 bg-primary/90 py-0.5 text-[9px] font-medium text-black">
                          {t("freeCanvas.cards.onCanvasBadge")}
                        </span>
                      )}
                    </button>

                    <div className="flex min-w-0 flex-1 flex-col">
                      <p className="line-clamp-3 flex-1 text-[11px] leading-relaxed text-zinc-300">
                        {result.prompt || t("freeCanvas.noPrompt")}
                      </p>
                      <div className="mt-1 flex items-center gap-1 text-[9px] text-zinc-500">
                        <span className="truncate">{result.nanoid.slice(0, 8)}</span>
                        <span>·</span>
                        <span className="truncate">{renderSaveLabel(saveStatus)}</span>
                        {saveStatus !== "saved" &&
                          saveStatus !== "saving" &&
                          saveStatus !== "unavailable" &&
                          saveStatus !== "local" && (
                          <button
                            type="button"
                            onClick={() => void handleRetrySave(task)}
                            disabled={busyId === task.id}
                            title={t("freeCanvas.cards.retrySave")}
                            className="shrink-0 cursor-pointer text-primary hover:underline disabled:opacity-50"
                          >
                            {t("freeCanvas.cards.retrySave")}
                          </button>
                        )}
                      </div>

                      <div className="mt-1 flex items-center gap-0.5">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-xs"
                          title={t("freeCanvas.cards.openLarge")}
                          aria-label={t("freeCanvas.cards.openLarge")}
                          onClick={() => void handleOpenLarge(task)}
                          className="cursor-pointer"
                        >
                          <EyeIcon />
                        </Button>
                        {isCanvas && (
                          <>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-xs"
                              title={t("preview.edit.action")}
                              aria-label={t("preview.edit.action")}
                              disabled={isCommittingMain}
                              onClick={() => void handleEdit(task)}
                              className="cursor-pointer"
                            >
                              <PencilIcon />
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-xs"
                              title={t("freeCanvas.cards.addToCanvas")}
                              aria-label={t("freeCanvas.cards.addToCanvas")}
                              onClick={() => void handleAddToCanvas(task)}
                              className="cursor-pointer"
                            >
                              <PlusIcon />
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-xs"
                              title={t("freeCanvas.cards.setAsMainTitle")}
                              aria-label={t("freeCanvas.cards.setAsMain")}
                              disabled={isCommittingMain}
                              onClick={() => void handleSetMain(task)}
                              className="cursor-pointer text-primary"
                            >
                              <SparklesIcon />
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-xs"
                              title={t("freeCanvas.setAsReference")}
                              aria-label={t("freeCanvas.setAsReference")}
                              onClick={() => void addResultAsReference(result)}
                              className="cursor-pointer"
                            >
                              <ImagePlusIcon />
                            </Button>
                          </>
                        )}
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-xs"
                          title={t("freeCanvas.downloadOriginal")}
                          aria-label={t("freeCanvas.downloadOriginal")}
                          onClick={() => void handleDownloadResult(result)}
                          className={cn("cursor-pointer", !isCanvas && "ml-auto")}
                        >
                          <DownloadIcon />
                        </Button>
                        {isCanvas && cardId && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-xs"
                            title={t("freeCanvas.cards.locateLatest")}
                            aria-label={t("freeCanvas.cards.locateLatest")}
                            onClick={() => {
                              selectCard(cardId);
                              bridge?.focusCard(cardId);
                            }}
                            className="ml-auto cursor-pointer"
                          >
                            <LocateFixedIcon />
                          </Button>
                        )}
                      </div>
                    </div>
                  </article>
                );
              })}

              {totalCount === 0 && unsavedCards.length === 0 && (
                <div className="flex min-h-32 items-center justify-center text-xs text-zinc-500">
                  {t("freeCanvas.noResults")}
                </div>
              )}
            </div>
          </>
        )}
      </aside>

      <ConfirmDialog
        open={Boolean(pendingPromoteId)}
        title={t("freeCanvas.cards.discardMaskTitle")}
        description={t("freeCanvas.cards.discardMaskDesc")}
        confirmLabel={t("freeCanvas.cards.discardMaskConfirm")}
        busy={isCommittingMain}
        onCancel={() => setPendingPromoteId(null)}
        onConfirm={() => void handleConfirmPromote()}
      />
    </>
  );
}
