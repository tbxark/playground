/**
 * Dependency-free contracts shared between the Hono server (functions/) and the
 * browser client (src/). Keep this file free of runtime dependencies and
 * server-only types so the client bundle can import it safely.
 */

/** Route the client hits to discover what the backend offers. */
export const SERVER_HEALTH_PATH = "/api/health";
export const SERVER_LOGIN_PATH = "/api/auth/login";
/** Authenticated managed configuration (models + fixed assistant model ids). */
export const SERVER_CONFIG_PATH = "/api/config";
/** Authenticated generation facade; the server owns the model and API key. */
export const SERVER_GENERATE_PATH = "/api/generate";
/** Async task polling facade. */
export const SERVER_TASK_PREFIX = "/api/tasks/";
/** Authenticated assistant facade; the server owns the model and API key. */
export const SERVER_ASSISTANT_PATH = "/api/assistant/chat";

export type ServerHealthResponse = {
  ok: true;
  /** Whether login credentials are configured on the server. */
  auth: { enabled: boolean };
  /** Which upstreams the server can proxy to. */
  upstreams: { llm: boolean; image: boolean };
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

/** Full runtime configuration for a managed session. */
export type ServerManagedConfig = {
  image: {
    models: string[];
    defaultModel: string;
  };
  assistant: {
    textModel?: string;
    visionModel?: string;
  };
};

/**
 * Managed generation request. The model is checked against the server's image
 * allowlist; prompt/image payloads and generation parameters are forwarded.
 */
export type ServerGenerateRequest = {
  model: string;
  prompt: string;
  negativePrompt?: string;
  imageUrls?: string[];
  maskUrl?: string;
  size: string;
  resolution?: string;
  seed?: number;
  cfgScale?: number;
  steps?: number;
};

export type ServerAssistantRequest =
  | { kind: "polish" | "translate"; prompt: string }
  | { kind: "vision"; image: string };

export type ServerAssistantResponse = {
  text: string;
};

export type ServerErrorBody = {
  error: string;
};

/**
 * The managed upstream is the official OpenAI API and the request carries
 * image inputs (imageUrls/maskUrl). `/images/generations` has no image inputs
 * there, and this server deliberately does not implement `/images/edits`;
 * forwarding the request would silently generate from text only.
 */
export const SERVER_ERROR_IMAGE_INPUT_UNSUPPORTED = "image_input_unsupported";
