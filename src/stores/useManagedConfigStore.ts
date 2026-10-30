import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  SERVER_CONFIG_PATH,
  type ServerManagedConfig,
} from "../../shared/contracts";
import { serverFeatureEnabled } from "@/features/serverMode";
import { useServerStore } from "./useServerStore";

type Status = "idle" | "loading" | "ready" | "error";

type ManagedConfigState = {
  config: ServerManagedConfig | null;
  status: Status;
  error: string;
  /** Managed-only image model choice; never mixed into the local config store. */
  selectedModel: string;

  load: () => Promise<void>;
  setSelectedModel: (model: string) => void;
  reset: () => void;
};

function normalizeConfig(raw: unknown): ServerManagedConfig | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  const image = value.image as Record<string, unknown> | undefined;
  const assistant = value.assistant as Record<string, unknown> | undefined;
  const models = Array.isArray(image?.models)
    ? Array.from(
        new Set(
          image.models.filter(
            (id): id is string => typeof id === "string" && Boolean(id.trim())
          )
        )
      )
    : [];
  if (models.length === 0) return null;
  const defaultModel =
    typeof image?.defaultModel === "string" && models.includes(image.defaultModel)
      ? image.defaultModel
      : models[0];
  const textModel =
    typeof assistant?.textModel === "string" ? assistant.textModel.trim() : "";
  const visionModel =
    typeof assistant?.visionModel === "string" ? assistant.visionModel.trim() : "";
  return {
    image: { models, defaultModel },
    assistant: {
      ...(textModel ? { textModel } : {}),
      ...(visionModel ? { visionModel } : {}),
    },
  };
}

export const useManagedConfigStore = create<ManagedConfigState>()(
  persist(
    (set, get) => ({
      config: null,
      status: "idle",
      error: "",
      selectedModel: "",

      load: async () => {
        if (!serverFeatureEnabled) return;
        const token = useServerStore.getState().token;
        if (!token) {
          get().reset();
          return;
        }
        if (get().status === "loading") return;
        set({ status: "loading", error: "" });
        try {
          const response = await fetch(SERVER_CONFIG_PATH, {
            headers: { Authorization: `Bearer ${token}` },
            signal: AbortSignal.timeout(10_000),
          });
          // A logout / account switch while the request was in flight must not
          // install the previous session's config.
          if (useServerStore.getState().token !== token) return;
          if (response.status === 401) {
            useServerStore.getState().markUnauthorized();
          }
          if (!response.ok) {
            let code = `http_${response.status}`;
            try {
              const body = (await response.json()) as { error?: unknown };
              if (typeof body.error === "string") code = body.error;
            } catch {
              // keep the status code
            }
            set({ config: null, status: "error", error: code });
            return;
          }
          const config = normalizeConfig(await response.json());
          if (!config) {
            set({
              config: null,
              status: "error",
              error: "managed_config_incomplete",
            });
            return;
          }
          const current = get().selectedModel;
          const selectedModel = config.image.models.includes(current)
            ? current
            : config.image.defaultModel;
          set({ config, status: "ready", error: "", selectedModel });
        } catch {
          if (useServerStore.getState().token === token) {
            set({ config: null, status: "error", error: "config_unreachable" });
          }
        }
      },

      setSelectedModel: (model) => {
        const { config } = get();
        if (!config?.image.models.includes(model)) return;
        set({ selectedModel: model });
      },

      reset: () => {
        set({ config: null, status: "idle", error: "", selectedModel: "" });
      },
    }),
    {
      name: "universal-playground-managed",
      partialize: (state) => ({ selectedModel: state.selectedModel }),
    }
  )
);
