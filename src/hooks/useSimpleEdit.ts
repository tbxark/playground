import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  MAX_SIMPLE_IMAGES,
  SimpleImage,
  useFreeCanvasStore,
} from "../stores/useFreeCanvasStore";
import type {
  LightboxEditOutput,
  LightboxEditable,
} from "../stores/useLightboxStore";

type SimpleResultTarget = {
  /** Label stored on the new input (the result prompt or generated name). */
  name: string;
  /** A base image already exists, so applying replaces it. */
  hasInput: boolean;
  /** Offer "add as reference" when a slot is free. */
  allowReference: boolean;
};

/**
 * Simple-mode adapter for the shared image workspace. It never routes through
 * canvas cards: applying writes an independent simple-* asset, which is what
 * the Simple page actually displays and sends to the provider.
 */
export function useSimpleEdit() {
  const { t } = useTranslation();

  const buildResultEditable = useCallback(
    (target: SimpleResultTarget): LightboxEditable => ({
      applyLabel: t("simple.applyAsBase"),
      applyAlternateLabel: target.allowReference
        ? t("simple.addAsReference")
        : undefined,
      applyConfirm: target.hasInput
        ? {
            title: t("simple.replaceBaseTitle"),
            description: t("simple.replaceBaseDesc"),
            confirmLabel: t("simple.replaceBaseConfirm"),
          }
        : undefined,
      onApply: async (output: LightboxEditOutput) => {
        const ok = await useFreeCanvasStore.getState().setSimpleBaseFromBlob({
          blob: output.blob,
          name: target.name,
          width: output.width,
          height: output.height,
        });
        if (!ok) {
          toast.error(t("simple.applyFailed"));
          return false;
        }
        toast.success(t("simple.appliedAsBase"));
        return true;
      },
      onApplyAlternate: target.allowReference
        ? async (output) => {
            const ok = await useFreeCanvasStore
              .getState()
              .addSimpleReferenceFromBlob({
                blob: output.blob,
                name: target.name,
                width: output.width,
                height: output.height,
              });
            if (!ok) {
              // The store already explains the five-slot limit.
              return false;
            }
            toast.success(t("simple.addedAsReference"));
            return true;
          }
        : undefined,
    }),
    [t]
  );

  const buildInputEditable = useCallback(
    (image: SimpleImage): LightboxEditable => ({
      applyLabel: t("simple.applyToInput"),
      onApply: async (output) => {
        const store = useFreeCanvasStore.getState();
        const current = store.simpleImages.find((item) => item.id === image.id);
        if (!current) {
          toast.error(t("simple.inputChanged"));
          return false;
        }
        const ok = await store.replaceSimpleImage(image.id, {
          blob: output.blob,
          width: output.width,
          height: output.height,
          expected: {
            id: image.id,
            assetKey: image.assetKey,
            revision: image.revision ?? 0,
          },
        });
        // replaceSimpleImage reports stale/deleted targets itself; the
        // workspace must stay open when it returns false.
        if (!ok) return false;
        toast.success(t("simple.inputUpdated"));
        return true;
      },
    }),
    [t]
  );

  const applyBlobAsBase = useCallback(
    async (input: { blob: Blob; name: string }) => {
      const ok = await useFreeCanvasStore.getState().setSimpleBaseFromBlob(input);
      if (!ok) {
        toast.error(t("simple.applyFailed"));
        return false;
      }
      toast.success(t("simple.appliedAsBase"));
      return true;
    },
    [t]
  );

  return {
    buildResultEditable,
    buildInputEditable,
    applyBlobAsBase,
    canAddReference: (count: number) => count < MAX_SIMPLE_IMAGES,
  };
}
