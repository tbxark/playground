import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { toast } from "sonner";
import {
  MaskStroke,
  Point,
  composeMaskImage,
} from "../utils/composeMain";
import { dataUrlToBlob } from "../utils/file";
import { generateNanoid } from "../utils/nanoid";
import {
  deleteCanvasAsset,
  getCanvasAsset,
  pruneCanvasAssets,
  putCanvasAsset,
} from "../services/canvasAssetDb";
import {
  getHistoryRecordByNanoid,
  saveToHistory,
} from "../services/historyDb";
import { GenerationResult } from "../services/types";
import * as cardSource from "../utils/cardSource";
import {
  CARD_WORLD_WIDTH,
  cardWorldHeight,
  clampCardWidth,
  layoutCards,
  nextCardPosition,
} from "../components/FreeCanvas/cardStyles";
import { useConfigStore } from "./useConfigStore";
import { useQueueStore } from "./useQueueStore";
import { i18n } from "@/i18n";

export type { Point, MaskStroke };

export type CanvasTool = "select" | "inpaint";

export type CanvasCardRole = "main" | "reference" | "result" | "free";
export type CanvasCardOrigin =
  | "upload"
  | "generated"
  | "gallery"
  | "workflow"
  | "tool";
export type CanvasAssetState =
  | "gallery"
  | "ready"
  | "loading"
  | "missing"
  | "remote";
/** "local" is a canvas-only tool output: valid output, never in the gallery. */
export type CanvasSaveStatus =
  | "saving"
  | "saved"
  | "failed"
  | "unavailable"
  | "local";

export type LocalResultInput = {
  blob: Blob;
  name: string;
  width: number;
  height: number;
};

export type CardEditInput = {
  blob: Blob;
  width: number;
  height: number;
  /** Optional rename; the card keeps its current name when omitted. */
  name?: string;
  /** The bitmap geometry changed, so a pending inpaint mask no longer lines up. */
  clearMask?: boolean;
};

export type ResultMeta = {
  nanoid: string;
  prompt: string;
  negativePrompt?: string;
  provider: string;
  model: string;
  size: string;
  resolution: string;
  seed?: number;
  cfgScale?: number;
  steps?: number;
  generationTimeMs: number;
  createdAt: number;
};

export type CanvasCard = {
  id: string;
  role: CanvasCardRole;
  origin: CanvasCardOrigin;
  name: string;
  /** Runtime URL: object/data/http. Persisted only when it is http(s). */
  url: string;
  originalUrl?: string;
  compareUrl?: string;
  naturalWidth?: number;
  naturalHeight?: number;
  /** User-set world width; the role default applies when unset. */
  width?: number;
  x: number;
  y: number;
  refOrder?: number;
  assetKey?: string;
  /** Pre-edit snapshot used for before/after comparison after a reload. */
  originalAssetKey?: string;
  galleryNanoid?: string;
  nanoid?: string;
  resultTaskId?: string;
  prompt?: string;
  saveStatus?: CanvasSaveStatus;
  saveError?: string;
  resultMeta?: ResultMeta;
  assetState: CanvasAssetState;
  isEdited?: boolean;
};

export type AddFilesResult = {
  added: number;
  total: number;
  active: number;
};

/**
 * Simple-mode input image. `order` defines participation: the first image is
 * the base image, the rest are references. Blobs live in `canvasAssets`, so
 * `url` is a runtime object URL that is stripped before persisting.
 */
export type SimpleImage = {
  id: string;
  name: string;
  url: string;
  assetKey?: string;
  order: number;
  /** "memory" means the blob could not be stored and only lives this session. */
  persist?: "asset" | "memory";
  /** Restored from persistence but the IndexedDB asset is gone. */
  missing?: boolean;
};

type EditingState = {
  maskBrushSize: number;
  isMaskEraser: boolean;
  maskStrokes: MaskStroke[];
  isMaskInverted: boolean;
};

/**
 * Editing fields that are worth undoing. Tool selection stays as it is across
 * undo/redo.
 */
export type CanvasEditingSnapshot = {
  maskStrokes: MaskStroke[];
  isMaskInverted: boolean;
};

/**
 * Session-only undo entry. Cards in a snapshot keep their runtime URLs, so the
 * stack is never persisted (and is empty after a refresh, by design).
 */
export type FreeCanvasHistorySnapshot = {
  cards: CanvasCard[];
  editing: CanvasEditingSnapshot;
};

export const FREE_CANVAS_HISTORY_LIMIT = 30;

type FreeCanvasState = EditingState & {
  cards: CanvasCard[];
  selectedCardId: string | null;
  activeTool: CanvasTool;
  isCommittingMain: boolean;
  isHydrated: boolean;
  initialFitDone: boolean;
  markInitialFitDone: () => void;

  past: FreeCanvasHistorySnapshot[];
  future: FreeCanvasHistorySnapshot[];
  captureHistorySnapshot: () => FreeCanvasHistorySnapshot;
  pushHistory: () => void;
  pushHistorySnapshot: (snapshot: FreeCanvasHistorySnapshot) => void;
  undo: () => boolean;
  redo: () => boolean;
  /** Remove every card from the canvas; returns how many were removed. */
  clearAllCards: () => number;

  zoom: number;
  pan: Point;
  isBarCollapsed: boolean;

  /**
   * Result nanoids the user deliberately removed (single card or clear-all).
   * The queue keeps completed tasks for the whole session, so ingestion must
   * not resurrect a card the user threw away. Session-only, like the queue.
   */
  dismissedResultNanoids: string[];

  /** Simple-mode inputs (the first one is the base image). */
  simpleImages: SimpleImage[];
  addSimpleImages: (
    files: FileList | File[]
  ) => Promise<{ added: number; total: number }>;
  removeSimpleImage: (id: string) => void;
  moveSimpleImage: (id: string, direction: -1 | 1) => void;
  clearSimpleImages: () => void;
  /** Resolve every simple image to a value a provider accepts, in order. */
  resolveSimpleImageUrls: () => Promise<string[]>;

  addFiles: (
    files: FileList | File[],
    options?: { forceReference?: boolean; asFree?: boolean }
  ) => Promise<AddFilesResult>;
  addExternalImage: (input: {
    url: string;
    name: string;
    origin: CanvasCardOrigin;
    galleryNanoid?: string;
    prompt?: string;
    compareUrl?: string;
    role?: "auto" | "main" | "reference" | "result" | "free";
  }) => Promise<string | null>;
  addResultCard: (
    result: GenerationResult,
    taskId?: string,
    options?: { restoreDismissed?: boolean }
  ) => Promise<string | null>;
  addResultAsReference: (result: GenerationResult) => Promise<string | null>;
  /** Add a local (never gallery-saved) output as a result card. */
  addLocalResult: (input: LocalResultInput) => Promise<string | null>;
  /** Replace a card's bitmap in place; one undo step, keeps the pre-edit original. */
  replaceCardImage: (id: string, input: CardEditInput) => Promise<boolean>;
  syncResultSaveState: (result: GenerationResult) => void;
  retrySaveCard: (id: string) => Promise<boolean>;

  setMainFromGallery: (input: {
    blob: Blob;
    nanoid: string;
    name: string;
    prompt?: string;
    createdAt?: number;
    discardMask?: boolean;
  }) => Promise<boolean>;
  promoteToMain: (
    id: string,
    options?: { discardMask?: boolean }
  ) => Promise<boolean>;
  clearMain: (options?: { discardMask?: boolean }) => Promise<boolean>;

  selectCard: (id: string | null) => void;
  moveCard: (id: string, x: number, y: number) => void;
  /** Resize a card in world units; clamped and undoable. */
  resizeCard: (id: string, width: number) => void;
  /** Convert between the two non-generating kinds: reference ⇄ free. */
  setCardRole: (id: string, role: "reference" | "free") => void;
  updateCard: (id: string, patch: Partial<CanvasCard>) => void;
  updateCardSize: (id: string, width: number, height: number) => void;
  removeCard: (id: string) => CanvasCard | null;
  restoreCard: (card: CanvasCard) => void;
  rehydrateCard: (id: string) => Promise<boolean>;
  moveReference: (id: string, direction: -1 | 1) => void;
  arrangeCards: () => void;
  /** Line every result up in one row at a comparable size; returns their ids. */
  spreadResults: () => string[];

  hydrateAssets: () => Promise<void>;
  exportMainForRequest: () => Promise<{
    baseUrl: string;
    maskUrl?: string;
    width?: number;
    height?: number;
  } | null>;
  exportMainImage: () => Promise<string | null>;
  activeReferenceUrls: () => Promise<string[]>;

  setActiveTool: (tool: CanvasTool) => void;
  setMaskBrushSize: (size: number) => void;
  setIsMaskEraser: (isEraser: boolean) => void;
  setMaskStrokes: (strokes: MaskStroke[] | ((prev: MaskStroke[]) => MaskStroke[])) => void;
  setIsMaskInverted: (inverted: boolean) => void;
  clearMask: () => void;

  setZoom: (zoom: number | ((prev: number) => number)) => void;
  setPan: (pan: Point | ((prev: Point) => Point)) => void;
  setIsBarCollapsed: (collapsed: boolean | ((prev: boolean) => boolean)) => void;
  resetView: () => void;
};

export const FREE_CANVAS_STORAGE_KEY = "universal-playground-free-canvas";
export const MAX_REFERENCE_PARTICIPATION = 4;
/** Simple mode accepts up to five images: the first is the base image. */
export const MAX_SIMPLE_IMAGES = 5;

let lastPersistedValue: string | null = null;
let persistFailureWarned = false;
let hydrationInFlight = false;

/**
 * Persist middleware runs on every store write, including pan/zoom and mask
 * strokes which are not persisted. Skip identical payloads so viewport motion
 * never hits localStorage, and surface quota failures instead of silently
 * dropping writes inside zustand.
 */
const cardStorage = createJSONStorage(() => ({
  getItem: (name: string) => {
    const value = localStorage.getItem(name);
    lastPersistedValue = value;
    return value;
  },
  setItem: (name: string, value: string) => {
    if (value === lastPersistedValue) return;
    try {
      localStorage.setItem(name, value);
      lastPersistedValue = value;
    } catch {
      if (!persistFailureWarned) {
        persistFailureWarned = true;
        toast.error(i18n.t("err.canvasPersistFailed"));
      }
    }
  },
  removeItem: (name: string) => {
    lastPersistedValue = null;
    localStorage.removeItem(name);
  },
}));

const EMPTY_EDITING: EditingState & { activeTool: CanvasTool } = {
  maskBrushSize: 32,
  isMaskEraser: false,
  maskStrokes: [],
  isMaskInverted: false,
  activeTool: "select",
};

/** Applied edits rebuild the bitmap, so a pending mask no longer lines up. */
const RESET_MASK: EditingState = {
  maskBrushSize: 32,
  isMaskEraser: false,
  maskStrokes: [],
  isMaskInverted: false,
};

function captureEditingSnapshot(state: FreeCanvasState): CanvasEditingSnapshot {
  return {
    maskStrokes: [...state.maskStrokes],
    isMaskInverted: state.isMaskInverted,
  };
}


function captureFreeCanvasSnapshot(
  state: FreeCanvasState
): FreeCanvasHistorySnapshot {
  return {
    cards: [...state.cards],
    editing: captureEditingSnapshot(state),
  };
}

/**
 * Restore the snapshot but keep result cards that arrived after it was taken,
 * so undoing a card drag never deletes a generation that finished meanwhile.
 * Result cards that were already in the snapshot still undo normally.
 */
function mergeHistoryCards(
  snapshotCards: CanvasCard[],
  currentCards: CanvasCard[]
): CanvasCard[] {
  const snapshotIds = new Set(snapshotCards.map((card) => card.id));
  const newerResults = currentCards.filter(
    (card) => card.role === "result" && !snapshotIds.has(card.id)
  );
  return normalizeCards([...snapshotCards, ...newerResults]);
}

function nextRefOrder(cards: CanvasCard[]): number {
  return cards.filter((card) => card.role === "reference").length;
}

function sortReferences(cards: CanvasCard[]): CanvasCard[] {
  return cards
    .filter((card) => card.role === "reference")
    .sort((a, b) => (a.refOrder ?? 0) - (b.refOrder ?? 0));
}

/** Re-number simple images from their current array order. */
function reindexSimpleImages(images: SimpleImage[]): SimpleImage[] {
  return images.map((image, index) => ({ ...image, order: index }));
}

/** Restore persisted ordering; used on hydration only. */
function sortSimpleImages(images: SimpleImage[]): SimpleImage[] {
  return reindexSimpleImages(
    [...images].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
  );
}

function normalizeReferenceOrder(cards: CanvasCard[]): CanvasCard[] {
  const refs = sortReferences(cards);
  const order = new Map(refs.map((card, index) => [card.id, index]));
  return cards.map((card) =>
    card.role === "reference"
      ? { ...card, refOrder: order.get(card.id) ?? card.refOrder ?? 0 }
      : { ...card, refOrder: undefined }
  );
}

function normalizeMainUniqueness(cards: CanvasCard[]): CanvasCard[] {
  let seenMain = false;
  return cards.map((card) => {
    if (card.role !== "main") return card;
    if (!seenMain) {
      seenMain = true;
      return card;
    }
    const role = demotedRole(card);
    return {
      ...card,
      role,
      refOrder: role === "reference" ? nextRefOrder(cards) : undefined,
    };
  });
}

function normalizeCards(cards: CanvasCard[]): CanvasCard[] {
  return normalizeReferenceOrder(normalizeMainUniqueness(cards));
}

function demotedRole(card: CanvasCard): CanvasCardRole {
  // Generated and locally-produced tool outputs are results; uploads and
  // gallery/workflow images step aside as references.
  return card.origin === "generated" || card.origin === "tool"
    ? "result"
    : "reference";
}

const DISMISSED_RESULT_LIMIT = 500;

/** Remember removed result nanoids so ingestion never re-adds them. */
function addDismissedNanoids(
  current: string[],
  nanoids: string[]
): string[] {
  if (nanoids.length === 0) return current;
  const next = new Set(current);
  nanoids.forEach((id) => {
    if (id) next.add(id);
  });
  return Array.from(next).slice(-DISMISSED_RESULT_LIMIT);
}

/**
 * Place a newly promoted card at the main slot without re-flowing the whole
 * canvas. Cards the user positioned by hand keep their coordinates; only the
 * new main moves into the old main's slot (or the origin), and the demoted old
 * main steps aside into the results/reference area so the two never stack.
 */
function settleMainCard(
  cards: CanvasCard[],
  mainId: string,
  demotedId?: string
): CanvasCard[] {
  const main = cards.find((card) => card.id === mainId);
  if (!main) return cards;
  const demoted = demotedId
    ? cards.find((card) => card.id === demotedId)
    : undefined;
  const mainPosition = demoted
    ? { x: demoted.x, y: demoted.y }
    : { x: 0, y: 0 };
  const demotedPosition = demoted
    ? nextCardPosition(
        [
          ...cards.filter(
            (card) => card.id !== demoted.id && card.id !== main.id
          ),
          { ...main, x: mainPosition.x, y: mainPosition.y },
        ],
        demoted.role
      )
    : null;

  return cards.map((card) => {
    if (card.id === main.id) return { ...card, ...mainPosition };
    if (demoted && card.id === demoted.id && demotedPosition) {
      return { ...card, ...demotedPosition };
    }
    return card;
  });
}

function stripRuntimeUrls(card: CanvasCard): CanvasCard {
  return {
    ...card,
    url: cardSource.isHttpUrl(card.url) ? card.url : "",
    originalUrl: cardSource.isHttpUrl(card.originalUrl)
      ? card.originalUrl
      : undefined,
    compareUrl: cardSource.isHttpUrl(card.compareUrl)
      ? card.compareUrl
      : undefined,
  };
}

function buildResultMeta(result: GenerationResult): ResultMeta {
  return {
    nanoid: result.nanoid,
    prompt: result.prompt,
    negativePrompt: result.negativePrompt,
    provider: result.provider,
    model: result.model,
    size: result.size,
    resolution: result.resolution,
    seed: result.seed,
    cfgScale: result.cfgScale,
    steps: result.steps,
    generationTimeMs: result.generationTimeMs,
    createdAt: result.createdAt,
  };
}

async function loadDimensionsSafe(
  source: Blob | string
): Promise<{ width?: number; height?: number }> {
  try {
    return await cardSource.getImageDimensions(source);
  } catch {
    return {};
  }
}

/**
 * Merge runtime asset fields (URL, asset keys, dimensions, edit flags) into the
 * latest card object while preserving position/role/name that may have changed
 * while an async commit was in flight.
 */
function mergeRuntimeCard(target: CanvasCard, source: CanvasCard): CanvasCard {
  return {
    ...target,
    url: source.url || target.url,
    assetKey: source.assetKey ?? target.assetKey,
    originalAssetKey: source.originalAssetKey ?? target.originalAssetKey,
    assetState: source.assetState,
    naturalWidth: source.naturalWidth ?? target.naturalWidth,
    naturalHeight: source.naturalHeight ?? target.naturalHeight,
    isEdited: source.isEdited ?? target.isEdited,
    originalUrl: source.originalUrl ?? target.originalUrl,
  };
}

/**
 * Versioned key for a committed edit. Reusing `card-<id>` overwrote the bytes
 * the pre-commit undo snapshot still points at, so undo looked reverted while
 * the asset held the edited image — and the next commit composed the edit a
 * second time. Old versioned assets are left in place for undo and reclaimed by
 * the capped startup prune.
 */
function nextEditAssetKey(cardId: string): string {
  return `card-${cardId}-edit-${Date.now().toString(36)}-${generateNanoid(6)}`;
}

async function materializeLocalCard(
  card: CanvasCard
): Promise<CanvasCard> {
  if (card.assetKey) {
    try {
      const existing = await getCanvasAsset(card.assetKey);
      if (existing) {
        return {
          ...card,
          url: URL.createObjectURL(existing),
          assetState: "ready",
        };
      }
    } catch {
      // fall through
    }
  }

  if (card.galleryNanoid && !card.isEdited) {
    try {
      const record = await getHistoryRecordByNanoid(card.galleryNanoid);
      if (record?.imageBlob) {
        const dimensions = await loadDimensionsSafe(record.imageBlob);
        return {
          ...card,
          url: URL.createObjectURL(record.imageBlob),
          assetState: "gallery",
          naturalWidth: card.naturalWidth ?? dimensions.width,
          naturalHeight: card.naturalHeight ?? dimensions.height,
        };
      }
    } catch {
      // fall through
    }
  }

  if (card.isEdited) {
    // Never silently replace committed edits with the unedited gallery original.
    return { ...card, url: "", assetState: "missing" };
  }

  const { corsProxy, corsProxyMode } = useConfigStore.getState();
  const blob = await cardSource.resolveCardBlob(card, corsProxy, corsProxyMode);
  if (!blob) {
    return { ...card, url: "", assetState: "missing" };
  }

  const assetKey = card.assetKey ?? `card-${card.id}`;
  try {
    await putCanvasAsset(assetKey, blob);
  } catch {
    toast.warning(i18n.t("freeCanvas.cards.assetStoreFailed"), {
      id: "canvas-asset-failed",
    });
  }
  const dimensions = await loadDimensionsSafe(blob);
  return {
    ...card,
    url: URL.createObjectURL(blob),
    assetKey,
    assetState: "ready",
    naturalWidth: card.naturalWidth ?? dimensions.width,
    naturalHeight: card.naturalHeight ?? dimensions.height,
  };
}

export const useFreeCanvasStore = create<FreeCanvasState>()(
  persist(
    (set, get) => ({
      cards: [],
      selectedCardId: null,
      isCommittingMain: false,
      isHydrated: false,
      initialFitDone: false,
      ...EMPTY_EDITING,

      zoom: 1,
      pan: { x: 0, y: 0 },
      isBarCollapsed: false,
      dismissedResultNanoids: [],

      past: [],
      future: [],

      captureHistorySnapshot: () => captureFreeCanvasSnapshot(get()),

      pushHistory: () => {
        get().pushHistorySnapshot(captureFreeCanvasSnapshot(get()));
      },

      pushHistorySnapshot: (snapshot) => {
        set((state) => ({
          past: [...state.past, snapshot].slice(-FREE_CANVAS_HISTORY_LIMIT),
          future: [],
        }));
      },

      undo: () => {
        const state = get();
        if (state.past.length === 0 || state.isCommittingMain) return false;
        const previous = state.past[state.past.length - 1];
        const current = captureFreeCanvasSnapshot(state);
        const merged = mergeHistoryCards(previous.cards, state.cards);
        set({
          cards: merged,
          ...previous.editing,
          past: state.past.slice(0, -1),
          future: [...state.future, current].slice(-FREE_CANVAS_HISTORY_LIMIT),
          selectedCardId: merged.some(
            (card) => card.id === state.selectedCardId
          )
            ? state.selectedCardId
            : null,
        });
        // Removed cards had their object URLs revoked; rebuild them from
        // IndexedDB (or the gallery) instead of showing a broken image.
        merged.forEach((card) => {
          if (!card.url || cardSource.isHttpUrl(card.url)) return;
          if (!card.assetKey && !card.galleryNanoid) return;
          void get().rehydrateCard(card.id);
        });
        return true;
      },

      redo: () => {
        const state = get();
        if (state.future.length === 0 || state.isCommittingMain) return false;
        const target = state.future[state.future.length - 1];
        const current = captureFreeCanvasSnapshot(state);
        const merged = mergeHistoryCards(target.cards, state.cards);
        set({
          cards: merged,
          ...target.editing,
          past: [...state.past, current].slice(-FREE_CANVAS_HISTORY_LIMIT),
          future: state.future.slice(0, -1),
          selectedCardId: merged.some(
            (card) => card.id === state.selectedCardId
          )
            ? state.selectedCardId
            : null,
        });
        merged.forEach((card) => {
          if (!card.url || cardSource.isHttpUrl(card.url)) return;
          if (!card.assetKey && !card.galleryNanoid) return;
          void get().rehydrateCard(card.id);
        });
        return true;
      },

      clearAllCards: () => {
        const state = get();
        if (state.cards.length === 0 || state.isCommittingMain) return 0;
        get().pushHistory();
        const count = state.cards.length;
        // Every generated nanoid on the canvas is remembered, whatever role it
        // currently plays: clearing must not let ingestion refill the canvas
        // from queue tasks that are still in memory.
        const dismissed = state.cards
          .map((card) => card.nanoid)
          .filter((nanoid): nanoid is string => Boolean(nanoid));
        // Object URLs are intentionally kept alive: the undo entry references
        // them and `rehydrateCard` can rebuild anything that gets revoked.
        set({
          cards: [],
          ...EMPTY_EDITING,
          activeTool: "select",
          selectedCardId: null,
          dismissedResultNanoids: addDismissedNanoids(
            state.dismissedResultNanoids,
            dismissed
          ),
        });
        return count;
      },

      simpleImages: [],

      addSimpleImages: async (fileList) => {
        const files = Array.from(fileList).filter((file) =>
          file.type.startsWith("image/")
        );
        const current = get().simpleImages;
        if (files.length === 0) {
          return { added: 0, total: current.length };
        }

        const room = MAX_SIMPLE_IMAGES - current.length;
        if (room <= 0) {
          toast.info(
            i18n.t("simple.maxImagesHint", { max: MAX_SIMPLE_IMAGES })
          );
          return { added: 0, total: current.length };
        }

        let added = 0;
        for (const file of files.slice(0, room)) {
          const id = `simple-${Date.now()}-${generateNanoid(6)}`;
          const assetKey = `simple-${id}`;
          let persistMode: SimpleImage["persist"] = "asset";
          try {
            await putCanvasAsset(assetKey, file);
          } catch {
            persistMode = "memory";
            toast.warning(i18n.t("simple.persistMemoryHint"), {
              id: "simple-memory-image",
            });
          }
          const url = URL.createObjectURL(file);
          set((state) => ({
            simpleImages: reindexSimpleImages([
              ...state.simpleImages,
              {
                id,
                name: file.name,
                url,
                assetKey: persistMode === "asset" ? assetKey : undefined,
                order: state.simpleImages.length,
                persist: persistMode,
              },
            ]),
          }));
          added += 1;
        }

        if (files.length > room) {
          toast.info(
            i18n.t("simple.maxImagesHint", { max: MAX_SIMPLE_IMAGES })
          );
        }
        return { added, total: get().simpleImages.length };
      },

      removeSimpleImage: (id) => {
        const target = get().simpleImages.find((image) => image.id === id);
        if (!target) return;
        set((state) => ({
          simpleImages: reindexSimpleImages(
            state.simpleImages.filter((image) => image.id !== id)
          ),
        }));
        cardSource.revokeObjectUrl(target.url);
        if (target.assetKey) {
          void deleteCanvasAsset(target.assetKey).catch(() => undefined);
        }
      },

      moveSimpleImage: (id, direction) => {
        set((state) => {
          const ordered = reindexSimpleImages(state.simpleImages);
          const index = ordered.findIndex((image) => image.id === id);
          const targetIndex = index + direction;
          if (index < 0 || targetIndex < 0 || targetIndex >= ordered.length) {
            return state;
          }
          const next = [...ordered];
          const [moved] = next.splice(index, 1);
          next.splice(targetIndex, 0, moved);
          return { simpleImages: reindexSimpleImages(next) };
        });
      },

      clearSimpleImages: () => {
        const images = get().simpleImages;
        set({ simpleImages: [] });
        images.forEach((image) => {
          cardSource.revokeObjectUrl(image.url);
          if (image.assetKey) {
            void deleteCanvasAsset(image.assetKey).catch(() => undefined);
          }
        });
      },

      resolveSimpleImageUrls: async () => {
        const state = get();
        const { corsProxy, corsProxyMode } = useConfigStore.getState();
        const urls: string[] = [];
        for (const image of sortSimpleImages(state.simpleImages)) {
          try {
            const url = await cardSource.resolveCardDataUrl(
              { url: image.url, assetKey: image.assetKey },
              corsProxy,
              corsProxyMode
            );
            if (url && !urls.includes(url)) urls.push(url);
          } catch {
            // Skip unreadable images; the panel marks those slots explicitly.
          }
        }
        return urls;
      },

      addFiles: async (fileList, options) => {
        const imageFiles = Array.from(fileList).filter((file) =>
          file.type.startsWith("image/")
        );
        if (imageFiles.length === 0) {
          return { added: 0, total: 0, active: 0 };
        }

        get().pushHistory();
        let added = 0;

        for (const file of imageFiles) {
          try {
            const blob = file;
            const id = `card-${Date.now()}-${generateNanoid(6)}`;
            const assetKey = `card-${id}`;
            try {
              await putCanvasAsset(assetKey, blob);
            } catch {
              toast.warning(i18n.t("freeCanvas.cards.assetStoreFailed"), {
                id: "canvas-asset-failed",
              });
            }
            const url = URL.createObjectURL(blob);
            const dimensions = await loadDimensionsSafe(url);

            // Insert against the latest state so two rapid upload batches can
            // never overwrite each other's cards.
            set((state) => {
              const hasMain = state.cards.some(
                (card) => card.role === "main"
              );
              const role: CanvasCardRole = options?.asFree
                ? "free"
                : options?.forceReference || hasMain
                  ? "reference"
                  : "main";
              const position = nextCardPosition(state.cards, role);
              const card: CanvasCard = {
                id,
                role,
                origin: "upload",
                name: file.name,
                url,
                x: position.x,
                y: position.y,
                refOrder:
                  role === "reference"
                    ? nextRefOrder(state.cards)
                    : undefined,
                assetKey,
                assetState: "ready",
                naturalWidth: dimensions.width,
                naturalHeight: dimensions.height,
              };
              let cards = normalizeCards([...state.cards, card]);
              if (role === "main") {
                cards = normalizeCards(layoutCards(cards));
              }
              return {
                cards,
                ...(role === "main"
                  ? {
                      ...EMPTY_EDITING,
                      selectedCardId: id,
                    }
                  : {}),
              };
            });
            added += 1;
          } catch (error) {
            toast.error(
              i18n.t("freeCanvas.cards.fileReadFailed", {
                message:
                  error instanceof Error ? error.message : String(error),
              })
            );
          }
        }

        const finalCards = get().cards;
        const total = finalCards.filter(
          (card) => card.role === "reference"
        ).length;
        const active = Math.min(MAX_REFERENCE_PARTICIPATION, total);
        if (added > 0) {
          toast.success(
            i18n.t("freeCanvas.cards.imagesAdded", { count: added })
          );
        }
        if (total > MAX_REFERENCE_PARTICIPATION) {
          toast.info(
            i18n.t("freeCanvas.cards.referenceOverflow", {
              count: total - MAX_REFERENCE_PARTICIPATION,
            })
          );
        }
        return { added, total, active };
      },

      addExternalImage: async (input) => {
        const state = get();
        const existing = state.cards.find(
          (card) =>
            (input.galleryNanoid && card.galleryNanoid === input.galleryNanoid) ||
            (card.url && card.url === input.url)
        );
        if (existing) {
          set({ selectedCardId: existing.id });
          return existing.id;
        }

        const hasMain = state.cards.some((card) => card.role === "main");
        let role: CanvasCardRole;
        if (input.role === "main") {
          role = "main";
        } else if (input.role === "reference") {
          role = "reference";
        } else if (input.role === "result") {
          role = "result";
        } else if (input.role === "free") {
          role = "free";
        } else if (!hasMain) {
          role = "main";
        } else {
          role = input.origin === "workflow" ? "result" : "reference";
        }

        const id = `card-${Date.now()}-${generateNanoid(6)}`;

        let url = input.url;
        let assetKey: string | undefined;
        let assetState: CanvasAssetState = cardSource.isHttpUrl(input.url)
          ? "remote"
          : "loading";

        let galleryLoaded = false;
        if (input.galleryNanoid) {
          try {
            const record = await getHistoryRecordByNanoid(input.galleryNanoid);
            if (record?.imageBlob) {
              url = URL.createObjectURL(record.imageBlob);
              assetState = "gallery";
              galleryLoaded = true;
            }
          } catch {
            // keep the provided url and materialize below
          }
        }
        if (
          !galleryLoaded &&
          (cardSource.isDataUrl(input.url) ||
            cardSource.isBlobUrl(input.url) ||
            role === "main")
        ) {
          const { corsProxy, corsProxyMode } = useConfigStore.getState();
          const blob = await cardSource.resolveCardBlob(
            { url: input.url, galleryNanoid: input.galleryNanoid },
            corsProxy,
            corsProxyMode
          );
          if (blob) {
            assetKey = `card-${id}`;
            try {
              await putCanvasAsset(assetKey, blob);
            } catch {
              toast.warning(i18n.t("freeCanvas.cards.assetStoreFailed"), {
                id: "canvas-asset-failed",
              });
            }
            url = URL.createObjectURL(blob);
            assetState = "ready";
          } else if (role === "main" && cardSource.isHttpUrl(input.url)) {
            assetState = "remote";
            toast.warning(i18n.t("freeCanvas.cards.remoteEditUnavailable"), {
              id: "canvas-remote-main",
            });
          }
        }

        const dimensions = await loadDimensionsSafe(url || input.url);

        const duplicate = get().cards.find(
          (card) =>
            (input.galleryNanoid &&
              card.galleryNanoid === input.galleryNanoid) ||
            (card.url && card.url === input.url)
        );
        if (duplicate) {
          if (assetKey) {
            void deleteCanvasAsset(assetKey).catch(() => undefined);
          }
          // The URL was created for a card that will never exist; keeping it
          // pins a full image blob for the rest of the session.
          if (url !== input.url) cardSource.revokeObjectUrl(url);
          set({ selectedCardId: duplicate.id });
          return duplicate.id;
        }

        get().pushHistory();
        set((current) => {
          let finalRole = role;
          if (
            finalRole === "main" &&
            current.cards.some((card) => card.role === "main")
          ) {
            finalRole =
              input.origin === "workflow" ? "result" : "reference";
          }
          const position = nextCardPosition(current.cards, finalRole);
          const card: CanvasCard = {
            id,
            role: finalRole,
            origin: input.origin,
            name: input.name,
            url,
            assetKey,
            assetState,
            naturalWidth: dimensions.width,
            naturalHeight: dimensions.height,
            x: position.x,
            y: position.y,
            refOrder:
              finalRole === "reference"
                ? nextRefOrder(current.cards)
                : undefined,
            galleryNanoid: input.galleryNanoid,
            prompt: input.prompt,
            compareUrl: input.compareUrl,
          };
          let cards = normalizeCards([...current.cards, card]);
          if (finalRole === "main") {
            cards = normalizeCards(layoutCards(cards));
          }
          return {
            cards,
            selectedCardId: id,
            ...(finalRole === "main"
              ? { ...EMPTY_EDITING, activeTool: "select" as const }
              : {}),
          };
        });
        return id;
      },

      addResultCard: async (result, taskId, options) => {
        const state = get();
        // Reference cards share the nanoid of the result they came from; they
        // must never be mistaken for the result card (their blob is theirs).
        const existing = state.cards.find(
          (card) =>
            card.role !== "reference" &&
            (card.nanoid === result.nanoid ||
              card.galleryNanoid === result.nanoid)
        );
        if (existing) return existing.id;
        // A card the user removed on purpose stays removed until an explicit
        // "add to canvas" asks for it back.
        if (
          !options?.restoreDismissed &&
          state.dismissedResultNanoids.includes(result.nanoid)
        ) {
          return null;
        }

        if (options?.restoreDismissed) {
          set((current) => ({
            dismissedResultNanoids: current.dismissedResultNanoids.filter(
              (id) => id !== result.nanoid
            ),
          }));
        }

        const id = `result-${result.nanoid}`;
        const saved = result.gallerySaveStatus === "saved";
        const blob =
          result.blob ??
          (cardSource.isDataUrl(result.url)
            ? dataUrlToBlob(result.url)
            : null);

        const url = blob ? URL.createObjectURL(blob) : result.url;
        const dimensions = await loadDimensionsSafe(url);

        const existingAfterLoad = get().cards.find(
          (card) =>
            card.role !== "reference" &&
            (card.nanoid === result.nanoid ||
              card.galleryNanoid === result.nanoid)
        );
        if (existingAfterLoad) {
          if (blob) URL.revokeObjectURL(url);
          return existingAfterLoad.id;
        }

        let card: CanvasCard = {
          id,
          role: "result",
          origin: "generated",
          name: i18n.t("freeCanvas.resultName", { id: result.nanoid }),
          url,
          assetState: saved ? "gallery" : blob ? "loading" : "remote",
          galleryNanoid: saved ? result.nanoid : undefined,
          nanoid: result.nanoid,
          resultTaskId: taskId,
          prompt: result.prompt,
          compareUrl: result.referenceImages?.[0],
          saveStatus: saved
            ? "saved"
            : result.gallerySaveStatus === "saving"
              ? "saving"
              : "failed",
          saveError: result.gallerySaveError,
          resultMeta: buildResultMeta(result),
          naturalWidth: dimensions.width,
          naturalHeight: dimensions.height,
          x: 0,
          y: 0,
        };

        set((current) => {
          const position = nextCardPosition(current.cards, "result");
          card = { ...card, ...position };
          return {
            cards: normalizeCards([...current.cards, card]),
          };
        });

        void (async () => {
          if (saved || !blob) return;
          const assetKey = `card-${id}`;
          let assetState: CanvasAssetState = "ready";
          try {
            await putCanvasAsset(assetKey, blob);
          } catch {
            assetState = "ready";
            toast.warning(i18n.t("freeCanvas.cards.assetStoreFailed"), {
              id: "canvas-asset-failed",
            });
          }
          // Merge asset fields only: the user may have dragged, resized,
          // tidied or promoted this card while the write was in flight, and
          // re-applying the insertion-time snapshot used to revert that.
          set((current) => ({
            cards: current.cards.map((item) =>
              item.id === id ? { ...item, assetKey, assetState } : item
            ),
          }));
        })();

        return id;
      },

      addResultAsReference: async (result) => {
        const state = get();
        const existingRef = state.cards.find(
          (card) => card.role === "reference" && card.nanoid === result.nanoid
        );
        if (existingRef) return existingRef.id;

        // Do not route through addExternalImage: it dedupes by gallery id and
        // would return the existing *result* card instead of adding a new
        // reference card for the same image.
        const saved = result.gallerySaveStatus === "saved";
        const id = `ref-${result.nanoid}`;
        let url = result.url;
        let assetKey: string | undefined;
        let assetState: CanvasAssetState = cardSource.isHttpUrl(result.url)
          ? "remote"
          : "loading";

        let galleryLoaded = false;
        if (saved) {
          try {
            const record = await getHistoryRecordByNanoid(result.nanoid);
            if (record?.imageBlob) {
              url = URL.createObjectURL(record.imageBlob);
              assetState = "gallery";
              galleryLoaded = true;
            }
          } catch {
            // fall through to the runtime copy
          }
        }

        if (!galleryLoaded) {
          const blob =
            result.blob ??
            (cardSource.isDataUrl(result.url)
              ? dataUrlToBlob(result.url)
              : null);
          if (blob) {
            url = URL.createObjectURL(blob);
            assetKey = `card-${id}`;
            try {
              await putCanvasAsset(assetKey, blob);
            } catch {
              toast.warning(i18n.t("freeCanvas.cards.assetStoreFailed"), {
                id: "canvas-asset-failed",
              });
            }
            assetState = "ready";
          } else {
            assetState = "remote";
          }
        }

        const dimensions = await loadDimensionsSafe(url || result.url);

        if (get().cards.some((card) => card.id === id)) {
          // A concurrent call already created this reference: drop the bytes
          // and object URL this attempt allocated.
          if (url !== result.url) cardSource.revokeObjectUrl(url);
          if (assetKey) void deleteCanvasAsset(assetKey).catch(() => undefined);
          set({ selectedCardId: id });
          return id;
        }
        get().pushHistory();
        set((current) => {
          const position = nextCardPosition(current.cards, "reference");
          const card: CanvasCard = {
            id,
            role: "reference",
            origin: "generated",
            name: i18n.t("freeCanvas.resultName", { id: result.nanoid }),
            url,
            assetKey,
            assetState,
            naturalWidth: dimensions.width,
            naturalHeight: dimensions.height,
            x: position.x,
            y: position.y,
            refOrder: nextRefOrder(current.cards),
            galleryNanoid: saved ? result.nanoid : undefined,
            nanoid: result.nanoid,
            prompt: result.prompt,
            compareUrl: result.referenceImages?.[0],
          };
          return {
            cards: normalizeCards([...current.cards, card]),
            selectedCardId: id,
          };
        });

        const used = get().cards.some(
          (card) => card.id === id && card.url === url
        );
        if (!used) cardSource.revokeObjectUrl(url);
        return id;
      },

      addLocalResult: async (input) => {
        const width = Math.max(1, Math.round(input.width));
        const height = Math.max(1, Math.round(input.height));
        const id = `tool-${Date.now()}-${generateNanoid(6)}`;
        const assetKey = `card-${id}`;
        try {
          await putCanvasAsset(assetKey, input.blob);
        } catch {
          toast.warning(i18n.t("freeCanvas.cards.assetStoreFailed"), {
            id: "canvas-asset-failed",
          });
        }
        const url = URL.createObjectURL(input.blob);
        get().pushHistory();
        set((current) => {
          const position = nextCardPosition(current.cards, "result");
          const card: CanvasCard = {
            id,
            role: "result",
            origin: "tool",
            name: input.name,
            url,
            assetKey,
            assetState: "ready",
            naturalWidth: width,
            naturalHeight: height,
            saveStatus: "local",
            x: position.x,
            y: position.y,
          };
          return {
            cards: normalizeCards([...current.cards, card]),
            selectedCardId: id,
          };
        });
        return id;
      },

      replaceCardImage: async (id, input) => {
        const target = get().cards.find((card) => card.id === id);
        if (!target || get().isCommittingMain) return false;

        const width = Math.max(1, Math.round(input.width));
        const height = Math.max(1, Math.round(input.height));
        set({ isCommittingMain: true });
        try {
          // Keep the first pre-edit snapshot so before/after survives a reload
          // for uploads and workflow images that have no gallery record.
          let originalAssetKey = target.originalAssetKey;
          if (!target.isEdited && !target.galleryNanoid) {
            const { corsProxy, corsProxyMode } = useConfigStore.getState();
            const sourceBlob = await cardSource.resolveCardBlob(
              target,
              corsProxy,
              corsProxyMode
            );
            if (sourceBlob) {
              const key = `card-${target.id}-original`;
              try {
                await putCanvasAsset(key, sourceBlob);
                originalAssetKey = key;
              } catch {
                // Comparison is optional; never block the edit.
              }
            }
          }

          // Versioned key: never overwrite the asset the undo snapshot points at.
          const assetKey = nextEditAssetKey(target.id);
          try {
            await putCanvasAsset(assetKey, input.blob);
          } catch {
            toast.warning(i18n.t("freeCanvas.cards.assetStoreFailed"), {
              id: "canvas-asset-failed",
            });
          }

          if (!get().cards.some((card) => card.id === id)) {
            void deleteCanvasAsset(assetKey).catch(() => undefined);
            return false;
          }

          const url = URL.createObjectURL(input.blob);
          get().pushHistory();
          set((current) => {
            if (!current.cards.some((card) => card.id === id)) {
              cardSource.revokeObjectUrl(url);
              return current;
            }
            return {
              cards: current.cards.map((card) =>
                card.id === id
                  ? {
                      ...card,
                      name: input.name || card.name,
                      url,
                      assetKey,
                      originalAssetKey,
                      originalUrl: card.originalUrl ?? card.url,
                      assetState: "ready",
                      naturalWidth: width,
                      naturalHeight: height,
                      isEdited: true,
                      saveStatus: "local",
                      saveError: undefined,
                    }
                  : card
              ),
              ...(input.clearMask ? RESET_MASK : {}),
              selectedCardId: id,
            };
          });
          return true;
        } finally {
          set({ isCommittingMain: false });
        }
      },

      syncResultSaveState: (result) => {
        // Only result/main cards own the generated blob. A reference card that
        // shares the nanoid keeps its own asset, so never update or clean it.
        const card = get().cards.find(
          (item) =>
            item.role !== "reference" &&
            (item.nanoid === result.nanoid ||
              item.galleryNanoid === result.nanoid)
        );
        if (!card) return;
        // An edited card is no longer the generation's bitmap, so queue save
        // state must not label it "saved" while the gallery holds the original.
        if (card.isEdited) return;

        if (result.gallerySaveStatus === "saved") {
          if (card.saveStatus === "saved" && card.galleryNanoid) return;
          const previousKey = card.assetKey;
          set((state) => ({
            cards: state.cards.map((item) =>
              item.id === card.id
                ? {
                    ...item,
                    saveStatus: "saved",
                    saveError: undefined,
                    galleryNanoid: result.nanoid,
                    assetKey: item.isEdited ? item.assetKey : undefined,
                    assetState: item.isEdited ? item.assetState : "gallery",
                  }
                : item
            ),
          }));
          if (previousKey && !card.isEdited) {
            void deleteCanvasAsset(previousKey).catch(() => undefined);
          }
        } else if (result.gallerySaveStatus === "failed") {
          if (card.saveStatus === "failed" && card.saveError) return;
          set((state) => ({
            cards: state.cards.map((item) =>
              item.id === card.id
                ? {
                    ...item,
                    saveStatus: "failed",
                    saveError: result.gallerySaveError,
                  }
                : item
            ),
          }));
        }
      },

      retrySaveCard: async (id) => {
        const card = get().cards.find((item) => item.id === id);
        if (!card) return false;
        if (card.saveStatus === "saved" && card.galleryNanoid) return true;

        const meta: ResultMeta | null = card.resultMeta
          ? card.resultMeta
          : card.nanoid
            ? {
                nanoid: card.nanoid,
                prompt: card.prompt ?? "",
                provider: "",
                model: "",
                size: "",
                resolution: "",
                generationTimeMs: 0,
                createdAt: Date.now(),
              }
            : null;

        if (!meta) {
          set((state) => ({
            cards: state.cards.map((item) =>
              item.id === id
                ? {
                    ...item,
                    saveStatus: "unavailable",
                    saveError: i18n.t("freeCanvas.cards.saveRetryNoSource"),
                  }
                : item
            ),
          }));
          return false;
        }

        set((state) => ({
          cards: state.cards.map((item) =>
            item.id === id
              ? { ...item, saveStatus: "saving", saveError: undefined }
              : item
          ),
        }));

        const { corsProxy, corsProxyMode } = useConfigStore.getState();
        let blob = await cardSource.resolveCardBlob(card, corsProxy, corsProxyMode);
        if (!blob && card.resultTaskId) {
          const task = useQueueStore
            .getState()
            .tasks.find((item) => item.id === card.resultTaskId);
          const taskResult = task?.result;
          blob =
            taskResult?.blob ??
            (taskResult && cardSource.isDataUrl(taskResult.url)
              ? dataUrlToBlob(taskResult.url)
              : null);
        }
        if (!blob) {
          set((state) => ({
            cards: state.cards.map((item) =>
              item.id === id
                ? {
                    ...item,
                    saveStatus: "unavailable",
                    saveError: i18n.t("freeCanvas.cards.saveRetryNoSource"),
                  }
                : item
            ),
          }));
          toast.error(i18n.t("freeCanvas.cards.saveRetryNoSource"));
          return false;
        }

        try {
          // An edited card must not overwrite the generation's gallery record:
          // save it as a new work and point the card at that record instead.
          const saveNanoid = card.isEdited ? generateNanoid(12) : meta.nanoid;
          await saveToHistory(
            {
              nanoid: saveNanoid,
              imageBlob: blob,
              // An edited copy is a new work and gets a new timestamp; a normal
              // manual save keeps the original generation time.
              createdAt: card.isEdited ? Date.now() : meta.createdAt,
              starred: false,
              prompt: meta.prompt,
              negativePrompt: meta.negativePrompt,
              provider: meta.provider,
              model: meta.model,
              size: meta.size,
              resolution: meta.resolution,
              seed: meta.seed,
              cfgScale: meta.cfgScale,
              steps: meta.steps,
              generationTimeMs: meta.generationTimeMs,
            },
            useConfigStore.getState().historyQuota
          );
          const previousKey = card.assetKey;
          const recoveredUrl = card.url || URL.createObjectURL(blob);
          set((state) => ({
            cards: state.cards.map((item) =>
              item.id === id
                ? {
                    ...item,
                    url: recoveredUrl,
                    saveStatus: "saved",
                    saveError: undefined,
                    galleryNanoid: saveNanoid,
                    assetKey: item.isEdited ? item.assetKey : undefined,
                    assetState: "gallery",
                  }
                : item
            ),
          }));
          if (previousKey && !card.isEdited) {
            void deleteCanvasAsset(previousKey).catch(() => undefined);
          }
          if (card.resultTaskId && !card.isEdited) {
            useQueueStore.setState((queue) => ({
              tasks: queue.tasks.map((task) =>
                task.id === card.resultTaskId && task.result
                  ? {
                      ...task,
                      result: {
                        ...task.result,
                        gallerySaveStatus: "saved",
                        gallerySaveError: undefined,
                      },
                    }
                  : task
              ),
            }));
          }
          toast.success(i18n.t("queue.toastSavedToGallery"));
          return true;
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          set((state) => ({
            cards: state.cards.map((item) =>
              item.id === id
                ? {
                    ...item,
                    saveStatus: "failed",
                    saveError: message,
                  }
                : item
            ),
          }));
          toast.error(
            i18n.t("freeCanvas.cards.saveRetryFailed", { message })
          );
          return false;
        }
      },

      setMainFromGallery: async (input) => {
        const state = get();
        if (state.isCommittingMain) return false;

        const existing = state.cards.find(
          (card) => card.galleryNanoid === input.nanoid && !card.isEdited
        );
        if (existing) {
          if (existing.role === "main") return true;
          return get().promoteToMain(existing.id, {
            discardMask: input.discardMask,
          });
        }

        if (
          state.maskStrokes.length > 0 &&
          !input.discardMask
        ) {
          toast.warning(i18n.t("freeCanvas.cards.discardMaskTitle"));
          return false;
        }

        set({ isCommittingMain: true });
        try {
          const mainAtStart = state.cards.find(
            (card) => card.role === "main"
          );

          const dimensions = await loadDimensionsSafe(input.blob);
          const url = URL.createObjectURL(input.blob);
          const id = `gallery-${input.nanoid}-${generateNanoid(4)}`;
          const latest = get().cards;
          const liveMain = mainAtStart
            ? latest.find((card) => card.id === mainAtStart.id)
            : undefined;
          const position = liveMain
            ? { x: liveMain.x, y: liveMain.y }
            : nextCardPosition(latest, "main");

          const card: CanvasCard = {
            id,
            role: "main",
            origin: "gallery",
            name: input.name,
            url,
            galleryNanoid: input.nanoid,
            assetState: "gallery",
            naturalWidth: dimensions.width,
            naturalHeight: dimensions.height,
            x: position.x,
            y: position.y,
            prompt: input.prompt,
          };

          const demoted = latest.map((previousCard) => {
            let next = previousCard;
            if (mainAtStart && previousCard.id === mainAtStart.id) {
              next = {
                ...next,
                role: demotedRole(next),
                refOrder:
                  demotedRole(next) === "reference"
                    ? nextRefOrder(latest)
                    : undefined,
              };
            }
            return next;
          });

          const nextCards = normalizeCards(
            settleMainCard([...demoted, card], card.id, mainAtStart?.id)
          );
          get().pushHistory();
          set({
            cards: nextCards,
            ...EMPTY_EDITING,
            activeTool: "select",
            selectedCardId: id,
            isCommittingMain: false,
          });
          toast.success(i18n.t("freeCanvas.cards.loadedAsMain"));
          return true;
        } catch (error) {
          toast.error(
            i18n.t("freeCanvas.cards.commitFailed", {
              message: error instanceof Error ? error.message : String(error),
            })
          );
          return false;
        } finally {
          set({ isCommittingMain: false });
        }
      },

      promoteToMain: async (id, options) => {
        const state = get();
        if (state.isCommittingMain) return false;
        const target = state.cards.find((card) => card.id === id);
        if (!target) return false;
        if (target.role === "main") return true;
        if (state.maskStrokes.length > 0 && !options?.discardMask) {
          toast.warning(i18n.t("freeCanvas.cards.discardMaskTitle"));
          return false;
        }

        set({ isCommittingMain: true });
        try {
          const mainAtStart = state.cards.find(
            (card) => card.role === "main"
          );

          const currentTarget = get().cards.find((card) => card.id === id);
          if (!currentTarget) return false;

          let targetRuntime: CanvasCard | null = null;
          if (
            currentTarget.assetState === "remote" ||
            currentTarget.assetState === "missing" ||
            !currentTarget.url
          ) {
            const localCard = await materializeLocalCard(currentTarget);
            if (!localCard.url || localCard.assetState === "missing") {
              toast.error(i18n.t("freeCanvas.cards.remoteEditUnavailable"));
              return false;
            }
            targetRuntime = localCard;
          }

          const latest = get().cards;
          if (!latest.some((card) => card.id === id)) return false;

          const nextCards = latest.map((card) => {
            let next = card;
            if (mainAtStart && card.id === mainAtStart.id) {
              next = {
                ...next,
                role: demotedRole(next),
                refOrder:
                  demotedRole(next) === "reference"
                    ? nextRefOrder(latest)
                    : undefined,
              };
            }
            if (card.id === id) {
              next = { ...next, role: "main", refOrder: undefined };
              if (targetRuntime) {
                next = mergeRuntimeCard(next, targetRuntime);
              }
            }
            return next;
          });

          get().pushHistory();
          set({
            cards: normalizeCards(
              settleMainCard(nextCards, id, mainAtStart?.id)
            ),
            ...EMPTY_EDITING,
            activeTool: "select",
            selectedCardId: id,
            isCommittingMain: false,
          });
          toast.success(i18n.t("freeCanvas.cards.movedToMain"));
          return true;
        } catch (error) {
          toast.error(
            i18n.t("freeCanvas.cards.commitFailed", {
              message: error instanceof Error ? error.message : String(error),
            })
          );
          return false;
        } finally {
          set({ isCommittingMain: false });
        }
      },

      clearMain: async (options) => {
        const state = get();
        if (state.isCommittingMain) return false;
        const main = state.cards.find((card) => card.role === "main");
        if (!main) return true;
        if (state.maskStrokes.length > 0 && !options?.discardMask) {
          toast.warning(i18n.t("freeCanvas.cards.discardMaskTitle"));
          return false;
        }

        set({ isCommittingMain: true });
        try {
          const latest = get().cards;
          const nextCards = latest.map((card) => {
            let next = card;
            if (card.id === main.id) {
              next = {
                ...next,
                role: demotedRole(next),
                refOrder:
                  demotedRole(next) === "reference"
                    ? nextRefOrder(latest)
                    : undefined,
              };
            }
            return next;
          });
          get().pushHistory();
          set({
            cards: normalizeCards(nextCards),
            ...EMPTY_EDITING,
            activeTool: "select",
            selectedCardId: null,
            isCommittingMain: false,
          });
          toast.success(i18n.t("freeCanvas.cards.clearedMain"));
          return true;
        } catch (error) {
          toast.error(
            i18n.t("freeCanvas.cards.commitFailed", {
              message: error instanceof Error ? error.message : String(error),
            })
          );
          return false;
        } finally {
          set({ isCommittingMain: false });
        }
      },

      selectCard: (id) => {
        const card = id ? get().cards.find((item) => item.id === id) : null;
        set({ selectedCardId: card ? card.id : null });
      },

      moveCard: (id, x, y) => {
        const card = get().cards.find((item) => item.id === id);
        if (!card) return;
        const nextX = Math.round(x);
        const nextY = Math.round(y);
        if (card.x === nextX && card.y === nextY) return;
        get().pushHistory();
        set((state) => ({
          cards: state.cards.map((item) =>
            item.id === id ? { ...item, x: nextX, y: nextY } : item
          ),
        }));
      },

      resizeCard: (id, width) => {
        const card = get().cards.find((item) => item.id === id);
        if (!card) return;
        const nextWidth = clampCardWidth(width, card.role);
        const current = card.width ?? CARD_WORLD_WIDTH[card.role];
        if (nextWidth === current) return;
        get().pushHistory();
        set((state) => ({
          cards: state.cards.map((item) =>
            item.id === id ? { ...item, width: nextWidth } : item
          ),
        }));
      },

      setCardRole: (id, role) => {
        const card = get().cards.find((item) => item.id === id);
        if (!card || card.role === role) return;
        if (card.role !== "reference" && card.role !== "free") return;
        get().pushHistory();
        set((state) => {
          const without = state.cards.filter((item) => item.id !== id);
          const position = nextCardPosition(without, role);
          return {
            cards: normalizeCards([
              ...without,
              {
                ...card,
                role,
                refOrder:
                  role === "reference" ? nextRefOrder(without) : undefined,
                ...position,
              },
            ]),
          };
        });
      },

      updateCard: (id, patch) =>
        set((state) => ({
          cards: state.cards.map((card) =>
            card.id === id ? { ...card, ...patch } : card
          ),
        })),

      updateCardSize: (id, width, height) =>
        set((state) => ({
          cards: state.cards.map((card) =>
            card.id === id &&
            (card.naturalWidth !== width || card.naturalHeight !== height)
              ? { ...card, naturalWidth: width, naturalHeight: height }
              : card
          ),
        })),

      removeCard: (id) => {
        const card = get().cards.find((item) => item.id === id);
        if (!card || card.role === "main") return null;
        get().pushHistory();
        const dismissedNanoid =
          card.role === "result" && card.nanoid ? [card.nanoid] : [];
        set((state) => ({
          cards: normalizeCards(
            state.cards.filter((item) => item.id !== id)
          ),
          selectedCardId:
            state.selectedCardId === id ? null : state.selectedCardId,
          dismissedResultNanoids: addDismissedNanoids(
            state.dismissedResultNanoids,
            dismissedNanoid
          ),
        }));
        cardSource.revokeObjectUrl(card.url);
        if (card.originalUrl && card.originalUrl !== card.url) {
          cardSource.revokeObjectUrl(card.originalUrl);
        }
        return card;
      },

      restoreCard: (card) => {
        set((state) => {
          if (state.cards.some((item) => item.id === card.id)) return state;
          const hasMain = state.cards.some((item) => item.role === "main");
          const restored: CanvasCard = {
            ...card,
            role:
              card.role === "main" && hasMain
                ? demotedRole(card)
                : card.role,
            url: cardSource.isHttpUrl(card.url) ? card.url : "",
            originalUrl: cardSource.isBlobUrl(card.originalUrl)
              ? undefined
              : card.originalUrl,
            assetState: cardSource.isHttpUrl(card.url)
              ? "remote"
              : "loading",
          };
          return {
            cards: normalizeCards([...state.cards, restored]),
            selectedCardId: restored.id,
            // An explicit restore also un-dismisses the result, otherwise the
            // next ingestion pass would treat it as user-deleted again.
            dismissedResultNanoids: restored.nanoid
              ? state.dismissedResultNanoids.filter(
                  (id) => id !== restored.nanoid
                )
              : state.dismissedResultNanoids,
          };
        });
        void get().rehydrateCard(card.id);
      },

      rehydrateCard: async (id) => {
        const card = get().cards.find((item) => item.id === id);
        if (!card) return false;
        if (cardSource.isHttpUrl(card.url) && card.assetState === "remote") {
          return true;
        }
        const localCard = await materializeLocalCard(card);
        // An undo can resurrect a card whose compare-original blob URL was
        // revoked on removal; rebuild it from the stored pre-edit asset.
        let originalUrl = localCard.originalUrl;
        if (localCard.originalAssetKey && !cardSource.isHttpUrl(originalUrl)) {
          try {
            const original = await getCanvasAsset(localCard.originalAssetKey);
            if (original) {
              const restoredOriginalUrl = URL.createObjectURL(original);
              if (
                originalUrl &&
                originalUrl !== restoredOriginalUrl &&
                cardSource.isBlobUrl(originalUrl)
              ) {
                cardSource.revokeObjectUrl(originalUrl);
              }
              originalUrl = restoredOriginalUrl;
            }
          } catch {
            // Comparison is optional; never block the card from coming back.
          }
        }
        const ok = Boolean(localCard.url);
        set((state) => ({
          cards: state.cards.map((item) =>
            item.id === id
              ? {
                  // Merge asset fields only: a drag, resize or rename that
                  // happened while the IndexedDB read was in flight must
                  // survive.
                  ...item,
                  url: localCard.url,
                  assetKey: localCard.assetKey,
                  assetState: localCard.assetState,
                  naturalWidth: localCard.naturalWidth ?? item.naturalWidth,
                  naturalHeight: localCard.naturalHeight ?? item.naturalHeight,
                  galleryNanoid: localCard.galleryNanoid ?? item.galleryNanoid,
                  originalUrl,
                }
              : item
          ),
        }));
        return ok;
      },

      moveReference: (id, direction) => {
        const cardsSnapshot = get().cards;
        const refsSnapshot = sortReferences(cardsSnapshot);
        const indexSnapshot = refsSnapshot.findIndex((card) => card.id === id);
        const targetIndexSnapshot = indexSnapshot + direction;
        if (
          indexSnapshot < 0 ||
          targetIndexSnapshot < 0 ||
          targetIndexSnapshot >= refsSnapshot.length
        ) {
          return;
        }
        get().pushHistory();
        set((state) => {
          const refs = sortReferences(state.cards);
          const index = refs.findIndex((card) => card.id === id);
          const targetIndex = index + direction;
          if (index < 0 || targetIndex < 0 || targetIndex >= refs.length) {
            return state;
          }
          const currentOrder = refs[index].refOrder ?? index;
          const targetOrder = refs[targetIndex].refOrder ?? targetIndex;
          const nextCards = state.cards.map((card) => {
            if (card.id === refs[index].id) {
              return { ...card, refOrder: targetOrder };
            }
            if (card.id === refs[targetIndex].id) {
              return { ...card, refOrder: currentOrder };
            }
            return card;
          });
          return { cards: normalizeReferenceOrder(nextCards) };
        });
      },

      markInitialFitDone: () => set({ initialFitDone: true }),

      arrangeCards: () => {
        if (get().cards.length === 0) return;
        get().pushHistory();
        set((state) => ({
          cards: normalizeCards(layoutCards(state.cards)),
        }));
      },

      spreadResults: () => {
        const state = get();
        const results = state.cards.filter((card) => card.role === "result");
        if (results.length === 0) return [];
        const width = 360;
        const gap = 24;
        const main = state.cards.find((card) => card.role === "main");
        const startX = main ? main.x : 0;
        const startY = main ? main.y + cardWorldHeight(main) + 56 : 0;
        const positions = new Map<string, { x: number; y: number }>();
        results.forEach((card, index) => {
          positions.set(card.id, {
            x: Math.round(startX + index * (width + gap)),
            y: Math.round(startY),
          });
        });
        get().pushHistory();
        set((current) => ({
          cards: current.cards.map((card) => {
            const position = positions.get(card.id);
            return position ? { ...card, ...position, width } : card;
          }),
        }));
        return results.map((card) => card.id);
      },

      hydrateAssets: async () => {
        if (get().isHydrated || hydrationInFlight) return;
        hydrationInFlight = true;
        const state = get();
        const cards = await Promise.all(
          state.cards.map(async (card) => {
            if (card.url && cardSource.isBlobUrl(card.url)) {
              return card;
            }

            if (card.url && cardSource.isDataUrl(card.url)) {
              try {
                const blob = dataUrlToBlob(card.url);
                const assetKey = card.assetKey ?? `card-${card.id}`;
                await putCanvasAsset(assetKey, blob);
                const dimensions = await loadDimensionsSafe(blob);
                return {
                  ...card,
                  url: URL.createObjectURL(blob),
                  assetKey,
                  assetState: "ready" as CanvasAssetState,
                  naturalWidth: card.naturalWidth ?? dimensions.width,
                  naturalHeight: card.naturalHeight ?? dimensions.height,
                };
              } catch {
                // keep the data URL as a runtime fallback
                return card;
              }
            }

            if (card.assetKey) {
              try {
                const blob = await getCanvasAsset(card.assetKey);
                if (blob) {
                  const dimensions = await loadDimensionsSafe(blob);
                  let originalUrl = card.originalUrl;
                  if (!originalUrl && card.originalAssetKey) {
                    try {
                      const original = await getCanvasAsset(
                        card.originalAssetKey
                      );
                      if (original) {
                        originalUrl = URL.createObjectURL(original);
                      }
                    } catch {
                      // compare is optional
                    }
                  }
                  if (
                    card.isEdited &&
                    card.galleryNanoid &&
                    !originalUrl &&
                    !card.compareUrl
                  ) {
                    try {
                      const original = await getHistoryRecordByNanoid(
                        card.galleryNanoid
                      );
                      if (original?.imageBlob) {
                        originalUrl = URL.createObjectURL(original.imageBlob);
                      }
                    } catch {
                      // compare is optional
                    }
                  }
                  return {
                    ...card,
                    url: URL.createObjectURL(blob),
                    originalUrl,
                    assetState: "ready" as CanvasAssetState,
                    naturalWidth: card.naturalWidth ?? dimensions.width,
                    naturalHeight: card.naturalHeight ?? dimensions.height,
                  };
                }
              } catch {
                // fall through
              }
            }

            if (card.galleryNanoid && !card.isEdited) {
              try {
                const record = await getHistoryRecordByNanoid(
                  card.galleryNanoid
                );
                if (record?.imageBlob) {
                  const dimensions = await loadDimensionsSafe(
                    record.imageBlob
                  );
                  return {
                    ...card,
                    url: URL.createObjectURL(record.imageBlob),
                    assetState: "gallery" as CanvasAssetState,
                    naturalWidth: card.naturalWidth ?? dimensions.width,
                    naturalHeight: card.naturalHeight ?? dimensions.height,
                  };
                }
              } catch {
                // fall through
              }
            }

            if (!card.isEdited && cardSource.isHttpUrl(card.url)) {
              return {
                ...card,
                assetState: "remote" as CanvasAssetState,
              };
            }

            return {
              ...card,
              url: "",
              assetState: "missing" as CanvasAssetState,
            };
          })
        );

        // Simple-mode images are stored in the same asset store and restore the
        // same way; an entry whose asset is gone stays visible as missing
        // instead of being silently dropped.
        const hydratedSimpleImages = await Promise.all(
          state.simpleImages.map(async (image) => {
            if (image.url && cardSource.isBlobUrl(image.url)) return image;
            if (image.assetKey) {
              try {
                const blob = await getCanvasAsset(image.assetKey);
                if (blob) {
                  return {
                    ...image,
                    url: URL.createObjectURL(blob),
                    missing: false,
                  };
                }
              } catch {
                // fall through to the missing state
              }
            }
            return { ...image, url: "", missing: true };
          })
        );

        // Merge hydration results into the *current* card list so an upload
        // that happens while IndexedDB is still resolving is not overwritten.
        const hydratedById = new Map(cards.map((card) => [card.id, card]));
        const hydratedSimpleById = new Map(
          hydratedSimpleImages.map((image) => [image.id, image])
        );
        let finalCards: CanvasCard[] = [];
        let finalSimpleImages: SimpleImage[] = [];
        set((current) => {
          finalCards = normalizeCards(
            current.cards.map((card) => {
              const hydrated = hydratedById.get(card.id);
              if (!hydrated) return card;
              return {
                ...card,
                url: hydrated.url,
                assetState: hydrated.assetState,
                // A data-URL card without a key gets one during hydration; keep
                // it so the next reload resolves the stored asset instead of
                // reporting the card as missing.
                assetKey: hydrated.assetKey ?? card.assetKey,
                originalUrl: hydrated.originalUrl ?? card.originalUrl,
                naturalWidth: card.naturalWidth ?? hydrated.naturalWidth,
                naturalHeight: card.naturalHeight ?? hydrated.naturalHeight,
              };
            })
          );
          finalSimpleImages = reindexSimpleImages(
            current.simpleImages.map((image) => {
              const hydrated = hydratedSimpleById.get(image.id);
              if (!hydrated) return image;
              return {
                ...image,
                url: image.url || hydrated.url,
                missing: hydrated.missing,
              };
            })
          );
          return {
            cards: finalCards,
            simpleImages: finalSimpleImages,
            isHydrated: true,
          };
        });

        const validKeys = [
          ...finalCards.flatMap((card) => [
            card.assetKey,
            card.originalAssetKey,
          ]),
          ...finalSimpleImages.map((image) => image.assetKey),
        ].filter((key): key is string => Boolean(key));
        try {
          await pruneCanvasAssets(validKeys);
        } catch {
          // Quota / upgrade trouble must not block the canvas.
        } finally {
          hydrationInFlight = false;
        }
      },

      exportMainForRequest: async () => {
        const state = get();
        const main = state.cards.find((card) => card.role === "main");
        if (!main) return null;
        const { corsProxy, corsProxyMode } = useConfigStore.getState();

        try {
          // Editing is baked into the card's bitmap, so the request uses the
          // stored asset as-is; only the inpaint mask is generated on the fly.
          const baseUrl = await cardSource.resolveCardDataUrl(
            main,
            corsProxy,
            corsProxyMode
          );
          if (!baseUrl) {
            throw new Error(i18n.t("freeCanvas.cards.mainSourceUnavailable"));
          }

          let maskUrl: string | undefined;
          if (state.maskStrokes.length > 0) {
            const sourceBlob = await cardSource.resolveCardBlob(
              main,
              corsProxy,
              corsProxyMode
            );
            if (!sourceBlob) {
              throw new Error(i18n.t("freeCanvas.cards.mainSourceUnavailable"));
            }
            maskUrl = await composeMaskImage(
              sourceBlob,
              state.maskStrokes,
              state.isMaskInverted
            );
          }

          return { baseUrl, maskUrl };
        } catch (error) {
          toast.error(
            i18n.t("freeCanvas.cards.exportFailed", {
              message:
                error instanceof Error ? error.message : String(error),
            })
          );
          return null;
        }
      },

      exportMainImage: async () => {
        const exported = await get().exportMainForRequest();
        return exported?.baseUrl ?? null;
      },

      activeReferenceUrls: async () => {
        const state = get();
        const refs = sortReferences(state.cards).slice(
          0,
          MAX_REFERENCE_PARTICIPATION
        );
        const { corsProxy, corsProxyMode } = useConfigStore.getState();
        const urls: string[] = [];
        for (const ref of refs) {
          try {
            const url = await cardSource.resolveCardDataUrl(ref, corsProxy, corsProxyMode);
            if (url && !urls.includes(url)) urls.push(url);
          } catch {
            // Skip unreadable references; the UI already marks missing cards.
          }
        }
        return urls;
      },

      setActiveTool: (activeTool) => set({ activeTool }),
      setMaskBrushSize: (maskBrushSize) => set({ maskBrushSize }),
      setIsMaskEraser: (isMaskEraser) => set({ isMaskEraser }),
      setMaskStrokes: (action) => {
        const prev = get().maskStrokes;
        const next = typeof action === "function" ? action(prev) : action;
        if (next === prev) return;
        get().pushHistory();
        set({ maskStrokes: next });
      },
      setIsMaskInverted: (isMaskInverted) => set({ isMaskInverted }),
      clearMask: () => {
        if (get().maskStrokes.length === 0 && !get().isMaskInverted) return;
        get().pushHistory();
        set({ maskStrokes: [], isMaskInverted: false });
      },

      setZoom: (action) =>
        set((state) => {
          const next = typeof action === "function" ? action(state.zoom) : action;
          return { zoom: Math.max(0.1, Math.min(Number(next.toFixed(3)), 5)) };
        }),

      setPan: (action) =>
        set((state) => ({
          pan: typeof action === "function" ? action(state.pan) : action,
        })),

      setIsBarCollapsed: (action) =>
        set((state) => ({
          isBarCollapsed:
            typeof action === "function"
              ? action(state.isBarCollapsed)
              : action,
        })),

      resetView: () => set({ zoom: 1, pan: { x: 0, y: 0 } }),
    }),
    {
      name: FREE_CANVAS_STORAGE_KEY,
      version: 2,
      storage: cardStorage,
      partialize: (state) =>
        ({
          cards: state.cards.map(stripRuntimeUrls),
          // Metadata only: blobs live in canvasAssets, never in localStorage.
          simpleImages: state.simpleImages.map((image) => ({
            id: image.id,
            name: image.name,
            url: "",
            assetKey: image.assetKey,
            order: image.order,
            persist: image.persist,
          })),
          // Remember user-removed results so ingestion never resurrects them,
          // even across a reload while the queue still holds the task.
          dismissedResultNanoids: state.dismissedResultNanoids,
        }) as unknown as FreeCanvasState,
      merge: (persisted, current) => {
        const saved = persisted as
          | {
              cards?: CanvasCard[];
              simpleImages?: SimpleImage[];
              dismissedResultNanoids?: unknown;
            }
          | undefined;
        if (!saved) return current;
        return {
          ...current,
          cards: normalizeCards(
            (saved.cards ?? []).map((card) => ({
              ...card,
              x: typeof card.x === "number" ? card.x : 0,
              y: typeof card.y === "number" ? card.y : 0,
              assetState: card.assetState ?? "missing",
              url: card.url ?? "",
            }))
          ),
          simpleImages: sortSimpleImages(
            (saved.simpleImages ?? []).map((image) => ({
              ...image,
              url: "",
              missing: undefined,
              order: typeof image.order === "number" ? image.order : 0,
            }))
          ),
          dismissedResultNanoids: Array.isArray(saved.dismissedResultNanoids)
            ? saved.dismissedResultNanoids
                .filter((id): id is string => typeof id === "string")
                .slice(-DISMISSED_RESULT_LIMIT)
            : current.dismissedResultNanoids,
        };
      },
      migrate: (persisted, version) => {
        if (version < 1) {
          const legacy = persisted as
            | { cards?: CanvasCard[]; activeArtwork?: { url?: string; name?: string } }
            | undefined;
          if (!legacy?.cards && legacy?.activeArtwork?.url) {
            return {
              cards: [
                {
                  id: `legacy-${Date.now()}`,
                  role: "main",
                  origin: "upload",
                  name: legacy.activeArtwork.name ?? "",
                  url: legacy.activeArtwork.url,
                  x: 0,
                  y: 0,
                  assetState: "missing",
                },
              ],
            };
          }
        }
        // v2 renamed the canvas-only card role from "compare" to "free".
        if (version < 2) {
          const legacy = persisted as { cards?: CanvasCard[] } | undefined;
          if (Array.isArray(legacy?.cards)) {
            return {
              ...legacy,
              cards: legacy.cards.map((card) =>
                (card.role as string) === "compare"
                  ? { ...card, role: "free" }
                  : card
              ),
            } as unknown as FreeCanvasState;
          }
        }
        return persisted as FreeCanvasState;
      },
    }
  )
);

/** Convenience selector used by the UI; not reactive on its own. */
export function getMainCard(cards: CanvasCard[]): CanvasCard | undefined {
  return cards.find((card) => card.role === "main");
}

export function getActiveReferences(cards: CanvasCard[]): CanvasCard[] {
  return sortReferences(cards).slice(0, MAX_REFERENCE_PARTICIPATION);
}

export function getReferenceCards(cards: CanvasCard[]): CanvasCard[] {
  return sortReferences(cards);
}

if (typeof window !== "undefined") {
  // Undo history is session-only, so at unload nothing can reference the
  // assets of cards removed during this session. Drop them (and anything past
  // the cap) instead of leaving every deleted upload/result in IndexedDB.
  window.addEventListener("pagehide", () => {
    try {
      const keys = useFreeCanvasStore
        .getState()
        .cards.flatMap((card) => [card.assetKey, card.originalAssetKey])
        .filter((key): key is string => Boolean(key));
      void pruneCanvasAssets(keys, 0).catch(() => undefined);
    } catch {
      // Cleanup must never block unloading.
    }
  });
}

