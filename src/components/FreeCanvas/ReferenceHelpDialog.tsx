import React from "react";
import { useTranslation } from "react-i18next";
import { ImageIcon, InfoIcon, LayersIcon } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { Button } from "../ui/button";

export function ReferenceHelpDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();

  const items = [
    {
      icon: <InfoIcon className="size-4 text-cyan-300" />,
      title: t("freeCanvas.cards.referenceHelpWhatTitle"),
      body: t("freeCanvas.cards.referenceHelpWhat"),
    },
    {
      icon: <LayersIcon className="size-4 text-primary" />,
      title: t("freeCanvas.cards.referenceHelpHowTitle"),
      body: t("freeCanvas.cards.referenceHelpHow"),
    },
    {
      icon: <ImageIcon className="size-4 text-amber-300" />,
      title: t("freeCanvas.cards.referenceHelpLimitTitle"),
      body: t("freeCanvas.cards.referenceHelpLimit"),
    },
    {
      icon: <LayersIcon className="size-4 text-violet-300" />,
      title: t("freeCanvas.cards.referenceHelpFreeTitle"),
      body: t("freeCanvas.cards.referenceHelpFree"),
    },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-base">
            {t("freeCanvas.cards.referenceHelpTitle")}
          </DialogTitle>
          <DialogDescription>
            {t("freeCanvas.cards.referenceHelpIntro")}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          {items.map((item) => (
            <div
              key={item.title}
              className="flex gap-3 rounded-xl border border-border bg-muted/40 p-3"
            >
              <div className="mt-0.5 shrink-0">{item.icon}</div>
              <div className="min-w-0">
                <p className="text-xs font-semibold text-foreground">{item.title}</p>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  {item.body}
                </p>
              </div>
            </div>
          ))}
        </div>

        <DialogFooter>
          <Button type="button" size="sm" onClick={() => onOpenChange(false)}>
            {t("freeCanvas.cards.referenceHelpOpen")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
