import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  DownloadIcon,
  EyeIcon,
  Maximize2Icon,
  SparklesIcon,
} from "lucide-react";
import {
  ReactCompareSlider,
  ReactCompareSliderImage,
} from "react-compare-slider";
import { WorkflowNode, useWorkflowStore } from "../../../stores/useWorkflowStore";
import { WorkflowNodeWrapper, WorkflowPortDef } from "./WorkflowNodeWrapper";
import { Button } from "../../ui/button";
import { downloadFile } from "../../../utils/file";
import { useFreeCanvasStore } from "../../../stores/useFreeCanvasStore";
import { useLightboxStore } from "../../../stores/useLightboxStore";

const PORTS: WorkflowPortDef[] = [
  { id: "image", name: "workflow.port.inputImage", type: "image", direction: "input" },
];

export function PreviewNode({ node }: { node: WorkflowNode }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { edges, nodes } = useWorkflowStore();
  const addExternalImage = useFreeCanvasStore((state) => state.addExternalImage);
  const openLightbox = useLightboxStore((state) => state.open);
  const [comparePos, setComparePos] = useState(50);

  // Find incoming image dynamically if not directly set
  let displayUrl = node.data.previewUrl;
  let compareUrl = node.data.compareUrl;

  const incomingEdge = edges.find(
    (e) => e.toNodeId === node.id && e.toPort === "image"
  );
  if (incomingEdge) {
    const sourceNode = nodes.find((n) => n.id === incomingEdge.fromNodeId);
    if (sourceNode?.type === "generator" && sourceNode.data.outputImageUrl) {
      displayUrl = sourceNode.data.outputImageUrl;
    } else if (sourceNode?.type === "image" && sourceNode.data.imageUrl) {
      displayUrl = sourceNode.data.imageUrl;
    }
  }

  const handleSendToFreeCanvas = async () => {
    if (!displayUrl) return;
    const sourceGenerator =
      incomingEdge &&
      nodes.find((item) => item.id === incomingEdge.fromNodeId);
    const cardId = await addExternalImage({
      url: displayUrl,
      name: t("workflow.preview.artworkName", { id: node.id.slice(-4) }),
      origin: "workflow",
      galleryNanoid:
        sourceGenerator?.type === "generator"
          ? sourceGenerator.data.galleryNanoid
          : undefined,
      compareUrl,
    });
    if (!cardId) return;
    navigate("/");
    toast.success(t("workflow.preview.sentToFreeCanvasToast"));
  };

  return (
    <WorkflowNodeWrapper
      node={node}
      icon={<EyeIcon className="size-3.5" />}
      ports={PORTS}
      headerRight={
        displayUrl && (
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={() =>
                openLightbox({
                  url: displayUrl!,
                  title: t("workflow.preview.artworkName", {
                    id: node.id.slice(-4),
                  }),
                  subtitle: t("workflow.preview.altFinalPreview"),
                  compareSrc: compareUrl,
                  fileName: `flow_${node.id}.png`,
                })
              }
              className="text-zinc-400 hover:text-white"
              title={t("preview.viewLarge")}
              aria-label={t("preview.viewLarge")}
            >
              <Maximize2Icon className="size-3" />
            </Button>
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={() => downloadFile(displayUrl!, `flow_result_${node.id}.png`)}
              className="text-zinc-400 hover:text-white"
              title={t("workflow.preview.downloadTitle")}
            >
              <DownloadIcon className="size-3" />
            </Button>
          </div>
        )
      }
    >
      <div className="flex flex-col gap-2.5">
        {displayUrl ? (
          <div className="flex flex-col gap-2">
            {/* Image viewer container */}
            <div className="relative rounded-xl overflow-hidden border border-white/10 bg-black/60 aspect-square flex items-center justify-center">
              {compareUrl ? (
                // Split slider comparison. Reuses react-compare-slider so the
                // original stays a clipped full-size image instead of being
                // squeezed into the revealed width.
                <ReactCompareSlider
                  className="h-full w-full"
                  defaultPosition={comparePos}
                  onPositionChange={setComparePos}
                  itemOne={
                    <ReactCompareSliderImage
                      src={compareUrl}
                      alt={t("workflow.preview.altOriginal")}
                      style={{
                        objectFit: "contain",
                        width: "100%",
                        height: "100%",
                      }}
                    />
                  }
                  itemTwo={
                    <ReactCompareSliderImage
                      src={displayUrl}
                      alt={t("workflow.preview.altCurrent")}
                      style={{
                        objectFit: "contain",
                        width: "100%",
                        height: "100%",
                      }}
                    />
                  }
                />
              ) : (
                <img
                  src={displayUrl}
                  alt={t("workflow.preview.altFinalPreview")}
                  className="w-full h-full object-contain"
                />
              )}
            </div>

            {/* Quick Actions */}
            <div className="flex items-center justify-between gap-2 pt-1">
              <Button
                variant="outline"
                size="xs"
                onClick={() => void handleSendToFreeCanvas()}
                className="flex-1 h-7 border-white/10 bg-white/5 hover:bg-white/10 text-zinc-200 text-xs gap-1"
                title={t("workflow.preview.freeCanvasTitle")}
              >
                <SparklesIcon className="size-3 text-primary" />
                {t("workflow.preview.sendToFreeCanvas")}
              </Button>

              <Button
                variant="outline"
                size="xs"
                onClick={() => downloadFile(displayUrl!, `flow_${node.id}.png`)}
                className="h-7 border-white/10 bg-white/5 hover:bg-white/10 text-zinc-300 text-xs px-2.5"
                title={t("workflow.preview.saveImageTitle")}
              >
                <DownloadIcon className="size-3" />
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center p-8 border border-dashed border-white/10 rounded-xl bg-black/30 text-center">
            <EyeIcon className="size-8 text-zinc-600 mb-2" />
            <span className="text-xs text-zinc-400 font-medium">{t("workflow.preview.noImage")}</span>
            <span className="text-[10px] text-zinc-400 mt-0.5">
              {t("workflow.preview.connectHint")}
            </span>
          </div>
        )}
      </div>
    </WorkflowNodeWrapper>
  );
}
