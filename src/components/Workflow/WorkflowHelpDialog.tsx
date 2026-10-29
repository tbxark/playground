import React from "react";
import { useTranslation } from "react-i18next";
import { HelpCircleIcon, MoveRightIcon } from "lucide-react";
import type { WorkflowPortType } from "../../stores/useWorkflowStore";
import {
  WORKFLOW_NODE_HELP,
  WORKFLOW_NODE_MENU,
  type WorkflowPortHelp,
} from "./nodeCatalog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { Button } from "../ui/button";
import { cn } from "@/utils/cn";

const TEXT_PORT_CLASS =
  "border-purple-500/30 bg-purple-500/10 text-purple-700 dark:text-purple-300";
const IMAGE_PORT_CLASS =
  "border-cyan-500/30 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300";
const TEXT_DOT_CLASS = "bg-purple-400";
const IMAGE_DOT_CLASS = "bg-cyan-400";

function portClass(type: WorkflowPortType) {
  return type === "text" ? TEXT_PORT_CLASS : IMAGE_PORT_CLASS;
}

function PortChip({
  port,
  direction,
}: {
  port: WorkflowPortHelp;
  direction: "input" | "output";
}) {
  const { t } = useTranslation();
  return (
    <span
      title={t("workflow.help.portTitle", {
        direction: t(direction === "input" ? "workflow.help.portInput" : "workflow.help.portOutput"),
        name: t(port.nameKey),
        type: t(port.type === "text" ? "workflow.help.portText" : "workflow.help.portImage"),
      })}
      className={cn(
        "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-medium",
        portClass(port.type)
      )}
    >
      <span
        className={cn(
          "size-1.5 shrink-0 rounded-full",
          port.type === "text" ? TEXT_DOT_CLASS : IMAGE_DOT_CLASS
        )}
      />
      <span className="font-mono opacity-70">
        {t(direction === "input" ? "workflow.help.portIn" : "workflow.help.portOut")}
      </span>
      {t(port.nameKey)}
    </span>
  );
}

function PortLegendItem({
  type,
  labelKey,
}: {
  type: WorkflowPortType;
  labelKey: string;
}) {
  const { t } = useTranslation();
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className={cn(
          "size-2.5 rounded-full border-2 bg-zinc-950",
          type === "text" ? "border-purple-400" : "border-cyan-400"
        )}
      />
      {t(labelKey)}
    </span>
  );
}

function FlowArrow({ labelKey, type }: { labelKey: string; type: WorkflowPortType }) {
  const { t } = useTranslation();
  return (
    <span className="flex flex-row items-center gap-1.5 sm:flex-col sm:gap-0.5">
      <span
        className={cn(
          "text-[9px] font-medium",
          type === "text"
            ? "text-purple-700 dark:text-purple-300"
            : "text-cyan-700 dark:text-cyan-300"
        )}
      >
        {t(labelKey)}
      </span>
      <MoveRightIcon
        className={cn(
          "size-4 rotate-90 sm:rotate-0",
          type === "text"
            ? "text-purple-500 dark:text-purple-400"
            : "text-cyan-500 dark:text-cyan-400"
        )}
      />
    </span>
  );
}

function FlowNode({
  labelKey,
  icon: Icon,
  color,
}: {
  labelKey: string;
  icon: React.ComponentType<{ className?: string }>;
  color: string;
}) {
  const { t } = useTranslation();
  return (
    <span className="inline-flex items-center gap-1 rounded-lg border border-border bg-background px-2 py-1 text-[11px] font-semibold text-foreground shadow-xs">
      <Icon className={cn("size-3", color)} />
      {t(labelKey)}
    </span>
  );
}

function StepCard({ index, title, body }: { index: number; title: string; body: string }) {
  return (
    <div className="flex gap-2.5 rounded-xl border border-border/70 bg-muted/30 p-3">
      <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/15 text-[10px] font-bold text-primary">
        {index}
      </span>
      <div className="min-w-0">
        <p className="text-xs font-semibold text-foreground">{title}</p>
        <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{body}</p>
      </div>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-[11px] font-mono font-semibold uppercase tracking-wide text-muted-foreground">
      {children}
    </h3>
  );
}

/**
 * "How do I connect these?" plus a node cheat sheet, opened from the workflow
 * toolbar and the empty state. Pure explanation — it never changes the graph.
 */
export function WorkflowHelpDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();

  const promptNode = WORKFLOW_NODE_MENU[0];
  const generatorNode = WORKFLOW_NODE_MENU[3];
  const previewNode = WORKFLOW_NODE_MENU[4];

  const steps = [
    {
      title: t("workflow.help.stepDragTitle"),
      body: t("workflow.help.stepDragDesc"),
    },
    {
      title: t("workflow.help.stepMergeTitle"),
      body: t("workflow.help.stepMergeDesc"),
    },
    {
      title: t("workflow.help.stepDeleteTitle"),
      body: t("workflow.help.stepDeleteDesc"),
    },
    {
      title: t("workflow.help.stepRunTitle"),
      body: t("workflow.help.stepRunDesc"),
    },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col gap-4 overflow-hidden sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <HelpCircleIcon className="size-4 text-primary" />
            {t("workflow.help.title")}
          </DialogTitle>
          <DialogDescription className="text-xs leading-relaxed">
            {t("workflow.help.description")}
          </DialogDescription>
        </DialogHeader>

        <div className="-mx-1 min-h-0 flex-1 space-y-5 overflow-y-auto px-1">
          <section className="space-y-2.5">
            <SectionTitle>{t("workflow.help.connectTitle")}</SectionTitle>
            <p className="text-xs leading-relaxed text-muted-foreground">
              {t("workflow.help.connectIntro")}
            </p>

            <div className="flex flex-col items-center gap-1 rounded-xl border border-border bg-muted/40 px-3 py-3 sm:flex-row sm:flex-wrap sm:justify-center sm:gap-2">
              <FlowNode {...promptNode} />
              <FlowArrow labelKey="workflow.help.flowEdgeText" type="text" />
              <FlowNode {...generatorNode} />
              <FlowArrow labelKey="workflow.help.flowEdgeImage" type="image" />
              <FlowNode {...previewNode} />
            </div>

            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-muted-foreground">
              <PortLegendItem type="text" labelKey="workflow.help.legendText" />
              <PortLegendItem type="image" labelKey="workflow.help.legendImage" />
              <span>{t("workflow.help.legendHint")}</span>
            </div>

            <div className="grid gap-2 sm:grid-cols-2">
              {steps.map((step, i) => (
                <StepCard key={step.title} index={i + 1} title={step.title} body={step.body} />
              ))}
            </div>
          </section>

          <section className="space-y-2.5">
            <SectionTitle>{t("workflow.help.nodesTitle")}</SectionTitle>
            <p className="text-xs leading-relaxed text-muted-foreground">
              {t("workflow.help.nodesIntro")}
            </p>

            <div className="divide-y divide-border/60 rounded-xl border border-border/70 bg-muted/30">
              {WORKFLOW_NODE_HELP.map((entry) => {
                const Icon = entry.icon;
                return (
                  <div key={entry.type} className="flex gap-3 p-3">
                    <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg border border-border bg-background">
                      <Icon className={cn("size-3.5", entry.color)} />
                    </div>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-xs font-semibold text-foreground">
                          {t(entry.labelKey)}
                        </span>
                        {entry.inputs.map((port) => (
                          <PortChip key={`in-${port.nameKey}`} port={port} direction="input" />
                        ))}
                        {entry.outputs.map((port) => (
                          <PortChip key={`out-${port.nameKey}`} port={port} direction="output" />
                        ))}
                      </div>
                      <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                        {t(entry.descriptionKey)}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          <p className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] leading-relaxed text-amber-700 dark:text-amber-300">
            {t("workflow.help.historyNote")}
          </p>
        </div>

        <DialogFooter>
          <Button type="button" size="sm" onClick={() => onOpenChange(false)}>
            {t("workflow.help.gotIt")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
