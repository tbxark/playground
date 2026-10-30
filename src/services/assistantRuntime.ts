import { useConfigStore } from "@/stores/useConfigStore";
import { getRuntimeMode } from "./runtimeConfig";
import { imageToPrompt, polishPrompt, type LlmConfig } from "./llmAssistant";
import { managedAssistant } from "./managedBackend";

function localLlmConfig(): LlmConfig {
  const config = useConfigStore.getState();
  return {
    ...config.llmConfig,
    corsProxy: config.corsProxy,
    corsProxyMode: config.corsProxyMode,
  };
}

/** Polish/translate through the active backend. */
export function requestPolish(
  prompt: string,
  mode: "enhance" | "translate" = "enhance",
  signal?: AbortSignal
): Promise<string> {
  if (getRuntimeMode() === "managed") {
    return managedAssistant(
      { kind: mode === "translate" ? "translate" : "polish", prompt },
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
