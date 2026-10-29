import React, { useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Command } from "cmdk";
import { useHotkeys } from "react-hotkeys-hook";
import { useTranslation } from "react-i18next";
import {
  ExternalLinkIcon,
  ImageIcon,
  ImagesIcon,
  KeyboardIcon,
  MoonIcon,
  NetworkIcon,
  Redo2Icon,
  RotateCcwIcon,
  SearchIcon,
  SettingsIcon,
  SparklesIcon,
  SunIcon,
  Trash2Icon,
  Undo2Icon,
  ZapIcon,
} from "lucide-react";
import { toast } from "sonner";
import { useConfigStore } from "../../stores/useConfigStore";
import { useQueueStore } from "../../stores/useQueueStore";
import { useCommandPaletteStore } from "../../stores/useCommandPaletteStore";
import { useFreeCanvasStore } from "../../stores/useFreeCanvasStore";
import { useWorkflowStore } from "../../stores/useWorkflowStore";
import { modelDisplayName } from "../../services/imageService";

export function CommandPalette() {
  const { t } = useTranslation();
  const open = useCommandPaletteStore((state) => state.paletteOpen);
  const setOpen = useCommandPaletteStore((state) => state.setPaletteOpen);
  const togglePalette = useCommandPaletteStore((state) => state.togglePalette);
  const setShortcutsOpen = useCommandPaletteStore(
    (state) => state.setShortcutsOpen
  );
  const requestWorkflowClear = useCommandPaletteStore(
    (state) => state.requestWorkflowClear
  );
  const requestFreeCanvasClear = useCommandPaletteStore(
    (state) => state.requestFreeCanvasClear
  );
  const navigate = useNavigate();
  const location = useLocation();

  const {
    theme,
    setTheme,
    imageConfig,
    selectedModel,
    setSelectedModel,
    exportConfig,
  } = useConfigStore();

  const { clearFinished } = useQueueStore();

  // Toggle Command Palette with Cmd+K / Ctrl+K
  useHotkeys("mod+k", (e) => {
    e.preventDefault();
    togglePalette();
  });

  // Close on route change or Esc
  useEffect(() => {
    const handleDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && open) {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", handleDown);
    return () => window.removeEventListener("keydown", handleDown);
  }, [open, setOpen]);

  if (!open) return null;

  const runCommand = (action: () => void) => {
    setOpen(false);
    action();
  };

  const isWorkflowPage = location.pathname === "/workflow";
  const isCanvasPage = location.pathname === "/" || isWorkflowPage;

  const handleUndo = () => {
    const ok = isWorkflowPage
      ? useWorkflowStore.getState().undo()
      : useFreeCanvasStore.getState().undo();
    if (ok) toast.success(t("palette.toastUndone"));
    else toast.info(t("palette.toastNothingToUndo"));
  };

  const handleRedo = () => {
    const ok = isWorkflowPage
      ? useWorkflowStore.getState().redo()
      : useFreeCanvasStore.getState().redo();
    if (ok) toast.success(t("palette.toastRedone"));
    else toast.info(t("palette.toastNothingToRedo"));
  };

  const activeModels = imageConfig.models.filter((m) =>
    imageConfig.enabledModelIds.includes(m.id)
  );

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center pt-[15vh] px-4 bg-zinc-950/70 backdrop-blur-md animate-in fade-in-0 duration-150">
      <div
        className="fixed inset-0"
        onClick={() => setOpen(false)}
        aria-hidden="true"
      />

      <div className="relative w-full max-w-2xl rounded-3xl border border-white/15 bg-zinc-900/95 shadow-2xl overflow-hidden backdrop-blur-2xl text-zinc-100 font-sans z-10 animate-in zoom-in-95 duration-150">
        <Command className="w-full flex flex-col">
          {/* Search Input Bar */}
          <div className="flex items-center px-4 py-3.5 border-b border-white/10 gap-3">
            <SearchIcon className="size-5 text-zinc-400 shrink-0" />
            <Command.Input
              autoFocus
              placeholder={t("palette.searchPlaceholder")}
              className="w-full bg-transparent text-sm text-zinc-100 placeholder:text-zinc-500 outline-none"
            />
            <kbd className="px-2 py-0.5 rounded-lg bg-white/10 border border-white/10 text-[10px] font-mono text-zinc-400 shrink-0">
              {t("palette.escToClose")}
            </kbd>
          </div>

          {/* Command List Area */}
          <Command.List className="max-h-[380px] overflow-y-auto p-2 space-y-1 text-xs">
            <Command.Empty className="py-8 text-center text-zinc-500 text-xs">
              {t("palette.emptyResult")}
            </Command.Empty>

            {/* Group 1: page navigation */}
            <Command.Group
              heading={t("palette.groupNavigation")}
              className="px-2 py-1.5 text-[11px] font-semibold text-zinc-400 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:pb-1.5 [&_[cmdk-group-heading]]:text-zinc-500 [&_[cmdk-group-heading]]:font-mono"
            >
              <Command.Item
                onSelect={() => runCommand(() => navigate("/"))}
                className="flex items-center gap-3 px-3 py-2 rounded-xl text-zinc-200 cursor-pointer select-none aria-selected:bg-white/10 aria-selected:text-white transition-colors"
              >
                <SparklesIcon className="size-4 text-primary" />
                <span className="font-medium flex-1">{t("palette.navFreeCanvas")}</span>
                <span className="text-[10px] text-zinc-500 font-mono">{t("palette.navFreeCanvasHint")}</span>
              </Command.Item>

              <Command.Item
                onSelect={() => runCommand(() => navigate("/simple"))}
                className="flex items-center gap-3 px-3 py-2 rounded-xl text-zinc-200 cursor-pointer select-none aria-selected:bg-white/10 aria-selected:text-white transition-colors"
              >
                <ZapIcon className="size-4 text-amber-400" />
                <span className="font-medium flex-1">{t("palette.navSimple")}</span>
                <span className="text-[10px] text-zinc-500 font-mono">{t("palette.navSimpleHint")}</span>
              </Command.Item>

              <Command.Item
                onSelect={() => runCommand(() => navigate("/workflow"))}
                className="flex items-center gap-3 px-3 py-2 rounded-xl text-zinc-200 cursor-pointer select-none aria-selected:bg-white/10 aria-selected:text-white transition-colors"
              >
                <NetworkIcon className="size-4 text-cyan-400" />
                <span className="font-medium flex-1">{t("palette.navWorkflow")}</span>
                <span className="text-[10px] text-zinc-500 font-mono">{t("palette.navWorkflowHint")}</span>
              </Command.Item>

              <Command.Item
                onSelect={() => runCommand(() => navigate("/gallery"))}
                className="flex items-center gap-3 px-3 py-2 rounded-xl text-zinc-200 cursor-pointer select-none aria-selected:bg-white/10 aria-selected:text-white transition-colors"
              >
                <ImagesIcon className="size-4 text-emerald-400" />
                <span className="font-medium flex-1">{t("palette.navGallery")}</span>
                <span className="text-[10px] text-zinc-500 font-mono">{t("palette.navGalleryHint")}</span>
              </Command.Item>

              <Command.Item
                onSelect={() => runCommand(() => navigate("/settings"))}
                className="flex items-center gap-3 px-3 py-2 rounded-xl text-zinc-200 cursor-pointer select-none aria-selected:bg-white/10 aria-selected:text-white transition-colors"
              >
                <SettingsIcon className="size-4 text-amber-400" />
                <span className="font-medium flex-1">{t("palette.navSettings")}</span>
                <span className="text-[10px] text-zinc-500 font-mono">{t("palette.navSettingsHint")}</span>
              </Command.Item>
            </Command.Group>

            {/* Group 2: canvas actions (canvas pages only) */}
            {isCanvasPage && (
              <Command.Group
                heading={t("palette.groupCanvas")}
                className="px-2 py-1.5 text-[11px] font-semibold text-zinc-400 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:pb-1.5 [&_[cmdk-group-heading]]:text-zinc-500 [&_[cmdk-group-heading]]:font-mono"
              >
                <Command.Item
                  onSelect={() => runCommand(handleUndo)}
                  className="flex items-center gap-3 px-3 py-2 rounded-xl text-zinc-200 cursor-pointer select-none aria-selected:bg-white/10 aria-selected:text-white transition-colors"
                >
                  <Undo2Icon className="size-4 text-zinc-300" />
                  <span className="font-medium flex-1">{t("palette.undo")}</span>
                  <span className="text-[10px] text-zinc-500 font-mono">⌘Z</span>
                </Command.Item>

                <Command.Item
                  onSelect={() => runCommand(handleRedo)}
                  className="flex items-center gap-3 px-3 py-2 rounded-xl text-zinc-200 cursor-pointer select-none aria-selected:bg-white/10 aria-selected:text-white transition-colors"
                >
                  <Redo2Icon className="size-4 text-zinc-300" />
                  <span className="font-medium flex-1">{t("palette.redo")}</span>
                  <span className="text-[10px] text-zinc-500 font-mono">⇧⌘Z</span>
                </Command.Item>

                <Command.Item
                  onSelect={() =>
                    runCommand(() => {
                      requestWorkflowClear();
                      navigate("/workflow");
                    })
                  }
                  className="flex items-center gap-3 px-3 py-2 rounded-xl text-zinc-200 cursor-pointer select-none aria-selected:bg-white/10 aria-selected:text-white transition-colors"
                >
                  <Trash2Icon className="size-4 text-rose-400" />
                  <span className="font-medium flex-1">
                    {t("palette.clearWorkflow")}
                  </span>
                </Command.Item>

                <Command.Item
                  onSelect={() =>
                    runCommand(() => {
                      requestFreeCanvasClear();
                      navigate("/");
                    })
                  }
                  className="flex items-center gap-3 px-3 py-2 rounded-xl text-zinc-200 cursor-pointer select-none aria-selected:bg-white/10 aria-selected:text-white transition-colors"
                >
                  <Trash2Icon className="size-4 text-rose-400" />
                  <span className="font-medium flex-1">
                    {t("palette.clearFreeCanvas")}
                  </span>
                </Command.Item>

                <Command.Item
                  onSelect={() =>
                    runCommand(() => setShortcutsOpen(true))
                  }
                  className="flex items-center gap-3 px-3 py-2 rounded-xl text-zinc-200 cursor-pointer select-none aria-selected:bg-white/10 aria-selected:text-white transition-colors"
                >
                  <KeyboardIcon className="size-4 text-primary" />
                  <span className="font-medium flex-1">
                    {t("palette.openShortcuts")}
                  </span>
                </Command.Item>
              </Command.Group>
            )}

            {/* Group 3: quick model switch */}
            <Command.Group
              heading={t("palette.groupModels")}
              className="px-2 py-1.5 text-[11px] font-semibold text-zinc-400 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:pb-1.5 [&_[cmdk-group-heading]]:text-zinc-500 [&_[cmdk-group-heading]]:font-mono"
            >
              {activeModels.map((m) => {
                const isActive = selectedModel === m.id;
                return (
                  <Command.Item
                    key={m.id}
                    onSelect={() =>
                      runCommand(() => {
                        setSelectedModel(m.id);
                        toast.success(t("palette.toastModelSwitched", { model: modelDisplayName(m) }));
                      })
                    }
                    className="flex items-center gap-3 px-3 py-2 rounded-xl text-zinc-200 cursor-pointer select-none aria-selected:bg-white/10 aria-selected:text-white transition-colors"
                  >
                    <ImageIcon className="size-4 text-blue-400" />
                    <span className="font-medium flex-1 truncate">
                      {modelDisplayName(m)}
                    </span>
                    <span className="text-[10px] text-zinc-500 font-mono">
                      {m.id}
                    </span>
                    {isActive && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-primary/20 text-primary border border-primary/30">
                        {t("palette.currentlyActive")}
                      </span>
                    )}
                  </Command.Item>
                );
              })}
            </Command.Group>

            {/* Group 3: common quick actions */}
            <Command.Group
              heading={t("palette.groupActions")}
              className="px-2 py-1.5 text-[11px] font-semibold text-zinc-400 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:pb-1.5 [&_[cmdk-group-heading]]:text-zinc-500 [&_[cmdk-group-heading]]:font-mono"
            >
              <Command.Item
                onSelect={() =>
                  runCommand(() => {
                    const next = theme === "dark" ? "light" : "dark";
                    setTheme(next);
                    toast.info(
                      next === "dark"
                        ? t("palette.toastThemeDark")
                        : t("palette.toastThemeLight")
                    );
                  })
                }
                className="flex items-center gap-3 px-3 py-2 rounded-xl text-zinc-200 cursor-pointer select-none aria-selected:bg-white/10 aria-selected:text-white transition-colors"
              >
                {theme === "dark" ? (
                  <SunIcon className="size-4 text-amber-400" />
                ) : (
                  <MoonIcon className="size-4 text-slate-300" />
                )}
                <span className="font-medium flex-1">{t("palette.toggleTheme")}</span>
                <span className="text-[10px] text-zinc-500 font-mono">
                  {t("palette.currentTheme", { theme: theme === "dark" ? t("palette.themeDark") : t("palette.themeLight") })}
                </span>
              </Command.Item>

              <Command.Item
                onSelect={() =>
                  runCommand(() => {
                    const json = exportConfig();
                    const blob = new Blob([json], { type: "application/json" });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = `universal-playground-config-${new Date().toISOString().slice(0, 10)}.json`;
                    a.click();
                    URL.revokeObjectURL(url);
                    toast.success(t("palette.toastConfigExported"));
                  })
                }
                className="flex items-center gap-3 px-3 py-2 rounded-xl text-zinc-200 cursor-pointer select-none aria-selected:bg-white/10 aria-selected:text-white transition-colors"
              >
                <RotateCcwIcon className="size-4 text-emerald-400" />
                <span className="font-medium flex-1">{t("palette.exportConfig")}</span>
              </Command.Item>

              <Command.Item
                onSelect={() =>
                  runCommand(() => {
                    clearFinished();
                    toast.success(t("palette.toastClearedFinished"));
                  })
                }
                className="flex items-center gap-3 px-3 py-2 rounded-xl text-zinc-200 cursor-pointer select-none aria-selected:bg-white/10 aria-selected:text-white transition-colors"
              >
                <Trash2Icon className="size-4 text-rose-400" />
                <span className="font-medium flex-1">{t("palette.clearFinished")}</span>
              </Command.Item>

              <Command.Item
                onSelect={() =>
                  runCommand(() => {
                    window.open("https://github.com/tbxark/vercel-proxy", "_blank");
                  })
                }
                className="flex items-center gap-3 px-3 py-2 rounded-xl text-zinc-200 cursor-pointer select-none aria-selected:bg-white/10 aria-selected:text-white transition-colors"
              >
                <ExternalLinkIcon className="size-4 text-primary" />
                <span className="font-medium flex-1">{t("palette.openProxyProject")}</span>
              </Command.Item>
            </Command.Group>
          </Command.List>

          {/* Footer Key Hints */}
          <div className="flex items-center justify-between px-4 py-2 border-t border-white/5 bg-zinc-950/60 text-[11px] text-zinc-500 font-mono">
            <div className="flex items-center gap-3">
              <span>{t("palette.hintNavigate")}</span>
              <span>{t("palette.hintConfirm")}</span>
              <span>{t("palette.hintEsc")}</span>
            </div>
            <div className="text-[10px]">
              {t("palette.hintCmdKBefore")} <kbd className="px-1.5 py-0.5 rounded bg-white/10 text-zinc-300">⌘ + K</kbd> {t("palette.hintCmdKAfter")}
            </div>
          </div>
        </Command>
      </div>
    </div>
  );
}
