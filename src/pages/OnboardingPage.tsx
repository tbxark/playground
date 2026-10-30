import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Toaster, toast } from "sonner";
import { useTranslation } from "react-i18next";
import {
  AlertTriangleIcon,
  ArrowRightIcon,
  BotIcon,
  CheckCircle2Icon,
  CheckIcon,
  ChevronDownIcon,
  EyeIcon,
  EyeOffIcon,
  GlobeIcon,
  KeyIcon,
  Loader2Icon,
  MoonIcon,
  PlusIcon,
  RotateCcwIcon,
  ServerIcon,
  ShieldCheckIcon,
  SparklesIcon,
  SunIcon,
  UploadIcon,
  XCircleIcon,
  XIcon,
} from "lucide-react";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Badge } from "../components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "../components/ui/alert";
import { ConfirmDialog } from "../components/ui/confirm-dialog";
import { useConfigStore } from "../stores/useConfigStore";
import {
  fetchOnlineLlmModels,
  fetchOnlineModels,
  modelDisplayName,
  testImageServiceConnection,
} from "../services/imageService";
import { applyServerLlmOverlay, buildServerAwareRequest } from "../services/effectiveConfig";
import { mergeServerDefaultModels } from "../services/serverModels";
import { serverFeatureEnabled } from "@/features/serverMode";
import { useServerStore } from "../stores/useServerStore";
import { changeLocale } from "@/i18n";
import { cn } from "@/utils/cn";

type Result = { success: boolean; message: string };

function ResultAlert({ title, result }: { title: string; result: Result }) {
  return (
    <Alert
      variant={result.success ? "success" : "destructive"}
      className="py-2.5 text-xs"
    >
      <AlertTitle className="flex items-center gap-1.5 text-xs font-bold">
        {result.success ? (
          <CheckCircle2Icon className="size-4" />
        ) : (
          <XCircleIcon className="size-4" />
        )}
        <span>{title}</span>
      </AlertTitle>
      <AlertDescription className="mt-1 break-words text-xs">
        {result.message}
      </AlertDescription>
    </Alert>
  );
}

/**
 * First-run setup page. A fresh browser has no endpoint, key or model, so the
 * canvas has nothing useful to show; this route is the one obvious place to
 * enter them (or paste an exported config) before any generation is attempted.
 * It is a real page, not a dialog stacked on Settings, and it can be skipped —
 * the skip is remembered so later config edits never bounce the user back.
 */
export function OnboardingPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();

  const {
    imageConfig,
    updateImageConfig,
    setSelectedModel,
    setFetchedModels,
    toggleModelEnabled,
    addCustomModel,
    removeModel,
    llmConfig,
    updateLlmConfig,
    setLlmFetchedModels,
    corsProxy,
    corsProxyMode,
    setCorsProxy,
    theme,
    setTheme,
    importConfig,
  } = useConfigStore();

  const [showImageKey, setShowImageKey] = useState(false);
  const [showLlmKey, setShowLlmKey] = useState(false);
  const [showAssistant, setShowAssistant] = useState(false);

  const [isTestingImage, setIsTestingImage] = useState(false);
  const [imageTestResult, setImageTestResult] = useState<Result | null>(null);
  const [isFetchingModels, setIsFetchingModels] = useState(false);
  const [modelsResult, setModelsResult] = useState<Result | null>(null);

  const [isFetchingLlm, setIsFetchingLlm] = useState(false);
  const [llmFetchResult, setLlmFetchResult] = useState<Result | null>(null);

  const [newModelInput, setNewModelInput] = useState("");
  const [pendingImport, setPendingImport] = useState<{
    text: string;
    fileName: string;
  } | null>(null);

  const currentLocale = i18n.language.startsWith("zh") ? "zh" : "en";
  const serverToken = useServerStore((s) => s.token);
  const [serverUsername, setServerUsername] = useState("");
  const [serverPassword, setServerPassword] = useState("");
  const [serverLoginBusy, setServerLoginBusy] = useState(false);
  const [serverLoginResult, setServerLoginResult] = useState<Result | null>(null);
  const hasImageKey = imageConfig.apiKey.trim().length > 0 || serverToken !== null;
  const enabledModels = imageConfig.models.filter((model) =>
    imageConfig.enabledModelIds.includes(model.id)
  );
  const defaultModel =
    enabledModels.find((model) => model.id === imageConfig.selectedModel) ??
    enabledModels[0];
  const canStart = hasImageKey && enabledModels.length > 0;

  useEffect(() => {
    document.title = t("onboarding.brand");
  }, [t]);

  const steps = [
    { key: "service", done: hasImageKey },
    { key: "models", done: enabledModels.length > 0 },
    { key: "start", done: canStart },
  ];

  // Every request is checked against the config it was sent with, so a result
  // from an old endpoint/key never lands on the new one (same rule as Settings).
  const imageRequestConfig = () => ({
    apiBaseUrl: imageConfig.apiBaseUrl,
    apiKey: imageConfig.apiKey,
    corsProxy,
    corsProxyMode,
  });
  const isCurrentImageRequest = (snapshot: ReturnType<typeof imageRequestConfig>) => {
    const current = useConfigStore.getState();
    return (
      current.imageConfig.apiBaseUrl === snapshot.apiBaseUrl &&
      current.imageConfig.apiKey === snapshot.apiKey &&
      current.corsProxy === snapshot.corsProxy &&
      current.corsProxyMode === snapshot.corsProxyMode
    );
  };

  const resetImageFeedback = () => {
    setImageTestResult(null);
    setModelsResult(null);
  };

  const handleTestImageService = async () => {
    const snapshot = imageRequestConfig();
    setIsTestingImage(true);
    setImageTestResult(null);
    try {
      const request = buildServerAwareRequest(
        "image",
        { apiBaseUrl: snapshot.apiBaseUrl, apiKey: snapshot.apiKey },
        { corsProxy: snapshot.corsProxy, corsProxyMode: snapshot.corsProxyMode }
      );
      const result = await testImageServiceConnection(
        request.apiBaseUrl,
        request.apiKey,
        request.corsProxy,
        request.corsProxyMode
      );
      if (!isCurrentImageRequest(snapshot)) return;
      setImageTestResult(result);
    } catch (error) {
      if (!isCurrentImageRequest(snapshot)) return;
      setImageTestResult({
        success: false,
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setIsTestingImage(false);
    }
  };

  const handleFetchModels = async () => {
    const snapshot = imageRequestConfig();
    setIsFetchingModels(true);
    setModelsResult(null);
    try {
      const request = buildServerAwareRequest(
        "image",
        { apiBaseUrl: snapshot.apiBaseUrl, apiKey: snapshot.apiKey },
        { corsProxy: snapshot.corsProxy, corsProxyMode: snapshot.corsProxyMode }
      );
      const models = await fetchOnlineModels(
        request.apiBaseUrl,
        request.apiKey,
        request.corsProxy,
        request.corsProxyMode
      );
      if (!isCurrentImageRequest(snapshot)) return;
      setFetchedModels(models);

      if (models.length === 0) {
        setModelsResult({
          success: false,
          message: t("onboarding.service.noModels"),
        });
        return;
      }

      // Fetching enables the new models; give the user a working default right
      // away so the first generation never hits the "no model" gate.
      const latest = useConfigStore.getState().imageConfig;
      if (!latest.enabledModelIds.includes(latest.selectedModel)) {
        const first = latest.models.find((model) =>
          latest.enabledModelIds.includes(model.id)
        );
        if (first) setSelectedModel(first.id);
      }

      setModelsResult({
        success: true,
        message: t("onboarding.service.modelsOkMsg", { total: models.length }),
      });
    } catch (error) {
      if (!isCurrentImageRequest(snapshot)) return;
      setModelsResult({
        success: false,
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setIsFetchingModels(false);
    }
  };

  const handleToggleModel = (modelId: string) => {
    const willDisable = imageConfig.enabledModelIds.includes(modelId);
    toggleModelEnabled(modelId);
    if (willDisable && imageConfig.selectedModel === modelId) {
      const latest = useConfigStore.getState().imageConfig;
      const fallback = latest.models.find((model) =>
        latest.enabledModelIds.includes(model.id)
      );
      updateImageConfig({ selectedModel: fallback?.id ?? "" });
    }
  };

  const handleAddModel = () => {
    const modelId = newModelInput.trim();
    if (!modelId) return;
    addCustomModel({ id: modelId, name: modelId, ownedBy: "custom" });
    const latest = useConfigStore.getState().imageConfig;
    if (!latest.enabledModelIds.includes(latest.selectedModel)) {
      setSelectedModel(modelId);
    }
    setNewModelInput("");
    // The new row (enabled, and default when it was the first model) is the
    // feedback; a stale fetch error must not sit above it.
    setModelsResult(null);
  };

  const handleFetchLlmModels = async () => {
    setIsFetchingLlm(true);
    setLlmFetchResult(null);
    try {
      const request = applyServerLlmOverlay({ ...llmConfig, corsProxy, corsProxyMode });
      const result = await fetchOnlineLlmModels(
        request.apiBaseUrl,
        request.apiKey,
        request.corsProxy,
        request.corsProxyMode
      );
      setLlmFetchedModels(result.textModels, result.visionModels);
      // Use fresh state: the user may have typed a model ID while the request
      // was in flight, and that choice must win over the fetched default.
      const latestLlm = useConfigStore.getState().llmConfig;
      if (!latestLlm.model && result.textModels.length > 0) {
        updateLlmConfig({ model: result.textModels[0].id });
      }
      if (!latestLlm.visionModel && result.visionModels.length > 0) {
        updateLlmConfig({ visionModel: result.visionModels[0].id });
      }
      setLlmFetchResult({
        success: true,
        message: t("onboarding.assistant.fetchedMsg", {
          text: result.textModels.length,
          vision: result.visionModels.length,
        }),
      });
    } catch (error) {
      setLlmFetchResult({
        success: false,
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setIsFetchingLlm(false);
    }
  };

  // Shared server login (optional-login builds only). Logging in counts as
  // "has a service": the proxy carries the real key, so no local key is needed.
  const handleServerLogin = async () => {
    if (!serverUsername.trim() || !serverPassword || serverLoginBusy) return;
    setServerLoginBusy(true);
    setServerLoginResult(null);
    const result = await useServerStore.getState().login(serverUsername.trim(), serverPassword);
    setServerLoginBusy(false);
    if (result === "ok") {
      setServerPassword("");
      const merged = mergeServerDefaultModels();
      void useServerStore.getState().checkHealth();
      setServerLoginResult({
        success: true,
        message:
          merged > 0
            ? t("onboarding.server.loginOkWithModels", { count: merged })
            : t("onboarding.server.loginOk"),
      });
    } else if (result === "invalid") {
      setServerLoginResult({ success: false, message: t("onboarding.server.invalidCredentials") });
    } else {
      setServerLoginResult({ success: false, message: t("onboarding.server.unreachable") });
    }
  };

  const applyImport = (jsonText: string) => {
    try {
      importConfig(jsonText);
      resetImageFeedback();
      setLlmFetchResult(null);
      setShowAssistant(
        useConfigStore.getState().llmConfig.apiKey.trim().length > 0
      );
      toast.success(t("onboarding.import.success"));
    } catch (error) {
      toast.error(
        t("onboarding.import.failed", {
          msg: error instanceof Error ? error.message : String(error),
        })
      );
    }
  };

  const handleImportFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const text = await file.text();
      // On a fresh browser there is nothing to overwrite; only ask when the
      // user already typed something that the import would discard.
      if (imageConfig.apiKey.trim() || llmConfig.apiKey.trim()) {
        setPendingImport({ text, fileName: file.name });
      } else {
        applyImport(text);
      }
    } catch (error) {
      toast.error(
        t("onboarding.import.failed", {
          msg: error instanceof Error ? error.message : String(error),
        })
      );
    }
  };

  const finish = (target: string) => {
    const state = useConfigStore.getState();
    if (!state.imageConfig.enabledModelIds.includes(state.imageConfig.selectedModel)) {
      const first = state.imageConfig.models.find((model) =>
        state.imageConfig.enabledModelIds.includes(model.id)
      );
      if (first) state.setSelectedModel(first.id);
    }
    state.dismissOnboarding();
    navigate(target, { replace: true });
  };

  const textModelOptions = llmConfig.availableModels ?? [];
  const visionModelOptions = llmConfig.availableVisionModels ?? [];

  const renderModelField = (
    kind: "text" | "vision",
    options: typeof textModelOptions
  ) => {
    const isText = kind === "text";
    const value = isText ? llmConfig.model : llmConfig.visionModel;
    const optionIds = new Set(options.map((option) => option.id));
    const selectClass =
      "h-9 w-full rounded-lg border border-border bg-background px-2.5 font-mono text-xs text-foreground outline-none transition-colors hover:bg-muted/40 focus:border-ring";

    if (options.length > 0) {
      return (
        <select
          value={value}
          onChange={(event) =>
            updateLlmConfig(
              isText
                ? { model: event.target.value }
                : { visionModel: event.target.value }
            )
          }
          className={selectClass}
        >
          <option value="">{t("onboarding.assistant.none")}</option>
          {options.map((option) => (
            <option key={option.id} value={option.id}>
              {option.id}
            </option>
          ))}
          {value && !optionIds.has(value) && (
            <option value={value}>{value}</option>
          )}
        </select>
      );
    }

    return (
      <Input
        value={value}
        onChange={(event) =>
          updateLlmConfig(
            isText
              ? { model: event.target.value }
              : { visionModel: event.target.value }
          )
        }
        placeholder={t("onboarding.assistant.manualPlaceholder")}
        className="h-9 bg-background border-border font-mono text-xs"
      />
    );
  };

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-background text-foreground font-sans">
      <header className="relative z-20 shrink-0 border-b border-border bg-background/85 px-3 py-3 backdrop-blur-xl sm:px-6">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-tr from-primary to-blue-500 text-white shadow-md shadow-primary/20">
              <SparklesIcon className="size-4 fill-current" />
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-extrabold tracking-tight">
                {t("onboarding.brand")}
              </p>
              <p className="truncate text-[11px] text-muted-foreground">
                {t("onboarding.tagline")}
              </p>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={() => changeLocale(currentLocale === "zh" ? "en" : "zh")}
              className="h-8 w-8 rounded-xl text-[10px] font-bold text-muted-foreground hover:bg-muted hover:text-foreground"
              title={t("shell.switchLanguage")}
            >
              {currentLocale === "zh" ? "EN" : "中"}
            </Button>
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
              className="h-8 w-8 rounded-xl text-muted-foreground hover:bg-muted hover:text-foreground"
              title={
                theme === "dark"
                  ? t("shell.app.switchToLight")
                  : t("shell.app.switchToDark")
              }
            >
              {theme === "dark" ? (
                <SunIcon className="size-4 text-amber-400" />
              ) : (
                <MoonIcon className="size-4 text-slate-600" />
              )}
            </Button>
          </div>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <main className="mx-auto grid w-full max-w-5xl gap-5 px-4 pb-10 pt-6 sm:px-6 lg:grid-cols-[17rem_minmax(0,1fr)] lg:gap-7 lg:pt-8">
          <aside className="flex flex-col gap-4 lg:sticky lg:top-6 lg:self-start">
            <div className="rounded-3xl border border-border bg-card/80 p-5 shadow-xl">
              <h1 className="text-lg font-extrabold leading-snug tracking-tight">
                {t("onboarding.title")}
              </h1>
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                {t("onboarding.subtitle")}
              </p>

              <ol className="mt-5 space-y-3">
                {steps.map((step, index) => {
                  const isCurrent =
                    !step.done && steps.slice(0, index).every((item) => item.done);
                  return (
                    <li key={step.key} className="flex items-start gap-2.5">
                      <span
                        className={cn(
                          "mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border text-[11px] font-bold",
                          step.done
                            ? "border-primary/40 bg-primary/15 text-primary"
                            : isCurrent
                              ? "border-primary bg-primary text-primary-foreground"
                              : "border-border bg-muted text-muted-foreground"
                        )}
                      >
                        {step.done ? (
                          <CheckIcon className="size-3.5 stroke-[3]" />
                        ) : (
                          index + 1
                        )}
                      </span>
                      <div className="min-w-0">
                        <p
                          className={cn(
                            "text-xs font-semibold",
                            step.done || isCurrent
                              ? "text-foreground"
                              : "text-muted-foreground"
                          )}
                        >
                          {t(`onboarding.steps.${step.key}.title`)}
                        </p>
                        <p className="text-[11px] leading-relaxed text-muted-foreground">
                          {t(`onboarding.steps.${step.key}.desc`)}
                        </p>
                      </div>
                    </li>
                  );
                })}
              </ol>
            </div>

            <div className="rounded-3xl border border-dashed border-border bg-muted/30 p-4">
              <p className="text-xs font-bold">{t("onboarding.import.title")}</p>
              <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                {t("onboarding.import.desc")}
              </p>
              <label className="mt-3 flex h-9 w-full cursor-pointer items-center justify-center gap-1.5 rounded-xl border border-border bg-background text-xs font-semibold text-foreground transition-colors hover:bg-muted">
                <UploadIcon className="size-3.5" />
                <span>{t("onboarding.import.button")}</span>
                <input
                  type="file"
                  accept=".json,application/json"
                  className="hidden"
                  onChange={handleImportFile}
                />
              </label>
              <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground">
                {t("onboarding.import.overwrite")}
              </p>
            </div>

            <p className="flex gap-1.5 px-1 text-[10px] leading-relaxed text-muted-foreground">
              <ShieldCheckIcon className="mt-0.5 size-3 shrink-0" />
              <span>{t("onboarding.privacy")}</span>
            </p>
          </aside>

          <section className="min-w-0 space-y-5">
            {/* Shared server login (optional-login builds only) */}
            {serverFeatureEnabled && (
              <div className="rounded-3xl border border-border bg-card/80 p-4 shadow-xl sm:p-6">
                <div className="flex items-start gap-3">
                  <div className="flex size-9 shrink-0 items-center justify-center rounded-xl border border-primary/30 bg-primary/15 text-primary">
                    <ServerIcon className="size-4" />
                  </div>
                  <div className="min-w-0">
                    <h2 className="flex flex-wrap items-center gap-2 text-sm font-bold text-foreground">
                      {t("onboarding.server.cardTitle")}
                      <Badge
                        variant="outline"
                        className="border-primary/30 bg-primary/10 text-[10px] text-primary"
                      >
                        {t("onboarding.server.recommended")}
                      </Badge>
                    </h2>
                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                      {t("onboarding.server.desc")}
                    </p>
                  </div>
                </div>

                <div className="mt-5 space-y-4">
                  {serverToken ? (
                    <>
                      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                        <CheckCircle2Icon className="size-4" />
                        {t("onboarding.server.loggedIn")}
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-[11px] leading-relaxed text-muted-foreground">
                          {t("onboarding.server.takenOverNote")}
                        </p>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => useServerStore.getState().logout()}
                        >
                          {t("onboarding.server.logout")}
                        </Button>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div className="space-y-1.5">
                          <Label className="text-xs font-semibold text-foreground">
                            {t("onboarding.server.usernameLabel")}
                          </Label>
                          <Input
                            value={serverUsername}
                            onChange={(event) => setServerUsername(event.target.value)}
                            placeholder={t("onboarding.server.usernamePlaceholder")}
                            autoComplete="username"
                            className="h-10 bg-background border-border"
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label className="text-xs font-semibold text-foreground">
                            {t("onboarding.server.passwordLabel")}
                          </Label>
                          <Input
                            type="password"
                            value={serverPassword}
                            onChange={(event) => setServerPassword(event.target.value)}
                            onKeyDown={(event) => {
                              if (event.key === "Enter") void handleServerLogin();
                            }}
                            placeholder={t("onboarding.server.passwordPlaceholder")}
                            autoComplete="current-password"
                            className="h-10 bg-background border-border"
                          />
                        </div>
                      </div>
                      {serverLoginResult && (
                        <ResultAlert
                          title={
                            serverLoginResult.success
                              ? t("onboarding.server.loginOk")
                              : t("onboarding.server.loginFailedTitle")
                          }
                          result={serverLoginResult}
                        />
                      )}
                      <div className="flex items-center gap-3">
                        <Button
                          onClick={handleServerLogin}
                          disabled={serverLoginBusy || !serverUsername.trim() || !serverPassword}
                        >
                          {serverLoginBusy && <Loader2Icon className="size-4 animate-spin" />}
                          {t("onboarding.server.login")}
                        </Button>
                        <p className="text-[11px] leading-relaxed text-muted-foreground">
                          {t("onboarding.server.loginHint")}
                        </p>
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}

            {/* Image generation service */}
            <div className="rounded-3xl border border-border bg-card/80 p-4 shadow-xl sm:p-6">
              <div className="flex items-start gap-3">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-xl border border-primary/30 bg-primary/15 text-primary">
                  <SparklesIcon className="size-4" />
                </div>
                <div className="min-w-0">
                  <h2 className="flex flex-wrap items-center gap-2 text-sm font-bold text-foreground">
                    {t("onboarding.service.cardTitle")}
                    <Badge
                      variant="outline"
                      className="border-primary/30 bg-primary/10 text-[10px] text-primary"
                    >
                      {t(serverToken ? "onboarding.service.notRequired" : "onboarding.service.required")}
                    </Badge>
                  </h2>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                    {t("onboarding.service.desc")}
                  </p>
                </div>
              </div>

              <div className="mt-5 space-y-4">
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-foreground">
                    {t("onboarding.service.baseUrlLabel")}
                  </Label>
                  <Input
                    value={imageConfig.apiBaseUrl}
                    onChange={(event) => {
                      updateImageConfig({ apiBaseUrl: event.target.value.trim() });
                      resetImageFeedback();
                    }}
                    placeholder="https://api.openai.com/v1"
                    className="h-10 bg-background border-border font-mono text-xs"
                  />
                  <p className="text-[11px] text-muted-foreground">
                    {t("onboarding.service.baseUrlHint")}
                  </p>
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <Label className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                      <KeyIcon className="size-3.5 text-primary" />
                      <span>{t("onboarding.service.apiKeyLabel")}</span>
                    </Label>
                    <button
                      type="button"
                      onClick={() => setShowImageKey((value) => !value)}
                      className="flex cursor-pointer items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
                    >
                      {showImageKey ? (
                        <>
                          <EyeOffIcon className="size-3.5" />
                          <span>{t("onboarding.service.hide")}</span>
                        </>
                      ) : (
                        <>
                          <EyeIcon className="size-3.5" />
                          <span>{t("onboarding.service.show")}</span>
                        </>
                      )}
                    </button>
                  </div>
                  <Input
                    type={showImageKey ? "text" : "password"}
                    value={imageConfig.apiKey}
                    onChange={(event) => {
                      updateImageConfig({ apiKey: event.target.value.trim() });
                      resetImageFeedback();
                    }}
                    placeholder="sk-..."
                    className="h-10 bg-background border-border font-mono text-xs"
                  />
                </div>

                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={isTestingImage || !hasImageKey}
                    onClick={handleTestImageService}
                    className="h-9 cursor-pointer border-border bg-muted/40 px-4 text-xs text-foreground hover:bg-muted"
                  >
                    {isTestingImage ? (
                      <Loader2Icon className="mr-1.5 size-3.5 animate-spin" />
                    ) : imageTestResult?.success ? (
                      <CheckCircle2Icon className="mr-1.5 size-3.5 text-emerald-500" />
                    ) : imageTestResult?.success === false ? (
                      <XCircleIcon className="mr-1.5 size-3.5 text-destructive" />
                    ) : (
                      <GlobeIcon className="mr-1.5 size-3.5" />
                    )}
                    <span>{t("onboarding.service.test")}</span>
                  </Button>

                  <Button
                    size="sm"
                    disabled={isFetchingModels || !hasImageKey}
                    onClick={handleFetchModels}
                    className="h-9 cursor-pointer bg-primary px-4 text-xs font-bold text-zinc-950 shadow-md shadow-primary/20 hover:bg-primary/90 disabled:bg-primary/20 disabled:text-primary/70 disabled:shadow-none disabled:opacity-100"
                  >
                    {isFetchingModels ? (
                      <Loader2Icon className="mr-1.5 size-3.5 animate-spin" />
                    ) : (
                      <RotateCcwIcon className="mr-1.5 size-3.5" />
                    )}
                    <span>{t("onboarding.service.fetch")}</span>
                  </Button>
                </div>

                {imageTestResult && (
                  <ResultAlert
                    title={
                      imageTestResult.success
                        ? t("onboarding.service.testOk")
                        : t("onboarding.service.testFailed")
                    }
                    result={imageTestResult}
                  />
                )}
                {modelsResult && (
                  <ResultAlert
                    title={
                      modelsResult.success
                        ? t("onboarding.service.modelsOk")
                        : t("onboarding.service.modelsFailed")
                    }
                    result={modelsResult}
                  />
                )}

                <details className="group rounded-2xl border border-border bg-muted/30 px-3.5 py-2.5">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-2 text-xs font-semibold text-muted-foreground hover:text-foreground">
                    <span>{t("onboarding.service.proxyToggle")}</span>
                    <ChevronDownIcon className="size-3.5 shrink-0 transition-transform group-open:rotate-180" />
                  </summary>
                  <div className="mt-3 space-y-1.5">
                    <Input
                      value={corsProxy}
                      onChange={(event) => {
                        setCorsProxy(event.target.value.trim());
                        resetImageFeedback();
                      }}
                      placeholder="https://my-proxy.vercel.app"
                      className="h-9 bg-background border-border font-mono text-xs"
                    />
                    <p className="text-[11px] leading-relaxed text-muted-foreground">
                      {t("onboarding.service.proxyHint")}
                    </p>
                  </div>
                </details>
              </div>
            </div>

            {/* Model selection */}
            <div className="rounded-3xl border border-border bg-card/80 p-4 shadow-xl sm:p-6">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <h2 className="flex flex-wrap items-center gap-2 text-sm font-bold text-foreground">
                    {t("onboarding.models.cardTitle")}
                    <Badge
                      variant="outline"
                      className="border-border bg-muted/40 font-mono text-[10px] text-muted-foreground"
                    >
                      {t("onboarding.models.badge", {
                        active: enabledModels.length,
                        total: imageConfig.models.length,
                      })}
                    </Badge>
                  </h2>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                    {t("onboarding.models.desc")}
                  </p>
                </div>
              </div>

              <div className="mt-4 grid grid-cols-1 gap-2 md:grid-cols-2">
                {imageConfig.models.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-border p-5 text-center md:col-span-2">
                    <p className="text-sm font-semibold text-foreground">
                      {t("onboarding.models.emptyTitle")}
                    </p>
                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                      {t("onboarding.models.emptyDesc")}
                    </p>
                  </div>
                ) : (
                  imageConfig.models.map((model) => {
                    const isEnabled = imageConfig.enabledModelIds.includes(model.id);
                    const isDefault = imageConfig.selectedModel === model.id;
                    return (
                      <div
                        key={model.id}
                        className={cn(
                          "flex items-center gap-1 rounded-2xl border p-1.5 pr-2 transition-colors",
                          isEnabled
                            ? "border-primary/40 bg-muted"
                            : "border-border bg-background"
                        )}
                      >
                        <button
                          type="button"
                          aria-pressed={isEnabled}
                          onClick={() => handleToggleModel(model.id)}
                          className="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5 rounded-xl p-1.5 text-left"
                        >
                          <span
                            className={cn(
                              "flex size-5 shrink-0 items-center justify-center rounded-md border transition-colors",
                              isEnabled
                                ? "border-primary bg-primary text-primary-foreground"
                                : "border-border bg-background"
                            )}
                          >
                            {isEnabled && (
                              <CheckIcon className="size-3.5 stroke-[3]" />
                            )}
                          </span>
                          <span className="min-w-0">
                            <span
                              title={modelDisplayName(model)}
                              className={cn(
                                "block truncate font-mono text-xs font-bold",
                                isEnabled
                                  ? "text-foreground"
                                  : "text-muted-foreground"
                              )}
                            >
                              {modelDisplayName(model)}
                            </span>
                            <span className="mt-0.5 block truncate font-mono text-[10px] text-muted-foreground">
                              {model.id}
                            </span>
                          </span>
                        </button>

                        <div className="flex shrink-0 items-center gap-1">
                          {isDefault ? (
                            <Badge className="h-5 border-blue-400/40 bg-blue-500/15 px-1.5 text-[10px] text-blue-600 dark:text-blue-300">
                              {t("onboarding.models.defaultBadge")}
                            </Badge>
                          ) : isEnabled ? (
                            <button
                              type="button"
                              onClick={() => setSelectedModel(model.id)}
                              className="cursor-pointer rounded-lg px-1.5 py-1 text-[10px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                            >
                              {t("onboarding.models.setDefault")}
                            </button>
                          ) : null}
                          <button
                            type="button"
                            onClick={() => removeModel(model.id)}
                            title={t("onboarding.models.remove")}
                            aria-label={t("onboarding.models.remove")}
                            className="flex size-6 cursor-pointer items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                          >
                            <XIcon className="size-3.5" />
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
                <Input
                  value={newModelInput}
                  onChange={(event) => setNewModelInput(event.target.value)}
                  onKeyDown={(event) => event.key === "Enter" && handleAddModel()}
                  placeholder={t("onboarding.models.addPlaceholder")}
                  className="h-9 bg-background border-border font-mono text-xs"
                />
                <Button
                  size="sm"
                  onClick={handleAddModel}
                  disabled={!newModelInput.trim()}
                  className="h-9 shrink-0 cursor-pointer border border-border bg-secondary px-3.5 text-xs text-secondary-foreground hover:bg-secondary/80"
                >
                  <PlusIcon className="mr-1 size-3.5" />
                  <span>{t("common.add")}</span>
                </Button>
              </div>

              {enabledModels.length > 0 && (
                <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
                  {t("onboarding.models.defaultHint")}
                </p>
              )}
            </div>

            {/* Optional prompt assistant */}
            <div className="rounded-3xl border border-border bg-card/80 shadow-xl">
              <button
                type="button"
                onClick={() => setShowAssistant((value) => !value)}
                aria-expanded={showAssistant}
                className="flex w-full cursor-pointer items-start justify-between gap-3 p-4 text-left sm:p-5"
              >
                <div className="flex min-w-0 items-start gap-3">
                  <div className="flex size-9 shrink-0 items-center justify-center rounded-xl border border-amber-500/30 bg-amber-500/15 text-amber-500">
                    <BotIcon className="size-4" />
                  </div>
                  <div className="min-w-0">
                    <h2 className="flex flex-wrap items-center gap-2 text-sm font-bold text-foreground">
                      {t("onboarding.assistant.cardTitle")}
                      <Badge
                        variant="outline"
                        className="border-border bg-muted/40 text-[10px] text-muted-foreground"
                      >
                        {t("onboarding.assistant.optional")}
                      </Badge>
                    </h2>
                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                      {t("onboarding.assistant.desc")}
                    </p>
                  </div>
                </div>
                <ChevronDownIcon
                  className={cn(
                    "mt-1 size-4 shrink-0 text-muted-foreground transition-transform",
                    showAssistant && "rotate-180"
                  )}
                />
              </button>

              {showAssistant && (
                <div className="space-y-4 border-t border-border p-4 sm:p-5">
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label className="text-xs font-semibold text-foreground">
                        {t("onboarding.assistant.baseUrlLabel")}
                      </Label>
                      <Input
                        value={llmConfig.apiBaseUrl}
                        onChange={(event) => {
                          updateLlmConfig({ apiBaseUrl: event.target.value.trim() });
                          setLlmFetchResult(null);
                        }}
                        placeholder="https://api.openai.com/v1"
                        className="h-9 bg-background border-border font-mono text-xs"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <Label className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                          <KeyIcon className="size-3.5 text-amber-500" />
                          <span>{t("onboarding.assistant.apiKeyLabel")}</span>
                        </Label>
                        <button
                          type="button"
                          onClick={() => setShowLlmKey((value) => !value)}
                          className="flex cursor-pointer items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
                        >
                          {showLlmKey ? (
                            <>
                              <EyeOffIcon className="size-3.5" />
                              <span>{t("onboarding.service.hide")}</span>
                            </>
                          ) : (
                            <>
                              <EyeIcon className="size-3.5" />
                              <span>{t("onboarding.service.show")}</span>
                            </>
                          )}
                        </button>
                      </div>
                      <Input
                        type={showLlmKey ? "text" : "password"}
                        value={llmConfig.apiKey}
                        onChange={(event) => {
                          updateLlmConfig({ apiKey: event.target.value.trim() });
                          setLlmFetchResult(null);
                        }}
                        placeholder="sk-..."
                        className="h-9 bg-background border-border font-mono text-xs"
                      />
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={isFetchingLlm || !llmConfig.apiKey.trim()}
                      onClick={handleFetchLlmModels}
                      className="h-9 cursor-pointer border-border bg-muted/40 px-4 text-xs text-foreground hover:bg-muted"
                    >
                      {isFetchingLlm ? (
                        <Loader2Icon className="mr-1.5 size-3.5 animate-spin" />
                      ) : (
                        <RotateCcwIcon className="mr-1.5 size-3.5" />
                      )}
                      <span>{t("onboarding.assistant.fetch")}</span>
                    </Button>
                  </div>

                  {llmFetchResult && (
                    <ResultAlert
                      title={
                        llmFetchResult.success
                          ? t("onboarding.assistant.fetchOk")
                          : t("onboarding.assistant.fetchFailed")
                      }
                      result={llmFetchResult}
                    />
                  )}

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label className="text-xs font-semibold text-foreground">
                        {t("onboarding.assistant.textModelLabel")}
                      </Label>
                      {renderModelField("text", textModelOptions)}
                      <p className="text-[11px] leading-relaxed text-muted-foreground">
                        {t("onboarding.assistant.textModelHint")}
                      </p>
                    </div>

                    <div className="space-y-1.5">
                      <Label className="text-xs font-semibold text-foreground">
                        {t("onboarding.assistant.visionModelLabel")}
                      </Label>
                      {renderModelField("vision", visionModelOptions)}
                      <p className="text-[11px] leading-relaxed text-muted-foreground">
                        {t("onboarding.assistant.visionModelHint")}
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </section>
        </main>
      </div>

      <footer className="shrink-0 border-t border-border bg-background/95 px-3 py-3 backdrop-blur-xl sm:px-6">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p
              className={cn(
                "flex items-center gap-1.5 text-xs font-semibold",
                canStart
                  ? "text-emerald-600 dark:text-emerald-400"
                  : "text-amber-600 dark:text-amber-400"
              )}
            >
              {canStart ? (
                <CheckCircle2Icon className="size-3.5 shrink-0" />
              ) : (
                <AlertTriangleIcon className="size-3.5 shrink-0" />
              )}
              <span>
                {canStart
                  ? t("onboarding.footer.ready")
                  : hasImageKey
                    ? t("onboarding.footer.needModel")
                    : t("onboarding.footer.needKey")}
              </span>
            </p>
            <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
              {t("onboarding.footer.summary", {
                model: defaultModel ? modelDisplayName(defaultModel) : "—",
                assistant:
                  llmConfig.apiKey.trim() && llmConfig.model
                    ? llmConfig.model
                    : t("onboarding.footer.assistantOff"),
              })}
            </p>
          </div>

          <div className="flex shrink-0 items-center justify-end gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => finish("/")}
              className="h-10 cursor-pointer px-3 text-xs text-muted-foreground hover:text-foreground"
            >
              {t("onboarding.footer.skip")}
            </Button>
            <Button
              onClick={() => finish("/")}
              disabled={!canStart}
              className="h-10 cursor-pointer gap-1.5 bg-primary px-5 text-sm font-bold text-zinc-950 shadow-md shadow-primary/20 hover:bg-primary/90 disabled:bg-primary/20 disabled:text-primary/70 disabled:shadow-none disabled:opacity-100"
            >
              <span>{t("onboarding.footer.start")}</span>
              <ArrowRightIcon className="size-4" />
            </Button>
          </div>
        </div>
      </footer>

      <Toaster
        richColors
        position="top-right"
        theme={theme === "light" ? "light" : "dark"}
        closeButton
      />

      <ConfirmDialog
        open={pendingImport !== null}
        title={t("onboarding.import.confirmTitle")}
        description={t("onboarding.import.confirmDesc", {
          file: pendingImport?.fileName ?? "",
        })}
        confirmLabel={t("onboarding.import.button")}
        onCancel={() => setPendingImport(null)}
        onConfirm={() => {
          if (!pendingImport) return;
          const { text } = pendingImport;
          setPendingImport(null);
          applyImport(text);
        }}
      />
    </div>
  );
}
