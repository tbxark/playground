export type ServerMode = "off" | "optional";

/**
 * Build-time feature flag. Vite statically replaces `import.meta.env.*` in
 * production builds, so `SERVER_MODE === "off"` branches are dead-code
 * eliminated from a pure frontend build. Set VITE_SERVER_MODE=optional to
 * ship the shared build (login offered, never required).
 */
export const SERVER_MODE: ServerMode =
  import.meta.env.VITE_SERVER_MODE === "optional" ? "optional" : "off";

export const serverFeatureEnabled: boolean = SERVER_MODE !== "off";
