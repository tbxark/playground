import React from "react";
import { Handle, Position } from "@xyflow/react";
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
  const { t } = useTranslation();
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
      {/* Input Handles */}
      {inputPorts.map((port, idx) => (
        <div
          key={port.id}
          style={{ top: `${56 + idx * 36}px` }}
          className="absolute -left-3 -translate-y-1/2 flex items-center gap-1 z-20 pointer-events-auto"
        >
          <Handle
            type="target"
            position={Position.Left}
            id={port.id}
            className={cn(
              "!size-4 !rounded-full !border-2 !shadow-md transition-all !static !transform-none cursor-crosshair",
              port.type === "text"
                ? "!bg-purple-950 !border-purple-400 !shadow-purple-500/30"
                : "!bg-cyan-950 !border-cyan-400 !shadow-cyan-500/30"
            )}
            title={t("workflow.wrapper.inputPortTitle", {
              name: t(port.name),
              type: port.type === "text" ? t("workflow.wrapper.portTypeText") : t("workflow.wrapper.portTypeImage"),
            })}
          />
          <span className="text-[10px] text-zinc-400 font-mono pointer-events-none pl-1">
            {t(port.name)}
          </span>
        </div>
      ))}

      {/* Output Handles */}
      {outputPorts.map((port, idx) => (
        <div
          key={port.id}
          style={{ top: `${56 + idx * 36}px` }}
          className="absolute -right-3 -translate-y-1/2 flex items-center gap-1 z-20 pointer-events-auto"
        >
          <span className="text-[10px] text-zinc-400 font-mono pointer-events-none pr-1">
            {t(port.name)}
          </span>
          <Handle
            type="source"
            position={Position.Right}
            id={port.id}
            className={cn(
              "!size-4 !rounded-full !border-2 !shadow-md transition-all hover:scale-125 !static !transform-none cursor-crosshair",
              port.type === "text"
                ? "!bg-purple-950 !border-purple-400 !shadow-purple-500/30"
                : "!bg-cyan-950 !border-cyan-400 !shadow-cyan-500/30"
            )}
            title={t("workflow.wrapper.outputPortTitle", { name: t(port.name) })}
          />
        </div>
      ))}

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

      {/* Node Content Body */}
      <div className="p-4 space-y-3 nodrag nopan">
        {children}
      </div>
    </div>
  );
}
