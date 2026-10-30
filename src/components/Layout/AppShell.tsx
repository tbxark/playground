import React, { useEffect, useState } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { Toaster, toast } from "sonner";
import { useTranslation } from "react-i18next";
import {
  ImagesIcon,
  KeyboardIcon,
  Loader2Icon,
  MoonIcon,
  NetworkIcon,
  PaletteIcon,
  SearchIcon,
  SettingsIcon,
  SparklesIcon,
  SunIcon,
  ZapIcon,
} from "lucide-react";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { CommandPalette } from "../CommandPalette/CommandPalette";
import { ImageLightbox } from "../Preview/ImageLightbox";
import { KeyboardShortcutsDialog } from "../Shortcuts/KeyboardShortcutsDialog";
import { useConfigStore } from "../../stores/useConfigStore";
import { useFreeCanvasStore } from "../../stores/useFreeCanvasStore";
import { useQueueStore } from "../../stores/useQueueStore";
import { useCommandPaletteStore } from "../../stores/useCommandPaletteStore";
import { useResultIngestion } from "../../hooks/useResultIngestion";
import { getDb } from "../../services/historyDb";
import { serverFeatureEnabled } from "@/features/serverMode";
import { useServerStore } from "../../stores/useServerStore";
import { useManagedConfigStore } from "../../stores/useManagedConfigStore";
import { changeLocale } from "@/i18n";
import { cn } from "@/utils/cn";

export function AppShell() {
  const { t, i18n } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();

  const { theme, setTheme } = useConfigStore();
  const mainCard = useFreeCanvasStore((state) =>
    state.cards.find((card) => card.role === "main")
  );
  const maskStrokes = useFreeCanvasStore((state) => state.maskStrokes);
  const hasReferenceCards = useFreeCanvasStore((state) =>
    state.cards.some((card) => card.role === "reference")
  );
  const hydrateAssets = useFreeCanvasStore((state) => state.hydrateAssets);
  const togglePalette = useCommandPaletteStore((state) => state.togglePalette);
  const setShortcutsOpen = useCommandPaletteStore(
    (state) => state.setShortcutsOpen
  );
  const { tasks } = useQueueStore();
  useResultIngestion();

  const currentLocale = i18n.language.startsWith("zh") ? "zh" : "en";

  // The static <title> in index.html is only a pre-hydration fallback; the
  // document title follows the active UI language here.
  useEffect(() => {
    document.title = t("shell.app.documentTitle");
  }, [t, i18n.language]);

  const [recordCount, setRecordCount] = useState<number>(0);
  const [galleryCountError, setGalleryCountError] = useState(false);

  // Restore free-canvas assets from IndexedDB once on app start.
  useEffect(() => {
    void hydrateAssets();
  }, [hydrateAssets]);

  // Shared build: probe the backend once so login UI knows what it offers.
  useEffect(() => {
    if (!serverFeatureEnabled) return;
    void useServerStore.getState().checkHealth();
  }, []);

  // Managed sessions load their runtime config from the server; local sessions
  // clear it. The local config store is never touched by this transition.
  const serverToken = useServerStore((state) => state.token);
  const loadManagedConfig = useManagedConfigStore((state) => state.load);
  const resetManagedConfig = useManagedConfigStore((state) => state.reset);
  useEffect(() => {
    if (!serverFeatureEnabled) return;
    if (serverToken) void loadManagedConfig();
    else resetManagedConfig();
  }, [serverToken, loadManagedConfig, resetManagedConfig]);

  // A 401 from the proxy means the JWT expired; say so once, then re-arm.
  const serverUnauthorized = useServerStore((state) => state.unauthorized);
  useEffect(() => {
    if (!serverUnauthorized) return;
    toast.error(t("server.sessionExpired"));
    useServerStore.getState().clearUnauthorized();
  }, [serverUnauthorized, t]);

  // Poll gallery count from IndexedDB. Failures are visible in the nav instead
  // of being swallowed while every 4s retry fails silently.
  useEffect(() => {
    let mounted = true;
    const fetchCount = async () => {
      try {
        const db = await getDb();
        const count = await db.count("gallery");
        if (mounted) {
          setRecordCount(count);
          setGalleryCountError(false);
        }
      } catch {
        if (mounted) setGalleryCountError(true);
      }
    };

    fetchCount();
    const interval = setInterval(fetchCount, 4000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

  const toggleTheme = () => {
    setTheme(theme === "dark" ? "light" : "dark");
  };

  // Active rendering tasks in queue
  const activeTasks = tasks.filter(
    (task) => task.status === "submitting" || task.status === "processing" || task.status === "pending"
  );

  // Badge reports the current creation mode only.
  let modeBadge = location.pathname === "/" ? t("shell.app.modeText2img") : "";
  let badgeClass = "bg-muted text-muted-foreground border-border";
  if (location.pathname === "/simple") {
    modeBadge = t("shell.app.modeSimple");
    badgeClass = "bg-amber-500/15 text-amber-300 border-amber-500/30";
  } else if (location.pathname === "/workflow") {
    modeBadge = t("shell.app.modeWorkflow");
    badgeClass = "bg-cyan-500/15 text-cyan-300 border-cyan-500/30";
  } else if (location.pathname === "/gallery") {
    modeBadge = t("shell.app.modeGallery");
    badgeClass = "bg-primary/15 text-primary border-primary/30";
  } else if (location.pathname === "/settings") {
    modeBadge = t("shell.app.modeSettings");
    badgeClass = "bg-muted text-muted-foreground border-border";
  } else if (maskStrokes.length > 0) {
    modeBadge = t("shell.app.modeInpaint");
    badgeClass = "bg-amber-500/20 text-amber-300 border-amber-500/30";
  } else if (mainCard || hasReferenceCards) {
    modeBadge = t("shell.app.modeImg2img");
    badgeClass = "bg-blue-500/20 text-blue-300 border-blue-500/30";
  }

  return (
    <div className="h-screen w-screen overflow-hidden bg-background text-foreground flex flex-col font-sans">
      {/* 1. App Shell Top Unified Navigation Header */}
      <header className="relative z-30 w-full border-b border-border bg-background/90 backdrop-blur-2xl px-2 sm:px-4 lg:px-6 py-2 transition-colors select-none shrink-0 min-h-14 flex flex-wrap items-center justify-between gap-1.5">
        {/* Left: Minimal Logo Icon & Context Badge */}
        <div className="flex items-center gap-2.5 min-w-0 z-10">
          <Link
            to="/"
            className="size-8 rounded-xl bg-gradient-to-tr from-primary to-blue-500 flex items-center justify-center text-white shadow-md shadow-primary/20 hover:scale-105 active:scale-95 transition-all shrink-0 cursor-pointer"
            title={t("shell.app.backToFreeCanvasTitle")}
          >
            <SparklesIcon className="size-4 fill-current" />
          </Link>

          {/* Workflow / Mode Badge */}
          <Badge
            variant="outline"
            className={`hidden md:inline-flex text-[10px] font-mono py-0.5 h-6 transition-colors max-w-[220px] truncate ${badgeClass} ${modeBadge ? "" : "invisible"}`}
          >
              {modeBadge || t("shell.app.modeDefault")}
            </Badge>
        </div>

        {/* Navigation tabs: own row below lg (all five segments stay reachable
            without covering the utility buttons), centered single row at lg+ */}
        <div className="pointer-events-auto z-10 order-last w-full min-w-0 lg:order-none lg:w-auto lg:absolute lg:left-1/2 lg:top-1/2 lg:-translate-x-1/2 lg:-translate-y-1/2 lg:flex-none">
          <nav aria-label={t("shell.app.mainNavAria")} className="flex flex-wrap items-center p-1 rounded-2xl bg-muted/60 border border-border text-xs shadow-inner gap-0.5 w-full lg:w-max lg:flex-nowrap">
            <NavLink
              to="/"
              end
              className={({ isActive }) =>
                cn(
                  "px-1.5 sm:px-3 py-1.5 rounded-xl text-[11px] sm:text-xs font-semibold transition-all cursor-pointer flex items-center gap-1 sm:gap-1.5 whitespace-nowrap shrink-0",
                  isActive
                    ? "bg-primary text-primary-foreground font-bold shadow-md shadow-primary/15"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted"
                )
              }
              title={t("shell.app.navFreeCanvas")}
            >
              <PaletteIcon className="size-3.5" />
              <span>{t("shell.app.navFreeCanvas")}</span>
            </NavLink>

            <NavLink
              to="/simple"
              className={({ isActive }) =>
                cn(
                  "px-1.5 sm:px-3 py-1.5 rounded-xl text-[11px] sm:text-xs font-semibold transition-all cursor-pointer flex items-center gap-1 sm:gap-1.5 whitespace-nowrap shrink-0",
                  isActive
                    ? "bg-primary text-primary-foreground font-bold shadow-md shadow-primary/15"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted"
                )
              }
              title={t("shell.app.navSimple")}
            >
              <ZapIcon className="size-3.5 text-amber-400" />
              <span>{t("shell.app.navSimple")}</span>
            </NavLink>

            <NavLink
              to="/workflow"
              className={({ isActive }) =>
                cn(
                  "px-1.5 sm:px-3 py-1.5 rounded-xl text-[11px] sm:text-xs font-semibold transition-all cursor-pointer flex items-center gap-1 sm:gap-1.5 whitespace-nowrap shrink-0",
                  isActive
                    ? "bg-primary text-primary-foreground font-bold shadow-md shadow-primary/15"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted"
                )
              }
              title={t("shell.app.navWorkflow")}
            >
              <NetworkIcon className="size-3.5 text-cyan-400" />
              <span>{t("shell.app.navWorkflow")}</span>
            </NavLink>

            <NavLink
              to="/gallery"
              className={({ isActive }) =>
                cn(
                  "px-1.5 sm:px-3 py-1.5 rounded-xl text-[11px] sm:text-xs font-semibold transition-all cursor-pointer flex items-center gap-1 sm:gap-1.5 whitespace-nowrap shrink-0",
                  isActive
                    ? "bg-primary text-primary-foreground font-bold shadow-md shadow-primary/15"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted"
                )
              }
              title={t("shell.app.navGallery")}
            >
              <ImagesIcon className="size-3.5 text-primary" />
              <span>{t("shell.app.navGallery")}</span>
              {galleryCountError ? (
                <span
                  className="px-1.5 py-0.2 rounded-full bg-red-500/20 text-red-300 text-[10px] font-bold"
                  title={t("shell.app.galleryUnavailable")}
                >
                  !
                </span>
              ) : (
                recordCount > 0 && (
                  <span className="px-1.5 py-0.2 rounded-full bg-primary/20 text-primary text-[10px] font-bold">
                    {recordCount}
                  </span>
                )
              )}
            </NavLink>

            <NavLink
              to="/settings"
              className={({ isActive }) =>
                cn(
                  "px-1.5 sm:px-3 py-1.5 rounded-xl text-[11px] sm:text-xs font-semibold transition-all cursor-pointer flex items-center gap-1 sm:gap-1.5 whitespace-nowrap shrink-0",
                  isActive
                    ? "bg-primary text-primary-foreground font-bold shadow-md shadow-primary/15"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted"
                )
              }
              title={t("shell.app.navSettings")}
            >
              <SettingsIcon className="size-3.5" />
              <span>{t("shell.app.navSettings")}</span>
            </NavLink>
          </nav>
        </div>

        {/* Right: Active Queue & Utilities */}
        <div className="flex items-center gap-2.5 justify-end z-10">
          {/* Live Queue Active Tasks Indicator */}
          {activeTasks.length > 0 && (
            <div
              className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-primary/15 border border-primary/30 text-primary text-xs font-mono font-medium animate-pulse cursor-pointer"
              onClick={() => {
                // Both the free canvas and the simple page mount the results
                // dock, so only pages without it need to navigate.
                if (location.pathname !== "/" && location.pathname !== "/simple") {
                  navigate("/");
                }
              }}
              title={t("shell.app.activeQueueTitle")}
            >
              <Loader2Icon className="size-3 animate-spin" />
              <span>{t("shell.app.activeQueueCount", { count: activeTasks.length })}</span>
            </div>
          )}

          {/* Keyboard shortcuts help */}
          <button
            type="button"
            onClick={() => setShortcutsOpen(true)}
            className="hidden sm:inline-flex items-center justify-center size-8 rounded-xl bg-muted/60 hover:bg-muted border border-border text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
            title={t("shell.app.shortcutsTitle")}
            aria-label={t("shell.app.shortcutsTitle")}
          >
            <KeyboardIcon className="size-4" />
          </button>

          {/* Quick Command Palette Button */}
          <button
            type="button"
            onClick={togglePalette}
            className="hidden sm:inline-flex items-center gap-1.5 px-2 py-1 rounded-xl bg-muted/60 hover:bg-muted border border-border text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
            title={t("shell.app.commandPaletteTitle")}
          >
            <SearchIcon className="size-3.5" />
            <span className="text-[10px] font-mono font-semibold">⌘K</span>
          </button>

          {/* Language Toggle Button */}
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={() => changeLocale(currentLocale === "zh" ? "en" : "zh")}
            className="h-8 w-8 rounded-xl shrink-0 text-muted-foreground hover:text-foreground hover:bg-muted font-bold text-[10px]"
            title={t("shell.switchLanguage")}
          >
            {currentLocale === "zh" ? "EN" : "中"}
          </Button>

          {/* Theme Toggle Button */}
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={toggleTheme}
            className="h-8 w-8 rounded-xl shrink-0 text-muted-foreground hover:text-foreground hover:bg-muted"
            title={theme === "dark" ? t("shell.app.switchToLight") : t("shell.app.switchToDark")}
          >
            {theme === "dark" ? (
              <SunIcon className="size-4 text-amber-400" />
            ) : (
              <MoonIcon className="size-4 text-slate-600" />
            )}
          </Button>
        </div>
      </header>

      {/* 2. Main Viewport Stage (<Outlet />) */}
      <div className="relative flex-1 min-h-0 w-full overflow-hidden flex flex-col">
        <Outlet />
      </div>

      {/* Global Command Palette (Cmd + K) */}
      <CommandPalette />

      {/* Single shared large-image viewer */}
      <ImageLightbox />

      {/* Keyboard help for both canvases */}
      <KeyboardShortcutsDialog />

      {/* Global Toast System */}
      <Toaster richColors position="top-right" theme={theme === "light" ? "light" : "dark"} closeButton />
    </div>
  );
}
