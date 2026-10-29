import { create } from "zustand";
import { toast } from "sonner";
import {
  clearHistory,
  deleteHistoryRecord,
  exportHistoryAsZip,
  listHistory,
  listHistoryModels,
  toggleStar,
} from "../services/historyDb";
import { HistoryRecord } from "../services/types";
import { downloadFile } from "../utils/file";
import { i18n } from "@/i18n";

type ComparePair = {
  originalUrl: string;
  generatedUrl: string;
  title: string;
};

type GalleryState = {
  isOpen: boolean;
  records: HistoryRecord[];
  availableModels: string[];
  isLoading: boolean;
  loadError: string | null;
  loadErrorGeneration: number;
  clearError: string | null;
  search: string;
  starredOnly: boolean;
  selectedModel: string;
  lightboxRecord: HistoryRecord | null;
  comparePair: ComparePair | null;

  setIsOpen: (isOpen: boolean) => void;
  setSearch: (search: string) => void;
  setStarredOnly: (starredOnly: boolean) => void;
  setSelectedModel: (selectedModel: string) => void;
  setLightboxRecord: (record: HistoryRecord | null) => void;
  setComparePair: (pair: ComparePair | null) => void;

  refreshRecords: () => Promise<void>;
  handleToggleStar: (id: number) => Promise<void>;
  handleDeleteRecord: (id: number) => Promise<void>;
  handleClearAll: () => Promise<void>;
  handleExportZip: () => Promise<void>;
};

export const useGalleryStore = create<GalleryState>((set, get) => ({
  isOpen: false,
  records: [],
  availableModels: [],
  isLoading: false,
  loadError: null,
  loadErrorGeneration: 0,
  clearError: null,
  search: "",
  starredOnly: false,
  selectedModel: "all",
  lightboxRecord: null,
  comparePair: null,

  setIsOpen: (isOpen) => {
    set({ isOpen });
    if (isOpen) {
      void get().refreshRecords();
    }
  },

  setSearch: (search) => {
    set({ search });
    void get().refreshRecords();
  },

  setStarredOnly: (starredOnly) => {
    set({ starredOnly });
    void get().refreshRecords();
  },

  setSelectedModel: (selectedModel) => {
    set({ selectedModel });
    void get().refreshRecords();
  },

  setLightboxRecord: (lightboxRecord) => set({ lightboxRecord }),
  setComparePair: (comparePair) => set({ comparePair }),

  refreshRecords: async () => {
    const { search, starredOnly, selectedModel } = get();
    const loadErrorGeneration = get().loadErrorGeneration + 1;
    set({ isLoading: true, loadError: null, loadErrorGeneration });
    try {
      const [records, availableModels] = await Promise.all([
        listHistory({ search, starredOnly, model: selectedModel }),
        listHistoryModels(),
      ]);
      if (get().loadErrorGeneration === loadErrorGeneration) {
        set({ records, availableModels, loadError: null });
      }
    } catch (e) {
      console.error("Failed to load gallery history", e);
      if (get().loadErrorGeneration === loadErrorGeneration) {
        set({
          loadError:
            e instanceof Error ? e.message : i18n.t("galleryStore.readError"),
        });
      }
    } finally {
      if (get().loadErrorGeneration === loadErrorGeneration) {
        set({ isLoading: false });
      }
    }
  },

  handleToggleStar: async (id) => {
    try {
      const starred = await toggleStar(id);
      set((state) => ({
        records: state.records.map((r) =>
          r.id === id ? { ...r, starred } : r
        ),
      }));
    } catch (e) {
      console.error("Failed to toggle favorite", e);
      toast.error(i18n.t("galleryStore.toastStarFailed"));
    }
  },

  handleDeleteRecord: async (id) => {
    try {
      await deleteHistoryRecord(id);
      toast.success(i18n.t("galleryStore.toastDeleted"));
      set((state) => ({
        records: state.records.filter((r) => r.id !== id),
        lightboxRecord:
          state.lightboxRecord?.id === id ? null : state.lightboxRecord,
      }));
      void get().refreshRecords();
    } catch (e) {
      console.error("Failed to delete record", e);
      toast.error(i18n.t("galleryStore.toastDeleteFailed"));
    }
  },

  handleClearAll: async () => {
    set({ clearError: null });
    try {
      await clearHistory();
      set({ records: [], availableModels: [], lightboxRecord: null });
      toast.success(i18n.t("galleryStore.toastCleared"));
    } catch (e) {
      console.error("Failed to clear history", e);
      set({
        clearError:
          e instanceof Error ? e.message : i18n.t("galleryStore.clearError"),
      });
      toast.error(i18n.t("galleryStore.toastClearFailed"));
    }
  },

  handleExportZip: async () => {
    try {
      const blob = await exportHistoryAsZip();
      downloadFile(
        blob,
        `ai-playground-gallery-${new Date().toISOString().slice(0, 10)}.zip`
      );
      toast.success(i18n.t("galleryStore.toastExportSuccess"));
    } catch (e) {
      toast.error(
        i18n.t("galleryStore.toastExportFailed", {
          message: e instanceof Error ? e.message : String(e),
        })
      );
    }
  },
}));
