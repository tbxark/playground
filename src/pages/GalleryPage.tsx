import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  ArchiveIcon,
  CheckIcon,
  CopyIcon,
  DownloadIcon,
  EyeIcon,
  ImagesIcon,
  Loader2Icon,
  Maximize2Icon,
  RefreshCwIcon,
  NetworkIcon,
  PaletteIcon,
  RotateCcwIcon,
  SearchIcon,
  StarIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Badge } from "../components/ui/badge";
import { Dialog, DialogClose, DialogContent, DialogTitle } from "../components/ui/dialog";
import { ConfirmDialog } from "../components/ui/confirm-dialog";
import { useGalleryStore } from "../stores/useGalleryStore";
import { useFreeCanvasStore } from "../stores/useFreeCanvasStore";
import { useLightboxStore } from "../stores/useLightboxStore";
import { persistWorkflowImage, useWorkflowStore } from "../stores/useWorkflowStore";
import { usePromptStore } from "../stores/usePromptStore";
import { useConfigStore } from "../stores/useConfigStore";
import { HistoryRecord } from "../services/types";
import { blobToDataUrl, downloadFile, formatDate } from "../utils/file";
import { cn } from "@/utils/cn";

/**
 * The object URL must live as long as the thumbnail, not as long as a render.
 * Creating it inline (and revoking it on `load`) re-created and reloaded every
 * image whenever the grid re-rendered for an unrelated reason — starring a
 * record, typing in search, opening the inspector.
 */
function GalleryThumb({ blob, alt }: { blob: Blob; alt: string }) {
  const [url, setUrl] = useState("");

  useEffect(() => {
    const next = URL.createObjectURL(blob);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [blob]);

  if (!url) return null;

  return (
    <img
      src={url}
      alt={alt}
      draggable={false}
      className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
    />
  );
}

/** Compact elapsed time for the inspector's spec list: 8.4s / 23s. */
function formatDuration(ms: number): string {
  const seconds = ms / 1000;
  return seconds < 10 ? `${seconds.toFixed(1)}s` : `${Math.round(seconds)}s`;
}

export function GalleryPage() {
  const navigate = useNavigate();
  const { t } = useTranslation();

  const {
    records,
    availableModels,
    isLoading,
    loadError,
    clearError,
    search,
    starredOnly,
    selectedModel,
    setSearch,
    setStarredOnly,
    setSelectedModel,
    refreshRecords,
    handleToggleStar,
    handleDeleteRecord,
    handleClearAll,
    handleExportZip,
  } = useGalleryStore();

  const setMainFromGallery = useFreeCanvasStore((state) => state.setMainFromGallery);
  const maskStrokes = useFreeCanvasStore((state) => state.maskStrokes);
  const openLightbox = useLightboxStore((state) => state.open);
  const { addNode } = useWorkflowStore();
  const { setPrompt, setNegativePrompt, setSize, setResolution, setSeed } = usePromptStore();
  const { setSelectedModel: setGlobalSelectedModel, imageConfig } = useConfigStore();

  const [inspectRecord, setInspectRecord] = useState<HistoryRecord | null>(null);
  const [inspectImageUrl, setInspectImageUrl] = useState<string>("");
  const [copiedPrompt, setCopiedPrompt] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [pendingMainRecord, setPendingMainRecord] = useState<HistoryRecord | null>(null);
  const [loadingMain, setLoadingMain] = useState(false);
  const [confirmClearOpen, setConfirmClearOpen] = useState(false);
  const [pendingDeleteRecord, setPendingDeleteRecord] = useState<HistoryRecord | null>(null);

  // Load records on mount
  useEffect(() => {
    void refreshRecords();
  }, [refreshRecords]);

  // Object URL for inspect modal
  useEffect(() => {
    if (!inspectRecord) {
      setInspectImageUrl("");
      return;
    }

    const url = URL.createObjectURL(inspectRecord.imageBlob);
    setInspectImageUrl(url);

    return () => {
      URL.revokeObjectURL(url);
    };
  }, [inspectRecord]);

  // Action: atomically replace the free-canvas main image, committing the
  // current main's crop/rotate/annotation edits first.
  const loadIntoFreeCanvas = async (record: HistoryRecord) => {
    setLoadingMain(true);
    try {
      const ok = await setMainFromGallery({
        blob: record.imageBlob,
        nanoid: record.nanoid,
        name: t("gallery.artworkName", { model: record.model, id: record.nanoid }),
        prompt: record.prompt,
        createdAt: record.createdAt,
        discardMask: true,
      });
      if (ok) {
        setInspectRecord(null);
        setPendingMainRecord(null);
        navigate("/");
      }
    } finally {
      setLoadingMain(false);
    }
  };

  const handleLoadIntoFreeCanvas = (record: HistoryRecord) => {
    if (maskStrokes.length > 0) {
      setPendingMainRecord(record);
      return;
    }
    void loadIntoFreeCanvas(record);
  };

  // Action: Send to the Workflow as an image node and navigate to /workflow
  const handleSendToWorkflow = async (record: HistoryRecord) => {
    try {
      // The graph persists node data to localStorage, so store the blob and
      // give the node an asset key instead of a base64 data URL.
      const stored = await persistWorkflowImage(record.imageBlob);
      addNode("image", undefined, {
        imageUrl: stored?.url ?? URL.createObjectURL(record.imageBlob),
        imageAssetKey: stored?.assetKey,
        imageName: t("gallery.artworkName", { model: record.model, id: record.nanoid }),
      });
      setInspectRecord(null);
      navigate("/workflow");
    } catch {
      toast.error(t("gallery.toastLoadArtworkFailed"));
    }
  };

  // Action: Reuse params to generate in the Free Canvas
  const handleReuseParams = (record: HistoryRecord) => {
    setPrompt(record.prompt);
    setNegativePrompt(record.negativePrompt || "");
    setSize(record.size);
    setResolution(record.resolution);
    setSeed(record.seed);
    if (record.model) {
        if (imageConfig.enabledModelIds.includes(record.model)) {
        setGlobalSelectedModel(record.model);
      } else {
        toast.warning(t("gallery.toastModelDisabled"));
      }
    }
    setInspectRecord(null);
    navigate("/");
  };

  // Action: Copy prompt text
  const handleCopyPrompt = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedPrompt(true);
      setTimeout(() => setCopiedPrompt(false), 2000);
    } catch {
      // ignore
    }
  };

  // Action: Export zip with feedback
  const handleExportZipWithFeedback = async () => {
    setIsExporting(true);
    try {
      await handleExportZip();
    } finally {
      setIsExporting(false);
    }
  };

  const modelList = availableModels;

  const starredCount = useMemo(() => {
    return records.filter((r) => r.starred).length;
  }, [records]);

  // The inspector reads the live store row so starring inside it updates at once;
  // search/filter changes never leave a stale record open.
  const inspected = inspectRecord
    ? records.find((record) => record.id === inspectRecord.id) ?? inspectRecord
    : null;

  const specRows = inspected
    ? [
        { label: t("gallery.modelLabel"), value: inspected.model },
        ...(inspected.provider
          ? [{ label: t("gallery.providerLabel"), value: inspected.provider }]
          : []),
        {
          label: t("gallery.aspectResolution"),
          value: [inspected.size, inspected.resolution].filter(Boolean).join(" · "),
        },
        {
          label: t("gallery.seed"),
          value:
            inspected.seed != null
              ? String(inspected.seed)
              : t("gallery.seedAuto"),
        },
        ...(inspected.generationTimeMs > 0
          ? [
              {
                label: t("gallery.durationLabel"),
                value: formatDuration(inspected.generationTimeMs),
              },
            ]
          : []),
        {
          label: t("gallery.generatedAt"),
          value: formatDate(inspected.createdAt),
        },
      ]
    : [];

  return (
    <div className="flex-1 w-full h-full bg-background text-foreground flex flex-col overflow-hidden select-none">
      {/* Top Gallery Toolbar */}
      <div className="p-3 sm:p-4 sm:px-6 border-b border-border bg-background/80 backdrop-blur-xl flex flex-col lg:flex-row lg:flex-wrap items-stretch lg:items-center justify-between gap-3 sm:gap-4 shrink-0">
        {/* Left: Title & Explanations */}
        <div className="flex items-center gap-3">
          <div className="size-8 rounded-xl bg-primary/20 border border-primary/30 flex items-center justify-center text-primary shrink-0">
            <ImagesIcon className="size-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-sm font-bold text-foreground tracking-tight">{t("gallery.title")}</h1>
              <Badge variant="outline" className="text-[11px] font-mono py-0 h-5 bg-muted border-border text-muted-foreground">
                {t("gallery.recordCount", { count: records.length })}
              </Badge>
            </div>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                {t("gallery.subtitle")}
              </p>
          </div>
        </div>

        {/* Center: Search & Filter Toolbar */}
        <div className="flex flex-wrap items-center gap-2 flex-1 max-w-xl min-w-0 w-full">
          {/* Search Input */}
          <div className="relative flex-1 min-w-[150px]">
            <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("gallery.searchPlaceholder")}
              className="h-9 pl-9 text-xs bg-background border-border text-foreground placeholder:text-muted-foreground rounded-xl"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground hover:text-foreground flex items-center justify-center"
              >
                <XIcon className="size-3" />
              </button>
            )}
          </div>

          {/* Star Filter Pill */}
          <Button
            type="button"
            variant={starredOnly ? "default" : "outline"}
            size="sm"
            onClick={() => setStarredOnly(!starredOnly)}
            className={cn(
              "h-9 px-3 text-xs rounded-xl border shrink-0 transition-all",
              starredOnly
                ? "bg-amber-500 text-zinc-950 font-bold border-amber-400 hover:bg-amber-400"
                : "bg-muted/50 hover:bg-muted border-border text-muted-foreground"
            )}
            title={t("gallery.starFilterTitle")}
          >
            <StarIcon className={cn("size-3.5 mr-1", starredOnly ? "fill-current" : "text-amber-400")} />
            <span>{t("gallery.starredCount", { count: starredCount })}</span>
          </Button>

          {/* Quick Model Filter Pills if multiple models exist */}
          {modelList.length > 1 && (
            <div className="flex items-center gap-1 bg-muted/50 p-1 rounded-xl border border-border shrink-0 max-w-full overflow-x-auto no-scrollbar">
              <button
                type="button"
                onClick={() => setSelectedModel("all")}
                className={cn(
                  "px-2 py-0.5 rounded-lg text-xs font-medium cursor-pointer transition-colors",
                  selectedModel === "all" ? "bg-accent text-foreground font-bold" : "text-muted-foreground hover:text-foreground"
                )}
              >
                {t("common.all")}
              </button>
              {modelList.map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setSelectedModel(m)}
                  className={cn(
                    "px-2 py-0.5 rounded-lg text-xs font-medium cursor-pointer font-mono transition-colors",
                    selectedModel === m ? "bg-accent text-foreground font-bold" : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {m}
                </button>
              ))}
            </div>
          )}

          {isLoading && <Loader2Icon className="size-4 animate-spin text-primary shrink-0 ml-1" />}
          {loadError && <span role="alert" className="text-[11px] text-destructive">{t("gallery.loadErrorInline")}</span>}
        </div>

        {/* Right: Batch Export & Clear */}
        <div className="flex items-center gap-2 shrink-0">
          <Button
            variant="outline"
            size="sm"
            disabled={records.length === 0 || isExporting}
            onClick={handleExportZipWithFeedback}
            className="h-9 px-3 text-xs rounded-xl bg-muted/50 hover:bg-muted border-border text-foreground font-medium cursor-pointer"
            title={t("gallery.exportAllTitle")}
          >
            <ArchiveIcon className="size-3.5 mr-1.5 text-primary" />
            <span>{isExporting ? t("gallery.exporting") : t("gallery.exportAll")}</span>
          </Button>

          <Button
            variant="ghost"
            size="sm"
            disabled={records.length === 0 || isLoading}
            onClick={() => setConfirmClearOpen(true)}
            className="h-9 px-3 text-xs rounded-xl text-zinc-400 hover:text-destructive hover:bg-destructive/10 cursor-pointer"
            title={t("gallery.clearTitle")}
          >
            <Trash2Icon className="size-3.5 mr-1" />
            <span>{t("common.clear")}</span>
          </Button>
        </div>
      </div>

      {/* Main Grid Content */}
      <div className="flex-1 overflow-y-auto p-3 sm:p-6">
        {clearError && (
          <div role="alert" className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
            <span>{t("gallery.clearFailed", { message: clearError })}</span>
            <Button size="xs" variant="outline" onClick={() => void handleClearAll()}>{t("common.retry")}</Button>
          </div>
        )}
        {loadError ? (
          <div role="alert" className="mx-auto flex min-h-[360px] max-w-md flex-col items-center justify-center text-center">
            <RefreshCwIcon className="mb-3 size-8 text-destructive" />
            <h3 className="text-base font-bold text-foreground">{t("gallery.loadErrorTitle")}</h3>
            <p className="mt-2 text-sm text-muted-foreground">{loadError}</p>
            <Button className="mt-5" size="sm" onClick={() => void refreshRecords()}>
              <RefreshCwIcon className="mr-1.5 size-3.5" />
              {t("gallery.retryLoad")}
            </Button>
          </div>
        ) : records.length === 0 && isLoading ? (
          <div className="flex min-h-[360px] items-center justify-center text-sm text-muted-foreground">
            <Loader2Icon className="mr-2 size-4 animate-spin text-primary" /> {t("gallery.loadingGallery")}
          </div>
        ) : records.length === 0 ? (
          <div className="h-full min-h-[360px] flex flex-col items-center justify-center text-center max-w-md mx-auto">
            <div className="size-16 rounded-3xl bg-muted border border-border flex items-center justify-center text-muted-foreground mb-4 shadow-xl">
              <ImagesIcon className="size-8 text-primary/60" />
            </div>
                <h3 className="text-base font-bold text-foreground mb-1.5">
                  {search || starredOnly || selectedModel !== "all" ? t("gallery.emptyFilteredTitle") : t("gallery.emptyTitle")}
                </h3>
              <p className="text-sm text-muted-foreground leading-relaxed mb-6">
                {search || starredOnly || selectedModel !== "all" ? t("gallery.emptyFilteredDesc") : t("gallery.emptyDesc")}
              </p>
            {search || starredOnly || selectedModel !== "all" ? (
              <Button size="sm" variant="outline" onClick={() => { setSearch(""); setStarredOnly(false); setSelectedModel("all"); }}>
                {t("gallery.clearFilters")}
              </Button>
            ) : (
              <Button
                size="sm"
                onClick={() => navigate("/")}
                className="h-9 px-5 rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 font-bold text-xs gap-1.5 shadow-lg shadow-primary/20 hover:scale-[1.02] active:scale-[0.98] transition-all cursor-pointer"
              >
                <PaletteIcon className="size-4" />
                <span>{t("gallery.goToFreeCanvas")}</span>
              </Button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 sm:gap-4">
            {records.map((record) => {
              return (
                <div
                  key={record.id}
                  className="group relative rounded-2xl border border-border bg-card/70 overflow-hidden shadow-lg hover:border-primary/40 transition-all flex flex-col"
                >
                  {/* Thumbnail Container */}
                  <div className="relative aspect-square w-full bg-zinc-950 overflow-hidden">
                    <button
                      type="button"
                      className="absolute inset-0 z-0 h-full w-full overflow-hidden text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                      onClick={() => setInspectRecord(record)}
                      aria-label={t("gallery.viewArtworkAria", { name: record.prompt || record.nanoid })}
                    >
                      <GalleryThumb blob={record.imageBlob} alt={record.prompt} />
                    </button>

                    <button
                      type="button"
                      className={cn(
                        "absolute top-2 left-2 z-20 size-8 rounded-xl flex items-center justify-center transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
                        record.starred
                          ? "bg-amber-500 text-zinc-950 font-bold shadow-md"
                          : "bg-black/70 backdrop-blur-md text-white/80 hover:text-white"
                      )}
                      onClick={() => void handleToggleStar(record.id)}
                      aria-pressed={record.starred}
                      aria-label={record.starred ? t("gallery.unstar") : t("gallery.star")}
                      title={record.starred ? t("gallery.unstar") : t("gallery.star")}
                    >
                      <StarIcon className={cn("size-3.5", record.starred && "fill-current")} />
                    </button>

                    <div className="absolute top-2 right-2 z-10 px-2 py-0.5 rounded-lg bg-black/70 backdrop-blur-md border border-white/10 text-[10px] font-mono text-zinc-100 max-w-[100px] truncate pointer-events-none">
                      {record.model}
                    </div>

                    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-black/95 via-black/80 to-transparent p-2 pt-8 flex flex-col gap-1.5">
                      <Button
                        size="xs"
                        onClick={() => void handleLoadIntoFreeCanvas(record)}
                        className="pointer-events-auto h-8 w-full bg-primary hover:bg-primary/90 text-white font-bold text-[11px] rounded-lg gap-1 shadow-md cursor-pointer"
                        title={t("gallery.loadFreeCanvasTitle")}
                      >
                        <PaletteIcon className="size-3" />
                        <span>{t("gallery.loadFreeCanvas")}</span>
                      </Button>
                      <Button
                        size="xs"
                        variant="outline"
                        onClick={() => void handleSendToWorkflow(record)}
                        className="pointer-events-auto h-8 w-full bg-white/10 hover:bg-white/20 border-white/20 text-white text-[11px] rounded-lg gap-1 cursor-pointer"
                        title={t("gallery.sendWorkflowTitle")}
                      >
                        <NetworkIcon className="size-3 text-cyan-400" />
                        <span>{t("gallery.sendToWorkflow")}</span>
                      </Button>
                    </div>
                  </div>
                  <div className="flex items-center justify-between gap-1 border-t border-border bg-card/80 p-1.5">
                    <Button size="xs" variant="ghost" onClick={() => setInspectRecord(record)} className="h-7 px-2 text-[10px] text-muted-foreground hover:text-foreground" title={t("gallery.detailsTitle")}>
                      <EyeIcon className="mr-1 size-3" />{t("common.details")}
                    </Button>
                    <Button size="xs" variant="ghost" onClick={() => downloadFile(record.imageBlob, `playground_${record.model}_${record.nanoid}.png`)} className="h-7 px-2 text-[10px] text-muted-foreground hover:text-foreground" title={t("gallery.downloadOriginal")}>
                      <DownloadIcon className="mr-1 size-3" />{t("common.download")}
                    </Button>
                    <Button size="xs" variant="ghost" onClick={() => setPendingDeleteRecord(record)} className="h-7 px-2 text-[10px] text-destructive hover:bg-destructive/10" title={t("gallery.deleteArtworkTitle")}>
                      <Trash2Icon className="mr-1 size-3" />{t("common.delete")}
                    </Button>
                  </div>

                  {/* Card Caption Footer */}
                  <div className="p-2.5 flex flex-col gap-1 bg-card/80 text-xs">
                    <p className="truncate text-foreground font-medium text-[11px]" title={record.prompt}>
                      {record.prompt || t("gallery.noPrompt")}
                    </p>
                    <div className="flex items-center justify-between text-[10px] text-muted-foreground font-mono">
                      <span>{record.resolution || record.size}</span>
                      <span>{formatDate(record.createdAt)}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Artwork inspector: the image is the subject, the dossier stays quiet. */}
      {inspected && (
        <Dialog open={Boolean(inspected)} onOpenChange={(open) => !open && setInspectRecord(null)}>
          <DialogContent
            showCloseButton={false}
            aria-describedby={undefined}
            className="flex h-[88vh] md:h-[min(88vh,660px)] w-full flex-col gap-0 overflow-hidden border-border bg-card p-0 text-foreground shadow-2xl sm:w-[calc(100%-2rem)] sm:max-w-[1120px] md:flex-row"
          >
            {/* Left: the artwork itself; the whole stage opens the lightbox. */}
            <div className="relative h-[34vh] shrink-0 overflow-hidden border-b border-border bg-zinc-950 md:h-auto md:min-w-0 md:flex-1 md:border-b-0 md:border-r">
              {inspectImageUrl ? (
                <button
                  type="button"
                  onClick={() =>
                    openLightbox({
                      url: inspectImageUrl,
                      title:
                        inspected.prompt ||
                        t("gallery.artworkName", {
                          model: inspected.model,
                          id: inspected.nanoid,
                        }),
                      subtitle: `${inspected.size} · ${inspected.resolution}`,
                      fileName: `playground_${inspected.model}_${inspected.nanoid}.png`,
                    })
                  }
                  aria-label={t("preview.openAria", {
                    name: inspected.prompt || inspected.nanoid,
                  })}
                  className="group absolute inset-0 flex cursor-zoom-in items-center justify-center p-4 focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-inset focus-visible:outline-none md:p-6"
                >
                  <img
                    src={inspectImageUrl}
                    alt={inspected.prompt}
                    className="max-h-full max-w-full rounded-lg object-contain shadow-2xl"
                  />
                  <span className="pointer-events-none absolute right-4 bottom-4 hidden items-center gap-1.5 rounded-lg border border-white/10 bg-zinc-900/80 px-2.5 py-1 text-[11px] text-zinc-200 opacity-0 backdrop-blur-md transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 md:inline-flex">
                    <Maximize2Icon className="size-3" />
                    {t("preview.viewLarge")}
                  </span>
                </button>
              ) : (
                <div className="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground">
                  {t("gallery.loadingPreview")}
                </div>
              )}
            </div>

            {/* Right: parameters first, then the next step. */}
            <div className="flex min-h-0 w-full flex-1 flex-col bg-card md:w-[340px] md:flex-none lg:w-96">
              <div className="flex items-center justify-between gap-2 px-5 pt-4 pb-2.5">
                <DialogTitle className="text-sm font-semibold text-foreground">
                  {t("gallery.paramsTitle")}
                </DialogTitle>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => void handleToggleStar(inspected.id)}
                    aria-pressed={inspected.starred}
                    aria-label={inspected.starred ? t("gallery.unstar") : t("gallery.star")}
                    title={inspected.starred ? t("gallery.starredAlready") : t("gallery.addToStarred")}
                    className={cn(
                      "flex size-8 cursor-pointer items-center justify-center rounded-lg border transition-colors",
                      inspected.starred
                        ? "border-amber-500/40 bg-amber-500/15 text-amber-400"
                        : "border-border bg-muted/40 text-muted-foreground hover:text-foreground"
                    )}
                  >
                    <StarIcon className={cn("size-4", inspected.starred && "fill-current")} />
                  </button>
                  <DialogClose asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={t("common.close")}
                      title={t("common.close")}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      <XIcon className="size-4" />
                    </Button>
                  </DialogClose>
                </div>
              </div>

              <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5">
                <section className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium text-muted-foreground">
                      {t("gallery.positivePrompt")}
                    </span>
                    <Button
                      variant="ghost"
                      size="xs"
                      disabled={!inspected.prompt}
                      onClick={() => void handleCopyPrompt(inspected.prompt)}
                      className="-mr-1.5 h-6 gap-1 px-1.5 text-[11px] text-muted-foreground hover:text-foreground"
                    >
                      {copiedPrompt ? (
                        <>
                          <CheckIcon className="size-3 text-emerald-500" />
                          <span className="text-emerald-500">{t("common.copied")}</span>
                        </>
                      ) : (
                        <>
                          <CopyIcon className="size-3" />
                          <span>{t("common.copy")}</span>
                        </>
                      )}
                    </Button>
                  </div>
                  <div
                    className={cn(
                      "max-h-40 overflow-y-auto rounded-lg bg-muted/60 px-3 py-1.5 text-[13px] leading-relaxed break-words whitespace-pre-wrap text-pretty select-text",
                      inspected.prompt ? "text-foreground/90" : "text-muted-foreground"
                    )}
                  >
                    {inspected.prompt || t("gallery.noPrompt")}
                  </div>
                </section>

                {inspected.negativePrompt && (
                  <section className="space-y-1.5">
                    <span className="text-xs font-medium text-muted-foreground">
                      {t("gallery.negativePrompt")}
                    </span>
                    <div className="max-h-32 overflow-y-auto rounded-lg bg-muted/60 px-3 py-1.5 text-[13px] leading-relaxed break-words whitespace-pre-wrap text-pretty text-muted-foreground select-text">
                      {inspected.negativePrompt}
                    </div>
                  </section>
                )}

                <dl className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-x-3 gap-y-1 md:gap-y-2">
                  {specRows.map((row) => (
                    <React.Fragment key={row.label}>
                      <dt className="text-[11px] leading-5 text-muted-foreground">{row.label}</dt>
                      <dd className="min-w-0 font-mono text-xs leading-5 break-words text-foreground/90 tabular-nums">
                        {row.value}
                      </dd>
                    </React.Fragment>
                  ))}
                </dl>

                <div className="sticky bottom-0 mt-5 space-y-2 border-t border-border bg-card pt-4 pb-4">
                  <Button
                    onClick={() => void handleLoadIntoFreeCanvas(inspected)}
                    className="h-10 w-full gap-2 rounded-lg text-xs font-semibold"
                  >
                    <PaletteIcon className="size-3.5" />
                    {t("gallery.loadFreeCanvasTitle")}
                  </Button>

                  <div className="grid grid-cols-2 gap-2">
                    <Button
                      variant="outline"
                      onClick={() => void handleSendToWorkflow(inspected)}
                      title={t("gallery.sendWorkflowTitle")}
                      className="h-9 gap-1.5 rounded-lg text-xs"
                    >
                      <NetworkIcon className="size-3.5 text-cyan-500" />
                      {t("gallery.sendToWorkflow")}
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => handleReuseParams(inspected)}
                      title={t("gallery.reuseParamsTitle")}
                      className="h-9 gap-1.5 rounded-lg text-xs"
                    >
                      <RotateCcwIcon className="size-3.5 text-amber-500" />
                      {t("gallery.reuseParams")}
                    </Button>
                  </div>

                  <div className="flex items-center justify-between gap-2">
                    <Button
                      variant="ghost"
                      size="xs"
                      onClick={() =>
                        downloadFile(
                          inspected.imageBlob,
                          `playground_${inspected.model}_${inspected.nanoid}.png`
                        )
                      }
                      className="h-8 gap-1.5 px-2 text-xs text-muted-foreground hover:text-foreground"
                    >
                      <DownloadIcon className="size-3.5" />
                      {t("gallery.downloadOriginal")}
                    </Button>
                    <Button
                      variant="ghost"
                      size="xs"
                      onClick={() => setPendingDeleteRecord(inspected)}
                      className="h-8 gap-1.5 px-2 text-xs text-destructive/90 hover:bg-destructive/10 hover:text-destructive"
                    >
                      <Trash2Icon className="size-3.5" />
                      {t("common.delete")}
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}

      <ConfirmDialog
        open={Boolean(pendingMainRecord)}
        title={t("freeCanvas.cards.galleryLoadTitle")}
        description={t("freeCanvas.cards.galleryLoadDesc")}
        confirmLabel={t("freeCanvas.cards.discardMaskConfirm")}
        busy={loadingMain}
        onCancel={() => setPendingMainRecord(null)}
        onConfirm={() => {
          if (pendingMainRecord) void loadIntoFreeCanvas(pendingMainRecord);
        }}
      />

      <ConfirmDialog
        open={pendingDeleteRecord !== null}
        title={t("gallery.deleteConfirmTitle")}
        description={t("gallery.deleteConfirmDesc", {
          name:
            pendingDeleteRecord?.prompt ||
            pendingDeleteRecord?.nanoid ||
            "",
        })}
        confirmLabel={t("common.delete")}
        onCancel={() => setPendingDeleteRecord(null)}
        onConfirm={() => {
          if (!pendingDeleteRecord) return;
          const record = pendingDeleteRecord;
          setPendingDeleteRecord(null);
          // The record and its blob are deleted from IndexedDB for good, so ask
          // first and close the inspector if it was showing that record.
          setInspectRecord((current) =>
            current?.id === record.id ? null : current
          );
          void handleDeleteRecord(record.id);
        }}
      />

      <ConfirmDialog
        open={confirmClearOpen}
        title={t("gallery.clearTitle")}
        description={t("gallery.confirmClearAll")}
        confirmLabel={t("common.clear")}
        onCancel={() => setConfirmClearOpen(false)}
        onConfirm={() => {
          setConfirmClearOpen(false);
          void handleClearAll();
        }}
      />
    </div>
  );
}
