/**
 * Dependency-free contracts shared between the Hono server (functions/) and the
 * browser client (src/). Keep this file free of runtime dependencies and
 * server-only types so the client bundle can import it safely.
 */

/** Proxy route prefixes the server exposes (must stay in sync with functions/proxy.ts). */
export const SERVER_PROXY_LLM_PREFIX = "/api/proxy/llm";
export const SERVER_PROXY_IMAGE_PREFIX = "/api/proxy/image";

/** Route the client hits to discover what the backend offers. */
export const SERVER_HEALTH_PATH = "/api/health";
export const SERVER_LOGIN_PATH = "/api/auth/login";

export type ServerHealthResponse = {
  ok: true;
  /** Whether login credentials are configured on the server. */
  auth: { enabled: boolean };
  /** Which upstreams the server can proxy to. */
  upstreams: { llm: boolean; image: boolean };
  /**
   * Optional model ids the server operator pre-approves. The client merges and
   * enables them after login when the user has no enabled models yet.
   */
  defaultModels?: string[];
};

export type ServerLoginRequest = {
  username: string;
  password: string;
};

export type ServerLoginResponse = {
  token: string;
  /** Unix seconds at which the token expires. */
  exp: number;
};

export type ServerErrorBody = {
  error: string;
};
