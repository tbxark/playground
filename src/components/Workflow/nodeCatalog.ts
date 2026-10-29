import type { ComponentType } from "react";
import {
  FileTextIcon,
  ImageIcon,
  SparklesIcon,
  Wand2Icon,
  ZapIcon,
} from "lucide-react";
import type { WorkflowNodeType, WorkflowPortType } from "../../stores/useWorkflowStore";

/**
 * One place for the node list shown in the toolbar, the empty state and the
 * help dialog, so adding a node type never leaves one of them stale.
 */
export type WorkflowNodeMenuItem = {
  type: WorkflowNodeType;
  labelKey: string;
  icon: ComponentType<{ className?: string }>;
  color: string;
};

export type WorkflowPortHelp = {
  nameKey: string;
  type: WorkflowPortType;
};

export type WorkflowNodeHelpEntry = WorkflowNodeMenuItem & {
  descriptionKey: string;
  inputs: WorkflowPortHelp[];
  outputs: WorkflowPortHelp[];
};

export const WORKFLOW_NODE_MENU: readonly WorkflowNodeMenuItem[] = [
  { type: "prompt", labelKey: "workflow.canvas.nodeNamePrompt", icon: FileTextIcon, color: "text-purple-400" },
  { type: "image", labelKey: "workflow.canvas.nodeNameImage", icon: ImageIcon, color: "text-cyan-400" },
  { type: "assistant", labelKey: "workflow.canvas.nodeNameAssistant", icon: Wand2Icon, color: "text-amber-400" },
  { type: "generator", labelKey: "workflow.canvas.nodeNameGenerator", icon: ZapIcon, color: "text-emerald-400" },
  { type: "preview", labelKey: "workflow.canvas.nodeNamePreview", icon: SparklesIcon, color: "text-blue-400" },
];

/**
 * The port type a node's output emits, or null when the node has no output.
 * Kept here next to the help data so the canvas, the store and import all
 * agree on what "same colour" means.
 */
export function workflowSourcePortType(
  type: WorkflowNodeType
): WorkflowPortType | null {
  switch (type) {
    case "prompt":
    case "assistant":
      return "text";
    case "image":
    case "generator":
      return "image";
    default:
      return null;
  }
}

/** The port type a given input port accepts, or null for an unknown node. */
export function workflowTargetPortType(
  type: WorkflowNodeType,
  port: string | null | undefined
): WorkflowPortType | null {
  if (type === "generator" || type === "assistant") {
    return port === "image" ? "image" : "text";
  }
  if (type === "preview") return "image";
  return null;
}

/**
 * Data only flows between ports of the same colour. Without this check a
 * prompt→generator image edge was accepted, coloured and counted in the badge
 * while execution silently ignored it.
 */
export function isWorkflowConnectionTypeCompatible(
  sourceType: WorkflowNodeType | undefined,
  targetType: WorkflowNodeType | undefined,
  targetPort: string | null | undefined
): boolean {
  if (!sourceType || !targetType) return false;
  const source = workflowSourcePortType(sourceType);
  const target = workflowTargetPortType(targetType, targetPort);
  if (!source || !target) return false;
  return source === target;
}

/**
 * Port lists are display-only copies of each node's `PORTS`; keep them in sync
 * with the corresponding node component when a port is added or renamed.
 */
export const WORKFLOW_NODE_HELP: readonly WorkflowNodeHelpEntry[] = [
  {
    ...WORKFLOW_NODE_MENU[0],
    descriptionKey: "workflow.help.nodePromptDesc",
    inputs: [],
    outputs: [{ nameKey: "workflow.port.prompt", type: "text" }],
  },
  {
    ...WORKFLOW_NODE_MENU[1],
    descriptionKey: "workflow.help.nodeImageDesc",
    inputs: [],
    outputs: [{ nameKey: "workflow.port.imageOutput", type: "image" }],
  },
  {
    ...WORKFLOW_NODE_MENU[2],
    descriptionKey: "workflow.help.nodeAssistantDesc",
    inputs: [
      { nameKey: "workflow.port.inputText", type: "text" },
      { nameKey: "workflow.port.referencePicture", type: "image" },
    ],
    outputs: [{ nameKey: "workflow.port.outputPrompt", type: "text" }],
  },
  {
    ...WORKFLOW_NODE_MENU[3],
    descriptionKey: "workflow.help.nodeGeneratorDesc",
    inputs: [
      { nameKey: "workflow.port.prompt", type: "text" },
      { nameKey: "workflow.port.referenceImage", type: "image" },
    ],
    outputs: [{ nameKey: "workflow.port.resultImage", type: "image" }],
  },
  {
    ...WORKFLOW_NODE_MENU[4],
    descriptionKey: "workflow.help.nodePreviewDesc",
    inputs: [{ nameKey: "workflow.port.inputImage", type: "image" }],
    outputs: [],
  },
];
