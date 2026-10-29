import { useEffect, useState } from "react";
import { Dialog, DialogContent } from "../ui/dialog";
import { useLightboxStore } from "../../stores/useLightboxStore";
import { ImageWorkspace } from "./ImageWorkspace";

/**
 * The single large-image dialog for the app. Mounted once in AppShell so cards,
 * the results dock, workflow nodes and the gallery all share it.
 *
 * Viewing and editing are one workspace (`ImageWorkspace`): a tool rail, a
 * contextual options bar, the canvas and an inspector. Esc closes it (asking
 * first when work is pending), ←/→ switch images while nothing is pending.
 */
export function ImageLightbox() {
  const { isOpen, images, index, close, next, previous } = useLightboxStore();
  const image = images[index];
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (!isOpen) setDirty(false);
  }, [isOpen]);

  if (!image) return null;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && close()}>
      <DialogContent
        showCloseButton={false}
        tabIndex={-1}
        className="flex h-[94vh] w-[96vw] max-w-[1560px] flex-col gap-0 overflow-hidden rounded-xl border-white/10 bg-zinc-950 p-0 text-zinc-100 shadow-2xl outline-none sm:max-w-[1560px]"
        aria-describedby={undefined}
        onOpenAutoFocus={(event) => {
          // Keep the focus ring off the first header button; the workspace
          // container owns keyboard focus so shortcuts work immediately.
          event.preventDefault();
          (event.currentTarget as HTMLElement | null)?.focus();
        }}
        onEscapeKeyDown={(event) => {
          // The workspace owns Esc while editing (confirm dialogs, compare,
          // pending changes); never let the dialog close behind them.
          if (dirty) event.preventDefault();
        }}
        onInteractOutside={(event) => {
          if (dirty) event.preventDefault();
        }}
      >
        <ImageWorkspace
          image={image}
          index={index}
          total={images.length}
          onClose={close}
          onPrevious={previous}
          onNext={next}
          onDirtyChange={setDirty}
        />
      </DialogContent>
    </Dialog>
  );
}
