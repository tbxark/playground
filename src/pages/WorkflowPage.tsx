import React, { useEffect } from "react";
import { WorkflowCanvas } from "../components/Workflow/WorkflowCanvas";
import { useWorkflowStore } from "../stores/useWorkflowStore";

export function WorkflowPage() {
  // Persisted nodes carry IndexedDB asset keys, not image URLs: resolve them
  // once per load (and prune orphaned workflow assets). localStorage hydration
  // is synchronous, so the store already holds the persisted graph here.
  useEffect(() => {
    void useWorkflowStore.getState().hydrateAssets();
  }, []);

  return (
    <div className="relative flex-1 w-full h-full flex flex-col overflow-hidden">
      <WorkflowCanvas />
    </div>
  );
}
