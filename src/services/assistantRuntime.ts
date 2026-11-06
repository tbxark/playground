import { useConfigStore } from "@/stores/useConfigStore";
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

/** Vision image-to-prompt through the active backend. */
export function requestImageToPrompt(
  imageDataUrl: string,
  signal?: AbortSignal
): Promise<string> {
  if (getRuntimeMode() === "managed") {
    return managedAssistant({ kind: "vision", image: imageDataUrl }, signal);
  }
  return imageToPrompt(imageDataUrl, localLlmConfig(), signal);
}
