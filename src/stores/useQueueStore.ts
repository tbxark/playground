import { create } from "zustand";
import { toast } from "sonner";
import { dataUrlToBlob, fetchAsBlob } from "../utils/file";
import { generateNanoid } from "../utils/nanoid";
import { extractErrorMessage } from "../utils/error";
import { dispatchGenerate } from "../services/providers/dispatcher";
import { generateManagedImage } from "../services/managedBackend";
import {
  deleteHistoryRecord,
  saveToHistory,
} from "../services/historyDb";
import { GenerateParams, GenerationResult, TaskItem } from "../services/types";
import { useConfigStore } from "./useConfigStore";
import { getRuntimeImageState } from "../services/runtimeConfig";
import { i18n } from "@/i18n";

type QueueState = {
  tasks: TaskItem[];
  error: string;

  // Actions
  /** Creates tasks and returns their ids (empty when the model is disabled). */
  enqueueBatch: (input: GenerateParams, count: number) => string[];
  cancelTask: (id: string) => void;
  saveResultToGallery: (id: string) => Promise<void>;
  removeTask: (id: string) => void;
  retryTask: (id: string) => void;
  clearFinished: () => void;
  setError: (error: string) => void;
};

// Store abort controllers outside reactive state
const abortControllers = new Map<string, AbortController>();

export const useQueueStore = create<QueueState>((set) => ({
  tasks: [],
  error: "",

  setError: (error) => set({ error }),

  enqueueBatch: (input, count) => {
    const runtime = getRuntimeImageState();
    if (!runtime.isModelAllowed(input.model)) {
      toast.warning(
        i18n.t(
          runtime.mode === "managed"
            ? "queue.toastSharedModelUnavailable"
            : "queue.toastEnableModelFirst"
        )
      );
      return [];
    }

    const total = Math.max(1, Math.min(count, 8));
    const newTasks: TaskItem[] = [];
    const taskIds: string[] = [];

    for (let i = 0; i < total; i++) {
      const id = generateNanoid(12);
      taskIds.push(id);
      newTasks.push({
        id,
        title:
          total > 1
            ? i18n.t("queue.taskTitleIndexed", { index: i + 1, total })
            : i18n.t("queue.taskTitle"),
        subtitle: `${input.providerId} · ${input.model} (${input.size})`,
        status: "pending",
        progress: 0,
        statusText: i18n.t("queue.statusWaitingIdle"),
        input: { ...input },
        startedAt: Date.now(),
      });
    }

    set((state) => ({
      tasks: [...newTasks, ...state.tasks],
      error: "",
    }));

    // Trigger queue scheduler
    setTimeout(scheduleQueue, 10);
    return taskIds;
  },

  saveResultToGallery: async (id) => {
    const task = useQueueStore.getState().tasks.find((item) => item.id === id);
    const result = task?.result;
    if (!task || !result) return;
    if (result.gallerySaveStatus === "saved") return;

    useQueueStore.setState((state) => ({
      tasks: state.tasks.map((item) =>
        item.id === id && item.result
          ? { ...item, result: { ...item.result, gallerySaveStatus: "saving", gallerySaveError: undefined } }
          : item
      ),
    }));

    try {
      const config = useConfigStore.getState();
      const imageBlob = result.blob || (result.url.startsWith("data:")
        ? dataUrlToBlob(result.url)
        : await fetchAsBlob(result.url, {
            corsProxy: config.corsProxy || undefined,
            corsProxyMode: config.corsProxyMode,
          }));
      await saveToHistory(
        {
          nanoid: result.nanoid,
          imageBlob,
          createdAt: result.createdAt,
          starred: false,
          prompt: result.prompt,
          negativePrompt: result.negativePrompt,
          provider: result.provider,
          model: result.model,
          size: result.size,
          resolution: result.resolution,
          seed: result.seed,
          cfgScale: result.cfgScale,
          steps: result.steps,
          generationTimeMs: result.generationTimeMs,
        },
        useConfigStore.getState().historyQuota
      );
      useQueueStore.setState((state) => ({
        tasks: state.tasks.map((item) =>
          item.id === id && item.result
            ? { ...item, result: { ...item.result, blob: imageBlob, gallerySaveStatus: "saved", gallerySaveError: undefined } }
            : item
        ),
      }));
      toast.success(i18n.t("queue.toastSavedToGallery"));
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : i18n.t("queue.galleryUnavailable");
      useQueueStore.setState((state) => ({
        tasks: state.tasks.map((item) =>
          item.id === id && item.result
            ? { ...item, result: { ...item.result, gallerySaveStatus: "failed", gallerySaveError: message } }
            : item
        ),
      }));
      toast.error(i18n.t("queue.toastSaveToGalleryFailed"));
    }
  },

  cancelTask: (id) => {
    const controller = abortControllers.get(id);
    if (controller) {
      controller.abort();
      abortControllers.delete(id);
    }
    set((state) => ({
      tasks: state.tasks.map((t) =>
        t.id === id
          ? {
              ...t,
              status: "cancelled",
              statusText: i18n.t("queue.statusManuallyCancelled"),
              progress: 0,
            }
          : t
      ),
    }));
    setTimeout(scheduleQueue, 10);
  },

  removeTask: (id) => {
    const controller = abortControllers.get(id);
    if (controller) {
      controller.abort();
      abortControllers.delete(id);
    }
    set((state) => ({
      tasks: state.tasks.filter((t) => t.id !== id),
    }));
    setTimeout(scheduleQueue, 10);
  },

  retryTask: (id) => {
    const task = useQueueStore.getState().tasks.find((item) => item.id === id);
    // Only finished-without-result tasks may be retried. Retrying a running
    // task would start a second execution whose controller the first run's
    // `finally` then deletes, making the new run uncancellable.
    if (!task || (task.status !== "failed" && task.status !== "cancelled")) {
      return;
    }
    set((state) => ({
      tasks: state.tasks.map((t) =>
        t.id === id
          ? {
              ...t,
              status: "pending",
              progress: 0,
              statusText: i18n.t("queue.statusQueued"),
              error: undefined,
              result: null,
              startedAt: Date.now(),
            }
          : t
      ),
    }));
    setTimeout(scheduleQueue, 10);
  },

  clearFinished: () => {
    // Failed tasks and results that never reached the gallery stay in the dock:
    // they are the only retry entry points, so clearing them would lose work.
    set((state) => ({
      tasks: state.tasks.filter((task) => {
        if (
          task.status === "pending" ||
          task.status === "submitting" ||
          task.status === "processing" ||
          task.status === "failed"
        ) {
          return true;
        }
        if (task.status === "done") {
          return task.result?.gallerySaveStatus !== "saved";
        }
        return false;
      }),
    }));
  },
}));

async function executeTask(task: TaskItem) {
  const runtime = getRuntimeImageState();
  // A task may have been queued before a login changed the allowed model
  // scope; never send a model the current session does not permit.
  if (!runtime.isModelAllowed(task.input.model)) {
    const errorMsg = i18n.t(
      runtime.mode === "managed"
        ? "queue.toastSharedModelUnavailable"
        : "queue.toastEnableModelFirst"
    );
    toast.warning(errorMsg);
    useQueueStore.setState((state) => ({
      tasks: state.tasks.map((t) =>
        t.id === task.id
          ? {
              ...t,
              status: "failed",
              statusText: i18n.t("queue.statusFailed"),
              error: errorMsg,
            }
          : t
      ),
    }));
    setTimeout(scheduleQueue, 10);
    return;
  }

  const controller = new AbortController();
  abortControllers.set(task.id, controller);

  const configState = useConfigStore.getState();
  const provider =
    runtime.mode === "local"
      ? configState.providers.find((p) => p.id === task.input.providerId)
      : null;

  if (runtime.mode === "local" && !provider) {
    const errorMsg = i18n.t("queue.errorProviderNotFound", {
      provider: task.input.providerId,
    });
    toast.error(errorMsg);
    useQueueStore.setState((state) => ({
      tasks: state.tasks.map((t) =>
        t.id === task.id
          ? {
              ...t,
              status: "failed",
              statusText: i18n.t("queue.statusFailed"),
              error: errorMsg,
            }
          : t
      ),
    }));
    abortControllers.delete(task.id);
    scheduleQueue();
    return;
  }

  // Update to submitting
  useQueueStore.setState((state) => ({
    tasks: state.tasks.map((t) =>
      t.id === task.id
        ? {
            ...t,
            status: "submitting",
            statusText: i18n.t("queue.statusSubmittingApi"),
            progress: 10,
          }
        : t
    ),
  }));

  const startTime = Date.now();

  try {
    const onProgress = ({ status, progress }: { status: string; progress?: number }) => {
      useQueueStore.setState((state) => ({
        tasks: state.tasks.map((t) =>
          t.id === task.id
            ? {
                ...t,
                status: "processing",
                statusText: status,
                progress:
                  typeof progress === "number"
                    ? Math.max(t.progress, progress)
                    : t.progress,
              }
            : t
        ),
      }));
    };

    const imageUrl =
      runtime.mode === "managed"
        ? await generateManagedImage({
            ...task.input,
            signal: controller.signal,
            onProgress,
          })
        : await dispatchGenerate(provider!, {
            ...task.input,
            corsProxy: configState.corsProxy || undefined,
            corsProxyMode: configState.corsProxyMode,
            signal: controller.signal,
            onProgress,
          });

    controller.signal.throwIfAborted();

    // Keep the generated image visible even if local Blob caching fails.
    let imageBlob: Blob | undefined;
    let gallerySaveStatus: GenerationResult["gallerySaveStatus"] = "saving";
    let gallerySaveError: string | undefined;
    try {
      if (imageUrl.startsWith("data:")) {
        imageBlob = dataUrlToBlob(imageUrl);
      } else {
        imageBlob = await fetchAsBlob(
          imageUrl,
          {
            corsProxy: configState.corsProxy || undefined,
            corsProxyMode: configState.corsProxyMode,
          },
          controller.signal
        );
      }
      controller.signal.throwIfAborted();
    } catch (e) {
      controller.signal.throwIfAborted();
      gallerySaveStatus = "failed";
      gallerySaveError =
        e instanceof Error ? e.message : i18n.t("queue.errorReadImage");
    }

    const durationMs = Date.now() - startTime;
    const nanoid = generateNanoid(8);

    const result: GenerationResult = {
      url: imageUrl,
      blob: imageBlob,
      nanoid,
      prompt: task.input.prompt,
      negativePrompt: task.input.negativePrompt,
      provider: task.input.providerId,
      model: task.input.model,
      size: task.input.size,
      resolution: task.input.resolution,
      seed: task.input.seed,
      cfgScale: task.input.cfgScale,
      steps: task.input.steps,
      generationTimeMs: durationMs,
      createdAt: Date.now(),
      referenceImages: task.input.imageUrls,
      gallerySaveStatus,
      gallerySaveError,
    };

    if (imageBlob) {
      try {
        const historyId = await saveToHistory(
          {
            nanoid,
            imageBlob,
            createdAt: result.createdAt,
            starred: false,
            prompt: task.input.prompt,
            negativePrompt: task.input.negativePrompt,
            provider: task.input.providerId,
            model: task.input.model,
            size: task.input.size,
            resolution: task.input.resolution,
            seed: task.input.seed,
            cfgScale: task.input.cfgScale,
            steps: task.input.steps,
            generationTimeMs: durationMs,
          },
          configState.historyQuota
        );
        result.gallerySaveStatus = "saved";

        // The user may have cancelled while the blob was downloading or the
        // gallery write was in flight. Report "cancelled" and undo the write
        // instead of resurrecting the task as done.
        if (controller.signal.aborted) {
          try {
            await deleteHistoryRecord(historyId);
          } catch {
            // Best-effort cleanup; the task still stays cancelled.
          }
          markTaskCancelled(task.id);
          return;
        }
      } catch (e) {
        result.gallerySaveStatus = "failed";
        result.gallerySaveError =
          e instanceof Error ? e.message : i18n.t("queue.errorGalleryWrite");
      }
    }

    if (controller.signal.aborted) {
      markTaskCancelled(task.id);
      return;
    }

    useQueueStore.setState((state) => ({
      tasks: state.tasks.map((t) =>
        t.id === task.id
          ? {
              ...t,
              status: "done",
              statusText: i18n.t("queue.statusDone"),
              progress: 100,
              result,
            }
          : t
      ),
    }));
    if (result.gallerySaveStatus === "saved") {
      toast.success(i18n.t("queue.toastGeneratedSaved"), { duration: 3000 });
    } else {
      toast.warning(i18n.t("queue.toastGeneratedNotSaved"), { duration: 5000 });
    }
  } catch (err) {
    if (controller.signal.aborted) {
      markTaskCancelled(task.id, i18n.t("queue.statusCancelled"));
    } else {
      const errorMsg = extractErrorMessage(err);
      toast.error(i18n.t("queue.toastGenerateFailed", { message: errorMsg }), {
        duration: 8000,
        description: task.input.model
          ? i18n.t("queue.toastModelDescription", { model: task.input.model })
          : undefined,
      });
      useQueueStore.setState((state) => ({
        tasks: state.tasks.map((t) =>
          t.id === task.id
            ? {
                ...t,
                status: "failed",
                statusText: i18n.t("queue.statusFailed"),
                error: errorMsg,
                progress: 0,
              }
            : t
        ),
      }));
    }
  } finally {
    // Delete only this run's controller: a retried task may already own a new
    // one, and removing it would make that run uncancellable.
    if (abortControllers.get(task.id) === controller) {
      abortControllers.delete(task.id);
    }
    setTimeout(scheduleQueue, 20);
  }
}

function markTaskCancelled(taskId: string, statusText?: string): void {
  useQueueStore.setState((state) => ({
    tasks: state.tasks.map((t) =>
      t.id === taskId
        ? {
            ...t,
            status: "cancelled",
            statusText: statusText ?? i18n.t("queue.statusCancelled"),
            progress: 0,
            result: null,
          }
        : t
    ),
  }));
}

function scheduleQueue() {
  const { tasks } = useQueueStore.getState();
  const { concurrencyLimit } = useConfigStore.getState();

  const runningCount = tasks.filter(
    (t) => t.status === "submitting" || t.status === "processing"
  ).length;

  if (runningCount >= concurrencyLimit) {
    return;
  }

  const slotsAvailable = concurrencyLimit - runningCount;
  const pendingTasks = tasks.filter((t) => t.status === "pending");

  for (let i = 0; i < Math.min(slotsAvailable, pendingTasks.length); i++) {
    void executeTask(pendingTasks[i]);
  }
}

// Raising the concurrency limit must free the new slots immediately instead of
// waiting for the next running task to finish (the slider looked ignored).
useConfigStore.subscribe((state, prev) => {
  if (state.concurrencyLimit !== prev.concurrencyLimit) {
    setTimeout(scheduleQueue, 10);
  }
});

// Global beforeunload listener
if (typeof window !== "undefined") {
  window.addEventListener("beforeunload", (e) => {
    const { tasks } = useQueueStore.getState();
    const hasRunning = tasks.some(
      (t) =>
        t.status === "pending" ||
        t.status === "submitting" ||
        t.status === "processing"
    );
    if (hasRunning) {
      e.preventDefault();
      e.returnValue = i18n.t("queue.unloadWarning");
    }
  });
}
