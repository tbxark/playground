import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useHotkeys } from "react-hotkeys-hook";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import {
  Columns3Icon,
  ImagePlusIcon,
  InfoIcon,
  LayoutGridIcon,
  Loader2Icon,
  Maximize2Icon,
  RotateCcwIcon,
  UploadCloudIcon,
} from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import {
  CanvasCard,
  getReferenceCards,
  useFreeCanvasStore,
} from "../../stores/useFreeCanvasStore";
import { MainCard } from "./MainCard";
import { ImageCard } from "./ImageCard";
import { ReferenceHelpDialog } from "./ReferenceHelpDialog";
import { useRegisterFreeCanvasBridge } from "./FreeCanvasBridge";
import { ConfirmDialog } from "../ui/confirm-dialog";
import {
  CANVAS_ADD_BUTTON_CLASS,
  CANVAS_DOT_COLOR,
  CANVAS_DOT_GAP,
  CanvasEmptyCard,
  CanvasSideDock,
} from "../Canvas/CanvasChrome";
import {
  isEditableTarget,
  isOverlayOpen,
  shouldIgnoreCanvasHotkey,
  shouldIgnoreSpacePan,
} from "@/utils/keyboard";
import {
  cardWidth,
  cardWorldHeight,
} from "./cardStyles";
import { cn } from "@/utils/cn";

const SAFE_TOP = 96;
const SAFE_SIDE = 72;
const SAFE_BOTTOM_EXPANDED = 232;
const SAFE_BOTTOM_COLLAPSED = 84;

/**
 * Clipboard payloads expose bitmaps as `items`, `files` or both depending on
 * the browser and the source app, so read both instead of trusting one shape.
 */
function clipboardImageFiles(data: DataTransfer | null): File[] {
  if (!data) return [];
  const files: File[] = [];
  Array.from(data.items ?? []).forEach((item) => {
    if (item.kind !== "file" || !item.type.startsWith("image/")) return;
    const file = item.getAsFile();
    if (file) files.push(file);
  });
  if (files.length > 0) return files;
  return Array.from(data.files ?? []).filter((file) =>
    file.type.startsWith("image/")
  );
}

function getBounds(cards: CanvasCard[]) {
  if (cards.length === 0) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 };
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  cards.forEach((card) => {
    const width = cardWidth(card);
    const height = cardWorldHeight(card);
    minX = Math.min(minX, card.x);
    minY = Math.min(minY, card.y);
    maxX = Math.max(maxX, card.x + width);
    maxY = Math.max(maxY, card.y + height);
  });
  return {
    minX,
    minY,
    maxX,
    maxY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY),
  };
}

export function FreeCanvasViewport() {
  const location = useLocation();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const {
    cards,
    zoom,
    setZoom,
    pan,
    setPan,
    isBarCollapsed,
    isHydrated,
    initialFitDone,
    markInitialFitDone,
    addFiles,
    selectCard,
    arrangeCards,
    maskStrokes,
    isMaskInverted,
    past,
    future,
  } = useFreeCanvasStore(
    useShallow((state) => ({
      cards: state.cards,
      zoom: state.zoom,
      setZoom: state.setZoom,
      pan: state.pan,
      setPan: state.setPan,
      isBarCollapsed: state.isBarCollapsed,
      isHydrated: state.isHydrated,
      initialFitDone: state.initialFitDone,
      markInitialFitDone: state.markInitialFitDone,
      addFiles: state.addFiles,
      selectCard: state.selectCard,
      arrangeCards: state.arrangeCards,
      maskStrokes: state.maskStrokes,
      isMaskInverted: state.isMaskInverted,
      past: state.past,
      future: state.future,
    }))
  );

  const containerRef = useRef<HTMLDivElement>(null);
  const didInitialFitRef = useRef(false);
  const [isSpaceDown, setIsSpaceDown] = useState(false);
  const [isDraggingCanvas, setIsDraggingCanvas] = useState(false);
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [commandBarHeight, setCommandBarHeight] = useState(180);

  const panRef = useRef<{
    startX: number;
    startY: number;
    startPan: { x: number; y: number };
  } | null>(null);

  const referenceIndexById = useMemo(() => {
    const map = new Map<string, number>();
    getReferenceCards(cards).forEach((card, index) => map.set(card.id, index));
    return map;
  }, [cards]);

  const fitBounds = useCallback(
    (bounds: ReturnType<typeof getBounds>, minScale: number, maxScale: number) => {
      const container = containerRef.current;
      if (!container || bounds.width <= 0 || bounds.height <= 0) return;
      const containerWidth = container.clientWidth;
      const containerHeight = container.clientHeight;
      if (containerWidth <= 0 || containerHeight <= 0) return;

      const containerRect = container.getBoundingClientRect();
      const toolbarRect = document
        .querySelector("[data-free-canvas-toolbar]")
        ?.getBoundingClientRect();
      const commandRect = document
        .querySelector("[data-free-canvas-command-bar]")
        ?.getBoundingClientRect();

      const topSafe = toolbarRect
        ? Math.max(64, toolbarRect.bottom - containerRect.top + 12)
        : SAFE_TOP;
      const bottomSafe = commandRect
        ? Math.max(64, containerRect.bottom - commandRect.top + 12)
        : isBarCollapsed
          ? SAFE_BOTTOM_COLLAPSED
          : SAFE_BOTTOM_EXPANDED;

      const safeWidth = Math.max(160, containerWidth - SAFE_SIDE * 2);
      const safeHeight = Math.max(160, containerHeight - topSafe - bottomSafe);

      const rawScale = Math.min(
        safeWidth / bounds.width,
        safeHeight / bounds.height
      );
      const scale = Math.min(
        maxScale,
        Math.max(minScale, Math.round(rawScale * 100) / 100)
      );

      setZoom(scale);
      setPan({
        x: Math.round(
          SAFE_SIDE + (safeWidth - bounds.width * scale) / 2 - bounds.minX * scale
        ),
        y: Math.round(
          topSafe +
            (safeHeight - bounds.height * scale) / 2 -
            bounds.minY * scale
        ),
      });
    },
    [isBarCollapsed, setPan, setZoom]
  );

  const fitAll = useCallback(() => {
    const current = useFreeCanvasStore.getState().cards;
    if (current.length === 0) {
      setZoom(1);
      setPan({ x: 48, y: 120 });
      return;
    }
    fitBounds(getBounds(current), 0.1, 1.2);
  }, [fitBounds, setPan, setZoom]);

  const focusCard = useCallback(
    (id: string) => {
      const card = useFreeCanvasStore
        .getState()
        .cards.find((item) => item.id === id);
      if (!card) return;
      const width = cardWidth(card);
      const height = cardWorldHeight(card);
      fitBounds(
        {
          minX: card.x,
          minY: card.y,
          maxX: card.x + width,
          maxY: card.y + height,
          width,
          height,
        },
        0.2,
        1.2
      );
    },
    [fitBounds]
  );

  const focusCards = useCallback(
    (ids: string[]) => {
      const wanted = new Set(ids);
      const targets = useFreeCanvasStore
        .getState()
        .cards.filter((item) => wanted.has(item.id));
      if (targets.length === 0) return;
      fitBounds(getBounds(targets), 0.1, 1.2);
    },
    [fitBounds]
  );

  const resetView = useCallback(() => {
    setZoom(1);
    setPan({ x: 48, y: 120 });
  }, [setPan, setZoom]);

  const bridgeApi = useMemo(
    () => ({ fitAll, focusCard, focusCards, resetView }),
    [fitAll, focusCard, focusCards, resetView]
  );
  useRegisterFreeCanvasBridge(bridgeApi);

  // Fit the very first card (empty canvas -> first upload/result).
  const previousCountRef = useRef(cards.length);
  useEffect(() => {
    const previous = previousCountRef.current;
    if (previous === 0 && cards.length > 0) {
      let inner = 0;
      const frame = requestAnimationFrame(() => {
        inner = requestAnimationFrame(() => {
          previousCountRef.current = cards.length;
          markInitialFitDone();
          fitAll();
        });
      });
      return () => {
        cancelAnimationFrame(frame);
        if (inner) cancelAnimationFrame(inner);
      };
    }
    previousCountRef.current = cards.length;
  }, [cards.length, fitAll, markInitialFitDone]);

  // Initial framing happens once, after persisted assets are restored. A
  // return to the canvas with a default viewport (zoom/pan are not persisted)
  // still refits even though `initialFitDone` lives for the store's lifetime;
  // a custom viewport is left alone.
  useEffect(() => {
    if (!isHydrated || didInitialFitRef.current) return;
    if (cards.length === 0) return;
    const defaultViewport =
      Math.abs(zoom - 1) < 0.001 && pan.x === 0 && pan.y === 0;
    // Narrow layouts refit on mount even if a desktop visit framed the canvas
    // earlier: otherwise the 720px main card and its menu sit off-screen.
    const narrowViewport =
      (containerRef.current?.clientWidth ?? window.innerWidth) < 640;
    if (initialFitDone && !defaultViewport && !narrowViewport) {
      didInitialFitRef.current = true;
      return;
    }
    markInitialFitDone();
    // React StrictMode runs effects twice (the first cleanup would otherwise
    // cancel the only frame). Mark the fit only after the second frame runs.
    let inner = 0;
    const frame = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => {
        didInitialFitRef.current = true;
        fitAll();
      });
    });
    return () => {
      cancelAnimationFrame(frame);
      if (inner) cancelAnimationFrame(inner);
    };
  }, [
    isHydrated,
    initialFitDone,
    cards.length,
    fitAll,
    markInitialFitDone,
    pan.x,
    pan.y,
    zoom,
  ]);

  // A gallery "load as main" happens on another route, so there is no bridge
  // caller to frame the demoted old main. The gallery passes this state flag.
  const fitAfterMainSwitch = Boolean(
    (location.state as { fitAfterMainSwitch?: boolean } | null)
      ?.fitAfterMainSwitch
  );
  useEffect(() => {
    if (!fitAfterMainSwitch || !isHydrated || cards.length === 0) return;
    let inner = 0;
    const frame = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => {
        fitAll();
        navigate(location.pathname, { replace: true, state: null });
      });
    });
    return () => {
      cancelAnimationFrame(frame);
      if (inner) cancelAnimationFrame(inner);
    };
  }, [
    cards.length,
    fitAll,
    fitAfterMainSwitch,
    isHydrated,
    location.pathname,
    navigate,
  ]);

  // The bottom command bar grows with reference pills and advanced params.
  // Keep the vertical viewport dock above it instead of letting them overlap.
  useEffect(() => {
    const element = document.querySelector(
      "[data-free-canvas-command-bar]"
    ) as HTMLElement | null;
    if (!element) return;
    const update = () =>
      setCommandBarHeight(element.getBoundingClientRect().height);
    update();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [isBarCollapsed, cards.length]);

  // Space toggles hand-pan mode under the same guards as every canvas hotkey:
  // typing, IME, open overlays and focused controls win.
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.code === "Space" &&
        !event.repeat &&
        !shouldIgnoreSpacePan(event)
      ) {
        setIsSpaceDown(true);
      }
    };
    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.code === "Space") setIsSpaceDown(false);
    };
    // Switching windows while Space is held loses the keyup; without this the
    // canvas stays in hand-pan mode until Space is pressed again.
    const handleBlur = () => setIsSpaceDown(false);
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("blur", handleBlur);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("blur", handleBlur);
    };
  }, []);

  // Window-level pan tracking keeps the drag stable outside the viewport.
  useEffect(() => {
    const handleMove = (event: PointerEvent) => {
      if (!panRef.current) return;
      setPan({
        x: Math.round(
          panRef.current.startPan.x + event.clientX - panRef.current.startX
        ),
        y: Math.round(
          panRef.current.startPan.y + event.clientY - panRef.current.startY
        ),
      });
    };
    const handleUp = () => {
      if (!panRef.current) return;
      panRef.current = null;
      setIsDraggingCanvas(false);
    };
    // pointercancel / window blur mean the release will never arrive: stop the
    // pan and drop the Space hand-mode so the canvas is not left panning or
    // permanently stuck in hand mode.
    const handleInterrupt = () => {
      handleUp();
      setIsSpaceDown(false);
    };
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
    window.addEventListener("pointercancel", handleInterrupt);
    window.addEventListener("blur", handleInterrupt);
    return () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
      window.removeEventListener("pointercancel", handleInterrupt);
      window.removeEventListener("blur", handleInterrupt);
    };
  }, [setPan]);

  // Cursor-centered zoom with cmd/ctrl/alt + wheel; plain wheel pans.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      const state = useFreeCanvasStore.getState();

      if (event.ctrlKey || event.metaKey || event.altKey) {
        const factor = event.deltaY < 0 ? 1.08 : 0.92;
        const nextZoom = Math.min(
          5,
          Math.max(0.1, Math.round(state.zoom * factor * 100) / 100)
        );
        if (nextZoom === state.zoom) return;

        const rect = container.getBoundingClientRect();
        const cursorX = event.clientX - rect.left;
        const cursorY = event.clientY - rect.top;
        const worldX = (cursorX - state.pan.x) / state.zoom;
        const worldY = (cursorY - state.pan.y) / state.zoom;

        state.setZoom(nextZoom);
        state.setPan({
          x: Math.round(cursorX - worldX * nextZoom),
          y: Math.round(cursorY - worldY * nextZoom),
        });
      } else {
        state.setPan({
          x: Math.round(state.pan.x - event.deltaX),
          y: Math.round(state.pan.y - event.deltaY),
        });
      }
    };

    container.addEventListener("wheel", handleWheel, { passive: false });
    return () => container.removeEventListener("wheel", handleWheel);
  }, []);

  // Pasting a screenshot, a copied web image or a file lands it on the canvas
  // through the same addFiles path as drop/upload. Text pastes keep native
  // behaviour; an image-only paste still imports while the prompt has focus,
  // which is where screenshots usually go. Modals own the clipboard meanwhile.
  useEffect(() => {
    const handlePaste = (event: ClipboardEvent) => {
      if (isOverlayOpen()) return;
      const files = clipboardImageFiles(event.clipboardData);
      if (files.length === 0) return;
      const hasPlainText = Boolean(event.clipboardData?.getData("text/plain"));
      if (hasPlainText && isEditableTarget(event.target)) return;

      event.preventDefault();
      const existing = useFreeCanvasStore.getState().cards.length;
      const named = files.map((file, index) =>
        file.name
          ? file
          : new File(
              [file],
              t("freeCanvas.cards.pastedImageName", {
                index: existing + index + 1,
              }),
              { type: file.type || "image/png" }
            )
      );
      void addFiles(named);
    };
    window.addEventListener("paste", handlePaste);
    return () => window.removeEventListener("paste", handlePaste);
  }, [addFiles, t]);

  const startPan = (clientX: number, clientY: number) => {
    const state = useFreeCanvasStore.getState();
    panRef.current = {
      startX: clientX,
      startY: clientY,
      startPan: { ...state.pan },
    };
    setIsDraggingCanvas(true);
  };

  const handlePointerDown = (event: React.PointerEvent) => {
    if (event.button === 2) return;
    const target = event.target as HTMLElement;
    if (target.closest("button, a, input, textarea, label, [data-canvas-ui]")) {
      return;
    }
    const insideCard = Boolean(target.closest("[data-canvas-card]"));

    if (event.button === 1 || isSpaceDown) {
      event.preventDefault();
      // Capture keeps the gesture alive outside the viewport and guarantees a
      // pointerup/cancel is delivered; without it a release outside the window
      // left the canvas panning forever.
      event.currentTarget.setPointerCapture?.(event.pointerId);
      startPan(event.clientX, event.clientY);
      return;
    }

    if (!insideCard) {
      selectCard(null);
      if (event.button === 0) {
        event.currentTarget.setPointerCapture?.(event.pointerId);
        startPan(event.clientX, event.clientY);
      }
    }
  };

  const handleDrop = async (event: React.DragEvent) => {
    event.preventDefault();
    setIsDraggingFile(false);
    const files = Array.from(event.dataTransfer.files || []);
    if (files.length === 0) return;
    if (!files.some((file) => file.type.startsWith("image/"))) {
      toast.warning(t("freeCanvas.cards.onlyImages"));
      return;
    }
    await addFiles(files);
  };

  const handleUndo = () => {
    const state = useFreeCanvasStore.getState();
    if (state.past.length === 0) {
      toast.info(t("freeCanvas.cards.nothingToUndo"));
      return;
    }
    if (state.undo()) toast.success(t("freeCanvas.cards.undone"));
  };

  const handleRedo = () => {
    const state = useFreeCanvasStore.getState();
    if (state.future.length === 0) {
      toast.info(t("freeCanvas.cards.nothingToRedo"));
      return;
    }
    if (state.redo()) toast.success(t("freeCanvas.cards.redone"));
  };

  const [confirmMainDeleteOpen, setConfirmMainDeleteOpen] = useState(false);
  const [mainDeleteBusy, setMainDeleteBusy] = useState(false);

  // Delete removes the selected card. The main image is never deleted: it is
  // unset after an explicit confirmation (see the dialog below).
  const handleDeleteSelected = () => {
    const state = useFreeCanvasStore.getState();
    const card = state.selectedCardId
      ? state.cards.find((item) => item.id === state.selectedCardId)
      : null;
    if (!card) {
      if (state.cards.length > 0) {
        toast.info(t("freeCanvas.cards.selectToDelete"));
      }
      return;
    }
    if (card.role === "main") {
      setConfirmMainDeleteOpen(true);
      return;
    }
    const removed = state.removeCard(card.id);
    if (!removed) return;
    toast.success(t("freeCanvas.cards.deleteSelectedDone"), {
      action: {
        label: t("common.undo"),
        onClick: () => {
          // Restore this specific card. Calling the global undo() here could
          // pop an unrelated snapshot created during the toast's lifetime.
          useFreeCanvasStore.getState().restoreCard(removed);
        },
      },
    });
  };

  const handleConfirmMainDelete = async () => {
    setMainDeleteBusy(true);
    const ok = await useFreeCanvasStore
      .getState()
      .clearMain({ discardMask: true });
    setMainDeleteBusy(false);
    if (ok) setConfirmMainDeleteOpen(false);
  };

  // ---- Keyboard -----------------------------------------------------------
  // Same guards as the workflow canvas: typing / IME / open overlays win.
  useHotkeys(
    "mod+z",
    (event) => {
      if (event.shiftKey) return;
      event.preventDefault();
      handleUndo();
    },
    { ignoreEventWhen: shouldIgnoreCanvasHotkey, preventDefault: true }
  );

  useHotkeys(
    "mod+shift+z, mod+y",
    (event) => {
      event.preventDefault();
      handleRedo();
    },
    { ignoreEventWhen: shouldIgnoreCanvasHotkey, preventDefault: true }
  );

  useHotkeys(
    "delete, backspace",
    (event) => {
      event.preventDefault();
      handleDeleteSelected();
    },
    { ignoreEventWhen: shouldIgnoreCanvasHotkey, preventDefault: true }
  );

  useHotkeys(
    "escape",
    () => {
      const state = useFreeCanvasStore.getState();
      if (state.selectedCardId) state.selectCard(null);
    },
    { ignoreEventWhen: shouldIgnoreCanvasHotkey }
  );

  return (
    <div
      ref={containerRef}
      id="free-canvas-viewport-container"
      className={cn(
        "relative min-h-0 w-full flex-1 touch-none overflow-hidden bg-zinc-950",
        isDraggingCanvas
          ? "cursor-grabbing"
          : isSpaceDown
            ? "cursor-grab"
            : "cursor-default",
        isDraggingFile && "ring-2 ring-inset ring-primary bg-zinc-900/60"
      )}
      onPointerDown={handlePointerDown}
      onDragOver={(event) => {
        event.preventDefault();
        setIsDraggingFile(true);
      }}
      onDragLeave={(event) => {
        if (event.currentTarget === event.target) setIsDraggingFile(false);
      }}
      onDrop={(event) => void handleDrop(event)}
    >
      <div
        className="pointer-events-none absolute inset-0 opacity-25"
        style={{
          backgroundImage: `radial-gradient(circle, ${CANVAS_DOT_COLOR} 1px, transparent 1px)`,
          backgroundSize: `${CANVAS_DOT_GAP * zoom}px ${CANVAS_DOT_GAP * zoom}px`,
          backgroundPosition: `${pan.x}px ${pan.y}px`,
        }}
        aria-hidden
      />

      {cards.length === 0 ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-4 pb-64 sm:p-6">
          <CanvasEmptyCard
            icon={<UploadCloudIcon className="size-7" />}
            title={t("freeCanvas.cards.emptyTitle")}
            description={t("freeCanvas.cards.emptyDesc")}
            footnotes={
              <>
                <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-[11px] text-zinc-500">
                  <span className="inline-flex items-center gap-1">
                    <InfoIcon className="size-3 text-cyan-300" />
                    {t("freeCanvas.cards.emptyReferenceHint")}
                  </span>
                  <button
                    type="button"
                    onClick={() => setHelpOpen(true)}
                    className="inline-flex items-center gap-1 text-primary hover:underline"
                  >
                    {t("freeCanvas.cards.referenceHelp")}
                  </button>
                </div>
                <p className="text-[11px] text-zinc-400">
                  {t("freeCanvas.cards.emptyGenerateHint")}
                </p>
              </>
            }
          >
            <label
              htmlFor="freeCanvasEmptyUpload"
              className={CANVAS_ADD_BUTTON_CLASS}
            >
              <ImagePlusIcon className="size-3.5 text-primary" />
              <span>{t("freeCanvas.chooseImage")}</span>
              <input
                id="freeCanvasEmptyUpload"
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
          </CanvasEmptyCard>
        </div>
      ) : (
        <div
          className="absolute inset-0 overflow-hidden"
          data-canvas-bg="true"
        >
          {!isHydrated && (
            <div className="absolute inset-0 z-40 flex items-center justify-center gap-2 bg-zinc-950/40 text-xs text-zinc-300 backdrop-blur-sm">
              <Loader2Icon className="size-4 animate-spin text-primary" />
              {t("freeCanvas.cards.restoring")}
            </div>
          )}
          <div
            className="absolute left-0 top-0 origin-top-left will-change-transform"
            style={{
              transform: `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${zoom})`,
            }}
          >
            {cards.map((card) => (
              <div key={card.id} data-canvas-card={card.id}>
                {card.role === "main" ? (
                  <MainCard card={card} isSpaceDown={isSpaceDown} />
                ) : (
                  <ImageCard
                    card={card}
                    isSpaceDown={isSpaceDown}
                    referenceIndex={referenceIndexById.get(card.id) ?? 0}
                  />
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {cards.length > 0 && (
        <CanvasSideDock
          style={{ bottom: commandBarHeight + 28 }}
          zoom={{
            percent: zoom * 100,
            inLabel: t("freeCanvas.cards.zoomIn"),
            outLabel: t("freeCanvas.cards.zoomOut"),
            resetLabel: t("freeCanvas.resetZoomTitle"),
            onIn: () => setZoom((value) => Math.min(5, value + 0.15)),
            onOut: () => setZoom((value) => Math.max(0.1, value - 0.15)),
            onReset: () => setZoom(1),
          }}
          history={{
            canUndo: past.length > 0,
            canRedo: future.length > 0,
            undoLabel: t("freeCanvas.cards.undoTitle"),
            redoLabel: t("freeCanvas.cards.redoTitle"),
            onUndo: handleUndo,
            onRedo: handleRedo,
          }}
          viewActions={[
            {
              id: "fit",
              icon: Maximize2Icon,
              label: t("freeCanvas.cards.fitAllTitle"),
              onSelect: fitAll,
              tone: "primary",
            },
            {
              id: "layout",
              icon: LayoutGridIcon,
              label: t("freeCanvas.cards.layoutTitle"),
              onSelect: () => {
                arrangeCards();
                requestAnimationFrame(() => fitAll());
              },
            },
            {
              id: "spread",
              icon: Columns3Icon,
              label: t("freeCanvas.cards.spreadResultsTitle"),
              disabled: !cards.some((card) => card.role === "result"),
              onSelect: () => {
                const ids = useFreeCanvasStore.getState().spreadResults();
                if (ids.length === 0) {
                  toast.info(t("freeCanvas.cards.spreadNoResults"));
                  return;
                }
                requestAnimationFrame(() => focusCards(ids));
              },
            },
            {
              id: "reset",
              icon: RotateCcwIcon,
              label: t("freeCanvas.cards.resetViewTitle"),
              onSelect: resetView,
            },
          ]}
          count={{
            value: cards.length,
            title: t("freeCanvas.cards.cardCount", { count: cards.length }),
          }}
        />
      )}

      <ReferenceHelpDialog open={helpOpen} onOpenChange={setHelpOpen} />

      <ConfirmDialog
        open={confirmMainDeleteOpen}
        title={t("freeCanvas.cards.clearMainDeleteTitle")}
        description={
          maskStrokes.length > 0 || isMaskInverted
            ? t("freeCanvas.cards.discardMaskDesc")
            : t("freeCanvas.cards.clearMainDeleteDesc")
        }
        confirmLabel={t("freeCanvas.cards.unsetMain")}
        busy={mainDeleteBusy}
        onCancel={() => setConfirmMainDeleteOpen(false)}
        onConfirm={() => void handleConfirmMainDelete()}
      />
    </div>
  );
}
