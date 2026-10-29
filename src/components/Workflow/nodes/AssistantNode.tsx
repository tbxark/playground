import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  CheckIcon,
  CopyIcon,
  LanguagesIcon,
  Loader2Icon,
  ScanEyeIcon,
  SparklesIcon,
  UploadIcon,
  XIcon,
} from "lucide-react";
import { WorkflowNode, useWorkflowStore } from "../../../stores/useWorkflowStore";
import { WorkflowNodeWrapper, WorkflowPortDef } from "./WorkflowNodeWrapper";
import { Button } from "../../ui/button";
import { useLightboxStore } from "../../../stores/useLightboxStore";
import { cn } from "@/utils/cn";

const PORTS: WorkflowPortDef[] = [
  { id: "text", name: "workflow.port.inputText", type: "text", direction: "input" },
  { id: "image", name: "workflow.port.referencePicture", type: "image", direction: "input" },
  { id: "output", name: "workflow.port.outputPrompt", type: "text", direction: "output" },
];

export function AssistantNode({ node }: { node: WorkflowNode }) {
  const { t } = useTranslation();
  const { updateNodeData, executeAssistantNode, edges, nodes } = useWorkflowStore();
  const batchRunning = useWorkflowStore((state) => state.batchRunning);
  const stopNode = useWorkflowStore((state) => state.stopNode);
  const openLightbox = useLightboxStore((state) => state.open);
  const [copied, setCopied] = useState(false);

  const mode = node.data.assistantMode || "enhance";
  const isRunning = node.data.status === "running";
  const isDone = node.data.status === "done";
  const isError = node.data.status === "error";

  // Check connected text source
  const textEdge = edges.find(
    (e) => e.toNodeId === node.id && e.toPort === "text"
  );
  const textSourceNode = textEdge
    ? nodes.find((n) => n.id === textEdge.fromNodeId)
    : null;

  const connectedText =
    textSourceNode?.type === "prompt"
      ? textSourceNode.data.promptText
      : textSourceNode?.data.outputPrompt || textSourceNode?.data.promptText;

  // Check connected image source
  const imageEdge = edges.find(
    (e) => e.toNodeId === node.id && e.toPort === "image"
  );
  const imageSourceNode = imageEdge
    ? nodes.find((n) => n.id === imageEdge.fromNodeId)
    : null;

  const connectedImage =
    imageSourceNode?.type === "image"
      ? imageSourceNode.data.imageUrl
      : imageSourceNode?.type === "generator"
      ? imageSourceNode.data.outputImageUrl
      : imageSourceNode?.data.imageUrl;

  const activeImage = connectedImage || node.data.inputImageUrl;

  const handleCopy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
    }
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      if (typeof evt.target?.result === "string") {
        updateNodeData(node.id, { inputImageUrl: evt.target.result });
      }
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  return (
    <WorkflowNodeWrapper
      node={node}
      icon={<SparklesIcon className="size-3.5 text-amber-400 fill-current" />}
      ports={PORTS}
    >
      <div className="flex flex-col gap-3">
        {/* Mode Selector Segment */}
        <div className="flex items-center gap-1 bg-white/5 p-1 rounded-xl border border-white/10 text-xs">
          <button
            type="button"
            onClick={() => updateNodeData(node.id, { assistantMode: "enhance" })}
            className={cn(
              "flex-1 py-1 rounded-lg text-[11px] font-semibold transition-all cursor-pointer flex items-center justify-center gap-1",
              mode === "enhance"
                ? "bg-amber-500 text-zinc-950 font-bold shadow-md"
                : "text-zinc-400 hover:text-white"
            )}
            title={t("workflow.assistant.enhanceTitle")}
          >
            <SparklesIcon className="size-3" />
            <span>{t("workflow.assistant.modeEnhance")}</span>
          </button>

          <button
            type="button"
            onClick={() => updateNodeData(node.id, { assistantMode: "vision" })}
            className={cn(
              "flex-1 py-1 rounded-lg text-[11px] font-semibold transition-all cursor-pointer flex items-center justify-center gap-1",
              mode === "vision"
                ? "bg-cyan-500 text-zinc-950 font-bold shadow-md"
                : "text-zinc-400 hover:text-white"
            )}
            title={t("workflow.assistant.visionTitle")}
          >
            <ScanEyeIcon className="size-3" />
            <span>{t("workflow.assistant.modeVision")}</span>
          </button>

          <button
            type="button"
            onClick={() => updateNodeData(node.id, { assistantMode: "translate" })}
            className={cn(
              "flex-1 py-1 rounded-lg text-[11px] font-semibold transition-all cursor-pointer flex items-center justify-center gap-1",
              mode === "translate"
                ? "bg-blue-500 text-white font-bold shadow-md"
                : "text-zinc-400 hover:text-white"
            )}
            title={t("workflow.assistant.translateTitle")}
          >
            <LanguagesIcon className="size-3" />
            <span>{t("workflow.assistant.modeTranslate")}</span>
          </button>
        </div>

        {/* Input Area Depending on Mode */}
        {mode === "vision" ? (
          <div className="flex flex-col gap-1.5">
            <span className="text-[11px] text-zinc-400 font-medium flex items-center justify-between">
              <span>{t("workflow.assistant.imageSource")}</span>
              {imageEdge && (
                <span className="text-[10px] text-cyan-400 font-mono">
                  {t("workflow.assistant.connectedFrom", { node: imageSourceNode?.title || t("workflow.assistant.upstreamNode") })}
                </span>
              )}
            </span>

            {activeImage ? (
              <div className="relative aspect-video w-full rounded-xl overflow-hidden border border-white/10 bg-black/40 group/img">
                <button
                  type="button"
                  onClick={() =>
                    openLightbox({
                      url: activeImage,
                      title: node.title,
                      subtitle: t("workflow.assistant.altVisionInput"),
                      fileName: `workflow_${node.id}.png`,
                    })
                  }
                  aria-label={t("preview.openAria", {
                    name: t("workflow.assistant.altVisionInput"),
                  })}
                  className="absolute inset-0 cursor-zoom-in"
                >
                  <img
                    src={activeImage}
                    alt={t("workflow.assistant.altVisionInput")}
                    className="w-full h-full object-cover"
                  />
                </button>
                {!imageEdge && (
                  <button
                    type="button"
                    onClick={() => updateNodeData(node.id, { inputImageUrl: undefined })}
                    className="absolute top-1.5 right-1.5 z-10 size-5 rounded-full bg-black/60 text-zinc-400 hover:text-white flex items-center justify-center cursor-pointer"
                    title={t("workflow.assistant.removeImage")}
                  >
                    <XIcon className="size-3" />
                  </button>
                )}
              </div>
            ) : (
              <label
                htmlFor={`upload-vision-${node.id}`}
                className="h-20 rounded-xl border border-dashed border-white/20 hover:border-cyan-400/50 flex flex-col items-center justify-center gap-1 cursor-pointer bg-white/[0.02] hover:bg-white/[0.04] transition-all"
              >
                <UploadIcon className="size-4 text-zinc-400" />
                <span className="text-[11px] text-zinc-400">{t("workflow.assistant.uploadHint")}</span>
                <input
                  id={`upload-vision-${node.id}`}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleImageUpload}
                />
              </label>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-1.5">
            <span className="text-[11px] text-zinc-400 font-medium flex items-center justify-between">
              <span>{t("workflow.assistant.draftLabel")}</span>
              {textEdge && (
                <span className="text-[10px] text-purple-400 font-mono">
                  {t("workflow.assistant.connectedFrom", { node: textSourceNode?.title || t("workflow.assistant.upstreamNode") })}
                </span>
              )}
            </span>

            {textEdge && connectedText ? (
              <div className="p-2 rounded-xl bg-purple-950/30 border border-purple-500/30 text-zinc-200 text-xs leading-relaxed max-h-20 overflow-y-auto">
                {connectedText}
              </div>
            ) : (
              <textarea
                rows={2}
                value={node.data.inputPrompt || ""}
                onChange={(e) => updateNodeData(node.id, { inputPrompt: e.target.value })}
                placeholder={mode === "translate" ? t("workflow.assistant.placeholderTranslate") : t("workflow.assistant.placeholderDraft")}
                className="w-full rounded-xl bg-zinc-900 border border-white/10 p-2 text-xs text-zinc-100 placeholder:text-zinc-500 resize-none outline-none focus:border-amber-400/50"
              />
            )}
          </div>
        )}

        {/* Generate CTA Button */}
        <div className="flex items-center gap-1.5">
        <Button
          size="sm"
          disabled={isRunning || batchRunning}
          onClick={() => void executeAssistantNode(node.id)}
          className={cn(
            "h-8 rounded-xl text-xs font-bold gap-1.5 transition-all cursor-pointer shadow-md",
            mode === "vision"
              ? "bg-cyan-500 hover:bg-cyan-400 text-zinc-950"
              : "bg-amber-500 hover:bg-amber-400 text-zinc-950"
          )}
        >
          {isRunning ? (
            <>
              <Loader2Icon className="size-3.5 animate-spin" />
              <span>{node.data.statusText || t("workflow.assistant.thinkingStatus")}</span>
            </>
          ) : (
            <>
              <SparklesIcon className="size-3.5" />
              <span>{mode === "vision" ? t("workflow.assistant.actionVision") : mode === "translate" ? t("workflow.assistant.actionTranslate") : t("workflow.assistant.actionEnhance")}</span>
            </>
          )}
        </Button>
        {isRunning && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => stopNode(node.id)}
            className="h-8 shrink-0 cursor-pointer border-white/20 bg-transparent text-xs text-zinc-200 hover:bg-white/10"
          >
            {t("workflow.generator.stop")}
          </Button>
        )}
        </div>

        {/* Output Prompt Result Box */}
        {(node.data.outputPrompt || isDone || isError) && (
          <div className="flex flex-col gap-1.5 pt-2 border-t border-white/5">
            <div className="flex items-center justify-between text-[11px]">
              <span className="font-bold text-zinc-300 flex items-center gap-1">
                <span className="size-1.5 rounded-full bg-purple-400 animate-pulse" />
                <span>{t("workflow.assistant.outputLabel")}</span>
              </span>

              {node.data.outputPrompt && (
                <button
                  type="button"
                  onClick={() => handleCopy(node.data.outputPrompt ?? node.data.promptText ?? "")}
                  className="text-[10px] text-zinc-400 hover:text-white flex items-center gap-1 cursor-pointer"
                >
                  {copied ? (
                    <>
                      <CheckIcon className="size-3 text-emerald-400" />
                      <span className="text-emerald-400">{t("common.copied")}</span>
                    </>
                  ) : (
                    <>
                      <CopyIcon className="size-3" />
                      <span>{t("common.copy")}</span>
                    </>
                  )}
                </button>
              )}
            </div>

            {isError ? (
              <div className="p-2 rounded-xl bg-red-950/40 border border-red-500/30 text-xs text-red-300 leading-relaxed">
                {node.data.error || t("workflow.assistant.generationFailed")}
              </div>
            ) : (
              <textarea
                rows={3}
                // Generated text lives in `outputPrompt` (runtime). A manual
                // edit writes the non-runtime `promptText` and clears
                // `outputPrompt`, so ⌘Z actually reverts what the user typed
                // instead of restoring a hidden field the textarea ignores.
                value={node.data.outputPrompt ?? node.data.promptText ?? ""}
                onChange={(e) =>
                  updateNodeData(node.id, {
                    promptText: e.target.value,
                    outputPrompt: undefined,
                  })
                }
                className="w-full rounded-xl bg-purple-950/20 border border-purple-500/30 p-2 text-xs text-zinc-100 leading-relaxed font-sans resize-none outline-none focus:border-purple-400"
                placeholder={t("workflow.assistant.outputPlaceholder")}
              />
            )}
          </div>
        )}
      </div>
    </WorkflowNodeWrapper>
  );
}
