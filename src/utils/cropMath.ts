export type CropRect = { x: number; y: number; w: number; h: number };

export type CropHandle =
  | "move"
  | "n"
  | "s"
  | "e"
  | "w"
  | "ne"
  | "nw"
  | "se"
  | "sw";

export type CropRatioId = "free" | "1:1" | "16:9" | "9:16" | "4:3" | "3:4" | "3:2" | "2:3";

export const CROP_RATIO_OPTIONS: { id: CropRatioId; label: string; ratio: number | null }[] = [
  { id: "free", label: "crop.free", ratio: null },
  { id: "1:1", label: "crop.square1x1", ratio: 1 },
  { id: "16:9", label: "crop.landscape16x9", ratio: 16 / 9 },
  { id: "9:16", label: "crop.portrait9x16", ratio: 9 / 16 },
  { id: "4:3", label: "crop.standard4x3", ratio: 4 / 3 },
  { id: "3:4", label: "crop.portrait3x4", ratio: 3 / 4 },
  { id: "3:2", label: "crop.dslr3x2", ratio: 3 / 2 },
  { id: "2:3", label: "crop.film2x3", ratio: 2 / 3 },
];

export const FULL_CROP: CropRect = { x: 0, y: 0, w: 1, h: 1 };
const MIN_CROP_FRACTION = 0.05;

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function clampCrop(crop: CropRect): CropRect {
  let { x, y, w, h } = crop;
  w = clamp(w, MIN_CROP_FRACTION, 1);
  h = clamp(h, MIN_CROP_FRACTION, 1);
  x = clamp(x, 0, 1 - w);
  y = clamp(y, 0, 1 - h);
  return { x, y, w, h };
}

export function getCropRatioValue(id: CropRatioId): number | null {
  return CROP_RATIO_OPTIONS.find((item) => item.id === id)?.ratio ?? null;
}

export function fitCropToAspect(
  crop: CropRect,
  ratio: number,
  frameAspect: number
): CropRect {
  const target = ratio / frameAspect;
  const cx = crop.x + crop.w / 2;
  const cy = crop.y + crop.h / 2;
  let w = crop.w;
  let h = crop.h;

  if (w / h > target) {
    w = h * target;
  } else {
    h = w / target;
  }

  if (w > 1) {
    w = 1;
    h = w / target;
  }
  if (h > 1) {
    h = 1;
    w = h * target;
  }

  w = Math.max(MIN_CROP_FRACTION * Math.min(1, target), w);
  h = Math.max(MIN_CROP_FRACTION, h);

  return clampCrop({ x: cx - w / 2, y: cy - h / 2, w, h });
}

export function applyCropDrag(
  start: CropRect,
  handle: CropHandle,
  dx: number,
  dy: number,
  aspect: number | null,
  frameAspect: number
): CropRect {
  const { x, y, w, h } = start;

  if (handle === "move") {
    return clampCrop({ x: start.x + dx, y: start.y + dy, w, h });
  }

  let left = x;
  let top = y;
  let right = x + w;
  let bottom = y + h;

  if (handle.includes("w")) left = start.x + dx;
  if (handle.includes("e")) right = start.x + start.w + dx;
  if (handle.includes("n")) top = start.y + dy;
  if (handle.includes("s")) bottom = start.y + start.h + dy;

  if (right < left) [left, right] = [right, left];
  if (bottom < top) [top, bottom] = [bottom, top];

  left = clamp(left, 0, 1);
  right = clamp(right, 0, 1);
  top = clamp(top, 0, 1);
  bottom = clamp(bottom, 0, 1);

  let newW = Math.max(MIN_CROP_FRACTION, right - left);
  let newH = Math.max(MIN_CROP_FRACTION, bottom - top);
  let newX = left;
  let newY = top;

  if (newX + newW > 1) newX = 1 - newW;
  if (newY + newH > 1) newY = 1 - newH;

  let next = clampCrop({ x: newX, y: newY, w: newW, h: newH });
  if (aspect !== null) {
    const target = aspect / frameAspect;
    if (handle === "e" || handle === "w") {
      newH = newW / target;
    } else if (handle === "n" || handle === "s") {
      newW = newH * target;
    } else {
      newH = newW / target;
    }

    // Fit the locked pair inside the frame before positioning. `clampCrop`
    // clamps w and h independently, so a 9:16 selection on a 16:9 image used to
    // end up with the wrong aspect while the UI still showed 9:16.
    if (newW > 1) {
      newW = 1;
      newH = 1 / target;
    }
    if (newH > 1) {
      newH = 1;
      newW = target;
    }
    if (newW > 1) newW = 1;
    if (newH > 1) newH = 1;

    if (handle === "e" || handle === "w") {
      newY = start.y + start.h / 2 - newH / 2;
    } else if (handle === "n" || handle === "s") {
      newX = start.x + start.w / 2 - newW / 2;
    } else {
      newY = handle.includes("n") ? start.y + start.h - newH : start.y;
    }

    // Move only the origin; never let clampCrop resize a locked ratio.
    newX = clamp(newX, 0, 1 - newW);
    newY = clamp(newY, 0, 1 - newH);
    next = { x: newX, y: newY, w: newW, h: newH };
  }

  return next;
}
