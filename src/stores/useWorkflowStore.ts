import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { toast } from "sonner";
import { generateNanoid } from "../utils/nanoid";
import { extractErrorMessage } from "../utils/error";
import { i18n } from "@/i18n";
import { useConfigStore } from "./useConfigStore";
import { dispatchGenerate } from "../services/providers/dispatcher";
import { applyServerImageOverlay, applyServerLlmOverlay } from "../services/effectiveConfig";
import { saveToHistory } from "../services/historyDb";
import {
  getCanvasAsset,
  listCanvasAssetKeys,
  pruneCanvasAssets,
  putCanvasAsset,
} from "../services/canvasAssetDb";
import { dataUrlToBlob, fetchAsBlob } from "../utils/file";
import { imageToPrompt, polishPrompt } from "../services/llmAssistant";
import { isWorkflowConnectionTypeCompatible } from "../components/Workflow/nodeCatalog";

export type WorkflowNodeType = "prompt" | "image" | "generator" | "preview" | "assistant";
export type WorkflowPortType = "text" | "image";

export type WorkflowNodeData = {
  // Prompt
  promptText?: string;
  negativePrompt?: string;

  // Image Input
  imageUrl?: string;
  /** IndexedDB key for `imageUrl`; persisted instead of a base64 payload. */
  imageAssetKey?: string;
  imageName?: string;
  imageDimensions?: { width: number; height: number };

  // Generator
  providerId?: string;
  model?: string;
  size?: string;
  resolution?: string;
  cfgScale?: number;
  steps?: number;
  seed?: number;
  status?: "idle" | "running" | "done" | "error";
  progress?: number;
  statusText?: string;
  outputImageUrl?: string;
  /** IndexedDB key for `outputImageUrl` when the provider returned base64. */
  outputAssetKey?: string;
  gallerySaveStatus?: "saving" | "saved" | "failed";
  gallerySaveError?: string;
  galleryNanoid?: string;
  galleryCreatedAt?: number;
  error?: string;

  // Preview
  previewUrl?: string;
  compareUrl?: string;

  // Generator result metadata (runtime only)
  generationTimeMs?: number;

  // AI Assistant (image-to-text / text-to-text)
  assistantMode?: "enhance" | "vision" | "translate";
  inputPrompt?: string;
  inputImageUrl?: string;
  outputPrompt?: string;
};

export type WorkflowNode = {
  id: string;
  type: WorkflowNodeType;
  x: number;
  y: number;
  width?: number;
  title: string;
  data: WorkflowNodeData;
};

export type WorkflowEdge = {
  id: string;
  fromNodeId: string;
  fromPort: string;
  toNodeId: string;
  toPort: string;
  portType: WorkflowPortType;
};

export type ConnectingDraft = {
  fromNodeId: string;
  fromPort: string;
  portType: WorkflowPortType;
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
};

/**
 * Node data written by execution / gallery saving. These must never take part
 * in undo: a snapshot is captured *before* a drag or a manual edit, and if the
 * runtime fields were stripped at restore time, an undo that lands after a
 * generation finished would wipe the freshly generated image back to empty.
 */
const RUNTIME_NODE_KEYS = [
  "status",
  "progress",
  "statusText",
  "outputImageUrl",
  "gallerySaveStatus",
  "gallerySaveError",
  "galleryNanoid",
  "galleryCreatedAt",
  "error",
  "previewUrl",
  "compareUrl",
  "outputPrompt",
  "generationTimeMs",
] as const satisfies readonly (keyof WorkflowNodeData)[];

const RUNTIME_KEY_SET = new Set<string>(RUNTIME_NODE_KEYS);

/** Structure + user-editable fields only; runtime results stay out. */
export type WorkflowSnapshot = {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
};

export const WORKFLOW_HISTORY_LIMIT = 50;

function stripRuntimeData(data: WorkflowNodeData): WorkflowNodeData {
  const copy: WorkflowNodeData = { ...data };
  for (const key of RUNTIME_NODE_KEYS) {
    delete copy[key];
  }
  return copy;
}

function pickRuntimeData(data: WorkflowNodeData): WorkflowNodeData {
  const runtime: WorkflowNodeData = {};
  for (const key of RUNTIME_NODE_KEYS) {
    if (data[key] !== undefined) {
      (runtime as Record<string, unknown>)[key] = data[key];
    }
  }
  return runtime;
}

function copyEdges(edges: WorkflowEdge[]): WorkflowEdge[] {
  return edges.map((edge) => ({ ...edge }));
}

function buildSnapshot(
  nodes: WorkflowNode[],
  edges: WorkflowEdge[]
): WorkflowSnapshot {
  return {
    nodes: nodes.map((node) => ({
      ...node,
      data: stripRuntimeData(node.data),
    })),
    edges: copyEdges(edges),
  };
}

/**
 * Restore a snapshot while carrying the current runtime fields of nodes that
 * still exist. Undoing a prompt edit or a drag therefore keeps the generated
 * image; a node deleted and then restored comes back without its result
 * (documented in the shortcuts help).
 */
function restoreSnapshot(
  snapshot: WorkflowSnapshot,
  currentNodes: WorkflowNode[]
): WorkflowNode[] {
  const runtimeById = new Map(
    currentNodes.map((node) => [node.id, pickRuntimeData(node.data)])
  );
  return snapshot.nodes.map((node) => ({
    ...node,
    data: { ...node.data, ...runtimeById.get(node.id) },
  }));
}

function isRuntimeOnlyPatch(patch: Partial<WorkflowNodeData>): boolean {
  const keys = Object.keys(patch).filter(
    (key) => patch[key as keyof WorkflowNodeData] !== undefined
  );
  return keys.length > 0 && keys.every((key) => RUNTIME_KEY_SET.has(key));
}

export type WorkflowGraphState = {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  viewport: { x: number; y: number; zoom: number };
  selectedNodeId: string | null;
  selectedEdgeId: string | null;
  connectingDraft: ConnectingDraft | null;

  /** Session-only undo stack (structure + user-editable fields). */
  past: WorkflowSnapshot[];
  future: WorkflowSnapshot[];

  // Actions
  captureSnapshot: () => WorkflowSnapshot;
  pushHistory: (
    tag?: string,
    options?: { coalesceMs?: number }
  ) => void;
  /** Push an already-captured snapshot (drag start → drag stop). */
  pushSnapshot: (snapshot: WorkflowSnapshot) => void;
  undo: () => boolean;
  redo: () => boolean;
  clearGraph: () => { nodes: number; edges: number };

  addNode: (type: WorkflowNodeType, pos?: { x: number; y: number }, initialData?: WorkflowNodeData) => string;
  removeNode: (id: string) => void;
  duplicateNode: (id: string) => string | null;
  updateNodeData: (
    id: string,
    patch: Partial<WorkflowNodeData>,
    options?: { recordHistory?: boolean }
  ) => void;
  setNodePosition: (id: string, x: number, y: number) => void;
  moveNode: (id: string, dx: number, dy: number) => void;
  setSelectedNodeId: (id: string | null) => void;

  // Edges
  addEdge: (edge: Omit<WorkflowEdge, "id">) => void;
  removeEdge: (id: string) => void;
  setSelectedEdgeId: (id: string | null) => void;

  // Connecting Draft
  startConnecting: (fromNodeId: string, fromPort: string, portType: WorkflowPortType, startX: number, startY: number) => void;
  updateConnecting: (currentX: number, currentY: number) => void;
  endConnecting: (toNodeId?: string, toPort?: string) => void;

  // Viewport
  setViewport: (patch: Partial<{ x: number; y: number; zoom: number }>) => void;
  resetViewport: () => void;

  // Execution
  executeAssistantNode: (nodeId: string) => Promise<void>;
  executeGeneratorNode: (nodeId: string) => Promise<void>;
  saveNodeResultToGallery: (nodeId: string) => Promise<void>;
  executeAllGenerators: () => Promise<void>;
  /** True while a batch run is in progress; per-node buttons stay disabled. */
  batchRunning: boolean;
  /** Abort one in-flight node request (no Stop control existed before). */
  stopNode: (nodeId: string) => void;
  /**
   * Resolve persisted image asset keys to session object URLs, migrate legacy
   * base64 node data into IndexedDB, and prune orphaned workflow assets.
   */
  hydrateAssets: () => Promise<void>;
  /** Put image bytes in IndexedDB, then point the node at the object URL. */
  importImageData: (input: {
    nodeId: string;
    dataUrl: string;
    imageName?: string;
    width?: number;
    height?: number;
  }) => Promise<boolean>;
  resetToDefaultGraph: () => void;

  // Import / Export of the whole node configuration
  exportGraph: () => string;
  importGraph: (jsonText: string) => { nodes: number; edges: number };
};

const DEFAULT_STARTER_NODES: WorkflowNode[] = [
  {
    id: "node-prompt-1",
    type: "prompt",
    x: 80,
    y: 120,
    width: 320,
    title: i18n.t("workflowStore.nodePrompt"),
    data: {
      promptText: "",
    },
  },
  {
    id: "node-image-1",
    type: "image",
    x: 80,
    y: 450,
    width: 320,
    title: i18n.t("workflowStore.nodeImageOptional"),
    data: {
      imageUrl: "",
    },
  },
  {
    id: "node-gen-1",
    type: "generator",
    x: 480,
    y: 160,
    width: 340,
    title: i18n.t("workflowStore.nodeGenerator"),
    data: {
      providerId: "openai",
      size: "16:9",
      resolution: "1k",
      status: "idle",
      progress: 0,
    },
  },
  {
    id: "node-preview-1",
    type: "preview",
    x: 900,
    y: 160,
    width: 360,
    title: i18n.t("workflowStore.nodePreviewHiFi"),
    data: {},
  },
];

const DEFAULT_STARTER_EDGES: WorkflowEdge[] = [
  {
    id: "edge-prompt-gen",
    fromNodeId: "node-prompt-1",
    fromPort: "output",
    toNodeId: "node-gen-1",
    toPort: "prompt",
    portType: "text",
  },
  {
    id: "edge-image-gen",
    fromNodeId: "node-image-1",
    fromPort: "output",
    toNodeId: "node-gen-1",
    toPort: "image",
    portType: "image",
  },
  {
    id: "edge-gen-prev",
    fromNodeId: "node-gen-1",
    fromPort: "output",
    toNodeId: "node-preview-1",
    toPort: "image",
    portType: "image",
  },
];

const WORKFLOW_PERSIST_KEY = "universal-playground-workflow";
const LEGACY_WORKFLOW_PERSIST_KEY = "universal-playground-flow-graph";

/**
 * One-time migration of the persisted graph from the old "flow graph" key.
 * The state shape is unchanged in this step, so the raw blob can be copied as-is.
 * The legacy key is only read when the new one is absent, so a second tab never
 * overwrites a newer snapshot with an older one.
 */
function migrateLegacyPersistedGraph() {
  if (typeof window === "undefined") return;
  try {
    const legacy = window.localStorage.getItem(LEGACY_WORKFLOW_PERSIST_KEY);
    if (!legacy) return;
    if (!window.localStorage.getItem(WORKFLOW_PERSIST_KEY)) {
      window.localStorage.setItem(WORKFLOW_PERSIST_KEY, legacy);
    }
    window.localStorage.removeItem(LEGACY_WORKFLOW_PERSIST_KEY);
  } catch {
    // Storage unavailable (private mode / quota): fall back to the defaults.
  }
}

migrateLegacyPersistedGraph();

/**
 * Coalescing window for text-field edits. Consecutive `updateNodeData` calls on
 * the same node field within this window collapse into one undo entry, so
 * typing a prompt is one undo away instead of one-per-keystroke.
 */
const NODE_EDIT_COALESCE_MS = 600;
let lastHistoryTag: string | null = null;
let lastHistoryAt = 0;

/**
 * A second "render all" (button double-click, mod+enter mashing) must not start
 * a parallel loop: both loops would skip nodes the other already marked
 * running, then revisit them after they finish and fire duplicate paid calls.
 */
let executeAllInFlight = false;

/**
 * Nodes with a request genuinely in flight. Node status alone cannot be used:
 * it is persisted, so a reload mid-generation leaves a stale "running" that
 * would otherwise block re-running the node forever.
 */
const inFlightExecution = new Set<string>();

/**
 * Per-node abort controllers, kept outside reactive state (same pattern as the
 * generation queue). Without them a stalled assistant/generator request left a
 * node "running" forever and permanently disabled "render all".
 */
const abortControllers = new Map<string, AbortController>();
let workflowAssetsHydrated = false;

const WORKFLOW_ASSET_PREFIX = "workflow-";

/**
 * zustand persist calls `storage.setItem` synchronously inside `set()`, with no
 * try/catch. A `QuotaExceededError` therefore escapes the store action: a
 * successful paid generation was reported as failed, its gallery save skipped,
 * and every later graph edit threw. Swallow the write and surface it instead.
 */
const guardedWorkflowStorage: Storage =
  typeof window !== "undefined"
    ? {
        get length() {
          return window.localStorage.length;
        },
        clear: () => window.localStorage.clear(),
        getItem: (key) => window.localStorage.getItem(key),
        key: (index) => window.localStorage.key(index),
        removeItem: (key) => window.localStorage.removeItem(key),
        setItem: (key, value) => {
          try {
            window.localStorage.setItem(key, value);
          } catch {
            toast.error(i18n.t("workflowStore.toastPersistFailed"), {
              id: "workflow-persist-failed",
              duration: 8000,
            });
          }
        },
      }
    : ({} as Storage);

/**
 * Move image bytes into IndexedDB and return a session object URL.
 *
 * Workflow node data is persisted to localStorage verbatim, so a single
 * base64 upload used to fill the ~5 MB origin quota. After that every store
 * write threw synchronously out of `set()`: a completed (paid) generation was
 * reported as failed, its gallery save was skipped, and canvas edits stopped
 * persisting until reload. Persisting a short asset key instead keeps the graph
 * small and lets the image survive a reload.
 */
export async function persistWorkflowImage(
  source: string | Blob,
  keyPrefix = "workflow-img"
): Promise<{ url: string; assetKey: string } | null> {
  try {
    const blob = typeof source === "string" ? dataUrlToBlob(source) : source;
    const assetKey = `${keyPrefix}-${Date.now().toString(36)}-${generateNanoid(6)}`;
    await putCanvasAsset(assetKey, blob);
    return { url: URL.createObjectURL(blob), assetKey };
  } catch {
    return null;
  }
}

/** Legacy graphs stored full data URLs; migrate them once after rehydration. */
async function migrateLegacyNodeImages(
  state: WorkflowGraphState,
  items: Array<{
    nodeId: string;
    field: "imageUrl" | "outputImageUrl";
    value: string;
  }>
): Promise<void> {
  for (const item of items) {
    const stored = await persistWorkflowImage(
      item.value,
      item.field === "imageUrl" ? "workflow-img" : "workflow-out"
    );
    if (!stored) continue;
    state.updateNodeData(
      item.nodeId,
      item.field === "imageUrl"
        ? { imageUrl: stored.url, imageAssetKey: stored.assetKey }
        : { outputImageUrl: stored.url, outputAssetKey: stored.assetKey },
      { recordHistory: false }
    );
  }
}

/**
 * Kahn topological order over generator→generator image edges. `nodes` is
 * creation/import order, so a legitimate generator chain could run its
 * consumer first and read a previous run's output. A cycle cannot be ordered,
 * so it is reported instead of silently producing stale inputs.
 */
function resolveGeneratorOrder(
  nodes: WorkflowNode[],
  edges: WorkflowEdge[]
): { order: WorkflowNode[]; hasCycle: boolean } {
  const generators = nodes.filter((node) => node.type === "generator");
  const ids = new Set(generators.map((node) => node.id));
  const indegree = new Map<string, number>(
    generators.map((node) => [node.id, 0])
  );
  const outgoing = new Map<string, string[]>();

  for (const edge of edges) {
    if (edge.toPort !== "image") continue;
    if (!ids.has(edge.fromNodeId) || !ids.has(edge.toNodeId)) continue;
    if (edge.fromNodeId === edge.toNodeId) continue;
    outgoing.set(edge.fromNodeId, [
      ...(outgoing.get(edge.fromNodeId) ?? []),
      edge.toNodeId,
    ]);
    indegree.set(edge.toNodeId, (indegree.get(edge.toNodeId) ?? 0) + 1);
  }

  const byId = new Map(generators.map((node) => [node.id, node]));
  const queue = generators.filter((node) => indegree.get(node.id) === 0);
  const order: WorkflowNode[] = [];
  while (queue.length > 0) {
    const node = queue.shift()!;
    order.push(node);
    for (const nextId of outgoing.get(node.id) ?? []) {
      const remaining = (indegree.get(nextId) ?? 0) - 1;
      indegree.set(nextId, remaining);
      if (remaining === 0) {
        const next = byId.get(nextId);
        if (next) queue.push(next);
      }
    }
  }

  return { order, hasCycle: order.length < generators.length };
}

export const useWorkflowStore = create<WorkflowGraphState>()(
  persist(
    (set, get) => ({
      nodes: DEFAULT_STARTER_NODES,
      edges: DEFAULT_STARTER_EDGES,
      viewport: { x: 50, y: 50, zoom: 1 },
      selectedNodeId: null,
      selectedEdgeId: null,
      connectingDraft: null,
      past: [],
      future: [],
      batchRunning: false,

      captureSnapshot: () => {
        const { nodes, edges } = get();
        return buildSnapshot(nodes, edges);
      },

      pushSnapshot: (snapshot) => {
        const { past } = get();
        set({
          past: [...past, snapshot].slice(-WORKFLOW_HISTORY_LIMIT),
          future: [],
        });
        lastHistoryTag = null;
        lastHistoryAt = 0;
      },

      pushHistory: (tag, options) => {
        const now = Date.now();
        const coalesceMs = options?.coalesceMs ?? 0;
        if (
          tag &&
          coalesceMs > 0 &&
          lastHistoryTag === tag &&
          now - lastHistoryAt <= coalesceMs
        ) {
          lastHistoryAt = now;
          return;
        }
        get().pushSnapshot(get().captureSnapshot());
        lastHistoryTag = tag ?? null;
        lastHistoryAt = now;
      },

      undo: () => {
        const { past, future, nodes, edges, selectedNodeId, selectedEdgeId } =
          get();
        if (past.length === 0) return false;
        const previous = past[past.length - 1];
        const current = buildSnapshot(nodes, edges);
        set({
          nodes: restoreSnapshot(previous, nodes),
          edges: copyEdges(previous.edges),
          past: past.slice(0, -1),
          future: [...future, current].slice(-WORKFLOW_HISTORY_LIMIT),
          selectedNodeId: previous.nodes.some((n) => n.id === selectedNodeId)
            ? selectedNodeId
            : null,
          selectedEdgeId: previous.edges.some((e) => e.id === selectedEdgeId)
            ? selectedEdgeId
            : null,
          connectingDraft: null,
        });
        lastHistoryTag = null;
        lastHistoryAt = 0;
        return true;
      },

      redo: () => {
        const { past, future, nodes, edges, selectedNodeId, selectedEdgeId } =
          get();
        if (future.length === 0) return false;
        const target = future[future.length - 1];
        const current = buildSnapshot(nodes, edges);
        set({
          nodes: restoreSnapshot(target, nodes),
          edges: copyEdges(target.edges),
          past: [...past, current].slice(-WORKFLOW_HISTORY_LIMIT),
          future: future.slice(0, -1),
          selectedNodeId: target.nodes.some((n) => n.id === selectedNodeId)
            ? selectedNodeId
            : null,
          selectedEdgeId: target.edges.some((e) => e.id === selectedEdgeId)
            ? selectedEdgeId
            : null,
          connectingDraft: null,
        });
        lastHistoryTag = null;
        lastHistoryAt = 0;
        return true;
      },

      clearGraph: () => {
        const { nodes, edges } = get();
        const counts = { nodes: nodes.length, edges: edges.length };
        if (nodes.length === 0 && edges.length === 0) return counts;
        get().pushHistory();
        // No node survives, so no in-flight request can still be useful.
        abortControllers.forEach((controller) => controller.abort());
        set({
          nodes: [],
          edges: [],
          selectedNodeId: null,
          selectedEdgeId: null,
          connectingDraft: null,
        });
        return counts;
      },

      addNode: (type, pos, initialData) => {
        get().pushHistory();
        const id = `node-${type}-${generateNanoid(6)}`;
        const viewport = get().viewport;
        // Place in center of current viewport if pos not provided
        const x = pos?.x ?? Math.round((-viewport.x + 350) / viewport.zoom);
        const y = pos?.y ?? Math.round((-viewport.y + 250) / viewport.zoom);

        const titles: Record<WorkflowNodeType, string> = {
          prompt: i18n.t("workflowStore.nodePrompt"),
          image: i18n.t("workflowStore.nodeImage"),
          generator: i18n.t("workflowStore.nodeGenerator"),
          preview: i18n.t("workflowStore.nodePreview"),
          assistant: i18n.t("workflowStore.nodeAssistant"),
        };

        const widths: Record<WorkflowNodeType, number> = {
          prompt: 320,
          image: 320,
          generator: 340,
          preview: 360,
          assistant: 360,
        };

        const newNode: WorkflowNode = {
          id,
          type,
          x,
          y,
          width: widths[type] || 320,
          title: titles[type] || i18n.t("workflowStore.nodeFallback"),
          data: initialData || {},
        };

        set((state) => ({
          nodes: [...state.nodes, newNode],
          selectedNodeId: id,
        }));

        return id;
      },

      removeNode: (id) => {
        const node = get().nodes.find((item) => item.id === id);
        if (!node) return;
        // Deleting a node mid-request discards a paid result and skips the
        // gallery save; the clear dialog already warns about this, so make the
        // same guarantee here instead of silently dropping it.
        if (node.data.status === "running" && inFlightExecution.has(id)) {
          toast.warning(i18n.t("workflowStore.toastNodeRunning"));
          return;
        }
        get().pushHistory();
        set((state) => ({
          nodes: state.nodes.filter((n) => n.id !== id),
          edges: state.edges.filter((e) => e.fromNodeId !== id && e.toNodeId !== id),
          selectedNodeId: state.selectedNodeId === id ? null : state.selectedNodeId,
          selectedEdgeId:
            state.selectedEdgeId &&
            state.edges.some(
              (e) =>
                e.id === state.selectedEdgeId &&
                e.fromNodeId !== id &&
                e.toNodeId !== id
            )
              ? state.selectedEdgeId
              : null,
        }));
      },

      duplicateNode: (id) => {
        const target = get().nodes.find((n) => n.id === id);
        if (!target) return null;

        get().pushHistory();
        const newId = `node-${target.type}-${generateNanoid(6)}`;
        const clone: WorkflowNode = {
          ...target,
          id: newId,
          x: target.x + 30,
          y: target.y + 30,
          title: i18n.t("workflowStore.nodeCopySuffix", { title: target.title }),
          // A copy starts idle. Keeping the source's output while resetting
          // status made the image invisible in the node but still usable by
          // preview nodes and downstream generators.
          data: { ...stripRuntimeData(target.data), status: "idle", progress: 0 },
        };

        set((state) => ({
          nodes: [...state.nodes, clone],
          selectedNodeId: newId,
        }));

        return newId;
      },

      updateNodeData: (id, patch, options) => {
        // Execution writes (status/progress/output/…) never enter history;
        // manual field edits do, coalesced per node + field set.
        const recordHistory =
          options?.recordHistory !== false && !isRuntimeOnlyPatch(patch);
        if (recordHistory) {
          const fieldTag = Object.keys(patch)
            .filter((key) => !RUNTIME_KEY_SET.has(key))
            .sort()
            .join(",");
          get().pushHistory(`node:${id}:${fieldTag}`, {
            coalesceMs: NODE_EDIT_COALESCE_MS,
          });
        }
        set((state) => ({
          nodes: state.nodes.map((n) =>
            n.id === id ? { ...n, data: { ...n.data, ...patch } } : n
          ),
        }));
      },

      setNodePosition: (id, x, y) => {
        set((state) => ({
          nodes: state.nodes.map((n) => (n.id === id ? { ...n, x, y } : n)),
        }));
      },

      moveNode: (id, dx, dy) => {
        set((state) => ({
          nodes: state.nodes.map((n) =>
            n.id === id ? { ...n, x: n.x + dx, y: n.y + dy } : n
          ),
        }));
      },

      setSelectedNodeId: (id) => set({ selectedNodeId: id }),

      addEdge: (edge) => {
        // A node's own output can never feed its own input: the data would
        // never become available and execution would read a stale value.
        if (edge.fromNodeId === edge.toNodeId) return;

        // Data only flows between ports of the same colour. Without this an
        // accepted purple edge was displayed/counted but ignored at runtime.
        const sourceNode = get().nodes.find((n) => n.id === edge.fromNodeId);
        const targetNode = get().nodes.find((n) => n.id === edge.toNodeId);
        if (
          !isWorkflowConnectionTypeCompatible(
            sourceNode?.type,
            targetNode?.type,
            edge.toPort
          )
        ) {
          return;
        }

        // Prevent exact duplicate connection (same fromPort to same toPort)
        const isExactDuplicate = get().edges.some(
          (e) =>
            e.fromNodeId === edge.fromNodeId &&
            e.fromPort === edge.fromPort &&
            e.toNodeId === edge.toNodeId &&
            e.toPort === edge.toPort
        );
        if (isExactDuplicate) return;

        get().pushHistory();

        // Preview image port is strictly single-input
        const isSingleInput = targetNode?.type === "preview";
        const existing = isSingleInput
          ? get().edges.find((e) => e.toNodeId === edge.toNodeId && e.toPort === edge.toPort)
          : null;

        const newEdge: WorkflowEdge = {
          ...edge,
          id: `edge-${generateNanoid(8)}`,
        };

        set((state) => ({
          edges: existing
            ? state.edges.map((e) => (e.id === existing.id ? newEdge : e))
            : [...state.edges, newEdge],
        }));
      },

      removeEdge: (id) => {
        if (!get().edges.some((edge) => edge.id === id)) return;
        get().pushHistory();
        set((state) => ({
          edges: state.edges.filter((e) => e.id !== id),
          selectedEdgeId: state.selectedEdgeId === id ? null : state.selectedEdgeId,
        }));
      },

      setSelectedEdgeId: (id) => set({ selectedEdgeId: id }),

      startConnecting: (fromNodeId, fromPort, portType, startX, startY) => {
        set({
          connectingDraft: {
            fromNodeId,
            fromPort,
            portType,
            startX,
            startY,
            currentX: startX,
            currentY: startY,
          },
        });
      },

      updateConnecting: (currentX, currentY) => {
        set((state) =>
          state.connectingDraft
            ? { connectingDraft: { ...state.connectingDraft, currentX, currentY } }
            : {}
        );
      },

      endConnecting: (toNodeId, toPort) => {
        const draft = get().connectingDraft;
        if (draft && toNodeId && toPort && toNodeId !== draft.fromNodeId) {
          get().addEdge({
            fromNodeId: draft.fromNodeId,
            fromPort: draft.fromPort,
            toNodeId,
            toPort,
            portType: draft.portType,
          });
        }
        set({ connectingDraft: null });
      },

      setViewport: (patch) => {
        set((state) => ({
          viewport: { ...state.viewport, ...patch },
        }));
      },

      resetViewport: () => {
        set({ viewport: { x: 50, y: 50, zoom: 1 } });
      },

      executeAssistantNode: async (nodeId: string) => {
        const state = get();
        const node = state.nodes.find((n) => n.id === nodeId);
        if (!node || node.type !== "assistant") return;
        // Re-entry guard: the same node must never have two paid requests in
        // flight; the second result would overwrite the first and save again.
        if (inFlightExecution.has(nodeId)) return;

        const config = useConfigStore.getState();
        const llmConfig = applyServerLlmOverlay({
          ...config.llmConfig,
          corsProxy: config.corsProxy,
          corsProxyMode: config.corsProxyMode,
        });

        const mode = node.data.assistantMode || "enhance";

        inFlightExecution.add(nodeId);
        const controller = new AbortController();
        abortControllers.set(nodeId, controller);
        get().updateNodeData(nodeId, {
          status: "running",
          statusText:
            mode === "vision"
              ? i18n.t("workflowStore.statusVisionRunning")
              : i18n.t("workflowStore.statusLlmRunning"),
          error: undefined,
        });

        try {
          let result = "";
          if (mode === "vision") {
            // Find connected image from image port or local input
            let imageUrl = node.data.inputImageUrl;
            const imageEdges = state.edges.filter(
              (e) => e.toNodeId === nodeId && e.toPort === "image"
            );
            if (imageEdges.length > 0) {
              const src = state.nodes.find((n) => n.id === imageEdges[0].fromNodeId);
              if (src?.type === "image" && src.data.imageUrl) {
                imageUrl = src.data.imageUrl;
              } else if (src?.type === "generator" && src.data.outputImageUrl) {
                imageUrl = src.data.outputImageUrl;
              }
            }

            if (!imageUrl) {
              throw new Error(i18n.t("workflowStore.errorNeedImageForVision"));
            }

            result = await imageToPrompt(imageUrl, llmConfig, controller.signal);
          } else {
            // Text to text ("enhance" or "translate")
            const textParts: string[] = [];
            if (node.data.inputPrompt?.trim()) {
              textParts.push(node.data.inputPrompt.trim());
            }

            const textEdges = state.edges.filter(
              (e) => e.toNodeId === nodeId && e.toPort === "text"
            );
            textEdges.forEach((edge) => {
              const src = state.nodes.find((n) => n.id === edge.fromNodeId);
              if (src?.type === "prompt" && src.data.promptText?.trim()) {
                textParts.push(src.data.promptText.trim());
              } else if (src?.type === "assistant" && src.data.outputPrompt?.trim()) {
                textParts.push(src.data.outputPrompt.trim());
              }
            });

            const inputText = textParts.join("\n");
            if (!inputText.trim()) {
              throw new Error(i18n.t("workflowStore.errorNeedPromptDraft"));
            }

            result = await polishPrompt(
              inputText.trim(),
              llmConfig,
              mode === "translate" ? "translate" : "enhance",
              controller.signal
            );
          }

          get().updateNodeData(
            nodeId,
            {
              status: "done",
              statusText: i18n.t("workflowStore.statusDone"),
              outputPrompt: result,
              promptText: result,
            },
            // Generated text is a runtime result, not an undoable manual edit.
            { recordHistory: false }
          );
        } catch (err) {
          if (controller.signal.aborted) {
            get().updateNodeData(nodeId, {
              status: "idle",
              statusText: i18n.t("workflowStore.statusCancelled"),
              progress: 0,
              error: undefined,
            });
            return;
          }
          const msg = extractErrorMessage(err);
          toast.error(
            i18n.t("workflowStore.toastAssistantFailed", { title: node.title, message: msg }),
            {
              duration: 8000,
            }
          );
          get().updateNodeData(nodeId, {
            status: "error",
            statusText: i18n.t("workflowStore.statusFailed"),
            error: msg,
          });
        } finally {
          inFlightExecution.delete(nodeId);
          if (abortControllers.get(nodeId) === controller) {
            abortControllers.delete(nodeId);
          }
        }
      },

      saveNodeResultToGallery: async (nodeId: string) => {
        const node = get().nodes.find((item) => item.id === nodeId);
        if (!node?.data.outputImageUrl) return;
        get().updateNodeData(nodeId, { gallerySaveStatus: "saving", gallerySaveError: undefined });
        try {
          const url = node.data.outputImageUrl;
          const { corsProxy, corsProxyMode } = useConfigStore.getState();
          const storedBlob = node.data.outputAssetKey
            ? await getCanvasAsset(node.data.outputAssetKey)
            : undefined;
          const blob =
            storedBlob ??
            (url.startsWith("data:")
              ? dataUrlToBlob(url)
              : await fetchAsBlob(url, {
                  corsProxy: corsProxy || undefined,
                  corsProxyMode,
                }));
          await saveToHistory({
            nanoid: node.data.galleryNanoid || generateNanoid(10),
            imageBlob: blob,
            // The generator node usually has no promptText of its own; the
            // resolved prompt is recorded at success time.
            prompt: node.data.outputPrompt || node.data.promptText || "",
            negativePrompt: node.data.negativePrompt,
            provider: node.data.providerId || "openai",
            model: node.data.model || useConfigStore.getState().selectedModel,
            size: node.data.size || "1:1",
            resolution: node.data.resolution || "1k",
            generationTimeMs: node.data.generationTimeMs ?? 3000,
            createdAt: node.data.galleryCreatedAt || Date.now(),
            starred: false,
          }, useConfigStore.getState().historyQuota);
          get().updateNodeData(nodeId, { gallerySaveStatus: "saved" });
          toast.success(i18n.t("workflowStore.toastSavedToGallery"));
        } catch (error) {
          get().updateNodeData(nodeId, {
            gallerySaveStatus: "failed",
            gallerySaveError:
              error instanceof Error
                ? error.message
                : i18n.t("workflowStore.errorGalleryWrite"),
          });
          toast.error(i18n.t("workflowStore.toastSaveToGalleryFailed"));
        }
      },

      executeGeneratorNode: async (nodeId: string) => {
        const state = get();
        const genNode = state.nodes.find((n) => n.id === nodeId);
        if (!genNode || genNode.type !== "generator") return;
        // Re-entry guard: a double-click must not submit the same node twice.
        if (inFlightExecution.has(nodeId)) return;

        // 1. Resolve connected prompt texts (Supports multiple prompt inputs, joined by \n)
        const promptParts: string[] = [];
        if (genNode.data.promptText?.trim()) {
          promptParts.push(genNode.data.promptText.trim());
        }

        const promptEdges = state.edges.filter(
          (e) => e.toNodeId === nodeId && e.toPort === "prompt"
        );
        // Prompt nodes carry their own negative prompt; the generator used to
        // ignore it entirely, so a filled-in field was silently dropped.
        const negativeParts: string[] = [];
        if (genNode.data.negativePrompt?.trim()) {
          negativeParts.push(genNode.data.negativePrompt.trim());
        }
        promptEdges.forEach((edge) => {
          const sourceNode = state.nodes.find((n) => n.id === edge.fromNodeId);
          if (!sourceNode) return;

          if (sourceNode.type === "prompt" && sourceNode.data.promptText?.trim()) {
            promptParts.push(sourceNode.data.promptText.trim());
          } else if (sourceNode.type === "assistant") {
            const text = sourceNode.data.outputPrompt || sourceNode.data.promptText;
            if (text?.trim()) {
              promptParts.push(text.trim());
            }
          } else if (sourceNode.data.promptText?.trim()) {
            promptParts.push(sourceNode.data.promptText.trim());
          }

          if (sourceNode.data.negativePrompt?.trim()) {
            negativeParts.push(sourceNode.data.negativePrompt.trim());
          }
        });

        const prompt = promptParts.join("\n");
        const negativePrompt = negativeParts.join(", ");

        // 2. Resolve connected image inputs (Supports multiple images)
        const imageUrls: string[] = [];
        const imageEdges = state.edges.filter(
          (e) => e.toNodeId === nodeId && e.toPort === "image"
        );
        imageEdges.forEach((edge) => {
          const sourceNode = state.nodes.find((n) => n.id === edge.fromNodeId);
          if (!sourceNode) return;

          if (sourceNode.type === "image" && sourceNode.data.imageUrl) {
            imageUrls.push(sourceNode.data.imageUrl);
          } else if (
            sourceNode.type === "generator" &&
            sourceNode.data.outputImageUrl
          ) {
            imageUrls.push(sourceNode.data.outputImageUrl);
          } else if (sourceNode.data.imageUrl) {
            imageUrls.push(sourceNode.data.imageUrl);
          }
        });

        if (!prompt.trim() && imageUrls.length === 0) {
          toast.warning(
            i18n.t("workflowStore.toastGeneratorNeedInput", { title: genNode.title })
          );
          return;
        }

        // Config store resolution
        const config = useConfigStore.getState();
        const providerId =
          genNode.data.providerId || config.selectedProviderId || "openai";
        const provider =
          config.providers.find((p) => p.id === providerId) || config.providers[0];
        // Manual selection only: node model, then the globally selected model — no silent fallback
        const model =
          genNode.data.model ||
          config.imageConfig?.selectedModel ||
          config.selectedModel ||
          "";

        if (!model) {
          toast.warning(
            i18n.t("workflowStore.toastModelNotSelected", { title: genNode.title })
          );
          get().updateNodeData(nodeId, {
            status: "error",
            statusText: i18n.t("workflowStore.statusModelNotSelected"),
            error: i18n.t("workflowStore.statusModelNotSelected"),
          });
          return;
        }

        if (!config.imageConfig.enabledModelIds.includes(model)) {
          toast.warning(
            i18n.t("workflowStore.toastModelDisabled", { title: genNode.title })
          );
          get().updateNodeData(nodeId, {
            status: "error",
            statusText: i18n.t("workflowStore.statusModelDisabled"),
            error: i18n.t("workflowStore.statusModelDisabled"),
          });
          return;
        }

        // Set status to running
        inFlightExecution.add(nodeId);
        const controller = new AbortController();
        abortControllers.set(nodeId, controller);
        const startedAt = Date.now();
        get().updateNodeData(nodeId, {
          status: "running",
          progress: 5,
          statusText: i18n.t("workflowStore.statusSubmitting"),
          error: undefined,
        });

        try {
          const { provider: effectiveProvider, proxy: effectiveProxy } = applyServerImageOverlay(
            provider,
            { corsProxy: config.corsProxy, corsProxyMode: config.corsProxyMode }
          );
          const resultUrl = await dispatchGenerate(effectiveProvider, {
            providerId,
            model,
            prompt,
            negativePrompt: negativePrompt || undefined,
            imageUrls: imageUrls.length > 0 ? imageUrls : undefined,
            size: genNode.data.size || "1:1",
            resolution: genNode.data.resolution || "1k",
            cfgScale: genNode.data.cfgScale,
            steps: genNode.data.steps,
            seed: genNode.data.seed,
            corsProxy: effectiveProxy.corsProxy,
            corsProxyMode: effectiveProxy.corsProxyMode,
            signal: controller.signal,
            onProgress: (p) => {
              get().updateNodeData(nodeId, {
                statusText: p.status,
                progress: p.progress ?? 50,
              });
            },
          });

          // Finished successfully
          const galleryNanoid = generateNanoid(10);
          const galleryCreatedAt = Date.now();
          // A b64_json response is a multi-MB data URL; move it into
          // IndexedDB and keep only the object URL + key in node data.
          let displayUrl = resultUrl;
          let outputAssetKey: string | undefined;
          if (resultUrl.startsWith("data:")) {
            const stored = await persistWorkflowImage(resultUrl, "workflow-out");
            if (stored) {
              displayUrl = stored.url;
              outputAssetKey = stored.assetKey;
            }
          }
          get().updateNodeData(nodeId, {
            status: "done",
            progress: 100,
            statusText: i18n.t("workflowStore.statusDone"),
            outputImageUrl: displayUrl,
            outputAssetKey,
            // Record what actually produced this image: the gallery copy used
            // to be saved with an empty prompt and a hard-coded 3s duration.
            outputPrompt: prompt,
            generationTimeMs: Date.now() - startedAt,
            gallerySaveStatus: "saving",
            galleryNanoid,
            galleryCreatedAt,
          });

          // Propagate to connected preview nodes
          const downstreamEdges = get().edges.filter(
            (e) => e.fromNodeId === nodeId && e.fromPort === "output"
          );
          downstreamEdges.forEach((e) => {
            const target = get().nodes.find((n) => n.id === e.toNodeId);
            if (target?.type === "preview") {
              get().updateNodeData(target.id, {
                previewUrl: displayUrl,
                compareUrl: imageUrls[0],
              });
            }
          });

          await get().saveNodeResultToGallery(nodeId);
        } catch (err) {
          if (controller.signal.aborted) {
            get().updateNodeData(nodeId, {
              status: "idle",
              progress: 0,
              statusText: i18n.t("workflowStore.statusCancelled"),
              error: undefined,
            });
            return;
          }
          const msg = extractErrorMessage(err);
          toast.error(
            i18n.t("workflowStore.toastGeneratorFailed", { title: genNode.title, message: msg }),
            {
              duration: 8000,
            }
          );
          get().updateNodeData(nodeId, {
            status: "error",
            statusText: i18n.t("workflowStore.statusFailed"),
            error: msg,
          });
        } finally {
          inFlightExecution.delete(nodeId);
          if (abortControllers.get(nodeId) === controller) {
            abortControllers.delete(nodeId);
          }
        }
      },

      executeAllGenerators: async () => {
        if (executeAllInFlight) return;
        executeAllInFlight = true;
        set({ batchRunning: true });
        try {
          // Dependency order, not insertion order: a generator that consumes
          // another generator's image must run after its producer, otherwise it
          // reads a previous run's output (or none) and silently pays for the
          // wrong generation. A cycle cannot be ordered at all.
          const { order, hasCycle } = resolveGeneratorOrder(
            get().nodes,
            get().edges
          );
          if (hasCycle) {
            toast.warning(i18n.t("workflowStore.toastCycleDetected"));
            return;
          }

          // 1. Run all assistant nodes first so generated prompts propagate to generators
          const assistants = get().nodes.filter((n) => n.type === "assistant");
          for (const ast of assistants) {
            await get().executeAssistantNode(ast.id);
          }

          // 2. Run generator nodes in topological order
          for (const gen of order) {
            await get().executeGeneratorNode(gen.id);
          }
        } finally {
          executeAllInFlight = false;
          set({ batchRunning: false });
        }
      },

      stopNode: (nodeId) => {
        abortControllers.get(nodeId)?.abort();
      },

      hydrateAssets: async () => {
        if (workflowAssetsHydrated) return;
        workflowAssetsHydrated = true;

        for (const node of get().nodes) {
          const data = node.data;
          if (data.imageAssetKey && !data.imageUrl) {
            try {
              const blob = await getCanvasAsset(data.imageAssetKey);
              if (blob) {
                get().updateNodeData(
                  node.id,
                  { imageUrl: URL.createObjectURL(blob) },
                  { recordHistory: false }
                );
              }
            } catch {
              // A missing asset leaves the node empty; the user can re-upload.
            }
          }
          if (data.outputAssetKey && data.status === "done" && !data.outputImageUrl) {
            try {
              const blob = await getCanvasAsset(data.outputAssetKey);
              if (blob) {
                get().updateNodeData(
                  node.id,
                  { outputImageUrl: URL.createObjectURL(blob) },
                  { recordHistory: false }
                );
              }
            } catch {
              // Keep the node "done" without an image; regenerate to restore it.
            }
          }
        }

        const validKeys = get().nodes.flatMap((node) => [
          node.data.imageAssetKey,
          node.data.outputAssetKey,
        ]).filter((key): key is string => Boolean(key));
        try {
          // Scoped to workflow-owned keys; the free canvas must never sweep
          // images a node still references.
          await pruneCanvasAssets(validKeys, undefined, 80, [WORKFLOW_ASSET_PREFIX]);
        } catch {
          // Quota/upgrade trouble must not block the canvas.
        }
      },

      importImageData: async ({ nodeId, dataUrl, imageName, width, height }) => {
        const stored = await persistWorkflowImage(dataUrl, "workflow-img");
        const dimensions =
          width && height ? { width, height } : undefined;
        if (!stored) {
          // No IndexedDB: keep the image for this session. Persistence strips
          // it, so reloading loses it — better than breaking the quota.
          get().updateNodeData(nodeId, {
            imageUrl: dataUrl,
            imageName,
            imageDimensions: dimensions,
          });
          return false;
        }
        get().updateNodeData(nodeId, {
          imageUrl: stored.url,
          imageAssetKey: stored.assetKey,
          imageName,
          imageDimensions: dimensions,
        });
        return true;
      },

      resetToDefaultGraph: () => {
        get().pushHistory();
        abortControllers.forEach((controller) => controller.abort());
        set({
          nodes: DEFAULT_STARTER_NODES,
          edges: DEFAULT_STARTER_EDGES,
          viewport: { x: 50, y: 50, zoom: 1 },
          selectedNodeId: null,
          selectedEdgeId: null,
          connectingDraft: null,
        });
      },

      exportGraph: () => {
        const { nodes, edges, viewport } = get();
        return JSON.stringify(
          {
            version: 1,
            exportedAt: new Date().toISOString(),
            nodes,
            edges,
            viewport,
          },
          null,
          2
        );
      },

      importGraph: (jsonText) => {
        let data: unknown;
        try {
          data = JSON.parse(jsonText);
        } catch {
          throw new Error(i18n.t("workflowStore.importInvalid"));
        }

        if (!data || typeof data !== "object" || Array.isArray(data)) {
          throw new Error(i18n.t("workflowStore.importInvalid"));
        }
        const raw = data as { nodes?: unknown; edges?: unknown; viewport?: unknown };
        if (!Array.isArray(raw.nodes)) {
          throw new Error(i18n.t("workflowStore.importInvalid"));
        }

        const VALID_TYPES = new Set<string>([
          "prompt",
          "image",
          "generator",
          "preview",
          "assistant",
        ]);

        const importedNodes: WorkflowNode[] = [];
        const nodeIds = new Set<string>();
        raw.nodes.forEach((item) => {
          if (!item || typeof item !== "object" || Array.isArray(item)) return;
          const n = item as Record<string, unknown>;
          const id = typeof n.id === "string" ? n.id.trim() : "";
          if (!id || nodeIds.has(id)) return;
          const type = VALID_TYPES.has(String(n.type)) ? (n.type as WorkflowNodeType) : "prompt";
          const nodeData =
            n.data && typeof n.data === "object" && !Array.isArray(n.data)
              ? // Imported graphs start idle: keeping status/output meant a
                // generator looked empty while its hidden image still fed
                // preview and downstream generators.
                { ...stripRuntimeData(n.data as WorkflowNodeData) }
              : {};
          nodeData.status = "idle";
          nodeData.progress = 0;

          importedNodes.push({
            id,
            type,
            x: typeof n.x === "number" ? n.x : 0,
            y: typeof n.y === "number" ? n.y : 0,
            width: typeof n.width === "number" ? n.width : undefined,
            title: typeof n.title === "string" && n.title.trim() ? n.title : i18n.t("workflowStore.nodeFallback"),
            data: nodeData,
          });
          nodeIds.add(id);
        });

        if (importedNodes.length === 0) {
          throw new Error(i18n.t("workflowStore.importEmpty"));
        }

        const importedEdges: WorkflowEdge[] = [];
        const edgeIds = new Set<string>();
        const rawEdges = Array.isArray(raw.edges) ? raw.edges : [];
        rawEdges.forEach((item) => {
          if (!item || typeof item !== "object" || Array.isArray(item)) return;
          const e = item as Record<string, unknown>;
          const fromNodeId = typeof e.fromNodeId === "string" ? e.fromNodeId : "";
          const toNodeId = typeof e.toNodeId === "string" ? e.toNodeId : "";
          if (!nodeIds.has(fromNodeId) || !nodeIds.has(toNodeId)) return;
          // Old exports may contain self-loops; drop them on import instead of
          // restoring a connection the canvas refuses to create.
          if (fromNodeId === toNodeId) return;
          const id = typeof e.id === "string" && e.id.trim() ? e.id.trim() : `edge-${generateNanoid(8)}`;
          if (edgeIds.has(id)) return;

          const toPort =
            typeof e.toPort === "string" ? e.toPort : "prompt";
          const fromType = importedNodes.find((n) => n.id === fromNodeId)?.type;
          const toType = importedNodes.find((n) => n.id === toNodeId)?.type;
          // Drop type-incompatible edges from legacy/hand-edited files instead
          // of importing a connection the canvas would refuse to create.
          if (!isWorkflowConnectionTypeCompatible(fromType, toType, toPort)) {
            return;
          }

          importedEdges.push({
            id,
            fromNodeId,
            fromPort: typeof e.fromPort === "string" ? e.fromPort : "output",
            toNodeId,
            toPort,
            portType: e.portType === "image" ? "image" : "text",
          });
          edgeIds.add(id);
        });

        const vp =
          raw.viewport && typeof raw.viewport === "object" && !Array.isArray(raw.viewport)
            ? (raw.viewport as Record<string, unknown>)
            : {};
        const viewport = {
          x: typeof vp.x === "number" ? vp.x : 50,
          y: typeof vp.y === "number" ? vp.y : 50,
          zoom: typeof vp.zoom === "number" && vp.zoom > 0 ? vp.zoom : 1,
        };

        get().pushHistory();
        abortControllers.forEach((controller) => controller.abort());
        set({
          nodes: importedNodes,
          edges: importedEdges,
          viewport,
          selectedNodeId: null,
          selectedEdgeId: null,
          connectingDraft: null,
        });

        return { nodes: importedNodes.length, edges: importedEdges.length };
      },
    }),
    {
      name: WORKFLOW_PERSIST_KEY,
      storage: createJSONStorage(() => guardedWorkflowStorage),
      // v2: only the graph itself is persisted. Selection, the in-flight
      // connection draft and the undo stacks are session state.
      version: 2,
      // Status is persisted with the node, so a reload during a generation
      // would otherwise leave a permanently "running" node that blocks
      // "render all" and re-running. No request survives a reload.
      onRehydrateStorage: () => (state) => {
        if (!state) return;

        // Validate the persisted shape before touching it. A blob with a null
        // node or a node without `data` used to throw inside this callback
        // (zustand swallows it) and crash every /workflow render afterwards,
        // with no way out except clearing localStorage.
        const rawNodes: unknown = state.nodes;
        const rawEdges: unknown = state.edges;
        const validNodes = Array.isArray(rawNodes)
          ? rawNodes.filter((node): node is WorkflowNode => {
              if (!node || typeof node !== "object") return false;
              const candidate = node as WorkflowNode;
              return (
                typeof candidate.id === "string" &&
                Boolean(candidate.data) &&
                typeof candidate.data === "object"
              );
            })
          : [];

        const nodeIds = new Set(validNodes.map((node) => node.id));
        const validEdges = Array.isArray(rawEdges)
          ? rawEdges.filter((edge): edge is WorkflowEdge => {
              if (!edge || typeof edge !== "object") return false;
              const candidate = edge as WorkflowEdge;
              return (
                typeof candidate.fromNodeId === "string" &&
                typeof candidate.toNodeId === "string" &&
                nodeIds.has(candidate.fromNodeId) &&
                nodeIds.has(candidate.toNodeId)
              );
            })
          : [];

        if (validNodes.length === 0) {
          state.nodes = DEFAULT_STARTER_NODES;
          state.edges = DEFAULT_STARTER_EDGES;
        } else {
          state.nodes = validNodes;
          // Older snapshots can contain a self-loop that the canvas now refuses
          // to create; drop it so execution never reads a node's own output.
          state.edges = validEdges.filter((edge) => {
            if (edge.fromNodeId === edge.toNodeId) return false;
            const from = validNodes.find((node) => node.id === edge.fromNodeId);
            const to = validNodes.find((node) => node.id === edge.toNodeId);
            return isWorkflowConnectionTypeCompatible(from?.type, to?.type, edge.toPort);
          });
        }

        state.nodes
          .filter((node) => node.data.status === "running")
          .forEach((node) => {
            state.updateNodeData(
              node.id,
              {
                status: "error",
                statusText: i18n.t("workflowStore.statusInterrupted"),
                error: i18n.t("workflowStore.statusInterrupted"),
                progress: 0,
              },
              { recordHistory: false }
            );
          });

        // A "saving" state cannot survive a reload (the upload does not), and
        // the node UI offers retry only for a non-saving status — otherwise it
        // showed "Saving…" forever.
        state.nodes
          .filter((node) => node.data.gallerySaveStatus === "saving")
          .forEach((node) => {
            state.updateNodeData(
              node.id,
              {
                gallerySaveStatus: "failed",
                gallerySaveError: i18n.t("workflowStore.errorSaveInterrupted"),
              },
              { recordHistory: false }
            );
          });

        // Legacy snapshots stored full base64 node images. Capture them now
        // (persistence strips data: URLs on the next write) and migrate after
        // the store is fully constructed.
        const legacyImages: Array<{
          nodeId: string;
          field: "imageUrl" | "outputImageUrl";
          value: string;
        }> = [];
        state.nodes.forEach((node) => {
          for (const field of ["imageUrl", "outputImageUrl"] as const) {
            const value = node.data[field];
            if (typeof value === "string" && value.startsWith("data:")) {
              legacyImages.push({ nodeId: node.id, field, value });
            }
          }
        });
        if (legacyImages.length > 0) {
          const rehydratedState = state;
          setTimeout(() => {
            void migrateLegacyNodeImages(rehydratedState, legacyImages);
          }, 0);
        }
      },
      partialize: (state) =>
        ({
          // Never persist image payloads. `data:` URLs (uploads, b64 responses)
          // and `blob:` URLs (meaningless after reload) are stripped; the bytes
          // live in IndexedDB behind `imageAssetKey` / `outputAssetKey`.
          nodes: state.nodes.map((node) => ({
            ...node,
            data: Object.fromEntries(
              Object.entries(node.data).map(([key, value]) =>
                typeof value === "string" &&
                (value.startsWith("data:") || value.startsWith("blob:"))
                  ? [key, ""]
                  : [key, value]
              )
            ) as WorkflowNodeData,
          })),
          edges: state.edges,
          viewport: state.viewport,
        }) as unknown as WorkflowGraphState,
      migrate: (persisted) => {
        if (!persisted || typeof persisted !== "object") {
          return persisted as WorkflowGraphState;
        }
        // Older snapshots stored selection/connection and (after v2 shipped)
        // nothing else. Drop everything outside the graph before merging.
        const raw = persisted as Record<string, unknown>;
        const clean: Record<string, unknown> = {
          nodes: Array.isArray(raw.nodes) ? raw.nodes : [],
          edges: Array.isArray(raw.edges) ? raw.edges : [],
          viewport:
            raw.viewport && typeof raw.viewport === "object"
              ? raw.viewport
              : { x: 50, y: 50, zoom: 1 },
        };
        return clean as unknown as WorkflowGraphState;
      },
    }
  )
);
