import React from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import {
  Loader2Icon,
  PlayIcon,
  SparklesIcon,
  ZapIcon,
} from "lucide-react";
import { WorkflowNode, useWorkflowStore } from "../../../stores/useWorkflowStore";
import { WorkflowNodeWrapper, WorkflowPortDef } from "./WorkflowNodeWrapper";
import { useTranslation } from "react-i18next";
import { modelDisplayName } from "../../../services/imageService";
import { Button } from "../../ui/button";
import { Progress } from "../../ui/progress";
import { useConfigStore } from "../../../stores/useConfigStore";
import { useFreeCanvasStore } from "../../../stores/useFreeCanvasStore";
import { useLightboxStore } from "../../../stores/useLightboxStore";
import { cn } from "@/utils/cn";

const PORTS: WorkflowPortDef[] = [
  { id: "prompt", name: "workflow.port.prompt", type: "text", direction: "input" },
  { id: "image", name: "workflow.port.referenceImage", type: "image", direction: "input" },
  { id: "output", name: "workflow.port.resultImage", type: "image", direction: "output" },
];

const RATIOS = ["1:1", "16:9", "9:16", "4:3", "3:4"];

export function GeneratorNode({ node }: { node: WorkflowNode }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { updateNodeData, executeGeneratorNode, edges, nodes } = useWorkflowStore();
  // A batch run owns the execution loop: letting a per-node button start the
  // same node while the batch is still on an earlier node pays for it twice.
  const batchRunning = useWorkflowStore((state) => state.batchRunning);
  const stopNode = useWorkflowStore((state) => state.stopNode);
  const { imageConfig, selectedModel } = useConfigStore();
  const addExternalImage = useFreeCanvasStore((state) => state.addExternalImage);
  const openLightbox = useLightboxStore((state) => state.open);

  const activeModels = imageConfig.models.filter((m) =>
    imageConfig.enabledModelIds.includes(m.id)
  );

  const model = node.data.model || selectedModel || "";
  const size = node.data.size || "1:1";
  const resolution = node.data.resolution || "1k";

  const isRunning = node.data.status === "running";
  const isDone = node.data.status === "done";
  const isError = node.data.status === "error";
  const modelAvailable = activeModels.some((item) => item.id === model);

  // Check incoming connections (supports multiple prompts and multiple images)
  const promptEdges = edges.filter(
    (e) => e.toNodeId === node.id && e.toPort === "prompt"
  );
  const imageEdges = edges.filter(
    (e) => e.toNodeId === node.id && e.toPort === "image"
  );

  // Collect connected image previews
  const connectedImages: { edgeId: string; url: string }[] = [];
  imageEdges.forEach((e) => {
    const src = nodes.find((n) => n.id === e.fromNodeId);
    if (src?.type === "image" && src.data.imageUrl) {
      connectedImages.push({ edgeId: e.id, url: src.data.imageUrl });
    } else if (src?.type === "generator" && src.data.outputImageUrl) {
      connectedImages.push({ edgeId: e.id, url: src.data.outputImageUrl });
    }
  });

  const handleSendToFreeCanvas = async () => {
    if (!node.data.outputImageUrl) return;
    const cardId = await addExternalImage({
      url: node.data.outputImageUrl,
      name: t("workflow.generator.artworkName", { model }),
      origin: "workflow",
      galleryNanoid: node.data.galleryNanoid,
    });
    if (!cardId) return;
    navigate("/");
    toast.success(t("workflow.generator.sentToFreeCanvasToast"));
  };

  return (
    <WorkflowNodeWrapper
      node={node}
      icon={<ZapIcon className="size-3.5 fill-current" />}
      ports={PORTS}
    >
      <div className="flex flex-col gap-3">
        {/* Connection status badges */}
        <div className="flex flex-wrap items-center gap-1.5 text-[10px] text-zinc-400 font-mono">
          <span
            className={cn(
              "px-1.5 py-0.5 rounded border",
              promptEdges.length > 0
                ? "bg-purple-950/60 border-purple-500/40 text-purple-300"
                : "bg-white/5 border-white/5 text-zinc-500"
            )}
            title={
              promptEdges.length > 1
                ? t("workflow.generator.promptMergedTitle", { count: promptEdges.length })
                : undefined
            }
          >
            {promptEdges.length > 1
              ? t("workflow.generator.promptConnectedCount", { count: promptEdges.length })
              : promptEdges.length === 1
              ? t("workflow.generator.promptConnected", { node: nodes.find((n) => n.id === promptEdges[0].fromNodeId)?.title || t("workflow.port.prompt") })
              : t("workflow.generator.promptNotConnected")}
          </span>

          <span
            className={cn(
              "px-1.5 py-0.5 rounded border",
              imageEdges.length > 0
                ? "bg-cyan-950/60 border-cyan-500/40 text-cyan-300"
                : "bg-white/5 border-white/5 text-zinc-500"
            )}
            title={
              imageEdges.length > 1
                ? t("workflow.generator.imageMergedTitle", { count: imageEdges.length })
                : undefined
            }
          >
            {imageEdges.length > 1
              ? t("workflow.generator.imageConnectedCount", { count: imageEdges.length })
              : imageEdges.length === 1
              ? t("workflow.generator.imageConnectedSingle", { count: 1 })
              : t("workflow.generator.textOnly")}
          </span>
        </div>

        {/* Thumbnail tray if multiple images connected */}
        {connectedImages.length > 0 && (
          <div className="flex items-center gap-1.5 p-1.5 rounded-xl bg-black/40 border border-white/5 overflow-x-auto">
            <span className="text-[10px] text-zinc-500 shrink-0 font-mono">{t("workflow.generator.inputImages")}</span>
            {connectedImages.map(({ edgeId, url }, imgIndex) => (
              <button
                key={edgeId}
                type="button"
                onClick={() =>
                  openLightbox({
                    url,
                    title: t("workflow.generator.inputImages"),
                    subtitle: t("workflow.generator.altConnectedReference"),
                    fileName: `workflow_input_${node.id}_${imgIndex + 1}.png`,
                  })
                }
                aria-label={t("preview.openAria", {
                  name: t("workflow.generator.altConnectedReference"),
                })}
                className="size-6 shrink-0 cursor-zoom-in overflow-hidden rounded-md border border-white/10"
              >
                <img
                  src={url}
                  alt={t("workflow.generator.altConnectedReference")}
                  className="size-full object-cover"
                />
              </button>
            ))}
          </div>
        )}

        {/* Model selector */}
        <div className="flex flex-col gap-1">
          <span className="text-[11px] text-zinc-400 font-medium">{t("workflow.generator.modelSelect")}</span>
          <select
            value={model}
            onChange={(e) => {
              updateNodeData(node.id, { model: e.target.value });
            }}
            className="h-8 bg-black/40 border border-white/10 rounded-xl px-2.5 text-xs text-zinc-200 outline-none cursor-pointer"
          >
            {!modelAvailable && (
              <option value={model} className="bg-zinc-900 text-white">
                {model || t("controls.selectModel")}
              </option>
            )}
            {activeModels.map((m) => (
              <option
                key={m.id}
                value={m.id}
                className="bg-zinc-900 text-white"
              >
                {modelDisplayName(m)}
              </option>
            ))}
          </select>
        </div>

        {/* Aspect ratio & Resolution */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1">
            {RATIOS.map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => updateNodeData(node.id, { size: r })}
                className={cn(
                  "px-2 py-0.5 rounded-lg text-[10px] font-mono border transition-all cursor-pointer",
                  size === r
                    ? "bg-white text-zinc-950 font-bold border-white shadow-xs"
                    : "bg-white/5 border-transparent text-zinc-400 hover:text-white"
                )}
              >
                {r}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-1">
            {["1k", "2k"].map((res) => (
              <button
                key={res}
                type="button"
                onClick={() => updateNodeData(node.id, { resolution: res })}
                className={cn(
                  "px-1.5 py-0.5 rounded-lg text-[10px] font-mono uppercase border transition-all cursor-pointer",
                  resolution === res
                    ? "bg-white/20 border-white/30 text-white font-bold"
                    : "bg-white/5 border-transparent text-zinc-400 hover:text-white"
                )}
              >
                {res}
              </button>
            ))}
          </div>
        </div>

        {/* Execution Status / Progress */}
        {isRunning && (
          <div className="flex flex-col gap-1.5 p-2 rounded-xl bg-primary/10 border border-primary/20">
            <div className="flex items-center justify-between text-[11px] text-primary font-medium">
              <span className="flex items-center gap-1">
                <Loader2Icon className="size-3 animate-spin" />
                {node.data.statusText || t("workflow.generator.generatingStatus")}
              </span>
              <span className="font-mono">{node.data.progress || 10}%</span>
            </div>
            <Progress value={node.data.progress || 10} className="h-1 bg-primary/20" />
          </div>
        )}

        {isError && (
          <div className="p-2 rounded-xl bg-red-500/10 border border-red-500/20 text-red-300 text-[11px] font-mono leading-tight">
            {t("workflow.generator.failedMessage", { message: node.data.error || t("workflow.generator.unknownError") })}
          </div>
        )}

        {node.data.status === "done" && (
          <div className={cn(
            "flex items-center justify-between gap-2 rounded-xl border p-2 text-[11px]",
            node.data.gallerySaveStatus === "failed"
              ? "border-amber-500/30 bg-amber-500/10 text-amber-200"
              : "border-white/10 bg-white/5 text-zinc-300"
          )}>
            <span>{node.data.gallerySaveStatus === "saved" ? t("workflow.generator.gallerySaved") : node.data.gallerySaveStatus === "saving" ? t("workflow.generator.gallerySaving") : t("workflow.generator.gallerySaveFailed")}</span>
            {node.data.gallerySaveStatus !== "saved" && node.data.gallerySaveStatus !== "saving" && (
              <Button size="xs" variant="outline" onClick={() => void useWorkflowStore.getState().saveNodeResultToGallery(node.id)}>
                {t("workflow.generator.retrySave")}
              </Button>
            )}
          </div>
        )}

        {/* Result Image Output Preview if generated */}
        {isDone && node.data.outputImageUrl && (
          <div className="relative group rounded-xl overflow-hidden border border-white/10 bg-black/40">
            <button
              type="button"
              onClick={() =>
                openLightbox({
                  url: node.data.outputImageUrl!,
                  title: t("workflow.generator.artworkName", { model }),
                  subtitle: `${model} · ${size}`,
                  fileName: `workflow_${node.id}.png`,
                })
              }
              aria-label={t("preview.openAria", {
                name: t("workflow.generator.altGeneratedOutput"),
              })}
              className="block w-full cursor-zoom-in"
            >
              <img
                src={node.data.outputImageUrl}
                alt={t("workflow.generator.altGeneratedOutput")}
                className="w-full h-44 object-contain"
              />
            </button>
            <div className="absolute inset-x-0 bottom-0 bg-black/60 p-2 flex items-center justify-center gap-2 opacity-100">
              <Button
                variant="outline"
                size="xs"
                onClick={() => void handleSendToFreeCanvas()}
                className="h-7 border-white/20 bg-white/10 text-white hover:bg-white hover:text-zinc-950 text-xs gap-1"
                title={t("workflow.generator.freeCanvasButtonTitle")}
              >
                <SparklesIcon className="size-3" />
                {t("workflow.generator.refineInFreeCanvas")}
              </Button>
            </div>
          </div>
        )}

        {/* Generate CTA Button */}
        <div className="flex items-center gap-1.5">
        <Button
          size="sm"
          disabled={isRunning || batchRunning}
          onClick={() => {
            if (!modelAvailable) {
              toast.warning(t("workflow.generator.enableModelWarning"));
              navigate("/settings#image");
              return;
            }
            void executeGeneratorNode(node.id);
          }}
          className={cn(
            "h-8 text-xs font-bold gap-1.5 shadow-lg transition-transform active:scale-95 cursor-pointer",
            isDone
              ? "bg-white/10 hover:bg-white/20 text-white border border-white/15"
              : "bg-white hover:bg-zinc-200 text-zinc-950 shadow-white/10"
          )}
        >
          {isRunning ? (
            <>
              <Loader2Icon className="size-3 animate-spin" />
              <span>{t("workflow.generator.rendering")}</span>
            </>
          ) : isDone ? (
            <>
              <PlayIcon className="size-3 fill-current" />
              <span>{t("workflow.generator.regenerate")}</span>
            </>
            ) : !modelAvailable ? (
              <>
                <PlayIcon className="size-3 fill-current" />
                <span>{t("workflow.generator.goEnableModel")}</span>
              </>
            ) : (
              <>
                <PlayIcon className="size-3 fill-current" />
                <span>{t("workflow.generator.runGenerate")}</span>
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
      </div>
    </WorkflowNodeWrapper>
  );
}
