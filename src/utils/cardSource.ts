import { dataUrlToBlob, fetchAsBlob } from "./file";
import { CorsProxyMode } from "./proxy";
import { getCanvasAsset } from "../services/canvasAssetDb";
import { getHistoryRecordByNanoid } from "../services/historyDb";

export function isHttpUrl(url?: string): boolean {
  return Boolean(url && /^https?:\/\//i.test(url));
}

export function isDataUrl(url?: string): boolean {
  return Boolean(url && url.startsWith("data:"));
}

export function isBlobUrl(url?: string): boolean {
  return Boolean(url && url.startsWith("blob:"));
}

export function revokeObjectUrl(url?: string): void {
  if (url && isBlobUrl(url)) {
    URL.revokeObjectURL(url);
  }
}

type CardSource = {
  url: string;
  assetKey?: string;
  galleryNanoid?: string;
  isEdited?: boolean;
};

/**
 * Resolve the actual bytes behind a canvas card. Persisted cards only carry
 * asset keys / gallery ids, so every export path must go through here.
 */
export async function resolveCardBlob(
  card: CardSource,
  corsProxy?: string,
  corsProxyMode?: CorsProxyMode
): Promise<Blob | null> {
  if (card.assetKey) {
    try {
      const blob = await getCanvasAsset(card.assetKey);
      if (blob) return blob;
    } catch {
      // fall through to the other sources
    }
  }

  if (card.galleryNanoid && !card.isEdited) {
    try {
      const record = await getHistoryRecordByNanoid(card.galleryNanoid);
      if (record?.imageBlob) return record.imageBlob;
    } catch {
      // fall through
    }
  }

  const url = card.url;
  if (!url) return null;

  if (isDataUrl(url)) {
    try {
      return dataUrlToBlob(url);
    } catch {
      return null;
    }
  }

  if (isBlobUrl(url)) {
    try {
      const response = await fetch(url);
      return await response.blob();
    } catch {
      return null;
    }
  }

  if (isHttpUrl(url)) {
    try {
      return await fetchAsBlob(url, {
        corsProxy: corsProxy || undefined,
        corsProxyMode,
      });
    } catch {
      return null;
    }
  }

  return null;
}

async function toPngBlob(blob: Blob): Promise<Blob> {
  if (blob.type === "image/png") return blob;
  if (typeof createImageBitmap !== "function") return blob;
  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d");
    if (!context) return blob;
    context.drawImage(bitmap, 0, 0);
    const png = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/png")
    );
    return png ?? blob;
  } finally {
    bitmap.close();
  }
}

/**
 * Copy a card's pixels to the clipboard. Browsers only accept PNG reliably,
 * so JPEG/WebP sources are re-encoded first.
 */
export async function copyCardImageToClipboard(
  card: CardSource,
  corsProxy?: string,
  corsProxyMode?: CorsProxyMode
): Promise<boolean> {
  if (
    typeof navigator === "undefined" ||
    typeof ClipboardItem === "undefined" ||
    !navigator.clipboard?.write
  ) {
    return false;
  }
  const blob = await resolveCardBlob(card, corsProxy, corsProxyMode);
  if (!blob) return false;
  try {
    const png = await toPngBlob(blob);
    await navigator.clipboard.write([
      new ClipboardItem({ "image/png": png }),
    ]);
    return true;
  } catch {
    return false;
  }
}

/**
 * A value that can be sent to a generation provider. Local blobs become data
 * URLs; remote http(s) URLs are passed through untouched.
 */export async function resolveCardDataUrl(
  card: CardSource,
  corsProxy?: string,
  corsProxyMode?: CorsProxyMode
): Promise<string | null> {
  if (isHttpUrl(card.url)) return card.url;

  const blob = await resolveCardBlob(card, corsProxy, corsProxyMode);
  if (!blob) return null;
  return blobToDataUrlSafe(blob);
}

export function blobToDataUrlSafe(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error || new Error("blob-read-failed"));
    reader.readAsDataURL(blob);
  });
}

export function getImageDimensions(
  source: Blob | string
): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const url = typeof source === "string" ? source : URL.createObjectURL(source);
    const revoke = () => {
      if (typeof source !== "string") URL.revokeObjectURL(url);
    };
    const img = new Image();
    img.onload = () => {
      const width = img.naturalWidth || img.width || 1;
      const height = img.naturalHeight || img.height || 1;
      revoke();
      resolve({ width, height });
    };
    img.onerror = () => {
      revoke();
      reject(new Error("image-decode-failed"));
    };
    img.src = url;
  });
}

export { dataUrlToBlob };
