import React, { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  CheckIcon,
  Code2Icon,
  CopyIcon,
  DownloadIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { toast } from "sonner";
import { useWorkflowStore } from "../../stores/useWorkflowStore";
import { useConfigStore } from "../../stores/useConfigStore";
import {
  generateWorkflowCode,
  type WorkflowCodeWarning,
} from "../../utils/workflowCodegen";
import { downloadFile } from "../../utils/file";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";

const CODE_FONT_CLASS =
  "font-mono text-[11px] leading-[1.7] [tab-size:2]";

function WarningList({ warnings }: { warnings: WorkflowCodeWarning[] }) {
  const { t } = useTranslation();
  if (warnings.length === 0) return null;
  return (
    <div className="max-h-28 shrink-0 overflow-y-auto rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2">
      <p className="flex items-center gap-1.5 text-[11px] font-semibold text-amber-700 dark:text-amber-300">
        <TriangleAlertIcon className="size-3.5 shrink-0" />
        {t("workflow.codeDialog.warningsTitle", {
          total: warnings.length,
        })}
      </p>
      <ul className="mt-1 space-y-1 text-[11px] leading-relaxed text-amber-700/90 dark:text-amber-200/90">
        {warnings.map((warning) => (
          <li
            key={JSON.stringify(warning)}
            className="flex gap-1.5"
          >
            <span aria-hidden="true">•</span>
            <span>{t(warning.key, warning.values)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Shows the workflow as a standalone OpenAI SDK script. The code is generated
 * from the current graph every time the dialog opens; nothing is uploaded and
 * no API key is ever written into the preview.
 */
export function WorkflowCodeDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const nodes = useWorkflowStore((state) => state.nodes);
  const edges = useWorkflowStore((state) => state.edges);
  const imageConfig = useConfigStore((state) => state.imageConfig);
  const llmConfig = useConfigStore((state) => state.llmConfig);
  const [copied, setCopied] = useState(false);

  const result = useMemo(() => {
    // Generating the full script on every canvas drag/keystroke would be pure
    // waste while the dialog is closed.
    if (!open) return null;
    return generateWorkflowCode({
      nodes,
      edges,
      image: {
        apiBaseUrl: imageConfig.apiBaseUrl,
        model: imageConfig.selectedModel,
        enabledModelIds: imageConfig.enabledModelIds,
      },
      llm: {
        apiBaseUrl: llmConfig.apiBaseUrl,
        model: llmConfig.model,
        visionModel: llmConfig.visionModel,
      },
    });
  }, [open, nodes, edges, imageConfig, llmConfig]);

  const code = result?.ok ? result.code : "";
  const lineNumbers = useMemo(
    () => code.split("\n").map((_, index) => index + 1),
    [code]
  );

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      toast.success(t("workflow.codeDialog.copied"));
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error(t("workflow.codeDialog.copyFailed"));
    }
  };

  const handleDownload = () => {
    if (!code) return;
    const fileName = `workflow-${new Date().toISOString().slice(0, 10)}.ts`;
    downloadFile(
      new Blob([code], { type: "text/plain;charset=utf-8" }),
      fileName
    );
    toast.success(t("workflow.codeDialog.downloadDone", { name: fileName }));
  };

  if (!open || !result) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[86vh] max-h-[calc(100vh-1.5rem)] flex-col gap-3 overflow-hidden p-4 sm:max-w-4xl sm:p-6">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 pr-8 text-base">
            <Code2Icon className="size-4 shrink-0 text-primary" />
            {t("workflow.codeDialog.title")}
          </DialogTitle>
          <DialogDescription className="text-xs leading-relaxed">
            {t("workflow.codeDialog.description")}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant="secondary" className="text-[10px]">
            OpenAI SDK
          </Badge>
          <Badge variant="outline" className="text-[10px]">
            TypeScript
          </Badge>
          {result.ok && (
            <span className="text-[11px] text-muted-foreground">
              {t("workflow.codeDialog.stats", {
                nodes: result.stats.nodes,
                edges: result.stats.edges,
              })}
            </span>
          )}
        </div>

        {!result.ok ? (
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 rounded-xl border border-destructive/30 bg-destructive/10 p-6 text-center">
            <TriangleAlertIcon className="size-6 text-destructive" />
            <p className="text-sm font-semibold text-destructive">
              {t(
                result.error === "empty"
                  ? "workflow.codeDialog.empty"
                  : "workflow.codeDialog.cycle"
              )}
            </p>
            {result.error === "cycle" && result.nodeTitles.length > 0 && (
              <p className="max-w-md text-xs leading-relaxed text-destructive/80">
                {result.nodeTitles.join(" · ")}
              </p>
            )}
          </div>
        ) : (
          <>
            <WarningList warnings={result.warnings} />

            <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border bg-zinc-950">
              <div className="flex shrink-0 items-center justify-between gap-2 border-b border-white/10 px-3 py-1.5">
                <span className="min-w-0 truncate font-mono text-[11px] text-zinc-400">
                  workflow.ts
                </span>
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    onClick={() => void handleCopy()}
                    title={t("workflow.codeDialog.copy")}
                    aria-label={t("workflow.codeDialog.copy")}
                    className="inline-flex cursor-pointer items-center gap-1 rounded-md px-2 py-1 text-[11px] text-zinc-300 transition-colors hover:bg-white/10 hover:text-white"
                  >
                    {copied ? (
                      <CheckIcon className="size-3 text-emerald-400" />
                    ) : (
                      <CopyIcon className="size-3" />
                    )}
                    <span className="hidden sm:inline">
                      {copied ? t("common.copied") : t("common.copy")}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={handleDownload}
                    title={t("workflow.codeDialog.download")}
                    aria-label={t("workflow.codeDialog.download")}
                    className="inline-flex cursor-pointer items-center gap-1 rounded-md px-2 py-1 text-[11px] text-zinc-300 transition-colors hover:bg-white/10 hover:text-white"
                  >
                    <DownloadIcon className="size-3" />
                    <span className="hidden sm:inline">
                      {t("workflow.codeDialog.download")}
                    </span>
                  </button>
                </div>
              </div>

              <div className="min-h-0 flex-1 overflow-auto">
                <div className="flex min-h-full min-w-max">
                  <div
                    aria-hidden="true"
                    className={`sticky left-0 z-10 shrink-0 select-none border-r border-white/5 bg-zinc-950 px-3 py-4 text-right text-zinc-600 ${CODE_FONT_CLASS}`}
                  >
                    {lineNumbers.map((line) => (
                      <div key={line}>{line}</div>
                    ))}
                  </div>
                  <pre
                    className={`min-w-0 px-4 py-4 whitespace-pre text-zinc-200 ${CODE_FONT_CLASS}`}
                  >
                    <code>{code}</code>
                  </pre>
                </div>
              </div>
            </div>
          </>
        )}

        <DialogFooter className="shrink-0 flex-row flex-wrap justify-end gap-2">
          <span className="w-full text-[11px] leading-relaxed text-muted-foreground sm:mr-auto sm:w-auto">
            {t("workflow.codeDialog.footerHint")}
          </span>
          <Button
            type="button"
            size="sm"
            onClick={handleDownload}
            disabled={!result.ok}
          >
            <DownloadIcon className="size-3.5" />
            {t("workflow.codeDialog.download")}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
          >
            {t("common.close")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
