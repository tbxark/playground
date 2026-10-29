import type { CorsProxyMode } from "../utils/proxy";

export type ProviderId = "apimart" | "openrouter" | "openai" | string;

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
  background?: "auto" | "opaque" | "transparent";
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
