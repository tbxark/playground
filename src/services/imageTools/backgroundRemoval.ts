import type {
  BackgroundRemovalRequest,
  BackgroundRemovalResponse,
} from "./backgroundRemovalMessages";
import type { ImageToolProgress } from "./types";

type ActiveJob = {
  resolve: (blob: Blob) => void;
  reject: (error: unknown) => void;
  onProgress?: (progress: ImageToolProgress) => void;
  abortHandler: () => void;
  cleanup: () => void;
};

const IDLE_TERMINATE_MS = 90_000;

let worker: Worker | null = null;
let activeJob: ActiveJob | null = null;
let idleTimer: number | null = null;

function clearIdleTimer(): void {
  if (idleTimer !== null) {
    window.clearTimeout(idleTimer);
    idleTimer = null;
  }
}

function disposeWorker(): void {
  clearIdleTimer();
  worker?.terminate();
  worker = null;
}

/** Free the ~100 MB runtime after a quiet period; the model stays cached. */
function scheduleIdleTermination(): void {
  clearIdleTimer();
  idleTimer = window.setTimeout(() => {
    idleTimer = null;
    if (activeJob) return;
    disposeWorker();
  }, IDLE_TERMINATE_MS);
}

function settleJob(message: BackgroundRemovalResponse): void {
  const job = activeJob;
  if (!job) return;
  activeJob = null;
  job.cleanup();

  if (message.type === "result") {
    job.resolve(message.blob);
  } else {
    // Any message that is not a result is terminal: an unrecognized shape used
    // to clear `activeJob` and leave the caller's promise pending forever, so
    // the dialog hung with no error and no way to cancel.
    job.reject(
      new Error(
        message.type === "error" ? message.message : "background-removal-unknown-message"
      )
    );
  }
  scheduleIdleTermination();
}

function ensureWorker(): Worker {
  if (worker) return worker;

  const next = new Worker(
    new URL("./backgroundRemoval.worker.ts", import.meta.url),
    { type: "module" }
  );
  next.onmessage = (event: MessageEvent<BackgroundRemovalResponse>) => {
    const message = event.data;
    if (message.type === "progress") {
      activeJob?.onProgress?.({
        progress: message.progress,
        stage: message.stage,
        loaded: message.loaded,
        total: message.total,
      });
      return;
    }
    settleJob(message);
  };
  next.onerror = (event) => {
    const job = activeJob;
    activeJob = null;
    job?.cleanup();
    job?.reject(new Error(event.message || "Background removal worker failed"));
    disposeWorker();
  };
  next.onmessageerror = () => {
    const job = activeJob;
    activeJob = null;
    job?.cleanup();
    job?.reject(new Error("Background removal worker message failed"));
    disposeWorker();
  };
  worker = next;
  return next;
}

/**
 * Remove the background of one image. Only one job may run at a time; the
 * dialog enforces that, and a second call fails fast instead of queueing.
 */
export function removeBackground(
  blob: Blob,
  options?: {
    onProgress?: (progress: ImageToolProgress) => void;
    signal?: AbortSignal;
  }
): Promise<Blob> {
  if (activeJob) {
    return Promise.reject(new Error("background-removal-busy"));
  }
  if (options?.signal?.aborted) {
    return Promise.reject(new DOMException("Aborted", "AbortError"));
  }

  const instance = ensureWorker();
  clearIdleTimer();

  return new Promise<Blob>((resolve, reject) => {
    const signal = options?.signal;
    const abortHandler = () => {
      if (activeJob?.abortHandler !== abortHandler) return;
      activeJob.cleanup();
      activeJob = null;
      // Inference cannot be interrupted in-place; killing the worker is the
      // only reliable cancel and also stops an in-flight model download.
      disposeWorker();
      reject(new DOMException("Aborted", "AbortError"));
    };

    activeJob = {
      resolve,
      reject,
      onProgress: options?.onProgress,
      abortHandler,
      cleanup: () => signal?.removeEventListener("abort", abortHandler),
    };
    signal?.addEventListener("abort", abortHandler, { once: true });

    try {
      instance.postMessage({ type: "run", blob } satisfies BackgroundRemovalRequest);
    } catch (error) {
      activeJob.cleanup();
      activeJob = null;
      disposeWorker();
      reject(error);
    }
  });
}
