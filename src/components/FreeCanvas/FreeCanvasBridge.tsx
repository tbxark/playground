import React, {
  createContext,
  useContext,
  useLayoutEffect,
  useRef,
  type MutableRefObject,
  type ReactNode,
} from "react";

export type FreeCanvasBridgeApi = {
  /** Fit every card into the unobstructed stage area. */
  fitAll: () => void;
  /** Center a single card (used by "Locate latest result"). */
  focusCard: (id: string) => void;
  /** Frame a specific set of cards, e.g. after lining results up in a row. */
  focusCards: (ids: string[]) => void;
  /** Reset zoom to 100% and park the world at the top-left margin. */
  resetView: () => void;
};

type BridgeRef = MutableRefObject<FreeCanvasBridgeApi | null>;

const FreeCanvasBridgeContext = createContext<BridgeRef | null>(null);

export function FreeCanvasBridgeProvider({ children }: { children: ReactNode }) {
  const ref = useRef<FreeCanvasBridgeApi | null>(null);
  return (
    <FreeCanvasBridgeContext.Provider value={ref}>
      {children}
    </FreeCanvasBridgeContext.Provider>
  );
}

/**
 * The viewport registers its measuring/fit functions for the lifetime of the
 * mounted board. This replaces the old module-level CANVAS_REF singleton: the
 * registration is explicitly removed on unmount and never survives navigation.
 */
export function useRegisterFreeCanvasBridge(api: FreeCanvasBridgeApi): void {
  const ref = useContext(FreeCanvasBridgeContext);
  useLayoutEffect(() => {
    if (!ref) return;
    ref.current = api;
    return () => {
      if (ref.current === api) ref.current = null;
    };
  }, [api, ref]);
}

export function useFreeCanvasBridge(): FreeCanvasBridgeApi | null {
  const ref = useContext(FreeCanvasBridgeContext);
  return ref?.current ?? null;
}
