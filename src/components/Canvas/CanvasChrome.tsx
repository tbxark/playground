import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  MoreHorizontalIcon,
  Redo2Icon,
  Undo2Icon,
  ZoomInIcon,
  ZoomOutIcon,
} from "lucide-react";
import { cn } from "@/utils/cn";

/**
 * Shared chrome for the two canvas workbenches (free canvas and workflow).
 * Keeping the top work bar, the left side dock, the menus and the empty state
 * in one place is what stops the two pages from drifting apart visually.
 */

export const CANVAS_SURFACE =
  "rounded-2xl border border-white/10 bg-zinc-950/90 shadow-2xl backdrop-blur-2xl";

export const CANVAS_SUBBAR_SURFACE =
  "rounded-xl border border-white/10 bg-zinc-950/90 shadow-lg backdrop-blur-2xl";

export const CANVAS_ADD_BUTTON_CLASS =
  "inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-xl border border-white/15 bg-white/10 px-2.5 text-xs font-semibold text-zinc-100 transition-colors hover:bg-white/15";

export const CANVAS_BAR_BUTTON_CLASS =
  "h-8 shrink-0 cursor-pointer whitespace-nowrap rounded-xl px-2.5 text-xs transition-colors";

export const CANVAS_DOT_GAP = 26;
export const CANVAS_DOT_COLOR = "#71717a";

/** Vertical rule between groups inside a work bar or a dock. */
export function CanvasBarDivider({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn("mx-1 h-4 w-px shrink-0 bg-white/10", className)}
    />
  );
}

type CanvasDataAttributes = {
  [key: `data-${string}`]: string | number | boolean | undefined;
};

type CanvasTopBarProps = {
  /** Context actions; scrolls horizontally before it is allowed to clip. */
  rail: React.ReactNode;
  /** Primary action, pinned to the right of the rail. */
  primary?: React.ReactNode;
  /** Overflow/style controls, pinned to the far right. */
  trailing?: React.ReactNode;
  /** Contextual second row (tool options, brush size, …). */
  subBar?: React.ReactNode;
  /** Let a long rail scroll horizontally (default) instead of overflowing the bar. */
  scrollableRail?: boolean;
  className?: string;
  barProps?: React.HTMLAttributes<HTMLDivElement> & CanvasDataAttributes;
};

export function CanvasTopBar({
  rail,
  primary,
  trailing,
  subBar,
  scrollableRail = true,
  className,
  barProps,
}: CanvasTopBarProps) {
  const { className: barClassName, ...restBarProps } = barProps ?? {};

  return (
    <div
      className={cn(
        "pointer-events-none absolute inset-x-2 top-3 z-30 flex select-none justify-center sm:top-4",
        className
      )}
    >
      <div className="pointer-events-auto flex w-full min-w-0 flex-col items-center gap-2 px-2 sm:w-auto sm:px-0">
        <div
          {...restBarProps}
          className={cn(
            "flex w-full max-w-5xl items-center gap-1 p-1 sm:w-auto",
            CANVAS_SURFACE,
            barClassName
          )}
        >
          <div
            className={cn(
              "flex min-w-0 flex-1 items-center gap-0.5 sm:flex-none",
              scrollableRail
                ? "no-scrollbar overflow-x-auto [mask-image:linear-gradient(to_right,black_calc(100%-28px),transparent)] sm:overflow-visible sm:[mask-image:none]"
                : "overflow-visible"
            )}
          >
            {rail}
          </div>
          {primary || trailing ? (
            <div className="flex shrink-0 items-center gap-0.5 border-l border-white/10 pl-1">
              {primary}
              {trailing}
            </div>
          ) : null}
        </div>
        {subBar}
      </div>
    </div>
  );
}

/** Item rendered inside a CanvasMenu popup. */
export type CanvasMenuItemProps = {
  icon: React.ComponentType<{ className?: string }>;
  iconClassName?: string;
  label: React.ReactNode;
  onSelect?: () => void;
  disabled?: boolean;
  destructive?: boolean;
  title?: string;
};

export function CanvasMenuItem({
  icon: Icon,
  iconClassName,
  label,
  onSelect,
  disabled,
  destructive,
  title,
}: CanvasMenuItemProps) {
  return (
    <button
      type="button"
      role="menuitem"
      className={cn(
        "flex w-full cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-left text-xs outline-none transition-colors",
        destructive
          ? "text-red-400 hover:bg-red-500/10 focus-visible:bg-red-500/10"
          : "text-zinc-300 hover:bg-white/10 focus-visible:bg-white/10 focus-visible:text-white",
        disabled && "pointer-events-none opacity-40"
      )}
      disabled={disabled}
      onClick={onSelect}
      title={title}
    >
      <Icon className={cn("size-3.5 shrink-0", iconClassName)} />
      <span className="truncate">{label}</span>
    </button>
  );
}

/** Thin rule between menu sections. */
export function CanvasMenuItemDivider() {
  return <div aria-hidden="true" className="my-1 border-t border-white/10" />;
}

type CanvasMenuProps = {
  label: string;
  icon?: React.ComponentType<{ className?: string }>;
  /** Show the label next to the icon instead of an icon-only trigger. */
  showLabel?: boolean;
  align?: "left" | "right";
  className?: string;
  triggerClassName?: string;
  children: React.ReactNode | ((close: () => void) => React.ReactNode);
};

export function CanvasMenu({
  label,
  icon: Icon = MoreHorizontalIcon,
  showLabel = false,
  align = "right",
  className,
  triggerClassName,
  children,
}: CanvasMenuProps) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // The menu is not a Radix dialog, so it owns its dismissal. It deliberately
  // does not use a `fixed inset-0` click catcher: the bar it lives in has
  // `backdrop-blur`, which makes that bar the containing block for fixed
  // children — the overlay shrank to the bar and never saw outside clicks.
  // Document-level listeners also keep Esc from clearing the canvas selection.
  useEffect(() => {
    if (!open) return;
    const isInside = (target: EventTarget | null) =>
      target instanceof Node && Boolean(rootRef.current?.contains(target));

    const handlePointerDown = (event: PointerEvent) => {
      if (isInside(event.target)) return;
      close();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      close();
    };
    const handleWheel = (event: WheelEvent) => {
      if (isInside(event.target)) return;
      close();
    };
    const handleResize = () => close();

    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("keydown", handleKeyDown, true);
    window.addEventListener("wheel", handleWheel, {
      capture: true,
      passive: true,
    });
    window.addEventListener("resize", handleResize);
    const frame = requestAnimationFrame(() => {
      menuRef.current
        ?.querySelector<HTMLElement>('[role="menuitem"], button')
        ?.focus();
    });
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("keydown", handleKeyDown, true);
      window.removeEventListener("wheel", handleWheel, { capture: true });
      window.removeEventListener("resize", handleResize);
      cancelAnimationFrame(frame);
    };
  }, [open, close]);

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((visible) => !visible)}
        className={cn(
          "flex cursor-pointer items-center justify-center rounded-xl text-zinc-400 transition-colors hover:bg-white/10 hover:text-white",
          showLabel
            ? "h-8 gap-1.5 px-2.5 text-xs text-zinc-200"
            : "size-8",
          triggerClassName
        )}
        title={label}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <Icon className={cn("shrink-0", showLabel ? "size-3.5" : "size-4")} />
        {showLabel ? (
          <span className="whitespace-nowrap">{label}</span>
        ) : null}
      </button>
      {open && (
        <div
          ref={menuRef}
          role="menu"
          data-canvas-overlay={open ? "true" : undefined}
          onClick={(event) => {
            // A picked row always dismisses, even if its own handler forgets to.
            if ((event.target as HTMLElement).closest('[role="menuitem"]')) {
              close();
            }
          }}
          className={cn(
            "absolute top-full z-50 mt-2 w-52 rounded-xl border border-white/10 bg-zinc-950 p-1.5 shadow-2xl",
            align === "right" ? "right-0" : "left-0",
            className
          )}
        >
          {typeof children === "function" ? children(close) : children}
        </div>
      )}
    </div>
  );
}

export type CanvasDockViewAction = {
  id: string;
  icon: React.ComponentType<{ className?: string }>;
  /** Used for both the tooltip and the accessible name. */
  label: string;
  onSelect: () => void;
  disabled?: boolean;
  tone?: "default" | "primary";
};

type CanvasSideDockProps = {
  className?: string;
  style?: React.CSSProperties;
  zoom: {
    percent: number;
    inLabel: string;
    outLabel: string;
    resetLabel: string;
    onIn: () => void;
    onOut: () => void;
    onReset: () => void;
  };
  history: {
    canUndo: boolean;
    canRedo: boolean;
    undoLabel: string;
    redoLabel: string;
    onUndo: () => void;
    onRedo: () => void;
  };
  viewActions?: CanvasDockViewAction[];
  count: { value: number; title: string };
};

function CanvasDockButton({
  label,
  onSelect,
  disabled,
  tone = "default",
  children,
}: {
  label: string;
  onSelect: () => void;
  disabled?: boolean;
  tone?: "default" | "primary";
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={disabled}
      title={label}
      aria-label={label}
      className={cn(
        "flex size-7 cursor-pointer items-center justify-center rounded-xl transition-colors disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:bg-transparent",
        tone === "primary"
          ? "text-primary/80 hover:bg-white/10 hover:text-primary"
          : "text-zinc-400 hover:bg-white/10 hover:text-white"
      )}
    >
      {children}
    </button>
  );
}

/**
 * Vertical work dock shared by both canvases: zoom, history, view actions
 * and an object count. Bottom-left on both pages. Keyboard help lives only in
 * the app shell — do not add a second entry point here.
 */
export function CanvasSideDock({
  className,
  style,
  zoom,
  history,
  viewActions = [],
  count,
}: CanvasSideDockProps) {
  return (
    <div
      data-canvas-ui="canvas-side-dock"
      className={cn(
        "pointer-events-auto absolute left-4 z-20 flex select-none flex-col items-center gap-0.5 p-1",
        CANVAS_SURFACE,
        className
      )}
      style={style}
    >
      <CanvasDockButton label={zoom.inLabel} onSelect={zoom.onIn}>
        <ZoomInIcon className="size-3.5" />
      </CanvasDockButton>
      <button
        type="button"
        onClick={zoom.onReset}
        className="h-7 w-10 cursor-pointer rounded-xl px-0.5 font-mono text-[10px] tabular-nums text-zinc-300 transition-colors hover:bg-white/10 hover:text-white"
        title={zoom.resetLabel}
        aria-label={zoom.resetLabel}
      >
        {Math.round(zoom.percent)}%
      </button>
      <CanvasDockButton label={zoom.outLabel} onSelect={zoom.onOut}>
        <ZoomOutIcon className="size-3.5" />
      </CanvasDockButton>

      <div aria-hidden="true" className="my-0.5 h-px w-4 bg-white/10" />

      <CanvasDockButton
        label={history.undoLabel}
        onSelect={history.onUndo}
        disabled={!history.canUndo}
      >
        <Undo2Icon className="size-3.5" />
      </CanvasDockButton>
      <CanvasDockButton
        label={history.redoLabel}
        onSelect={history.onRedo}
        disabled={!history.canRedo}
      >
        <Redo2Icon className="size-3.5" />
      </CanvasDockButton>

      {viewActions.length > 0 ? (
        <>
          <div aria-hidden="true" className="my-0.5 h-px w-4 bg-white/10" />
          {viewActions.map((action) => (
            <CanvasDockButton
              key={action.id}
              label={action.label}
              onSelect={action.onSelect}
              disabled={action.disabled}
              tone={action.tone}
            >
              <action.icon className="size-3.5" />
            </CanvasDockButton>
          ))}
        </>
      ) : null}

      <div aria-hidden="true" className="my-0.5 h-px w-4 bg-white/10" />

      <span
        className="pb-0.5 font-mono text-[9px] tabular-nums text-zinc-500"
        title={count.title}
      >
        {count.value}
      </span>
    </div>
  );
}

type CanvasEmptyCardProps = {
  icon: React.ReactNode;
  title: string;
  description: string;
  children?: React.ReactNode;
  footnotes?: React.ReactNode;
  className?: string;
};

/** Center empty state shared by both canvases. */
export function CanvasEmptyCard({
  icon,
  title,
  description,
  children,
  footnotes,
  className,
}: CanvasEmptyCardProps) {
  return (
    <div
      className={cn(
        "pointer-events-auto flex w-full max-w-lg flex-col items-center gap-4 rounded-3xl border border-dashed border-white/15 bg-zinc-900/50 p-6 text-center shadow-2xl backdrop-blur-xl sm:p-8",
        className
      )}
    >
      <div className="flex size-14 items-center justify-center rounded-2xl border border-primary/30 bg-gradient-to-tr from-primary/20 to-blue-500/10 text-primary shadow-lg shadow-primary/10">
        {icon}
      </div>
      <div>
        <h2 className="text-base font-bold tracking-tight text-zinc-100">
          {title}
        </h2>
        <p className="mt-2 text-xs leading-relaxed text-zinc-400">
          {description}
        </p>
      </div>
      {children ? (
        <div className="flex flex-wrap items-center justify-center gap-2">
          {children}
        </div>
      ) : null}
      {footnotes}
    </div>
  );
}
