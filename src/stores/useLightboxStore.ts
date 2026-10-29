import { create } from "zustand";

/**
 * An action rendered inside the lightbox footer. The viewer is shared by every
 * surface (canvas cards, results dock, workflow nodes, gallery), so callers
 * pass their own actions instead of the viewer importing canvas/gallery stores.
 */
export type LightboxAction = {
  id: string;
  label: string;
  onSelect: () => void | Promise<unknown>;
  disabled?: boolean;
  /** Keep the viewer open after the action runs (default: close it). */
  keepOpen?: boolean;
};

export type LightboxEditOutput = {
  blob: Blob;
  width: number;
  height: number;
};

/** Returning `false` keeps the editor open (the host declined the result). */
export type LightboxEditResult = boolean | void;

/**
 * Opt-in single-image editing. The viewer stays generic: the host names the
 * apply action and decides where the new bitmap goes (replace a canvas card,
 * add a card, save a gallery work, …).
 */
export type LightboxEditable = {
  /** Primary apply label, e.g. "Apply to this card". */
  applyLabel: string;
  /** Optional secondary destination, e.g. "Apply as new card". */
  applyAlternateLabel?: string;
  onApply: (
    output: LightboxEditOutput
  ) => Promise<LightboxEditResult> | LightboxEditResult;
  onApplyAlternate?: (
    output: LightboxEditOutput
  ) => Promise<LightboxEditResult> | LightboxEditResult;
  /**
   * Applying rebuilds the bitmap, so the canvas mask no longer lines up.
   * The editor confirms before discarding it.
   */
  discardWarning?: boolean;
};

export type LightboxImage = {
  url: string;
  title?: string;
  subtitle?: string;
  alt?: string;
  /** Original/reference image shown by the compare slider. */
  compareSrc?: string;
  /** Download filename, including the extension. */
  fileName?: string;
  actions?: LightboxAction[];
  /** Enables the in-viewer editor for this image. */
  editable?: LightboxEditable;
  /** Open straight into edit mode (card menu "Edit image"). */
  initialMode?: "view" | "edit";
};

type LightboxState = {
  isOpen: boolean;
  images: LightboxImage[];
  index: number;
  open: (image: LightboxImage) => void;
  openMany: (images: LightboxImage[], index?: number) => void;
  close: () => void;
  next: () => void;
  previous: () => void;
  goTo: (index: number) => void;
};

export const useLightboxStore = create<LightboxState>((set, get) => ({
  isOpen: false,
  images: [],
  index: 0,

  open: (image) =>
    set({
      isOpen: Boolean(image.url),
      images: image.url ? [image] : [],
      index: 0,
    }),

  openMany: (images, index = 0) => {
    const usable = images.filter((image) => Boolean(image.url));
    if (usable.length === 0) return;
    set({
      isOpen: true,
      images: usable,
      index: Math.min(Math.max(index, 0), usable.length - 1),
    });
  },

  close: () => set({ isOpen: false }),

  next: () => {
    const { images, index } = get();
    if (images.length <= 1) return;
    set({ index: (index + 1) % images.length });
  },

  previous: () => {
    const { images, index } = get();
    if (images.length <= 1) return;
    set({ index: (index - 1 + images.length) % images.length });
  },

  goTo: (index) => {
    const { images } = get();
    if (images.length === 0) return;
    set({ index: Math.min(Math.max(index, 0), images.length - 1) });
  },
}));
