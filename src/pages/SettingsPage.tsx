import React, { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import {
  BotIcon,
  CheckCircle2Icon,
  CheckIcon,
  DatabaseIcon,
  DownloadIcon,
  ExternalLinkIcon,
  EyeIcon,
  EyeOffIcon,
  FilterIcon,
  GlobeIcon,
  KeyIcon,
  LibraryBigIcon,
  Loader2Icon,
  PencilIcon,
  PlusIcon,
  RotateCcwIcon,
  ScanEyeIcon,
  SearchIcon,
  ServerIcon,
  Settings2Icon,
  SparklesIcon,
  Trash2Icon,
  UploadIcon,
  XCircleIcon,
} from "lucide-react";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Badge } from "../components/ui/badge";
import { Textarea } from "../components/ui/textarea";
import { Alert, AlertDescription, AlertTitle } from "../components/ui/alert";
import { ConfirmDialog } from "../components/ui/confirm-dialog";
import { useConfigStore } from "../stores/useConfigStore";
import { usePromptLibraryStore } from "../stores/usePromptLibraryStore";
import {
  ModelOption,
  fetchOnlineLlmModels,
  fetchOnlineModels,
  modelDisplayName,
  testImageServiceConnection,
} from "../services/imageService";
import { testLlmConnection } from "../services/llmAssistant";
import { serverFeatureEnabled } from "@/features/serverMode";
import { useServerStore } from "../stores/useServerStore";
import { useManagedConfigStore } from "../stores/useManagedConfigStore";
import { cn } from "@/utils/cn";

const validSections = ["image", "assistant", "server", "prompts", "network", "system"] as const;
type SettingsSection = (typeof validSections)[number];
const sectionFromHash = (hash: string): SettingsSection => {
  const value = hash.replace(/^#/, "") as SettingsSection;
  if (!validSections.includes(value)) return "image";
  // The server section only exists in the shared (optional-login) build.
  if (value === "server" && !serverFeatureEnabled) return "image";
  return value;
};

export function SettingsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();

  const {
    imageConfig,
    updateImageConfig,
    setSelectedModel,
    setFetchedModels,
    toggleModelEnabled,
    enableAllModels,
    disableAllModels,
    addCustomModel,
    removeModel,
    concurrencyLimit,
    setConcurrencyLimit,
    historyQuota,
    setHistoryQuota,
    corsProxy,
    corsProxyMode,
    setCorsProxy,
    setCorsProxyMode,
    llmConfig,
    updateLlmConfig,
    setLlmFetchedModels,
    exportConfig,
    importConfig,
    resetToDefaults,
  } = useConfigStore();

  const [activeNav, setActiveNav] = useState<SettingsSection>(() => sectionFromHash(location.hash));

  useEffect(() => {
    setActiveNav(sectionFromHash(location.hash));
  }, [location.hash]);

  const selectSection = (section: SettingsSection) => {
    setActiveNav(section);
    if (location.hash !== `#${section}`) {
      navigate({ pathname: location.pathname, search: location.search, hash: `#${section}` });
    }
  };
  const [showImageKey, setShowImageKey] = useState(false);
  const [showLlmKey, setShowLlmKey] = useState(false);

  const [modelSearch, setModelSearch] = useState("");
  const [showEnabledModelsOnly, setShowEnabledModelsOnly] = useState(false);
  const [newModelInput, setNewModelInput] = useState("");

  const [llmModelSearch, setLlmModelSearch] = useState("");
  const [newCustomLlmModelInput, setNewCustomLlmModelInput] = useState("");

  const [isTestingImage, setIsTestingImage] = useState(false);
  const [imageTestResult, setImageTestResult] = useState<{
    success: boolean;
    message: string;
  } | null>(null);
  const [imageModelsMessage, setImageModelsMessage] = useState<{
    success: boolean;
    message: string;
  } | null>(null);

  const [isFetchingModels, setIsFetchingModels] = useState(false);
  const [isFetchingLlmModels, setIsFetchingLlmModels] = useState(false);
  const [llmFetchMessage, setLlmFetchMessage] = useState<string | null>(null);

  const [isTestingLlm, setIsTestingLlm] = useState(false);
  const [llmTestResult, setLlmTestResult] = useState<{
    success: boolean;
    message: string;
  } | null>(null);

  // Shared server (optional-login build only)
  const serverHealth = useServerStore((s) => s.health);
  const serverHealthStatus = useServerStore((s) => s.healthStatus);
  const serverToken = useServerStore((s) => s.token);
  const serverTokenExp = useServerStore((s) => s.tokenExp);
  const serverManaged = serverFeatureEnabled && serverToken !== null;
  const managedConfig = useManagedConfigStore((s) => s.config);
  const managedStatus = useManagedConfigStore((s) => s.status);
  const managedError = useManagedConfigStore((s) => s.error);
  const loadManagedConfig = useManagedConfigStore((s) => s.load);
  const resetManagedConfig = useManagedConfigStore((s) => s.reset);
  const [serverUsername, setServerUsername] = useState("");
  const [serverPassword, setServerPassword] = useState("");
  const [serverLoginBusy, setServerLoginBusy] = useState(false);
  const [serverLoginResult, setServerLoginResult] = useState<{
    success: boolean;
    message: string;
  } | null>(null);

  // Re-probe the backend whenever its section is opened, so the status row
  // reflects the deployment as it is now, not as it was on app start.
  useEffect(() => {
    if (serverFeatureEnabled && activeNav === "server") {
      void useServerStore.getState().checkHealth();
    }
  }, [activeNav]);

  useEffect(() => {
    if (serverManaged) void loadManagedConfig();
  }, [serverManaged, loadManagedConfig]);

  // Managed sessions have no image/assistant settings. A stale bookmark falls
  // back to the account section instead of rendering a page with no controls.
  useEffect(() => {
    if (!serverManaged) return;
    if (activeNav !== "image" && activeNav !== "assistant") return;
    setActiveNav("server");
    if (location.hash !== "#server") {
      navigate(
        { pathname: location.pathname, search: location.search, hash: "#server" },
        { replace: true }
      );
    }
  }, [
    serverManaged,
    activeNav,
    location.pathname,
    location.search,
    location.hash,
    navigate,
  ]);

  const importFileRef = useRef<HTMLInputElement>(null);

  // Prompt library (user-built, no presets)
  const {
    entries: promptLibraryEntries,
    addEntry: addPromptLibraryEntry,
    updateEntry: updatePromptLibraryEntry,
    removeEntry: removePromptLibraryEntry,
  } = usePromptLibraryStore();
  const [newPromptTitle, setNewPromptTitle] = useState("");
  const [newPromptText, setNewPromptText] = useState("");
  const [editingPromptId, setEditingPromptId] = useState<string | null>(null);
  const [editingPromptTitle, setEditingPromptTitle] = useState("");
  const [editingPromptText, setEditingPromptText] = useState("");
  const [pendingPromptDelete, setPendingPromptDelete] = useState<{
    id: string;
    title: string;
  } | null>(null);
  const [confirmResetOpen, setConfirmResetOpen] = useState(false);
  const [pendingImport, setPendingImport] = useState<{
    text: string;
    fileName: string;
  } | null>(null);

  // Test Image Service Connection
  const handleTestImageService = async () => {
    const requestConfig = {
      apiBaseUrl: imageConfig.apiBaseUrl,
      apiKey: imageConfig.apiKey,
      corsProxy,
      corsProxyMode,
    };
    const isCurrentRequest = () => {
      const current = useConfigStore.getState();
      return current.imageConfig.apiBaseUrl === requestConfig.apiBaseUrl &&
        current.imageConfig.apiKey === requestConfig.apiKey &&
        current.corsProxy === requestConfig.corsProxy &&
        current.corsProxyMode === requestConfig.corsProxyMode;
    };
    setIsTestingImage(true);
    setImageTestResult(null);
    try {
      const res = await testImageServiceConnection(
        requestConfig.apiBaseUrl,
        requestConfig.apiKey,
        requestConfig.corsProxy,
        requestConfig.corsProxyMode
      );
      if (!isCurrentRequest()) return;
      setImageTestResult(res);
    } catch (e) {
      if (!isCurrentRequest()) return;
      setImageTestResult({
        success: false,
        message: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setIsTestingImage(false);
    }
  };

  // Fetch Models Online from /models
  const handleFetchModels = async () => {
    const requestConfig = {
      apiBaseUrl: imageConfig.apiBaseUrl,
      apiKey: imageConfig.apiKey,
      corsProxy,
      corsProxyMode,
    };
    const isCurrentRequest = () => {
      const current = useConfigStore.getState();
      return current.imageConfig.apiBaseUrl === requestConfig.apiBaseUrl &&
        current.imageConfig.apiKey === requestConfig.apiKey &&
        current.corsProxy === requestConfig.corsProxy &&
        current.corsProxyMode === requestConfig.corsProxyMode;
    };
    setIsFetchingModels(true);
    setImageModelsMessage(null);
    try {
      const onlineModels = await fetchOnlineModels(
        requestConfig.apiBaseUrl,
        requestConfig.apiKey,
        requestConfig.corsProxy,
        requestConfig.corsProxyMode
      );
      if (!isCurrentRequest()) return;
      setFetchedModels(onlineModels);
      setImageModelsMessage({
        success: true,
        message: t("settings.fetchModelsMessage", { count: onlineModels.length }),
      });
      toast.success(t("settings.fetchModelsSuccessToast", { count: onlineModels.length }));
    } catch (e) {
      if (!isCurrentRequest()) return;
      const msg = e instanceof Error ? e.message : String(e);
      setImageModelsMessage({ success: false, message: msg });
      toast.error(t("settings.fetchModelsFailed", { msg }));
    } finally {
      setIsFetchingModels(false);
    }
  };

  // Test LLM Connection (stream explicitly disabled)
  const handleTestLlm = async () => {
    const requestConfig = { ...llmConfig, corsProxy, corsProxyMode };
    const isCurrentRequest = () => {
      const current = useConfigStore.getState();
      return current.llmConfig.apiBaseUrl === requestConfig.apiBaseUrl &&
        current.llmConfig.apiKey === requestConfig.apiKey &&
        current.llmConfig.model === requestConfig.model &&
        current.corsProxy === requestConfig.corsProxy &&
        current.corsProxyMode === requestConfig.corsProxyMode;
    };
    setIsTestingLlm(true);
    setLlmTestResult(null);
    try {
      const res = await testLlmConnection(requestConfig);
      if (!isCurrentRequest()) return;
      setLlmTestResult(res);
      if (res.success) {
        toast.success(res.message);
      } else {
        toast.error(res.message);
      }
    } catch (e) {
      if (!isCurrentRequest()) return;
      const msg = t("settings.llmConnectionFailed", { msg: e instanceof Error ? e.message : String(e) });
      setLlmTestResult({ success: false, message: msg });
      toast.error(msg);
    } finally {
      setIsTestingLlm(false);
    }
  };

  // Fetch LLM Models Online
  const handleFetchLlmModels = async () => {
    setIsFetchingLlmModels(true);
    setLlmFetchMessage(null);
    try {
      const res = await fetchOnlineLlmModels(
        llmConfig.apiBaseUrl,
        llmConfig.apiKey,
        corsProxy,
        corsProxyMode
      );
      setLlmFetchedModels(res.textModels, res.visionModels);
      // Fill a default only when the user has not chosen a model yet.
      const latest = useConfigStore.getState().llmConfig;
      if (!latest.model && res.textModels.length > 0) {
        updateLlmConfig({ model: res.textModels[0].id });
      }
      if (!latest.visionModel && res.visionModels.length > 0) {
        updateLlmConfig({ visionModel: res.visionModels[0].id });
      }
      const successMsg = t("settings.fetchLlmModelsMessage", {
        textCount: res.textModels.length,
        visionCount: res.visionModels.length,
      });
      setLlmFetchMessage(successMsg);
      toast.success(successMsg);
    } catch (e) {
      toast.error(t("settings.fetchLlmModelsFailed", { msg: e instanceof Error ? e.message : String(e) }));
    } finally {
      setIsFetchingLlmModels(false);
    }
  };

  // Shared server login/logout
  const handleServerLogin = async () => {
    if (!serverUsername.trim() || !serverPassword || serverLoginBusy) return;
    setServerLoginBusy(true);
    setServerLoginResult(null);
    const result = await useServerStore.getState().login(serverUsername.trim(), serverPassword);
    if (result === "ok") {
      setServerPassword("");
      await loadManagedConfig();
      const merged =
        useManagedConfigStore.getState().config?.image.models.length ?? 0;
      setServerLoginResult({
        success: true,
        message:
          merged > 0
            ? t("settings.server.loginOkWithModels", { count: merged })
            : t("settings.server.loginOk"),
      });
    } else if (result === "invalid") {
      setServerLoginResult({ success: false, message: t("settings.server.invalidCredentials") });
    } else {
      setServerLoginResult({ success: false, message: t("settings.server.unreachable") });
    }
    setServerLoginBusy(false);
  };

  const handleServerLogout = () => {
    useServerStore.getState().logout();
    resetManagedConfig();
    setServerLoginResult(null);
  };

  // Add custom manual model
  const handleAddCustomModel = () => {
    const trimmed = newModelInput.trim();
    if (!trimmed) return;
    addCustomModel({
      id: trimmed,
      name: trimmed,
      ownedBy: "custom",
    });
    setNewModelInput("");
    toast.success(t("settings.modelAddedToast", { model: trimmed }));
  };

  // Export JSON
  const handleExport = () => {
    const json = exportConfig();
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `universal-playground-config-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(t("settings.exportSuccessToast"));
  };

  // Import JSON. The file is read first and applied only after an explicit
  // confirmation: it overwrites every provider/assistant config and API key.
  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    try {
      const text = await file.text();
      setPendingImport({ text, fileName: file.name });
    } catch (err) {
      toast.error(t("settings.importFailed", { msg: err instanceof Error ? err.message : String(err) }));
    }
  };

  const confirmImportConfig = () => {
    if (!pendingImport) return;
    const { text } = pendingImport;
    setPendingImport(null);
    try {
      importConfig(text);
      toast.success(t("settings.importSuccessToast"));
    } catch (err) {
      toast.error(t("settings.importFailed", { msg: err instanceof Error ? err.message : String(err) }));
    }
  };

  // Enabled models that still exist in the library. Stale ids (removed models,
  // imported configs) would otherwise inflate the count without a matching card.
  const enabledModelIds = new Set(imageConfig.enabledModelIds);
  const enabledModelCount = imageConfig.models.filter((m) => enabledModelIds.has(m.id)).length;
  const noEnabledModels = showEnabledModelsOnly && enabledModelCount === 0;

  // Direct search models without grouping, optionally limited to enabled ones.
  const filteredModels = imageConfig.models.filter((m) => {
    if (showEnabledModelsOnly && !enabledModelIds.has(m.id)) return false;
    if (!modelSearch.trim()) return true;
    const query = modelSearch.toLowerCase();
    return (
      m.id.toLowerCase().includes(query) ||
      (m.name && m.name.toLowerCase().includes(query)) ||
      (m.ownedBy && m.ownedBy.toLowerCase().includes(query))
    );
  });

  // Fallback presets if no online models have been fetched yet
  const getFallbackLlmModels = (): ModelOption[] =>
    [
      { id: "gpt-4o-mini", category: "chat", capabilityTags: ["Text", "Vision"] },
      { id: "gpt-4o", category: "chat", capabilityTags: ["Text", "Vision", "Multimodal"] },
      { id: "deepseek-chat", category: "chat", capabilityTags: ["Text"] },
      { id: "claude-3-5-sonnet", category: "chat", capabilityTags: ["Text", "Vision"] },
      { id: "gemini-2.0-flash", category: "chat", capabilityTags: ["Text", "Vision"] },
      { id: "qwen-vl-max", category: "vision", capabilityTags: ["Vision"] },
    ].map((m) => ({
      ...m,
      name: t(`settings.fallbackModels.${m.id}`),
    }));

  // LLM Models aggregation
  const rawLlmModels: ModelOption[] = (() => {
    const list: ModelOption[] = [];
    const seen = new Set<string>();

    const add = (m: ModelOption) => {
      if (!seen.has(m.id)) {
        seen.add(m.id);
        list.push(m);
      }
    };

    const available = [
      ...(llmConfig.availableModels || []),
      ...(llmConfig.availableVisionModels || []),
    ];

    if (available.length > 0) {
      available.forEach(add);
    } else {
      getFallbackLlmModels().forEach(add);
    }

    if (llmConfig.model && !seen.has(llmConfig.model)) {
      add({ id: llmConfig.model, name: llmConfig.model, ownedBy: "custom" });
    }
    if (llmConfig.visionModel && !seen.has(llmConfig.visionModel)) {
      add({ id: llmConfig.visionModel, name: llmConfig.visionModel, ownedBy: "custom" });
    }

    return list;
  })();

  const filteredLlmModels = rawLlmModels.filter((m) => {
    if (!llmModelSearch.trim()) return true;
    const query = llmModelSearch.toLowerCase();
    return (
      m.id.toLowerCase().includes(query) ||
      (m.name && m.name.toLowerCase().includes(query)) ||
      (m.ownedBy && m.ownedBy.toLowerCase().includes(query)) ||
      (m.category && m.category.toLowerCase().includes(query))
    );
  });

  // Add custom manual LLM model
  const handleAddCustomLlmModel = () => {
    const trimmed = newCustomLlmModelInput.trim();
    if (!trimmed) return;
    const newModel: ModelOption = {
      id: trimmed,
      name: trimmed,
      ownedBy: "custom",
    };
    const currentText = llmConfig.availableModels || [];
    const currentVision = llmConfig.availableVisionModels || [];
    setLlmFetchedModels(
      currentText.some((m) => m.id === trimmed) ? currentText : [...currentText, newModel],
      currentVision.some((m) => m.id === trimmed) ? currentVision : [...currentVision, newModel]
    );
    setNewCustomLlmModelInput("");
  };

  // Prompt library: add / edit / remove
  const handleAddPromptLibraryEntry = () => {
    const entry = addPromptLibraryEntry(newPromptTitle, newPromptText);
    if (!entry) return;
    setNewPromptTitle("");
    setNewPromptText("");
    toast.success(t("settings.prompts.addedToast", { title: entry.title }));
  };

  const startEditPromptLibraryEntry = (id: string, title: string, prompt: string) => {
    setEditingPromptId(id);
    setEditingPromptTitle(title);
    setEditingPromptText(prompt);
  };

  const handleSavePromptLibraryEntry = () => {
    if (!editingPromptId) return;
    if (!editingPromptTitle.trim() || !editingPromptText.trim()) {
      toast.warning(t("settings.prompts.requiredFields"));
      return;
    }
    updatePromptLibraryEntry(editingPromptId, {
      title: editingPromptTitle,
      prompt: editingPromptText,
    });
    setEditingPromptId(null);
    toast.success(t("settings.prompts.updatedToast"));
  };

  const handleRemovePromptLibraryEntry = (id: string, title: string) => {
    // Confirmation is rendered by the app's own ConfirmDialog instead of a
    // native window.confirm so it follows the current theme and traps focus.
    setPendingPromptDelete({ id, title });
  };

  const confirmPromptLibraryDelete = () => {
    if (!pendingPromptDelete) return;
    const { id, title } = pendingPromptDelete;
    removePromptLibraryEntry(id);
    if (editingPromptId === id) setEditingPromptId(null);
    setPendingPromptDelete(null);
    toast.success(t("settings.prompts.deletedToast", { title }));
  };

  const handleResetAll = () => {
    setConfirmResetOpen(false);
    resetToDefaults();
    toast.success(t("settings.system.resetDone"));
  };

  return (
    <div className="flex-1 w-full h-full overflow-y-auto bg-background text-foreground flex flex-col font-sans select-none">
      {/* Settings Sub-Header Banner */}
      <div className="w-full border-b border-border bg-background/80 backdrop-blur-xl px-3 sm:px-6 py-3.5 shrink-0">
        <div className="max-w-6xl mx-auto flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="size-8 rounded-xl bg-gradient-to-tr from-primary to-blue-500 flex items-center justify-center text-white shadow-md shadow-primary/20 shrink-0">
              <Settings2Icon className="size-4" />
            </div>
            <div>
              <h1 className="text-sm font-extrabold text-foreground tracking-tight">
                {t("settings.title")}
              </h1>
              <p className="text-[11px] text-muted-foreground">
                {t("settings.subtitle")}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Badge variant="outline" className="hidden sm:inline-flex text-[11px] font-mono py-0.5 h-6 bg-muted/50 text-muted-foreground border-border">
              {t("settings.openaiCompatibleBadge")}
            </Badge>
          </div>
        </div>
      </div>

      {/* Main Content Layout */}
      <div className="flex-1 w-full max-w-6xl mx-auto px-3 sm:px-6 py-4 md:py-8 flex flex-col md:flex-row gap-4 md:gap-8 items-start">
        {/* Left Navigation Sidebar */}
        <aside aria-label={t("settings.navAriaLabel")} className="w-full md:w-60 shrink-0 sticky top-0 md:top-20 flex flex-row md:flex-col gap-1.5 overflow-x-auto no-scrollbar">
          {!serverManaged && (
          <button
            type="button"
            aria-current={activeNav === "image" ? "page" : undefined}
            onClick={() => selectSection("image")}
            className={cn(
              "w-auto md:w-full flex items-center gap-2 md:gap-3 px-3 md:px-4 py-2.5 rounded-2xl text-xs font-semibold transition-all text-left cursor-pointer shrink-0",
              activeNav === "image"
                ? "bg-primary text-primary-foreground font-bold shadow-md shadow-primary/10"
                : "text-muted-foreground hover:text-foreground hover:bg-muted"
            )}
          >
            <SparklesIcon className={cn("size-4 shrink-0", activeNav === "image" ? "text-primary" : "")} />
            <div className="flex-1 min-w-0">
              <div className="leading-tight">{t("settings.nav.image")}</div>
              <div className={cn("hidden md:block text-[11px] truncate mt-0.5", activeNav === "image" ? "text-primary-foreground/70 font-medium" : "text-muted-foreground")}>
                {t("settings.nav.imageDesc")}
              </div>
            </div>
          </button>
          )}

          {!serverManaged && (
          <button
            type="button"
            aria-current={activeNav === "assistant" ? "page" : undefined}
            onClick={() => selectSection("assistant")}
            className={cn(
              "w-auto md:w-full flex items-center gap-2 md:gap-3 px-3 md:px-4 py-2.5 rounded-2xl text-xs font-semibold transition-all text-left cursor-pointer shrink-0",
              activeNav === "assistant"
                ? "bg-primary text-primary-foreground font-bold shadow-md shadow-primary/10"
                : "text-muted-foreground hover:text-foreground hover:bg-muted"
            )}
          >
            <BotIcon className={cn("size-4 shrink-0", activeNav === "assistant" ? "text-primary" : "")} />
            <div className="flex-1 min-w-0">
              <div className="leading-tight">{t("settings.nav.assistant")}</div>
              <div className={cn("hidden md:block text-[11px] truncate mt-0.5", activeNav === "assistant" ? "text-primary-foreground/70 font-medium" : "text-muted-foreground")}>
                {t("settings.nav.assistantDesc")}
              </div>
            </div>
          </button>
          )}

          <button
            type="button"
            aria-current={activeNav === "prompts" ? "page" : undefined}
            onClick={() => selectSection("prompts")}
            className={cn(
              "w-auto md:w-full flex items-center gap-2 md:gap-3 px-3 md:px-4 py-2.5 rounded-2xl text-xs font-semibold transition-all text-left cursor-pointer shrink-0",
              activeNav === "prompts"
                ? "bg-primary text-primary-foreground font-bold shadow-md shadow-primary/10"
                : "text-muted-foreground hover:text-foreground hover:bg-muted"
            )}
          >
            <LibraryBigIcon className={cn("size-4 shrink-0", activeNav === "prompts" ? "text-primary" : "")} />
            <div className="flex-1 min-w-0">
              <div className="leading-tight">{t("settings.nav.prompts")}</div>
              <div className={cn("hidden md:block text-[11px] truncate mt-0.5", activeNav === "prompts" ? "text-primary-foreground/70 font-medium" : "text-muted-foreground")}>
                {t("settings.nav.promptsDesc")}
              </div>
            </div>
          </button>

          <button
            type="button"
            aria-current={activeNav === "network" ? "page" : undefined}
            onClick={() => selectSection("network")}
            className={cn(
              "w-auto md:w-full flex items-center gap-2 md:gap-3 px-3 md:px-4 py-2.5 rounded-2xl text-xs font-semibold transition-all text-left cursor-pointer shrink-0",
              activeNav === "network"
                ? "bg-primary text-primary-foreground font-bold shadow-md shadow-primary/10"
                : "text-muted-foreground hover:text-foreground hover:bg-muted"
            )}
          >
            <GlobeIcon className={cn("size-4 shrink-0", activeNav === "network" ? "text-primary" : "")} />
            <div className="flex-1 min-w-0">
              <div className="leading-tight">{t("settings.nav.network")}</div>
              <div className={cn("hidden md:block text-[11px] truncate mt-0.5", activeNav === "network" ? "text-primary-foreground/70 font-medium" : "text-muted-foreground")}>
                {t("settings.nav.networkDesc")}
              </div>
            </div>
          </button>

          <button
            type="button"
            aria-current={activeNav === "system" ? "page" : undefined}
            onClick={() => selectSection("system")}
            className={cn(
              "w-auto md:w-full flex items-center gap-2 md:gap-3 px-3 md:px-4 py-2.5 rounded-2xl text-xs font-semibold transition-all text-left cursor-pointer shrink-0",
              activeNav === "system"
                ? "bg-primary text-primary-foreground font-bold shadow-md shadow-primary/10"
                : "text-muted-foreground hover:text-foreground hover:bg-muted"
            )}
          >
            <DatabaseIcon className={cn("size-4 shrink-0", activeNav === "system" ? "text-primary" : "")} />
            <div className="flex-1 min-w-0">
              <div className="leading-tight">{t("settings.nav.system")}</div>
              <div className={cn("hidden md:block text-[11px] truncate mt-0.5", activeNav === "system" ? "text-primary-foreground/70 font-medium" : "text-muted-foreground")}>
                {t("settings.nav.systemDesc")}
              </div>
            </div>
          </button>

          {serverFeatureEnabled && (
            <button
              type="button"
              aria-current={activeNav === "server" ? "page" : undefined}
              onClick={() => selectSection("server")}
              className={cn(
                "w-auto md:w-full flex items-center gap-2 md:gap-3 px-3 md:px-4 py-2.5 rounded-2xl text-xs font-semibold transition-all text-left cursor-pointer shrink-0",
                activeNav === "server"
                  ? "bg-primary text-primary-foreground font-bold shadow-md shadow-primary/10"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted"
              )}
            >
              <ServerIcon className={cn("size-4 shrink-0", activeNav === "server" ? "text-primary" : "")} />
              <div className="flex-1 min-w-0">
                <div className="leading-tight">{t("settings.nav.server")}</div>
                <div className={cn("hidden md:block text-[11px] truncate mt-0.5", activeNav === "server" ? "text-primary-foreground/70 font-medium" : "text-muted-foreground")}>
                  {t("settings.nav.serverDesc")}
                </div>
              </div>
            </button>
          )}
        </aside>

        {/* Right Content Area */}
        <main className="flex-1 min-w-0 w-full space-y-8">
          {/* 1. Image Generation Section */}
          {activeNav === "image" && !serverManaged && (
            <div className="space-y-6">
              {/* Endpoint Card */}
              <div className="p-4 sm:p-6 rounded-3xl bg-card/80 border border-border space-y-5 shadow-xl">
                <div>
                  <h2 className="text-base font-bold text-foreground flex items-center gap-2">
                    <span>{t("settings.image.endpointTitle")}</span>
                    <Badge variant="outline" className="text-[10px] bg-primary/10 border-primary/30 text-primary">
                      {t("settings.image.endpointBadge")}
                    </Badge>
                  </h2>
                  <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                    {t("settings.image.endpointDesc")}
                  </p>
                </div>

                {/* API Base URL */}
                <div className="space-y-2">
                  <Label className="text-xs text-foreground font-semibold">
                    {t("settings.image.apiBaseUrlLabel")}
                  </Label>
                  <Input
                    value={imageConfig.apiBaseUrl}
                    onChange={(e) => {
                      updateImageConfig({ apiBaseUrl: e.target.value.trim() });
                      setImageTestResult(null);
                      setImageModelsMessage(null);
                    }}
                    placeholder="https://api.openai.com/v1"
                    className="h-10 bg-background border-border text-xs font-mono"
                  />
                  <p className="text-xs text-muted-foreground">
                    {t("settings.image.apiBaseUrlHint")}
                  </p>
                </div>

                {/* API Key */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs text-foreground font-semibold flex items-center gap-1.5">
                      <KeyIcon className="size-3.5 text-primary" />
                      <span>{t("settings.image.apiKeyLabel")}</span>
                    </Label>
                    <button
                      type="button"
                      className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 cursor-pointer"
                      onClick={() => setShowImageKey(!showImageKey)}
                    >
                      {showImageKey ? (
                        <>
                          <EyeOffIcon className="size-3.5" />
                          <span>{t("settings.image.hideKey")}</span>
                        </>
                      ) : (
                        <>
                          <EyeIcon className="size-3.5" />
                          <span>{t("settings.image.showKey")}</span>
                        </>
                      )}
                    </button>
                  </div>
                  <Input
                    type={showImageKey ? "text" : "password"}
                    value={imageConfig.apiKey}
                    onChange={(e) => {
                      updateImageConfig({ apiKey: e.target.value.trim() });
                      setImageTestResult(null);
                      setImageModelsMessage(null);
                    }}
                    placeholder="sk-..."
                    className="h-10 bg-background border-border text-xs font-mono"
                  />
                </div>

                {/* Actions: Test + Fetch Models */}
                <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-border">
                  <div className="flex items-center gap-2.5">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={isTestingImage || !imageConfig.apiKey}
                      onClick={handleTestImageService}
                      className="h-9 px-4 text-xs border-border bg-muted/40 hover:bg-muted text-foreground"
                    >
                      {isTestingImage ? (
                        <Loader2Icon className="size-3.5 animate-spin mr-1.5" />
                      ) : imageTestResult?.success ? (
                        <CheckCircle2Icon className="size-3.5 text-emerald-400 mr-1.5" />
                      ) : imageTestResult?.success === false ? (
                        <XCircleIcon className="size-3.5 text-destructive mr-1.5" />
                      ) : (
                        <GlobeIcon className="size-3.5 mr-1.5" />
                      )}
                      <span>{t("settings.image.testConnection")}</span>
                    </Button>

                    <Button
                      size="sm"
                      disabled={isFetchingModels || !imageConfig.apiKey}
                      onClick={handleFetchModels}
                      className="h-9 px-4 text-xs bg-primary hover:bg-primary/90 text-zinc-950 font-bold shadow-md shadow-primary/20"
                    >
                      {isFetchingModels ? (
                        <Loader2Icon className="size-3.5 animate-spin mr-1.5" />
                      ) : (
                        <RotateCcwIcon className="size-3.5 mr-1.5" />
                      )}
                      <span>{t("settings.image.fetchModels")}</span>
                    </Button>
                  </div>

                  <a
                    href="https://platform.openai.com/docs/api-reference/images"
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-primary font-medium hover:underline inline-flex items-center gap-1"
                  >
                    <span>{t("settings.image.openaiDocs")}</span>
                    <ExternalLinkIcon className="size-3" />
                  </a>
                </div>

                {/* Connection Test Result Alert */}
                {imageTestResult && (
                  <Alert
                    variant={imageTestResult.success ? "success" : "destructive"}
                    className="py-2.5 text-xs"
                  >
                    <AlertTitle className="font-bold flex items-center gap-1.5">
                      {imageTestResult.success ? (
                        <CheckCircle2Icon className="size-4 text-emerald-400" />
                      ) : (
                        <XCircleIcon className="size-4 text-destructive" />
                      )}
                      <span>{imageTestResult.success ? t("settings.image.connectionPassed") : t("settings.image.connectionFailed")}</span>
                    </AlertTitle>
                    <AlertDescription className="text-xs mt-1 leading-relaxed">
                      {imageTestResult.message}
                    </AlertDescription>
                  </Alert>
                )}
                {imageModelsMessage && (
                  <Alert
                    variant={imageModelsMessage.success ? "info" : "destructive"}
                    className="py-2.5 text-xs"
                  >
                    <AlertTitle className="font-bold flex items-center gap-1.5">
                      {imageModelsMessage.success ? (
                        <CheckCircle2Icon className="size-4 text-blue-400" />
                      ) : (
                        <XCircleIcon className="size-4 text-destructive" />
                      )}
                      <span>{imageModelsMessage.success ? t("settings.image.modelsUpdated") : t("settings.image.modelsFetchFailed")}</span>
                    </AlertTitle>
                    <AlertDescription className="text-xs mt-1 leading-relaxed">
                      {imageModelsMessage.message}
                    </AlertDescription>
                  </Alert>
                )}
              </div>

              {/* Models Curation Section */}
              <div className="p-4 sm:p-6 rounded-3xl bg-card/80 border border-border space-y-5 shadow-xl">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="text-base font-bold text-foreground flex flex-wrap items-center gap-2.5">
                      <span>{t("settings.image.modelsTitle")}</span>
                      <Badge variant="outline" className="text-xs text-muted-foreground border-border bg-muted/40 font-mono shrink-0 whitespace-nowrap">
                        {t("settings.image.modelsBadge", {
                          active: enabledModelCount,
                          total: imageConfig.models.length,
                        })}
                      </Badge>
                    </h2>
                    <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                      {t("settings.image.modelsDesc")}
                    </p>
                  </div>

                  {/* Filter + Batch Controls */}
                  <div className="flex flex-wrap items-center gap-1.5 text-xs">
                    <button
                      type="button"
                      aria-pressed={showEnabledModelsOnly}
                      onClick={() => setShowEnabledModelsOnly((value) => !value)}
                      title={t("settings.image.filterEnabledTitle")}
                      className={cn(
                        "inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-full border px-2.5 text-[11px] font-medium transition-colors",
                        showEnabledModelsOnly
                          ? "border-primary/50 bg-primary/15 text-primary"
                          : "border-border bg-muted/40 text-muted-foreground hover:text-foreground"
                      )}
                    >
                      <FilterIcon className="size-3" />
                      <span>
                        {t("settings.image.filterEnabled", { active: enabledModelCount })}
                      </span>
                    </button>
                    <span aria-hidden="true" className="mx-0.5 h-4 w-px bg-border" />
                    <Button
                      size="xs"
                      variant="ghost"
                      onClick={() => enableAllModels()}
                      className="h-7 text-muted-foreground hover:text-foreground text-xs"
                    >
                      {t("settings.image.enableAll")}
                    </Button>
                    <Button
                      size="xs"
                      variant="ghost"
                      onClick={() => disableAllModels()}
                      className="h-7 text-muted-foreground hover:text-foreground text-xs"
                    >
                      {t("settings.image.disableAll")}
                    </Button>
                  </div>
                </div>

                {/* Direct Search Bar + Manual Add */}
                <div className="flex flex-col sm:flex-row items-center gap-3">
                  <div className="relative flex-1 w-full">
                    <SearchIcon className="absolute left-3.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                    <Input
                      value={modelSearch}
                      onChange={(e) => setModelSearch(e.target.value)}
                      placeholder={t("settings.image.modelSearchPlaceholder")}
                      className="h-10 pl-10 pr-9 text-xs bg-background border-border rounded-xl"
                    />
                    {modelSearch && (
                      <button
                        type="button"
                        onClick={() => setModelSearch("")}
                        className="absolute right-3 top-1/2 -translate-y-1/2 size-4 rounded-full text-muted-foreground hover:text-foreground flex items-center justify-center cursor-pointer"
                        title={t("settings.clearSearch")}
                      >
                        <XCircleIcon className="size-3.5" />
                      </button>
                    )}
                  </div>

                  {/* Manual custom model add */}
                  <div className="flex items-center gap-2 shrink-0 w-full sm:w-auto">
                    <Input
                      value={newModelInput}
                      onChange={(e) => setNewModelInput(e.target.value)}
                      placeholder={t("settings.image.addModelPlaceholder")}
                      className="h-10 w-full sm:w-48 text-xs font-mono bg-background border-border rounded-xl"
                      onKeyDown={(e) => e.key === "Enter" && handleAddCustomModel()}
                    />
                    <Button
                      size="sm"
                      onClick={handleAddCustomModel}
                      disabled={!newModelInput.trim()}
                      className="h-10 px-3.5 text-xs rounded-xl bg-secondary hover:bg-secondary/80 border border-border text-secondary-foreground shrink-0 cursor-pointer"
                    >
                      <PlusIcon className="size-3.5 mr-1" />
                      <span>{t("common.add")}</span>
                    </Button>
                  </div>
                </div>

                {/* Models Grid Cards: flow with the page instead of a nested
                    scroll box, so every enabled model stays reachable. */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                  {filteredModels.length === 0 && (
                    <div className="md:col-span-2 rounded-2xl border border-dashed border-border p-6 text-center">
                      {imageConfig.models.length === 0 ? (
                        <>
                          <p className="text-sm font-semibold text-foreground">
                            {t("settings.image.modelsEmptyTitle")}
                          </p>
                          <p className="text-xs text-muted-foreground mt-1">
                            {t("settings.image.modelsEmptyDesc")}
                          </p>
                        </>
                      ) : (
                        <>
                          <p className="text-sm font-semibold text-foreground">
                            {noEnabledModels
                              ? t("settings.image.noEnabledTitle")
                              : t("settings.image.noMatchTitle")}
                          </p>
                          <p className="text-xs text-muted-foreground mt-1">
                            {noEnabledModels
                              ? t("settings.image.noEnabledDesc")
                              : t("settings.image.noMatchDesc")}
                          </p>
                          <Button
                            size="sm"
                            variant="outline"
                            className="mt-3 h-8 px-3 text-xs"
                            onClick={() => {
                              setShowEnabledModelsOnly(false);
                              setModelSearch("");
                            }}
                          >
                            {noEnabledModels
                              ? t("settings.image.showAllModels")
                              : t("settings.image.clearFilters")}
                          </Button>
                        </>
                      )}
                    </div>
                  )}
                  {filteredModels.map((m) => {
                    const isEnabled = imageConfig.enabledModelIds.includes(m.id);
                    const isSelectedDefault = imageConfig.selectedModel === m.id;

                    return (
                      <div
                        key={m.id}
                        onClick={() => toggleModelEnabled(m.id)}
                        className={cn(
                          "flex items-center justify-between p-3.5 rounded-2xl border transition-all cursor-pointer select-none",
                          isEnabled
                            ? "bg-muted border-primary/40 shadow-xs hover:border-primary/70"
                            : "bg-background border-border opacity-60 hover:opacity-100 hover:border-primary/30"
                        )}
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          {/* Big Checkbox */}
                          <div
                            className={cn(
                              "size-5 rounded-lg border flex items-center justify-center shrink-0 transition-colors",
                              isEnabled
                                ? "bg-primary border-primary text-zinc-950"
                                : "border-border bg-background"
                            )}
                          >
                            {isEnabled && <CheckIcon className="size-3.5 stroke-[3]" />}
                          </div>

                          <div className="flex flex-col min-w-0">
                            <span className="text-xs font-mono font-bold text-foreground truncate">
                              {modelDisplayName(m)}
                            </span>
                            <span className="text-[11px] text-muted-foreground font-mono truncate mt-0.5">
                              {m.id}
                            </span>
                          </div>
                        </div>

                        {/* Badges & Actions */}
                        <div className="flex items-center gap-2 shrink-0 ml-2">
                          {m.ownedBy && (
                            <span className="text-[10px] px-2 py-0.5 rounded-md bg-muted text-muted-foreground font-mono border border-border">
                              {m.ownedBy}
                            </span>
                          )}

                          {isSelectedDefault ? (
                            <Badge className="text-[10px] h-6 bg-blue-500/20 text-blue-600 dark:text-blue-300 border-blue-400/40">
                              {t("settings.image.currentDefault")}
                            </Badge>
                          ) : (
                            isEnabled && (
                              <button
                                type="button"
                                className="text-xs text-muted-foreground hover:text-foreground px-2 py-1 rounded-lg hover:bg-muted transition-colors"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setSelectedModel(m.id);
                                }}
                                title={t("settings.image.setDefaultTitle")}
                              >
                                {t("settings.image.setDefault")}
                              </button>
                            )
                          )}

                          {/* Delete any model (no built-in catalog anymore) */}
                          <button
                            type="button"
                            className="size-6 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 flex items-center justify-center transition-colors"
                            onClick={(e) => {
                              e.stopPropagation();
                              removeModel(m.id);
                            }}
                            title={t("settings.image.removeModelTitle")}
                          >
                            <Trash2Icon className="size-3.5" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* 2. Creative LLM Assistant Section */}
          {activeNav === "assistant" && !serverManaged && (
            <div className="flex-1 w-full space-y-6">
              <div className="p-4 sm:p-6 rounded-3xl bg-card/80 border border-border space-y-6 shadow-xl">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-base font-bold text-foreground flex items-center gap-2">
                    <SparklesIcon className="size-4 text-amber-400" />
                    <span>{t("settings.assistant.title")}</span>
                  </h2>
                  <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                    {t("settings.assistant.descPrefix")}
                    <strong>{t("settings.assistant.polishAction")}</strong>
                    {t("settings.assistant.descSep1")}
                    <strong>{t("settings.assistant.translateAction")}</strong>
                    {t("settings.assistant.descSep2")}
                    <strong>{t("settings.assistant.visionAction")}</strong>
                    {t("settings.assistant.descSuffix")}
                  </p>
                </div>
              </div>

              {/* LLM Endpoint */}
              <div className="space-y-2">
                <Label className="text-xs text-foreground font-semibold">
                  {t("settings.assistant.llmBaseUrlLabel")}
                </Label>
                  <Input
                    value={llmConfig.apiBaseUrl}
                    onChange={(e) => {
                      updateLlmConfig({ apiBaseUrl: e.target.value.trim() });
                      setLlmTestResult(null);
                    }}
                    placeholder="https://api.openai.com/v1"
                    className="h-10 bg-background border-border text-xs font-mono"
                  />
              </div>

              {/* LLM API Key */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs text-foreground font-semibold flex items-center gap-1.5">
                    <KeyIcon className="size-3.5 text-amber-400" />
                    <span>{t("settings.assistant.llmApiKeyLabel")}</span>
                  </Label>
                  <button
                    type="button"
                    className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 cursor-pointer"
                    onClick={() => setShowLlmKey(!showLlmKey)}
                  >
                    {showLlmKey ? (
                      <>
                        <EyeOffIcon className="size-3.5" />
                        <span>{t("settings.assistant.hide")}</span>
                      </>
                    ) : (
                      <>
                        <EyeIcon className="size-3.5" />
                        <span>{t("settings.assistant.show")}</span>
                      </>
                    )}
                  </button>
                </div>
                  <Input
                    type={showLlmKey ? "text" : "password"}
                    value={llmConfig.apiKey}
                    onChange={(e) => {
                      updateLlmConfig({ apiKey: e.target.value.trim() });
                      setLlmTestResult(null);
                    }}
                    placeholder="sk-..."
                    className="h-10 bg-background border-border text-xs font-mono"
                  />
              </div>

              {/* Current Active LLM Selection Summary */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="p-3.5 rounded-2xl bg-card border border-primary/30 flex items-center justify-between">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="size-8 rounded-xl bg-primary/20 border border-primary/30 flex items-center justify-center text-primary shrink-0">
                      <SparklesIcon className="size-4" />
                    </div>
                    <div className="min-w-0">
                      <div className="text-[11px] text-muted-foreground">{t("settings.assistant.currentTextModel")}</div>
                      <div className="text-xs font-mono font-bold text-foreground truncate">
                        {llmConfig.model || t("settings.assistant.unspecified")}
                      </div>
                    </div>
                  </div>
                  <Badge variant="outline" className="text-[10px] bg-primary/15 text-primary border-primary/30 shrink-0">
                    {t("settings.assistant.activeBadge")}
                  </Badge>
                </div>

                  <div className="p-3.5 rounded-2xl bg-card border border-emerald-500/30 flex items-center justify-between">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="size-8 rounded-xl bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center text-emerald-400 shrink-0">
                      <ScanEyeIcon className="size-4" />
                    </div>
                    <div className="min-w-0">
                      <div className="text-[11px] text-muted-foreground">{t("settings.assistant.currentVisionModel")}</div>
                      <div className="text-xs font-mono font-bold text-foreground truncate">
                        {llmConfig.visionModel || t("settings.assistant.unspecified")}
                      </div>
                    </div>
                  </div>
                  <Badge variant="outline" className="text-[10px] bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30 shrink-0">
                    {t("settings.assistant.activeBadge")}
                  </Badge>
                </div>
              </div>

              {/* Action buttons: Pull Models + Ping Test */}
              <div className="pt-3 border-t border-border flex flex-wrap items-center justify-between gap-3">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={isFetchingLlmModels}
                  onClick={handleFetchLlmModels}
                  className="h-9 px-4 text-xs border-primary/30 bg-primary/10 hover:bg-primary/20 text-primary cursor-pointer"
                  title={t("settings.assistant.fetchModelsTitle")}
                >
                  {isFetchingLlmModels ? (
                    <Loader2Icon className="size-3.5 animate-spin mr-1.5" />
                  ) : (
                    <RotateCcwIcon className="size-3.5 mr-1.5" />
                  )}
                  <span>{t("settings.assistant.fetchModels")}</span>
                </Button>

                <Button
                  size="sm"
                  variant="outline"
                  disabled={isTestingLlm || !llmConfig.apiKey}
                  onClick={handleTestLlm}
                  className="h-9 px-4 text-xs border-border bg-muted/40 hover:bg-muted text-foreground cursor-pointer"
                >
                  {isTestingLlm ? (
                    <Loader2Icon className="size-3.5 animate-spin mr-1.5" />
                  ) : llmTestResult?.success ? (
                    <CheckCircle2Icon className="size-3.5 text-emerald-400 mr-1.5" />
                  ) : llmTestResult?.success === false ? (
                    <XCircleIcon className="size-3.5 text-destructive mr-1.5" />
                  ) : (
                    <GlobeIcon className="size-3.5 mr-1.5" />
                  )}
                  <span>{t("settings.assistant.testConnection")}</span>
                </Button>
              </div>

              {llmFetchMessage && (
                <div className="p-3 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-600 dark:text-emerald-300 text-xs flex items-center gap-2">
                  <CheckCircle2Icon className="size-4 shrink-0 text-emerald-400" />
                  <span>{llmFetchMessage}</span>
                </div>
              )}

              {llmTestResult && (
                <Alert
                  variant={llmTestResult.success ? "success" : "destructive"}
                  className="py-2.5 text-xs"
                >
                  <AlertTitle className="font-bold flex items-center gap-1.5">
                    {llmTestResult.success ? (
                      <CheckCircle2Icon className="size-4 text-emerald-400" />
                    ) : (
                      <XCircleIcon className="size-4 text-destructive" />
                    )}
                    <span>{llmTestResult.success ? t("settings.assistant.connectionOk") : t("settings.assistant.testFailed")}</span>
                  </AlertTitle>
                  <AlertDescription className="text-xs mt-1 leading-relaxed">
                    {llmTestResult.message}
                  </AlertDescription>
                </Alert>
              )}
            </div>

            {/* Visual Searchable Card Model Selector for LLM */}
            <div className="p-4 sm:p-6 rounded-3xl bg-card/80 border border-border space-y-5 shadow-xl">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-base font-bold text-foreground flex items-center gap-2.5">
                    <span>{t("settings.assistant.modelsTitle")}</span>
                    <Badge variant="outline" className="text-xs text-muted-foreground border-border bg-muted/40 font-mono">
                      {t("settings.assistant.modelsBadge", { count: rawLlmModels.length })}
                    </Badge>
                  </h2>
                  <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                    {t("settings.assistant.modelsDescPrefix")}
                    <strong>{t("settings.assistant.textModelLabel")}</strong>
                    {t("settings.assistant.modelsDescSep")}
                    <strong>{t("settings.assistant.visionModelLabel")}</strong>
                    {t("settings.assistant.modelsDescSuffix")}
                  </p>
                </div>
              </div>

              {/* Direct Search Bar + Manual Add */}
              <div className="flex flex-col sm:flex-row items-center gap-3">
                <div className="relative flex-1 w-full">
                  <SearchIcon className="absolute left-3.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                  <Input
                    value={llmModelSearch}
                    onChange={(e) => setLlmModelSearch(e.target.value)}
                    placeholder={t("settings.assistant.llmSearchPlaceholder")}
                    className="h-10 pl-10 pr-9 text-xs bg-background border-border rounded-xl"
                  />
                  {llmModelSearch && (
                    <button
                      type="button"
                      onClick={() => setLlmModelSearch("")}
                      className="absolute right-3 top-1/2 -translate-y-1/2 size-4 rounded-full text-muted-foreground hover:text-foreground flex items-center justify-center cursor-pointer"
                      title={t("settings.clearSearch")}
                    >
                      <XCircleIcon className="size-3.5" />
                    </button>
                  )}
                </div>

                {/* Manual custom model add */}
                <div className="flex items-center gap-2 shrink-0 w-full sm:w-auto">
                  <Input
                    value={newCustomLlmModelInput}
                    onChange={(e) => setNewCustomLlmModelInput(e.target.value)}
                    placeholder={t("settings.assistant.addModelPlaceholder")}
                    className="h-10 w-full sm:w-48 text-xs font-mono bg-background border-border rounded-xl"
                    onKeyDown={(e) => e.key === "Enter" && handleAddCustomLlmModel()}
                  />
                  <Button
                    size="sm"
                    onClick={handleAddCustomLlmModel}
                    disabled={!newCustomLlmModelInput.trim()}
                    className="h-10 px-3.5 text-xs rounded-xl bg-secondary hover:bg-secondary/80 border border-border text-secondary-foreground shrink-0 cursor-pointer"
                  >
                    <PlusIcon className="size-3.5 mr-1" />
                    <span>{t("common.add")}</span>
                  </Button>
                </div>
              </div>

              {/* Models Grid Cards */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 max-h-[460px] overflow-y-auto pr-1">
                {filteredLlmModels.map((m) => {
                  const isTextActive = llmConfig.model === m.id;
                  const isVisionActive = llmConfig.visionModel === m.id;

                  return (
                    <div
                      key={m.id}
                      className={cn(
                        "flex items-center justify-between p-3.5 rounded-2xl border transition-all select-none",
                        isTextActive || isVisionActive
                          ? "bg-muted border-primary/40 shadow-xs"
                          : "bg-background border-border hover:border-primary/30"
                      )}
                    >
                      <div className="flex flex-col min-w-0 pr-2">
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs font-mono font-bold text-foreground truncate">
                            {modelDisplayName(m)}
                          </span>
                        </div>
                        <span className="text-[11px] text-muted-foreground font-mono truncate mt-0.5">
                          {m.id}
                        </span>
                        <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                          {m.ownedBy && (
                            <span className="text-[10px] px-1.5 py-0.2 rounded bg-muted text-muted-foreground font-mono">
                              {m.ownedBy}
                            </span>
                          )}
                          {isTextActive && (
                            <Badge className="text-[10px] py-0 px-1.5 h-4.5 bg-primary/20 text-primary border-primary/30">
                              {t("settings.assistant.currentTextBadge")}
                            </Badge>
                          )}
                          {isVisionActive && (
                            <Badge className="text-[10px] py-0 px-1.5 h-4.5 bg-emerald-500/20 text-emerald-600 dark:text-emerald-300 border-emerald-500/30">
                              {t("settings.assistant.currentVisionBadge")}
                            </Badge>
                          )}
                        </div>
                      </div>

                      {/* Action buttons */}
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => updateLlmConfig({ model: m.id })}
                          className={cn(
                            "text-xs px-2.5 py-1 rounded-xl border transition-all cursor-pointer font-medium",
                            isTextActive
                              ? "bg-primary text-zinc-950 font-bold border-primary shadow-xs"
                              : "bg-muted border-border text-foreground hover:bg-accent"
                          )}
                          title={t("settings.assistant.setTextModelTitle")}
                        >
                          {isTextActive ? t("settings.assistant.textActive") : t("settings.assistant.setTextModel")}
                        </button>

                        <button
                          type="button"
                          onClick={() => updateLlmConfig({ visionModel: m.id })}
                          className={cn(
                            "text-xs px-2.5 py-1 rounded-xl border transition-all cursor-pointer font-medium",
                            isVisionActive
                              ? "bg-emerald-500 text-zinc-950 font-bold border-emerald-500 shadow-xs"
                              : "bg-emerald-500/10 border-emerald-500/20 text-emerald-600 dark:text-emerald-300 hover:bg-emerald-500/20"
                          )}
                          title={t("settings.assistant.setVisionModelTitle")}
                        >
                          {isVisionActive ? t("settings.assistant.visionActive") : t("settings.assistant.setVisionModel")}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

          {/* 2b. Shared Server Section (optional-login builds only) */}
          {activeNav === "server" && serverFeatureEnabled && (
            <div className="space-y-6">
              <div className="p-4 sm:p-6 rounded-3xl bg-card/80 border border-border space-y-5 shadow-xl">
                <div>
                  <h2 className="text-base font-bold text-foreground flex items-center gap-2">
                    <span>{t("settings.server.title")}</span>
                    <Badge variant="outline" className="text-[10px] bg-primary/10 border-primary/30 text-primary">
                      {t("settings.server.badge")}
                    </Badge>
                  </h2>
                  <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                    {t("settings.server.desc")}
                  </p>
                </div>

                {/* Backend availability */}
                {serverHealthStatus === "unavailable" && (
                  <Alert variant="destructive">
                    <AlertTitle>{t("settings.server.unreachableTitle")}</AlertTitle>
                    <AlertDescription>{t("settings.server.unreachableDesc")}</AlertDescription>
                  </Alert>
                )}
                {serverHealthStatus === "available" && serverHealth && (
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <Badge variant="outline" className={serverHealth.auth.enabled ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-600 dark:text-emerald-400" : ""}>
                      {serverHealth.auth.enabled ? t("settings.server.authReady") : t("settings.server.authMissing")}
                    </Badge>
                    <Badge variant="outline" className={serverHealth.upstreams.llm ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-600 dark:text-emerald-400" : ""}>
                      {serverHealth.upstreams.llm ? t("settings.server.llmReady") : t("settings.server.llmMissing")}
                    </Badge>
                    <Badge variant="outline" className={serverHealth.upstreams.image ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-600 dark:text-emerald-400" : ""}>
                      {serverHealth.upstreams.image ? t("settings.server.imageReady") : t("settings.server.imageMissing")}
                    </Badge>
                  </div>
                )}

                {serverToken ? (
                  <div className="space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-muted/30 px-4 py-3">
                      <div className="space-y-0.5 min-w-0">
                        <div className="text-sm font-semibold text-foreground flex items-center gap-2">
                          <CheckCircle2Icon className="size-4 text-emerald-500" />
                          {t("settings.server.loggedIn")}
                        </div>
                        {serverTokenExp && (
                          <div className="text-xs text-muted-foreground">
                            {t("settings.server.expiresAt", {
                              time: new Date(serverTokenExp * 1000).toLocaleString(),
                            })}
                          </div>
                        )}
                      </div>
                      <Button variant="outline" size="sm" onClick={handleServerLogout}>
                        {t("settings.server.logout")}
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      {t("settings.server.takenOverNote")}
                    </p>
                    {managedConfig && (
                      <div className="flex flex-wrap gap-2 text-xs">
                        <Badge variant="outline" className="font-mono">
                          {t("settings.server.managedImageModels", {
                            count: managedConfig.image.models.length,
                          })}
                        </Badge>
                        <Badge variant="outline" className="font-mono">
                          {t("settings.server.managedLlmModel", {
                            model: managedConfig.assistant.textModel ?? "—",
                          })}
                        </Badge>
                        <Badge variant="outline" className="font-mono">
                          {t("settings.server.managedVisionModel", {
                            model: managedConfig.assistant.visionModel ?? "—",
                          })}
                        </Badge>
                      </div>
                    )}
                    {managedStatus === "error" && (
                      <Alert variant="destructive">
                        <AlertTitle>
                          {t("settings.server.managedConfigErrorTitle")}
                        </AlertTitle>
                        <AlertDescription className="flex flex-wrap items-center gap-2">
                          <span>
                            {t("settings.server.managedConfigErrorDesc", {
                              code: managedError,
                            })}
                          </span>
                          <Button
                            size="xs"
                            variant="outline"
                            onClick={() => void loadManagedConfig()}
                          >
                            {t("common.retry")}
                          </Button>
                        </AlertDescription>
                      </Alert>
                    )}
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label className="text-xs text-foreground font-semibold">
                        {t("settings.server.usernameLabel")}
                      </Label>
                      <Input
                        value={serverUsername}
                        onChange={(e) => setServerUsername(e.target.value)}
                        placeholder={t("settings.server.usernamePlaceholder")}
                        autoComplete="username"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label className="text-xs text-foreground font-semibold">
                        {t("settings.server.passwordLabel")}
                      </Label>
                      <Input
                        type="password"
                        value={serverPassword}
                        onChange={(e) => setServerPassword(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") void handleServerLogin();
                        }}
                        placeholder={t("settings.server.passwordPlaceholder")}
                        autoComplete="current-password"
                      />
                    </div>
                    {serverLoginResult && (
                      <Alert variant={serverLoginResult.success ? "default" : "destructive"}>
                        <AlertDescription>{serverLoginResult.message}</AlertDescription>
                      </Alert>
                    )}
                    <div className="flex items-center gap-3">
                      <Button
                        onClick={handleServerLogin}
                        disabled={serverLoginBusy || !serverUsername.trim() || !serverPassword}
                      >
                        {serverLoginBusy && <Loader2Icon className="size-4 animate-spin" />}
                        {t("settings.server.login")}
                      </Button>
                      <p className="text-xs text-muted-foreground leading-relaxed">
                        {t("settings.server.loginHint")}
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* 3. Prompt Library Section */}
          {activeNav === "prompts" && (
            <div className="p-4 sm:p-6 rounded-3xl bg-card/80 border border-border space-y-5 shadow-xl">
              <div>
                <h2 className="text-base font-bold text-foreground flex items-center gap-2.5">
                  <LibraryBigIcon className="size-4 text-primary" />
                  <span>{t("settings.prompts.title")}</span>
                  <Badge variant="outline" className="text-xs text-muted-foreground border-border bg-muted/40 font-mono">
                    {t("settings.prompts.countBadge", { count: promptLibraryEntries.length })}
                  </Badge>
                </h2>
                <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                  {t("settings.prompts.desc")}
                </p>
              </div>

              {/* Add New Entry */}
              <div className="p-3.5 rounded-2xl bg-muted/40 border border-border space-y-3">
                <div className="space-y-1.5">
                  <Label className="text-xs text-foreground font-semibold">
                    {t("settings.prompts.titleLabel")}
                  </Label>
                  <Input
                    value={newPromptTitle}
                    onChange={(e) => setNewPromptTitle(e.target.value)}
                    placeholder={t("settings.prompts.titlePlaceholder")}
                    className="h-9 bg-background border-border text-xs rounded-xl"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-foreground font-semibold">
                    {t("settings.prompts.promptLabel")}
                  </Label>
                  <Textarea
                    value={newPromptText}
                    onChange={(e) => setNewPromptText(e.target.value)}
                    placeholder={t("settings.prompts.promptPlaceholder")}
                    rows={3}
                    className="bg-background border-border text-xs rounded-xl resize-none"
                  />
                </div>
                <div className="flex justify-end">
                  <Button
                    size="sm"
                    onClick={handleAddPromptLibraryEntry}
                    disabled={!newPromptTitle.trim() || !newPromptText.trim()}
                    className="h-9 px-4 text-xs bg-primary hover:bg-primary/90 text-zinc-950 font-bold shadow-md shadow-primary/20 cursor-pointer"
                  >
                    <PlusIcon className="size-3.5 mr-1" />
                    {t("common.add")}
                  </Button>
                </div>
              </div>

              {/* Library List */}
              {promptLibraryEntries.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-border p-6 text-center">
                  <p className="text-sm font-semibold text-foreground">
                    {t("settings.prompts.emptyTitle")}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {t("settings.prompts.emptyDesc")}
                  </p>
                </div>
              ) : (
                <div className="space-y-2 max-h-[480px] overflow-y-auto pr-1">
                  {promptLibraryEntries.map((entry) =>
                    editingPromptId === entry.id ? (
                      <div
                        key={entry.id}
                        className="p-3.5 rounded-2xl bg-muted border border-primary/40 space-y-3"
                      >
                        <Input
                          value={editingPromptTitle}
                          onChange={(e) => setEditingPromptTitle(e.target.value)}
                          placeholder={t("settings.prompts.titlePlaceholder")}
                          className="h-9 bg-background border-border text-xs rounded-xl"
                        />
                        <Textarea
                          value={editingPromptText}
                          onChange={(e) => setEditingPromptText(e.target.value)}
                          placeholder={t("settings.prompts.promptPlaceholder")}
                          rows={3}
                          className="bg-background border-border text-xs rounded-xl resize-none"
                        />
                        <div className="flex justify-end gap-2">
                          <Button
                            size="xs"
                            variant="ghost"
                            onClick={() => setEditingPromptId(null)}
                            className="h-7 text-muted-foreground hover:text-foreground"
                          >
                            {t("common.cancel")}
                          </Button>
                          <Button
                            size="xs"
                            onClick={handleSavePromptLibraryEntry}
                            className="h-7 px-3 text-xs bg-primary hover:bg-primary/90 text-zinc-950 font-bold"
                          >
                            {t("common.save")}
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div
                        key={entry.id}
                        className="group flex items-start justify-between gap-3 p-3.5 rounded-2xl bg-muted/40 border border-border hover:border-primary/30 transition-colors"
                      >
                        <div className="min-w-0">
                          <div className="text-xs font-bold text-foreground truncate">
                            {entry.title}
                          </div>
                          <p className="text-[11px] text-muted-foreground font-mono mt-1 leading-relaxed line-clamp-2">
                            {entry.prompt}
                          </p>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            type="button"
                            className="size-6 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted flex items-center justify-center transition-colors cursor-pointer"
                            onClick={() =>
                              startEditPromptLibraryEntry(entry.id, entry.title, entry.prompt)
                            }
                            title={t("common.edit")}
                          >
                            <PencilIcon className="size-3.5" />
                          </button>
                          <button
                            type="button"
                            className="size-6 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 flex items-center justify-center transition-colors cursor-pointer"
                            onClick={() => handleRemovePromptLibraryEntry(entry.id, entry.title)}
                            title={t("common.delete")}
                          >
                            <Trash2Icon className="size-3.5" />
                          </button>
                        </div>
                      </div>
                    )
                  )}
                </div>
              )}
            </div>
          )}

          {/* 4. Network & CORS Proxy Section */}
          {activeNav === "network" && (
            <div className="p-4 sm:p-6 rounded-3xl bg-card/80 border border-border space-y-5 shadow-xl">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-base font-bold text-foreground flex items-center gap-2">
                    <GlobeIcon className="size-4 text-primary" />
                    <span>{t("settings.network.proxyTitle")}</span>
                  </h2>
                  <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                    {t("settings.network.proxyDesc")}
                  </p>
                </div>

                <a
                  href="https://github.com/tbxark/vercel-proxy"
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-primary font-medium hover:underline inline-flex items-center gap-1.5"
                >
                  <span>{t("settings.network.referenceProject")}</span>
                  <ExternalLinkIcon className="size-3.5" />
                </a>
              </div>

              <div className="space-y-2">
                <Label className="text-xs text-foreground font-semibold">
                  {t("settings.network.modeLabel")}
                </Label>
                <div
                  role="radiogroup"
                  aria-label={t("settings.network.modeLabel")}
                  className="flex flex-wrap gap-2"
                >
                  {([
                    { value: "auto", label: t("settings.network.modeAuto") },
                    { value: "always", label: t("settings.network.modeAlways") },
                    { value: "off", label: t("settings.network.modeOff") },
                  ] as const).map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      role="radio"
                      aria-checked={corsProxyMode === option.value}
                      onClick={() => setCorsProxyMode(option.value)}
                      className={cn(
                        "h-9 px-3.5 rounded-xl border text-xs font-medium transition-colors cursor-pointer",
                        corsProxyMode === option.value
                          ? "border-primary/60 bg-primary/10 text-primary"
                          : "border-border bg-muted/40 text-muted-foreground hover:text-foreground"
                      )}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed max-w-2xl">
                  {corsProxyMode === "always"
                    ? t("settings.network.modeAlwaysHint")
                    : corsProxyMode === "off"
                      ? t("settings.network.modeOffHint")
                      : t("settings.network.modeAutoHint")}
                </p>
              </div>

              <div className="space-y-2">
                <Label className="text-xs text-foreground font-semibold">
                  {t("settings.network.proxyLabel")}
                </Label>
                <Input
                  value={corsProxy}
                  onChange={(e) => setCorsProxy(e.target.value.trim())}
                  disabled={corsProxyMode === "off"}
                  placeholder="https://my-proxy.vercel.app"
                  className="h-10 bg-background border-border text-xs font-mono disabled:opacity-50"
                />
              </div>

              <div className="rounded-2xl p-4 bg-muted/40 border border-border text-sm text-foreground leading-relaxed space-y-2.5 max-w-2xl">
                <p className="font-bold text-foreground flex items-center gap-1.5">
                  <span>{t("settings.network.spliceRuleTitle")}</span>
                </p>
                <p className="text-foreground text-sm">
                  {t("settings.network.spliceRulePart1")}
                  <code>https://&lt;proxy-domain&gt;/&lt;target-url&gt;</code>
                  {t("settings.network.spliceRulePart2")}
                  <code>https://my-proxy.vercel.app</code>
                  {t("settings.network.spliceRulePart3")}
                </p>
                <p className="font-mono text-primary text-xs break-all bg-background/70 p-2.5 rounded-xl border border-border">
                  https://my-proxy.vercel.app/https://api.openai.com/v1/images/generations
                </p>
                <p className="text-muted-foreground text-xs">
                  {t("settings.network.directConnectionHint")}
                </p>
              </div>
            </div>
          )}

          {/* 5. Concurrency, Storage & Backup Section */}
          {activeNav === "system" && (
            <div className="space-y-6">
              {/* Concurrency & Quota */}
              <div className="p-4 sm:p-6 rounded-3xl bg-card/80 border border-border space-y-5 shadow-xl">
                <h2 className="text-base font-bold text-foreground flex items-center gap-2">
                  <DatabaseIcon className="size-4 text-primary" />
                  <span>{t("settings.system.queueTitle")}</span>
                </h2>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 text-xs">
                  <div className="space-y-2">
                    <div className="flex justify-between items-center">
                      <Label className="text-foreground font-semibold">{t("settings.system.concurrencyLabel")}</Label>
                      <span className="font-bold text-primary font-mono text-sm">{t("settings.system.concurrencyValue", { count: concurrencyLimit })}</span>
                    </div>
                    <input
                      type="range"
                      min={1}
                      max={6}
                      value={concurrencyLimit}
                      onChange={(e) => setConcurrencyLimit(Number(e.target.value))}
                      className="w-full accent-primary cursor-pointer h-2 bg-muted rounded-lg"
                    />
                    <p className="text-xs text-muted-foreground">
                      {t("settings.system.concurrencyHint")}
                    </p>
                  </div>

                  <div className="space-y-2">
                    <div className="flex justify-between items-center">
                      <Label className="text-foreground font-semibold">{t("settings.system.quotaLabel")}</Label>
                      <span className="font-bold text-primary font-mono text-sm">{t("settings.system.quotaValue", { count: historyQuota })}</span>
                    </div>
                    <input
                      type="range"
                      min={50}
                      max={500}
                      step={25}
                      value={historyQuota}
                      onChange={(e) => setHistoryQuota(Number(e.target.value))}
                      className="w-full accent-primary cursor-pointer h-2 bg-muted rounded-lg"
                    />
                    <p className="text-xs text-muted-foreground">
                      {t("settings.system.quotaHint")}
                    </p>
                  </div>
                </div>
              </div>

              {/* Backup & Import */}
              <div className="p-4 sm:p-6 rounded-3xl bg-card/80 border border-border space-y-4 shadow-xl">
                <h2 className="text-base font-bold text-foreground">{t("settings.system.backupTitle")}</h2>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  {t("settings.system.backupDesc")}
                </p>

                <div className="flex flex-wrap items-center gap-3 pt-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleExport}
                    className="h-9 px-4 text-xs border-border bg-muted/40 hover:bg-muted text-foreground"
                  >
                    <DownloadIcon className="size-3.5 mr-1.5" />
                    {t("settings.system.exportJson")}
                  </Button>

                  <label className="h-9 px-4 rounded-xl border border-border bg-muted/40 hover:bg-muted text-foreground text-xs inline-flex items-center gap-1.5 cursor-pointer transition-colors">
                    <UploadIcon className="size-3.5 mr-1.5" />
                    <span>{t("settings.system.importJson")}</span>
                    <input
                      ref={importFileRef}
                      type="file"
                      accept=".json,application/json"
                      className="hidden"
                      onChange={handleImportFile}
                    />
                  </label>

                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => navigate("/onboarding")}
                    className="h-9 px-4 text-xs text-muted-foreground hover:text-foreground"
                  >
                    <SparklesIcon className="size-3.5 mr-1.5" />
                    {t("settings.system.openGuide")}
                  </Button>

                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setConfirmResetOpen(true)}
                    className="h-9 px-4 text-xs text-muted-foreground hover:text-destructive hover:bg-destructive/10 ml-auto"
                  >
                    <RotateCcwIcon className="size-3.5 mr-1.5" />
                    {t("settings.system.resetAll")}
                  </Button>
                </div>
              </div>
            </div>
          )}
        </main>
      </div>

      <ConfirmDialog
        open={pendingPromptDelete !== null}
        title={
          pendingPromptDelete
            ? t("settings.prompts.deleteConfirm", {
                title: pendingPromptDelete.title,
              })
            : ""
        }
        confirmLabel={t("common.delete")}
        onCancel={() => setPendingPromptDelete(null)}
        onConfirm={confirmPromptLibraryDelete}
      />

      <ConfirmDialog
        open={pendingImport !== null}
        title={t("settings.system.importConfirmTitle")}
        description={t("settings.system.importConfirmDesc", {
          file: pendingImport?.fileName ?? "",
        })}
        confirmLabel={t("settings.system.importJson")}
        onCancel={() => setPendingImport(null)}
        onConfirm={confirmImportConfig}
      />

      <ConfirmDialog
        open={confirmResetOpen}
        title={t("settings.system.resetAll")}
        description={t("settings.system.resetConfirm")}
        confirmLabel={t("settings.system.resetAll")}
        onCancel={() => setConfirmResetOpen(false)}
        onConfirm={handleResetAll}
      />
    </div>
  );
}
