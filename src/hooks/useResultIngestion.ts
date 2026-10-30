import { useEffect } from "react";
import { useQueueStore } from "../stores/useQueueStore";
import { useFreeCanvasStore } from "../stores/useFreeCanvasStore";

/**
 * Moves finished queue results onto the free canvas. Mounted once in AppShell so
 * results still land when the user is on another route.
 *
 * Idempotency is keyed on `result.nanoid` only: retrying a task keeps the task
 * id but generates a fresh nanoid, and that new image must be ingested. A
 * result the user removed on purpose is remembered by the canvas store
 * (`dismissedResultNanoids`) and skipped here; the results dock can still
 * bring it back through an explicit "add to canvas".
 */
export function useResultIngestion() {
  const tasks = useQueueStore((state) => state.tasks);
  const addResultCard = useFreeCanvasStore((state) => state.addResultCard);
  const syncResultSaveState = useFreeCanvasStore(
    (state) => state.syncResultSaveState
  );

  useEffect(() => {
    tasks.forEach((task) => {
      if (task.status !== "done" || !task.result) return;
      void addResultCard(task.result, task.id, { ingest: true });
      syncResultSaveState(task.result);
    });
  }, [tasks, addResultCard, syncResultSaveState]);
}
