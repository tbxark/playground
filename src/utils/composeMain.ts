import { CropRect, clamp } from "./cropMath";
import { i18n } from "@/i18n";

/**
 * Hard ceiling for an off-screen composite. A 4K image plus the maximum 50%
 * margin is an 8192×8192 canvas (~268 MB), which is above the canvas-area
 * limit on mobile Safari. Refusing with an explicit error beats an allocation
 * failure that silently writes a blank image.
 */
const MAX_COMPOSITE_DIMENSION = 8192;
const MAX_COMPOSITE_AREA = 40_000_000;

export type Point = { x: number; y: number };

export type MaskStroke = {
  points: Point[];
  size: number;
  isEraser: boolean;
};

export type ColorStroke = {
  points: Point[];
  size: number;
  color: string;
};

/** Quarter-turn rotation; free angles were dropped with the card editor. */
export type EditorRotation = 0 | 90 | 180 | 270;

export type EditorGeometry = {
  rotation: EditorRotation;
  flipX: boolean;
  flipY: boolean;
  /** Margin added on every side, as a fraction of the rotated image size. */
  padding: number;
  background: string;
};

export type EditorFrame = {
  natW: number;
  natH: number;
  /** Image size after rotation (90°/270° swap width and height). */
  rotW: number;
  rotH: number;
  padX: number;
  padY: number;
  width: number;
  height: number;
};

/**
 * The geometry every single-image edit shares: rotate/flip first, then add the
 * margin, then crop. Annotations are recorded on the working canvas, so they
 * survive a later crop and scale with the output.
 */
export function getEditorFrame(
  natW: number,
  natH: number,
  geometry: Pick<EditorGeometry, "rotation" | "padding">
): EditorFrame {
  const swap = Math.abs(Math.round(geometry.rotation / 90)) % 2 === 1;
  const rotW = swap ? natH : natW;
  const rotH = swap ? natW : natH;
  const padX = Math.round(rotW * geometry.padding);
  const padY = Math.round(rotH * geometry.padding);
  return {
    natW,
    natH,
    rotW,
    rotH,
    padX,
    padY,
    width: Math.max(1, rotW + padX * 2),
    height: Math.max(1, rotH + padY * 2),
  };
}

function assertCompositeSize(width: number, height: number): void {
  if (
    width > MAX_COMPOSITE_DIMENSION ||
    height > MAX_COMPOSITE_DIMENSION ||
    width * height > MAX_COMPOSITE_AREA
  ) {
    throw new Error(i18n.t("freeCanvas.cards.compositeTooLarge"));
  }
}

/**
 * Draw the working canvas at `scale` output pixels per working pixel. The same
 * routine renders the editor preview (scale < 1) and the final bitmap (scale 1),
 * so what the user sees and what gets committed cannot drift.
 */
export function drawEditorComposite(
  ctx: CanvasRenderingContext2D,
  config: {
    image: CanvasImageSource;
    frame: EditorFrame;
    geometry: EditorGeometry;
    strokes?: ColorStroke[];
    scale: number;
  }
): void {
  const { frame, geometry, scale } = config;
  const outW = Math.max(1, Math.round(frame.width * scale));
  const outH = Math.max(1, Math.round(frame.height * scale));

  ctx.clearRect(0, 0, outW, outH);

  if (geometry.background !== "transparent") {
    ctx.fillStyle = geometry.background;
    ctx.fillRect(0, 0, outW, outH);
  }

  ctx.save();
  ctx.translate(
    (frame.padX + frame.rotW / 2) * scale,
    (frame.padY + frame.rotH / 2) * scale
  );
  ctx.rotate((geometry.rotation * Math.PI) / 180);
  ctx.scale(geometry.flipX ? -1 : 1, geometry.flipY ? -1 : 1);
  ctx.drawImage(
    config.image,
    (-frame.natW / 2) * scale,
    (-frame.natH / 2) * scale,
    frame.natW * scale,
    frame.natH * scale
  );
  ctx.restore();

  const strokes = config.strokes ?? [];
  if (strokes.length === 0) return;

  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  strokes.forEach((stroke) => {
    if (stroke.points.length === 0) return;
    ctx.strokeStyle = stroke.color;
    ctx.lineWidth = Math.max(1, stroke.size * scale);
    ctx.beginPath();
    ctx.moveTo(stroke.points[0].x * scale, stroke.points[0].y * scale);
    for (let i = 1; i < stroke.points.length; i++) {
      ctx.lineTo(stroke.points[i].x * scale, stroke.points[i].y * scale);
    }
    ctx.stroke();
  });
  ctx.restore();
}

export function buildEditorCanvas(
  image: CanvasImageSource,
  frame: EditorFrame,
  geometry: EditorGeometry,
  strokes: ColorStroke[],
  targetWidth: number
): HTMLCanvasElement {
  const scale = targetWidth / frame.width;
  const width = Math.max(1, Math.round(frame.width * scale));
  const height = Math.max(1, Math.round(frame.height * scale));
  assertCompositeSize(width, height);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error(i18n.t("freeCanvas.cards.compositeFailed"));
  drawEditorComposite(ctx, { image, frame, geometry, strokes, scale });
  return canvas;
}

/** Compose the editor's current state at full resolution and crop it. */
export function composeEditorCanvas(
  image: CanvasImageSource,
  natW: number,
  natH: number,
  geometry: EditorGeometry,
  crop: CropRect,
  strokes: ColorStroke[]
): HTMLCanvasElement {
  const frame = getEditorFrame(natW, natH, geometry);
  assertCompositeSize(frame.width, frame.height);
  const canvas = buildEditorCanvas(image, frame, geometry, strokes, frame.width);
  return cropCanvas(canvas, crop);
}

export function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error(i18n.t("freeCanvas.cards.compositeFailed")));
    }, "image/png");
  });
}

export function isFullCrop(crop: CropRect): boolean {
  return (
    Math.abs(crop.x) < 0.001 &&
    Math.abs(crop.y) < 0.001 &&
    Math.abs(crop.w - 1) < 0.001 &&
    Math.abs(crop.h - 1) < 0.001
  );
}

export function cropCanvas(source: HTMLCanvasElement, crop: CropRect): HTMLCanvasElement {
  if (isFullCrop(crop)) return source;
  const x = Math.min(clamp(crop.x, 0, 1), 0.999);
  const y = Math.min(clamp(crop.y, 0, 1), 0.999);
  const w = clamp(crop.w, 0.001, 1 - x);
  const h = clamp(crop.h, 0.001, 1 - y);

  // Derive the size from rounded edges. Rounding x and w independently let the
  // source rect run one pixel past the right/bottom edge, which leaves a
  // transparent seam and breaks x + w = 1 edge-to-edge crops.
  const sx = Math.round(x * source.width);
  const sy = Math.round(y * source.height);
  const sw = Math.max(1, Math.min(Math.round((x + w) * source.width) - sx, source.width - sx));
  const sh = Math.max(1, Math.min(Math.round((y + h) * source.height) - sy, source.height - sy));

  const target = document.createElement("canvas");
  target.width = sw;
  target.height = sh;
  const ctx = target.getContext("2d");
  if (!ctx) {
    // Returning a blank canvas here made the caller overwrite the main image
    // with an empty PNG; fail loudly instead.
    throw new Error(i18n.t("freeCanvas.cards.compositeFailed"));
  }
  ctx.drawImage(source, sx, sy, sw, sh, 0, 0, sw, sh);
  return target;
}

export function loadImageElement(source: Blob | string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = typeof source === "string" ? source : URL.createObjectURL(source);
    const revoke = () => {
      if (typeof source !== "string") URL.revokeObjectURL(url);
    };
    const img = new Image();
    img.onload = () => {
      revoke();
      resolve(img);
    };
    img.onerror = () => {
      revoke();
      reject(new Error("image-decode-failed"));
    };
    img.src = url;
  });
}

/**
 * Builds the black/white inpaint mask for the current main image. Black = keep,
 * white = regenerate. The bitmap is already baked, so stroke coordinates map
 * 1:1 onto the asset (no padding/crop transform anymore).
 */
export async function composeMaskImage(
  source: Blob | string,
  strokes: MaskStroke[],
  isMaskInverted: boolean
): Promise<string | undefined> {
  if (strokes.length === 0) return undefined;

  const img = await loadImageElement(source);
  const width = img.naturalWidth || img.width || 1;
  const height = img.naturalHeight || img.height || 1;

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error(i18n.t("freeCanvas.cards.compositeFailed"));

  ctx.fillStyle = isMaskInverted ? "#ffffff" : "#000000";
  ctx.fillRect(0, 0, width, height);

  const fillStyle = isMaskInverted ? "#000000" : "#ffffff";
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  strokes.forEach((stroke) => {
    if (stroke.points.length === 0) return;
    ctx.lineWidth = stroke.size;
    ctx.strokeStyle = stroke.isEraser
      ? isMaskInverted
        ? "#ffffff"
        : "#000000"
      : fillStyle;
    ctx.beginPath();
    ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
    for (let i = 1; i < stroke.points.length; i++) {
      ctx.lineTo(stroke.points[i].x, stroke.points[i].y);
    }
    ctx.stroke();
  });

  const dataUrl = canvas.toDataURL("image/png");
  // A failed canvas encodes as "data:," which decodes to a 0-byte PNG.
  if (!/^data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=]{32,}/i.test(dataUrl)) {
    throw new Error(i18n.t("freeCanvas.cards.compositeFailed"));
  }
  return dataUrl;
}

function strokePath(ctx: CanvasRenderingContext2D, stroke: MaskStroke): void {
  ctx.beginPath();
  ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
  for (let i = 1; i < stroke.points.length; i++) {
    ctx.lineTo(stroke.points[i].x, stroke.points[i].y);
  }
  ctx.stroke();
}

export type MaskOverlayState = {
  maskStrokes: MaskStroke[];
  isMaskEraser?: boolean;
  isMaskInverted?: boolean;
  maskBrushSize?: number;
};

/**
 * Render the screen mask overlay. Kept next to the export mask so the stroke
 * coordinates stay in sync with the submitted bitmap.
 */
export function drawMaskOverlay(
  ctx: CanvasRenderingContext2D,
  state: MaskOverlayState,
  width: number,
  height: number
): void {
  ctx.clearRect(0, 0, width, height);

  /**
   * Inverted mode mirrors `composeMaskImage`: the whole image is regenerated
   * except the non-eraser strokes. Ignoring the toggle here would make the
   * overlay show the exact opposite of what gets submitted.
   */
  if (state.isMaskInverted) {
    ctx.save();
    ctx.fillStyle = "rgba(245, 158, 11, 0.3)";
    ctx.fillRect(0, 0, width, height);
    ctx.globalCompositeOperation = "destination-out";
    ctx.fillStyle = "rgba(0,0,0,1)";
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    state.maskStrokes.forEach((stroke) => {
      if (stroke.isEraser || stroke.points.length === 0) return;
      ctx.lineWidth = stroke.size;
      strokePath(ctx, stroke);
    });
    ctx.restore();
    return;
  }

  if (state.maskStrokes.length === 0) return;
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  state.maskStrokes.forEach((stroke) => {
    if (stroke.points.length === 0) return;
    ctx.lineWidth = stroke.size;
    if (stroke.isEraser) {
      ctx.globalCompositeOperation = "destination-out";
      ctx.strokeStyle = "rgba(0,0,0,1)";
    } else {
      ctx.globalCompositeOperation = "source-over";
      ctx.strokeStyle = "rgba(245, 158, 11, 0.65)";
    }
    strokePath(ctx, stroke);
  });
  ctx.restore();
}
