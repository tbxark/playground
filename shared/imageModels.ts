/**
 * APIMart gpt-image-2.5 / gpt-image-2.6 parameter model, shared by the browser
 * client (src/) and the Hono server (functions/). Dependency-free on purpose.
 * The Go server (server/image_options.go) mirrors the capability table and the
 * option -> payload mapping; change both together.
 *
 * References:
 *  - https://docs.apimart.ai/en/api-reference/images/gpt-image-2.5/generation
 *  - https://docs.apimart.ai/en/api-reference/images/gpt-image-2.5-ext/generation
 *  - https://docs.apimart.ai/en/api-reference/images/gpt-image-2.6/generation
 *  - https://docs.apimart.ai/en/api-reference/images/gpt-image-2.6-ext/generation
 */

export const IMAGE_OUTPUT_FORMATS = ["png", "jpeg", "webp", "gif", "svg"] as const;
export type ImageOutputFormat = (typeof IMAGE_OUTPUT_FORMATS)[number];

export const IMAGE_QUALITIES = ["low", "medium", "high", "xhigh", "max"] as const;
export type ImageQuality = (typeof IMAGE_QUALITIES)[number];

export const IMAGE_BACKGROUNDS = ["auto", "opaque", "transparent"] as const;
export type ImageBackground = (typeof IMAGE_BACKGROUNDS)[number];

export const IMAGE_MODERATIONS = ["auto", "low"] as const;
export type ImageModeration = (typeof IMAGE_MODERATIONS)[number];

export const IMAGE_COMPLEXITIES = ["low", "medium", "high"] as const;
export type ImageComplexity = (typeof IMAGE_COMPLEXITIES)[number];

export const IMAGE_VERSIONS = ["flare", "sunburst"] as const;
export type ImageVersion = (typeof IMAGE_VERSIONS)[number];

export const SVG_REASONING_EFFORTS = [
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;
export type SvgReasoningEffort = (typeof SVG_REASONING_EFFORTS)[number];

export const GIF_FRAME_COUNT_MIN = 2;
export const GIF_FRAME_COUNT_MAX = 16;
export const GIF_FRAME_COUNT_DEFAULT = 9;
export const GIF_FRAME_DURATION_MIN_MS = 20;
export const GIF_FRAME_DURATION_DEFAULT_MS = 200;
export const DEFAULT_SVG_MODEL = "gpt-5.4-mini";
export const SAFETY_IDENTIFIER_MAX_LENGTH = 128;

/**
 * Per-model tunables. Every field is optional; `undefined` means "omit it and
 * let the provider decide" (for `outputFormat` that is PNG).
 */
export type ImageOptions = {
  outputFormat?: ImageOutputFormat;
  quality?: ImageQuality;
  /** 0-100, jpeg/webp only. */
  outputCompression?: number;
  background?: ImageBackground;
  moderation?: ImageModeration;
  /** gpt-image-2.6 scene planning level; no separate fee. */
  complexity?: ImageComplexity;
  /** `-ext` models only. */
  version?: ImageVersion;
  /** GIF on non-ext 2.6 only. */
  frameCount?: number;
  frameDurationMs?: number;
  /** SVG: text model that writes the SVG. Managed servers fix this. */
  svgModel?: string;
  svgReasoningEffort?: SvgReasoningEffort;
  safetyIdentifier?: string;
};

export type ImageModelFamily = "2.5" | "2.6";

export type ImageModelCaps = {
  family: ImageModelFamily;
  /** `-ext`: fixed per-image pricing, `version` selector, reduced parameters. */
  ext: boolean;
  formats: ImageOutputFormat[];
  quality: boolean;
  compression: boolean;
  background: boolean;
  moderation: boolean;
  complexity: boolean;
  version: boolean;
  /** Non-ext 2.6 GIF: `frame_count` / `frame_duration_ms` + per-frame size. */
  gifFrames: boolean;
  svg: boolean;
  safetyIdentifier: boolean;
  /** `mask_url` inpainting (non-ext only). */
  mask: boolean;
  resolutions: string[];
  /** Spell resolution upper-case (`1K`) as gpt-image-2.5-ext documents. */
  upperResolution: boolean;
  ratios: string[];
  /** Exact `WIDTHxHEIGHT` pixel sizes are accepted. */
  customSize: boolean;
};

const RATIOS_15 = [
  "auto",
  "1:1",
  "3:2",
  "2:3",
  "4:3",
  "3:4",
  "5:4",
  "4:5",
  "16:9",
  "9:16",
  "2:1",
  "1:2",
  "21:9",
  "9:21",
  "3:1",
  "1:3",
];

const RATIOS_10 = [
  "auto",
  "1:1",
  "16:9",
  "9:16",
  "4:3",
  "3:4",
  "3:2",
  "2:3",
  "5:4",
  "4:5",
  "21:9",
];

/**
 * Resolves a model id to its capability set, or null for every other model
 * (which keeps the generic OpenAI-compatible payload). Matched by containment
 * so gateway prefixes/suffixes still resolve.
 */
export function getImageModelCaps(model: string): ImageModelCaps | null {
  const id = model.toLowerCase();
  const family: ImageModelFamily | null = id.includes("gpt-image-2.6")
    ? "2.6"
    : id.includes("gpt-image-2.5")
      ? "2.5"
      : null;
  if (!family) return null;
  const ext = /(^|[-_.])ext($|[-_.])/.test(id);
  const v26 = family === "2.6";

  return {
    family,
    ext,
    formats: ext
      ? v26
        ? ["png", "jpeg", "webp", "gif", "svg"]
        : []
      : v26
        ? ["png", "jpeg", "webp", "gif", "svg"]
        : ["png", "jpeg", "webp"],
    quality: !(ext && !v26),
    compression: !ext,
    background: !ext,
    moderation: !ext,
    complexity: v26,
    version: ext,
    gifFrames: v26 && !ext,
    svg: v26,
    safetyIdentifier: v26 && !ext,
    mask: !ext,
    // 2.6-ext is limited to 1k for now; others offer all tiers.
    resolutions: ext && v26 ? ["1k"] : ["1k", "2k", "4k"],
    upperResolution: ext && !v26,
    ratios: ext ? RATIOS_10 : RATIOS_15,
    customSize: !ext,
  };
}

/** Resolution actually sent: the chosen tier when the model offers it, else its first tier. */
export function effectiveResolution(model: string, resolution: string): string {
  const caps = getImageModelCaps(model);
  if (!caps) return resolution;
  const wanted = (resolution || "1k").toLowerCase();
  const tier = caps.resolutions.includes(wanted) ? wanted : caps.resolutions[0];
  return caps.upperResolution ? tier.toUpperCase() : tier;
}

/** Resolution tiers to offer for a model (falls back to the caller's list). */
export function availableResolutions(model: string, fallback: string[]): string[] {
  return getImageModelCaps(model)?.resolutions ?? fallback;
}

/** Lower-case tier that will be sent, for highlighting the active pill. */
export function selectedResolution(model: string, resolution: string): string {
  return effectiveResolution(model, resolution).toLowerCase();
}

export type ExactSizeError = "format" | "align" | "edge" | "ratio" | "pixels";

export function parseExactSize(size: string): { width: number; height: number } | null {
  const match = size.trim().match(/^(\d+)\s*[x×]\s*(\d+)$/i);
  if (!match) return null;
  return { width: Number(match[1]), height: Number(match[2]) };
}

/** Exact-size rules shared by gpt-image-2.5 / 2.6 (non-ext). */
export function validateExactSize(size: string): ExactSizeError | null {
  const parsed = parseExactSize(size);
  if (!parsed || !parsed.width || !parsed.height) return "format";
  const { width, height } = parsed;
  if (width % 16 !== 0 || height % 16 !== 0) return "align";
  if (width > 3840 || height > 3840) return "edge";
  if (Math.max(width, height) / Math.min(width, height) > 3) return "ratio";
  const pixels = width * height;
  if (pixels < 655_360 || pixels > 8_294_400) return "pixels";
  return null;
}

const GIF_FRAME_LONG_EDGE = 512;
const GIF_FRAME_ALIGN = 16;

/**
 * Non-ext 2.6 GIF `size` is the per-frame pixel size (multiples of 16); ratio
 * names are rejected. The sheet of all frames must stay within 3840px per
 * edge, so the long edge is pinned to 512 (fits 16 frames in a 4x4 sheet).
 */
export function gifFrameSize(size: string): string {
  const fallback = `${GIF_FRAME_LONG_EDGE}x${GIF_FRAME_LONG_EDGE}`;
  const match = size.trim().match(/^(\d+)\s*([:x×])\s*(\d+)$/i);
  if (!match) return fallback;
  const w = Number(match[1]);
  const h = Number(match[3]);
  if (!w || !h) return fallback;
  if (match[2] !== ":" && w % GIF_FRAME_ALIGN === 0 && h % GIF_FRAME_ALIGN === 0) {
    return `${w}x${h}`;
  }
  const scale = GIF_FRAME_LONG_EDGE / Math.max(w, h);
  const align = (value: number) =>
    Math.max(
      GIF_FRAME_ALIGN,
      Math.round((value * scale) / GIF_FRAME_ALIGN) * GIF_FRAME_ALIGN
    );
  return `${align(w)}x${align(h)}`;
}

function oneOf<T extends string>(list: readonly T[], value: unknown): T | undefined {
  return typeof value === "string" && (list as readonly string[]).includes(value)
    ? (value as T)
    : undefined;
}

function clampInt(value: unknown, min: number, max: number): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return Math.min(max, Math.max(min, Math.round(value)));
}

/**
 * Collapses stored options to what `model` can actually take: unsupported
 * fields are dropped, numbers clamped, and invalid combinations (transparent
 * JPEG, compression on PNG, frame fields on non-GIF) removed. A stale choice
 * from a previously selected model therefore never reaches the request.
 */
export function sanitizeImageOptions(
  model: string,
  options: ImageOptions | undefined
): ImageOptions {
  const caps = getImageModelCaps(model);
  if (!caps || !options) return {};
  const out: ImageOptions = {};

  const format = oneOf(caps.formats, options.outputFormat);
  // PNG is the provider default; keep it implicit.
  if (format && format !== "png") out.outputFormat = format;
  const effectiveFormat = out.outputFormat ?? "png";

  if (caps.quality) out.quality = oneOf(IMAGE_QUALITIES, options.quality);

  if (caps.compression && (effectiveFormat === "jpeg" || effectiveFormat === "webp")) {
    out.outputCompression = clampInt(options.outputCompression, 0, 100);
  }

  if (caps.background && (effectiveFormat === "png" || effectiveFormat === "webp")) {
    out.background = oneOf(IMAGE_BACKGROUNDS, options.background);
  }

  if (caps.moderation) out.moderation = oneOf(IMAGE_MODERATIONS, options.moderation);
  if (caps.complexity) out.complexity = oneOf(IMAGE_COMPLEXITIES, options.complexity);
  if (caps.version) out.version = oneOf(IMAGE_VERSIONS, options.version);

  if (caps.gifFrames && effectiveFormat === "gif") {
    out.frameCount = clampInt(
      options.frameCount,
      GIF_FRAME_COUNT_MIN,
      GIF_FRAME_COUNT_MAX
    );
    const duration = clampInt(
      typeof options.frameDurationMs === "number"
        ? Math.round(options.frameDurationMs / 10) * 10
        : undefined,
      GIF_FRAME_DURATION_MIN_MS,
      Number.MAX_SAFE_INTEGER
    );
    out.frameDurationMs = duration;
  }

  if (caps.svg && effectiveFormat === "svg") {
    out.svgModel = options.svgModel?.trim() || DEFAULT_SVG_MODEL;
    out.svgReasoningEffort = oneOf(SVG_REASONING_EFFORTS, options.svgReasoningEffort);
  }

  if (caps.safetyIdentifier) {
    const id = options.safetyIdentifier?.trim().slice(0, SAFETY_IDENTIFIER_MAX_LENGTH);
    if (id) out.safetyIdentifier = id;
  }

  // Drop explicit undefined keys so equality checks and JSON stay tidy.
  (Object.keys(out) as (keyof ImageOptions)[]).forEach((key) => {
    if (out[key] === undefined) delete out[key];
  });
  return out;
}

/**
 * Strict counterpart used by servers: instead of silently dropping, reports
 * the first option the model cannot take. Returns null when the options are
 * acceptable as-is.
 */
export function validateImageOptions(
  model: string,
  options: ImageOptions | undefined
): string | null {
  if (!options) return null;
  const given = (Object.keys(options) as (keyof ImageOptions)[]).filter(
    (key) => options[key] !== undefined
  );
  if (given.length === 0) return null;
  if (!getImageModelCaps(model)) return "options_unsupported";
  const clean = sanitizeImageOptions(model, options);
  for (const key of given) {
    // svgModel is server-owned for managed use; never an error.
    if (key === "svgModel") continue;
    if (key === "outputFormat") {
      // PNG is implicit in sanitized output but still a valid explicit value.
      const caps = getImageModelCaps(model)!;
      if (!oneOf(caps.formats, options.outputFormat)) return "invalid_request";
      continue;
    }
    if (key === "safetyIdentifier") {
      if (typeof options.safetyIdentifier !== "string") return "invalid_request";
      if (options.safetyIdentifier.length > SAFETY_IDENTIFIER_MAX_LENGTH) {
        return "invalid_request";
      }
    }
    if (clean[key] === undefined) return "invalid_request";
    if (key === "frameDurationMs" || key === "frameCount" || key === "outputCompression") {
      if (clean[key] !== options[key]) return "invalid_request";
    }
  }
  return null;
}

/** Snake-case payload fields for already-sanitized options. */
export function imageOptionFields(
  options: ImageOptions,
  svgModel?: string
): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  if (options.outputFormat) fields.output_format = options.outputFormat;
  if (options.quality) fields.quality = options.quality;
  if (options.outputCompression !== undefined) {
    fields.output_compression = options.outputCompression;
  }
  if (options.background) fields.background = options.background;
  if (options.moderation) fields.moderation = options.moderation;
  if (options.complexity) fields.complexity = options.complexity;
  if (options.version) fields.version = options.version;
  if (options.frameCount !== undefined) fields.frame_count = options.frameCount;
  if (options.frameDurationMs !== undefined) {
    fields.frame_duration_ms = options.frameDurationMs;
  }
  if (options.outputFormat === "svg") {
    fields.svg = {
      model: svgModel?.trim() || options.svgModel?.trim() || DEFAULT_SVG_MODEL,
      ...(options.svgReasoningEffort
        ? { reasoning: { effort: options.svgReasoningEffort } }
        : {}),
    };
  }
  if (options.safetyIdentifier) fields.safety_identifier = options.safetyIdentifier;
  return fields;
}

export type ResolvedImageRequest = {
  /** Omitted when the provider must derive the size (ext GIF). */
  size?: string;
  /** Omitted when it would be ignored (exact pixels, non-ext GIF). */
  resolution?: string;
  options: ImageOptions;
  fields: Record<string, unknown>;
};

/**
 * Turns the UI's size / resolution / options into the request values for a
 * known gpt-image model, or null for any other model.
 */
export function resolveImageRequest(
  model: string,
  size: string,
  resolution: string,
  rawOptions: ImageOptions | undefined
): ResolvedImageRequest | null {
  const caps = getImageModelCaps(model);
  if (!caps) return null;
  const options = sanitizeImageOptions(model, rawOptions);
  const tier = effectiveResolution(model, resolution);
  const wanted = (size || "auto").trim();

  let outSize: string | undefined;
  let outResolution: string | undefined = tier;

  if (options.outputFormat === "gif") {
    if (caps.ext) {
      // 2.6-ext: ratios and pixel sizes are rejected for GIF; omit the size.
      outSize = undefined;
    } else {
      outSize = gifFrameSize(wanted);
      outResolution = undefined;
    }
  } else if (parseExactSize(wanted)) {
    if (caps.customSize && validateExactSize(wanted) === null) {
      const parsed = parseExactSize(wanted)!;
      outSize = `${parsed.width}x${parsed.height}`;
      outResolution = undefined;
    } else {
      outSize = "auto";
    }
  } else {
    outSize = caps.ratios.includes(wanted) ? wanted : "auto";
  }

  return {
    size: outSize,
    resolution: outResolution,
    options,
    fields: imageOptionFields(options),
  };
}

/** Field name of the inpaint mask for a model (`mask_url` on documented ones). */
export function maskFieldName(model: string): "mask_url" | "mask" {
  return getImageModelCaps(model)?.mask ? "mask_url" : "mask";
}
