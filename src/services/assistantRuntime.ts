import { useConfigStore } from "@/stores/useConfigStore";
import { compressImageToDataUrl, REVIEW_IMAGE_MAX_EDGE } from "@/utils/compressImage";
import { getRuntimeMode } from "./runtimeConfig";
import {
  imageToPrompt,
  polishPrompt,
  type LlmConfig,
  type PromptTextMode,
} from "./llmAssistant";
import { managedAssistant } from "./managedBackend";

function localLlmConfig(): LlmConfig {
  const config = useConfigStore.getState();
  return {
    ...config.llmConfig,
    corsProxy: config.corsProxy,
    corsProxyMode: config.corsProxyMode,
  };
}

/** Expand/optimize/translate through the active backend. */
export function requestPolish(
  prompt: string,
  mode: PromptTextMode = "enhance",
  signal?: AbortSignal
): Promise<string> {
  if (getRuntimeMode() === "managed") {
    // The managed contract keeps the historical "polish" kind for expansion.
    return managedAssistant(
      { kind: mode === "enhance" ? "polish" : mode, prompt },
      signal
    );
  }
  return polishPrompt(prompt, localLlmConfig(), mode, signal);
}

/**
 * Vision image-to-prompt through the active backend. The image is downscaled
 * to 1024px on its long edge and sent as base64 for both backends.
 */
export async function requestImageToPrompt(
  image: string,
  signal?: AbortSignal
): Promise<string> {
  const imageDataUrl = await compressImageToDataUrl(image, REVIEW_IMAGE_MAX_EDGE, signal);
  if (getRuntimeMode() === "managed") {
    return managedAssistant({ kind: "vision", image: imageDataUrl }, signal);
  }
  return imageToPrompt(imageDataUrl, localLlmConfig(), signal);
}
