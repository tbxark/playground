/**
 * Shape of the environment every server adapter (Cloudflare Worker, Vercel
 * function, Vite dev middleware) passes into createApp(). Values come from
 * Worker bindings, Vercel env vars, or .env.local respectively.
 */
export type ServerEnv = {
  AUTH_USERNAME?: string;
  AUTH_PASSWORD?: string;
  /** HS256 signing secret for login JWTs. Login stays disabled without it. */
  JWT_SECRET?: string;
  /** Token lifetime in hours; defaults to 168 (7 days). */
  JWT_TTL_HOURS?: string;

  /** OpenAI-compatible upstream for assistant calls; must include the version segment (e.g. https://gw.example.com/v1). */
  LLM_BASE_URL?: string;
  LLM_API_KEY?: string;

  /** OpenAI-compatible upstream for image calls; falls back to LLM_* when unset. */
  IMAGE_BASE_URL?: string;
  IMAGE_API_KEY?: string;

  /** Comma-separated image model ids managed users are restricted to. */
  MANAGED_IMAGE_MODELS?: string;
  /** Fixed assistant text model for managed users. */
  MANAGED_LLM_MODEL?: string;
  /** Fixed assistant vision model for managed users. */
  MANAGED_VISION_MODEL?: string;
};

/** Resolve the effective upstream for one proxy kind, with IMAGE falling back to LLM. */
export function resolveUpstream(
  env: ServerEnv,
  kind: "llm" | "image"
): { baseUrl: string; apiKey: string } | null {
  const baseUrl = (
    kind === "image" ? env.IMAGE_BASE_URL ?? env.LLM_BASE_URL : env.LLM_BASE_URL
  )
    ?.trim()
    .replace(/\/+$/, "");
  const apiKey = (kind === "image" ? env.IMAGE_API_KEY ?? env.LLM_API_KEY : env.LLM_API_KEY)?.trim();
  if (!baseUrl || !apiKey) return null;
  return { baseUrl, apiKey };
}

export function parseManagedImageModels(env: ServerEnv): string[] {
  const raw = env.MANAGED_IMAGE_MODELS?.trim();
  if (!raw) return [];
  return Array.from(
    new Set(
      raw
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean)
    )
  );
}

export function parseOptionalModel(value: string | undefined): string | undefined {
  const id = value?.trim();
  return id ? id : undefined;
}
