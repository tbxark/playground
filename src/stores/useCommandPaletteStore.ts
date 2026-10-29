import { create } from "zustand";

/**
 * Shared open state for the command palette and the keyboard-shortcuts dialog.
 *
 * Both are mounted once in `AppShell`, but they are opened from the header
 * button, from global hotkeys and from the palette itself. The header button
 * used to synthesize a `KeyboardEvent`, which never worked because
 * `react-hotkeys-hook` matches on `event.code` (synthetic events have none).
 *
 * The two `pending*Clear` flags let the palette navigate to another page and
 * open that page's confirmation dialog without reaching into component state.
 */
type CommandPaletteState = {
  paletteOpen: boolean;
  shortcutsOpen: boolean;
  pendingWorkflowClear: boolean;
  pendingFreeCanvasClear: boolean;

  setPaletteOpen: (open: boolean) => void;
  togglePalette: () => void;
  setShortcutsOpen: (open: boolean) => void;
  toggleShortcuts: () => void;

  requestWorkflowClear: () => void;
  /** Returns true once if a clear was requested, then resets the flag. */
  consumeWorkflowClear: () => boolean;
  requestFreeCanvasClear: () => void;
  consumeFreeCanvasClear: () => boolean;
};

export const useCommandPaletteStore = create<CommandPaletteState>((set, get) => ({
  paletteOpen: false,
  shortcutsOpen: false,
  pendingWorkflowClear: false,
  pendingFreeCanvasClear: false,

  setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
  togglePalette: () => set((state) => ({ paletteOpen: !state.paletteOpen })),
  setShortcutsOpen: (shortcutsOpen) => set({ shortcutsOpen }),
  toggleShortcuts: () => set((state) => ({ shortcutsOpen: !state.shortcutsOpen })),

  requestWorkflowClear: () =>
    set({ pendingWorkflowClear: true, paletteOpen: false }),
  consumeWorkflowClear: () => {
    const pending = get().pendingWorkflowClear;
    if (pending) set({ pendingWorkflowClear: false });
    return pending;
  },
  requestFreeCanvasClear: () =>
    set({ pendingFreeCanvasClear: true, paletteOpen: false }),
  consumeFreeCanvasClear: () => {
    const pending = get().pendingFreeCanvasClear;
    if (pending) set({ pendingFreeCanvasClear: false });
    return pending;
  },
}));
