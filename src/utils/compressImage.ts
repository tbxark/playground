import { useConfigStore } from "@/stores/useConfigStore";
import { blobToDataUrlSafe } from "./cardSource";
import { dataUrlToBlob, fetchAsBlob } from "./file";

export const REVIEW_IMAGE_MAX_EDGE = 1024;
const JPEG_QUALITY = 0.9;

function loadImage(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("image-decode-failed"));
    };
    img.src = url;
  });
}

async function sourceToBlob(src: string, signal?: AbortSignal): Promise<Blob> {
  if (src.startsWith("data:")) return dataUrlToBlob(src);
  const { corsProxy, corsProxyMode } = useConfigStore.getState();
  return fetchAsBlob(src, { corsProxy, corsProxyMode }, signal);
}

/**
 * Shrink an image (data/blob/http URL) so its longest edge is at most `maxEdge`
 * px and return it as a base64 data URL. PNG stays PNG and JPEG stays JPEG
 * (anything else is rasterized to PNG). Images already within the limit are
 * returned byte-for-byte, never re-encoded or upscaled. If the browser cannot
 * decode the image, the original bytes are sent as-is.
 */
export async function compressImageToDataUrl(
  src: string,
  maxEdge = REVIEW_IMAGE_MAX_EDGE,
  signal?: AbortSignal
): Promise<string> {
  const blob = await sourceToBlob(src, signal);
  try {
    const img = await loadImage(blob);
    const width = img.naturalWidth || img.width;
    const height = img.naturalHeight || img.height;
    if (!width || !height) throw new Error("image-empty");
    if (Math.max(width, height) <= maxEdge) return await blobToDataUrlSafe(blob);

    const scale = maxEdge / Math.max(width, height);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));

    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas-unavailable");
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    const isJpeg = /^image\/jpe?g$/i.test(blob.type);
    const out = await new Promise<Blob | null>((resolve) =>
      isJpeg
        ? canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY)
        : canvas.toBlob(resolve, "image/png")
    );
    if (!out) throw new Error("image-encode-failed");
    return await blobToDataUrlSafe(out);
  } catch {
    return blobToDataUrlSafe(blob);
  }
}
