import { i18n } from "@/i18n";
import { CorsProxyOptions, corsAwareFetch } from "./proxy";

export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error || new Error(i18n.t("err.fileReadFailed")));
    reader.readAsDataURL(file);
  });
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error || new Error(i18n.t("err.blobReadFailed")));
    reader.readAsDataURL(blob);
  });
}

/**
 * Decode a data URL into a Blob.
 *
 * Gateways are inconsistent: some return a bare base64 payload, some wrap it in
 * a full `data:` URI, and some line-wrap the base64 at 76 characters. All three
 * reach this function, so normalise before decoding instead of assuming the
 * happy shape (a thrown `atob` used to surface as "gallery save failed").
 */
export function dataUrlToBlob(dataUrl: string): Blob {
  const comma = dataUrl.indexOf(",");
  if (comma < 0) {
    throw new Error(i18n.t("err.invalidDataUrl"));
  }
  const meta = dataUrl.slice(0, comma);
  const payload = dataUrl.slice(comma + 1);
  const mime = meta.match(/:(.*?);/)?.[1] || "image/png";

  if (!/;base64/i.test(meta)) {
    return new Blob([decodeURIComponent(payload)], { type: mime });
  }

  const binary = atob(payload.replace(/\s+/g, ""));
  const array = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    array[i] = binary.charCodeAt(i);
  }
  return new Blob([array], { type: mime });
}

const FETCH_BLOB_TIMEOUT_MS = 60_000;

/**
 * Fetch an image as a Blob with a hard timeout.
 *
 * Without a deadline a CDN or proxy that accepts the connection but never
 * responds holds the caller forever. In the queue that means a permanently
 * occupied concurrency slot; in the canvas it freezes the Generate button.
 */
export async function fetchAsBlob(
  url: string,
  options?: CorsProxyOptions,
  signal?: AbortSignal,
): Promise<Blob> {
  if (signal?.aborted) {
    throw signal.reason instanceof Error
      ? signal.reason
      : new DOMException("Aborted", "AbortError");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort(new DOMException("Timed out", "TimeoutError"));
  }, FETCH_BLOB_TIMEOUT_MS);
  const forwardAbort = () => controller.abort(signal?.reason);
  signal?.addEventListener("abort", forwardAbort, { once: true });

  try {
    const response = await corsAwareFetch(url, { signal: controller.signal }, options);
    if (!response.ok) {
      throw new Error(i18n.t("err.imageFetchFailed", { status: response.status }));
    }
    return await response.blob();
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", forwardAbort);
  }
}

/**
 * Trigger a browser download.
 *
 * A cross-origin `<a download>` is ignored by browsers, which navigate the
 * current tab to the URL instead — losing unsaved canvas/queue state. Callers
 * that only hold a remote URL must resolve a Blob first; this returns false so
 * they can surface an explicit error instead of navigating away.
 */
export function downloadFile(urlOrBlob: string | Blob, filename: string): boolean {
  const isBlob = typeof urlOrBlob !== "string";

  if (!isBlob) {
    try {
      const parsed = new URL(urlOrBlob, window.location.href);
      // data:/blob: are local by definition; only a cross-origin http(s) URL
      // silently navigates instead of downloading.
      const localScheme =
        parsed.protocol === "data:" || parsed.protocol === "blob:";
      if (!localScheme && parsed.origin !== window.location.origin) return false;
    } catch {
      return false;
    }
  }

  const href = isBlob ? URL.createObjectURL(urlOrBlob) : urlOrBlob;

  const a = document.createElement("a");
  a.href = href;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);

  if (isBlob) {
    setTimeout(() => URL.revokeObjectURL(href), 1000);
  }
  return true;
}

export function formatBytes(bytes: number, decimals = 1): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

export function formatDate(timestamp: number): string {
  const locale = i18n.language?.startsWith("zh") ? "zh-CN" : "en-US";
  return new Intl.DateTimeFormat(locale, {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(timestamp));
}
