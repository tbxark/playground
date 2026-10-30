import type { LlmConfig } from "./llmAssistant";
import type { ProviderConfig } from "./types";
import type { CorsProxyMode } from "@/utils/proxy";
import { serverFeatureEnabled } from "@/features/serverMode";
import { useServerStore } from "@/stores/useServerStore";
import { SERVER_PROXY_IMAGE_PREFIX, SERVER_PROXY_LLM_PREFIX } from "../../shared/contracts";

export type CorsProxySettings = {
  corsProxy?: string;
  corsProxyMode: CorsProxyMode;
};

function proxyBase(kind: "llm" | "image"): string {
  return `${window.location.origin}${
    kind === "llm" ? SERVER_PROXY_LLM_PREFIX : SERVER_PROXY_IMAGE_PREFIX
  }`;
}

/**
 * Builds the request target for one upstream call. Unchanged when no session
 * is active; re-pointed at the proxy (proxy settings neutralised) when it is.
 * Used by the Settings/Onboarding test + fetch-models handlers whose snapshot
 * staleness checks stay on the raw store values.
 */
export function buildServerAwareRequest(
  kind: "llm" | "image",
  target: { apiBaseUrl: string; apiKey: string },
  proxy: CorsProxySettings
): { apiBaseUrl: string; apiKey: string; corsProxy?: string; corsProxyMode: CorsProxyMode } {
  const server = serverFeatureEnabled ? useServerStore.getState() : null;
  if (!server || !server.canUse(kind)) {
    return {
      apiBaseUrl: target.apiBaseUrl,
      apiKey: target.apiKey,
      corsProxy: proxy.corsProxy,
      corsProxyMode: proxy.corsProxyMode,
    };
  }
  return {
    apiBaseUrl: proxyBase(kind),
    apiKey: server.token!,
    corsProxy: undefined,
    corsProxyMode: "off",
  };
}

/**
 * The single override point for "logged in ⇒ talk to our own server".
 * Applied at consumption time (dispatch, assistant calls, test/fetch buttons)
 * so logging in or out takes effect on the next request without rebuilding
 * persisted store state. The user's own keys stay untouched in the config
 * store and resume as soon as the session ends.
 */

/** Re-points a provider and its CORS-proxy settings at the server proxy. */
export function applyServerImageOverlay(
  provider: ProviderConfig,
  proxy: CorsProxySettings
): { provider: ProviderConfig; proxy: CorsProxySettings } {
  if (!serverFeatureEnabled) return { provider, proxy };
  const server = useServerStore.getState();
  if (!server.canUse("image")) return { provider, proxy };
  return {
    provider: {
      ...provider,
      apiBaseUrl: proxyBase("image"),
      apiKey: server.token!,
    },
    // Same-origin requests never need the CORS proxy — and leaving it on in
    // "always" mode would rewrite the same-origin URL through the external proxy.
    proxy: { corsProxy: undefined, corsProxyMode: "off" },
  };
}

/** Re-points an LLM config at the server proxy. */
export function applyServerLlmOverlay(config: LlmConfig): LlmConfig {
  if (!serverFeatureEnabled) return config;
  const server = useServerStore.getState();
  if (!server.canUse("llm")) return config;
  return {
    ...config,
    apiBaseUrl: proxyBase("llm"),
    apiKey: server.token!,
    corsProxy: "",
    corsProxyMode: "off",
  };
}
