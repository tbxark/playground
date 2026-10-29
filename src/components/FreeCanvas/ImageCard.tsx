import React, { memo, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  AlertTriangleIcon,
  ArrowDownIcon,
  ArrowUpIcon,
  ChevronDownIcon,
  CopyIcon,
  DownloadIcon,
  GripVerticalIcon,
  ImagePlusIcon,
  LayersIcon,
  Loader2Icon,
  Maximize2Icon,
  PencilIcon,
  SparklesIcon,
  Trash2Icon,
} from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import {
  CanvasCard,
  MAX_REFERENCE_PARTICIPATION,
  useFreeCanvasStore,
} from "../../stores/useFreeCanvasStore";
import {
  LightboxAction,
  useLightboxStore,
} from "../../stores/useLightboxStore";
import { useConfigStore } from "../../stores/useConfigStore";
import { useCardEdit } from "../../hooks/useCardEdit";
import { GenerationResult } from "../../services/types";
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
import { downloadFile } from "../../utils/file";
import { cn } from "@/utils/cn";

type ImageCardProps = {
  card: CanvasCard;
  isSpaceDown: boolean;
  referenceIndex?: number;
};

export const ImageCard = memo(function ImageCard({
  card,
  isSpaceDown,
  referenceIndex = 0,
}: ImageCardProps) {
  const { t } = useTranslation();
  const bridge = useFreeCanvasBridge();
  const openLightbox = useLightboxStore((state) => state.open);
  const closeLightbox = useLightboxStore((state) => state.close);
  const corsProxy = useConfigStore((state) => state.corsProxy);
  const corsProxyMode = useConfigStore((state) => state.corsProxyMode);
  const { buildEditable } = useCardEdit();
  const {
    selectCard,
    selectedCardId,
    removeCard,
    restoreCard,
    rehydrateCard,
    promoteToMain,
    addResultAsReference,
    retrySaveCard,
    moveReference,
    setCardRole,
    maskStrokes,
    isCommittingMain,
    isHydrated,
  } = useFreeCanvasStore(
    useShallow((state) => ({
      selectCard: state.selectCard,
      selectedCardId: state.selectedCardId,
      removeCard: state.removeCard,
      restoreCard: state.restoreCard,
      rehydrateCard: state.rehydrateCard,
      promoteToMain: state.promoteToMain,
      addResultAsReference: state.addResultAsReference,
      retrySaveCard: state.retrySaveCard,
      moveReference: state.moveReference,
      setCardRole: state.setCardRole,
      maskStrokes: state.maskStrokes,
      isCommittingMain: state.isCommittingMain,
      isHydrated: state.isHydrated,
    }))
  );

  const {
    width,
    isResizing,
    handleProps: resizeHandlers,
    resetWidth,
  } = useCardResize(card);
  const { frameRef, dragHandlers } = useCardDrag(card, !isSpaceDown);

  const [loadError, setLoadError] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const [confirmPromote, setConfirmPromote] = useState(false);
  const [menuPosition, setMenuPosition] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const showMenu = menuPosition !== null;

  const selected = selectedCardId === card.id;
  const isReference = card.role === "reference";
  const isResult = card.role === "result";
  const isFree = card.role === "free";
  const participates =
    isReference && referenceIndex < MAX_REFERENCE_PARTICIPATION;
  const isAlternate = isReference && !participates;
  const missing = card.assetState === "missing" || !card.url;
  const hydrating = !card.url && (!isHydrated || card.assetState === "loading");
  const showMissing = missing || loadError;
  const saveStatus = card.saveStatus ?? (card.galleryNanoid ? "saved" : "failed");

  useEffect(() => {
    setLoadError(false);
  }, [card.url, retryKey]);

  useEffect(() => {
    if (!selected) setMenuPosition(null);
  }, [selected]);

  const handleMenuTrigger = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (showMenu) {
      setMenuPosition(null);
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    setMenuPosition({ x: rect.right - 208, y: rect.bottom + 6 });
  };

  // Right-click is an accelerator: it selects the card and opens the same
  // menu as the header chevron. Shift keeps the browser's image menu, so
  // "save image as" never becomes unreachable.
  const handleContextMenu = (event: React.MouseEvent) => {
    if (event.shiftKey || isEditableTarget(event.target)) return;
    event.preventDefault();
    selectCard(card.id);
    setMenuPosition({ x: event.clientX, y: event.clientY });
  };

  const buildResultPayload = async (): Promise<GenerationResult> => {
    // Resolve the bytes before creating the reference card. Without a blob the
    // new reference borrowed the source card's blob: URL, so removing that card
    // broke the reference immediately and a reload lost it as "missing".
    let blob: Blob | undefined;
    try {
      blob = (await cardSource.resolveCardBlob(card, corsProxy, corsProxyMode)) ?? undefined;
    } catch {
      blob = undefined;
    }
    return {
      url: card.url,
      nanoid: card.nanoid ?? card.id,
      prompt: card.prompt ?? "",
      provider: card.resultMeta?.provider ?? "",
      model: card.resultMeta?.model ?? "",
      size: card.resultMeta?.size ?? "",
      resolution: card.resultMeta?.resolution ?? "",
      generationTimeMs: card.resultMeta?.generationTimeMs ?? 0,
      createdAt: card.resultMeta?.createdAt ?? Date.now(),
      gallerySaveStatus:
        card.saveStatus === "saved" && !card.isEdited ? "saved" : "failed",
      blob,
    };
  };

  const handleOpen = (mode: "view" | "edit" = "view") => {
    selectCard(card.id);
    if (!card.url) return;
    const actions: LightboxAction[] = [];
    const setAsMainAction = (): LightboxAction => ({
      id: "set-as-main",
      label: t("preview.setAsMain"),
      // A pending mask needs an explicit confirmation. Open the card's
      // confirmation and keep the viewer open, so "set as main" from the
      // viewer is not a dead end that just closes the image.
      keepOpen: true,
      onSelect: async () => {
        if (useFreeCanvasStore.getState().maskStrokes.length > 0) {
          setConfirmPromote(true);
          return;
        }
        const ok = await promoteToMain(card.id, { discardMask: false });
        if (ok) closeLightbox();
      },
    });
    if (isResult) {
      // Results can be promoted straight from the viewer, matching the design
      // note's "set as reference / set as main" actions on the shared viewer.
      actions.push(setAsMainAction(), {
        id: "set-as-reference",
        label: t("preview.setAsReference"),
        onSelect: async () => {
          await addResultAsReference(await buildResultPayload());
        },
      });
    }
    if (isReference) {
      actions.push(setAsMainAction());
    }
    if (isFree) {
      actions.push(setAsMainAction(), {
        id: "use-as-reference",
        label: t("freeCanvas.cards.convertToReference"),
        onSelect: () => setCardRole(card.id, "reference"),
      });
    }
    openLightbox({
      url: card.url,
      title: card.name,
      subtitle: isResult
        ? t("freeCanvas.cards.resultBadge")
        : isFree
          ? t("freeCanvas.cards.freeBadge")
          : isReference
            ? t("freeCanvas.cards.referenceBadge", {
                index: referenceIndex + 1,
              })
            : undefined,
      compareSrc: card.originalUrl,
      fileName: `playground_${card.nanoid || card.id}.png`,
      initialMode: mode,
      editable: buildEditable({
        cardId: card.id,
        name: card.name,
        allowCopy: true,
      }),
      actions: actions.length > 0 ? actions : undefined,
    });
  };

  const doPromote = async (discardMask: boolean) => {
    setBusy(true);
    const ok = await promoteToMain(card.id, { discardMask });
    setBusy(false);
    if (ok) {
      setConfirmPromote(false);
      // A no-op when the viewer is closed; closes it after promoting from there.
      closeLightbox();
      bridge?.focusCard(card.id);
    }
  };

  const handlePromote = () => {
    if (maskStrokes.length > 0) {
      setConfirmPromote(true);
      return;
    }
    void doPromote(false);
  };

  const handleRemove = () => {
    const removed = removeCard(card.id);
    if (!removed) return;
    toast.success(t("freeCanvas.cards.removed"), {
      action: {
        label: t("common.undo"),
        onClick: () => restoreCard(removed),
      },
    });
  };

  const handleDownload = async () => {
    try {
      const blob = await cardSource.resolveCardBlob(card, corsProxy, corsProxyMode);
      if (!blob) {
        toast.error(t("freeCanvas.cards.downloadFailed"));
        return;
      }
      downloadFile(blob, `playground_${card.nanoid || card.id}.png`);
    } catch {
      toast.error(t("freeCanvas.cards.downloadFailed"));
    }
  };

  const handleRetrySave = async () => {
    setBusy(true);
    await retrySaveCard(card.id);
    setBusy(false);
  };

  const handleCopyImage = async () => {
    setBusy(true);
    const ok = await cardSource.copyCardImageToClipboard(
      card,
      corsProxy,
      corsProxyMode
    );
    setBusy(false);
    if (ok) {
      toast.success(t("freeCanvas.cards.copyImageDone"));
    } else {
      toast.error(t("freeCanvas.cards.copyImageFailed"));
    }
  };

  const saveDot =
    saveStatus === "saved"
      ? "bg-emerald-400"
      : saveStatus === "saving"
        ? "bg-amber-400 animate-pulse"
        : saveStatus === "failed"
          ? "bg-red-400"
          : saveStatus === "local"
            ? "bg-cyan-400"
            : "bg-zinc-500";

  return (
    <>
      <div
        ref={frameRef}
        className={cn(
          cardFrameClass(card.role, selected),
          isAlternate && "opacity-85"
        )}
        style={{
          left: card.x,
          top: card.y,
          width,
          zIndex: selected ? 30 : isAlternate ? 5 : 10,
        }}
        onPointerDown={() => selectCard(card.id)}
        onContextMenu={handleContextMenu}
      >
        <div
          className={cn(
            cardHeaderClass(card.role),
            "cursor-grab active:cursor-grabbing"
          )}
          style={{ height: CARD_HEADER_HEIGHT }}
          {...dragHandlers}
        >
          <GripVerticalIcon className="size-3 shrink-0 text-zinc-400" />
          <span
            className={cn(
              "shrink-0 rounded border px-1 py-0.5 text-[9px] font-bold",
              roleBadgeClass(card.role, isAlternate)
            )}
            title={
              isAlternate
                ? t("freeCanvas.cards.referenceAlternateHint")
                : isFree
                  ? t("freeCanvas.cards.freeHint")
                  : isReference
                    ? t("freeCanvas.cards.referenceHint", {
                        index: referenceIndex + 1,
                      })
                    : isResult
                      ? t("freeCanvas.cards.resultHint")
                      : undefined
            }
          >
            {isResult
              ? t("freeCanvas.cards.resultBadge")
              : isFree
                ? t("freeCanvas.cards.freeBadge")
                : isAlternate
                  ? t("freeCanvas.cards.referenceAlternateBadge")
                  : t("freeCanvas.cards.referenceBadge", {
                      index: referenceIndex + 1,
                    })}
          </span>
          <span
            className="min-w-0 flex-1 truncate text-[10px] text-zinc-300"
            title={card.name}
          >
            {card.name}
          </span>
          {isResult && (
            <span
              className={cn("size-1.5 shrink-0 rounded-full", saveDot)}
              title={
                saveStatus === "saved"
                  ? t("freeCanvas.saveStatusSaved")
                  : saveStatus === "saving"
                    ? t("freeCanvas.saveStatusSaving")
                    : saveStatus === "failed"
                      ? t("freeCanvas.saveStatusFailed")
                      : saveStatus === "local"
                        ? t("freeCanvas.cards.localResultHint")
                        : t("freeCanvas.cards.cannotRetrySave")
              }
            />
          )}
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="text-zinc-400 hover:text-white"
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

        {hydrating ? (
          <div
            className="flex items-center justify-center gap-2 bg-zinc-900/60 text-[10px] text-zinc-400"
            style={{ height: width * 0.75 }}
          >
            <Loader2Icon className="size-3.5 animate-spin text-primary" />
            {t("common.loading")}
          </div>
        ) : showMissing ? (
          <div
            className="flex flex-col items-center justify-center gap-2 p-3 text-center"
            style={{ minHeight: width * 0.5 }}
          >
            <AlertTriangleIcon className="size-4 text-amber-400" />
            <p className="text-[10px] font-semibold text-zinc-200">
              {loadError && card.assetState !== "missing"
                ? t("freeCanvas.cards.loadFailedTitle")
                : t("freeCanvas.cards.missingTitle")}
            </p>
            <p className="text-[9px] leading-relaxed text-zinc-400">
              {loadError && card.assetState !== "missing"
                ? t("freeCanvas.cards.loadFailedDesc")
                : t("freeCanvas.cards.missingDescShort")}
            </p>
            <div className="flex flex-wrap justify-center gap-1">
              <button
                type="button"
                className="rounded border border-white/15 bg-white/5 px-1.5 py-0.5 text-[9px] text-zinc-200 hover:bg-white/10"
                onClick={() => {
                  setRetryKey((value) => value + 1);
                  void rehydrateCard(card.id);
                }}
              >
                {t("freeCanvas.cards.retryLoad")}
              </button>
              {card.galleryNanoid && (
                <button
                  type="button"
                  className="rounded border border-white/15 bg-white/5 px-1.5 py-0.5 text-[9px] text-zinc-200 hover:bg-white/10"
                  onClick={() => void rehydrateCard(card.id)}
                >
                  {t("freeCanvas.cards.reloadFromGallery")}
                </button>
              )}
            </div>
          </div>
        ) : (
          <button
            type="button"
            className="relative block w-full cursor-zoom-in overflow-hidden bg-transparency-grid"
            style={{ height: cardImageHeight(card) }}
            onClick={() => handleOpen("view")}
            aria-label={t("freeCanvas.cards.openLargeAria", { name: card.name })}
          >
            <img
              key={retryKey}
              src={card.url}
              alt={card.name}
              className="block h-full w-full object-contain"
              draggable={false}
              onError={() => setLoadError(true)}
            />
          </button>
        )}

        {isResult &&
          saveStatus !== "saved" &&
          saveStatus !== "local" &&
          !showMissing &&
          !hydrating && (
          <div className="flex items-center justify-between gap-2 border-t border-white/10 bg-black/30 px-2 py-1 text-[9px] text-zinc-400">
            <span
              className="min-w-0 truncate"
              title={card.saveError || undefined}
            >
              {saveStatus === "unavailable"
                ? t("freeCanvas.cards.cannotRetrySave")
                : card.saveError || t("freeCanvas.saveStatusNotSaved")}
            </span>
            {saveStatus !== "unavailable" && (
              <Button
                type="button"
                size="xs"
                variant="ghost"
                className="h-5 shrink-0 px-1 text-[9px] text-primary"
                disabled={busy || saveStatus === "saving"}
                onClick={() => void handleRetrySave()}
              >
                {busy || saveStatus === "saving" ? (
                  <Loader2Icon className="size-2.5 animate-spin" />
                ) : (
                  t("freeCanvas.cards.retrySave")
                )}
              </Button>
            )}
          </div>
        )}

        <CardResizeGrip
          handlers={resizeHandlers}
          isResizing={isResizing}
          visible={selected}
          onReset={resetWidth}
        />

        {/* One menu for both the header chevron and right-click. The shared
            shell portals it out of the scaled canvas layer, so it stays
            readable at any zoom and flips near the viewport edge. */}
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
            disabled={showMissing || hydrating}
            onSelect={() => handleOpen("view")}
          />
          <CanvasMenuItem
            icon={PencilIcon}
            label={t("preview.edit.action")}
            disabled={showMissing || hydrating || isCommittingMain}
            onSelect={() => handleOpen("edit")}
          />
          <CanvasMenuItem
            icon={SparklesIcon}
            iconClassName="text-primary"
            label={t("freeCanvas.cards.setAsMain")}
            title={t("freeCanvas.cards.setAsMainTitle")}
            disabled={busy || isCommittingMain || showMissing || hydrating}
            onSelect={handlePromote}
          />

          {isReference && (
            <>
              <CanvasMenuItem
                icon={ArrowUpIcon}
                label={t("freeCanvas.cards.moveUp")}
                disabled={referenceIndex <= 0}
                onSelect={() => moveReference(card.id, -1)}
              />
              <CanvasMenuItem
                icon={ArrowDownIcon}
                label={t("freeCanvas.cards.moveDown")}
                onSelect={() => moveReference(card.id, 1)}
              />
              <CanvasMenuItem
                icon={LayersIcon}
                iconClassName="text-violet-300"
                label={t("freeCanvas.cards.convertToFree")}
                onSelect={() => setCardRole(card.id, "free")}
              />
            </>
          )}

          {isFree && (
            <CanvasMenuItem
              icon={ImagePlusIcon}
              iconClassName="text-cyan-300"
              label={t("freeCanvas.cards.convertToReference")}
              onSelect={() => setCardRole(card.id, "reference")}
            />
          )}

          {isResult && (
            <CanvasMenuItem
              icon={ImagePlusIcon}
              label={t("freeCanvas.setAsReference")}
              onSelect={() =>
                void buildResultPayload().then((payload) =>
                  addResultAsReference(payload)
                )
              }
            />
          )}

          <CanvasMenuItemDivider />

          <CanvasMenuItem
            icon={DownloadIcon}
            label={t("freeCanvas.downloadOriginal")}
            disabled={showMissing || hydrating}
            onSelect={() => void handleDownload()}
          />
          <CanvasMenuItem
            icon={CopyIcon}
            label={t("freeCanvas.cards.copyImage")}
            disabled={busy || showMissing || hydrating}
            onSelect={() => void handleCopyImage()}
          />

          <CanvasMenuItemDivider />

          <CanvasMenuItem
            icon={Trash2Icon}
            label={t("freeCanvas.cards.removeCard")}
            destructive
            onSelect={handleRemove}
          />
        </CanvasContextMenu>
      </div>

      <ConfirmDialog
        open={confirmPromote}
        title={t("freeCanvas.cards.discardMaskTitle")}
        description={t("freeCanvas.cards.discardMaskDesc")}
        confirmLabel={t("freeCanvas.cards.discardMaskConfirm")}
        busy={busy}
        onCancel={() => setConfirmPromote(false)}
        onConfirm={() => void doPromote(true)}
      />
    </>
  );
});
