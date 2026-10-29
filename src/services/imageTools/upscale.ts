import {
  ImageToolOutput,
  ImageToolProgress,
  UpscaleFactor,
} from "./types";

/**
 * Guard rails for a single output bitmap. Chrome can handle more, but mobile
 * Safari starts failing around 16.7 MP and the tab becomes unresponsive long
 * before the canvas API throws. 40 MP leaves room for 4× of 2K images while
 * keeping a 4× 4K request out of the picker.
 */
export const MAX_UPSCALE_DIMENSION = 8192;
export const MAX_UPSCALE_AREA = 40_000_000;

export type UpscaleLimit = "dimension" | "area" | null;

export function getUpscaleTarget(
  width: number,
  height: number,
  factor: UpscaleFactor
): { width: number; height: number } {
  return {
    width: Math.round(width * factor),
    height: Math.round(height * factor),
  };
}

export function getUpscaleLimit(
  width: number,
  height: number,
  factor: UpscaleFactor
): UpscaleLimit {
  const target = getUpscaleTarget(width, height, factor);
  if (
    target.width > MAX_UPSCALE_DIMENSION ||
    target.height > MAX_UPSCALE_DIMENSION
  ) {
    return "dimension";
  }
  if (target.width * target.height > MAX_UPSCALE_AREA) return "area";
  return null;
}

function loadImageElement(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("image-decode-failed"));
    };
    image.src = url;
  });
}

type DecodedSource = {
  image: HTMLImageElement | ImageBitmap;
  width: number;
  height: number;
  close: () => void;
};

async function decodeSource(blob: Blob): Promise<DecodedSource> {
  try {
    const bitmap = await createImageBitmap(blob, {
      imageOrientation: "from-image",
    });
    return {
      image: bitmap,
      width: bitmap.width,
      height: bitmap.height,
      close: () => bitmap.close(),
    };
  } catch {
    // Older Safari builds lack createImageBitmap(Blob); an <img> works with
    // pica just as well and also applies EXIF orientation.
    const image = await loadImageElement(blob);
    return {
      image,
      width: image.naturalWidth || image.width,
      height: image.naturalHeight || image.height,
      close: () => undefined,
    };
  }
}

/**
 * One Pica instance per page. Constructing one per run allocated a fresh
 * worker each time; pica only reaps idle workers on its own GC interval, so
 * repeated upscales accumulated them.
 */
type PicaInstance = InstanceType<(typeof import("pica"))["Pica"]>;
let picaInstance: PicaInstance | null = null;

async function getPica(): Promise<PicaInstance> {
  if (!picaInstance) {
    const { Pica } = await import("pica");
    picaInstance = new Pica();
  }
  return picaInstance;
}

/**
 * Reject as soon as the caller cancels instead of waiting for the full Lanczos
 * pass. The underlying resample cannot be interrupted in place, so its late
 * settlement is observed separately to keep the rejection handled.
 */
function raceWithAbort<T>(work: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return work;
  if (signal.aborted) {
    return Promise.reject(new DOMException("Aborted", "AbortError"));
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new DOMException("Aborted", "AbortError"));
    signal.addEventListener("abort", onAbort, { once: true });
    work.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      }
    );
  });
}

/**
 * High-quality Lanczos resampling with no invented detail. This is the
 * "enlarge without the blur of drawImage" path: instant and fully offline.
 * AI super-resolution is deliberately not wired here.
 */
export async function upscaleImage(
  source: Blob,
  factor: UpscaleFactor,
  options?: {
    onProgress?: (progress: ImageToolProgress) => void;
    signal?: AbortSignal;
  }
): Promise<ImageToolOutput> {
  const report = (progress: number, stage: ImageToolProgress["stage"]) =>
    options?.onProgress?.({ progress, stage });

  if (options?.signal?.aborted) {
    throw new DOMException("Aborted", "AbortError");
  }

  report(6, "prepare");
  const decoded = await decodeSource(source);
  // Set once a resample is in flight: the source bitmap must not be closed
  // while pica's worker may still be reading it after an early abort.
  let resample: Promise<unknown> | null = null;
  try {
    if (options?.signal?.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }

    const target = getUpscaleTarget(decoded.width, decoded.height, factor);
    const limit = getUpscaleLimit(decoded.width, decoded.height, factor);
    if (limit) {
      throw new Error(`upscale-limit-${limit}`);
    }

    const canvas = document.createElement("canvas");
    canvas.width = target.width;
    canvas.height = target.height;

    // Loaded on demand: the pica runtime is the largest part of this path and
    // must not sit in the initial canvas bundle.
    const pica = await getPica();
    report(24, "resample");
    resample = pica.resize(decoded.image, canvas, {
      filter: "lanczos3",
      unsharpAmount: 0,
      quality: 3,
    });
    await raceWithAbort(resample, options?.signal);

    if (options?.signal?.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }

    report(88, "encode");
    const blob = await pica.toBlob(canvas, "image/png");
    report(98, "encode");
    return { blob, width: target.width, height: target.height };
  } finally {
    if (resample) {
      void Promise.resolve(resample)
        .catch(() => undefined)
        .then(() => decoded.close());
    } else {
      decoded.close();
    }
  }
}
