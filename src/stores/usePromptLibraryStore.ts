import { create } from "zustand";
import { persist } from "zustand/middleware";
import { generateNanoid } from "../utils/nanoid";

export type PromptLibraryEntry = {
  id: string;
  title: string;
  prompt: string;
};

type PromptLibraryState = {
  entries: PromptLibraryEntry[];

  // Actions
  addEntry: (title: string, prompt: string) => PromptLibraryEntry | null;
  updateEntry: (
    id: string,
    patch: Partial<Pick<PromptLibraryEntry, "title" | "prompt">>
  ) => void;
  removeEntry: (id: string) => void;
};

/**
 * User-built prompt library (title + prompt). Starts empty on purpose —
 * no built-in presets; entries are added manually in Settings and can be
 * toggled onto the prompt input from the Free Canvas "Inspire" panel.
 */
export const usePromptLibraryStore = create<PromptLibraryState>()(
  persist(
    (set) => ({
      entries: [],

      addEntry: (title, prompt) => {
        const trimmedTitle = title.trim();
        const trimmedPrompt = prompt.trim();
        if (!trimmedTitle || !trimmedPrompt) return null;

        const entry: PromptLibraryEntry = {
          id: `pl-${generateNanoid(8)}`,
          title: trimmedTitle,
          prompt: trimmedPrompt,
        };
        set((state) => ({ entries: [...state.entries, entry] }));
        return entry;
      },

      updateEntry: (id, patch) =>
        set((state) => ({
          entries: state.entries.map((e) =>
            e.id === id
              ? {
                  ...e,
                  title: patch.title !== undefined ? patch.title.trim() : e.title,
                  prompt: patch.prompt !== undefined ? patch.prompt.trim() : e.prompt,
                }
              : e
          ),
        })),

      removeEntry: (id) =>
        set((state) => ({ entries: state.entries.filter((e) => e.id !== id) })),
    }),
    {
      name: "universal-playground-prompt-library",
    }
  )
);
