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

  /** Optional comma-separated model ids merged client-side after login. */
  SERVER_DEFAULT_MODELS?: string;
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

export function parseDefaultModels(env: ServerEnv): string[] | undefined {
  const raw = env.SERVER_DEFAULT_MODELS?.trim();
  if (!raw) return undefined;
  const ids = raw
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  return ids.length > 0 ? ids : undefined;
}
