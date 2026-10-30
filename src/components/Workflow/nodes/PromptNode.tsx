import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  FileTextIcon,
  Loader2Icon,
  SparklesIcon,
} from "lucide-react";
import { WorkflowNode, useWorkflowStore } from "../../../stores/useWorkflowStore";
import { WorkflowNodeWrapper, WorkflowPortDef } from "./WorkflowNodeWrapper";
import { Button } from "../../ui/button";
import { Textarea } from "../../ui/textarea";
import { Input } from "../../ui/input";
import { useConfigStore } from "../../../stores/useConfigStore";
import { polishPrompt } from "../../../services/llmAssistant";
import { applyServerLlmOverlay } from "../../../services/effectiveConfig";

const PORTS: WorkflowPortDef[] = [
  { id: "output", name: "workflow.port.prompt", type: "text", direction: "output" },
];

const PRESET_CHIPS = [
  "workflow.prompt.chipMasterpiece",
  "workflow.prompt.chipCyberpunk",
  "workflow.prompt.chipGhibli",
  "workflow.prompt.chipUltraHd",
  "workflow.prompt.chipTyndall",
  "workflow.prompt.chipClayBlindBox",
];

export function PromptNode({ node }: { node: WorkflowNode }) {
  const { t } = useTranslation();
  const { updateNodeData } = useWorkflowStore();
  const { llmConfig, corsProxy, corsProxyMode } = useConfigStore();
  const [isPolishing, setIsPolishing] = useState(false);
  const [showNegative, setShowNegative] = useState(false);

  const promptText = node.data.promptText ?? "";
  const negativePrompt = node.data.negativePrompt ?? "";

  const handlePolish = async () => {
    if (!promptText.trim()) return toast.warning(t("workflow.prompt.enterBasePromptFirst"));
    setIsPolishing(true);
    try {
      const res = await polishPrompt(
        promptText,
        applyServerLlmOverlay({ ...llmConfig, corsProxy, corsProxyMode }),
        "enhance"
      );
      updateNodeData(node.id, { promptText: res });
      toast.success(t("workflow.prompt.polishDone"));
    } catch (e) {
      toast.error(t("workflow.prompt.polishFailed", { message: e instanceof Error ? e.message : String(e) }));
    } finally {
      setIsPolishing(false);
    }
  };

  const addChip = (text: string) => {
    const next = promptText ? `${promptText}, ${text}` : text;
    updateNodeData(node.id, { promptText: next });
  };

  return (
    <WorkflowNodeWrapper
      node={node}
      icon={<FileTextIcon className="size-3.5" />}
      ports={PORTS}
      headerRight={
        <Button
          variant="ghost"
          size="xs"
          disabled={isPolishing}
          onClick={handlePolish}
          className="h-6 px-1.5 text-[11px] text-purple-300 hover:text-white hover:bg-purple-500/20"
          title={t("workflow.prompt.polishTitle")}
        >
          {isPolishing ? (
            <Loader2Icon className="size-3 animate-spin mr-1" />
          ) : (
            <SparklesIcon className="size-3 mr-1" />
          )}
          {t("workflow.prompt.polish")}
        </Button>
      }
    >
      <div className="flex flex-col gap-2">
        <Textarea
          placeholder={t("workflow.prompt.promptPlaceholder")}
          value={promptText}
          onChange={(e) => updateNodeData(node.id, { promptText: e.target.value })}
          className="min-h-[85px] text-xs bg-black/40 border-white/10 text-zinc-100 placeholder:text-zinc-500 font-sans resize-y"
        />

        {/* Quick Style Chips */}
        <div className="flex flex-wrap gap-1">
          {PRESET_CHIPS.map((chip) => (
            <button
              key={chip}
              type="button"
              onClick={() => addChip(t(chip))}
              className="px-1.5 py-0.5 rounded-md bg-white/5 hover:bg-white/10 border border-white/5 text-[10px] text-zinc-400 hover:text-white transition-colors"
            >
              + {t(chip)}
            </button>
          ))}
        </div>

        {/* Negative Prompt Collapsible */}
        <div className="pt-1">
          <button
            type="button"
            onClick={() => setShowNegative(!showNegative)}
            className="text-[10px] text-zinc-400 hover:text-zinc-200 transition-colors"
          >
            {showNegative ? t("workflow.prompt.negativeCollapse") : t("workflow.prompt.negativeExpand")}
          </button>
          {showNegative && (
            <Input
              placeholder={t("workflow.prompt.negativePlaceholder")}
              value={negativePrompt}
              onChange={(e) =>
                updateNodeData(node.id, { negativePrompt: e.target.value })
              }
              className="mt-1.5 h-7 text-xs bg-black/40 border-white/10 text-zinc-200 placeholder:text-zinc-500"
            />
          )}
        </div>
      </div>
    </WorkflowNodeWrapper>
  );
}
