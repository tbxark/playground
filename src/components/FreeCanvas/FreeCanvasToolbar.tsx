import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  EraserIcon,
  ImagePlusIcon,
  LayersIcon,
  MousePointerIcon,
  NetworkIcon,
  PencilIcon,
  SparklesIcon,
  Trash2Icon,
  UndoIcon,
} from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { Button } from "../ui/button";
import { Slider } from "../ui/slider";
import { ConfirmDialog } from "../ui/confirm-dialog";
import {
  CANVAS_ADD_BUTTON_CLASS,
  CANVAS_BAR_BUTTON_CLASS,
  CANVAS_SUBBAR_SURFACE,
  CanvasBarDivider,
  CanvasMenu,
  CanvasMenuItem,
  CanvasTopBar,
} from "../Canvas/CanvasChrome";
import { useFreeCanvasStore } from "../../stores/useFreeCanvasStore";
import {
  persistWorkflowImage,
  useWorkflowStore,
} from "../../stores/useWorkflowStore";
import { useCommandPaletteStore } from "../../stores/useCommandPaletteStore";
import { useLightboxStore } from "../../stores/useLightboxStore";
import { useCardEdit } from "../../hooks/useCardEdit";
import { cn } from "@/utils/cn";

export function FreeCanvasToolbar() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { buildEditable } = useCardEdit();
  const openLightbox = useLightboxStore((state) => state.open);
  const main = useFreeCanvasStore((state) =>
    state.cards.find((card) => card.role === "main")
  );
  const exportMainImage = useFreeCanvasStore((state) => state.exportMainImage);
  const clearMain = useFreeCanvasStore((state) => state.clearMain);
  const clearAllCards = useFreeCanvasStore((state) => state.clearAllCards);
  const addFiles = useFreeCanvasStore((state) => state.addFiles);
  const cards = useFreeCanvasStore((state) => state.cards);
  const selectedCardId = useFreeCanvasStore((state) => state.selectedCardId);
  const isCommittingMain = useFreeCanvasStore((state) => state.isCommittingMain);
  const {
    activeTool,
    setActiveTool,
    maskBrushSize,
    setMaskBrushSize,
    isMaskEraser,
    setIsMaskEraser,
    maskStrokes,
    setMaskStrokes,
    isMaskInverted,
    setIsMaskInverted,
    clearMask,
  } = useFreeCanvasStore(
    useShallow((state) => ({
      activeTool: state.activeTool,
      setActiveTool: state.setActiveTool,
      maskBrushSize: state.maskBrushSize,
      setMaskBrushSize: state.setMaskBrushSize,
      isMaskEraser: state.isMaskEraser,
      setIsMaskEraser: state.setIsMaskEraser,
      maskStrokes: state.maskStrokes,
      setMaskStrokes: state.setMaskStrokes,
      isMaskInverted: state.isMaskInverted,
      setIsMaskInverted: state.setIsMaskInverted,
      clearMask: state.clearMask,
    }))
  );

  const [confirmClearOpen, setConfirmClearOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmClearAllOpen, setConfirmClearAllOpen] = useState(false);

  const pendingFreeCanvasClear = useCommandPaletteStore(
    (state) => state.pendingFreeCanvasClear
  );
  const consumeFreeCanvasClear = useCommandPaletteStore(
    (state) => state.consumeFreeCanvasClear
  );

  // Palette action: navigate here, then show the clear confirmation.
  useEffect(() => {
    if (!pendingFreeCanvasClear) return;
    consumeFreeCanvasClear();
    setConfirmClearAllOpen(true);
  }, [pendingFreeCanvasClear, consumeFreeCanvasClear]);

  const handleConfirmClearAll = () => {
    // Never clear while a main-image commit is writing assets.
    if (useFreeCanvasStore.getState().isCommittingMain) return;
    // Keep the exact cards that were removed: the toast outlives several
    // possible edits, and a global undo() would then revert the wrong action.
    const removedCards = useFreeCanvasStore.getState().cards;
    const count = clearAllCards();
    setConfirmClearAllOpen(false);
    if (count === 0) {
      toast.info(t("freeCanvas.cards.clearCanvasEmpty"));
      return;
    }
    toast.success(t("freeCanvas.cards.clearCanvasDone", { count }), {
      action: {
        label: t("common.undo"),
        onClick: () => {
          removedCards.forEach((card) =>
            useFreeCanvasStore.getState().restoreCard(card)
          );
        },
      },
    });
  };

  // Overflow menu: add a free image / destructive "clear canvas". Kept out of
  // the main row so the destructive action is never a one-click accident.
  // The file input lives outside the menu: the menu closes as soon as the entry
  // is picked, and the input must stay mounted for its change event to arrive.
  const freeImageInputRef = useRef<HTMLInputElement>(null);
  const overflowMenu = (
    <>
      <input
        ref={freeImageInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(event) => {
          if (event.target.files?.length) {
            void addFiles(event.target.files, { asFree: true });
          }
          event.target.value = "";
        }}
      />
      <CanvasMenu label={t("common.more")}>
        {(close) => (
          <>
            <CanvasMenuItem
              icon={LayersIcon}
              iconClassName="text-violet-300"
              label={t("freeCanvas.cards.addFreeImage")}
              title={t("freeCanvas.cards.freeHint")}
              onSelect={() => {
                close();
                freeImageInputRef.current?.click();
              }}
            />
            <CanvasMenuItem
              icon={Trash2Icon}
              label={t("freeCanvas.cards.clearCanvas")}
              destructive
              disabled={cards.length === 0 || isCommittingMain}
              onSelect={() => {
                close();
                setConfirmClearAllOpen(true);
              }}
            />
          </>
        )}
      </CanvasMenu>
    </>
  );

  if (!main) {
    return (
      <>
        <CanvasTopBar
          barProps={{ "data-free-canvas-toolbar": "true" }}
          rail={
            <label
              className={CANVAS_ADD_BUTTON_CLASS}
              title={t("freeCanvas.chooseImage")}
            >
              <ImagePlusIcon className="size-3.5 text-primary" />
              <span>{t("freeCanvas.chooseImage")}</span>
              <input
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(event) => {
                  if (event.target.files?.length) {
                    void addFiles(event.target.files);
                    event.target.value = "";
                  }
                }}
              />
            </label>
          }
          trailing={overflowMenu}
        />

        <ConfirmDialog
          open={confirmClearAllOpen}
          title={t("freeCanvas.cards.clearCanvasTitle")}
          description={t("freeCanvas.cards.clearCanvasDesc", {
            count: cards.length,
          })}
          confirmLabel={t("freeCanvas.cards.clearCanvas")}
          onCancel={() => setConfirmClearAllOpen(false)}
          onConfirm={handleConfirmClearAll}
        />
      </>
    );
  }

  const hasMask = maskStrokes.length > 0;

  const handleSendToWorkflow = async () => {
    const imageUrl = await exportMainImage();
    if (!imageUrl) return;
    // Store the bytes instead of handing the graph a multi-MB data URL: the
    // workflow graph is persisted to localStorage on every write.
    const stored = await persistWorkflowImage(imageUrl);
    useWorkflowStore.getState().addNode("image", undefined, {
      imageUrl: stored?.url ?? imageUrl,
      imageAssetKey: stored?.assetKey,
      imageName: main.name,
    });
    navigate("/workflow");
    toast.success(t("freeCanvas.toastSentToWorkflow"));
  };

  const handleConfirmClear = async () => {
    setBusy(true);
    const ok = await clearMain({ discardMask: true });
    setBusy(false);
    if (ok) setConfirmClearOpen(false);
  };

  // Edit follows the selection; with nothing selected it falls back to the main
  // image. The entry used to be hard-wired to the main card, so selecting a
  // reference/free/result card and pressing "Edit" opened the main image.
  const editTarget =
    (selectedCardId
      ? cards.find((card) => card.id === selectedCardId)
      : undefined) ?? main;

  const editTargetSubtitle = (() => {
    if (!editTarget) return undefined;
    if (editTarget.role === "main") return t("freeCanvas.cards.mainBadge");
    if (editTarget.role === "result") return t("freeCanvas.cards.resultBadge");
    if (editTarget.role === "free") return t("freeCanvas.cards.freeBadge");
    const references = cards
      .filter((card) => card.role === "reference")
      .sort((a, b) => (a.refOrder ?? 0) - (b.refOrder ?? 0));
    const index = references.findIndex((card) => card.id === editTarget.id);
    return t("freeCanvas.cards.referenceBadge", { index: index + 1 });
  })();

  const openEditor = () => {
    if (!editTarget?.url) return;
    const isMain = editTarget.role === "main";
    openLightbox({
      url: editTarget.url,
      title: editTarget.name,
      subtitle: editTargetSubtitle,
      compareSrc: editTarget.compareUrl || editTarget.originalUrl,
      fileName: `playground_${editTarget.nanoid || editTarget.id}.png`,
      initialMode: "edit",
      editable: buildEditable({
        cardId: editTarget.id,
        name: editTarget.name,
        isMain,
        discardWarning: isMain && hasMask,
        allowCopy: !isMain,
      }),
    });
  };

  return (
    <>
      <CanvasTopBar
        barProps={{ "data-free-canvas-toolbar": "true" }}
        rail={
          <>
            <Button
              variant={activeTool === "select" ? "default" : "ghost"}
              size="sm"
              className={cn(
                CANVAS_BAR_BUTTON_CLASS,
                "transition-all",
                activeTool === "select"
                  ? "bg-white font-bold text-zinc-950 shadow-md hover:bg-white"
                  : "text-zinc-400 hover:text-white"
              )}
              onClick={() => setActiveTool("select")}
            >
              <MousePointerIcon className="mr-1 size-3.5" />
              {t("freeCanvas.toolRoam")}
            </Button>

            <Button
              variant={activeTool === "inpaint" ? "default" : "ghost"}
              size="sm"
              className={cn(
                CANVAS_BAR_BUTTON_CLASS,
                "transition-all",
                activeTool === "inpaint"
                  ? "bg-amber-500 font-bold text-zinc-950 shadow-md hover:bg-amber-400"
                  : "text-zinc-400 hover:text-amber-400"
              )}
              onClick={() => setActiveTool("inpaint")}
              title={t("freeCanvas.toolInpaintTitle")}
            >
              <SparklesIcon className="mr-1 size-3.5 text-amber-400" />
              {t("freeCanvas.toolInpaint")}
            </Button>

            <CanvasBarDivider />

            <Button
              variant="ghost"
              size="sm"
              className={cn(
                CANVAS_BAR_BUTTON_CLASS,
                "text-zinc-200 hover:bg-violet-500/10 hover:text-violet-200"
              )}
              onClick={openEditor}
              disabled={isCommittingMain || !editTarget?.url}
              title={t("preview.edit.openHint")}
            >
              <PencilIcon className="mr-1 size-3.5 text-violet-300" />
              {t("preview.edit.action")}
            </Button>

            <Button
              variant="ghost"
              size="sm"
              className={cn(
                CANVAS_BAR_BUTTON_CLASS,
                "text-zinc-200 hover:bg-white/10 hover:text-white"
              )}
              onClick={() => void handleSendToWorkflow()}
              title={t("freeCanvas.sendToWorkflowTitle")}
            >
              <NetworkIcon className="mr-1 size-3.5 text-cyan-400" />
              {t("freeCanvas.sendToWorkflow")}
            </Button>
          </>
        }
        trailing={
          <>
            <button
              type="button"
              className="flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-xl text-zinc-500 transition-colors hover:bg-red-500/10 hover:text-red-400"
              onClick={() => setConfirmClearOpen(true)}
              disabled={isCommittingMain}
              title={t("freeCanvas.cards.unsetMain")}
              aria-label={t("freeCanvas.cards.unsetMain")}
            >
              <Trash2Icon className="size-3.5" />
            </button>
            {overflowMenu}
          </>
        }
        subBar={
          activeTool === "inpaint" ? (
            <div
              className={cn(
                CANVAS_SUBBAR_SURFACE,
                "no-scrollbar flex max-w-full animate-in items-center gap-3 overflow-x-auto px-3 py-1.5 text-xs fade-in-0 slide-in-from-top-1"
              )}
            >
              <div className="flex items-center gap-1">
                <Button
                  variant={!isMaskEraser ? "default" : "outline"}
                  size="xs"
                  className={cn(
                    "h-7 cursor-pointer rounded-lg text-xs",
                    !isMaskEraser
                      ? "bg-amber-500 font-bold text-zinc-950 hover:bg-amber-400"
                      : "border-white/10 bg-transparent text-zinc-300"
                  )}
                  onClick={() => setIsMaskEraser(false)}
                >
                  <SparklesIcon className="mr-1 size-3" />
                  {t("freeCanvas.paintMask")}
                </Button>
                <Button
                  variant={isMaskEraser ? "default" : "outline"}
                  size="xs"
                  className={cn(
                    "h-7 cursor-pointer rounded-lg text-xs",
                    isMaskEraser
                      ? "bg-white font-bold text-zinc-950 hover:bg-zinc-200"
                      : "border-white/10 bg-transparent text-zinc-300"
                  )}
                  onClick={() => setIsMaskEraser(true)}
                >
                  <EraserIcon className="mr-1 size-3" />
                  {t("freeCanvas.eraser")}
                </Button>
              </div>

              <div className="flex w-36 items-center gap-2">
                <span className="whitespace-nowrap text-[11px] text-zinc-400">
                  {t("freeCanvas.brushSize")} {maskBrushSize}
                </span>
                <Slider
                  min={4}
                  max={100}
                  value={[maskBrushSize]}
                  onValueChange={([value]) => setMaskBrushSize(value)}
                />
              </div>

              <div className="h-3.5 w-px bg-white/10" />

              <Button
                variant="ghost"
                size="xs"
                disabled={maskStrokes.length === 0}
                onClick={() => setMaskStrokes((strokes) => strokes.slice(0, -1))}
                className="cursor-pointer text-zinc-400 hover:text-white"
              >
                <UndoIcon className="mr-1 size-3" />
                {t("freeCanvas.undo")}
              </Button>

              <Button
                variant="ghost"
                size="xs"
                onClick={() => setIsMaskInverted(!isMaskInverted)}
                className="cursor-pointer text-zinc-400 hover:text-white"
              >
                {isMaskInverted
                  ? t("freeCanvas.maskInvertedOn")
                  : t("freeCanvas.maskInvertedOff")}
              </Button>

              <Button
                variant="ghost"
                size="xs"
                disabled={maskStrokes.length === 0}
                onClick={clearMask}
                className="cursor-pointer text-destructive/80 hover:text-destructive"
              >
                {t("freeCanvas.clearMask")}
              </Button>
            </div>
          ) : undefined
        }
      />

      <ConfirmDialog
        open={confirmClearOpen}
        title={t("freeCanvas.cards.clearMainTitle")}
        description={
          hasMask
            ? t("freeCanvas.cards.discardMaskDesc")
            : t("freeCanvas.cards.clearMainDesc")
        }
        confirmLabel={t("freeCanvas.cards.unsetMain")}
        busy={busy || isCommittingMain}
        onCancel={() => setConfirmClearOpen(false)}
        onConfirm={() => void handleConfirmClear()}
      />

      <ConfirmDialog
        open={confirmClearAllOpen}
        title={t("freeCanvas.cards.clearCanvasTitle")}
        description={t("freeCanvas.cards.clearCanvasDesc", {
          count: cards.length,
        })}
        confirmLabel={t("freeCanvas.cards.clearCanvas")}
        onCancel={() => setConfirmClearAllOpen(false)}
        onConfirm={handleConfirmClearAll}
      />
    </>
  );
}
