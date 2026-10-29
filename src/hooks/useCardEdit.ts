import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useFreeCanvasStore } from "../stores/useFreeCanvasStore";
import type {
  LightboxEditOutput,
  LightboxEditable,
} from "../stores/useLightboxStore";

type EditTarget = {
  cardId: string;
  /** Card name, reused when the edit renames the card / creates a copy. */
  name?: string;
  /** The target is the current main image, so its pending mask is invalidated. */
  isMain?: boolean;
  /** A mask actually exists; the editor asks before discarding it. */
  discardWarning?: boolean;
  /** Offer "apply as new card" next to the primary apply. */
  allowCopy?: boolean;
};

/**
 * Wires the shared editor to canvas cards. Every surface (card menu, dock,
 * viewer) uses this so "apply" means the same thing everywhere: replace the
 * card's bitmap in place as one undo step.
 */
export function useCardEdit() {
  const { t } = useTranslation();

  const applyToCard = useCallback(
    async (
      cardId: string,
      output: LightboxEditOutput,
      options?: { name?: string; clearMask?: boolean }
    ) => {
      const ok = await useFreeCanvasStore.getState().replaceCardImage(cardId, {
        blob: output.blob,
        width: output.width,
        height: output.height,
        name: options?.name,
        clearMask: options?.clearMask,
      });
      if (!ok) {
        toast.error(t("preview.edit.applyFailed"));
        return false;
      }
      toast.success(t("preview.edit.applied"), {
        action: {
          label: t("common.undo"),
          onClick: () => useFreeCanvasStore.getState().undo(),
        },
      });
      return true;
    },
    [t]
  );

  const buildEditable = useCallback(
    (target: EditTarget): LightboxEditable => ({
      applyLabel: t("preview.edit.applyToCard"),
      applyAlternateLabel: target.allowCopy
        ? t("preview.edit.applyAsNewCard")
        : undefined,
      discardWarning: target.discardWarning,
      onApply: (output) =>
        applyToCard(target.cardId, output, {
          name: target.name,
          clearMask: target.isMain,
        }),
      onApplyAlternate: target.allowCopy
        ? async (output) => {
            const id = await useFreeCanvasStore.getState().addLocalResult({
              blob: output.blob,
              width: output.width,
              height: output.height,
              name: t("preview.edit.copyName", {
                name: target.name || t("preview.edit.copyFallback"),
              }),
            });
            if (!id) return false;
            toast.success(t("preview.edit.copied"), {
              action: {
                label: t("common.undo"),
                onClick: () => useFreeCanvasStore.getState().undo(),
              },
            });
            return true;
          }
        : undefined,
    }),
    [applyToCard, t]
  );

  return { buildEditable, applyToCard };
}
