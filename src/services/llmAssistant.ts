import OpenAI from "openai";
import { createOpenAiClient, ModelOption } from "./imageService";
import { i18n } from "@/i18n";
import { CorsProxyMode } from "@/utils/proxy";
import {
  PROMPT_ENHANCE_SYSTEM,
  PROMPT_TRANSLATE_SYSTEM,
  PROMPT_VISION_SYSTEM,
  PROMPT_VISION_USER,
} from "../../shared/assistantPrompts";

export {
  PROMPT_ENHANCE_SYSTEM,
  PROMPT_TRANSLATE_SYSTEM,
  PROMPT_VISION_SYSTEM,
  PROMPT_VISION_USER,
};

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
 * System prompts are exported above (shared/assistantPrompts.ts) so the
 * workflow code exporter can emit a script that behaves exactly like the
 * in-app assistant instead of a second copy.
 */

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
