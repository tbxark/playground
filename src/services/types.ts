import type { CorsProxyMode } from "../utils/proxy";
import type { ImageOptions } from "../../shared/imageModels";

export type ProviderId = "apimart" | "openrouter" | "openai" | string;

/**
 * How requests with input images reach the gateway. `auto` sends the JSON form
 * first and switches to multipart `/images/edits` once a gateway refuses base64
 * (official OpenAI always uses edits). `generations` never switches; `edits`
 * always sends input images as multipart. Text-only requests always use
 * `/images/generations`.
 */
export type InputEndpointMode = "auto" | "generations" | "edits";

export type ProviderCapabilities = {
  supportsText2Image: boolean;
  supportsImage2Image: boolean;
  supportsInpainting: boolean;
  supportsOutpainting: boolean;
  supportsNegativePrompt: boolean;
  supportsCustomSize: boolean;
  supportsSeed: boolean;
};

export type ProviderModelDefinition = {
  id: string;
  name: string;
  capabilities?: Partial<ProviderCapabilities>;
};

export type ProviderConfig = {
  id: string;
  label: string;
  apiBaseUrl: string;
  apiKey: string;
  models: ProviderModelDefinition[];
  isCustom?: boolean;
  capabilities: ProviderCapabilities;
  inputEndpointMode?: InputEndpointMode;
};

export type GenerateParams = {
  providerId: string;
  model: string;
  prompt: string;
  negativePrompt?: string;
  imageUrls?: string[]; // reference images or base image
  maskUrl?: string; // inpaint mask data url
  size: string; // e.g. "1:1", "16:9", "1024x1024"
  resolution: string; // e.g. "1k", "2k", "4k"
  seed?: number;
  cfgScale?: number;
  steps?: number;
  /**
   * gpt-image-2.5 / 2.6 tunables (quality, output format, GIF frames, ...).
   * Ignored for other models; see shared/imageModels.ts.
   */
  options?: ImageOptions;
  corsProxy?: string;
  corsProxyMode?: CorsProxyMode;
  signal?: AbortSignal;
  onProgress?: (update: { status: string; progress?: number }) => void;
};

export type GenerationResult = {
  url: string;
  blob?: Blob;
  nanoid: string;
  prompt: string;
  negativePrompt?: string;
  provider: string;
  model: string;
  size: string;
  resolution: string;
  seed?: number;
  cfgScale?: number;
  steps?: number;
  generationTimeMs: number;
  createdAt: number;
  referenceImages?: string[]; // DataURLs or urls
  gallerySaveStatus?: "saving" | "saved" | "failed" | "unavailable";
  gallerySaveError?: string;
};

export type TaskStatus =
  | "pending"
  | "submitting"
  | "processing"
  | "done"
  | "failed"
  | "cancelled";

export type TaskItem = {
  id: string;
  title: string;
  subtitle: string;
  status: TaskStatus;
  progress: number;
  statusText: string;
  error?: string;
  input: GenerateParams;
  result?: GenerationResult | null;
  startedAt: number;
};

export type HistoryRecord = {
  id: number;
  nanoid: string;
  imageBlob: Blob;
  thumbnailBlob?: Blob;
  createdAt: number;
  starred: boolean;
  prompt: string;
  negativePrompt?: string;
  provider: string;
  model: string;
  size: string;
  resolution: string;
  seed?: number;
  cfgScale?: number;
  steps?: number;
  generationTimeMs: number;
  referenceBlobs?: Blob[];
};
