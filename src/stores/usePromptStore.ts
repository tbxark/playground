import { create } from "zustand";

import type { OutputFormat } from "@/services/types";

export const DEFAULT_FRAME_COUNT = 9;
export const DEFAULT_FRAME_DURATION_MS = 200;
export const DEFAULT_SVG_MODEL = "gpt-5.4-mini";

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
  outputFormat: OutputFormat;
  frameCount: number;
  frameDurationMs: number;
  svgModel: string;

  // Actions
  setPrompt: (prompt: string) => void;
  setNegativePrompt: (negativePrompt: string) => void;
  setSize: (size: string) => void;
  setResolution: (resolution: string) => void;
  setBatchCount: (batchCount: number) => void;
  setSeed: (seed: number | undefined) => void;
  setCfgScale: (cfgScale: number | undefined) => void;
  setSteps: (steps: number | undefined) => void;
  setOutputFormat: (outputFormat: OutputFormat) => void;
  setFrameCount: (frameCount: number) => void;
  setFrameDurationMs: (frameDurationMs: number) => void;
  setSvgModel: (svgModel: string) => void;
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
  outputFormat: "default",
  frameCount: DEFAULT_FRAME_COUNT,
  frameDurationMs: DEFAULT_FRAME_DURATION_MS,
  svgModel: DEFAULT_SVG_MODEL,

  setPrompt: (prompt) => set({ prompt }),
  setNegativePrompt: (negativePrompt) => set({ negativePrompt }),
  setSize: (size) => set({ size }),
  setResolution: (resolution) => set({ resolution }),
  setBatchCount: (batchCount) => set({ batchCount }),
  setSeed: (seed) => set({ seed }),
  setCfgScale: (cfgScale) => set({ cfgScale }),
  setSteps: (steps) => set({ steps }),
  setOutputFormat: (outputFormat) => set({ outputFormat }),
  setFrameCount: (frameCount) => set({ frameCount }),
  setFrameDurationMs: (frameDurationMs) => set({ frameDurationMs }),
  setSvgModel: (svgModel) => set({ svgModel }),

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
      outputFormat: "default",
      frameCount: DEFAULT_FRAME_COUNT,
      frameDurationMs: DEFAULT_FRAME_DURATION_MS,
      svgModel: DEFAULT_SVG_MODEL,
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
