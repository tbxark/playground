import React, { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  ImageIcon,
  Loader2Icon,
  SparklesIcon,
  UploadCloudIcon,
  XIcon,
} from "lucide-react";
import { WorkflowNode, useWorkflowStore } from "../../../stores/useWorkflowStore";
import { WorkflowNodeWrapper, WorkflowPortDef } from "./WorkflowNodeWrapper";
import { Button } from "../../ui/button";
import { fileToDataUrl } from "../../../utils/file";
import { useFreeCanvasStore } from "../../../stores/useFreeCanvasStore";
import { useLightboxStore } from "../../../stores/useLightboxStore";
import { cn } from "@/utils/cn";

const PORTS: WorkflowPortDef[] = [
  { id: "output", name: "workflow.port.imageOutput", type: "image", direction: "output" },
];

export function ImageNode({ node }: { node: WorkflowNode }) {
  const { t } = useTranslation();
  const { updateNodeData } = useWorkflowStore();
  const mainCard = useFreeCanvasStore((state) =>
    state.cards.find((card) => card.role === "main")
  );
  const exportMainImage = useFreeCanvasStore(
    (state) => state.exportMainImage
  );
  const openLightbox = useLightboxStore((state) => state.open);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isReading, setIsReading] = useState(false);

  const imageUrl = node.data.imageUrl;

  const handleFileUpload = async (file: File) => {
    if (isReading) return;
    setIsReading(true);
    try {
      const dataUrl = await fileToDataUrl(file);
      const img = new Image();
      img.onload = () => {
        setIsReading(false);
        // Bytes go to IndexedDB behind an asset key: node data is persisted to
        // localStorage, where a multi-MB base64 image would fill the quota and
        // break every later graph write.
        void useWorkflowStore.getState().importImageData({
          nodeId: node.id,
          dataUrl,
          imageName: file.name,
          width: img.naturalWidth || 800,
          height: img.naturalHeight || 800,
        });
      };
      // A non-image or corrupt file decodes to an error; without this the node
      // stayed silent and never received the upload.
      img.onerror = () => {
        setIsReading(false);
        toast.error(
          t("workflow.image.readFailed", { message: file.name })
        );
      };
      img.src = dataUrl;
    } catch (e) {
      setIsReading(false);
      toast.error(t("workflow.image.readFailed", { message: e instanceof Error ? e.message : String(e) }));
    }
  };

  const handleImportFromFreeCanvas = async () => {
    if (!mainCard?.url) {
      return toast.warning(t("workflow.image.noFreeCanvasArtwork"));
    }
    const dataUrl = await exportMainImage();
    if (!dataUrl) {
      return toast.error(t("workflow.image.readFailed", { message: mainCard.name }));
    }
    void useWorkflowStore.getState().importImageData({
      nodeId: node.id,
      dataUrl,
      imageName: mainCard.name || t("workflow.image.fromFreeCanvasName"),
      width: mainCard.naturalWidth,
      height: mainCard.naturalHeight,
    });
    toast.success(t("workflow.image.importedFromFreeCanvas"));
  };

  return (
    <WorkflowNodeWrapper
      node={node}
      icon={<ImageIcon className="size-3.5" />}
      ports={PORTS}
    >
      <div className="flex flex-col gap-2.5">
        {imageUrl ? (
          <div className="relative rounded-xl overflow-hidden border border-white/10 bg-black/40">
            <button
              type="button"
              onClick={() =>
                openLightbox({
                  url: imageUrl,
                  title: node.data.imageName || node.title,
                  subtitle: t("workflow.image.altReferencePreview"),
                  fileName: `workflow_${node.id}.png`,
                })
              }
              aria-label={t("preview.openAria", {
                name: node.data.imageName || node.title,
              })}
              className="block w-full cursor-zoom-in"
            >
              <img
                src={imageUrl}
                alt={t("workflow.image.altReferencePreview")}
                className="w-full h-44 object-contain"
              />
            </button>
            <Button
              variant="destructive"
              size="icon-xs"
              aria-label={t("workflow.image.removeImage")}
              title={t("workflow.image.removeImage")}
              onClick={() =>
                updateNodeData(node.id, {
                  imageUrl: undefined,
                  imageName: undefined,
                })
              }
              className="absolute right-1.5 top-1.5 z-10 size-8 shadow-lg"
            >
              <XIcon className="size-3.5" />
            </Button>
            {node.data.imageDimensions && (
              <div className="absolute bottom-1.5 left-1.5 px-1.5 py-0.5 rounded bg-black/75 text-[10px] font-mono text-zinc-300 pointer-events-none">
                {node.data.imageDimensions.width} × {node.data.imageDimensions.height}px
              </div>
            )}
          </div>
        ) : (
          <div
            className={cn(
              "flex flex-col items-center justify-center p-6 border border-dashed border-white/15 rounded-xl bg-black/30 transition-colors text-center",
              isReading
                ? "cursor-progress"
                : "cursor-pointer hover:bg-black/40 hover:border-primary/50"
            )}
            aria-busy={isReading}
            onClick={() => {
              if (!isReading) fileInputRef.current?.click();
            }}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const f = e.dataTransfer.files?.[0];
              if (f) void handleFileUpload(f);
            }}
          >
            {isReading ? (
              <Loader2Icon className="size-6 text-primary animate-spin mb-1.5" />
            ) : (
              <UploadCloudIcon className="size-6 text-zinc-400 mb-1.5 group-hover:text-primary" />
            )}
            <span className="text-xs font-medium text-zinc-300">
              {isReading ? t("common.loading") : t("workflow.image.uploadHint")}
            </span>
            <span className="text-[10px] text-zinc-400 mt-0.5">{t("workflow.image.formatsHint")}</span>
          </div>
        )}

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          disabled={isReading}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void handleFileUpload(f);
            e.target.value = "";
          }}
        />

        {mainCard?.url && !imageUrl && (
          <Button
            variant="outline"
            size="xs"
            onClick={() => void handleImportFromFreeCanvas()}
            className="h-7 border-white/10 bg-white/5 hover:bg-white/10 text-zinc-300 text-[11px]"
          >
            <SparklesIcon className="size-3 mr-1 text-primary" />
            {t("workflow.image.importFromFreeCanvas")}
          </Button>
        )}
      </div>
    </WorkflowNodeWrapper>
  );
}
