import { useConfigStore } from "@/stores/useConfigStore";
import { useServerStore } from "@/stores/useServerStore";

/**
 * Merges the server's optional defaultModels into the local catalog and
 * enables them — only when the user has not enabled any model yet. Called
 * after a successful login so shared users get a working model list without
 * hand-curating; users with their own setup keep their list untouched.
 *
 * Lives outside both stores so config ↔ server never import each other.
 */
export function mergeServerDefaultModels(): number {
  const health = useServerStore.getState().health;
  const defaultModels = health?.defaultModels;
  if (!defaultModels || defaultModels.length === 0) return 0;

  const config = useConfigStore.getState();
  if (config.imageConfig.enabledModelIds.length > 0) return 0;

  for (const id of defaultModels) {
    config.addCustomModel({ id, name: id });
  }
  const latest = useConfigStore.getState().imageConfig;
  if (latest.enabledModelIds.length > 0 && !latest.selectedModel) {
    config.setSelectedModel(latest.enabledModelIds[0]);
  }
  return latest.enabledModelIds.length;
}
