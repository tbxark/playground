import { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  getMainCard,
  getReferenceCards,
  useFreeCanvasStore,
} from "../stores/useFreeCanvasStore";
import { usePromptStore } from "../stores/usePromptStore";
import { useConfigStore } from "../stores/useConfigStore";
import { useQueueStore } from "../stores/useQueueStore";
import { GenerateParams } from "../services/types";

export type GenerateMode = "canvas" | "simple";

/**
 * Single assembly point for generation parameters. The canvas command bar, the
 * global mod+enter shortcut and the simple page all call this; there is no
 * second copy of the main/reference/mask or simple-image logic.
 *
 * Returns the queue task ids created by this call (empty when nothing was
 * queued).
 */
export function useGenerateAction(mode: GenerateMode = "canvas") {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const generate = useCallback(async (): Promise<string[]> => {
    const promptState = usePromptStore.getState();
    const config = useConfigStore.getState();
    const canvas = useFreeCanvasStore.getState();

    if (mode === "simple") {
      if (!config.imageConfig.enabledModelIds.includes(config.selectedModel)) {
        toast.warning(t("freeCanvas.toastEnableModelInSettings"));
        navigate("/settings#image");
        return [];
      }

      const prompt = promptState.prompt.trim();
      const imageUrls = await canvas.resolveSimpleImageUrls();
      if (!prompt && imageUrls.length === 0) {
        toast.warning(t("simple.needInput"));
        return [];
      }

      const params: GenerateParams = {
        providerId: "openai",
        model: config.selectedModel,
        prompt,
        negativePrompt: promptState.negativePrompt.trim() || undefined,
        imageUrls: imageUrls.length > 0 ? imageUrls : undefined,
        size: promptState.size,
        resolution: promptState.resolution,
        seed: promptState.seed,
        cfgScale: promptState.cfgScale,
        steps: promptState.steps,
      };

      const taskIds = useQueueStore
        .getState()
        .enqueueBatch(params, promptState.batchCount);
      if (taskIds.length === 0) return [];
      toast.info(
        t("freeCanvas.toastQueuedImages", { count: taskIds.length })
      );
      return taskIds;
    }

    const main = getMainCard(canvas.cards);
    const references = getReferenceCards(canvas.cards);
    const prompt = promptState.prompt.trim();

    if (!prompt && !main && references.length === 0) {
      toast.warning(t("freeCanvas.toastNeedPromptOrReference"));
      return [];
    }

    if (!config.imageConfig.enabledModelIds.includes(config.selectedModel)) {
      toast.warning(t("freeCanvas.toastEnableModelInSettings"));
      navigate("/settings#image");
      return [];
    }

    let imageUrls: string[] | undefined;
    let maskUrl: string | undefined;

    if (main) {
      const exported = await canvas.exportMainForRequest();
      if (!exported) return [];

      imageUrls = [exported.baseUrl];
      maskUrl = exported.maskUrl;

      const referenceUrls = await canvas.activeReferenceUrls();
      referenceUrls.forEach((url) => {
        if (url && imageUrls && !imageUrls.includes(url)) {
          imageUrls.push(url);
        }
      });
    } else {
      const referenceUrls = await canvas.activeReferenceUrls();
      imageUrls = referenceUrls.length > 0 ? referenceUrls : undefined;
    }

    // Canvas expansion is baked into the main image now, so there is no
    // hidden "this is an outpaint request" state to append a default prompt for.
    const effectivePrompt = prompt;

    // The earlier guard counts cards, not resolvable inputs: after gallery LRU
    // trimming a reference can exist as a `missing` card and be skipped by
    // activeReferenceUrls, which used to enqueue an empty request.
    if (!effectivePrompt && (imageUrls?.length ?? 0) === 0) {
      toast.warning(t("freeCanvas.toastNeedPromptOrReference"));
      return [];
    }

    const params: GenerateParams = {
      providerId: "openai",
      model: config.selectedModel,
      prompt: effectivePrompt,
      negativePrompt: promptState.negativePrompt.trim() || undefined,
      imageUrls,
      maskUrl,
      size: promptState.size,
      resolution: promptState.resolution,
      seed: promptState.seed,
      cfgScale: promptState.cfgScale,
      steps: promptState.steps,
    };

    const taskIds = useQueueStore
      .getState()
      .enqueueBatch(params, promptState.batchCount);
    if (taskIds.length === 0) return [];
    toast.info(
      t("freeCanvas.toastQueuedImages", { count: taskIds.length })
    );
    return taskIds;
  }, [mode, navigate, t]);

  return { generate };
}
