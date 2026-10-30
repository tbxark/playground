import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  SERVER_HEALTH_PATH,
  SERVER_LOGIN_PATH,
  type ServerHealthResponse,
  type ServerLoginResponse,
} from "../../shared/contracts";
import { serverFeatureEnabled } from "@/features/serverMode";

type HealthStatus = "unknown" | "checking" | "available" | "unavailable";

type ServerState = {
  /** Login JWT. Kept in localStorage so a reload keeps the session. */
  token: string | null;
  /** Unix seconds when the token expires (from the login response). */
  tokenExp: number | null;
  /** Last /api/health observation; session-only. */
  health: ServerHealthResponse | null;
  healthStatus: HealthStatus;
  /** Set when a proxied request came back 401; UI prompts a fresh login. */
  unauthorized: boolean;

  checkHealth: () => Promise<void>;
  login: (username: string, password: string) => Promise<"ok" | "invalid" | "unavailable">;
  logout: () => void;
  markUnauthorized: () => void;
  clearUnauthorized: () => void;
  /** True when a session can drive this upstream through the proxy. */
  canUse: (kind: "llm" | "image") => boolean;
};

/**
 * Deliberately independent from useConfigStore (which reads this store's
 * session state) so the two never import each other.
 */
export const useServerStore = create<ServerState>()(
  persist(
    (set, get) => ({
      token: null,
      tokenExp: null,
      health: null,
      healthStatus: "unknown",
      unauthorized: false,

      checkHealth: async () => {
        if (!serverFeatureEnabled) return;
        set({ healthStatus: "checking" });
        try {
          const response = await fetch(SERVER_HEALTH_PATH, {
            signal: AbortSignal.timeout(4000),
          });
          if (!response.ok) throw new Error(String(response.status));
          const health = (await response.json()) as ServerHealthResponse;
          set({ health, healthStatus: "available" });
        } catch {
          set({ health: null, healthStatus: "unavailable" });
        }
      },

      login: async (username, password) => {
        if (!serverFeatureEnabled) return "unavailable";
        try {
          const response = await fetch(SERVER_LOGIN_PATH, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username, password }),
            signal: AbortSignal.timeout(10_000),
          });
          if (response.status === 401) return "invalid";
          if (!response.ok) return "unavailable";
          const data = (await response.json()) as ServerLoginResponse;
          set({
            token: data.token,
            tokenExp: typeof data.exp === "number" ? data.exp : null,
            unauthorized: false,
          });
          return "ok";
        } catch {
          return "unavailable";
        }
      },

      logout: () => {
        set({ token: null, tokenExp: null, unauthorized: false });
      },

      markUnauthorized: () => {
        // Only a real session can expire; a stray 401 on a hand-typed
        // same-origin baseURL must not raise the banner.
        if (get().token) set({ unauthorized: true });
      },

      clearUnauthorized: () => set({ unauthorized: false }),

      canUse: (kind) => {
        // A pure frontend build must never route to /api/proxy/* — not even
        // when this browser carries a token left by a shared build.
        if (!serverFeatureEnabled) return false;
        const state = get();
        if (!state.token || state.unauthorized) return false;
        // A token without a completed health probe still counts: the proxy
        // rejects upstream-missing paths with 503 and the caller surfaces it.
        return state.health ? state.health.upstreams[kind] : true;
      },
    }),
    {
      name: "universal-playground-server",
      // Only the session survives a reload; health is a live property.
      partialize: (state) => ({ token: state.token, tokenExp: state.tokenExp }),
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        // Drop a session that expired while the tab was closed.
        if (state.token && state.tokenExp && state.tokenExp * 1000 < Date.now()) {
          state.token = null;
          state.tokenExp = null;
        }
      },
    }
  )
);
