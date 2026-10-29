import { create } from "zustand";
import { persist } from "zustand/middleware";
import { ProviderConfig, ProviderModelDefinition } from "../services/types";
import { LlmConfig } from "../services/llmAssistant";
import { i18n } from "@/i18n";
import { CorsProxyMode, normalizeCorsProxyMode } from "@/utils/proxy";
import { ImageApiConfig, isImageGenCapabilityTag, ModelOption } from "../services/imageService";

type ConfigState = {
  // Unified OpenAI-compatible Image Generation Service
  imageConfig: ImageApiConfig;

  // Global settings
  concurrencyLimit: number;
  historyQuota: number;
  corsProxy: string;
  corsProxyMode: CorsProxyMode;
  llmConfig: LlmConfig;
  theme: "light" | "dark" | "system";

  // First-run setup guide. Once the user finishes or skips the guide, later
  // config changes (clearing a key, resetting settings) must not drag them
  // back into it.
  onboardingDismissed: boolean;

  // Compatibility fields for existing components
  selectedModel: string;
  selectedProviderId: string;
  providers: ProviderConfig[];

  // Image Config Actions
  updateImageConfig: (patch: Partial<ImageApiConfig>) => void;
  setSelectedModel: (model: string) => void;
  setFetchedModels: (models: ModelOption[]) => void;
  toggleModelEnabled: (modelId: string) => void;
  enableAllModels: (modelIds?: string[]) => void;
  disableAllModels: () => void;
  addCustomModel: (model: ModelOption) => void;
  removeModel: (modelId: string) => void;

  // Compatibility Actions
  setSelectedProviderAndModel: (providerId: string, model: string) => void;
  updateProviderKey: (providerId: string, apiKey: string) => void;
  updateProviderEndpoint: (providerId: string, endpoint: string) => void;
  addCustomProvider: (provider: ProviderConfig) => void;
  removeCustomProvider: (providerId: string) => void;
  addCustomModelToProvider: (providerId: string, model: ProviderModelDefinition) => void;
  removeCustomModelFromProvider: (providerId: string, modelId: string) => void;

  // General Actions
  setConcurrencyLimit: (limit: number) => void;
  setHistoryQuota: (quota: number) => void;
  setCorsProxy: (proxy: string) => void;
  setCorsProxyMode: (mode: CorsProxyMode) => void;
  updateLlmConfig: (patch: Partial<LlmConfig>) => void;
  setLlmFetchedModels: (textModels: ModelOption[], visionModels: ModelOption[]) => void;
  setTheme: (theme: "light" | "dark" | "system") => void;
  dismissOnboarding: () => void;
  exportConfig: () => string;
  importConfig: (jsonText: string) => void;
  resetToDefaults: () => void;
};

// No built-in model catalog and no preselected default model:
// the model list starts empty and every selection is made manually
// (fetch from the endpoint or add model IDs in Settings).
const DEFAULT_IMAGE_CONFIG: ImageApiConfig = {
  apiBaseUrl: "https://api.openai.com/v1",
  apiKey: "",
  selectedModel: "",
  models: [],
  enabledModelIds: [],
};

function clampImportedNumber(
  value: unknown,
  fallback: number,
  min: number,
  max: number
): number {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(max, Math.max(min, Math.round(numeric)));
}

/**
 * Imported JSON is untrusted: it may come from an older build, a hand-edited
 * file or a different app. Rebuild the object field by field so a malformed
 * entry can never be persisted into a state that crashes the Settings render.
 */
function normalizeImportedImageConfig(
  input: unknown,
  fallback: ImageApiConfig
): ImageApiConfig {
  if (!input || typeof input !== "object" || Array.isArray(input)) return fallback;
  const raw = input as Record<string, unknown>;

  const models: ModelOption[] = Array.isArray(raw.models)
    ? raw.models.flatMap((item) => {
        if (!item || typeof item !== "object") return [];
        const model = item as Record<string, unknown>;
        const id = typeof model.id === "string" ? model.id.trim() : "";
        if (!id) return [];
        return [
          {
            id,
            name:
              typeof model.name === "string" && model.name.trim()
                ? model.name
                : id,
            ownedBy:
              typeof model.ownedBy === "string" ? model.ownedBy : undefined,
          },
        ];
      })
    : fallback.models;

  const knownIds = new Set(models.map((model) => model.id));
  const enabledModelIds = Array.isArray(raw.enabledModelIds)
    ? Array.from(
        new Set(
          raw.enabledModelIds.filter(
            (id): id is string => typeof id === "string" && knownIds.has(id)
          )
        )
      )
    : [];

  const selectedModel =
    typeof raw.selectedModel === "string" &&
    enabledModelIds.includes(raw.selectedModel)
      ? raw.selectedModel
      : "";

  return {
    apiBaseUrl:
      typeof raw.apiBaseUrl === "string" && raw.apiBaseUrl.trim()
        ? raw.apiBaseUrl.trim()
        : fallback.apiBaseUrl,
    apiKey:
      typeof raw.apiKey === "string" ? raw.apiKey.trim() : fallback.apiKey,
    selectedModel,
    models,
    enabledModelIds,
  };
}

function normalizeImportedLlmConfig(
  input: unknown,
  fallback: LlmConfig
): LlmConfig {
  if (!input || typeof input !== "object" || Array.isArray(input)) return fallback;
  const raw = input as Record<string, unknown>;
  const text = (key: string, base: string) =>
    typeof raw[key] === "string" ? (raw[key] as string).trim() : base;

  return {
    apiBaseUrl: text("apiBaseUrl", fallback.apiBaseUrl) || fallback.apiBaseUrl,
    apiKey: text("apiKey", fallback.apiKey),
    model: text("model", fallback.model),
    visionModel: text("visionModel", fallback.visionModel),
    corsProxy: text("corsProxy", fallback.corsProxy ?? ""),
    corsProxyMode: normalizeCorsProxyMode(raw.corsProxyMode),
    availableModels: fallback.availableModels,
    availableVisionModels: fallback.availableVisionModels,
  };
}

/**
 * The setup guide is for a browser that has never stored a provider key. Having
 * only one of the two keys (e.g. an image key, no assistant) counts as set up;
 * the guide is about first contact, not completeness.
 */
export function isSetupRequired(
  state: Pick<ConfigState, "imageConfig" | "llmConfig" | "onboardingDismissed">
): boolean {
  return (
    !state.onboardingDismissed &&
    !state.imageConfig.apiKey.trim() &&
    !state.llmConfig.apiKey.trim()
  );
}

function buildCompatibilityProviders(imageConfig: ImageApiConfig): ProviderConfig[] {
  const enabledModels = imageConfig.models.filter((m) =>
    imageConfig.enabledModelIds.includes(m.id)
  );

  return [
    {
      id: "openai",
      label: i18n.t("config.openaiCompatLabel"),
      apiBaseUrl: imageConfig.apiBaseUrl,
      apiKey: imageConfig.apiKey,
      capabilities: {
        supportsText2Image: true,
        supportsImage2Image: true,
        supportsInpainting: true,
        supportsOutpainting: true,
        supportsNegativePrompt: true,
        supportsCustomSize: true,
        supportsSeed: true,
      },
      models: enabledModels.map((m) => ({
        id: m.id,
        name: m.name || m.id,
      })),
    },
  ];
}

export const useConfigStore = create<ConfigState>()(
  persist(
    (set, get) => ({
      imageConfig: DEFAULT_IMAGE_CONFIG,
      selectedModel: "",
      selectedProviderId: "openai",
      providers: buildCompatibilityProviders(DEFAULT_IMAGE_CONFIG),

      concurrencyLimit: 2,
      historyQuota: 200,
      corsProxy: "",
      corsProxyMode: "auto",
      llmConfig: {
        apiBaseUrl: "https://api.openai.com/v1",
        apiKey: "",
        model: "",
        visionModel: "",
        corsProxy: "",
      },
      theme: "dark",
      onboardingDismissed: false,

      // Update image config
      updateImageConfig: (patch) => {
        set((state) => {
          const next = { ...state.imageConfig, ...patch };
          return {
            imageConfig: next,
            selectedModel: next.selectedModel,
            providers: buildCompatibilityProviders(next),
          };
        });
      },

      setSelectedModel: (model) => {
        set((state) => {
          if (!state.imageConfig.enabledModelIds.includes(model)) return state;
          const next = { ...state.imageConfig, selectedModel: model };
          return {
            imageConfig: next,
            selectedModel: model,
            providers: buildCompatibilityProviders(next),
          };
        });
      },

      setFetchedModels: (newModels) => {
        set((state) => {
          // Merge unique models
          const existingIds = new Set(state.imageConfig.models.map((m) => m.id));
          const merged = [...state.imageConfig.models];
          newModels.forEach((m) => {
            if (!existingIds.has(m.id)) {
              merged.push(m);
            }
          });

          // Enable only genuinely new ids: a routine "fetch models" refresh used
          // to re-enable every model the user had switched off.
          const newIds = newModels
            .filter((m) => !existingIds.has(m.id))
            .map((m) => m.id);
          const enabledSet = new Set([...state.imageConfig.enabledModelIds, ...newIds]);

          const next = {
            ...state.imageConfig,
            models: merged,
            enabledModelIds: Array.from(enabledSet),
          };

          return {
            imageConfig: next,
            providers: buildCompatibilityProviders(next),
          };
        });
      },

      toggleModelEnabled: (modelId) => {
        set((state) => {
          const current = state.imageConfig.enabledModelIds;
          const nextEnabled = current.includes(modelId)
            ? current.filter((id) => id !== modelId)
            : [...current, modelId];

          const next = {
            ...state.imageConfig,
            enabledModelIds: nextEnabled,
          };

          return {
            imageConfig: next,
            providers: buildCompatibilityProviders(next),
          };
        });
      },

      enableAllModels: (modelIds) => {
        set((state) => {
          const allIds = modelIds || state.imageConfig.models.map((m) => m.id);
          const next = {
            ...state.imageConfig,
            enabledModelIds: allIds,
          };
          return {
            imageConfig: next,
            providers: buildCompatibilityProviders(next),
          };
        });
      },

      disableAllModels: () => {
        set((state) => {
          const next = {
            ...state.imageConfig,
            enabledModelIds: [],
          };
          return {
            imageConfig: next,
            providers: buildCompatibilityProviders(next),
          };
        });
      },

      addCustomModel: (model) => {
        set((state) => {
          const models = [
            ...state.imageConfig.models.filter((m) => m.id !== model.id),
            model,
          ];
          const enabledModelIds = Array.from(
            new Set([...state.imageConfig.enabledModelIds, model.id])
          );
          const next = {
            ...state.imageConfig,
            models,
            enabledModelIds,
          };
          return {
            imageConfig: next,
            providers: buildCompatibilityProviders(next),
          };
        });
      },

      removeModel: (modelId) => {
        set((state) => {
          const models = state.imageConfig.models.filter((m) => m.id !== modelId);
          const enabledModelIds = state.imageConfig.enabledModelIds.filter(
            (id) => id !== modelId
          );
          const selectedModel =
            state.imageConfig.selectedModel === modelId
              ? ""
              : state.imageConfig.selectedModel;

          const next = {
            ...state.imageConfig,
            models,
            enabledModelIds,
            selectedModel,
          };
          return {
            imageConfig: next,
            selectedModel,
            providers: buildCompatibilityProviders(next),
          };
        });
      },

      // Compatibility methods
      setSelectedProviderAndModel: (_providerId, model) => {
        get().setSelectedModel(model);
      },

      updateProviderKey: (_providerId, apiKey) => {
        get().updateImageConfig({ apiKey });
      },

      updateProviderEndpoint: (_providerId, apiBaseUrl) => {
        get().updateImageConfig({ apiBaseUrl });
      },

      addCustomProvider: () => {},
      removeCustomProvider: () => {},
      addCustomModelToProvider: (_providerId, model) => {
        get().addCustomModel({ id: model.id, name: model.name });
      },
      removeCustomModelFromProvider: (_providerId, modelId) => {
        get().removeModel(modelId);
      },

      setConcurrencyLimit: (concurrencyLimit) => set({ concurrencyLimit }),
      setHistoryQuota: (historyQuota) => set({ historyQuota }),
      setCorsProxy: (corsProxy) => set({ corsProxy }),
      setCorsProxyMode: (corsProxyMode) => set({ corsProxyMode }),

      updateLlmConfig: (patch) => {
        set((state) => ({
          llmConfig: { ...state.llmConfig, ...patch },
        }));
      },

      setLlmFetchedModels: (textModels, visionModels) => {
        set((state) => ({
          llmConfig: {
            ...state.llmConfig,
            availableModels: textModels,
            availableVisionModels: visionModels,
          },
        }));
      },

      setTheme: (theme) => {
        set({ theme });
        applyTheme(theme);
      },

      dismissOnboarding: () => set({ onboardingDismissed: true }),

      exportConfig: () => {
        const state = get();
        const exportData = {
          version: 2,
          exportedAt: new Date().toISOString(),
          imageConfig: state.imageConfig,
          llmConfig: state.llmConfig,
          concurrencyLimit: state.concurrencyLimit,
          historyQuota: state.historyQuota,
          corsProxy: state.corsProxy,
          corsProxyMode: state.corsProxyMode,
        };
        return JSON.stringify(exportData, null, 2);
      },

      importConfig: (jsonText) => {
        const parsed: unknown = JSON.parse(jsonText);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          throw new Error(i18n.t("settings.importInvalidShape"));
        }
        const data = parsed as Record<string, unknown>;
        const current = get();
        // Validate and normalise before writing: an imported object missing
        // `models` used to throw inside set()'s argument evaluation, and a
        // model entry without an `id` was persisted and then crashed every
        // Settings render (with the reset button unreachable).
        const imageConfig = normalizeImportedImageConfig(
          data.imageConfig,
          current.imageConfig
        );
        const llmConfig = normalizeImportedLlmConfig(
          data.llmConfig,
          current.llmConfig
        );
        set({
          imageConfig,
          selectedModel: imageConfig.selectedModel,
          providers: buildCompatibilityProviders(imageConfig),
          llmConfig,
          concurrencyLimit: clampImportedNumber(data.concurrencyLimit, 2, 1, 4),
          historyQuota: clampImportedNumber(data.historyQuota, 200, 20, 1000),
          corsProxy: typeof data.corsProxy === "string" ? data.corsProxy.trim() : "",
          corsProxyMode: normalizeCorsProxyMode(data.corsProxyMode),
        });
      },

      resetToDefaults: () => {
        const defaultLlmConfig: LlmConfig = {
          apiBaseUrl: "https://api.openai.com/v1",
          apiKey: "",
          model: "",
          visionModel: "",
          corsProxy: "",
        };
        set({
          imageConfig: DEFAULT_IMAGE_CONFIG,
          selectedModel: "",
          selectedProviderId: "openai",
          providers: buildCompatibilityProviders(DEFAULT_IMAGE_CONFIG),
          concurrencyLimit: 2,
          historyQuota: 200,
          corsProxy: "",
          corsProxyMode: "auto",
          llmConfig: defaultLlmConfig,
          theme: "dark",
        });
        applyTheme("dark");
      },
    }),
    {
      name: "universal-playground-config",
      onRehydrateStorage: () => (state) => {
        if (!state) return;

        // Old snapshots predate the mode; "auto" is both the new default and the
        // safe reading of an existing proxy URL (direct first, proxy on failure).
        state.corsProxyMode = normalizeCorsProxyMode(state.corsProxyMode);

        // Migrate legacy provider config to unified imageConfig if needed
        if (!state.imageConfig) {
          const legacyProviders = (state as unknown as { providers?: ProviderConfig[] }).providers;
          const openai = legacyProviders?.find((p) => p.id === "openai");
          const chosen = openai || legacyProviders?.[0];

          state.imageConfig = {
            apiBaseUrl: chosen?.apiBaseUrl || "https://api.openai.com/v1",
            apiKey: chosen?.apiKey || "",
            selectedModel: "",
            models: [],
            enabledModelIds: [],
          };
        }

        // Never reseed a built-in model catalog: an empty list stays empty
        // until the user fetches models or adds them manually.
        if (!state.imageConfig.models) {
          state.imageConfig.models = [];
          state.imageConfig.enabledModelIds = [];
        } else if (state.imageConfig.models.length > 0) {
          // Purge any video/chat/audio models that may have leaked into cache
          const cleanedModels = state.imageConfig.models.filter((m) => {
            if (m.supportedEndpointTypes && m.supportedEndpointTypes.length > 0) {
              const hasOpenAi = m.supportedEndpointTypes.some((t) => t.toLowerCase() === "openai");
              if (!hasOpenAi) return false;
            }
            const cat = (m.category || "").toLowerCase().trim();
            if (cat && cat !== "image") return false;
            if (m.capabilityTags && m.capabilityTags.length > 0) {
              return m.capabilityTags.some(isImageGenCapabilityTag);
            }
            return true;
          });
          // Assign unconditionally: keeping the unfiltered library when every
          // cached model was filtered out (video/chat/audio only) left exactly
          // the leaked models the purge exists to remove.
          state.imageConfig.models = cleanedModels;
          state.imageConfig.enabledModelIds =
            state.imageConfig.enabledModelIds.filter((id) =>
              cleanedModels.some((m) => m.id === id)
            );
        }

        // Enabled ids must point at a model that still has a card in the
        // library; stale ids from old caches or imported JSON would inflate the
        // enabled count while showing nothing in the list.
        const knownModelIds = new Set(state.imageConfig.models.map((m) => m.id));
        state.imageConfig.enabledModelIds = state.imageConfig.enabledModelIds.filter((id) =>
          knownModelIds.has(id)
        );

        // Manual selection only: clear stale selections that are no longer enabled
        const rehydratedSelection = state.imageConfig.selectedModel;
        state.imageConfig.selectedModel =
          rehydratedSelection && state.imageConfig.enabledModelIds.includes(rehydratedSelection)
            ? rehydratedSelection
            : "";
        state.selectedModel = state.imageConfig.selectedModel;
        state.selectedProviderId = "openai";
        state.providers = buildCompatibilityProviders(state.imageConfig);

        if (state.theme) {
          applyTheme(state.theme);
        }
      },
    }
  )
);

function applyTheme(theme: "light" | "dark" | "system") {
  const root = document.documentElement;
  const isDark =
    theme === "dark" ||
    (theme === "system" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches);

  root.classList.toggle("dark", isDark);
  root.classList.toggle("light", !isDark);
}
