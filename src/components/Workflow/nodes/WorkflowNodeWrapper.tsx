import React, { useEffect } from "react";
import { Handle, Position, useUpdateNodeInternals } from "@xyflow/react";
import { useTranslation } from "react-i18next";
import { CopyIcon, Trash2Icon } from "lucide-react";
import {
  WorkflowNode,
  WorkflowPortType,
  useWorkflowStore,
} from "../../../stores/useWorkflowStore";
import { cn } from "@/utils/cn";

export type WorkflowPortDef = {
  id: string;
  name: string;
  type: WorkflowPortType;
  direction: "input" | "output";
};

export type WorkflowNodeWrapperProps = {
  node: WorkflowNode;
  icon: React.ReactNode;
  ports: WorkflowPortDef[];
  children: React.ReactNode;
  headerRight?: React.ReactNode;
};

export function WorkflowNodeWrapper({
  node,
  icon,
  ports,
  children,
  headerRight,
}: WorkflowNodeWrapperProps) {
  const { t, i18n } = useTranslation();
  const updateNodeInternals = useUpdateNodeInternals();
  const {
    selectedNodeId,
    setSelectedNodeId,
    setSelectedEdgeId,
    removeNode,
    duplicateNode,
  } = useWorkflowStore();

  const isSelected = selectedNodeId === node.id;
  const inputPorts = ports.filter((p) => p.direction === "input");
  const outputPorts = ports.filter((p) => p.direction === "output");
  const portRowCount = Math.max(inputPorts.length, outputPorts.length);

  useEffect(() => {
    updateNodeInternals(node.id);
  }, [node.id, node.width, i18n.resolvedLanguage, portRowCount, updateNodeInternals]);

  return (
    <div
      onClick={(e) => {
        e.stopPropagation();
        setSelectedNodeId(node.id);
        setSelectedEdgeId(null);
      }}
      className={cn(
        "relative rounded-3xl border transition-all select-none shadow-2xl backdrop-blur-xl",
        "bg-zinc-950/90 border-white/10 text-zinc-100",
        isSelected && "ring-2 ring-primary border-primary shadow-primary/20",
        node.type === "generator" && "border-primary/40 bg-zinc-950/95"
      )}
      style={{ width: `${node.width || 320}px` }}
    >
      {/* Node Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/10 bg-white/5 rounded-t-3xl cursor-grab active:cursor-grabbing">
        <div className="flex items-center gap-2 min-w-0 pointer-events-none">
          <div className="size-6 rounded-lg bg-white/10 border border-white/10 flex items-center justify-center text-primary shrink-0">
            {icon}
          </div>
          <span className="text-xs font-bold text-zinc-100 truncate">
            {node.title}
          </span>
        </div>

        <div className="flex items-center gap-1 text-zinc-400 nodrag nopan">
          {headerRight}

          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              duplicateNode(node.id);
            }}
            className="p-1 rounded-lg hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
            title={t("workflow.wrapper.cloneNode")}
          >
            <CopyIcon className="size-3.5" />
          </button>

          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              removeNode(node.id);
            }}
            className="p-1 rounded-lg hover:text-red-400 hover:bg-red-500/10 transition-colors cursor-pointer"
            title={t("workflow.wrapper.deleteNode")}
          >
            <Trash2Icon className="size-3.5" />
          </button>
        </div>
      </div>

      {portRowCount > 0 && (
        <div className="pt-2">
          {Array.from({ length: portRowCount }, (_, index) => {
            const input = inputPorts[index];
            const output = outputPorts[index];

            return (
              <div key={index} className="relative grid min-h-6 grid-cols-2 items-center gap-4 px-4">
                {input ? (
                  <div className="min-w-0">
                    <Handle
                      type="target"
                      position={Position.Left}
                      id={input.id}
                      className={cn(
                        "!size-4 !rounded-full !border-2 !shadow-md transition-all !pointer-events-auto cursor-crosshair",
                        input.type === "text"
                          ? "!bg-purple-950 !border-purple-400 !shadow-purple-500/30"
                          : "!bg-cyan-950 !border-cyan-400 !shadow-cyan-500/30"
                      )}
                      title={t("workflow.wrapper.inputPortTitle", {
                        name: t(input.name),
                        type: input.type === "text" ? t("workflow.wrapper.portTypeText") : t("workflow.wrapper.portTypeImage"),
                      })}
                    />
                    <span className="block text-[10px] leading-4 text-zinc-400 font-mono pointer-events-none break-words">
                      {t(input.name)}
                    </span>
                  </div>
                ) : <div />}
                {output && (
                  <div className="min-w-0 text-right">
                    <span className="block text-[10px] leading-4 text-zinc-400 font-mono pointer-events-none break-words">
                      {t(output.name)}
                    </span>
                    <Handle
                      type="source"
                      position={Position.Right}
                      id={output.id}
                      className={cn(
                        "!size-4 !rounded-full !border-2 !shadow-md transition-all hover:scale-125 !pointer-events-auto cursor-crosshair",
                        output.type === "text"
                          ? "!bg-purple-950 !border-purple-400 !shadow-purple-500/30"
                          : "!bg-cyan-950 !border-cyan-400 !shadow-cyan-500/30"
                      )}
                      title={t("workflow.wrapper.outputPortTitle", { name: t(output.name) })}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Node Content Body */}
      <div className="px-4 pb-4 pt-1 space-y-3 nodrag nopan">
        {children}
      </div>
    </div>
  );
}
