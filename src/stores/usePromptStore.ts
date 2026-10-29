import { create } from "zustand";

type PromptState = {
  prompt: string;
  negativePrompt: string;
  size: string;
  resolution: string;
  batchCount: number;
  seed: number | undefined;
  cfgScale: number | undefined;
  steps: number | undefined;
  activeTagIds: string[];

  // Actions
  setPrompt: (prompt: string) => void;
  setNegativePrompt: (negativePrompt: string) => void;
  setSize: (size: string) => void;
  setResolution: (resolution: string) => void;
  setBatchCount: (batchCount: number) => void;
  setSeed: (seed: number | undefined) => void;
  setCfgScale: (cfgScale: number | undefined) => void;
  setSteps: (steps: number | undefined) => void;
  toggleTag: (tag: { id: string; prompt: string }) => void;
  clearTags: () => void;
  resetAll: () => void;
};

export const usePromptStore = create<PromptState>((set, get) => ({
  prompt: "",
  negativePrompt: "",
  size: "1:1",
  resolution: "1k",
  batchCount: 1,
  seed: undefined,
  cfgScale: undefined,
  steps: undefined,
  activeTagIds: [],

  setPrompt: (prompt) => set({ prompt }),
  setNegativePrompt: (negativePrompt) => set({ negativePrompt }),
  setSize: (size) => set({ size }),
  setResolution: (resolution) => set({ resolution }),
  setBatchCount: (batchCount) => set({ batchCount }),
  setSeed: (seed) => set({ seed }),
  setCfgScale: (cfgScale) => set({ cfgScale }),
  setSteps: (steps) => set({ steps }),

  toggleTag: (tag) => {
    const { activeTagIds, prompt } = get();
    const isActive = activeTagIds.includes(tag.id);

    if (isActive) {
      // remove tag
      const nextActive = activeTagIds.filter((id) => id !== tag.id);
      set({
        activeTagIds: nextActive,
        prompt: removeTagFromPrompt(prompt, tag.prompt),
      });
    } else {
      // add tag
      const separator = prompt.trim() ? (prompt.trim().endsWith(",") ? " " : ", ") : "";
      set({
        activeTagIds: [...activeTagIds, tag.id],
        prompt: `${prompt.trim()}${separator}${tag.prompt}`,
      });
    }
  },

  clearTags: () => set({ activeTagIds: [] }),

  resetAll: () =>
    set({
      prompt: "",
      negativePrompt: "",
      size: "1:1",
      resolution: "1k",
      batchCount: 1,
      seed: undefined,
      cfgScale: undefined,
      steps: undefined,
      activeTagIds: [],
    }),
}));

/**
 * Remove the tag segment that `toggleTag` appended.
 *
 * The old implementation replaced every substring match in the prompt, so
 * removing "8k" also cut it out of "48k" and removing "detailed" deleted the
 * words inside "highly detailed scene". Tags are appended at the end, so remove
 * the last occurrence and normalise only the separators around it.
 */
function removeTagFromPrompt(prompt: string, tagPrompt: string): string {
  if (!tagPrompt) return prompt.trim();
  const index = prompt.lastIndexOf(tagPrompt);
  if (index === -1) return prompt.trim();

  const before = prompt.slice(0, index).replace(/[\s,]+$/, "");
  const after = prompt.slice(index + tagPrompt.length).replace(/^[\s,]+/, "");
  return [before, after].filter(Boolean).join(", ").replace(/\s{2,}/g, " ").trim();
}
