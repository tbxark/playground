import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/utils/cn";

const VIEWPORT_MARGIN = 8;

type CanvasContextMenuProps = {
  open: boolean;
  /** Viewport coordinates (clientX/clientY) of the triggering pointer. */
  x: number;
  y: number;
  onClose: () => void;
  label: string;
  children: React.ReactNode;
  className?: string;
};

/**
 * Fixed-position menu shared by both canvases.
 *
 * It must be portalled: canvas content lives inside a translated/scaled layer
 * with `overflow-hidden`, so a menu anchored inside it would shrink with zoom,
 * grow past the viewport, and get clipped at the canvas edge. The shell owns
 * only positioning and dismissal; callers own the items and their actions.
 */
export function CanvasContextMenu({
  open,
  x,
  y,
  onClose,
  label,
  children,
  className,
}: CanvasContextMenuProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const [position, setPosition] = useState({ left: x, top: y });

  // Measure before paint so the menu never flashes outside the viewport.
  useLayoutEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    if (!panel) return;
    const rect = panel.getBoundingClientRect();
    const left = Math.max(
      VIEWPORT_MARGIN,
      Math.min(x, window.innerWidth - rect.width - VIEWPORT_MARGIN)
    );
    const top = Math.max(
      VIEWPORT_MARGIN,
      Math.min(y, window.innerHeight - rect.height - VIEWPORT_MARGIN)
    );
    setPosition((current) =>
      current.left === left && current.top === top
        ? current
        : { left, top }
    );
    panel.focus({ preventScroll: true });
  }, [open, x, y]);

  useEffect(() => {
    if (!open) return;
    const isInside = (target: EventTarget | null) =>
      target instanceof Node && Boolean(panelRef.current?.contains(target));

    const handlePointerDown = (event: PointerEvent) => {
      if (isInside(event.target)) return;
      const target = event.target as HTMLElement | null;
      // The trigger toggles itself; closing on its pointerdown would make the
      // following click reopen the menu instead of closing it.
      if (target?.closest?.("[data-canvas-context-menu-trigger]")) return;
      closeRef.current();
    };
    const handleContextMenu = (event: MouseEvent) => {
      if (isInside(event.target)) return;
      closeRef.current();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      closeRef.current();
    };
    const handleWheel = (event: WheelEvent) => {
      if (isInside(event.target)) return;
      closeRef.current();
    };
    const handleResize = () => closeRef.current();

    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("contextmenu", handleContextMenu, true);
    document.addEventListener("keydown", handleKeyDown, true);
    window.addEventListener("wheel", handleWheel, {
      capture: true,
      passive: true,
    });
    window.addEventListener("resize", handleResize);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("contextmenu", handleContextMenu, true);
      document.removeEventListener("keydown", handleKeyDown, true);
      window.removeEventListener("wheel", handleWheel, { capture: true });
      window.removeEventListener("resize", handleResize);
    };
  }, [open]);

  if (!open) return null;

  // Arrow keys move through the labelled rows; Tab and Enter stay native.
  const handlePanelKeyDown = (event: React.KeyboardEvent) => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const items = Array.from(
      panelRef.current?.querySelectorAll<HTMLElement>(
        '[role="menuitem"]:not([disabled])'
      ) ?? []
    );
    if (items.length === 0) return;
    event.preventDefault();
    const activeIndex = items.indexOf(document.activeElement as HTMLElement);
    let nextIndex = 0;
    if (event.key === "ArrowDown") {
      nextIndex = activeIndex < 0 ? 0 : (activeIndex + 1) % items.length;
    } else if (event.key === "ArrowUp") {
      nextIndex = activeIndex <= 0 ? items.length - 1 : activeIndex - 1;
    } else if (event.key === "End") {
      nextIndex = items.length - 1;
    }
    items[nextIndex]?.focus();
  };

  return createPortal(
    <div
      ref={panelRef}
      role="menu"
      aria-label={label}
      data-canvas-context-menu="true"
      tabIndex={-1}
      style={{ left: position.left, top: position.top }}
      onKeyDown={handlePanelKeyDown}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      onClick={(event) => {
        const item = (event.target as HTMLElement).closest('[role="menuitem"]');
        if (!item || item.hasAttribute("disabled")) return;
        closeRef.current();
      }}
      className={cn(
        "fixed z-[80] flex max-h-[min(70vh,520px)] w-52 flex-col gap-0.5 overflow-y-auto rounded-xl border border-white/10 bg-zinc-950 p-1.5 shadow-2xl outline-none",
        className
      )}
    >
      {children}
    </div>,
    document.body
  );
}
