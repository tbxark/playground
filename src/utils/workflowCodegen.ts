import type { WorkflowEdge, WorkflowNode } from "../stores/useWorkflowStore";
import { formatSizeForModel } from "../services/imageService";
import {
  PROMPT_ENHANCE_SYSTEM,
  PROMPT_TRANSLATE_SYSTEM,
  PROMPT_VISION_SYSTEM,
  PROMPT_VISION_USER,
} from "../services/llmAssistant";

/**
 * Workflow → standalone TypeScript script (official OpenAI SDK).
 *
 * The exporter mirrors what the canvas actually does at run time instead of
 * describing it abstractly: prompt nodes become string literals, image nodes
 * become local files read as data URLs, assistant nodes call Chat Completions
 * with the same system prompts, and generator nodes call the image endpoint
 * with the same payload (including the async task polling used by
 * OpenAI-compatible gateways). API keys are never embedded.
 */

export type WorkflowCodegenOptions = {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  image: {
    apiBaseUrl: string;
    model: string;
    enabledModelIds: string[];
  };
  llm: {
    apiBaseUrl: string;
    model: string;
    visionModel: string;
  };
};

export type WorkflowCodeWarning = {
  key: string;
  values?: Record<string, string | number>;
};

export type WorkflowCodegenStats = {
  nodes: number;
  edges: number;
  generators: number;
};

export type WorkflowCodegenResult =
  | {
      ok: true;
      code: string;
      warnings: WorkflowCodeWarning[];
      stats: WorkflowCodegenStats;
    }
  | {
      ok: false;
      error: "empty" | "cycle";
      nodeTitles: string[];
    };

const GENERATOR_FALLBACK_MODEL = "gpt-image-2";
const LLM_FALLBACK_MODEL = "gpt-4o-mini";
const VISION_FALLBACK_MODEL = "gpt-4o";
const DEFAULT_SIZE = "1:1";
const DEFAULT_RESOLUTION = "1k";

const SYSTEM_CONSTANTS = {
  enhance: "SYSTEM_ENHANCE",
  translate: "SYSTEM_TRANSLATE",
  vision: "SYSTEM_VISION",
  visionUser: "VISION_USER_PROMPT",
} as const;

type SystemConstant = keyof typeof SYSTEM_CONSTANTS;

/**
 * Node ids come from imported JSON, so they may be JavaScript keywords
 * (`class`), helper names emitted by this script (`generateImage`,
 * `imageClient`), or names that only differ by punctuation. Always prefix:
 * `const class = ...` was a SyntaxError, and a shadowed helper produced a TDZ
 * "used before declaration" error in the exported file.
 */
function sanitizeIdentifier(value: string): string {
  const cleaned = value.replace(/[^A-Za-z0-9_]/g, "_").replace(/_+/g, "_");
  return `node_${cleaned.replace(/_+$/, "")}` || "node_1";
}

function sanitizeFileName(value: string): string {
  return (
    value
      .replace(/[^A-Za-z0-9._-]+/g, "_")
      .replace(/^_+|_+$/g, "") || "image"
  );
}

function commentText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/**
 * Unique variable names per node. Node ids are user-importable, so a file may
 * contain ids that sanitize to the same identifier.
 */
function buildVariableNames(nodes: WorkflowNode[]): Map<string, string> {
  const used = new Set<string>();
  const names = new Map<string, string>();
  for (const node of nodes) {
    const base = sanitizeIdentifier(node.id);
    let name = base;
    let index = 2;
    while (used.has(name)) {
      name = `${base}_${index}`;
      index += 1;
    }
    used.add(name);
    names.set(node.id, name);
  }
  return names;
}

function topologicalOrder(
  nodes: WorkflowNode[],
  edges: WorkflowEdge[]
): { order: WorkflowNode[]; cycle: WorkflowNode[] } {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const indegree = new Map<string, number>(nodes.map((node) => [node.id, 0]));
  const outgoing = new Map<string, string[]>(
    nodes.map((node) => [node.id, []])
  );
  const seen = new Set<string>();

  for (const edge of edges) {
    if (!byId.has(edge.fromNodeId) || !byId.has(edge.toNodeId)) continue;
    if (edge.fromNodeId === edge.toNodeId) continue;
    const key = `${edge.fromNodeId}->${edge.toNodeId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    outgoing.get(edge.fromNodeId)?.push(edge.toNodeId);
    indegree.set(edge.toNodeId, (indegree.get(edge.toNodeId) ?? 0) + 1);
  }

  const queue = nodes
    .filter((node) => (indegree.get(node.id) ?? 0) === 0)
    .map((node) => node.id);
  const orderedIds: string[] = [];

  while (queue.length > 0) {
    const id = queue.shift()!;
    orderedIds.push(id);
    for (const next of outgoing.get(id) ?? []) {
      const remaining = (indegree.get(next) ?? 1) - 1;
      indegree.set(next, remaining);
      if (remaining === 0) queue.push(next);
    }
  }

  const orderedSet = new Set(orderedIds);
  const order = orderedIds
    .map((id) => byId.get(id))
    .filter((node): node is WorkflowNode => Boolean(node));
  const cycle = nodes.filter((node) => !orderedSet.has(node.id));
  return { order, cycle };
}

type EmitContext = {
  nodes: WorkflowNode[];
  nodeById: Map<string, WorkflowNode>;
  varNames: Map<string, string>;
  incoming: Map<string, WorkflowEdge[]>;
  options: WorkflowCodegenOptions;
  warnings: WorkflowCodeWarning[];
  usedImageToDataUrl: boolean;
  usedSystems: Set<SystemConstant>;
  consumed: Set<string>;
};

function incomingEdges(
  ctx: EmitContext,
  nodeId: string,
  port: string
): WorkflowEdge[] {
  return (ctx.incoming.get(nodeId) ?? []).filter(
    (edge) => edge.toPort === port
  );
}

function imageAssetPath(node: WorkflowNode, fallbackName?: string): string {
  let name = (
    fallbackName ??
    node.data.imageName ??
    sanitizeFileName(node.id)
  ).trim();
  name = name.replace(/[\\/:*?"<>|]+/g, "_");
  if (!/\.(png|jpe?g|webp|gif)$/i.test(name)) name += ".png";
  return `assets/${sanitizeFileName(name)}`;
}

function rawImageExpression(
  ctx: EmitContext,
  url: string,
  label: string,
  fallbackPath: string
): string {
  if (/^https?:\/\//i.test(url)) return JSON.stringify(url);
  ctx.usedImageToDataUrl = true;
  ctx.warnings.push({
    key: url.startsWith("data:")
      ? "workflow.codeDialog.warnUploadedImage"
      : "workflow.codeDialog.warnMissingImage",
    values: { node: label, path: fallbackPath },
  });
  return `await imageToDataUrl(${JSON.stringify(fallbackPath)})`;
}

function imageNodeExpression(ctx: EmitContext, node: WorkflowNode): string {
  const url = node.data.imageUrl?.trim();
  if (url) {
    return rawImageExpression(
      ctx,
      url,
      node.title,
      imageAssetPath(node)
    );
  }
  ctx.usedImageToDataUrl = true;
  const path = imageAssetPath(node);
  ctx.warnings.push({
    key: "workflow.codeDialog.warnMissingImage",
    values: { node: node.title, path },
  });
  return `await imageToDataUrl(${JSON.stringify(path)})`;
}

function sourceImageExpression(
  ctx: EmitContext,
  source: WorkflowNode
): string | null {
  if (source.type === "image" || source.type === "generator") {
    ctx.consumed.add(source.id);
    return ctx.varNames.get(source.id) ?? null;
  }
  const url = source.data.imageUrl?.trim();
  if (!url) return null;
  return rawImageExpression(ctx, url, source.title, imageAssetPath(source));
}

function sourceTextPart(
  ctx: EmitContext,
  version: "generator" | "assistant",
  source: WorkflowNode
): string | null {
  if (source.type === "prompt" || source.type === "assistant") {
    ctx.consumed.add(source.id);
    return ctx.varNames.get(source.id) ?? null;
  }
  // Generator prompts never carry inline text today; assistant execution
  // ignores these sources, so only the generator path keeps them.
  if (version === "generator" && source.data.promptText?.trim()) {
    return JSON.stringify(source.data.promptText.trim());
  }
  return null;
}

function joinTextExpression(
  lines: string[],
  variableName: string,
  parts: string[]
): string {
  if (parts.length === 1) return parts[0];
  lines.push(
    `const ${variableName} = [${parts.join(", ")}]`,
    "  .map((part) => part.trim())",
    "  .filter(Boolean)",
    '  .join("\\n");'
  );
  return variableName;
}

function emitAssistant(
  ctx: EmitContext,
  node: WorkflowNode,
  lines: string[]
): void {
  const varName = ctx.varNames.get(node.id)!;
  const mode = node.data.assistantMode ?? "enhance";
  const isVision = mode === "vision";
  const model = isVision
    ? ctx.options.llm.visionModel.trim() || VISION_FALLBACK_MODEL
    : ctx.options.llm.model.trim() || LLM_FALLBACK_MODEL;

  if (isVision) {
    if (!ctx.options.llm.visionModel.trim()) {
      ctx.warnings.push({
        key: "workflow.codeDialog.warnVisionModel",
        values: { model },
      });
      lines.push(
        `// TODO: select a Vision model; the export falls back to "${commentText(model)}".`
      );
    }
    ctx.usedSystems.add("vision");
    ctx.usedSystems.add("visionUser");

    let imageExpression: string | null = null;
    for (const edge of incomingEdges(ctx, node.id, "image")) {
      const source = ctx.nodeById.get(edge.fromNodeId);
      if (!source) continue;
      imageExpression = sourceImageExpression(ctx, source);
      if (imageExpression) break;
    }
    if (!imageExpression && node.data.inputImageUrl?.trim()) {
      imageExpression = rawImageExpression(
        ctx,
        node.data.inputImageUrl.trim(),
        node.title,
        imageAssetPath(node, `vision-${sanitizeFileName(node.id)}.png`)
      );
    }
    if (!imageExpression) {
      ctx.usedImageToDataUrl = true;
      const path = `assets/vision-${sanitizeFileName(node.id)}.png`;
      ctx.warnings.push({
        key: "workflow.codeDialog.warnVisionNoImage",
        values: { node: node.title, path },
      });
      lines.push(
        `// TODO: place the Vision reference image for "${commentText(
          node.title
        )}" at ${path}.`
      );
      imageExpression = `await imageToDataUrl(${JSON.stringify(path)})`;
    }

    const inputVar = `visionInput_${varName}`;
    lines.push(`const ${inputVar} = ${imageExpression};`);
    lines.push(
      `const visionContent_${varName}: OpenAI.Chat.ChatCompletionContentPart[] = [`,
      `  { type: "text", text: ${SYSTEM_CONSTANTS.visionUser} },`,
      `  { type: "image_url", image_url: { url: ${inputVar} } },`,
      "];"
    );
    lines.push(
      `const ${varName} = await runChat(llmClient, {`,
      `  model: ${JSON.stringify(model)},`,
      `  system: ${SYSTEM_CONSTANTS.vision},`,
      `  user: visionContent_${varName},`,
      "  temperature: 0.5,",
      "});"
    );
    return;
  }

  if (!ctx.options.llm.model.trim()) {
    ctx.warnings.push({
      key: "workflow.codeDialog.warnLlmModel",
      values: { model },
    });
    lines.push(
      `// TODO: select an assistant text model; the export falls back to "${commentText(model)}".`
    );
  }
  ctx.usedSystems.add(mode === "translate" ? "translate" : "enhance");

  const parts: string[] = [];
  if (node.data.inputPrompt?.trim()) {
    parts.push(JSON.stringify(node.data.inputPrompt.trim()));
  }
  for (const edge of incomingEdges(ctx, node.id, "text")) {
    const source = ctx.nodeById.get(edge.fromNodeId);
    if (!source) continue;
    const part = sourceTextPart(ctx, "assistant", source);
    if (part) parts.push(part);
  }

  let userExpression = '""';
  if (parts.length === 0) {
    ctx.warnings.push({
      key: "workflow.codeDialog.warnEmptyAssistant",
      values: { node: node.title },
    });
    lines.push(
      `// TODO: connect a prompt/image node or write inputPrompt for "${commentText(
        node.title
      )}".`
    );
  } else {
    userExpression = joinTextExpression(
      lines,
      `inputText_${varName}`,
      parts
    );
  }

  lines.push(
    `const ${varName} = await runChat(llmClient, {`,
    `  model: ${JSON.stringify(model)},`,
    `  system: ${
      mode === "translate"
        ? SYSTEM_CONSTANTS.translate
        : SYSTEM_CONSTANTS.enhance
    },`,
    `  user: ${userExpression},`,
    "  temperature: 0.7,",
    "});"
  );
}

function emitGenerator(
  ctx: EmitContext,
  node: WorkflowNode,
  lines: string[]
): void {
  const varName = ctx.varNames.get(node.id)!;
  const configuredModel =
    node.data.model?.trim() || ctx.options.image.model.trim();
  const model = configuredModel || GENERATOR_FALLBACK_MODEL;

  if (!configuredModel) {
    ctx.warnings.push({
      key: "workflow.codeDialog.warnNoImageModel",
      values: { node: node.title, model },
    });
    lines.push(
      `// TODO: select an enabled image model; the export falls back to "${commentText(model)}".`
    );
  } else if (!ctx.options.image.enabledModelIds.includes(model)) {
    ctx.warnings.push({
      key: "workflow.codeDialog.warnModelNotEnabled",
      values: { node: node.title, model },
    });
    lines.push(
      `// TODO: enable "${model}" in Settings or change the model in this call.`
    );
  }

  const imageParts: string[] = [];
  for (const edge of incomingEdges(ctx, node.id, "image")) {
    const source = ctx.nodeById.get(edge.fromNodeId);
    if (!source) continue;
    const part = sourceImageExpression(ctx, source);
    if (part) imageParts.push(part);
  }

  const promptParts: string[] = [];
  if (node.data.promptText?.trim()) {
    promptParts.push(JSON.stringify(node.data.promptText.trim()));
  }
  for (const edge of incomingEdges(ctx, node.id, "prompt")) {
    const source = ctx.nodeById.get(edge.fromNodeId);
    if (!source) continue;
    const part = sourceTextPart(ctx, "generator", source);
    if (part) promptParts.push(part);
  }

  if (promptParts.length === 0 && imageParts.length === 0) {
    ctx.warnings.push({
      key: "workflow.codeDialog.warnNoPrompt",
      values: { node: node.title },
    });
    lines.push(
      `// TODO: connect a prompt or reference image for "${commentText(
        node.title
      )}".`
    );
  }

  const promptExpression =
    promptParts.length === 0
      ? '""'
      : joinTextExpression(lines, `promptText_${varName}`, promptParts);

  const size = node.data.size?.trim() || DEFAULT_SIZE;
  const resolution = node.data.resolution?.trim() || DEFAULT_RESOLUTION;
  const apiSize = formatSizeForModel(size, model);

  lines.push(`const ${varName} = await generateImage(imageClient, {`);
  lines.push(`  model: ${JSON.stringify(model)},`);
  lines.push(`  prompt: ${promptExpression},`);
  lines.push(`  size: ${JSON.stringify(apiSize)},`);
  lines.push(`  resolution: ${JSON.stringify(resolution)},`);
  if (node.data.negativePrompt?.trim()) {
    lines.push(
      `  negativePrompt: ${JSON.stringify(node.data.negativePrompt.trim())},`
    );
  }
  if (typeof node.data.seed === "number") {
    lines.push(`  seed: ${node.data.seed},`);
  }
  if (typeof node.data.steps === "number") {
    lines.push(`  steps: ${node.data.steps},`);
  }
  if (typeof node.data.cfgScale === "number") {
    lines.push(`  cfgScale: ${node.data.cfgScale},`);
  }
  if (imageParts.length > 0) {
    lines.push(`  imageUrls: [${imageParts.join(", ")}],`);
  }
  lines.push("});");

  const fileVar = `file_${varName}`;
  lines.push(
    `const ${fileVar} = await saveImage(${varName}, ${JSON.stringify(
      `outputs/${varName}.png`
    )});`,
    `console.log("Saved:", ${fileVar});`
  );
}

const HELPER_BLOCKS = {
  requireEnv: [
    "function requireEnv(name: string): string {",
    "  const value = process.env[name];",
    "  if (!value) throw new Error(`Missing environment variable: ${name}`);",
    "  return value;",
    "}",
  ],
  runChat: [
    "type ChatContent = string | OpenAI.Chat.ChatCompletionContentPart[];",
    "",
    "async function runChat(",
    "  client: OpenAI,",
    "  options: { model: string; system: string; user: ChatContent; temperature: number }",
    "): Promise<string> {",
    "  const completion = await client.chat.completions.create({",
    "    model: options.model,",
    "    messages: [",
    '      { role: "system", content: options.system },',
    '      { role: "user", content: options.user },',
    "    ],",
    "    temperature: options.temperature,",
    "    stream: false,",
    "  });",
    "  const text = completion.choices[0]?.message?.content?.trim();",
    '  if (!text) throw new Error("The language model returned an empty response.");',
    "  return text;",
    "}",
  ],
  pickString: [
    "function pickString(value: unknown, ...keys: string[]): string {",
    '  if (!value || typeof value !== "object") return "";',
    "  const record = value as Record<string, unknown>;",
    "  for (const key of keys) {",
    "    const raw = record[key];",
    "    if (typeof raw === \"string\" && raw.trim()) return raw.trim();",
    "  }",
    '  return "";',
    "}",
  ],
  extractTaskId: [
    "function extractTaskId(value: unknown): string | null {",
    '  if (!value || typeof value !== "object") return null;',
    "  const response = value as Record<string, unknown>;",
    "  const first = Array.isArray(response.data) ? response.data[0] : undefined;",
    '  if (first && typeof first === "object") {',
    "    const item = first as Record<string, unknown>;",
    "    if (item.url || item.b64_json) return null;",
    "  }",
    '  const direct = pickString(response, "task_id", "id");',
    "  if (direct) return direct;",
    "  if (Array.isArray(response.data)) {",
    "    for (const item of response.data) {",
    '      const id = pickString(item, "task_id", "id");',
    "      if (id) return id;",
    "    }",
    "  }",
    '  return pickString(response.data, "task_id", "id") || null;',
    "}",
  ],
  extractImageUrl: [
    "function extractImageUrl(value: unknown): string | null {",
    "  if (!value) return null;",
    '  if (typeof value === "string") {',
    "    const text = value.trim();",
    "    return /^(https?:\\/\\/|data:image\\/)/.test(text) ? text : null;",
    "  }",
    "  if (Array.isArray(value)) {",
    "    for (const item of value) {",
    "      const found = extractImageUrl(item);",
    "      if (found) return found;",
    "    }",
    "    return null;",
    "  }",
    '  if (typeof value === "object") {',
    "    const record = value as Record<string, unknown>;",
    "    const base64 = record.b64_json;",
    '    if (typeof base64 === "string" && base64.trim()) {',
    "      return `data:image/png;base64,${base64.trim()}`;",
    "    }",
    '    for (const key of ["url", "image_url", "imageUrl", "result", "images", "data", "output"]) {',
    "      if (!(key in record)) continue;",
    "      const found = extractImageUrl(record[key]);",
    "      if (found) return found;",
    "    }",
    "  }",
    "  return null;",
    "}",
  ],
  readTaskStatus: [
    "function readTaskStatus(response: Record<string, unknown>): {",
    "  status: string;",
    "  error: string;",
    "} {",
    "  const data = Array.isArray(response.data) ? response.data[0] : response.data;",
    '  const source = data && typeof data === "object" ? (data as Record<string, unknown>) : response;',
    "  const status = String(",
    '    source.status ?? response.status ?? source.state ?? response.state ?? ""',
    "  )",
    "    .toLowerCase()",
    "    .trim();",
    "  const rawError = source.error ?? response.error ?? source.message ?? response.message;",
    '  let error = "";',
    '  if (typeof rawError === "string") {',
    "    error = rawError;",
    '  } else if (rawError && typeof rawError === "object") {',
    "    const record = rawError as Record<string, unknown>;",
    "    error = String(record.message ?? record.code ?? JSON.stringify(rawError));",
    "  }",
    "  return { status, error };",
    "}",
  ],
  waitForTask: [
    "async function waitForTask(",
    "  client: OpenAI,",
    "  taskId: string,",
    "  timeoutMs = 180_000",
    "): Promise<string> {",
    "  const startedAt = Date.now();",
    "  while (Date.now() - startedAt < timeoutMs) {",
    "    await new Promise((resolve) => setTimeout(resolve, 2000));",
    "    const response = (await client.get(`/tasks/${taskId}`)) as Record<string, unknown>;",
    "    const { status, error } = readTaskStatus(response);",
    '    if (["completed", "success", "succeeded", "done"].includes(status)) {',
    "      const url = extractImageUrl(response);",
    "      if (url) return url;",
    "      throw new Error(`Task ${taskId} completed without an image.`);",
    "    }",
    '    if (["failed", "error", "cancelled"].includes(status)) {',
    "      throw new Error(`Task ${taskId} failed${error ? `: ${error}` : \".\"}`);",
    "    }",
    "  }",
    "  throw new Error(`Timed out waiting for task ${taskId}.`);",
    "}",
  ],
  generateImage: [
    "type GenerateImageOptions = {",
    "  model: string;",
    "  prompt: string;",
    "  size: string;",
    "  resolution: string;",
    "  negativePrompt?: string;",
    "  imageUrls?: string[];",
    "  seed?: number;",
    "  steps?: number;",
    "  cfgScale?: number;",
    "};",
    "",
    "async function generateImage(",
    "  client: OpenAI,",
    "  options: GenerateImageOptions",
    "): Promise<string> {",
    "  const payload: Record<string, unknown> = {",
    "    model: options.model,",
    "    prompt: options.prompt,",
    "    n: 1,",
    "    size: options.size,",
    '    response_format: "url",',
    "    resolution: options.resolution,",
    "  };",
    "  if (options.negativePrompt) payload.negative_prompt = options.negativePrompt;",
    "  if (typeof options.seed === \"number\") payload.seed = options.seed;",
    "  if (typeof options.steps === \"number\") payload.steps = options.steps;",
    "  if (typeof options.cfgScale === \"number\") {",
    "    payload.cfg_scale = options.cfgScale;",
    "    payload.prompt_weight = options.cfgScale;",
    "  }",
    "  if (options.imageUrls?.length) {",
    "    payload.image = options.imageUrls[0];",
    "    payload.image_url = options.imageUrls[0];",
    "    payload.image_urls = options.imageUrls;",
    "    payload.reference_images = options.imageUrls;",
    "  }",
    "",
    "  const response = (await client.images.generate(",
    "    payload as unknown as OpenAI.Images.ImageGenerateParams,",
    "    { signal: AbortSignal.timeout(10 * 60 * 1000) }",
    "  )) as unknown as Record<string, unknown>;",
    "",
    "  const data = Array.isArray(response.data) ? response.data[0] : undefined;",
    '  if (data && typeof data === "object") {',
    '    const url = pickString(data, "url");',
    "    if (url) return url;",
    '    const base64 = pickString(data, "b64_json");',
    "    if (base64) return `data:image/png;base64,${base64}`;",
    "  }",
    "",
    "  const taskId = extractTaskId(response);",
    "  if (taskId) return waitForTask(client, taskId);",
    "",
    "  const fallback = extractImageUrl(response);",
    "  if (fallback) return fallback;",
    '  throw new Error("The image API returned neither an image URL nor a task id.");',
    "}",
  ],
  saveImage: [
    "async function saveImage(url: string, filePath: string): Promise<string> {",
    "  await mkdir(dirname(filePath), { recursive: true });",
    '  if (url.startsWith("data:")) {',
    '    const comma = url.indexOf(",");',
    "    const meta = url.slice(0, comma);",
    "    const data = url.slice(comma + 1);",
    '    const buffer = meta.includes(";base64")',
    '      ? Buffer.from(data, "base64")',
    "      : Buffer.from(decodeURIComponent(data));",
    "    await writeFile(filePath, buffer);",
    "  } else {",
    "    const response = await fetch(url);",
    "    if (!response.ok) {",
    "      throw new Error(`Failed to download the generated image: ${response.status}`);",
    "    }",
    "    await writeFile(filePath, Buffer.from(await response.arrayBuffer()));",
    "  }",
    "  return filePath;",
    "}",
  ],
  imageToDataUrl: [
    "async function imageToDataUrl(filePath: string): Promise<string> {",
    "  const extension = extname(filePath).toLowerCase();",
    "  const mime =",
    '    extension === ".jpg" || extension === ".jpeg"',
    '      ? "image/jpeg"',
    '      : extension === ".webp"',
    '        ? "image/webp"',
    '        : extension === ".gif"',
    '          ? "image/gif"',
    '          : "image/png";',
    "  const data = await readFile(filePath);",
    '  return `data:${mime};base64,${data.toString("base64")}`;',
    "}",
  ],
} as const;

export function generateWorkflowCode(
  options: WorkflowCodegenOptions
): WorkflowCodegenResult {
  const { nodes, edges } = options;
  if (nodes.length === 0) {
    return { ok: false, error: "empty", nodeTitles: [] };
  }

  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const usableEdges = edges.filter(
    (edge) =>
      edge.fromNodeId !== edge.toNodeId &&
      nodeById.has(edge.fromNodeId) &&
      nodeById.has(edge.toNodeId)
  );

  const { order, cycle } = topologicalOrder(nodes, usableEdges);
  if (cycle.length > 0) {
    return {
      ok: false,
      error: "cycle",
      nodeTitles: cycle.map((node) => node.title),
    };
  }

  const incoming = new Map<string, WorkflowEdge[]>();
  for (const edge of usableEdges) {
    const list = incoming.get(edge.toNodeId);
    if (list) list.push(edge);
    else incoming.set(edge.toNodeId, [edge]);
  }

  const hasGenerator = order.some((node) => node.type === "generator");
  const hasAssistant = order.some((node) => node.type === "assistant");

  const ctx: EmitContext = {
    nodes,
    nodeById,
    varNames: buildVariableNames(nodes),
    incoming,
    options,
    warnings: [],
    usedImageToDataUrl: false,
    usedSystems: new Set(),
    consumed: new Set<string>(),
  };

  const body: string[] = [];
  for (const node of order) {
    body.push(`// [${node.type}] ${commentText(node.title)}`);
    switch (node.type) {
      case "prompt": {
        const text = node.data.promptText?.trim() ?? "";
        if (!text) {
          ctx.warnings.push({
            key: "workflow.codeDialog.warnEmptyPrompt",
            values: { node: node.title },
          });
          body.push(
            `// TODO: write the prompt for "${commentText(node.title)}".`
          );
        }
        body.push(
          `const ${ctx.varNames.get(node.id)} = ${JSON.stringify(text)};`
        );
        break;
      }
      case "image": {
        const url = node.data.imageUrl?.trim();
        if (!url || !/^https?:\/\//i.test(url)) {
          body.push(
            `// TODO: place the reference image for "${commentText(
              node.title
            )}" at ${imageAssetPath(node)}.`
          );
        }
        body.push(
          `const ${ctx.varNames.get(node.id)} = ${imageNodeExpression(
            ctx,
            node
          )};`
        );
        break;
      }
      case "assistant": {
        emitAssistant(ctx, node, body);
        break;
      }
      case "generator": {
        emitGenerator(ctx, node, body);
        break;
      }
      case "preview": {
        body.push(
          "// Preview is a UI-only node in the playground; nothing is executed here."
        );
        const sourceEdge = incomingEdges(ctx, node.id, "image")[0];
        const source = sourceEdge
          ? nodeById.get(sourceEdge.fromNodeId)
          : undefined;
        if (source) {
          body.push(
            `// Source value: ${ctx.varNames.get(source.id) ?? source.id}`
          );
          if (source.type === "generator") {
            body.push(`// Saved file: file_${ctx.varNames.get(source.id)}`);
          }
        }
        break;
      }
    }
    body.push("");
  }

  if (!hasGenerator) {
    ctx.warnings.push({ key: "workflow.codeDialog.warnNoGenerator" });
  }

  // Nodes that nothing downstream consumed would otherwise be unused locals in
  // the generated module. Keep them referenced: text is printed for inspection,
  // image data URLs are only marked as read so strict builds stay clean.
  const leafLines: string[] = [];
  for (const node of order) {
    if (node.type === "generator" || node.type === "preview") continue;
    if (ctx.consumed.has(node.id)) continue;
    const varName = ctx.varNames.get(node.id);
    if (!varName) continue;
    if (node.type === "image") {
      leafLines.push(`void ${varName};`);
    } else {
      leafLines.push(
        `console.log(${JSON.stringify(
          `Result (${commentText(node.title)}):`
        )}, ${varName});`
      );
    }
  }
  if (leafLines.length > 0) {
    body.push(
      "// Outputs that no generator consumed are kept for inspection.",
      ...leafLines,
      ""
    );
  }

  const usesAnyClient = hasGenerator || hasAssistant;
  const imports: string[] = [];
  if (usesAnyClient) imports.push('import OpenAI from "openai";');
  if (hasGenerator || ctx.usedImageToDataUrl) {
    const fsNames: string[] = [];
    if (hasGenerator) fsNames.push("mkdir", "writeFile");
    if (ctx.usedImageToDataUrl) fsNames.push("readFile");
    fsNames.sort();
    const pathNames: string[] = [];
    if (hasGenerator) pathNames.push("dirname");
    if (ctx.usedImageToDataUrl) pathNames.push("extname");
    pathNames.sort();
    imports.push(`import { ${fsNames.join(", ")} } from "node:fs/promises";`);
    imports.push(`import { ${pathNames.join(", ")} } from "node:path";`);
  }

  const setup: string[] = [];
  if (usesAnyClient) {
    const envLines = ["// Environment variables:"];
    if (hasGenerator) {
      envLines.push("//   IMAGE_API_KEY=sk-...   API key for the image endpoint");
    }
    if (hasAssistant) {
      envLines.push(
        hasGenerator
          ? "//   LLM_API_KEY=sk-...     API key for assistant nodes (defaults to IMAGE_API_KEY)"
          : "//   LLM_API_KEY=sk-...     API key for the assistant endpoint"
      );
    }
    const imageSuffix = hasGenerator ? "IMAGE_API_KEY=sk-... " : "";
    const llmSuffix = hasAssistant ? "LLM_API_KEY=sk-... " : "";
    setup.push(
      hasGenerator
        ? "// Requires Node.js 18+ (global fetch, AbortSignal.timeout)."
        : "// Requires Node.js 18+ (global fetch).",
      "//",
      "// Setup:",
      "//   npm install openai",
      "//   npm install -D typescript tsx @types/node",
      "//",
      ...envLines,
      "//",
      "// Run:",
      `//   ${imageSuffix}${llmSuffix}npx tsx workflow.ts`,
      "//",
      "// API keys are read from the environment and never embedded in this file.",
      "// Search for TODO to find values that must be checked before running.",
      ""
    );
  } else {
    setup.push(
      "// Requires Node.js 18+.",
      "//",
      "// Setup:",
      "//   npm install -D typescript tsx @types/node",
      "//",
      "// Run:",
      "//   npx tsx workflow.ts",
      ""
    );
  }

  const header = [
    "// Generated by AI Image Playground — workflow → OpenAI SDK (TypeScript)",
    `// Workflow snapshot: ${nodes.length} nodes, ${usableEdges.length} ${
      usableEdges.length === 1 ? "connection" : "connections"
    }.`,
    "//",
    ...setup,
  ];

  const clientSetup: string[] = [];
  if (hasGenerator) {
    clientSetup.push(
      "const imageClient = new OpenAI({",
      '  apiKey: requireEnv("IMAGE_API_KEY"),',
      `  baseURL: process.env.IMAGE_BASE_URL ?? ${JSON.stringify(
        options.image.apiBaseUrl
      )},`,
      "});",
      ""
    );
  }
  if (hasAssistant) {
    clientSetup.push(
      "const llmClient = new OpenAI({",
      hasGenerator
        ? '  apiKey: process.env.LLM_API_KEY ?? requireEnv("IMAGE_API_KEY"),'
        : '  apiKey: requireEnv("LLM_API_KEY"),',
      `  baseURL: process.env.LLM_BASE_URL ?? ${JSON.stringify(
        options.llm.apiBaseUrl
      )},`,
      "});",
      ""
    );
  }

  const promptConstants: string[] = [];
  if (ctx.usedSystems.has("enhance")) {
    promptConstants.push(
      `const ${SYSTEM_CONSTANTS.enhance} = ${JSON.stringify(
        PROMPT_ENHANCE_SYSTEM
      )};`,
      ""
    );
  }
  if (ctx.usedSystems.has("translate")) {
    promptConstants.push(
      `const ${SYSTEM_CONSTANTS.translate} = ${JSON.stringify(
        PROMPT_TRANSLATE_SYSTEM
      )};`,
      ""
    );
  }
  if (ctx.usedSystems.has("vision")) {
    promptConstants.push(
      `const ${SYSTEM_CONSTANTS.vision} = ${JSON.stringify(
        PROMPT_VISION_SYSTEM
      )};`,
      ""
    );
  }
  if (ctx.usedSystems.has("visionUser")) {
    promptConstants.push(
      `const ${SYSTEM_CONSTANTS.visionUser} = ${JSON.stringify(
        PROMPT_VISION_USER
      )};`,
      ""
    );
  }

  const helpers: string[] = [];
  if (usesAnyClient) helpers.push(...HELPER_BLOCKS.requireEnv, "");
  if (hasAssistant) helpers.push(...HELPER_BLOCKS.runChat, "");
  if (hasGenerator) {
    helpers.push(
      ...HELPER_BLOCKS.pickString,
      "",
      ...HELPER_BLOCKS.extractTaskId,
      "",
      ...HELPER_BLOCKS.extractImageUrl,
      "",
      ...HELPER_BLOCKS.readTaskStatus,
      "",
      ...HELPER_BLOCKS.waitForTask,
      "",
      ...HELPER_BLOCKS.generateImage,
      "",
      ...HELPER_BLOCKS.saveImage,
      ""
    );
  }
  if (ctx.usedImageToDataUrl) {
    helpers.push(...HELPER_BLOCKS.imageToDataUrl, "");
  }

  const mainBlock = [
    "async function main(): Promise<void> {",
    ...body.map((line) => (line ? `  ${line}` : "")),
    "}",
    "",
  ];

  const code = [
    ...header,
    ...(imports.length > 0 ? [...imports, ""] : []),
    ...promptConstants,
    ...clientSetup,
    ...mainBlock,
    ...(helpers.length > 0 ? [...helpers, ""] : []),
    "main().catch((error) => {",
    "  console.error(error);",
    "  process.exitCode = 1;",
    "});",
    "",
  ].join("\n");

  return {
    ok: true,
    code,
    warnings: dedupeWarnings(ctx.warnings),
    stats: {
      nodes: nodes.length,
      edges: usableEdges.length,
      generators: order.filter((node) => node.type === "generator").length,
    },
  };
}

/** Repeated model warnings for several nodes collapse into one row. */
function dedupeWarnings(
  warnings: WorkflowCodeWarning[]
): WorkflowCodeWarning[] {
  const seen = new Set<string>();
  return warnings.filter((warning) => {
    const key = JSON.stringify(warning);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
