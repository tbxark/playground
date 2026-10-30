import OpenAI, { type ClientOptions } from "openai";
import { i18n } from "@/i18n";
import {
  CorsProxyMode,
  buildProxiedUrl,
  corsAwareFetch,
  normalizeCorsProxy,
  normalizeCorsProxyMode,
} from "@/utils/proxy";
import { GenerateParams } from "./types";

export type ModelOption = {
  id: string;
  name?: string;
  ownedBy?: string;
  category?: string;
  capabilityTags?: string[];
  supportedEndpointTypes?: string[];
};

export type ImageApiConfig = {
  apiBaseUrl: string;
  apiKey: string;
  selectedModel: string;
  models: ModelOption[];
  enabledModelIds: string[];
};

// Known model names with Chinese descriptors resolve through i18n keys;
// dots in model ids are replaced with underscores for the key segment.
const MODEL_NAME_KEYS: Record<string, string> = {
  "imagen-4.0": "imgsvc.modelName.imagen_4_0",
  "flux-1-dev": "imgsvc.modelName.flux_1_dev",
  "flux-1-schnell": "imgsvc.modelName.flux_1_schnell",
  "dall-e-3": "imgsvc.modelName.dall_e_3",
  "doubao-seedream-5-0-pro": "imgsvc.modelName.doubao_seedream_5_0_pro",
  "qwen-image-3.0": "imgsvc.modelName.qwen_image_3_0",
  "recraft-v3": "imgsvc.modelName.recraft_v3",
};

export function modelDisplayName(model: Pick<ModelOption, "id" | "name">): string {
  const key = MODEL_NAME_KEYS[model.id];
  return key ? i18n.t(key) : model.name || model.id;
}

/**
 * Format aspect ratio or size string depending on model requirements:
 * - OpenAI official DALL-E (dall-e-3, dall-e-2) requires exact pixel resolutions like "1024x1024", "1792x1024", "1024x1792".
 * - All other models (gpt-image-2.5, flux, imagen, midjourney, etc. on OpenAI-compatible gateways)
 *   strictly require aspect ratio strings ("1:1", "16:9", "9:16", "4:3", "3:4", "auto") and reject pixel sizes!
 */
export function formatSizeForModel(size: string, model: string): string {
  const isDalle = model.toLowerCase().startsWith("dall-e");
  if (isDalle) {
    switch (size) {
      case "16:9":
        return "1792x1024";
      case "9:16":
        return "1024x1792";
      case "4:3":
      case "3:4":
      case "1:1":
      case "auto":
      default:
        return "1024x1024";
    }
  }

  // Non-DALL-E models (gpt-image, imagen, flux, midjourney, etc.):
  // If the size is already an aspect ratio ("1:1", "16:9", "auto", etc.), keep it directly.
  if (!size || size === "auto") {
    return "auto";
  }

  // If size was passed as pixel dimensions (e.g. "1024x1024"), convert back to ratio string
  if (size.includes("x")) {
    const [w, h] = size.split("x").map(Number);
    if (w && h) {
      if (w === h) return "1:1";
      if (Math.abs(w / h - 16 / 9) < 0.05) return "16:9";
      if (Math.abs(w / h - 9 / 16) < 0.05) return "9:16";
      if (Math.abs(w / h - 4 / 3) < 0.05) return "4:3";
      if (Math.abs(w / h - 3 / 4) < 0.05) return "3:4";
      if (Math.abs(w / h - 3 / 2) < 0.05) return "3:2";
      if (Math.abs(w / h - 2 / 3) < 0.05) return "2:3";
      if (Math.abs(w / h - 21 / 9) < 0.05) return "21:9";
    }
  }

  return size;
}

type RawModelItem = {
  id?: string;
  name?: string;
  owned_by?: string;
  category?: string;
  capability_tags?: string[];
  supported_endpoint_types?: string[];
};

/**
 * Helper to determine if a capability tag is specifically an image generation capability.
 * Matches: "Text to Image", "Image to Image", Inpainting, Outpainting.
 * Explicitly rejects: "Text to Video", "Image to Video", "Image to Text" (OCR/Vision), etc.
 */
export function isImageGenCapabilityTag(rawTag: string): boolean {
  const t = rawTag.toLowerCase().trim();
  if (t === "text to image" || t === "text-to-image") return true;
  if (t === "image to image" || t === "image-to-image") return true;
  if (t.includes("inpainting") || t.includes("outpainting")) return true;
  if (t.includes("image generation") || t.includes("image editing")) return true;
  return false;
}

/**
 * Filter models specifically for image generation based on category, capability_tags, and supported_endpoint_types.
 * If the models endpoint does not have category/capability_tags/supported_endpoint_types fields,
 * it indicates that metadata filtering is unsupported, so no filtering is applied.
 */
export function filterImageGenerationModels(rawList: RawModelItem[]): RawModelItem[] {
  // Check if any model in rawList has category, capability_tags, or supported_endpoint_types
  const hasMetadata = rawList.some(
    (item) =>
      Boolean(item.category) ||
      (Array.isArray(item.capability_tags) && item.capability_tags.length > 0) ||
      (Array.isArray(item.supported_endpoint_types) && item.supported_endpoint_types.length > 0)
  );

  // If models do not have category / capability_tags / supported_endpoint_types, do NOT filter
  if (!hasMetadata) {
    return rawList;
  }

  // Provider with metadata (e.g. APIMart expand=category)
  const filtered = rawList.filter((item) => {
    // 1. supported_endpoint_types must include "openai" if the field is present
    if (
      Array.isArray(item.supported_endpoint_types) &&
      item.supported_endpoint_types.length > 0
    ) {
      const hasOpenAi = item.supported_endpoint_types.some(
        (t) => String(t).toLowerCase() === "openai"
      );
      if (!hasOpenAi) return false;
    }

    const category = (item.category || "").toLowerCase().trim();
    const tags = Array.isArray(item.capability_tags)
      ? item.capability_tags.map((t) => String(t))
      : [];

    // 2. Explicit non-image category (video, audio, chat, text, embedding) -> definitely exclude
    if (category && category !== "image") {
      return false;
    }

    const hasGenTag = tags.some(isImageGenCapabilityTag);

    // 3. Has capability_tags: must match Text to Image / Image to Image / Inpainting / Outpainting
    if (tags.length > 0) {
      return hasGenTag;
    }

    // 4. Category is explicitly "image" and no tags provided
    if (category === "image" && tags.length === 0) {
      return true;
    }

    return false;
  });

  // Safety fallback: if strict filter resulted in 0 items, return rawList
  if (filtered.length === 0) {
    return rawList;
  }

  return filtered;
}

function isOfficialOpenAiEndpoint(apiBaseUrl: string): boolean {
  try {
    return new URL(apiBaseUrl).host === "api.openai.com";
  } catch {
    return false;
  }
}

/**
 * Creates an OpenAI client instance with browser allowance and optional CORS proxy.
 * In "auto" mode the client talks to the endpoint directly and only falls back
 * to the proxy when the browser blocks that host; "always" rewrites the base URL.
 */
export function createOpenAiClient(config: {
  apiBaseUrl: string;
  apiKey?: string;
  corsProxy?: string;
  corsProxyMode?: CorsProxyMode;
}): OpenAI {
  const cleanBase = (config.apiBaseUrl || "https://api.openai.com/v1").replace(/\/+$/, "");
  const proxy = normalizeCorsProxy(config.corsProxy);
  const mode = normalizeCorsProxyMode(config.corsProxyMode);
  const proxying = Boolean(proxy) && mode !== "off";

  const clientOptions: ClientOptions = {
    apiKey: config.apiKey?.trim() || "dummy-key-for-listing",
    // The proxy path must be built by the same helper that validates http(s)
    // and preserves the target's encoding; the two proxy call sites used to
    // disagree about what is proxyable.
    baseURL:
      proxying && mode === "always"
        ? buildProxiedUrl(cleanBase, proxy, "always")
        : cleanBase,
    dangerouslyAllowBrowser: true,
    // `POST /images/generations` is billable and not idempotent. The SDK retries
    // 408/409/429/5xx and connection failures by default, which would create a
    // second job (double billing, two divergent images) when a gateway accepts
    // the request and then drops the response. Retries belong to the visible
    // queue instead.
    maxRetries: 0,
    timeout: 180_000,
  };

  if (proxying && mode === "auto") {
    clientOptions.fetch = (input, init) =>
      corsAwareFetch(input, init, { corsProxy: proxy, corsProxyMode: "auto" });
  }

  return new OpenAI(clientOptions);
}

/**
 * Fetch online models from OpenAI-compatible /models endpoint using OpenAI SDK.
 * Strictly filters models where category is "image" and capability_tags include "Text to Image" or "Image to Image".
 * Reference: https://docs.apimart.ai/en/api-reference/texts/models/list
 */
export async function fetchOnlineModels(
  apiBaseUrl: string,
  apiKey: string,
  corsProxy?: string,
  corsProxyMode?: CorsProxyMode
): Promise<ModelOption[]> {
  const client = createOpenAiClient({ apiBaseUrl, apiKey, corsProxy, corsProxyMode });

  // Use client.models.list with expand=category query parameter for rich provider metadata
  const response = await client.models.list({
    query: { expand: "category" },
  });

  const rawList = (response.data || []) as unknown as RawModelItem[];

  if (rawList.length === 0) {
    return [];
  }

  const filteredList = filterImageGenerationModels(rawList);

  return filteredList.map((item) => {
    const id = item.id || String(item);
    return {
      id,
      name: item.name || id,
      ownedBy: item.owned_by,
      category: item.category,
      capabilityTags: item.capability_tags,
      supportedEndpointTypes: item.supported_endpoint_types,
    };
  });
}

/**
 * Fetch online models for LLM Assistant (Text & Vision) using OpenAI SDK.
 * Returns categorized text and vision models.
 */
export async function fetchOnlineLlmModels(
  apiBaseUrl: string,
  apiKey: string,
  corsProxy?: string,
  corsProxyMode?: CorsProxyMode
): Promise<{
  allModels: ModelOption[];
  textModels: ModelOption[];
  visionModels: ModelOption[];
}> {
  const client = createOpenAiClient({ apiBaseUrl, apiKey, corsProxy, corsProxyMode });

  const response = await client.models.list({
    query: { expand: "category" },
  });

  const rawList = (response.data || []) as unknown as RawModelItem[];

  const allModels: ModelOption[] = rawList.map((item) => {
    const id = item.id || String(item);
    return {
      id,
      name: item.name || id,
      ownedBy: item.owned_by,
      category: item.category,
      capabilityTags: item.capability_tags,
      supportedEndpointTypes: item.supported_endpoint_types,
    };
  });

  const hasMetadata = rawList.some(
    (item) =>
      Boolean(item.category) ||
      (Array.isArray(item.capability_tags) && item.capability_tags.length > 0) ||
      (Array.isArray(item.supported_endpoint_types) && item.supported_endpoint_types.length > 0)
  );

  let textModels: ModelOption[] = [];
  let visionModels: ModelOption[] = [];

  if (hasMetadata) {
    // Endpoint gate: supported_endpoint_types must CONTAIN "openai" (containment, not strict equality)
    const isOpenAiEndpoint = (m: ModelOption) =>
      !m.supportedEndpointTypes ||
      m.supportedEndpointTypes.length === 0 ||
      m.supportedEndpointTypes.some((t) => String(t).toLowerCase().includes("openai"));

    textModels = allModels.filter((m) => {
      if (!isOpenAiEndpoint(m)) return false;
      const cat = (m.category || "").toLowerCase().trim();
      // Exclude media and embedding modalities from the pure text assistant
      if (cat === "image" || cat === "video" || cat === "audio" || cat === "embedding") return false;
      const tags = (m.capabilityTags || []).map((t) => t.toLowerCase());
      // capability_tags must CONTAIN "Text" (containment, not exact equality);
      // generation tags such as "Text to Image / Video / Audio" do not qualify as chat text models
      if (tags.length > 0) {
        return tags.some(
          (t) =>
            t.includes("text") &&
            !t.includes("to image") &&
            !t.includes("to video") &&
            !t.includes("to audio")
        );
      }
      return cat === "chat" || cat === "text" || cat === "llm";
    });

    visionModels = allModels.filter((m) => {
      if (!isOpenAiEndpoint(m)) return false;
      const cat = (m.category || "").toLowerCase().trim();
      if (cat === "video" || cat === "audio") return false;
      const tags = (m.capabilityTags || []).map((t) => t.toLowerCase());
      if (tags.some((t) => t.includes("multimodal") || t.includes("vision") || t.includes("image to text"))) {
        return true;
      }
      const id = m.id.toLowerCase();
      return id.includes("4o") || id.includes("vision") || id.includes("gemini") || id.includes("claude") || id.includes("vl");
    });
  } else {
    // If provider does not support metadata, don't strictly filter
    textModels = allModels;
    visionModels = allModels.filter((m) => {
      const id = m.id.toLowerCase();
      return id.includes("4o") || id.includes("vision") || id.includes("gemini") || id.includes("claude") || id.includes("vl");
    });
  }

  // Strict filtering: do NOT fall back to allModels when nothing matches —
  // models can still be added manually in Settings.
  return { allModels, textModels, visionModels };
}

/**
 * Test connectivity with the OpenAI-compatible image endpoint
 */
export async function testImageServiceConnection(
  apiBaseUrl: string,
  apiKey: string,
  corsProxy?: string,
  corsProxyMode?: CorsProxyMode
): Promise<{ success: boolean; message: string; modelCount?: number }> {
  try {
    const models = await fetchOnlineModels(apiBaseUrl, apiKey, corsProxy, corsProxyMode);
    return {
      success: true,
      message: i18n.t("imgsvc.connectionSuccess", { count: models.length }),
      modelCount: models.length,
    };
  } catch (e) {
    return {
      success: false,
      message: e instanceof Error ? e.message : String(e),
    };
  }
}

/**
 * Safely extracts an asynchronous task ID from various gateway response shapes:
 * - APIMart array: { code: 200, data: [{ status: "submitted", task_id: "task_01M..." }] }
 * - APIMart object: { code: 200, data: { id: "task_01K..." } }
 * - Direct: { task_id: "..." } or { id: "..." }
 * - Nested: { data: { task_id: "..." } } or { data: { id: "..." } }
 */
export function extractTaskId(res: unknown): string | null {
  if (!res || typeof res !== "object") return null;
  const r = res as Record<string, any>;

  // Exclude synchronous OpenAI responses where data is an array of generated image items with URLs
  if (Array.isArray(r.data) && r.data.length > 0 && (r.data[0]?.url || r.data[0]?.b64_json)) {
    return null;
  }

  // 1. Root level keys
  if (typeof r.task_id === "string" && r.task_id.trim()) return r.task_id.trim();
  if (typeof r.id === "string" && r.id.trim()) return r.id.trim();

  // 2. Data as Array (e.g. APIMart gpt-image-2.5: data: [{ status: "submitted", task_id: "task_..." }])
  if (Array.isArray(r.data)) {
    for (const item of r.data) {
      if (item && typeof item === "object") {
        if (typeof item.task_id === "string" && item.task_id.trim()) return item.task_id.trim();
        if (typeof item.id === "string" && item.id.trim()) return item.id.trim();
      }
    }
  }

  // 3. Data as Object (e.g. data: { id: "task_..." } or data: { task_id: "task_..." })
  if (r.data && typeof r.data === "object" && !Array.isArray(r.data)) {
    if (typeof r.data.task_id === "string" && r.data.task_id.trim()) return r.data.task_id.trim();
    if (typeof r.data.id === "string" && r.data.id.trim()) return r.data.id.trim();
  }

  // 4. Root as Array
  if (Array.isArray(res)) {
    for (const item of res) {
      const id = extractTaskId(item);
      if (id) return id;
    }
  }

  return null;
}

/**
 * Universally and recursively extracts a valid image URL (or base64 URI) from various response formats:
 * - APIMart completed: { data: { result: { images: [{ url: ["https://..."] }] } } }
 * - OpenAI synchronous: { data: [{ url: "https://..." }] } or { data: [{ b64_json: "..." }] }
 * - Direct string url / data url
 * - Nested objects / arrays
 */
export function extractImageUrl(obj: unknown): string | null {
  if (!obj) return null;
  if (typeof obj === "string") {
    const s = obj.trim();
    if (s.startsWith("http://") || s.startsWith("https://") || s.startsWith("data:image/")) {
      return s;
    }
    return null;
  }
  if (Array.isArray(obj)) {
    for (const item of obj) {
      const url = extractImageUrl(item);
      if (url) return url;
    }
    return null;
  }
  if (typeof obj === "object") {
    const o = obj as Record<string, any>;

    // 1. Direct url keys
    if (typeof o.url === "string") {
      const u = extractImageUrl(o.url);
      if (u) return u;
    }
    if (Array.isArray(o.url)) {
      const u = extractImageUrl(o.url);
      if (u) return u;
    }
    if (typeof o.b64_json === "string" && o.b64_json.trim()) {
      // Gateways disagree: some return a bare payload, some a complete data URI,
      // some line-wrap the base64. Normalise all three, otherwise a nested
      // `data:image/png;base64,data:image/png;base64,...` string reaches the
      // image element and `atob` when saving.
      const raw = o.b64_json.trim();
      if (raw.startsWith("data:")) return raw.replace(/\s+/g, "");
      return `data:image/png;base64,${raw.replace(/\s+/g, "")}`;
    }
    if (o.image_url) {
      const u = extractImageUrl(o.image_url);
      if (u) return u;
    }
    if (o.imageUrl) {
      const u = extractImageUrl(o.imageUrl);
      if (u) return u;
    }

    // 2. Specific nested containers
    if (o.result) {
      const u = extractImageUrl(o.result);
      if (u) return u;
    }
    if (o.images) {
      const u = extractImageUrl(o.images);
      if (u) return u;
    }
    if (o.data) {
      const u = extractImageUrl(o.data);
      if (u) return u;
    }
    if (o.output) {
      const u = extractImageUrl(o.output);
      if (u) return u;
    }
  }
  return null;
}

/**
 * Poll APIMart / OpenAI-compatible asynchronous task until finished. The
 * transport is injected so local (OpenAI SDK) and managed (app API) callers
 * share the same response handling.
 */
type TaskStatusFetcher = (
  taskId: string,
  signal?: AbortSignal
) => Promise<unknown>;

export async function pollAsyncTaskWith(
  taskId: string,
  fetchTask: TaskStatusFetcher,
  signal?: AbortSignal,
  onProgress?: (update: { status: string; progress?: number }) => void
): Promise<string> {
  const maxAttempts = 90; // 90 * 2s = ~180s (3 mins) max wait for 2k/4k rendering
  let attempt = 0;

  while (attempt < maxAttempts) {
    if (signal?.aborted) {
      throw new Error(i18n.t("imgsvc.taskCancelled"));
    }

    await new Promise((r) => setTimeout(r, 2000));
    attempt++;

    try {
      const json = (await fetchTask(taskId, signal)) as Record<string, any>;

      const dataObj =
        json.data && typeof json.data === "object" && !Array.isArray(json.data)
          ? json.data
          : Array.isArray(json.data) && json.data[0] && typeof json.data[0] === "object"
          ? json.data[0]
          : json;

      const rawStatus = (
        dataObj.status ||
        json.status ||
        dataObj.state ||
        json.state ||
        ""
      )
        .toLowerCase()
        .trim();

      // Read real progress if server provided it (e.g. data.progress)
      let progress = 20 + Math.min(attempt * 2, 75);
      if (typeof dataObj.progress === "number" && dataObj.progress >= 0) {
        progress = Math.min(Math.max(dataObj.progress, 15), 98);
      } else if (typeof json.progress === "number" && json.progress >= 0) {
        progress = Math.min(Math.max(json.progress, 15), 98);
      }

      const statusMap: Record<string, string> = {
        submitted: i18n.t("imgsvc.statusSubmitted"),
        pending: i18n.t("imgsvc.statusPending"),
        processing: i18n.t("imgsvc.statusProcessing"),
        running: i18n.t("imgsvc.statusProcessing"),
      };

      onProgress?.({
        status: statusMap[rawStatus] || i18n.t("imgsvc.statusRenderingFallback", { status: rawStatus || "processing" }),
        progress,
      });

      const isSuccess =
        rawStatus === "completed" ||
        rawStatus === "success" ||
        rawStatus === "succeeded" ||
        rawStatus === "done";

      if (isSuccess) {
        onProgress?.({ status: i18n.t("imgsvc.renderCompleteProcessing"), progress: 100 });

        const imageUrl = extractImageUrl(json);
        if (imageUrl) {
          return imageUrl;
        }

        throw new Error(i18n.t("imgsvc.completedNoOutput"));
      }

      const isFailed =
        rawStatus === "failed" ||
        rawStatus === "error" ||
        rawStatus === "cancelled";

      if (isFailed) {
        const errorSource = dataObj.error || json.error || dataObj.message || json.message;
        let reason = i18n.t("imgsvc.providerInferenceFailed");
        if (typeof errorSource === "string" && errorSource.trim()) {
          reason = errorSource.trim();
        } else if (typeof errorSource === "object" && errorSource) {
          reason = errorSource.message || errorSource.code || JSON.stringify(errorSource);
        }
        throw new Error(i18n.t("imgsvc.taskFailed", { reason }));
      }

      // If status is not explicitly marked completed, but image URL is already present in response
      const immediateUrl = extractImageUrl(json);
      if (immediateUrl && (rawStatus === "" || rawStatus === "completed" || rawStatus === "success")) {
        return immediateUrl;
      }
    } catch (err) {
      if (signal?.aborted || err instanceof OpenAI.APIUserAbortError) {
        throw new Error(i18n.t("imgsvc.taskCancelled"), { cause: err });
      }
      // A revoked key, a missing/expired task id or a malformed request will
      // never fix itself: surface it now instead of polling for three minutes
      // and reporting a timeout the user cannot act on.
      const status =
        err instanceof OpenAI.APIError
          ? err.status ?? 0
          : typeof (err as { status?: unknown }).status === "number"
            ? ((err as { status: number }).status)
            : 0;
      if (
        status >= 400 &&
        status < 500 &&
        status !== 408 &&
        status !== 409 &&
        status !== 429
      ) {
        throw err;
      }
      if (err instanceof Error && err.message.includes(i18n.t("imgsvc.taskFailed", { reason: "" }))) {
        throw err;
      }
      if (err instanceof Error && err.message.includes(i18n.t("imgsvc.completedNoOutput"))) {
        throw err;
      }
      // Continue polling on transient errors
    }
  }

  throw new Error(i18n.t("imgsvc.pollTimeout", { taskId }));
}

function pollAsyncTask(
  taskId: string,
  client: OpenAI,
  signal?: AbortSignal,
  onProgress?: (update: { status: string; progress?: number }) => void
): Promise<string> {
  return pollAsyncTaskWith(
    taskId,
    (id, taskSignal) => client.get(`/tasks/${id}`, { signal: taskSignal }),
    signal,
    onProgress
  );
}

/**
 * Generate image using OpenAI SDK with OpenAI-compatible Image API
 * Reference: https://docs.apimart.ai/en#image-creation-api
 */
export async function generateImageWithOpenAiCompatible(
  config: {
    apiBaseUrl: string;
    apiKey: string;
    corsProxy?: string;
    corsProxyMode?: CorsProxyMode;
  },
  params: GenerateParams
): Promise<string> {
  const { apiBaseUrl, apiKey, corsProxy, corsProxyMode } = config;

  if (!apiKey || !apiKey.trim()) {
    throw new Error(i18n.t("imgsvc.missingApiKey"));
  }

  params.onProgress?.({ status: i18n.t("imgsvc.sendingRequest"), progress: 15 });

  const client = createOpenAiClient({ apiBaseUrl, apiKey, corsProxy, corsProxyMode });

  const officialEndpoint = isOfficialOpenAiEndpoint(apiBaseUrl);
  const isDalle = params.model.toLowerCase().startsWith("dall-e");

  if (officialEndpoint && ((params.imageUrls?.length ?? 0) > 0 || params.maskUrl)) {
    // /images/generations has no image inputs. Official editing lives on
    // /images/edits (multipart), which this path does not implement. Failing
    // loudly beats sending a text-only request and billing for the wrong image.
    throw new Error(i18n.t("imgsvc.officialImageEditUnsupported"));
  }

  const payload: Record<string, unknown> = {
    model: params.model,
    prompt: params.prompt,
    n: 1,
    size: formatSizeForModel(params.size, params.model),
  };

  // dall-e-2/3 are the only official models that accept response_format; the
  // gpt-image family rejects it.
  if (isDalle) {
    payload.response_format = "url";
  }

  // These are OpenAI-compatible gateway extensions, not official parameters.
  // Sending them to api.openai.com makes every request fail with
  // "Unrecognized request argument".
  if (!officialEndpoint) {
    // Resolution tier (1k, 2k, 4k) supported by gpt-image-2.5, FLUX, etc.
    if (params.resolution) {
      payload.resolution = params.resolution;
    }

    if (params.negativePrompt && params.negativePrompt.trim()) {
      payload.negative_prompt = params.negativePrompt.trim();
    }

    if (typeof params.seed === "number") {
      payload.seed = params.seed;
    }

    if (typeof params.steps === "number") {
      payload.steps = params.steps;
    }

    if (typeof params.cfgScale === "number") {
      payload.cfg_scale = params.cfgScale;
      payload.prompt_weight = params.cfgScale;
    }

    // One canonical array plus the single-image alias some providers still
    // require. The old payload echoed the same base64 into four fields
    // (image/image_url/image_urls/reference_images), quadrupling the request
    // body for the main image and doubling it for every reference.
    if (params.imageUrls && params.imageUrls.length > 0) {
      payload.image_urls = params.imageUrls;
      if (params.imageUrls.length === 1) {
        payload.image = params.imageUrls[0];
      }
    }

    if (params.maskUrl) {
      payload.mask = params.maskUrl;
    }
  }

  const response = (await client.images.generate(
    payload as unknown as OpenAI.Images.ImageGenerateParams,
    { signal: params.signal }
  )) as unknown as Record<string, any>;

  // 1. Direct synchronous response check (e.g. OpenAI official returning data array with url)
  if (Array.isArray(response?.data) && response.data[0]?.url) {
    const directUrl = extractImageUrl(response);
    if (directUrl) {
      params.onProgress?.({ status: i18n.t("imgsvc.generateSuccess"), progress: 100 });
      return directUrl;
    }
  }

  // 2. Asynchronous task response check (APIMart gpt-image-2.5, Flux, Midjourney, etc.)
  const taskId = extractTaskId(response);
  if (taskId) {
    params.onProgress?.({
      status: i18n.t("imgsvc.taskSubmitted", { taskId }),
      progress: 25,
    });
    return pollAsyncTask(
      taskId,
      client,
      params.signal,
      params.onProgress
    );
  }

  // 3. Fallback check for any immediate image url / base64
  const fallbackUrl = extractImageUrl(response);
  if (fallbackUrl) {
    params.onProgress?.({ status: i18n.t("imgsvc.generateSuccess"), progress: 100 });
    return fallbackUrl;
  }

  throw new Error(i18n.t("imgsvc.noTaskIdOrImage"));
}
