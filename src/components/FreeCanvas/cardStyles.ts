import { cn } from "@/utils/cn";

export type CardRole = "main" | "reference" | "result" | "free";

/** Role defaults. A card's persisted `width` overrides its role default. */
export const CARD_WORLD_WIDTH: Record<CardRole, number> = {
  main: 720,
  reference: 180,
  result: 240,
  free: 220,
};

export const CARD_MAX_WIDTH = 2400;

/** Per-role floors: a card may not shrink below a usable header width. */
export const CARD_MIN_WIDTH: Record<CardRole, number> = {
  main: 240,
  reference: 120,
  result: 140,
  free: 120,
};

export const CARD_HEADER_HEIGHT = 40;
export const CARD_GAP = 24;
export const REFERENCE_PARTICIPATION_LIMIT = 4;

const MIN_ASPECT = 0.25;
const MAX_ASPECT = 3;

export type CardSizing = {
  id?: string;
  role: CardRole;
  /** User-set world width; falls back to the role default. */
  width?: number;
  refOrder?: number;
  naturalWidth?: number;
  naturalHeight?: number;
  saveStatus?: string;
  galleryNanoid?: string;
  x?: number;
  y?: number;
};

export function clampCardWidth(width: number, role: CardRole): number {
  if (!Number.isFinite(width)) return CARD_MIN_WIDTH[role];
  return Math.round(
    Math.min(CARD_MAX_WIDTH, Math.max(CARD_MIN_WIDTH[role], width))
  );
}

export function cardWidth(card: { role: CardRole; width?: number }): number {
  return card.width
    ? clampCardWidth(card.width, card.role)
    : CARD_WORLD_WIDTH[card.role];
}

export function cardImageHeight(card: CardSizing): number {
  const width = cardWidth(card);
  const nw = card.naturalWidth && card.naturalWidth > 0 ? card.naturalWidth : 1;
  const nh =
    card.naturalHeight && card.naturalHeight > 0 ? card.naturalHeight : 1;
  const aspect =
    card.role === "main"
      ? Math.max(nh / nw, 0.05)
      : Math.min(Math.max(nh / nw, MIN_ASPECT), MAX_ASPECT);
  return Math.round(width * aspect);
}

export function cardWorldHeight(card: CardSizing): number {
  // Only unsaved result cards render the save/retry bar below the image, so
  // saved and canvas-only results must not reserve its height (or rows gain a
  // 32px hole).
  const saveStatus =
    card.saveStatus ?? (card.galleryNanoid ? "saved" : "failed");
  const extra =
    card.role === "result" &&
    saveStatus !== "saved" &&
    saveStatus !== "local"
      ? 32
      : 0;
  return cardImageHeight(card) + CARD_HEADER_HEIGHT + extra;
}

/**
 * Role styling is centralized here so the four card types stay visually
 * distinguishable in both themes.
 */
export function cardFrameClass(role: CardRole, selected: boolean): string {
  return cn(
    "group absolute select-none rounded-2xl bg-zinc-950/95 text-zinc-100 shadow-2xl backdrop-blur-sm transition-shadow",
    role === "main" && "ring-2 ring-primary/80 border border-primary/30",
    role === "reference" &&
      "ring-1 ring-cyan-400/60 border border-dashed border-cyan-300/50",
    role === "result" && "ring-1 ring-emerald-400/50 border border-emerald-300/25",
    role === "free" &&
      "ring-1 ring-violet-400/60 border border-dotted border-violet-300/50",
    selected && "ring-offset-2 ring-offset-zinc-950 shadow-[0_0_0_1px_rgba(255,255,255,0.25),0_25px_60px_-15px_rgba(0,0,0,0.9)]"
  );
}

export function roleBadgeClass(role: CardRole, alternate = false): string {
  if (alternate) return "bg-amber-500/15 text-amber-300 border-amber-400/40";
  if (role === "main") return "bg-primary/20 text-primary border-primary/40";
  if (role === "reference") return "bg-cyan-500/15 text-cyan-300 border-cyan-400/40";
  if (role === "free") return "bg-violet-500/15 text-violet-300 border-violet-400/40";
  return "bg-emerald-500/15 text-emerald-300 border-emerald-400/40";
}

export function cardHeaderClass(role: CardRole): string {
  return cn(
    "flex h-10 shrink-0 items-center gap-1.5 overflow-hidden rounded-t-2xl border-b px-2.5",
    role === "main" && "border-primary/20 bg-primary/10",
    role === "reference" && "border-cyan-400/20 bg-cyan-500/10",
    role === "free" && "border-violet-400/20 bg-violet-500/10",
    role === "result" && "border-emerald-400/20 bg-emerald-500/10"
  );
}

/** Content width a placement region may use before wrapping to a new row. */
const REGION_ROW_WIDTH: Record<Exclude<CardRole, "main">, number> = {
  reference: 3 * CARD_WORLD_WIDTH.reference + 2 * 16,
  result: 3 * CARD_WORLD_WIDTH.result + 2 * CARD_GAP,
  free: 2 * CARD_WORLD_WIDTH.free + 16,
};

type FlowResult = {
  positions: { x: number; y: number }[];
  /** Right edge of the widest row. */
  right: number;
  /** Bottom edge of the last row. */
  bottom: number;
};

/**
 * Left-to-right packing with width-aware wrapping. Resized cards simply take
 * more room, so manual sizing and "Tidy layout" never produce overlapping cards.
 */
function flowPositions(
  items: CardSizing[],
  startX: number,
  startY: number,
  maxWidth: number,
  gapX: number,
  gapY: number
): FlowResult {
  const positions: { x: number; y: number }[] = [];
  let rowX = startX;
  let rowY = startY;
  let rowHeight = 0;
  let rowEmpty = true;
  let maxRight = startX;

  items.forEach((item) => {
    const width = cardWidth(item);
    const height = cardWorldHeight(item);
    if (!rowEmpty && rowX + width > startX + maxWidth) {
      rowX = startX;
      rowY += rowHeight + gapY;
      rowHeight = 0;
      rowEmpty = true;
    }
    positions.push({ x: Math.round(rowX), y: Math.round(rowY) });
    maxRight = Math.max(maxRight, rowX + width);
    rowX += width + gapX;
    rowHeight = Math.max(rowHeight, height);
    rowEmpty = false;
  });

  return {
    positions,
    right: Math.round(maxRight),
    bottom: Math.round(rowY + rowHeight),
  };
}

function sortRefs(cards: CardSizing[]): CardSizing[] {
  return cards
    .filter((card) => card.role === "reference")
    .sort((a, b) => (a.refOrder ?? 0) - (b.refOrder ?? 0));
}

/**
 * Canonical placement: main at the origin, results flowing underneath, then a
 * reference column and a free-image column to the right. Every region is
 * measured with the cards' current widths, so it stays correct after resizing.
 */
export function layoutPositions(
  cards: CardSizing[]
): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>();
  const main = cards.find((card) => card.role === "main");

  if (main?.id) positions.set(main.id, { x: 0, y: 0 });

  const results = cards.filter((card) => card.role === "result");
  const resultFlow = flowPositions(
    results,
    main ? 0 : 0,
    main ? cardWorldHeight(main) + 56 : 0,
    REGION_ROW_WIDTH.result,
    CARD_GAP,
    CARD_GAP
  );
  results.forEach((card, index) => {
    if (card.id) positions.set(card.id, resultFlow.positions[index]);
  });

  const leftWidth = Math.max(
    main ? cardWidth(main) : 0,
    results.length > 0 ? resultFlow.right : 0
  );

  const refs = sortRefs(cards);
  const refStartX = leftWidth > 0 ? leftWidth + 56 : 0;
  const refFlow = flowPositions(
    refs,
    refStartX,
    0,
    REGION_ROW_WIDTH.reference,
    16,
    16
  );
  refs.forEach((card, index) => {
    if (card.id) positions.set(card.id, refFlow.positions[index]);
  });

  const freeCards = cards.filter((card) => card.role === "free");
  const freeBase = Math.max(leftWidth, refs.length > 0 ? refFlow.right : 0);
  const freeFlow = flowPositions(
    freeCards,
    freeBase > 0 ? freeBase + 32 : 0,
    0,
    REGION_ROW_WIDTH.free,
    16,
    16
  );
  freeCards.forEach((card, index) => {
    if (card.id) positions.set(card.id, freeFlow.positions[index]);
  });

  return positions;
}

export function nextCardPosition(
  cards: CardSizing[],
  role: CardRole
): { x: number; y: number } {
  if (role === "main") {
    const main = cards.find((card) => card.role === "main");
    return main ? { x: main.x ?? 0, y: main.y ?? 0 } : { x: 0, y: 0 };
  }
  const placeholder: CardSizing = {
    id: "__next__",
    role,
    naturalWidth: 1,
    naturalHeight: 1,
  };
  const positions = layoutPositions([...cards, placeholder]);
  return positions.get("__next__") ?? { x: 0, y: 0 };
}

export function layoutCards<
  T extends { id: string; role: CardRole; x: number; y: number; width?: number }
>(cards: T[]): T[] {
  const positions = layoutPositions(cards);
  return cards.map((card) => {
    const position = positions.get(card.id);
    return position ? { ...card, ...position } : card;
  });
}
