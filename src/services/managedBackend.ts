import { i18n } from "@/i18n";
import { useServerStore } from "@/stores/useServerStore";
import {
  SERVER_ASSISTANT_PATH,
  SERVER_GENERATE_PATH,
  SERVER_TASK_PREFIX,
  type ServerAssistantRequest,
  type ServerAssistantResponse,
  type ServerGenerateRequest,
} from "../../shared/contracts";
import {
  extractImageUrl,
  extractTaskId,
  pollAsyncTaskWith,
} from "./imageService";
import type { GenerateParams } from "./types";

type StatusError = Error & { status?: number };

function sessionToken(): string {
  const token = useServerStore.getState().token;
  if (!token) {
    const error = new Error(i18n.t("server.sessionExpired")) as StatusError;
    error.status = 401;
    throw error;
  }
  return token;
}

async function managedError(response: Response): Promise<never> {
  if (response.status === 401) useServerStore.getState().markUnauthorized();
  let message = `HTTP ${response.status}`;
  try {
    const body = (await response.json()) as { error?: unknown };
    if (typeof body.error === "string") message = body.error;
  } catch {
    // keep the status text
  }
  const error = new Error(message) as StatusError;
  error.status = response.status;
  throw error;
}

function buildGenerateRequest(params: GenerateParams): ServerGenerateRequest {
  return {
    model: params.model,
    prompt: params.prompt,
    ...(params.negativePrompt?.trim()
      ? { negativePrompt: params.negativePrompt.trim() }
      : {}),
    ...(params.imageUrls?.length ? { imageUrls: params.imageUrls } : {}),
    ...(params.maskUrl ? { maskUrl: params.maskUrl } : {}),
    size: params.size,
    ...(params.resolution ? { resolution: params.resolution } : {}),
    ...(typeof params.seed === "number" ? { seed: params.seed } : {}),
    ...(typeof params.cfgScale === "number" ? { cfgScale: params.cfgScale } : {}),
    ...(typeof params.steps === "number" ? { steps: params.steps } : {}),
  };
}

export async function generateManagedImage(params: GenerateParams): Promise<string> {
  const token = sessionToken();
  params.onProgress?.({ status: i18n.t("imgsvc.sendingRequest"), progress: 15 });
  const response = await fetch(SERVER_GENERATE_PATH, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(buildGenerateRequest(params)),
    signal: params.signal,
  });
  if (!response.ok) return managedError(response);

  let json: unknown;
  try {
    json = await response.json();
  } catch {
    throw new Error(i18n.t("imgsvc.noTaskIdOrImage"));
  }

  const immediate = extractImageUrl(json);
  if (immediate) {
    params.onProgress?.({ status: i18n.t("imgsvc.generateSuccess"), progress: 100 });
    return immediate;
  }

  const taskId = extractTaskId(json);
  if (!taskId) throw new Error(i18n.t("imgsvc.noTaskIdOrImage"));
  params.onProgress?.({
    status: i18n.t("imgsvc.taskSubmitted", { taskId }),
    progress: 25,
  });

  return pollAsyncTaskWith(
    taskId,
    async (id, signal) => {
      const taskResponse = await fetch(
        `${SERVER_TASK_PREFIX}${encodeURIComponent(id)}`,
        {
          headers: { Authorization: `Bearer ${sessionToken()}` },
          signal,
        }
      );
      if (!taskResponse.ok) return managedError(taskResponse);
      return taskResponse.json();
    },
    params.signal,
    params.onProgress
  );
}

export async function managedAssistant(
  body: ServerAssistantRequest,
  signal?: AbortSignal
): Promise<string> {
  const response = await fetch(SERVER_ASSISTANT_PATH, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${sessionToken()}`,
    },
    body: JSON.stringify(body),
    signal,
  });
  if (!response.ok) return managedError(response);
  const json = (await response.json()) as ServerAssistantResponse;
  if (!json.text) throw new Error(i18n.t("llm.noValidPrompt"));
  return json.text;
}
