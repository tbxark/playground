import { useMemo } from "react";
import { serverFeatureEnabled } from "@/features/serverMode";
import { useConfigStore } from "@/stores/useConfigStore";
import { useManagedConfigStore } from "@/stores/useManagedConfigStore";
import { useServerStore } from "@/stores/useServerStore";
import type { RuntimeImageState } from "@/services/runtimeConfig";

/**
 * Reactive runtime image state. Managed sessions read only the server-published
 * list and their own selected model; local sessions keep using the local
 * catalog. Components should not read imageConfig.models/enabledModelIds
 * directly for pickers or generation gates.
 */
export function useRuntimeImageState(): RuntimeImageState {
  const imageConfig = useConfigStore((state) => state.imageConfig);
  const setLocalModel = useConfigStore((state) => state.setSelectedModel);
  const token = useServerStore((state) => state.token);
  const managedConfig = useManagedConfigStore((state) => state.config);
  const managedStatus = useManagedConfigStore((state) => state.status);
  const managedError = useManagedConfigStore((state) => state.error);
  const managedSelected = useManagedConfigStore((state) => state.selectedModel);
  const setManagedModel = useManagedConfigStore((state) => state.setSelectedModel);

  return useMemo(() => {
    if (serverFeatureEnabled && token) {
      const modelIds = managedConfig?.image.models ?? [];
      const selectedModel =
        managedSelected && modelIds.includes(managedSelected)
          ? managedSelected
          : managedConfig?.image.defaultModel ?? modelIds[0] ?? "";
      return {
        mode: "managed" as const,
        models: modelIds.map((id) => ({ id, name: id })),
        selectedModel,
        ready: managedStatus === "ready",
        error: managedError,
        setSelectedModel: setManagedModel,
        isModelAllowed: (model: string) => modelIds.includes(model),
      };
    }

    const enabled = new Set(imageConfig.enabledModelIds);
    return {
      mode: "local" as const,
      models: imageConfig.models.filter((model) => enabled.has(model.id)),
      selectedModel: imageConfig.selectedModel,
      ready: true,
      error: "",
      setSelectedModel: setLocalModel,
      isModelAllowed: (model: string) => enabled.has(model),
    };
  }, [
    imageConfig,
    setLocalModel,
    token,
    managedConfig,
    managedStatus,
    managedError,
    managedSelected,
    setManagedModel,
  ]);
}
