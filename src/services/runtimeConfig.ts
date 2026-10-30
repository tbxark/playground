import { serverFeatureEnabled } from "@/features/serverMode";
import { useConfigStore } from "@/stores/useConfigStore";
import { useManagedConfigStore } from "@/stores/useManagedConfigStore";
import { useServerStore } from "@/stores/useServerStore";
import type { ModelOption } from "./imageService";

export type RuntimeMode = "local" | "managed";

export type RuntimeImageState = {
  mode: RuntimeMode;
  models: ModelOption[];
  selectedModel: string;
  ready: boolean;
  error: string;
  setSelectedModel: (model: string) => void;
  isModelAllowed: (model: string) => boolean;
};

export function getRuntimeMode(): RuntimeMode {
  if (!serverFeatureEnabled) return "local";
  return useServerStore.getState().token ? "managed" : "local";
}

export function getRuntimeImageState(): RuntimeImageState {
  const mode = getRuntimeMode();
  if (mode === "managed") {
    const managed = useManagedConfigStore.getState();
    const config = managed.config;
    const modelIds = config?.image.models ?? [];
    const selectedModel =
      managed.selectedModel && modelIds.includes(managed.selectedModel)
        ? managed.selectedModel
        : config?.image.defaultModel ?? modelIds[0] ?? "";
    return {
      mode,
      models: modelIds.map((id) => ({ id, name: id })),
      selectedModel,
      ready: managed.status === "ready",
      error: managed.error,
      setSelectedModel: managed.setSelectedModel,
      isModelAllowed: (model) => modelIds.includes(model),
    };
  }

  const config = useConfigStore.getState();
  const enabled = new Set(config.imageConfig.enabledModelIds);
  return {
    mode,
    models: config.imageConfig.models.filter((model) => enabled.has(model.id)),
    selectedModel: config.imageConfig.selectedModel,
    ready: true,
    error: "",
    setSelectedModel: config.setSelectedModel,
    isModelAllowed: (model) => enabled.has(model),
  };
}
