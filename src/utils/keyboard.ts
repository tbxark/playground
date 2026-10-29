import { useCommandPaletteStore } from "../stores/useCommandPaletteStore";
import { useLightboxStore } from "../stores/useLightboxStore";

/**
 * Keyboard governance shared by the two canvases.
 *
 * Rules:
 * - Typing always wins: input / textarea / select / contenteditable / combobox
 *   / textbox keep their native Delete, Backspace and mod+z behaviour.
 * - IME composition must never fire a canvas shortcut (Enter confirms
 *   candidates, Backspace edits the composition string).
 * - While a modal (lightbox, confirm dialog, palette, shortcuts help) is open,
 *   the canvas stays inert; Radix handles its own Esc.
 */

const EDITABLE_SELECTOR = [
  "input",
  "textarea",
  "select",
  '[contenteditable="true"]',
  '[contenteditable=""]',
  '[contenteditable="plaintext-only"]',
  '[role="textbox"]',
  '[role="combobox"]',
].join(",");

export function isEditableTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  if (!element || typeof element.closest !== "function") return false;
  if (element.isContentEditable) return true;
  return Boolean(element.closest(EDITABLE_SELECTOR));
}

export function isImeComposing(event: KeyboardEvent): boolean {
  // `keyCode === 229` covers older Safari where `isComposing` is unreliable.
  return event.isComposing === true || event.keyCode === 229;
}

export function isOverlayOpen(): boolean {
  const palette = useCommandPaletteStore.getState();
  if (palette.paletteOpen || palette.shortcutsOpen) return true;
  if (useLightboxStore.getState().isOpen) return true;
  if (typeof document === "undefined") return false;
  return Boolean(
    document.querySelector(
      '[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"], [data-canvas-overlay="true"], [data-canvas-context-menu="true"]'
    )
  );
}

/**
 * Radix closes a dialog on the same Esc keydown, so by the time a window-level
 * handler runs the overlay is already gone. Snapshot "was an overlay open?"
 * in the capture phase — that runs before Radix's own handler — so one Esc
 * closes the overlay only, and a second Esc clears canvas selection.
 */
let overlayOpenAtKeydown = false;
let probeInstalled = false;

function installKeydownProbe() {
  if (probeInstalled || typeof document === "undefined") return;
  probeInstalled = true;
  document.addEventListener(
    "keydown",
    (event) => {
      overlayOpenAtKeydown = event.key === "Escape" && isOverlayOpen();
    },
    true
  );
}

installKeydownProbe();

/** `ignoreEventWhen` predicate for every canvas-level hotkey. */
export function shouldIgnoreCanvasHotkey(event: KeyboardEvent): boolean {
  if (isImeComposing(event) || isEditableTarget(event.target)) return true;
  if (event.key === "Escape" && overlayOpenAtKeydown) return true;
  return isOverlayOpen();
}

const CONTROL_SELECTOR = "button, a, [role='button'], [role='link']";

/**
 * Space is the free canvas' hand-pan toggle on keydown (not a hotkey). It must
 * follow the same governance as every other canvas shortcut: typing, IME,
 * open overlays and focused controls all keep native Space behaviour (a
 * focused button must not pan the canvas while it activates).
 */
export function shouldIgnoreSpacePan(event: KeyboardEvent): boolean {
  if (isImeComposing(event) || isEditableTarget(event.target)) return true;
  const element = event.target as HTMLElement | null;
  if (
    element &&
    typeof element.closest === "function" &&
    element.closest(CONTROL_SELECTOR)
  ) {
    return true;
  }
  return isOverlayOpen();
}
