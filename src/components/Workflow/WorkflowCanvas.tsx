import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Node,
  Edge,
  Connection,
  NodeChange,
  ReactFlowProvider,
  useReactFlow,
  useStore,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useHotkeys } from "react-hotkeys-hook";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  Code2Icon,
  DownloadIcon,
  HelpCircleIcon,
  Maximize2Icon,
  PlayIcon,
  PlusIcon,
  RotateCcwIcon,
  Trash2Icon,
  UploadIcon,
  ZapIcon,
} from "lucide-react";
import {
  WorkflowNode,
  WorkflowNodeType,
  WorkflowSnapshot,
  useWorkflowStore,
} from "../../stores/useWorkflowStore";
import { PromptNode } from "./nodes/PromptNode";
import { ImageNode } from "./nodes/ImageNode";
import { GeneratorNode } from "./nodes/GeneratorNode";
import { PreviewNode } from "./nodes/PreviewNode";
import { AssistantNode } from "./nodes/AssistantNode";
import { WorkflowHelpDialog } from "./WorkflowHelpDialog";
import { WorkflowCodeDialog } from "./WorkflowCodeDialog";
import {
  WORKFLOW_NODE_MENU as NODE_MENU,
  isWorkflowConnectionTypeCompatible,
} from "./nodeCatalog";
import { Button } from "../ui/button";
import { ConfirmDialog } from "../ui/confirm-dialog";
import { CanvasContextMenu } from "../Canvas/CanvasContextMenu";
import {
  CANVAS_ADD_BUTTON_CLASS,
  CANVAS_BAR_BUTTON_CLASS,
  CANVAS_DOT_COLOR,
  CANVAS_DOT_GAP,
  CanvasEmptyCard,
  CanvasMenu,
  CanvasMenuItem,
  CanvasMenuItemDivider,
  CanvasSideDock,
  CanvasTopBar,
} from "../Canvas/CanvasChrome";
import { useCommandPaletteStore } from "../../stores/useCommandPaletteStore";
import { cn } from "@/utils/cn";
import {
  isImeComposing,
  shouldIgnoreCanvasHotkey,
} from "@/utils/keyboard";

const PromptNodeAdapter = (props: { data: { node: WorkflowNode } }) => <PromptNode node={props.data.node} />;
const ImageNodeAdapter = (props: { data: { node: WorkflowNode } }) => <ImageNode node={props.data.node} />;
const GeneratorNodeAdapter = (props: { data: { node: WorkflowNode } }) => <GeneratorNode node={props.data.node} />;
const PreviewNodeAdapter = (props: { data: { node: WorkflowNode } }) => <PreviewNode node={props.data.node} />;
const AssistantNodeAdapter = (props: { data: { node: WorkflowNode } }) => <AssistantNode node={props.data.node} />;

const NODE_TYPES = {
  prompt: PromptNodeAdapter,
  image: ImageNodeAdapter,
  generator: GeneratorNodeAdapter,
  preview: PreviewNodeAdapter,
  assistant: AssistantNodeAdapter,
};

function WorkflowCanvasInner() {
  const { t } = useTranslation();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const { screenToFlowPosition, zoomIn, zoomOut, zoomTo, fitView } =
    useReactFlow();
  // Subscribe to zoom only: panning must not re-render the whole canvas.
  const zoom = useStore((state) => state.transform[2]);
  const [helpOpen, setHelpOpen] = useState(false);
  const [codeOpen, setCodeOpen] = useState(false);
  const [confirmClearOpen, setConfirmClearOpen] = useState(false);
  const [confirmResetOpen, setConfirmResetOpen] = useState(false);
  const [pendingImportText, setPendingImportText] = useState<string | null>(null);
  const [paneMenu, setPaneMenu] = useState<{ x: number; y: number } | null>(
    null
  );
  const importGraphFileRef = useRef<HTMLInputElement>(null);
  const dragSnapshotRef = useRef<WorkflowSnapshot | null>(null);

  const {
    nodes,
    edges,
    viewport,
    past,
    future,
    addNode,
    setNodePosition,
    removeNode,
    addEdge,
    removeEdge,
    setSelectedNodeId,
    setSelectedEdgeId,
    selectedNodeId,
    selectedEdgeId,
    executeAllGenerators,
    resetToDefaultGraph,
    importGraph,
    clearGraph,
    undo,
    redo,
    pushSnapshot,
    setViewport,
  } = useWorkflowStore();

  const pendingWorkflowClear = useCommandPaletteStore(
    (state) => state.pendingWorkflowClear
  );
  const consumeWorkflowClear = useCommandPaletteStore(
    (state) => state.consumeWorkflowClear
  );

  // Palette action: navigate here, then show the clear confirmation.
  useEffect(() => {
    if (!pendingWorkflowClear) return;
    consumeWorkflowClear();
    setConfirmClearOpen(true);
  }, [pendingWorkflowClear, consumeWorkflowClear]);

  const addNodeAtCenter = useCallback(
    (type: WorkflowNodeType, label: string) => {
      const rect = wrapperRef.current?.getBoundingClientRect();
      const stack = useWorkflowStore.getState().nodes.length % 6;
      const position = rect
        ? screenToFlowPosition({
            x: rect.left + rect.width / 2 - 170 + stack * 18,
            y: rect.top + Math.min(rect.height * 0.4, 280) + stack * 18,
          })
        : undefined;
      addNode(type, position);
      toast.success(t("workflow.canvas.nodeAdded", { label }));
    },
    [addNode, screenToFlowPosition, t]
  );

  // Right-click on empty canvas places the chosen node under the pointer
  // instead of the viewport centre, which is the one spatial action the
  // toolbar's "+ node" buttons cannot express.
  const addNodeAtPointer = useCallback(
    (type: WorkflowNodeType, label: string) => {
      if (!paneMenu) return;
      const position = screenToFlowPosition({
        x: paneMenu.x,
        y: paneMenu.y,
      });
      addNode(type, {
        x: Math.round(position.x - 160),
        y: Math.round(position.y - 40),
      });
      toast.success(t("workflow.canvas.nodeAdded", { label }));
    },
    [addNode, paneMenu, screenToFlowPosition, t]
  );

  const handlePaneContextMenu = useCallback(
    (event: React.MouseEvent | MouseEvent) => {
      event.preventDefault();
      setSelectedNodeId(null);
      setSelectedEdgeId(null);
      setPaneMenu({ x: event.clientX, y: event.clientY });
    },
    [setSelectedEdgeId, setSelectedNodeId]
  );

  // Export the whole node configuration (nodes + edges + viewport) as a JSON file
  const handleExportGraph = () => {
    const json = useWorkflowStore.getState().exportGraph();
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `workflow-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(t("workflow.canvas.exportGraphDone"));
  };

  // Read the configuration file first; replacing the graph needs confirmation.
  const handleImportGraphFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    try {
      const text = await file.text();
      setPendingImportText(text);
    } catch (err) {
      toast.error(
        t("workflow.canvas.importGraphFailed", {
          msg: err instanceof Error ? err.message : String(err),
        })
      );
    }
  };

  const handleConfirmImport = () => {
    if (!pendingImportText) return;
    try {
      const res = importGraph(pendingImportText);
      setPendingImportText(null);
      toast.success(
        t("workflow.canvas.importGraphDone", {
          count: res.nodes,
          nodes: res.nodes,
          edges: res.edges,
        })
      );
    } catch (err) {
      setPendingImportText(null);
      toast.error(
        t("workflow.canvas.importGraphFailed", {
          msg: err instanceof Error ? err.message : String(err),
        })
      );
    }
  };

  const handleConfirmClear = () => {
    const counts = clearGraph();
    setConfirmClearOpen(false);
    if (counts.nodes === 0 && counts.edges === 0) {
      toast.info(t("workflow.canvas.clearGraphEmpty"));
      return;
    }
    toast.success(t("workflow.canvas.clearGraphDone", counts), {
      action: {
        label: t("common.undo"),
        onClick: () => {
          useWorkflowStore.getState().undo();
        },
      },
    });
  };

  const handleConfirmReset = () => {
    resetToDefaultGraph();
    setConfirmResetOpen(false);
    toast.success(t("workflow.canvas.restoreTemplateDone"), {
      action: {
        label: t("common.undo"),
        onClick: () => {
          useWorkflowStore.getState().undo();
        },
      },
    });
  };

  const handleUndo = () => {
    if (past.length === 0) {
      toast.info(t("workflow.canvas.nothingToUndo"));
      return;
    }
    if (undo()) toast.success(t("workflow.canvas.undone"));
  };

  const handleRedo = () => {
    if (future.length === 0) {
      toast.info(t("workflow.canvas.nothingToRedo"));
      return;
    }
    if (redo()) toast.success(t("workflow.canvas.redone"));
  };

  // ---- Keyboard -----------------------------------------------------------
  // Canvas hotkeys never fire while typing, during IME composition, or while a
  // modal (lightbox / confirm / palette / shortcuts) is open.
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
      if (!selectedNodeId && !selectedEdgeId) return;
      event.preventDefault();
      if (selectedEdgeId) {
        removeEdge(selectedEdgeId);
        toast.info(t("workflow.canvas.edgeRemoved"));
        return;
      }
      if (selectedNodeId) {
        const title =
          nodes.find((node) => node.id === selectedNodeId)?.title ?? "";
        removeNode(selectedNodeId);
        toast.info(t("workflow.canvas.deleteSelectionNode", { title }));
      }
    },
    { ignoreEventWhen: shouldIgnoreCanvasHotkey, preventDefault: true }
  );

  useHotkeys(
    "escape",
    () => {
      if (!selectedNodeId && !selectedEdgeId) return;
      setSelectedNodeId(null);
      setSelectedEdgeId(null);
    },
    { ignoreEventWhen: shouldIgnoreCanvasHotkey }
  );

  // Render all generators. Typing in a node textarea keeps Enter native.
  useHotkeys(
    "mod+enter",
    () => {
      void executeAllGenerators();
    },
    {
      ignoreEventWhen: (event) =>
        isImeComposing(event) || shouldIgnoreCanvasHotkey(event),
    }
  );

  // ---- ReactFlow mapping --------------------------------------------------
  const rfNodes: Node[] = useMemo(() => {
    return nodes.map((n) => ({
      id: n.id,
      type: n.type,
      position: { x: n.x, y: n.y },
      data: { node: n },
    }));
  }, [nodes]);

  const rfEdges: Edge[] = useMemo(() => {
    return edges.map((e) => {
      const isSelected = e.id === selectedEdgeId;
      return {
        id: e.id,
        source: e.fromNodeId,
        target: e.toNodeId,
        sourceHandle: e.fromPort,
        targetHandle: e.toPort,
        animated: true,
        interactionWidth: 24,
        style: {
          stroke: isSelected
            ? "#f59e0b"
            : e.portType === "image"
              ? "#22d3ee"
              : "#c084fc",
          strokeWidth: isSelected ? 3.5 : 2.5,
        },
      };
    });
  }, [edges, selectedEdgeId]);

  // Sync node movement back to store; history is pushed once per drag, at the
  // point where the node actually moved (not on a plain click).
  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      changes.forEach((change) => {
        if (change.type === "position" && change.position) {
          setNodePosition(
            change.id,
            Math.round(change.position.x),
            Math.round(change.position.y)
          );
        }
      });
    },
    [setNodePosition]
  );

  const handleNodeDragStart = useCallback(() => {
    dragSnapshotRef.current = useWorkflowStore.getState().captureSnapshot();
  }, []);

  const handleNodeDragStop = useCallback(
    (_event: MouseEvent | TouchEvent, node: Node) => {
      const snapshot = dragSnapshotRef.current;
      dragSnapshotRef.current = null;
      if (!snapshot) return;
      const original = snapshot.nodes.find((item) => item.id === node.id);
      if (!original) return;
      if (
        Math.round(node.position.x) !== original.x ||
        Math.round(node.position.y) !== original.y
      ) {
        pushSnapshot(snapshot);
      }
    },
    [pushSnapshot]
  );

  // A node's own output never feeds its own input: the connection is invalid
  // before the drop, and addEdge rejects it again for keyboard/import paths.
  // Ports must also match by type — the help says data only flows between ports
  // of the same colour, and a purple prompt→image edge used to be accepted,
  // counted in the badge and then ignored at runtime.
  const isValidConnection = useCallback(
    (connection: Connection | Edge) => {
      if (!connection.source || !connection.target) return false;
      if (connection.source === connection.target) return false;
      const sourceNode = nodes.find((n) => n.id === connection.source);
      const targetNode = nodes.find((n) => n.id === connection.target);
      return isWorkflowConnectionTypeCompatible(
        sourceNode?.type,
        targetNode?.type,
        connection.targetHandle
      );
    },
    [nodes]
  );

  // Handle new edge connection
  const onConnect = useCallback(
    (conn: Connection) => {
      if (!conn.source || !conn.target) return;
      if (conn.source === conn.target) {
        toast.warning(t("workflow.canvas.selfLoopBlocked"));
        return;
      }
      const sourceNode = nodes.find((n) => n.id === conn.source);
      const targetNode = nodes.find((n) => n.id === conn.target);
      if (
        !isWorkflowConnectionTypeCompatible(
          sourceNode?.type,
          targetNode?.type,
          conn.targetHandle
        )
      ) {
        toast.warning(t("workflow.canvas.portTypeMismatch"));
        return;
      }
      // Generator output is an image too; deriving this from the node type keeps
      // manual connections the same color as the template's edges.
      const isImage =
        sourceNode?.type === "image" ||
        sourceNode?.type === "generator" ||
        conn.sourceHandle === "outputImageUrl";

      addEdge({
        fromNodeId: conn.source,
        toNodeId: conn.target,
        fromPort: conn.sourceHandle || "output",
        toPort: conn.targetHandle || "prompt",
        portType: isImage ? "image" : "text",
      });
      toast.success(t("workflow.canvas.nodesConnected"));
    },
    [nodes, addEdge, t]
  );

  const handlePaneClick = useCallback(() => {
    setSelectedNodeId(null);
    setSelectedEdgeId(null);
  }, [setSelectedNodeId, setSelectedEdgeId]);

  const handleEdgeClick = useCallback(
    (event: React.MouseEvent, edge: Edge) => {
      event.stopPropagation();
      setSelectedNodeId(null);
      setSelectedEdgeId(edge.id);
    },
    [setSelectedNodeId, setSelectedEdgeId]
  );

  const isEmpty = nodes.length === 0;
  // Re-entry: while any node is running, "render all" stays disabled so a
  // double-click cannot start a second paid batch.
  const hasRunningNode = nodes.some((node) => node.data.status === "running");

  return (
    <div
      ref={wrapperRef}
      className="relative flex-1 w-full h-full min-h-0 overflow-hidden select-none bg-zinc-950"
    >
      {/* Top work bar: node palette, primary render action, utilities */}
      <CanvasTopBar
        scrollableRail={false}
        rail={
          <>
            <div className="hidden items-center gap-0.5 lg:flex">
              {NODE_MENU.map(({ type, labelKey, icon: Icon, color }) => (
                <Button
                  key={type}
                  variant="ghost"
                  size="sm"
                  onClick={() => addNodeAtCenter(type, t(labelKey))}
                  className={cn(
                    CANVAS_BAR_BUTTON_CLASS,
                    "text-zinc-300 hover:bg-white/10 hover:text-white"
                  )}
                >
                  <Icon className={cn("size-3.5", color)} />
                  <span>+ {t(labelKey)}</span>
                </Button>
              ))}
            </div>
            <div className="lg:hidden">
              <CanvasMenu
                label={t("workflow.canvas.addNode")}
                icon={PlusIcon}
                showLabel
                align="left"
              >
                {(close) =>
                  NODE_MENU.map(({ type, labelKey, icon: Icon, color }) => (
                    <CanvasMenuItem
                      key={type}
                      icon={Icon}
                      iconClassName={color}
                      label={t(labelKey)}
                      onSelect={() => {
                        addNodeAtCenter(type, t(labelKey));
                        close();
                      }}
                    />
                  ))
                }
              </CanvasMenu>
            </div>
          </>
        }
        primary={
          <Button
            size="sm"
            onClick={() => void executeAllGenerators()}
            disabled={hasRunningNode}
            className="h-8 gap-1.5 rounded-xl bg-primary px-3 text-xs font-bold text-zinc-950 shadow-md shadow-primary/20 hover:bg-primary/90"
          >
            <PlayIcon className="size-3.5 fill-current" />
            <span>{t("workflow.canvas.renderAll")}</span>
          </Button>
        }
        trailing={
          <CanvasMenu label={t("common.more")}>
            {(close) => (
              <>
                <CanvasMenuItem
                  icon={DownloadIcon}
                  label={t("workflow.canvas.exportGraph")}
                  onSelect={() => {
                    handleExportGraph();
                    close();
                  }}
                />
                <CanvasMenuItem
                  icon={Code2Icon}
                  label={t("workflow.canvas.exportCode")}
                  disabled={isEmpty}
                  onSelect={() => {
                    setCodeOpen(true);
                    close();
                  }}
                />
                <CanvasMenuItem
                  icon={UploadIcon}
                  label={t("workflow.canvas.importGraph")}
                  onSelect={() => {
                    importGraphFileRef.current?.click();
                    close();
                  }}
                />
                <CanvasMenuItem
                  icon={RotateCcwIcon}
                  label={t("workflow.canvas.resetCanvas")}
                  onSelect={() => {
                    setConfirmResetOpen(true);
                    close();
                  }}
                />
                <CanvasMenuItem
                  icon={Trash2Icon}
                  label={t("workflow.canvas.clearGraph")}
                  destructive
                  disabled={isEmpty && edges.length === 0}
                  onSelect={() => {
                    setConfirmClearOpen(true);
                    close();
                  }}
                />
                <CanvasMenuItemDivider />
                <CanvasMenuItem
                  icon={HelpCircleIcon}
                  label={t("workflow.help.menuItem")}
                  onSelect={() => {
                    setHelpOpen(true);
                    close();
                  }}
                />
              </>
            )}
          </CanvasMenu>
        }
      />

      {/* Hidden file input for node configuration import */}
      <input
        ref={importGraphFileRef}
        type="file"
        accept=".json,application/json"
        className="hidden"
        onChange={(e) => void handleImportGraphFile(e)}
      />

      {/* Friendly empty state instead of a blank dot grid */}
      {isEmpty && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center p-4 pt-20">
          <CanvasEmptyCard
            icon={<ZapIcon className="size-7" />}
            title={t("workflow.canvas.emptyStateTitle")}
            description={t("workflow.canvas.emptyStateDesc")}
            footnotes={
              <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2">
                <button
                  type="button"
                  onClick={() => setHelpOpen(true)}
                  className="inline-flex cursor-pointer items-center gap-1.5 text-[11px] text-zinc-300 transition-colors hover:text-white"
                >
                  <HelpCircleIcon className="size-3" />
                  {t("workflow.help.emptyLink")}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmResetOpen(true)}
                  className="inline-flex cursor-pointer items-center gap-1.5 text-[11px] text-zinc-400 transition-colors hover:text-zinc-100"
                >
                  <RotateCcwIcon className="size-3" />
                  {t("workflow.canvas.restoreTemplate")}
                </button>
              </div>
            }
          >
            {NODE_MENU.map(({ type, labelKey, icon: Icon, color }) => (
              <button
                key={type}
                type="button"
                onClick={() => addNodeAtCenter(type, t(labelKey))}
                className={CANVAS_ADD_BUTTON_CLASS}
              >
                <Icon className={cn("size-3.5", color)} />
                {t(labelKey)}
              </button>
            ))}
          </CanvasEmptyCard>
        </div>
      )}

      {/* Main ReactFlow Workspace */}
      <ReactFlow
        nodes={rfNodes}
        edges={rfEdges}
        nodeTypes={NODE_TYPES}
        onNodesChange={onNodesChange}
        onConnect={onConnect}
        isValidConnection={isValidConnection}
        onNodeDragStart={handleNodeDragStart}
        onNodeDragStop={handleNodeDragStop}
        onPaneClick={handlePaneClick}
        onPaneContextMenu={handlePaneContextMenu}
        onEdgeClick={handleEdgeClick}
        defaultViewport={viewport}
        onMoveEnd={(_event, nextViewport) => setViewport(nextViewport)}
        minZoom={0.2}
        maxZoom={2.0}
        // Selection and deletion are owned by the store so keyboard handling is
        // explicit and never double-fires with @xyflow's built-ins.
        elementsSelectable={false}
        deleteKeyCode={null}
        selectionKeyCode={null}
        multiSelectionKeyCode={null}
        proOptions={{ hideAttribution: true }}
        className="w-full h-full"
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={CANVAS_DOT_GAP}
          size={1}
          color={CANVAS_DOT_COLOR}
          className="opacity-25"
        />
      </ReactFlow>

      {/* Empty-canvas right-click: node types land at the pointer, followed by
          the two view-level actions that belong to "this canvas". */}
      <CanvasContextMenu
        open={paneMenu !== null}
        x={paneMenu?.x ?? 0}
        y={paneMenu?.y ?? 0}
        onClose={() => setPaneMenu(null)}
        label={t("common.more")}
      >
        {NODE_MENU.map(({ type, labelKey, icon: Icon, color }) => (
          <CanvasMenuItem
            key={type}
            icon={Icon}
            iconClassName={color}
            label={t(labelKey)}
            onSelect={() => addNodeAtPointer(type, t(labelKey))}
          />
        ))}
        <CanvasMenuItemDivider />
        <CanvasMenuItem
          icon={Maximize2Icon}
          label={t("workflow.canvas.fitView")}
          onSelect={() => void fitView({ padding: 0.15, duration: 250 })}
        />
        <CanvasMenuItem
          icon={Trash2Icon}
          label={t("workflow.canvas.clearGraph")}
          destructive
          disabled={isEmpty && edges.length === 0}
          onSelect={() => setConfirmClearOpen(true)}
        />
      </CanvasContextMenu>

      <CanvasSideDock
        className="bottom-4"
        zoom={{
          percent: zoom * 100,
          inLabel: t("workflow.canvas.zoomIn"),
          outLabel: t("workflow.canvas.zoomOut"),
          resetLabel: t("workflow.canvas.resetZoomTitle"),
          onIn: () => void zoomIn({ duration: 150 }),
          onOut: () => void zoomOut({ duration: 150 }),
          onReset: () => void zoomTo(1, { duration: 150 }),
        }}
        history={{
          canUndo: past.length > 0,
          canRedo: future.length > 0,
          undoLabel: t("workflow.canvas.undoTitle"),
          redoLabel: t("workflow.canvas.redoTitle"),
          onUndo: handleUndo,
          onRedo: handleRedo,
        }}
        viewActions={[
          {
            id: "fit",
            icon: Maximize2Icon,
            label: t("workflow.canvas.fitView"),
            onSelect: () => void fitView({ padding: 0.15, duration: 250 }),
            tone: "primary",
          },
        ]}
        count={{
          value: nodes.length,
          title: t("workflow.canvas.nodeCount", { count: nodes.length }),
        }}
      />

      <ConfirmDialog
        open={confirmClearOpen}
        title={t("workflow.canvas.clearGraphTitle")}
        description={[
          t("workflow.canvas.clearGraphDesc", {
            nodes: nodes.length,
            edges: edges.length,
          }),
          hasRunningNode
            ? t("workflow.canvas.clearGraphRunningHint")
            : null,
        ]
          .filter(Boolean)
          .join(" ")}
        confirmLabel={t("workflow.canvas.clearGraph")}
        onCancel={() => setConfirmClearOpen(false)}
        onConfirm={handleConfirmClear}
      />

      <ConfirmDialog
        open={confirmResetOpen}
        title={t("workflow.canvas.resetConfirmTitle")}
        description={[
          t("workflow.canvas.resetConfirmDesc", {
            nodes: nodes.length,
            edges: edges.length,
          }),
          // Reset/import/replace discard in-flight results exactly like "clear
          // graph"; the warning must not be limited to that one path.
          hasRunningNode ? t("workflow.canvas.clearGraphRunningHint") : null,
        ]
          .filter(Boolean)
          .join(" ")}
        confirmLabel={t("workflow.canvas.restoreTemplate")}
        destructive={false}
        onCancel={() => setConfirmResetOpen(false)}
        onConfirm={handleConfirmReset}
      />

      <ConfirmDialog
        open={pendingImportText !== null}
        title={t("workflow.canvas.importConfirmTitle")}
        description={[
          t("workflow.canvas.importGraphConfirm"),
          hasRunningNode ? t("workflow.canvas.clearGraphRunningHint") : null,
        ]
          .filter(Boolean)
          .join(" ")}
        confirmLabel={t("workflow.canvas.importGraph")}
        onCancel={() => setPendingImportText(null)}
        onConfirm={handleConfirmImport}
      />

      <WorkflowHelpDialog open={helpOpen} onOpenChange={setHelpOpen} />
      <WorkflowCodeDialog open={codeOpen} onOpenChange={setCodeOpen} />
    </div>
  );
}

export function WorkflowCanvas() {
  return (
    <ReactFlowProvider>
      <WorkflowCanvasInner />
    </ReactFlowProvider>
  );
}
