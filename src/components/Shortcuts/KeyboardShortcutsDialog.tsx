import React from "react";
import { useTranslation } from "react-i18next";
import { KeyboardIcon } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { useCommandPaletteStore } from "../../stores/useCommandPaletteStore";
import { cn } from "@/utils/cn";

function ShortcutRow({ keys, label }: { keys: string[]; label: string }) {
  return (
    <div className="flex items-start justify-between gap-4 py-1.5">
      <span className="text-xs leading-relaxed text-muted-foreground">
        {label}
      </span>
      <span className="flex shrink-0 flex-wrap justify-end gap-1">
        {keys.map((key) => (
          <kbd
            key={key}
            className="rounded-md border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px] font-semibold text-foreground"
          >
            {key}
          </kbd>
        ))}
      </span>
    </div>
  );
}

function ShortcutSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-1">
      <h3 className="text-[11px] font-mono font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h3>
      <div className="divide-y divide-border/60 rounded-xl border border-border/70 bg-muted/30 px-3 py-1">
        {children}
      </div>
    </section>
  );
}

/**
 * Keyboard help for both canvases. Opened from the header, the palette and the
 * workflow toolbar. The history note is explicit: undo restores structure, not
 * generated results.
 */
export function KeyboardShortcutsDialog() {
  const { t } = useTranslation();
  const open = useCommandPaletteStore((state) => state.shortcutsOpen);
  const setOpen = useCommandPaletteStore((state) => state.setShortcutsOpen);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <KeyboardIcon className="size-4 text-primary" />
            {t("shortcuts.title")}
          </DialogTitle>
          <DialogDescription className="text-xs leading-relaxed">
            {t("shortcuts.description")}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <ShortcutSection title={t("shortcuts.groupGlobal")}>
            <ShortcutRow
              keys={["⌘/Ctrl", "K"]}
              label={t("shortcuts.palette")}
            />
            <ShortcutRow
              keys={["⌘/Ctrl", "Z"]}
              label={t("shortcuts.undo")}
            />
            <ShortcutRow
              keys={["⌘/Ctrl", "⇧", "Z"]}
              label={t("shortcuts.redo")}
            />
            <ShortcutRow keys={["⌘/Ctrl", "Y"]} label={t("shortcuts.redoAlt")} />
            <ShortcutRow
              keys={["Delete", "Backspace"]}
              label={t("shortcuts.deleteSelection")}
            />
            <ShortcutRow keys={["Esc"]} label={t("shortcuts.escape")} />
          </ShortcutSection>

          <ShortcutSection title={t("shortcuts.groupFreeCanvas")}>
            <ShortcutRow keys={["⌘/Ctrl", "Z"]} label={t("shortcuts.undo")} />
            <ShortcutRow
              keys={["⌘/Ctrl", "⇧", "Z"]}
              label={t("shortcuts.redo")}
            />
            <ShortcutRow
              keys={["⌘/Ctrl", "Enter"]}
              label={t("shortcuts.generate")}
            />
            <ShortcutRow keys={["Space"]} label={t("shortcuts.pan")} />
            <ShortcutRow
              keys={["⌘/Ctrl", "V"]}
              label={t("shortcuts.pasteImage")}
            />
            <ShortcutRow keys={["⌘/Ctrl", "Wheel"]} label={t("shortcuts.zoom")} />
          </ShortcutSection>

          <ShortcutSection title={t("shortcuts.groupWorkflow")}>
            <ShortcutRow keys={["⌘/Ctrl", "Z"]} label={t("shortcuts.undo")} />
            <ShortcutRow
              keys={["⌘/Ctrl", "⇧", "Z"]}
              label={t("shortcuts.redo")}
            />
            <ShortcutRow
              keys={["Delete", "Backspace"]}
              label={t("shortcuts.deleteSelection")}
            />
            <ShortcutRow
              keys={["⌘/Ctrl", "Enter"]}
              label={t("shortcuts.runAll")}
            />
          </ShortcutSection>

          <p
            className={cn(
              "rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] leading-relaxed text-amber-700 dark:text-amber-300"
            )}
          >
            {t("shortcuts.historyNote")}
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
