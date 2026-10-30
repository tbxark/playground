import { Hono } from "hono";
import type { Context } from "hono";
import { createRequireAuth } from "./auth";
import {
  parseManagedImageModels,
  parseOptionalModel,
  resolveUpstream,
  type ServerEnv,
} from "./env";
import {
  SERVER_ASSISTANT_PATH,
  SERVER_CONFIG_PATH,
  SERVER_ERROR_IMAGE_INPUT_UNSUPPORTED,
  SERVER_GENERATE_PATH,
  SERVER_TASK_PREFIX,
  type ServerAssistantRequest,
  type ServerAssistantResponse,
  type ServerErrorBody,
  type ServerGenerateRequest,
  type ServerManagedConfig,
} from "../shared/contracts";
import {
  PROMPT_ENHANCE_SYSTEM,
  PROMPT_TRANSLATE_SYSTEM,
  PROMPT_VISION_SYSTEM,
  PROMPT_VISION_USER,
} from "../shared/assistantPrompts";

export function buildManagedConfig(env: ServerEnv): ServerManagedConfig | null {
  const models = parseManagedImageModels(env);
  if (models.length === 0) return null;
  const textModel = parseOptionalModel(env.MANAGED_LLM_MODEL);
  const visionModel = parseOptionalModel(env.MANAGED_VISION_MODEL);
  return {
    image: { models, defaultModel: models[0] },
    assistant: {
      ...(textModel ? { textModel } : {}),
      ...(visionModel ? { visionModel } : {}),
    },
  };
}

/** Same-origin guard for authenticated application endpoints. */
function checkSameOrigin(c: Context): Response | null {
  const origin = c.req.header("origin");
  if (!origin) return null;
  try {
    if (new URL(origin).host !== new URL(c.req.url).host) {
      return c.json<ServerErrorBody>({ error: "cross_origin_forbidden" }, 403);
    }
  } catch {
    return c.json<ServerErrorBody>({ error: "invalid_request" }, 400);
  }
  return null;
}

async function readJson<T>(c: Context): Promise<T | null> {
  try {
    return (await c.req.json()) as T;
  } catch {
    return null;
  }
}

function upstreamHeaders(apiKey: string, extra?: Record<string, string>): Headers {
  const headers = new Headers(extra);
  headers.set("authorization", `Bearer ${apiKey}`);
  headers.set("content-type", "application/json");
  return headers;
}

async function forwardJson(
  c: Context,
  url: string,
  init: RequestInit
): Promise<Response> {
  let upstream: Response;
  try {
    upstream = await fetch(url, init);
  } catch {
    return c.json<ServerErrorBody>({ error: "upstream_unreachable" }, 502);
  }
  const body = await upstream.arrayBuffer();
  return new Response(body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: {
      "content-type": upstream.headers.get("content-type") ?? "application/json",
    },
  });
}

function isOfficialOpenAiEndpoint(baseUrl: string): boolean {
  try {
    return new URL(baseUrl).host === "api.openai.com";
  } catch {
    return false;
  }
}

/** Mirrors formatSizeForModel in src/services/imageService.ts. */
function formatSizeForModel(size: string, model: string): string {
  const isDalle = model.toLowerCase().startsWith("dall-e");
  if (isDalle) {
    switch (size) {
      case "16:9":
        return "1792x1024";
      case "9:16":
        return "1024x1792";
      default:
        return "1024x1024";
    }
  }
  if (!size || size === "auto") return "auto";
  if (size.includes("x")) {
    const [w, h] = size.split("x").map(Number);
    if (w && h) {
      if (w === h) return "1:1";
      if (Math.abs(w / h - 16 / 9) < 0.05) return "16:9";
      if (Math.abs(w / h - 9 / 16) < 0.05) return "9:16";
      if (Math.abs(w / h - 4 / 3) < 0.05) return "4:3";
      if (Math.abs(w / h - 3 / 4) < 0.05) return "3:4";
    }
  }
  return size;
}

function assistantMessages(body: ServerAssistantRequest) {
  if (body.kind === "vision") {
    return [
      { role: "system", content: PROMPT_VISION_SYSTEM },
      {
        role: "user",
        content: [
          { type: "text", text: PROMPT_VISION_USER },
          { type: "image_url", image_url: { url: body.image } },
        ],
      },
    ];
  }
  return [
    {
      role: "system",
      content:
        body.kind === "translate" ? PROMPT_TRANSLATE_SYSTEM : PROMPT_ENHANCE_SYSTEM,
    },
    { role: "user", content: body.prompt },
  ];
}

function extractAssistantText(json: unknown): string | null {
  const choices = (json as { choices?: unknown })?.choices;
  if (!Array.isArray(choices) || choices.length === 0) return null;
  const content = (choices[0] as { message?: { content?: unknown } })?.message
    ?.content;
  if (typeof content === "string" && content.trim()) return content.trim();
  if (Array.isArray(content)) {
    const text = content
      .map((part) =>
        part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string"
          ? (part as { text: string }).text
          : ""
      )
      .join("")
      .trim();
    return text || null;
  }
  return null;
}

export function registerManagedRoutes(app: Hono, env: ServerEnv): void {
  const requireAuth = createRequireAuth(env);
  const config = buildManagedConfig(env);

  app.get(SERVER_CONFIG_PATH, requireAuth, (c) => {
    if (!config) {
      return c.json<ServerErrorBody>({ error: "managed_config_incomplete" }, 503);
    }
    return c.json(config);
  });

  app.post(SERVER_GENERATE_PATH, requireAuth, async (c) => {
    const originError = checkSameOrigin(c);
    if (originError) return originError;
    if (!config) {
      return c.json<ServerErrorBody>({ error: "managed_config_incomplete" }, 503);
    }
    const body = await readJson<ServerGenerateRequest>(c);
    if (
      !body ||
      typeof body.model !== "string" ||
      typeof body.prompt !== "string" ||
      typeof body.size !== "string"
    ) {
      return c.json<ServerErrorBody>({ error: "invalid_request" }, 400);
    }
    if (!config.image.models.includes(body.model)) {
      return c.json<ServerErrorBody>({ error: "model_not_allowed" }, 403);
    }
    const upstream = resolveUpstream(env, "image");
    if (!upstream) {
      return c.json<ServerErrorBody>({ error: "upstream_unconfigured" }, 503);
    }

    const official = isOfficialOpenAiEndpoint(upstream.baseUrl);
    const isDalle = body.model.toLowerCase().startsWith("dall-e");
    if (
      official &&
      ((body.imageUrls?.length ?? 0) > 0 || Boolean(body.maskUrl))
    ) {
      // Official /images/generations ignores image inputs; official editing is
      // /images/edits, which this managed facade does not implement. Fail
      // loudly instead of billing for a text-only image.
      return c.json<ServerErrorBody>(
        { error: SERVER_ERROR_IMAGE_INPUT_UNSUPPORTED },
        400
      );
    }
    const payload: Record<string, unknown> = {
      model: body.model,
      prompt: body.prompt,
      n: 1,
      size: formatSizeForModel(body.size, body.model),
    };
    if (isDalle) payload.response_format = "url";
    if (!official) {
      if (body.resolution) payload.resolution = body.resolution;
      if (body.negativePrompt?.trim()) {
        payload.negative_prompt = body.negativePrompt.trim();
      }
      if (typeof body.seed === "number") payload.seed = body.seed;
      if (typeof body.steps === "number") payload.steps = body.steps;
      if (typeof body.cfgScale === "number") {
        payload.cfg_scale = body.cfgScale;
        payload.prompt_weight = body.cfgScale;
      }
      if (body.imageUrls?.length) {
        payload.image_urls = body.imageUrls;
        if (body.imageUrls.length === 1) payload.image = body.imageUrls[0];
      }
      if (body.maskUrl) payload.mask = body.maskUrl;
    }

    return forwardJson(c, `${upstream.baseUrl}/images/generations`, {
      method: "POST",
      headers: upstreamHeaders(upstream.apiKey),
      body: JSON.stringify(payload),
    });
  });

  app.get(`${SERVER_TASK_PREFIX}:id`, requireAuth, async (c) => {
    const originError = checkSameOrigin(c);
    if (originError) return originError;
    const upstream = resolveUpstream(env, "image");
    if (!upstream) {
      return c.json<ServerErrorBody>({ error: "upstream_unconfigured" }, 503);
    }
    const id = c.req.param("id");
    if (!id || id.includes("/")) {
      return c.json<ServerErrorBody>({ error: "invalid_request" }, 400);
    }
    return forwardJson(
      c,
      `${upstream.baseUrl}/tasks/${encodeURIComponent(id)}`,
      { method: "GET", headers: upstreamHeaders(upstream.apiKey) }
    );
  });

  app.post(SERVER_ASSISTANT_PATH, requireAuth, async (c) => {
    const originError = checkSameOrigin(c);
    if (originError) return originError;
    if (!config) {
      return c.json<ServerErrorBody>({ error: "managed_config_incomplete" }, 503);
    }
    const body = await readJson<ServerAssistantRequest>(c);
    if (!body || (body.kind !== "polish" && body.kind !== "translate" && body.kind !== "vision")) {
      return c.json<ServerErrorBody>({ error: "invalid_request" }, 400);
    }
    if (body.kind === "vision" ? !body.image : !body.prompt) {
      return c.json<ServerErrorBody>({ error: "invalid_request" }, 400);
    }
    const model =
      body.kind === "vision" ? config.assistant.visionModel : config.assistant.textModel;
    if (!model) {
      return c.json<ServerErrorBody>({ error: "assistant_model_unconfigured" }, 503);
    }
    const upstream = resolveUpstream(env, "llm");
    if (!upstream) {
      return c.json<ServerErrorBody>({ error: "upstream_unconfigured" }, 503);
    }

    const upstreamResponse = await forwardJson(c, `${upstream.baseUrl}/chat/completions`, {
      method: "POST",
      headers: upstreamHeaders(upstream.apiKey),
      body: JSON.stringify({
        model,
        messages: assistantMessages(body),
        temperature: body.kind === "vision" ? 0.5 : 0.7,
        stream: false,
      }),
    });
    if (!upstreamResponse.ok) return upstreamResponse;
    const json = (await upstreamResponse.json()) as unknown;
    const text = extractAssistantText(json);
    if (!text) {
      return c.json<ServerErrorBody>({ error: "assistant_empty_response" }, 502);
    }
    return c.json<ServerAssistantResponse>({ text });
  });
}
