import React, { useRef } from "react";
import { useFreeCanvasStore } from "../../stores/useFreeCanvasStore";

type DraggableCard = { id: string; x: number; y: number };

export type CardDragHandlers = {
  onPointerDown: React.PointerEventHandler<HTMLElement>;
  onPointerMove: React.PointerEventHandler<HTMLElement>;
  onPointerUp: React.PointerEventHandler<HTMLElement>;
  onPointerCancel: React.PointerEventHandler<HTMLElement>;
  onLostPointerCapture: React.PointerEventHandler<HTMLElement>;
};

type DragState = {
  startX: number;
  startY: number;
  /** Latest zoom-corrected (world unit) delta, committed on release. */
  dx: number;
  dy: number;
};

/** Below this world-unit distance a gesture counts as a click, not a drag. */
const CLICK_SLOP = 0.5;

/**
 * Header drag for one card. The gesture writes its translation straight to the
 * card element and only commits to the store on release: a React state update
 * per pointermove re-rendered the whole card and made it trail the cursor,
 * while this keeps the drag at compositor speed and still lands as a single
 * undo entry.
 *
 * The card sits inside the pan/zoom layer, so a child translate is multiplied
 * by the canvas zoom. The pointer's screen delta therefore has to be divided
 * by the zoom before it becomes a child transform — otherwise the card moves
 * at `zoom` × cursor speed (at a fitted 0.4 zoom it crawls behind the pointer
 * and then jumps the remaining distance on release).
 */
export function useCardDrag(
  card: DraggableCard,
  enabled = true
): { frameRef: React.RefObject<HTMLDivElement | null>; dragHandlers: CardDragHandlers } {
  const frameRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);

  const applyDelta = (event: React.PointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    const element = frameRef.current;
    if (!drag || !element) return;
    const zoom = useFreeCanvasStore.getState().zoom || 1;
    drag.dx = (event.clientX - drag.startX) / zoom;
    drag.dy = (event.clientY - drag.startY) / zoom;
    element.style.transform = `translate3d(${drag.dx}px, ${drag.dy}px, 0)`;
  };

  const finish = () => {
    const drag = dragRef.current;
    const element = frameRef.current;
    dragRef.current = null;
    if (!element) return;
    element.style.willChange = "";
    element.style.removeProperty("transform");
    if (!drag) return;
    if (Math.abs(drag.dx) <= CLICK_SLOP && Math.abs(drag.dy) <= CLICK_SLOP) {
      return;
    }

    const state = useFreeCanvasStore.getState();
    const current = state.cards.find((item) => item.id === card.id);
    if (!current) return;
    const nextX = Math.round(current.x + drag.dx);
    const nextY = Math.round(current.y + drag.dy);
    // Park the element on the committed coordinates before the store write, so
    // the frame React renders next (with the same left/top) cannot flash the
    // card back to its old spot for a paint.
    element.style.left = `${nextX}px`;
    element.style.top = `${nextY}px`;
    state.moveCard(card.id, nextX, nextY);
  };

  return {
    frameRef,
    dragHandlers: {
      onPointerDown: (event) => {
        if (!enabled || event.button !== 0) return;
        if ((event.target as HTMLElement).closest("button, a, input")) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        dragRef.current = {
          startX: event.clientX,
          startY: event.clientY,
          dx: 0,
          dy: 0,
        };
        // Promote the card for the gesture only: it carries a backdrop blur
        // that would otherwise be recomputed on every frame of the drag.
        if (frameRef.current) frameRef.current.style.willChange = "transform";
      },
      onPointerMove: applyDelta,
      onPointerUp: finish,
      onPointerCancel: finish,
      onLostPointerCapture: finish,
    },
  };
}
