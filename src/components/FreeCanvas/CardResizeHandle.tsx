import React, { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useFreeCanvasStore } from "../../stores/useFreeCanvasStore";
import { CardRole, CARD_MAX_WIDTH, CARD_MIN_WIDTH, CARD_WORLD_WIDTH, cardWidth, clampCardWidth } from "./cardStyles";
import { cn } from "@/utils/cn";

type ResizableCard = { id: string; role: CardRole; width?: number };

export type CardResizeHandlers = {
  onPointerDown: React.PointerEventHandler<HTMLButtonElement>;
  onPointerMove: React.PointerEventHandler<HTMLButtonElement>;
  onPointerUp: React.PointerEventHandler<HTMLButtonElement>;
  onPointerCancel: React.PointerEventHandler<HTMLButtonElement>;
  /** Committed (or previewed) width, exposed for the slider's aria values. */
  width: number;
  /** Keyboard resizing: the grip must not be a pointer-only control. */
  onResizeBy: (delta: number) => void;
};

/**
 * Drag-to-resize for one card. The width being dragged stays local (so the
 * canvas does not write to the persisted store on every pointermove); only the
 * committed width enters the store and the undo stack.
 */
export function useCardResize(card: ResizableCard, disabled = false) {
  const resizeCard = useFreeCanvasStore((state) => state.resizeCard);
  const [previewWidth, setPreviewWidth] = useState<number | null>(null);
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const latestRef = useRef<number | null>(null);

  const commit = useCallback(() => {
    const drag = dragRef.current;
    const latest = latestRef.current;
    dragRef.current = null;
    latestRef.current = null;
    setPreviewWidth(null);
    if (!drag) return;
    if (latest != null && latest !== drag.startWidth) {
      resizeCard(card.id, latest);
    }
  }, [card.id, resizeCard]);

  const handleProps: CardResizeHandlers = {
    onPointerDown: (event) => {
      if (disabled || event.button !== 0) return;
      // No preventDefault: it suppresses the compatibility click events, and
      // the double-click gesture on the grip must keep working.
      event.stopPropagation();
      (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
      const startWidth = cardWidth(card);
      dragRef.current = { startX: event.clientX, startWidth };
      latestRef.current = startWidth;
      setPreviewWidth(startWidth);
    },
    onPointerMove: (event) => {
      if (!dragRef.current) return;
      const zoom = useFreeCanvasStore.getState().zoom || 1;
      const next = clampCardWidth(
        dragRef.current.startWidth +
          (event.clientX - dragRef.current.startX) / zoom,
        card.role
      );
      latestRef.current = next;
      setPreviewWidth(next);
    },
    onPointerUp: () => commit(),
    onPointerCancel: () => commit(),
    width: previewWidth ?? cardWidth(card),
    onResizeBy: (delta) => {
      if (disabled) return;
      resizeCard(card.id, clampCardWidth(cardWidth(card) + delta, card.role));
    },
  };

  return {
    isResizing: previewWidth != null,
    width: previewWidth ?? cardWidth(card),
    handleProps,
    /** Double-click restores the role's default width. */
    resetWidth: () => resizeCard(card.id, CARD_WORLD_WIDTH[card.role]),
  };
}

type CardResizeGripProps = {
  handlers: CardResizeHandlers;
  isResizing: boolean;
  /** Selected cards keep the grip visible so it is reachable on touch. */
  visible?: boolean;
  disabled?: boolean;
  onReset?: () => void;
};

export function CardResizeGrip({
  handlers,
  isResizing,
  visible = false,
  disabled = false,
  onReset,
}: CardResizeGripProps) {
  const { t } = useTranslation();
  const minWidth = Number(
    Object.values(CARD_MIN_WIDTH).sort((a, b) => a - b)[0] ?? CARD_WORLD_WIDTH.reference
  );
  return (
    <button
      type="button"
      data-canvas-ui="card-resize"
      role="slider"
      aria-label={t("freeCanvas.cards.resizeAria")}
      aria-orientation="horizontal"
      aria-valuemin={minWidth}
      aria-valuemax={CARD_MAX_WIDTH}
      aria-valuenow={Math.round(handlers.width)}
      aria-valuetext={t("freeCanvas.cards.resizeValue", {
        width: Math.round(handlers.width),
      })}
      title={t("freeCanvas.cards.resizeHint")}
      disabled={disabled}
      onDoubleClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onReset?.();
      }}
      onKeyDown={(event) => {
        if (event.key === "ArrowRight" || event.key === "ArrowUp") {
          event.preventDefault();
          handlers.onResizeBy(40);
        } else if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
          event.preventDefault();
          handlers.onResizeBy(-40);
        } else if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onReset?.();
        }
      }}
      className={cn(
        "absolute -bottom-1 -right-1 z-20 flex size-5 cursor-nwse-resize touch-none select-none items-center justify-center rounded-md border border-white/20 bg-zinc-900/90 text-zinc-300 shadow-md transition-opacity group-hover:opacity-100 focus-visible:opacity-100",
        visible || isResizing ? "opacity-100" : "opacity-0",
        isResizing && "ring-2 ring-primary/60",
        disabled && "cursor-not-allowed opacity-0"
      )}
      {...handlers}
    >
      <svg viewBox="0 0 10 10" className="size-2.5" aria-hidden>
        <circle cx="7.6" cy="7.6" r="1.1" fill="currentColor" />
        <circle cx="7.6" cy="4.4" r="1.1" fill="currentColor" />
        <circle cx="4.4" cy="7.6" r="1.1" fill="currentColor" />
      </svg>
    </button>
  );
}
