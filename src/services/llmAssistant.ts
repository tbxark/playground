import OpenAI from "openai";
import { createOpenAiClient, ModelOption } from "./imageService";
import { i18n } from "@/i18n";
import { CorsProxyMode } from "@/utils/proxy";

export type LlmConfig = {
  apiBaseUrl: string;
  apiKey: string;
  model: string;
  visionModel: string;
  corsProxy?: string;
  corsProxyMode?: CorsProxyMode;
  availableModels?: ModelOption[];
  availableVisionModels?: ModelOption[];
};

/**
 * Creates an OpenAI client instance with browser allowance and optional CORS proxy.
 * Shares the image client factory so "auto" mode behaves identically for both.
 */
export function getOpenAiLlmClient(config: LlmConfig): OpenAI {
  return createOpenAiClient({
    apiBaseUrl: config.apiBaseUrl,
    apiKey: config.apiKey,
    corsProxy: config.corsProxy,
    corsProxyMode: config.corsProxyMode,
  });
}

/**
 * System prompts are exported so the workflow code exporter can emit a script
 * that behaves exactly like the in-app assistant instead of a second copy.
 */
export const PROMPT_ENHANCE_SYSTEM =
  "你是一个顶尖的 Midjourney/Stable Diffusion/DALL-E 提示词工程专家。请将用户的简短构想深度润色与丰富细节，扩写出主体特征、场景环境、镜头视角、艺术画风、材质光影和情绪氛围，输出用于直接生图的精炼英文提示词（可中英并茂），不要包含任何解释、前缀或 Markdown 代码块。";

export const PROMPT_TRANSLATE_SYSTEM =
  "你是一个专业的 AI 生图提示词翻译专家。请将用户输入的生图描述精准翻译为英文高质量提示词，提炼视觉主体、场景细节、艺术画风与光影质感，输出纯文本，不要有任何多余的解释、问候或引号。";

export const PROMPT_VISION_SYSTEM =
  "你是一个专业的 AI 视觉反推专家。请细致观察用户提供的参考图，反推其生图提示词 (Prompt)，涵盖：画面主体、角色姿态、背景环境、构图视角、艺术媒介风格（如油画、3D渲染、二次元插画、写实摄影等）、色彩基调与光影质感。直接输出适合生图的提示词，严禁输出任何问候或解释说明。";

export const PROMPT_VISION_USER = "请精准反推这张参考图的生图提示词：";

/**
 * Text polish & translation assistant using OpenAI Chat Completions (stream explicitly disabled).
 */
export async function polishPrompt(
  prompt: string,
  config: LlmConfig,
  mode: "enhance" | "translate" = "enhance",
  signal?: AbortSignal
): Promise<string> {
  if (!config.apiKey?.trim()) {
    throw new Error(i18n.t("llm.missingApiKey"));
  }
  if (!config.model?.trim()) {
    throw new Error(i18n.t("llm.missingModel"));
  }

  const systemPrompt =
    mode === "translate" ? PROMPT_TRANSLATE_SYSTEM : PROMPT_ENHANCE_SYSTEM;

  const client = getOpenAiLlmClient(config);

  const completion = await client.chat.completions.create(
    {
      model: config.model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: prompt },
      ],
      temperature: 0.7,
      stream: false,
    },
    // A stalled assistant endpoint used to lock the button for the SDK's
    // 10-minute default with no way to cancel.
    { signal, timeout: 60_000 }
  );

  const result = completion.choices?.[0]?.message?.content?.trim();
  if (!result) {
    throw new Error(i18n.t("llm.noValidPrompt"));
  }

  return result;
}

/**
 * Vision image-to-prompt reverse engineering using OpenAI Multimodal Chat Completions (stream explicitly disabled).
 */
export async function imageToPrompt(
  imageDataUrl: string,
  config: LlmConfig,
  signal?: AbortSignal
): Promise<string> {
  if (!config.apiKey?.trim()) {
    throw new Error(i18n.t("llm.missingVisionApiKey"));
  }
  if (!config.visionModel?.trim()) {
    throw new Error(i18n.t("llm.missingVisionModel"));
  }

  const systemPrompt = PROMPT_VISION_SYSTEM;

  const client = getOpenAiLlmClient(config);

  const completion = await client.chat.completions.create(
    {
      model: config.visionModel,
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: [
            { type: "text", text: PROMPT_VISION_USER },
            {
              type: "image_url",
              image_url: { url: imageDataUrl },
            },
          ],
        },
      ],
      temperature: 0.5,
      stream: false,
    },
    { signal, timeout: 60_000 }
  );

  const result = completion.choices?.[0]?.message?.content?.trim();
  if (!result) {
    throw new Error(i18n.t("llm.visionNoPrompt"));
  }

  return result;
}

/**
 * Test connectivity with LLM endpoint (stream explicitly disabled, low max_tokens for instant roundtrip).
 */
export async function testLlmConnection(
  config: LlmConfig
): Promise<{ success: boolean; message: string }> {
  if (!config.apiKey?.trim()) {
    return {
      success: false,
      message: i18n.t("llm.testMissingKey"),
    };
  }

  if (!config.model?.trim()) {
    return {
      success: false,
      message: i18n.t("llm.missingModel"),
    };
  }

  try {
    const client = getOpenAiLlmClient(config);
    const completion = await client.chat.completions.create(
      {
        model: config.model,
        messages: [{ role: "user", content: "Ping connection test. Reply with 'OK'." }],
        max_tokens: 10,
        stream: false,
      },
      { timeout: 30_000 }
    );

    const reply = completion.choices?.[0]?.message?.content?.trim() || "OK";
    return {
      success: true,
      message: i18n.t("llm.testSuccess", { model: config.model, reply }),
    };
  } catch (e) {
    return {
      success: false,
      message: i18n.t("llm.testFailed", { msg: e instanceof Error ? e.message : String(e) }),
    };
  }
}
