import React, { memo, useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  AlertTriangleIcon,
  ChevronDownIcon,
  CopyIcon,
  CrosshairIcon,
  GripVerticalIcon,
  Loader2Icon,
  Maximize2Icon,
  PencilIcon,
  Trash2Icon,
} from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { drawMaskOverlay } from "../../utils/composeMain";
import {
  CanvasCard,
  Point,
  useFreeCanvasStore,
} from "../../stores/useFreeCanvasStore";
import { useLightboxStore } from "../../stores/useLightboxStore";
import { useConfigStore } from "../../stores/useConfigStore";
import { useCardEdit } from "../../hooks/useCardEdit";
import { useFreeCanvasBridge } from "./FreeCanvasBridge";
import { Button } from "../ui/button";
import { ConfirmDialog } from "../ui/confirm-dialog";
import { CanvasContextMenu } from "../Canvas/CanvasContextMenu";
import {
  CanvasMenuItem,
  CanvasMenuItemDivider,
} from "../Canvas/CanvasChrome";
import {
  CARD_HEADER_HEIGHT,
  cardFrameClass,
  cardHeaderClass,
  cardImageHeight,
  roleBadgeClass,
} from "./cardStyles";
import { CardResizeGrip, useCardResize } from "./CardResizeHandle";
import { useCardDrag } from "./useCardDrag";
import * as cardSource from "../../utils/cardSource";
import { isEditableTarget } from "../../utils/keyboard";
import { cn } from "@/utils/cn";

type MainCardProps = {
  card: CanvasCard;
  isSpaceDown: boolean;
};

/**
 * The main image card. Pixels are always final here: crop / rotate / annotate /
 * background removal live in the shared viewer editor, so this card only shows
 * the bitmap plus the pending inpaint mask (a generation input, not an edit).
 */
export const MainCard = memo(function MainCard({
  card,
  isSpaceDown,
}: MainCardProps) {
  const { t } = useTranslation();
  const bridge = useFreeCanvasBridge();
  const openLightbox = useLightboxStore((state) => state.open);
  const closeLightbox = useLightboxStore((state) => state.close);
  const corsProxy = useConfigStore((state) => state.corsProxy);
  const corsProxyMode = useConfigStore((state) => state.corsProxyMode);
  const selectCard = useFreeCanvasStore((state) => state.selectCard);
  const updateCardSize = useFreeCanvasStore((state) => state.updateCardSize);
  const rehydrateCard = useFreeCanvasStore((state) => state.rehydrateCard);
  const clearMain = useFreeCanvasStore((state) => state.clearMain);
  const isCommittingMain = useFreeCanvasStore((state) => state.isCommittingMain);
  const selectedCardId = useFreeCanvasStore((state) => state.selectedCardId);
  const isHydrated = useFreeCanvasStore((state) => state.isHydrated);
  const { buildEditable } = useCardEdit();

  const {
    activeTool,
    maskBrushSize,
    isMaskEraser,
    maskStrokes,
    setMaskStrokes,
    isMaskInverted,
  } = useFreeCanvasStore(
    useShallow((state) => ({
      activeTool: state.activeTool,
      maskBrushSize: state.maskBrushSize,
      isMaskEraser: state.isMaskEraser,
      maskStrokes: state.maskStrokes,
      setMaskStrokes: state.setMaskStrokes,
      isMaskInverted: state.isMaskInverted,
    }))
  );

  const maskCanvasRef = useRef<HTMLCanvasElement>(null);
  const [natural, setNatural] = useState({ width: 0, height: 0 });

  const [loadError, setLoadError] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  const [confirmClearOpen, setConfirmClearOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [copying, setCopying] = useState(false);
  const [menuPosition, setMenuPosition] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const showMenu = menuPosition !== null;

  // Drag state is local during the gesture; the store is written once on release.
  const { frameRef, dragHandlers } = useCardDrag(card, !isSpaceDown);

  const isDrawingMaskRef = useRef(false);
  const maskPointsRef = useRef<Point[]>([]);

  const selected = selectedCardId === card.id;
  const originalUrl = card.compareUrl || card.originalUrl;
  const missing = card.assetState === "missing" || !card.url;
  const hydrating = !card.url && (!isHydrated || card.assetState === "loading");
  const {
    width,
    isResizing,
    handleProps: resizeHandlers,
    resetWidth,
  } = useCardResize(card);

  useEffect(() => {
    setLoadError(false);
    setNatural({ width: 0, height: 0 });
  }, [card.url, retryKey]);

  useEffect(() => {
    if (!selected) setMenuPosition(null);
  }, [selected]);

  const renderMask = useCallback(() => {
    const canvas = maskCanvasRef.current;
    if (!canvas) return;
    const maskWidth = natural.width || 1;
    const maskHeight = natural.height || 1;
    if (canvas.width !== maskWidth) canvas.width = maskWidth;
    if (canvas.height !== maskHeight) canvas.height = maskHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    drawMaskOverlay(
      ctx,
      { maskStrokes, isMaskEraser, isMaskInverted, maskBrushSize },
      maskWidth,
      maskHeight
    );
  }, [natural, maskStrokes, isMaskEraser, isMaskInverted, maskBrushSize]);

  useEffect(() => {
    renderMask();
  }, [renderMask]);

  const getCanvasPixelPoint = (
    clientX: number,
    clientY: number
  ): Point | null => {
    const canvas = maskCanvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    return {
      x: (clientX - rect.left) * (canvas.width / rect.width),
      y: (clientY - rect.top) * (canvas.height / rect.height),
    };
  };

  const handleCanvasPointerDown = (event: React.PointerEvent) => {
    if (event.button !== 0 || isSpaceDown) return;
    selectCard(card.id);
    if (activeTool !== "inpaint") return;
    (event.target as HTMLElement).setPointerCapture(event.pointerId);
    isDrawingMaskRef.current = true;
    const point = getCanvasPixelPoint(event.clientX, event.clientY);
    if (point) maskPointsRef.current = [point];
  };

  const handleCanvasPointerMove = (event: React.PointerEvent) => {
    if (activeTool !== "inpaint" || !isDrawingMaskRef.current) return;
    const point = getCanvasPixelPoint(event.clientX, event.clientY);
    if (!point) return;
    maskPointsRef.current.push(point);
    const ctx = maskCanvasRef.current?.getContext("2d");
    const points = maskPointsRef.current;
    if (ctx && points.length > 1) {
      ctx.save();
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.lineWidth = maskBrushSize;
      // Match the exported mask: inverted mode regenerates everything except
      // non-eraser strokes, so the brush roles swap visually too.
      if (isMaskInverted) {
        if (isMaskEraser) {
          ctx.globalCompositeOperation = "source-over";
          ctx.strokeStyle = "rgba(245, 158, 11, 0.65)";
        } else {
          ctx.globalCompositeOperation = "destination-out";
          ctx.strokeStyle = "rgba(0,0,0,1)";
        }
      } else if (isMaskEraser) {
        ctx.globalCompositeOperation = "destination-out";
        ctx.strokeStyle = "rgba(0,0,0,1)";
      } else {
        ctx.globalCompositeOperation = "source-over";
        ctx.strokeStyle = "rgba(245, 158, 11, 0.65)";
      }
      ctx.beginPath();
      ctx.moveTo(points[points.length - 2].x, points[points.length - 2].y);
      ctx.lineTo(points[points.length - 1].x, points[points.length - 1].y);
      ctx.stroke();
      ctx.restore();
    }
  };

  const handleCanvasPointerUp = () => {
    if (!isDrawingMaskRef.current) return;
    isDrawingMaskRef.current = false;
    const points = [...maskPointsRef.current];
    maskPointsRef.current = [];
    if (points.length > 0) {
      setMaskStrokes((prev) => [
        ...prev,
        { points, size: maskBrushSize, isEraser: isMaskEraser },
      ]);
    }
  };

  const handleMenuTrigger = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (showMenu) {
      setMenuPosition(null);
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    setMenuPosition({ x: rect.right - 208, y: rect.bottom + 6 });
  };

  // Right-click opens the same menu as the header chevron. Shift keeps the
  // browser menu so "save image as" stays available.
  const handleContextMenu = (event: React.MouseEvent) => {
    if (event.shiftKey || isEditableTarget(event.target)) return;
    event.preventDefault();
    selectCard(card.id);
    setMenuPosition({ x: event.clientX, y: event.clientY });
  };

  const handleCopyImage = async () => {
    setCopying(true);
    const ok = await cardSource.copyCardImageToClipboard(
      card,
      corsProxy,
      corsProxyMode
    );
    setCopying(false);
    if (ok) {
      toast.success(t("freeCanvas.cards.copyImageDone"));
    } else {
      toast.error(t("freeCanvas.cards.copyImageFailed"));
    }
  };

  const handleConfirmClear = async () => {
    setBusy(true);
    const ok = await clearMain({ discardMask: maskStrokes.length > 0 });
    setBusy(false);
    if (ok) {
      setConfirmClearOpen(false);
      // Also closes the viewer when the action came from there.
      closeLightbox();
    }
  };

  /**
   * The main card opens the shared viewer just like result/reference cards. The
   * viewer now also owns every single-image edit, so "Edit image" is one step
   * from the card menu and opens the same dialog in edit mode.
   */
  const openMainLightbox = (mode: "view" | "edit" = "view") => {
    if (!card.url) return;
    selectCard(card.id);
    openLightbox({
      url: card.url,
      title: card.name,
      subtitle: t("freeCanvas.cards.mainBadge"),
      compareSrc: originalUrl,
      fileName: `playground_${card.nanoid || card.id}.png`,
      initialMode: mode,
      editable: buildEditable({
        cardId: card.id,
        name: card.name,
        isMain: true,
        discardWarning: maskStrokes.length > 0,
      }),
      actions: [
        {
          id: "unset-main",
          label: t("freeCanvas.cards.unsetMain"),
          keepOpen: true,
          onSelect: async () => {
            if (useFreeCanvasStore.getState().maskStrokes.length > 0) {
              setConfirmClearOpen(true);
              return;
            }
            const ok = await clearMain({ discardMask: false });
            if (ok) closeLightbox();
          },
        },
      ],
    });
  };

  const handleStageClick = (event: React.MouseEvent) => {
    if (activeTool !== "select" || isSpaceDown) return;
    const target = event.target as HTMLElement;
    if (target.closest("button, a, input, textarea, label")) return;
    openMainLightbox();
  };

  const showMissing = missing || loadError;

  return (
    <>
      <div
        ref={frameRef}
        className={cardFrameClass("main", selected)}
        style={{
          left: card.x,
          top: card.y,
          width,
          zIndex: selected ? 30 : 10,
        }}
        onPointerDown={() => selectCard(card.id)}
        onContextMenu={handleContextMenu}
      >
        <div
          className={cn(cardHeaderClass("main"), "cursor-grab active:cursor-grabbing")}
          style={{ height: CARD_HEADER_HEIGHT }}
          {...dragHandlers}
        >
          <GripVerticalIcon className="size-3.5 shrink-0 text-primary/70" />
          <span
            className={cn(
              "shrink-0 rounded-md border px-1.5 py-0.5 text-[10px] font-bold",
              roleBadgeClass("main")
            )}
          >
            {t("freeCanvas.cards.mainBadge")}
          </span>
          <span
            className="min-w-0 flex-1 truncate text-[11px] font-medium text-zinc-200"
            title={card.name || t("freeCanvas.currentBaseImage")}
          >
            {card.name || t("freeCanvas.currentBaseImage")}
          </span>
          {card.isEdited && (
            <span
              className="size-1.5 shrink-0 rounded-full bg-sky-400"
              title={t("freeCanvas.cards.editedBadge")}
            />
          )}
          {card.resultMeta && card.saveStatus !== "saved" && (
            <span
              className={cn(
                "size-1.5 shrink-0 rounded-full",
                card.saveStatus === "saving"
                  ? "animate-pulse bg-amber-400"
                  : card.saveStatus === "failed"
                    ? "bg-red-400"
                    : card.saveStatus === "local"
                      ? "bg-cyan-400"
                      : "bg-zinc-500"
              )}
              title={
                card.saveStatus === "saving"
                  ? t("freeCanvas.saveStatusSaving")
                  : card.saveStatus === "failed"
                    ? t("freeCanvas.saveStatusFailed")
                    : card.saveStatus === "local"
                      ? t("freeCanvas.cards.localResultHint")
                      : t("freeCanvas.cards.cannotRetrySave")
              }
            />
          )}
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="text-zinc-300 hover:text-white"
            title={t("freeCanvas.cards.more")}
            aria-label={t("freeCanvas.cards.more")}
            aria-haspopup="menu"
            aria-expanded={showMenu}
            data-canvas-context-menu-trigger="true"
            onClick={handleMenuTrigger}
          >
            <ChevronDownIcon
              className={cn("transition-transform", showMenu && "rotate-180")}
            />
          </Button>
        </div>

        {/* One menu for the header chevron and right-click. Portalled by the
            shared shell, so zoom and canvas edges cannot resize or clip it. */}
        <CanvasContextMenu
          open={showMenu}
          x={menuPosition?.x ?? 0}
          y={menuPosition?.y ?? 0}
          onClose={() => setMenuPosition(null)}
          label={t("freeCanvas.cards.more")}
        >
          <CanvasMenuItem
            icon={Maximize2Icon}
            label={t("freeCanvas.cards.openLarge")}
            disabled={!card.url}
            onSelect={() => openMainLightbox("view")}
          />
          <CanvasMenuItem
            icon={PencilIcon}
            label={t("preview.edit.action")}
            disabled={!card.url || isCommittingMain}
            onSelect={() => openMainLightbox("edit")}
          />
          <CanvasMenuItem
            icon={CrosshairIcon}
            label={t("freeCanvas.fitCenterTitle")}
            onSelect={() => bridge?.focusCard(card.id)}
          />

          <CanvasMenuItemDivider />

          <CanvasMenuItem
            icon={CopyIcon}
            label={t("freeCanvas.cards.copyImage")}
            disabled={
              !card.url || isCommittingMain || copying || showMissing || hydrating
            }
            onSelect={() => void handleCopyImage()}
          />

          <CanvasMenuItemDivider />

          <CanvasMenuItem
            icon={Trash2Icon}
            label={t("freeCanvas.cards.unsetMain")}
            destructive
            disabled={isCommittingMain}
            onSelect={() => setConfirmClearOpen(true)}
          />
        </CanvasContextMenu>

        {hydrating ? (
          <div
            className="flex items-center justify-center gap-2 p-10 text-xs text-zinc-400"
            style={{ minHeight: cardImageHeight(card) }}
          >
            <Loader2Icon className="size-4 animate-spin text-primary" />
            {t("common.loading")}
          </div>
        ) : showMissing ? (
          <div
            className="flex flex-col items-center gap-3 p-6 text-center"
            style={{ minHeight: cardImageHeight(card) }}
          >
            <AlertTriangleIcon className="size-7 text-amber-400" />
            <div>
              <p className="text-sm font-semibold text-zinc-100">
                {loadError && card.assetState !== "missing"
                  ? t("freeCanvas.cards.loadFailedTitle")
                  : t("freeCanvas.cards.missingTitle")}
              </p>
              <p className="mt-1 text-[11px] leading-relaxed text-zinc-400">
                {loadError && card.assetState !== "missing"
                  ? t("freeCanvas.cards.loadFailedDesc")
                  : t("freeCanvas.cards.missingDesc")}
              </p>
            </div>
            <div className="flex flex-wrap items-center justify-center gap-1.5">
              <Button
                type="button"
                size="xs"
                variant="outline"
                onClick={() => {
                  setRetryKey((value) => value + 1);
                  void rehydrateCard(card.id);
                }}
              >
                {t("freeCanvas.cards.retryLoad")}
              </Button>
              {card.galleryNanoid && (
                <Button
                  type="button"
                  size="xs"
                  variant="outline"
                  onClick={() => void rehydrateCard(card.id)}
                >
                  {t("freeCanvas.cards.reloadFromGallery")}
                </Button>
              )}
              <Button
                type="button"
                size="xs"
                variant="destructive"
                onClick={() => setConfirmClearOpen(true)}
              >
                {t("freeCanvas.cards.unsetMain")}
              </Button>
            </div>
          </div>
        ) : (
          <div
            onClick={handleStageClick}
            className={cn(
              // The stage must match the image box exactly: the mask canvas is
              // sized to the natural image, so any padding here would make
              // strokes land off-target.
              "relative select-none overflow-hidden rounded-b-2xl bg-transparency-grid",
              activeTool === "select" && "cursor-zoom-in"
            )}
          >
            <img
              src={card.url}
              alt={card.name || t("freeCanvas.currentBaseImage")}
              draggable={false}
              className="block h-auto w-full select-none"
              onLoad={(event) => {
                const element = event.currentTarget;
                const imageWidth = element.naturalWidth || element.width || 1;
                const imageHeight = element.naturalHeight || element.height || 1;
                setNatural({ width: imageWidth, height: imageHeight });
                updateCardSize(card.id, imageWidth, imageHeight);
              }}
              onError={() => setLoadError(true)}
            />
            <canvas
              ref={maskCanvasRef}
              className={cn(
                "absolute inset-0 block h-full w-full",
                activeTool === "inpaint"
                  ? isMaskEraser
                    ? "cursor-cell"
                    : "cursor-crosshair"
                  : "pointer-events-none"
              )}
              onPointerDown={handleCanvasPointerDown}
              onPointerMove={handleCanvasPointerMove}
              onPointerUp={handleCanvasPointerUp}
              onPointerLeave={handleCanvasPointerUp}
            />
          </div>
        )}

        <CardResizeGrip
          handlers={resizeHandlers}
          isResizing={isResizing}
          visible={selected}
          onReset={resetWidth}
        />
      </div>

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
    </>
  );
});
