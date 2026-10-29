import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  ArrowRightIcon,
  AlertTriangleIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  Columns2Icon,
  CropIcon,
  DownloadIcon,
  EraserIcon,
  ExpandIcon,
  ExternalLinkIcon,
  FlipHorizontal2Icon,
  FlipVertical2Icon,
  FrameIcon,
  HandIcon,
  Loader2Icon,
  Maximize2Icon,
  MinusIcon,
  PaintbrushIcon,
  PlayIcon,
  PlusIcon,
  RotateCcwIcon,
  RotateCwIcon,
  ScalingIcon,
  ScissorsIcon,
  UndoIcon,
  XIcon,
} from "lucide-react";
import {
  ReactCompareSlider,
  ReactCompareSliderImage,
} from "react-compare-slider";
import { Button } from "../ui/button";
import { Slider } from "../ui/slider";
import { Progress } from "../ui/progress";
import { ConfirmDialog } from "../ui/confirm-dialog";
import { DialogTitle } from "../ui/dialog";
import { useConfigStore } from "../../stores/useConfigStore";
import type {
  LightboxEditOutput,
  LightboxImage,
} from "../../stores/useLightboxStore";
import {
  CROP_RATIO_OPTIONS,
  CropHandle,
  CropRatioId,
  CropRect,
  FULL_CROP,
  applyCropDrag,
  clampCrop,
  fitCropToAspect,
  getCropRatioValue,
} from "../../utils/cropMath";
import {
  ColorStroke,
  EditorGeometry,
  EditorRotation,
  Point,
  canvasToBlob,
  composeEditorCanvas,
  drawEditorComposite,
  getEditorFrame,
  isFullCrop,
  loadImageElement,
} from "../../utils/composeMain";
import { getImageDimensions } from "../../utils/cardSource";
import {
  dataUrlToBlob,
  downloadFile,
  fetchAsBlob,
  formatBytes,
} from "../../utils/file";
import {
  MAX_UPSCALE_AREA,
  MAX_UPSCALE_DIMENSION,
  getUpscaleLimit,
  getUpscaleTarget,
  upscaleImage,
} from "../../services/imageTools/upscale";
import { removeBackground } from "../../services/imageTools/backgroundRemoval";
import type {
  ImageToolProgress,
  ImageToolStage,
  UpscaleFactor,
} from "../../services/imageTools/types";
import { cn } from "@/utils/cn";

/** Preview long edge; full resolution is only built for the committed bitmap. */
const PREVIEW_MAX = 1600;
const DEFAULT_BACKGROUND = "transparent";
const MIN_ACTUAL_ZOOM = 0.1;
const MAX_ACTUAL_ZOOM = 8;
const ZOOM_STEP = 1.25;

const EDITOR_BG_COLORS = [
  { label: "freeCanvas.bgTransparent", value: "transparent" },
  { label: "freeCanvas.bgBlack", value: "#09090b" },
  { label: "freeCanvas.bgWhite", value: "#ffffff" },
  { label: "freeCanvas.bgDarkGray", value: "#27272a" },
];

const EDITOR_BRUSH_COLORS = [
  "#ef4444",
  "#f97316",
  "#eab308",
  "#22c55e",
  "#3b82f6",
  "#a855f7",
  "#ffffff",
];

type EditorTool =
  | "view"
  | "crop"
  | "expand"
  | "annotate"
  | "remove-bg"
  | "upscale";
type EnhanceKind = "background-removal" | "upscale";
type RunPhase = "idle" | "running" | "error";
type SourceEdit = { kind: EnhanceKind; factor?: UpscaleFactor };
type ConfirmIntent = "close" | "reset" | null;

type CropDrag =
  | {
      mode: "new";
      startX: number;
      startY: number;
      anchor: Point;
      startCrop: CropRect;
      rect: DOMRect;
      moved: boolean;
    }
  | {
      mode: "move" | CropHandle;
      startX: number;
      startY: number;
      startCrop: CropRect;
      rect: DOMRect;
    };

const CROP_HANDLES: { id: CropHandle; className: string }[] = [
  { id: "nw", className: "top-1 left-1 cursor-nwse-resize" },
  { id: "n", className: "top-1 left-1/2 -translate-x-1/2 cursor-ns-resize" },
  { id: "ne", className: "top-1 right-1 cursor-nesw-resize" },
  { id: "e", className: "right-1 top-1/2 -translate-y-1/2 cursor-ew-resize" },
  { id: "se", className: "bottom-1 right-1 cursor-nwse-resize" },
  { id: "s", className: "bottom-1 left-1/2 -translate-x-1/2 cursor-ns-resize" },
  { id: "sw", className: "bottom-1 left-1 cursor-nesw-resize" },
  { id: "w", className: "left-1 top-1/2 -translate-y-1/2 cursor-ew-resize" },
];

type ImageWorkspaceProps = {
  image: LightboxImage;
  index: number;
  total: number;
  onClose: () => void;
  onPrevious: () => void;
  onNext: () => void;
  onDirtyChange: (dirty: boolean) => void;
};

async function resolveSourceBlob(url: string): Promise<Blob> {
  if (url.startsWith("data:")) return dataUrlToBlob(url);
  if (url.startsWith("blob:")) {
    const response = await fetch(url);
    if (!response.ok) throw new Error("source-unavailable");
    return response.blob();
  }
  const { corsProxy, corsProxyMode } = useConfigStore.getState();
  return fetchAsBlob(url, {
    corsProxy: corsProxy || undefined,
    corsProxyMode,
  });
}

function imageFormatLabel(blob: Blob | null): string | null {
  if (!blob) return null;
  const type = blob.type.split("/")[1];
  if (!type) return null;
  return type === "jpeg" ? "JPEG" : type.toUpperCase();
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

function aspectLabel(width: number, height: number): string {
  if (!width || !height) return "—";
  const divisor = gcd(width, height);
  const w = width / divisor;
  const h = height / divisor;
  if (w <= 20 && h <= 20) return `${w}:${h}`;
  return `${(width / height).toFixed(2)}:1`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * The merged image workspace: viewing and editing share one shell.
 *
 * Desktop follows an editor layout: tool rail on the left, contextual options
 * on top, canvas in the middle, inspector on the right and a status bar with
 * zoom/dimensions. Narrow screens stack the tool strip and options above the
 * canvas and keep apply/reset in a sticky bottom bar. Pending edits live only
 * in this session; Apply composes the final bitmap and hands it to the caller,
 * which owns where the result goes.
 */
export function ImageWorkspace({
  image,
  index,
  total,
  onClose,
  onPrevious,
  onNext,
  onDirtyChange,
}: ImageWorkspaceProps) {
  const { t } = useTranslation();
  const editingAvailable = Boolean(image.editable);

  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cropLayerRef = useRef<HTMLDivElement>(null);

  const [bitmap, setBitmap] = useState<HTMLImageElement | null>(null);
  const [sourceBlob, setSourceBlob] = useState<Blob | null>(null);
  const [natural, setNatural] = useState({ width: 0, height: 0 });
  const [isLoading, setIsLoading] = useState(editingAvailable);
  const [sourceError, setSourceError] = useState<string | null>(null);
  const [displayError, setDisplayError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const [tool, setTool] = useState<EditorTool>("view");
  const [rotation, setRotation] = useState<EditorRotation>(0);
  const [flipX, setFlipX] = useState(false);
  const [flipY, setFlipY] = useState(false);
  const [padding, setPadding] = useState(0);
  const [background, setBackground] = useState(DEFAULT_BACKGROUND);
  const [crop, setCrop] = useState<CropRect>({ ...FULL_CROP });
  const [cropRatio, setCropRatio] = useState<CropRatioId>("free");
  const [strokes, setStrokes] = useState<ColorStroke[]>([]);
  const [brushColor, setBrushColor] = useState(EDITOR_BRUSH_COLORS[0]);
  const [brushSize, setBrushSize] = useState(12);
  const [sourceEdits, setSourceEdits] = useState<SourceEdit[]>([]);

  const [stageSize, setStageSize] = useState({ width: 0, height: 0 });
  const [box, setBox] = useState({ width: 0, height: 0 });
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [spaceDown, setSpaceDown] = useState(false);
  const [brushCursor, setBrushCursor] = useState<{
    x: number;
    y: number;
    size: number;
  } | null>(null);

  const [compareOn, setCompareOn] = useState(false);

  const [runKind, setRunKind] = useState<EnhanceKind>("background-removal");
  const [factor, setFactor] = useState<UpscaleFactor>(2);
  const [runPhase, setRunPhase] = useState<RunPhase>("idle");
  const [runStage, setRunStage] = useState<ImageToolStage>("prepare");
  const [progress, setProgress] = useState(0);
  const [loadedBytes, setLoadedBytes] = useState<{
    loaded?: number;
    total?: number;
  }>({});
  const [runError, setRunError] = useState<string | null>(null);

  const [isApplying, setIsApplying] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [pendingApply, setPendingApply] = useState<
    "primary" | "alternate" | null
  >(null);
  const [maskConfirmOpen, setMaskConfirmOpen] = useState(false);
  const [confirmIntent, setConfirmIntent] = useState<ConfirmIntent>(null);

  const jobIdRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const drawingRef = useRef<{ points: Point[] } | null>(null);
  const cropDragRef = useRef<CropDrag | null>(null);
  const panRef = useRef<{
    startX: number;
    startY: number;
    baseX: number;
    baseY: number;
  } | null>(null);

  const activeTool: EditorTool = editingAvailable ? tool : "view";

  // Load the bytes behind the viewer URL once per image (or after a retry).
  // View-only images never fetch the blob; their size comes from the <img>.
  useEffect(() => {
    setZoom(1);
    setOffset({ x: 0, y: 0 });
    setCompareOn(false);
    setDisplayError(false);
    setNatural({ width: 0, height: 0 });

    if (!editingAvailable) {
      setBitmap(null);
      setSourceBlob(null);
      setIsLoading(false);
      setSourceError(null);
      return;
    }

    let cancelled = false;
    setIsLoading(true);
    setSourceError(null);
    setBitmap(null);

    const load = async () => {
      try {
        const blob = await resolveSourceBlob(image.url);
        if (cancelled) return;
        const element = await loadImageElement(blob);
        if (cancelled) return;
        const width = element.naturalWidth || element.width || 1;
        const height = element.naturalHeight || element.height || 1;

        setSourceBlob(blob);
        setBitmap(element);
        setNatural({ width, height });
        setDisplayError(false);
        setBrushSize(Math.max(2, Math.round(Math.max(width, height) * 0.008)));
        setRotation(0);
        setFlipX(false);
        setFlipY(false);
        setPadding(0);
        setBackground(DEFAULT_BACKGROUND);
        setCrop({ ...FULL_CROP });
        setCropRatio("free");
        setStrokes([]);
        setSourceEdits([]);
      } catch (error) {
        if (cancelled) return;
        setSourceError(
          error instanceof Error ? error.message : String(error)
        );
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [image.url, editingAvailable, reloadKey]);

  // The card menu's "Edit image" opens straight into crop instead of a mode.
  useEffect(() => {
    setTool(image.initialMode === "edit" ? "crop" : "view");
  }, [image.url, image.initialMode]);

  useEffect(
    () => () => {
      jobIdRef.current += 1;
      abortRef.current?.abort();
    },
    []
  );

  const geometry: EditorGeometry = useMemo(
    () => ({ rotation, flipX, flipY, padding, background }),
    [rotation, flipX, flipY, padding, background]
  );

  const frame = useMemo(
    () =>
      natural.width > 0
        ? getEditorFrame(natural.width, natural.height, { rotation, padding })
        : null,
    [natural, rotation, padding]
  );

  const previewScale = frame
    ? Math.min(1, PREVIEW_MAX / Math.max(frame.width, frame.height))
    : 1;
  const previewWidth = frame
    ? Math.max(1, Math.round(frame.width * previewScale))
    : 0;
  const previewHeight = frame
    ? Math.max(1, Math.round(frame.height * previewScale))
    : 0;

  const cropPixels = useMemo(
    () =>
      frame
        ? {
            width: Math.max(1, Math.round(frame.width * crop.w)),
            height: Math.max(1, Math.round(frame.height * crop.h)),
          }
        : null,
    [frame, crop.w, crop.h]
  );

  const geometryDirty =
    rotation !== 0 ||
    flipX ||
    flipY ||
    padding > 0 ||
    background !== DEFAULT_BACKGROUND;
  const isDirty =
    sourceEdits.length > 0 ||
    geometryDirty ||
    !isFullCrop(crop) ||
    strokes.length > 0;

  useEffect(() => {
    onDirtyChange(isDirty);
  }, [isDirty, onDirtyChange]);

  useEffect(() => () => onDirtyChange(false), [onDirtyChange]);

  // Stage box: fit the working frame inside the measured area. Layout size and
  // the visual (zoomed) size stay separate so crop overlays can be drawn in
  // stage coordinates with constant-size handles.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;

    const update = () => {
      const width = Math.max(1, stage.clientWidth);
      const height = Math.max(1, stage.clientHeight);
      setStageSize({ width, height });
      const aspect = frame
        ? frame.width / frame.height
        : natural.width > 0 && natural.height > 0
          ? natural.width / natural.height
          : 0;
      if (width <= 1 || height <= 1 || aspect <= 0) return;
      let nextWidth = width;
      let nextHeight = width / aspect;
      if (nextHeight > height) {
        nextHeight = height;
        nextWidth = height * aspect;
      }
      setBox({
        width: Math.max(1, Math.round(nextWidth)),
        height: Math.max(1, Math.round(nextHeight)),
      });
    };

    const observer = new ResizeObserver(update);
    observer.observe(stage);
    update();
    return () => observer.disconnect();
  }, [frame, natural.width, natural.height]);

  const visual = useMemo(() => {
    const width = box.width * zoom;
    const height = box.height * zoom;
    return {
      left: (stageSize.width - width) / 2 + offset.x,
      top: (stageSize.height - height) / 2 + offset.y,
      width,
      height,
    };
  }, [box.width, box.height, zoom, offset.x, offset.y, stageSize]);

  const fitScale = box.width > 0 && frame ? box.width / frame.width : 0;
  const actualZoom = fitScale > 0 ? zoom * fitScale : zoom;
  const zoomPercent = Math.max(1, Math.round(actualZoom * 100));

  const clampZoom = useCallback(
    (value: number) => {
      if (fitScale <= 0) return clamp(value, 0.25, 4);
      return clamp(
        value,
        MIN_ACTUAL_ZOOM / fitScale,
        MAX_ACTUAL_ZOOM / fitScale
      );
    },
    [fitScale]
  );

  const clampOffset = useCallback(
    (value: { x: number; y: number }, zoomValue: number) => {
      const visualWidth = box.width * zoomValue;
      const visualHeight = box.height * zoomValue;
      const maxX = Math.max(0, (visualWidth - stageSize.width) / 2);
      const maxY = Math.max(0, (visualHeight - stageSize.height) / 2);
      return {
        x: clamp(value.x, -maxX, maxX),
        y: clamp(value.y, -maxY, maxY),
      };
    },
    [box.width, box.height, stageSize]
  );

  useEffect(() => {
    setOffset((previous) => {
      const next = clampOffset(previous, zoom);
      return next.x === previous.x && next.y === previous.y ? previous : next;
    });
  }, [clampOffset, zoom]);

  const resetView = useCallback(() => {
    setZoom(1);
    setOffset({ x: 0, y: 0 });
  }, []);

  const zoomBy = useCallback(
    (direction: 1 | -1) => {
      const nextZoom = clampZoom(zoom * (direction > 0 ? ZOOM_STEP : 1 / ZOOM_STEP));
      setZoom(nextZoom);
      setOffset((previous) => clampOffset(previous, nextZoom));
    },
    [clampOffset, clampZoom, zoom]
  );

  const zoomToActual = useCallback(() => {
    if (fitScale <= 0) return;
    setZoom(clampZoom(1 / fitScale));
    setOffset({ x: 0, y: 0 });
  }, [clampZoom, fitScale]);

  // Wheel zoom around the cursor, including ctrl+wheel from trackpad pinch.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;

    const handleWheel = (event: WheelEvent) => {
      if (compareOn || box.width <= 0) return;
      event.preventDefault();
      const rect = stage.getBoundingClientRect();
      const pointer = {
        x: event.clientX - (rect.left + rect.width / 2),
        y: event.clientY - (rect.top + rect.height / 2),
      };
      const nextZoom = clampZoom(zoom * Math.exp(-event.deltaY * 0.0015));
      if (nextZoom === zoom) return;
      const ratio = nextZoom / zoom;
      const nextOffset = {
        x: pointer.x - (pointer.x - offset.x) * ratio,
        y: pointer.y - (pointer.y - offset.y) * ratio,
      };
      setZoom(nextZoom);
      setOffset(clampOffset(nextOffset, nextZoom));
    };

    stage.addEventListener("wheel", handleWheel, { passive: false });
    return () => stage.removeEventListener("wheel", handleWheel);
  }, [box.width, clampOffset, clampZoom, compareOn, offset, zoom]);

  // Redraw the preview whenever the working state changes. Only the preview
  // resolution is rendered here; Apply rebuilds at full resolution.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !frame || !bitmap || previewWidth === 0) return;
    if (canvas.width !== previewWidth) canvas.width = previewWidth;
    if (canvas.height !== previewHeight) canvas.height = previewHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    drawEditorComposite(ctx, {
      image: bitmap,
      frame,
      geometry,
      strokes,
      scale: previewScale,
    });
  }, [
    bitmap,
    frame,
    geometry,
    strokes,
    previewScale,
    previewWidth,
    previewHeight,
    box.width,
    box.height,
  ]);

  // Locked ratios re-fit when the ratio or frame aspect changes.
  useEffect(() => {
    if (activeTool !== "crop" || !frame) return;
    const ratio = getCropRatioValue(cropRatio);
    if (ratio === null) return;
    setCrop((previous) =>
      fitCropToAspect(previous, ratio, frame.width / frame.height)
    );
  }, [cropRatio, activeTool, frame]);

  const brushMax = Math.max(
    8,
    Math.round(Math.max(natural.width, natural.height) * 0.08)
  );

  const toStagePoint = (clientX: number, clientY: number): Point | null => {
    const stage = stageRef.current;
    if (!stage || visual.width <= 0 || visual.height <= 0) return null;
    const rect = stage.getBoundingClientRect();
    return { x: clientX - rect.left, y: clientY - rect.top };
  };

  const toWorkPoint = (clientX: number, clientY: number): Point | null => {
    const stagePoint = toStagePoint(clientX, clientY);
    if (!stagePoint || !frame || visual.width <= 0) return null;
    return {
      x: ((stagePoint.x - visual.left) / visual.width) * frame.width,
      y: ((stagePoint.y - visual.top) / visual.height) * frame.height,
    };
  };

  const toNormalized = (clientX: number, clientY: number): Point | null => {
    const stagePoint = toStagePoint(clientX, clientY);
    if (!stagePoint || visual.width <= 0 || visual.height <= 0) return null;
    return {
      x: clamp((stagePoint.x - visual.left) / visual.width, 0, 1),
      y: clamp((stagePoint.y - visual.top) / visual.height, 0, 1),
    };
  };

  const drawLiveSegment = (from: Point, to: Point) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = brushColor;
    ctx.lineWidth = Math.max(1, brushSize * previewScale);
    ctx.beginPath();
    ctx.moveTo(from.x * previewScale, from.y * previewScale);
    ctx.lineTo(to.x * previewScale, to.y * previewScale);
    ctx.stroke();
    ctx.restore();
  };

  const handleAnnotateDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (event.button !== 0 || activeTool !== "annotate" || spaceDown) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = toWorkPoint(event.clientX, event.clientY);
    if (!point) return;
    drawingRef.current = { points: [point] };
  };

  const handleAnnotateMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const drawing = drawingRef.current;
    if (!drawing || activeTool !== "annotate") return;
    const point = toWorkPoint(event.clientX, event.clientY);
    if (!point) return;
    const previous = drawing.points[drawing.points.length - 1];
    drawing.points.push(point);
    drawLiveSegment(previous, point);
  };

  const handleAnnotateUp = () => {
    const drawing = drawingRef.current;
    drawingRef.current = null;
    if (!drawing || drawing.points.length === 0) return;
    setStrokes((previous) => [
      ...previous,
      { points: drawing.points, size: brushSize, color: brushColor },
    ]);
  };

  const startCropDrag = (
    event: React.PointerEvent,
    mode: CropDrag["mode"]
  ) => {
    if (event.button !== 0 || activeTool !== "crop" || spaceDown) return;
    const layer = cropLayerRef.current;
    if (!layer) return;
    event.preventDefault();
    event.stopPropagation();
    layer.setPointerCapture(event.pointerId);
    const rect = layer.getBoundingClientRect();
    const normalized = toNormalized(event.clientX, event.clientY);
    if (mode === "new") {
      if (!normalized) return;
      cropDragRef.current = {
        mode: "new",
        startX: event.clientX,
        startY: event.clientY,
        anchor: normalized,
        startCrop: { ...crop },
        rect,
        moved: false,
      };
      return;
    }
    cropDragRef.current = {
      mode,
      startX: event.clientX,
      startY: event.clientY,
      startCrop: { ...crop },
      rect,
    };
  };

  const handleCropMove = (event: React.PointerEvent) => {
    const drag = cropDragRef.current;
    if (!drag || !frame) return;
    const rectWidth = visual.width || drag.rect.width;
    const rectHeight = visual.height || drag.rect.height;
    if (rectWidth <= 0 || rectHeight <= 0) return;
    const dx = (event.clientX - drag.startX) / rectWidth;
    const dy = (event.clientY - drag.startY) / rectHeight;
    const ratio = getCropRatioValue(cropRatio);
    const frameAspect = frame.width / frame.height;

    if (drag.mode === "new") {
      const current = toNormalized(event.clientX, event.clientY);
      if (!current) return;
      const x = Math.min(drag.anchor.x, current.x);
      const y = Math.min(drag.anchor.y, current.y);
      const w = Math.abs(current.x - drag.anchor.x);
      const h = Math.abs(current.y - drag.anchor.y);
      if (w < 0.01 || h < 0.01) return;
      drag.moved = true;
      const next = ratio
        ? fitCropToAspect({ x, y, w, h }, ratio, frameAspect)
        : clampCrop({ x, y, w, h });
      setCrop(next);
      return;
    }

    setCrop(
      applyCropDrag(
        drag.startCrop,
        drag.mode,
        dx,
        dy,
        ratio,
        frameAspect
      )
    );
  };

  const endCropDrag = () => {
    const drag = cropDragRef.current;
    cropDragRef.current = null;
    if (drag?.mode === "new" && !drag.moved) setCrop(drag.startCrop);
  };

  const rotate = (delta: 90 | -90) => {
    setRotation((previous) => {
      const next = (previous + delta + 360) % 360;
      return next as EditorRotation;
    });
    // Stroke coordinates are tied to the rotated frame; a quarter turn would
    // silently move them, so a rotation starts a fresh annotation layer.
    setCrop({ ...FULL_CROP });
    setCropRatio("free");
    setStrokes([]);
  };

  const flip = (axis: "x" | "y") => {
    if (!frame) return;
    if (axis === "x") {
      const width = frame.width;
      setFlipX((previous) => !previous);
      setStrokes((previous) =>
        previous.map((stroke) => ({
          ...stroke,
          points: stroke.points.map((point) => ({
            x: width - point.x,
            y: point.y,
          })),
        }))
      );
      setCrop((previous) =>
        clampCrop({ ...previous, x: 1 - previous.x - previous.w })
      );
    } else {
      const height = frame.height;
      setFlipY((previous) => !previous);
      setStrokes((previous) =>
        previous.map((stroke) => ({
          ...stroke,
          points: stroke.points.map((point) => ({
            x: point.x,
            y: height - point.y,
          })),
        }))
      );
      setCrop((previous) =>
        clampCrop({ ...previous, y: 1 - previous.y - previous.h })
      );
    }
  };

  // Expanding only adds margin around the image, so existing strokes shift by
  // the delta. The crop frame is normalized to the working canvas and stays put:
  // scaling it with the margin would crop the new margin away again.
  const changePadding = (next: number) => {
    if (!frame) return;
    const nextPadX = Math.round(frame.rotW * next) - frame.padX;
    const nextPadY = Math.round(frame.rotH * next) - frame.padY;
    setPadding(next);
    if (nextPadX === 0 && nextPadY === 0) return;

    setStrokes((previous) =>
      previous.map((stroke) => ({
        ...stroke,
        points: stroke.points.map((point) => ({
          x: point.x + nextPadX,
          y: point.y + nextPadY,
        })),
      }))
    );
  };

  const changeCropRatio = (next: CropRatioId) => {
    setCropRatio(next);
    const ratio = getCropRatioValue(next);
    if (ratio === null || !frame) return;
    setCrop((previous) =>
      fitCropToAspect(previous, ratio, frame.width / frame.height)
    );
  };

  const resetCrop = () => {
    setCrop({ ...FULL_CROP });
    setCropRatio("free");
  };

  const composeOutput = useCallback(async (): Promise<LightboxEditOutput | null> => {
    if (!bitmap) return null;
    if (!isDirty) return null;

    // An enhance run already produced final pixels with no pending geometry.
    if (!geometryDirty && isFullCrop(crop) && strokes.length === 0) {
      if (!sourceBlob) return null;
      return {
        blob: sourceBlob,
        width: natural.width,
        height: natural.height,
      };
    }

    const canvas = composeEditorCanvas(
      bitmap,
      natural.width,
      natural.height,
      geometry,
      crop,
      strokes
    );
    const blob = await canvasToBlob(canvas);
    return { blob, width: canvas.width, height: canvas.height };
  }, [
    bitmap,
    sourceBlob,
    natural,
    geometry,
    crop,
    strokes,
    geometryDirty,
    isDirty,
  ]);

  const runApply = async (which: "primary" | "alternate") => {
    const handler =
      which === "primary" ? image.editable?.onApply : image.editable?.onApplyAlternate;
    if (!handler) return;
    setIsApplying(true);
    setApplyError(null);
    try {
      const output = await composeOutput();
      if (!output) {
        setApplyError(t("preview.edit.noChanges"));
        return;
      }
      const accepted = await handler(output);
      if (accepted === false) return;
      onClose();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setApplyError(message);
      toast.error(t("preview.edit.applyFailed"));
    } finally {
      setIsApplying(false);
    }
  };

  const requestApply = (which: "primary" | "alternate") => {
    if (!isDirty || isApplying || runPhase === "running") return;
    if (image.editable?.discardWarning) {
      setPendingApply(which);
      setMaskConfirmOpen(true);
      return;
    }
    void runApply(which);
  };

  const confirmDiscardAndApply = () => {
    const which = pendingApply;
    setPendingApply(null);
    setMaskConfirmOpen(false);
    if (which) void runApply(which);
  };

  const abortRun = useCallback(() => {
    jobIdRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    setRunPhase("idle");
    setRunStage("prepare");
    setProgress(0);
    setLoadedBytes({});
    setRunError(null);
  }, []);

  const exitCompare = useCallback(() => {
    setCompareOn(false);
  }, []);

  const resetWorkspace = useCallback(() => {
    abortRun();
    exitCompare();
    setApplyError(null);
    setReloadKey((value) => value + 1);
  }, [abortRun, exitCompare]);

  const requestReset = useCallback(() => {
    if (!isDirty || isApplying) return;
    setConfirmIntent("reset");
  }, [isApplying, isDirty]);

  const requestClose = useCallback(() => {
    if (isApplying) return;
    if (runPhase === "running") abortRun();
    if (isDirty) {
      setConfirmIntent("close");
      return;
    }
    onClose();
  }, [abortRun, isApplying, isDirty, onClose, runPhase]);

  // Esc closes, asks first when work is pending, and leaves compare first.
  // Capture phase so Radix never treats the same keydown as "close the viewer"
  // behind our confirm dialog.
  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (confirmIntent !== null || maskConfirmOpen) return;
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }
      if (!editingAvailable) return;
      event.preventDefault();
      event.stopPropagation();
      // Esc cancels the running enhance first, like leaving a tool, and only a
      // later Esc closes the workspace.
      if (runPhase === "running") {
        abortRun();
        return;
      }
      if (compareOn) {
        exitCompare();
        return;
      }
      requestClose();
    };
    window.addEventListener("keydown", handleKey, true);
    return () => window.removeEventListener("keydown", handleKey, true);
  }, [
    abortRun,
    compareOn,
    confirmIntent,
    editingAvailable,
    exitCompare,
    maskConfirmOpen,
    requestClose,
    runPhase,
  ]);

  const chooseTool = useCallback(
    (next: EditorTool) => {
      if (next !== "view" && (isLoading || sourceError)) return;
      if (compareOn) exitCompare();
      setTool(next);
    },
    [compareOn, exitCompare, isLoading, sourceError]
  );

  // Viewer/tool shortcuts. Arrow keys switch images only when nothing is
  // pending, so a switch can never silently throw away edits.
  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }
      if (confirmIntent !== null || maskConfirmOpen) return;
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable ||
          target.closest('[role="slider"]') ||
          target.closest('[role="listbox"]'))
      ) {
        return;
      }
      if (event.key === "Escape") return; // handled by the layered handler
      if (event.key === " " || event.code === "Space") {
        // Keep Space-pan working after a toolbar click: the focused button
        // still activates on keyup, but the hold state must be recorded.
        setSpaceDown(true);
        if (!target?.closest("button, a")) event.preventDefault();
        return;
      }
      if (compareOn) return;
      if (event.key === "ArrowLeft") {
        if (!isDirty && total > 1) {
          event.preventDefault();
          onPrevious();
        }
        return;
      }
      if (event.key === "ArrowRight") {
        if (!isDirty && total > 1) {
          event.preventDefault();
          onNext();
        }
        return;
      }
      if (event.key === "+" || event.key === "=") {
        event.preventDefault();
        zoomBy(1);
        return;
      }
      if (event.key === "-" || event.key === "_") {
        event.preventDefault();
        zoomBy(-1);
        return;
      }
      if (event.key === "0") {
        event.preventDefault();
        resetView();
        return;
      }
      if (!editingAvailable) return;
      const key = event.key.toLowerCase();
      const map: Record<string, EditorTool> = {
        v: "view",
        c: "crop",
        e: "expand",
        b: "annotate",
        r: "remove-bg",
        u: "upscale",
      };
      if (map[key]) {
        event.preventDefault();
        chooseTool(map[key]);
      }
    };
    const handleUp = (event: KeyboardEvent) => {
      if (event.key === " " || event.code === "Space") setSpaceDown(false);
    };
    const handleBlur = () => setSpaceDown(false);
    window.addEventListener("keydown", handleKey);
    window.addEventListener("keyup", handleUp);
    window.addEventListener("blur", handleBlur);
    return () => {
      window.removeEventListener("keydown", handleKey);
      window.removeEventListener("keyup", handleUp);
      window.removeEventListener("blur", handleBlur);
    };
  }, [
    chooseTool,
    compareOn,
    confirmIntent,
    editingAvailable,
    isDirty,
    maskConfirmOpen,
    onNext,
    onPrevious,
    resetView,
    total,
    zoomBy,
  ]);

  const handlePanDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (compareOn) return;
    const wantsPan =
      event.button === 1 ||
      spaceDown ||
      (activeTool === "view" && zoom > 1 && event.button === 0);
    if (!wantsPan) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    panRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      baseX: offset.x,
      baseY: offset.y,
    };
    setIsPanning(true);
  };

  const handlePanMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const pan = panRef.current;
    if (pan) {
      setOffset(
        clampOffset(
          {
            x: pan.baseX + (event.clientX - pan.startX),
            y: pan.baseY + (event.clientY - pan.startY),
          },
          zoom
        )
      );
      return;
    }
    if (activeTool === "annotate" && event.pointerType === "mouse") {
      const stagePoint = toStagePoint(event.clientX, event.clientY);
      if (!stagePoint || !frame || visual.width <= 0) {
        setBrushCursor(null);
        return;
      }
      const inside =
        stagePoint.x >= visual.left &&
        stagePoint.x <= visual.left + visual.width &&
        stagePoint.y >= visual.top &&
        stagePoint.y <= visual.top + visual.height;
      if (!inside) {
        setBrushCursor(null);
        return;
      }
      setBrushCursor({
        x: stagePoint.x,
        y: stagePoint.y,
        size: Math.max(4, brushSize * (visual.width / frame.width)),
      });
    }
  };

  const handlePanUp = () => {
    if (!panRef.current) return;
    panRef.current = null;
    setIsPanning(false);
  };

  const upscaleLimit = useMemo(() => {
    if (!cropPixels) return null;
    return getUpscaleLimit(cropPixels.width, cropPixels.height, factor);
  }, [cropPixels, factor]);

  const upscaleTarget = cropPixels
    ? getUpscaleTarget(cropPixels.width, cropPixels.height, factor)
    : null;

  const upscaleLimitMessage = useMemo(() => {
    if (!upscaleLimit || !upscaleTarget) return null;
    return t(
      upscaleLimit === "dimension"
        ? "imageTools.upscaleLimitDimension"
        : "imageTools.upscaleLimitArea",
      {
        width: upscaleTarget.width,
        height: upscaleTarget.height,
        limit: MAX_UPSCALE_DIMENSION,
        area: Math.round(MAX_UPSCALE_AREA / 1_000_000),
      }
    );
  }, [upscaleLimit, upscaleTarget, t]);

  const handleRun = async (kind: EnhanceKind) => {
    if (!bitmap || !frame || runPhase === "running") return;
    if (kind === "upscale" && upscaleLimit) return;

    setRunKind(kind);
    const jobId = ++jobIdRef.current;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setRunPhase("running");
    setRunStage("prepare");
    setProgress(2);
    setLoadedBytes({});
    setRunError(null);

    try {
      // The effect runs on exactly what the crop frame would commit.
      const inputCanvas = composeEditorCanvas(
        bitmap,
        natural.width,
        natural.height,
        geometry,
        crop,
        strokes
      );
      const inputBlob = await canvasToBlob(inputCanvas);
      if (jobId !== jobIdRef.current) return;

      const onProgress = (update: ImageToolProgress) => {
        if (jobId !== jobIdRef.current) return;
        setRunStage(update.stage);
        setLoadedBytes({ loaded: update.loaded, total: update.total });
        setProgress((value) => Math.max(value, update.progress));
      };

      let output: { blob: Blob; width: number; height: number };
      if (kind === "background-removal") {
        const blob = await removeBackground(inputBlob, {
          signal: controller.signal,
          onProgress,
        });
        const dimensions = await getImageDimensions(blob);
        output = { blob, ...dimensions };
      } else {
        output = await upscaleImage(inputBlob, factor, {
          signal: controller.signal,
          onProgress,
        });
      }

      if (jobId !== jobIdRef.current) return;
      const element = await loadImageElement(output.blob);
      if (jobId !== jobIdRef.current) return;

      // The effect baked geometry and crop into pixels, so the session starts
      // from a clean frame again (which also lets tools be chained).
      setSourceBlob(output.blob);
      setBitmap(element);
      setNatural({ width: output.width, height: output.height });
      setRotation(0);
      setFlipX(false);
      setFlipY(false);
      setPadding(0);
      setBackground(DEFAULT_BACKGROUND);
      setCrop({ ...FULL_CROP });
      setCropRatio("free");
      setStrokes([]);
      setBrushSize(
        Math.max(
          2,
          Math.round(Math.max(output.width, output.height) * 0.008)
        )
      );
      setSourceEdits((previous) => [
        ...previous,
        kind === "upscale"
          ? { kind: "upscale", factor }
          : { kind: "background-removal" },
      ]);
      setRunPhase("idle");
      setRunStage("encode");
      setProgress(0);
      setLoadedBytes({});
      toast.success(t("preview.edit.previewUpdated"));
    } catch (error) {
      if (jobId !== jobIdRef.current) return;
      if (error instanceof DOMException && error.name === "AbortError") {
        setRunPhase("idle");
        setProgress(0);
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      setRunError(
        message.startsWith("upscale-limit-")
          ? t("imageTools.upscaleLimitShort")
          : message
      );
      setRunPhase("error");
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
  };

  const statusText = useMemo(() => {
    if (runKind === "upscale") {
      if (runStage === "prepare") return t("imageTools.statusPreparing");
      if (runStage === "encode") return t("imageTools.statusEncode");
      return t("imageTools.statusResample");
    }
    switch (runStage) {
      case "download":
        return t("imageTools.statusDownload", {
          progress: Math.round(progress),
        });
      case "load":
        return t("imageTools.statusLoad");
      case "infer":
        return t("imageTools.statusInfer");
      case "encode":
        return t("imageTools.statusEncode");
      default:
        return t("imageTools.statusRuntime");
    }
  }, [runKind, runStage, progress, t]);

  // Compare shows the committed bitmap against the original. Pending edits are
  // deliberately excluded: a cropped/expanded working frame has a different
  // aspect than the original, and a slider between mismatched frames reads as
  // two unrelated images.
  const toggleCompare = () => {
    if (compareOn) {
      exitCompare();
      return;
    }
    if (!image.compareSrc || isDirty) return;
    setCompareOn(true);
  };

  const handleDownload = async () => {
    const fileName =
      image.fileName ||
      `playground_${image.title?.trim() ? image.title.trim().replace(/\s+/g, "_") : Date.now()}.png`;
    if (image.url.startsWith("blob:") || image.url.startsWith("data:")) {
      if (!downloadFile(image.url, fileName)) {
        toast.error(t("err.downloadBlocked"));
      }
      return;
    }
    // A cross-origin <a download> is ignored and navigates the tab away, losing
    // unsaved canvas state. Resolve the bytes first, through the configured
    // proxy when needed.
    try {
      const { corsProxy, corsProxyMode } = useConfigStore.getState();
      const blob = await fetchAsBlob(image.url, {
        corsProxy: corsProxy || undefined,
        corsProxyMode,
      });
      if (!downloadFile(blob, fileName)) {
        toast.error(t("err.downloadBlocked"));
      }
    } catch {
      toast.error(t("err.downloadBlocked"));
    }
  };

  const runAction = async (actionId: string) => {
    const action = image.actions?.find((item) => item.id === actionId);
    if (!action) return;
    setPendingAction(actionId);
    try {
      await action.onSelect();
    } finally {
      setPendingAction(null);
      if (!action.keepOpen) onClose();
    }
  };

  const changes = useMemo(() => {
    const items: { id: string; label: string }[] = [];
    sourceEdits.forEach((edit, editIndex) => {
      items.push({
        id: `source-${editIndex}-${edit.kind}`,
        label:
          edit.kind === "upscale"
            ? t("preview.workspace.upscaleChange", { factor: edit.factor })
            : t("preview.workspace.backgroundChange"),
      });
    });
    if (rotation !== 0) {
      items.push({
        id: "rotation",
        label: t("preview.workspace.rotateChange", { degrees: rotation }),
      });
    }
    if (flipX) {
      items.push({
        id: "flip-x",
        label: t("preview.workspace.flipXChange"),
      });
    }
    if (flipY) {
      items.push({
        id: "flip-y",
        label: t("preview.workspace.flipYChange"),
      });
    }
    if (!isFullCrop(crop) && cropPixels) {
      items.push({
        id: "crop",
        label: t("preview.workspace.cropChange", {
          width: cropPixels.width,
          height: cropPixels.height,
        }),
      });
    }
    if (padding > 0) {
      items.push({
        id: "padding",
        label: t("preview.workspace.paddingChange", {
          percent: Math.round(padding * 100),
        }),
      });
    }
    if (strokes.length > 0) {
      items.push({
        id: "strokes",
        label: t("preview.workspace.strokesChange", { n: strokes.length }),
      });
    }
    return items;
  }, [
    crop,
    cropPixels,
    flipX,
    flipY,
    padding,
    rotation,
    sourceEdits,
    strokes.length,
    t,
  ]);

  const outputDiffers =
    Boolean(cropPixels) &&
    natural.width > 0 &&
    (cropPixels!.width !== natural.width || cropPixels!.height !== natural.height);

  const formatLabel = imageFormatLabel(sourceBlob);
  const aspectText = aspectLabel(natural.width, natural.height);
  const canApply = isDirty && !isApplying && runPhase !== "running";

  const tools = [
    {
      id: "view" as const,
      label: t("preview.workspace.view"),
      icon: HandIcon,
      key: "V",
    },
    {
      id: "crop" as const,
      label: t("preview.edit.crop"),
      icon: CropIcon,
      key: "C",
    },
    {
      id: "expand" as const,
      label: t("preview.edit.expand"),
      icon: ExpandIcon,
      key: "E",
    },
    {
      id: "annotate" as const,
      label: t("preview.edit.annotate"),
      icon: PaintbrushIcon,
      key: "B",
    },
    {
      id: "remove-bg" as const,
      label: t("preview.edit.removeBackgroundShort"),
      icon: ScissorsIcon,
      key: "R",
    },
    {
      id: "upscale" as const,
      label: t("preview.edit.upscale"),
      icon: ScalingIcon,
      key: "U",
    },
  ];

  const toolsBlockedBySource = isLoading || Boolean(sourceError);
  const runInProgress = runPhase === "running";
  const canSwitch = total > 1;
  const canPanCursor =
    !compareOn && (spaceDown || (activeTool === "view" && zoom > 1));
  const activeToolLabel =
    tools.find((item) => item.id === activeTool)?.label ?? "";
  const activeToolHint =
    activeTool === "view"
      ? t("preview.workspace.viewHint")
      : activeTool === "crop"
        ? t("preview.edit.cropHint")
        : activeTool === "expand"
          ? t("preview.edit.expandHint")
          : activeTool === "annotate"
            ? t("preview.edit.annotateHint")
            : activeTool === "upscale"
              ? t("imageTools.upscaleNote")
              : t("imageTools.backgroundNote");

  const cropVisual = {
    left: visual.left + crop.x * visual.width,
    top: visual.top + crop.y * visual.height,
    width: crop.w * visual.width,
    height: crop.h * visual.height,
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-white/10 bg-zinc-950/80 px-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <DialogTitle className="truncate text-sm font-semibold leading-5 text-zinc-100">
              {image.title || t("preview.dialogTitle")}
            </DialogTitle>
            {isDirty && (
              <span
                className="size-1.5 shrink-0 rounded-full bg-amber-400"
                title={t("preview.workspace.unsaved")}
              />
            )}
          </div>
          {image.subtitle && (
            <p className="truncate text-[11px] leading-4 text-zinc-500">
              {image.subtitle}
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {!editingAvailable && (
            <span
              className="mr-1 rounded border border-white/10 bg-white/[0.04] px-1.5 py-0.5 text-[10px] font-medium text-zinc-400"
              title={t("preview.workspace.previewOnlyHint")}
            >
              {t("preview.workspace.previewOnly")}
            </span>
          )}
          {canSwitch && (
            <span className="mr-1 font-mono text-[11px] tabular-nums text-zinc-400">
              {t("preview.counter", { index: index + 1, total })}
            </span>
          )}
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="text-zinc-400 hover:text-white"
            title={t("preview.openInNewTab")}
            aria-label={t("preview.openInNewTab")}
            onClick={() =>
              window.open(image.url, "_blank", "noopener,noreferrer")
            }
          >
            <ExternalLinkIcon />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="text-zinc-400 hover:text-white"
            title={t("preview.close")}
            aria-label={t("preview.close")}
            onClick={requestClose}
          >
            <XIcon />
          </Button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {editingAvailable && (
          <nav
            aria-label={t("preview.workspace.tools")}
            className="hidden w-[52px] shrink-0 flex-col items-center gap-1 border-r border-white/10 bg-zinc-950 px-1.5 py-2 lg:flex"
          >
            {tools.map((item) => {
              const Icon = item.icon;
              const disabled =
                (item.id !== "view" && toolsBlockedBySource) ||
                (runInProgress &&
                  (item.id === "remove-bg" || item.id === "upscale") &&
                  item.id !== activeTool);
              const active = activeTool === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  aria-pressed={active}
                  aria-label={item.label}
                  title={t("preview.workspace.toolShortcut", {
                    label: item.label,
                    key: item.key,
                  })}
                  disabled={disabled}
                  onClick={() => chooseTool(item.id)}
                  className={cn(
                    "relative flex size-10 items-center justify-center rounded-lg transition-colors",
                    active
                      ? "bg-white/10 text-white ring-1 ring-inset ring-white/10"
                      : "text-zinc-300 hover:bg-white/[0.07] hover:text-white",
                    disabled && "cursor-not-allowed opacity-35"
                  )}
                >
                  {active && (
                    <span className="absolute -left-1.5 top-2 bottom-2 w-0.5 rounded-full bg-primary" />
                  )}
                  <Icon className="size-5" />
                </button>
              );
            })}
          </nav>
        )}

        <div className="flex min-w-0 flex-1 flex-col">
          {editingAvailable && (
            <div className="no-scrollbar flex h-11 shrink-0 items-center gap-1 overflow-x-auto border-b border-white/10 bg-zinc-950 px-2 lg:hidden">
              {tools.map((item) => {
                const Icon = item.icon;
                const disabled =
                  (item.id !== "view" && toolsBlockedBySource) ||
                  (runInProgress &&
                    (item.id === "remove-bg" || item.id === "upscale") &&
                    item.id !== activeTool);
                const active = activeTool === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    aria-pressed={active}
                    disabled={disabled}
                    onClick={() => chooseTool(item.id)}
                    className={cn(
                      "relative flex h-11 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-md px-1 text-[9px] font-medium leading-none transition-colors",
                      active
                        ? "bg-white/10 text-white"
                        : "text-zinc-400 active:bg-white/5",
                      disabled && "opacity-35"
                    )}
                  >
                    <Icon className="size-4 shrink-0" />
                    <span className="max-w-full truncate">
                      {item.id === "remove-bg"
                        ? t("preview.workspace.removeBgShort")
                        : item.label}
                    </span>
                    {active && (
                      <span className="absolute bottom-0 left-2 right-2 h-0.5 rounded-full bg-primary" />
                    )}
                  </button>
                );
              })}
            </div>
          )}

          {editingAvailable && (
            <div
              aria-label={compareOn ? t("preview.compare") : t("preview.workspace.options")}
              className={cn(
                "relative flex h-11 shrink-0 items-center gap-2 border-b border-white/10 bg-zinc-950/60 px-2.5",
                activeTool === "view" && !compareOn && "hidden lg:flex"
              )}
            >
              {compareOn ? (
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  <Columns2Icon className="size-4 shrink-0 text-primary" />
                  <span className="min-w-0 truncate text-[11px] text-zinc-400">
                    {t("preview.workspace.compareHint")}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    className="ml-auto shrink-0 text-zinc-300 hover:text-white"
                    onClick={exitCompare}
                  >
                    {t("preview.workspace.backToEdit")}
                  </Button>
                </div>
              ) : (
                <>
                  <div className="hidden shrink-0 items-center gap-1.5 lg:flex">
                    {React.createElement(
                      tools.find((item) => item.id === activeTool)?.icon ?? HandIcon,
                      { className: "size-3.5 text-zinc-400" }
                    )}
                    <span className="text-[12px] font-medium text-zinc-200">
                      {activeToolLabel}
                    </span>
                  </div>
                  <div className="hidden h-4 w-px shrink-0 bg-white/10 lg:block" />
                  <div className="no-scrollbar flex min-w-0 flex-1 items-center gap-2 overflow-x-auto">
                    {activeTool === "view" && (
                      <span className="truncate text-[11px] text-zinc-400">
                        {activeToolHint}
                      </span>
                    )}

                    {activeTool === "crop" && (
                      <div className="flex min-w-0 flex-1 items-center gap-2">
                        <div className="relative min-w-0 flex-1">
                          <div className="no-scrollbar flex items-center gap-0.5 overflow-x-auto">
                            <span className="mr-1 hidden shrink-0 text-[11px] text-zinc-500 sm:inline">
                              {t("preview.edit.ratio")}
                            </span>
                            {CROP_RATIO_OPTIONS.map((option) => (
                              <button
                                key={option.id}
                                type="button"
                                className={cn(
                                  "shrink-0 cursor-pointer whitespace-nowrap rounded-md px-2 py-1 text-[11px] font-medium transition-colors",
                                  cropRatio === option.id
                                    ? "bg-white text-zinc-950"
                                    : "text-zinc-400 hover:bg-white/10 hover:text-white"
                                )}
                                onClick={() => changeCropRatio(option.id)}
                              >
                                <span className="sm:hidden">
                                  {option.id === "free"
                                    ? t("crop.freeShort")
                                    : option.id}
                                </span>
                                <span className="hidden sm:inline">
                                  {t(option.label)}
                                </span>
                              </button>
                            ))}
                          </div>
                        </div>
                        <div className="hidden h-4 w-px shrink-0 bg-white/10 sm:block" />
                        <div className="flex shrink-0 items-center gap-0.5">
                          <OptionIconButton
                            label={t("preview.edit.rotateLeft")}
                            onClick={() => rotate(-90)}
                          >
                            <RotateCcwIcon />
                          </OptionIconButton>
                          <OptionIconButton
                            label={t("preview.edit.rotateRight")}
                            onClick={() => rotate(90)}
                          >
                            <RotateCwIcon />
                          </OptionIconButton>
                          <OptionIconButton
                            label={t("preview.edit.flipX")}
                            pressed={flipX}
                            onClick={() => flip("x")}
                          >
                            <FlipHorizontal2Icon />
                          </OptionIconButton>
                          <OptionIconButton
                            label={t("preview.edit.flipY")}
                            pressed={flipY}
                            onClick={() => flip("y")}
                          >
                            <FlipVertical2Icon />
                          </OptionIconButton>
                          <Button
                            type="button"
                            variant="ghost"
                            size="xs"
                            className="shrink-0 text-zinc-400 hover:text-white"
                            title={t("preview.edit.fullImage")}
                            aria-label={t("preview.edit.fullImage")}
                            disabled={isFullCrop(crop) && cropRatio === "free"}
                            onClick={resetCrop}
                          >
                            <FrameIcon className="size-3" />
                            <span className="hidden sm:inline">
                              {t("preview.edit.fullImage")}
                            </span>
                          </Button>
                        </div>
                      </div>
                    )}

                    {activeTool === "expand" && (
                      <>
                        <span className="shrink-0 text-[11px] text-zinc-500">
                          {t("preview.edit.padding")}
                        </span>
                        <Slider
                          min={0}
                          max={50}
                          step={5}
                          value={[Math.round(padding * 100)]}
                          onValueChange={([value]) => changePadding(value / 100)}
                          className="w-28 shrink-0 sm:w-32"
                        />
                        <span className="w-9 shrink-0 font-mono text-[11px] tabular-nums text-zinc-300">
                          +{Math.round(padding * 100)}%
                        </span>
                        <div className="h-4 w-px shrink-0 bg-white/10" />
                        <span className="shrink-0 text-[11px] text-zinc-500">
                          {t("preview.edit.background")}
                        </span>
                        <div className="flex shrink-0 items-center gap-1">
                          {EDITOR_BG_COLORS.map((preset) => (
                            <button
                              key={preset.value}
                              type="button"
                              aria-label={t(preset.label)}
                              aria-pressed={background === preset.value}
                              className={cn(
                                "size-5 cursor-pointer rounded-md border transition-transform",
                                preset.value === "transparent" &&
                                  "bg-transparency-grid",
                                background === preset.value
                                  ? "scale-110 border-transparent ring-2 ring-primary"
                                  : "border-white/20 hover:scale-105"
                              )}
                              style={
                                preset.value === "transparent"
                                  ? undefined
                                  : { backgroundColor: preset.value }
                              }
                              onClick={() => setBackground(preset.value)}
                              title={t(preset.label)}
                            />
                          ))}
                        </div>
                      </>
                    )}

                    {activeTool === "annotate" && (
                      <>
                        <div className="flex shrink-0 items-center gap-1">
                          {EDITOR_BRUSH_COLORS.map((color) => (
                            <button
                              key={color}
                              type="button"
                              title={color}
                              aria-label={t("freeCanvas.annotateColor", { color })}
                              aria-pressed={brushColor === color}
                              className={cn(
                                "size-[18px] cursor-pointer rounded-full border transition-transform sm:size-5",
                                brushColor === color
                                  ? "scale-110 border-white ring-2 ring-primary"
                                  : "border-transparent hover:scale-105"
                              )}
                              style={{ backgroundColor: color }}
                              onClick={() => setBrushColor(color)}
                            />
                          ))}
                        </div>
                        <div className="flex shrink-0 items-center gap-1.5">
                          <span
                            className="whitespace-nowrap text-[11px] text-zinc-400"
                            title={t("preview.edit.brushSize")}
                          >
                            <span className="hidden sm:inline">
                              {t("preview.edit.brushSize")}{" "}
                            </span>
                            {brushSize}
                          </span>
                          <Slider
                            min={1}
                            max={brushMax}
                            value={[brushSize]}
                            onValueChange={([value]) => setBrushSize(value)}
                            className="w-20 sm:w-36"
                          />
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="xs"
                          className="shrink-0 text-zinc-400 hover:text-white"
                          title={t("preview.edit.undoStroke")}
                          aria-label={t("preview.edit.undoStroke")}
                          disabled={strokes.length === 0}
                          onClick={() =>
                            setStrokes((previous) => previous.slice(0, -1))
                          }
                        >
                          <UndoIcon className="size-3" />
                          <span className="hidden sm:inline">
                            {t("preview.edit.undoStroke")}
                          </span>
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="xs"
                          className="shrink-0 text-zinc-400 hover:text-white"
                          title={t("preview.edit.clearStrokes")}
                          aria-label={t("preview.edit.clearStrokes")}
                          disabled={strokes.length === 0}
                          onClick={() => setStrokes([])}
                        >
                          <EraserIcon className="size-3" />
                          <span className="hidden sm:inline">
                            {t("preview.edit.clearStrokes")}
                          </span>
                        </Button>
                      </>
                    )}

                    {activeTool === "remove-bg" && (
                      <Button
                        type="button"
                        variant="secondary"
                        size="xs"
                        className="shrink-0"
                        disabled={runInProgress || !bitmap}
                        onClick={() => void handleRun("background-removal")}
                      >
                        {runInProgress && runKind === "background-removal" ? (
                          <Loader2Icon className="size-3 animate-spin" />
                        ) : (
                          <PlayIcon className="size-3" />
                        )}
                        {runInProgress && runKind === "background-removal"
                          ? t("preview.edit.running")
                          : t("preview.workspace.runEnhance")}
                      </Button>
                    )}

                    {activeTool === "upscale" && (
                      <>
                        <div className="flex shrink-0 items-center gap-1">
                          {([2, 4] as const).map((value) => (
                            <button
                              key={value}
                              type="button"
                              disabled={runInProgress}
                              onClick={() => setFactor(value)}
                              className={cn(
                                "h-6 min-w-9 rounded-md px-2 text-[11px] font-medium transition-colors",
                                factor === value
                                  ? "bg-white text-zinc-950"
                                  : "text-zinc-400 hover:bg-white/10 hover:text-white",
                                runInProgress && "opacity-50"
                              )}
                            >
                              {t(`imageTools.upscaleFactor${value}`)}
                            </button>
                          ))}
                        </div>
                        <Button
                          type="button"
                          variant="secondary"
                          size="xs"
                          className="shrink-0"
                          disabled={
                            runInProgress || !bitmap || Boolean(upscaleLimit)
                          }
                          onClick={() => void handleRun("upscale")}
                        >
                          {runInProgress && runKind === "upscale" ? (
                            <Loader2Icon className="size-3 animate-spin" />
                          ) : (
                            <PlayIcon className="size-3" />
                          )}
                          {runInProgress && runKind === "upscale"
                            ? t("preview.edit.running")
                            : t("preview.edit.runUpscale", { factor })}
                        </Button>
                        {upscaleTarget && (
                          <span className="shrink-0 font-mono text-[10px] tabular-nums text-zinc-500">
                            {t("preview.workspace.upscaleRunOutput", {
                              width: upscaleTarget.width,
                              height: upscaleTarget.height,
                            })}
                          </span>
                        )}
                        {upscaleLimit && (
                          <span
                            className="flex shrink-0 items-center gap-1 text-[10px] text-amber-300"
                            title={upscaleLimitMessage ?? undefined}
                          >
                            <AlertTriangleIcon className="size-3" />
                            {t("imageTools.upscaleLimitShort")}
                          </span>
                        )}
                      </>
                    )}
                  </div>
                </>
              )}
            </div>
          )}

          <div className="relative flex min-h-0 flex-1 bg-[#08080a]">
            <div
              ref={stageRef}
              onPointerDownCapture={handlePanDown}
              onPointerMove={handlePanMove}
              onPointerUp={handlePanUp}
              onPointerCancel={handlePanUp}
              onPointerLeave={() => setBrushCursor(null)}
              onDoubleClick={() => {
                if (compareOn) return;
                if (zoom > 1) resetView();
                else zoomToActual();
              }}
              className={cn(
                "relative m-2 flex min-h-0 flex-1 select-none items-center justify-center overflow-hidden sm:m-4",
                compareOn
                  ? "cursor-default"
                  : isPanning
                    ? "cursor-grabbing"
                    : canPanCursor
                      ? "cursor-grab"
                      : "cursor-default"
              )}
            >
              {compareOn && image.compareSrc ? (
                <div className="absolute inset-0 p-1 sm:p-2">
                  <span className="pointer-events-none absolute left-3 top-2 z-10 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-medium text-zinc-200">
                    {t("preview.compareOriginal")}
                  </span>
                  <span className="pointer-events-none absolute right-3 top-2 z-10 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-medium text-zinc-200">
                    {t("preview.compareCurrent")}
                  </span>
                  <ReactCompareSlider
                    className="h-full w-full"
                    itemOne={
                      <ReactCompareSliderImage
                        src={image.compareSrc}
                        alt={t("preview.compareOriginal")}
                        style={{
                          objectFit: "contain",
                          width: "100%",
                          height: "100%",
                        }}
                      />
                    }
                    itemTwo={
                      <ReactCompareSliderImage
                        src={image.url}
                        alt={t("preview.compareCurrent")}
                        style={{
                          objectFit: "contain",
                          width: "100%",
                          height: "100%",
                        }}
                      />
                    }
                  />
                </div>
              ) : box.width > 0 ? (
                <div
                  className="relative bg-transparency-grid shadow-[0_24px_80px_-24px_rgba(0,0,0,0.95)] ring-1 ring-white/10"
                  style={{
                    width: box.width,
                    height: box.height,
                    transform: `translate3d(${offset.x}px, ${offset.y}px, 0) scale(${zoom})`,
                    transformOrigin: "center center",
                    transition: isPanning ? "none" : "transform 80ms linear",
                  }}
                >
                  {editingAvailable ? (
                    bitmap ? (
                      <canvas
                        ref={canvasRef}
                        className={cn(
                          "block h-full w-full",
                          activeTool === "annotate"
                            ? "cursor-crosshair touch-none"
                            : "pointer-events-none"
                        )}
                        onPointerDown={handleAnnotateDown}
                        onPointerMove={handleAnnotateMove}
                        onPointerUp={handleAnnotateUp}
                        onPointerCancel={handleAnnotateUp}
                        onPointerLeave={handleAnnotateUp}
                      />
                    ) : (
                      <img
                        src={image.url}
                        alt={image.alt || image.title || t("preview.dialogTitle")}
                        draggable={false}
                        onLoad={(event) => {
                          const element = event.currentTarget;
                          const width = element.naturalWidth || element.width;
                          const height = element.naturalHeight || element.height;
                          if (width && height) {
                            setNatural((previous) =>
                              previous.width ? previous : { width, height }
                            );
                          }
                        }}
                        onError={() => setDisplayError(true)}
                        className="block h-full w-full select-none object-contain"
                      />
                    )
                  ) : (
                    <img
                      src={image.url}
                      alt={image.alt || image.title || t("preview.dialogTitle")}
                      draggable={false}
                      onLoad={(event) => {
                        const element = event.currentTarget;
                        const width = element.naturalWidth || element.width;
                        const height = element.naturalHeight || element.height;
                        if (width && height) setNatural({ width, height });
                      }}
                      onError={() => setDisplayError(true)}
                      className="block h-full w-full select-none object-contain"
                    />
                  )}
                </div>
              ) : (
                // Before the working frame is measured (view-only images, or an
                // editable image whose bytes are still loading) this <img> both
                // shows the picture immediately and reports its natural size.
                <img
                  src={image.url}
                  alt={image.alt || image.title || t("preview.dialogTitle")}
                  draggable={false}
                  onLoad={(event) => {
                    const element = event.currentTarget;
                    const width = element.naturalWidth || element.width;
                    const height = element.naturalHeight || element.height;
                    if (width && height) setNatural({ width, height });
                  }}
                  onError={() => setDisplayError(true)}
                  className="absolute inset-0 m-auto max-h-full max-w-full select-none object-contain"
                />
              )}

              {editingAvailable && !compareOn && activeTool === "crop" && frame && (
                <div
                  ref={cropLayerRef}
                  className="absolute inset-0 touch-none overflow-hidden"
                  onPointerDown={(event) => startCropDrag(event, "new")}
                  onPointerMove={handleCropMove}
                  onPointerUp={endCropDrag}
                  onPointerCancel={endCropDrag}
                >
                  <div
                    className="absolute cursor-move border border-white"
                    style={{
                      left: cropVisual.left,
                      top: cropVisual.top,
                      width: cropVisual.width,
                      height: cropVisual.height,
                      boxShadow: "0 0 0 9999px rgba(0,0,0,0.55)",
                    }}
                    onPointerDown={(event) =>
                      startCropDrag(
                        event,
                        isFullCrop(crop) ? "new" : "move"
                      )
                    }
                  >
                    <div className="pointer-events-none absolute inset-0 grid grid-cols-3 grid-rows-3 opacity-40">
                      <div className="border-b border-r border-white/60" />
                      <div className="border-b border-r border-white/60" />
                      <div className="border-b border-white/60" />
                      <div className="border-b border-r border-white/60" />
                      <div className="border-b border-r border-white/60" />
                      <div className="border-b border-white/60" />
                      <div className="border-r border-white/60" />
                      <div className="border-r border-white/60" />
                      <div />
                    </div>
                    {CROP_HANDLES.map((handle) => (
                      <span
                        key={handle.id}
                        className={cn(
                          "absolute size-3.5 rounded-sm border border-zinc-950 bg-white shadow-md",
                          handle.className
                        )}
                        onPointerDown={(event) => startCropDrag(event, handle.id)}
                      />
                    ))}
                    {cropPixels &&
                      !isFullCrop(crop) &&
                      cropVisual.width > 96 &&
                      cropVisual.height > 48 && (
                        <span
                          className="pointer-events-none absolute rounded bg-black/70 px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-white"
                          style={{
                            left: Math.max(
                              4 - cropVisual.left,
                              Math.min(
                                0,
                                stageSize.width - 128 - cropVisual.left
                              )
                            ),
                            top:
                              cropVisual.top + cropVisual.height + 26 <=
                              stageSize.height
                                ? cropVisual.height + 6
                                : cropVisual.top >= 28
                                  ? -26
                                  : 4,
                          }}
                        >
                          {t("preview.workspace.cropSize", {
                            width: cropPixels.width,
                            height: cropPixels.height,
                          })}
                        </span>
                      )}
                  </div>
                </div>
              )}

              {editingAvailable &&
                !compareOn &&
                activeTool !== "crop" &&
                frame &&
                !isFullCrop(crop) && (
                  <div className="pointer-events-none absolute inset-0 overflow-hidden">
                    <div
                      className="absolute border border-white/70"
                      style={{
                        left: cropVisual.left,
                        top: cropVisual.top,
                        width: cropVisual.width,
                        height: cropVisual.height,
                        boxShadow: "0 0 0 9999px rgba(0,0,0,0.45)",
                      }}
                    />
                  </div>
                )}

              {editingAvailable &&
                !compareOn &&
                activeTool === "annotate" &&
                brushCursor &&
                !isPanning && (
                  <div
                    className="pointer-events-none absolute rounded-full border border-white mix-blend-difference"
                    style={{
                      left: brushCursor.x - brushCursor.size / 2,
                      top: brushCursor.y - brushCursor.size / 2,
                      width: brushCursor.size,
                      height: brushCursor.size,
                      boxShadow: "0 0 0 1px rgba(0,0,0,0.55)",
                    }}
                  />
                )}

              {canSwitch && !compareOn && (
                <>
                  <button
                    type="button"
                    onClick={onPrevious}
                    disabled={isDirty}
                    aria-label={t("preview.previous")}
                    title={
                      isDirty
                        ? t("preview.workspace.switchBlocked")
                        : t("preview.previous")
                    }
                    className={cn(
                      "absolute left-1 top-1/2 z-20 flex size-9 -translate-y-1/2 items-center justify-center rounded-full bg-black/60 text-white backdrop-blur-md transition-colors hover:bg-black/80",
                      isDirty && "cursor-not-allowed opacity-30"
                    )}
                  >
                    <ChevronLeftIcon className="size-5" />
                  </button>
                  <button
                    type="button"
                    onClick={onNext}
                    disabled={isDirty}
                    aria-label={t("preview.next")}
                    title={
                      isDirty
                        ? t("preview.workspace.switchBlocked")
                        : t("preview.next")
                    }
                    className={cn(
                      "absolute right-1 top-1/2 z-20 flex size-9 -translate-y-1/2 items-center justify-center rounded-full bg-black/60 text-white backdrop-blur-md transition-colors hover:bg-black/80",
                      isDirty && "cursor-not-allowed opacity-30"
                    )}
                  >
                    <ChevronRightIcon className="size-5" />
                  </button>
                </>
              )}

              {displayError && (
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                  <p className="rounded-lg bg-black/70 px-3 py-2 text-xs text-zinc-300">
                    {t("preview.workspace.imageUnavailable")}
                  </p>
                </div>
              )}

              {editingAvailable && sourceError && (
                <div className="absolute bottom-3 left-1/2 z-20 w-[min(92%,420px)] -translate-x-1/2 rounded-xl border border-amber-400/25 bg-zinc-950/95 p-3 shadow-xl">
                  <div className="flex items-start gap-2">
                    <AlertTriangleIcon className="mt-0.5 size-4 shrink-0 text-amber-400" />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-semibold text-zinc-100">
                        {t("preview.workspace.editUnavailable")}
                      </p>
                      <p className="mt-0.5 break-words text-[11px] leading-relaxed text-zinc-400">
                        {sourceError}
                      </p>
                    </div>
                    <Button
                      type="button"
                      size="xs"
                      variant="secondary"
                      onClick={() => setReloadKey((value) => value + 1)}
                    >
                      {t("imageTools.retry")}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="no-scrollbar flex min-h-9 shrink-0 items-center gap-1.5 overflow-x-auto border-t border-white/10 bg-zinc-950 px-2.5 py-1.5 lg:hidden">
            {image.actions?.map((action) => (
              <Button
                key={action.id}
                type="button"
                variant="outline"
                size="xs"
                disabled={action.disabled || pendingAction !== null}
                className="shrink-0 border-white/10 bg-transparent text-zinc-300 hover:bg-white/10 hover:text-white"
                onClick={() => void runAction(action.id)}
              >
                {pendingAction === action.id ? t("common.loading") : action.label}
              </Button>
            ))}
            <Button
              type="button"
              variant="ghost"
              size="xs"
              className="shrink-0 text-zinc-300 hover:bg-white/10 hover:text-white"
              title={
                isDirty
                  ? t("preview.workspace.downloadHint")
                  : t("preview.download")
              }
              onClick={handleDownload}
            >
              <DownloadIcon className="size-3" />
              {isDirty
                ? t("preview.workspace.downloadSaved")
                : t("preview.download")}
            </Button>
          </div>

          <div className="flex h-8 shrink-0 items-center gap-1 border-t border-white/10 bg-zinc-950/80 px-2 text-[11px] text-zinc-500">
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              className="text-zinc-400 hover:text-white"
              title={t("preview.zoomOut")}
              aria-label={t("preview.zoomOut")}
              disabled={compareOn || actualZoom <= MIN_ACTUAL_ZOOM + 0.001}
              onClick={() => zoomBy(-1)}
            >
              <MinusIcon />
            </Button>
            <button
              type="button"
              onClick={resetView}
              disabled={compareOn}
              className="h-6 min-w-11 cursor-pointer rounded-md px-1 font-mono text-[11px] tabular-nums text-zinc-300 transition-colors hover:bg-white/10 hover:text-white disabled:cursor-default disabled:opacity-40"
              title={t("preview.workspace.fit")}
              aria-label={t("preview.workspace.fit")}
            >
              {zoomPercent}%
            </button>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              className="text-zinc-400 hover:text-white"
              title={t("preview.zoomIn")}
              aria-label={t("preview.zoomIn")}
              disabled={compareOn || actualZoom >= MAX_ACTUAL_ZOOM - 0.001}
              onClick={() => zoomBy(1)}
            >
              <PlusIcon />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              className="text-zinc-400 hover:text-white"
              title={t("preview.workspace.fit")}
              aria-label={t("preview.workspace.fit")}
              disabled={compareOn || zoom === 1}
              onClick={resetView}
            >
              <Maximize2Icon />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="xs"
              className="hidden text-zinc-400 hover:text-white sm:inline-flex"
              title={t("preview.workspace.actualSize")}
              onClick={zoomToActual}
            >
              {t("preview.workspace.actualSize")}
            </Button>

            <div className="mx-1 h-3.5 w-px shrink-0 bg-white/10" />

            <span className="shrink-0 font-mono tabular-nums">
              {natural.width} × {natural.height}
            </span>
            {outputDiffers && cropPixels && (
              <>
                <ArrowRightIcon className="size-3 shrink-0 text-zinc-600" />
                <span className="shrink-0 font-mono tabular-nums text-zinc-300">
                  {cropPixels.width} × {cropPixels.height}
                </span>
              </>
            )}

            <div className="ml-auto flex min-w-0 items-center gap-2">
              {runPhase === "running" && (
                <span className="hidden min-w-0 items-center gap-1.5 sm:flex">
                  <Progress value={progress} className="h-1 w-16 shrink-0" />
                  <span
                    role="status"
                    className="truncate tabular-nums text-zinc-400"
                  >
                    {statusText} · {Math.round(progress)}%
                  </span>
                  {loadedBytes.loaded && loadedBytes.total ? (
                    <span className="shrink-0 font-mono text-zinc-500">
                      {formatBytes(loadedBytes.loaded)} /{" "}
                      {formatBytes(loadedBytes.total)}
                    </span>
                  ) : null}
                </span>
              )}
              {activeTool === "upscale" && upscaleLimitMessage && (
                <span
                  className="flex min-w-0 items-center gap-1 text-amber-300"
                  title={upscaleLimitMessage}
                >
                  <AlertTriangleIcon className="size-3 shrink-0" />
                  <span className="truncate">{upscaleLimitMessage}</span>
                </span>
              )}
              {runPhase === "error" && runError && (
                <span className="flex min-w-0 items-center gap-1 text-red-300">
                  <AlertTriangleIcon className="size-3 shrink-0" />
                  <span className="truncate">{runError}</span>
                </span>
              )}
              {applyError && (
                <span className="flex min-w-0 items-center gap-1 text-red-300">
                  <AlertTriangleIcon className="size-3 shrink-0" />
                  <span className="truncate">{applyError}</span>
                </span>
              )}
              {isLoading && (
                <span className="hidden items-center gap-1 text-zinc-500 sm:flex">
                  <Loader2Icon className="size-3 animate-spin" />
                  {t("preview.workspace.preparing")}
                </span>
              )}
              {image.compareSrc && (
                <button
                  type="button"
                  aria-pressed={compareOn}
                  disabled={isDirty}
                  onClick={toggleCompare}
                  title={
                    isDirty
                      ? t("preview.workspace.compareBlocked")
                      : t("preview.workspace.compareTitle")
                  }
                  className={cn(
                    "flex h-6 shrink-0 cursor-pointer items-center gap-1 rounded-md px-1.5 text-[11px] font-medium transition-colors",
                    compareOn
                      ? "bg-white/10 text-white"
                      : "text-zinc-400 hover:bg-white/10 hover:text-white",
                    isDirty && "cursor-not-allowed opacity-40 hover:bg-transparent"
                  )}
                >
                  <Columns2Icon className="size-3.5" />
                  <span>{t("preview.compare")}</span>
                </button>
              )}
            </div>
          </div>

          {editingAvailable && image.editable && (
            <div className="flex shrink-0 items-center gap-2 border-t border-white/10 bg-zinc-950 px-2.5 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] lg:hidden">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-zinc-400 hover:text-white"
                disabled={!isDirty || isApplying}
                onClick={requestReset}
              >
                {t("preview.workspace.resetAll")}
              </Button>
              <div className="no-scrollbar ml-auto flex items-center gap-2 overflow-x-auto">
                {image.editable.applyAlternateLabel &&
                  image.editable.onApplyAlternate && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="shrink-0"
                      disabled={!isDirty || isApplying || runPhase === "running"}
                      onClick={() => requestApply("alternate")}
                    >
                      {image.editable.applyAlternateLabel}
                    </Button>
                  )}
                <Button
                  type="button"
                  variant={isDirty ? "default" : "secondary"}
                  size="sm"
                  className="shrink-0"
                  disabled={!canApply}
                  onClick={() => requestApply("primary")}
                >
                  {isApplying && <Loader2Icon className="size-3.5 animate-spin" />}
                  {isApplying
                    ? t("preview.edit.applying")
                    : image.editable.applyLabel}
                </Button>
              </div>
            </div>
          )}
        </div>

        <aside className="hidden w-[280px] shrink-0 flex-col border-l border-white/10 bg-zinc-950 lg:flex">
            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
              <section>
                <SectionLabel>{t("preview.workspace.imageSection")}</SectionLabel>
                <dl className="space-y-1">
                  <InfoRow
                    label={t("preview.workspace.dimensions")}
                    value={`${natural.width} × ${natural.height}`}
                  />
                  <InfoRow
                    label={t("preview.workspace.aspect")}
                    value={aspectText}
                  />
                  {(formatLabel || sourceBlob) && (
                    <div className="pt-0.5 font-mono text-[10px] text-zinc-500">
                      {[formatLabel, sourceBlob ? formatBytes(sourceBlob.size) : null]
                        .filter(Boolean)
                        .join(" · ")}
                    </div>
                  )}
                  {outputDiffers && cropPixels && (
                    <InfoRow
                      label={t("preview.workspace.output")}
                      value={`${cropPixels.width} × ${cropPixels.height}`}
                      highlight
                    />
                  )}
                </dl>
                {!editingAvailable && (
                  <p className="mt-2 text-[11px] leading-relaxed text-zinc-500">
                    {t("preview.workspace.previewOnlyHint")}
                  </p>
                )}
              </section>

              {editingAvailable && (
                <section className="mt-4 border-t border-white/10 pt-3">
                  <SectionLabel>
                    {t("preview.workspace.changesSection")}
                  </SectionLabel>
                  {changes.length > 0 ? (
                    <ul className="space-y-1">
                      {changes.map((change) => (
                        <li
                          key={change.id}
                          className="flex items-start gap-2 text-[12px] leading-4 text-zinc-300"
                        >
                          <span className="mt-[7px] size-1 shrink-0 rounded-full bg-zinc-500" />
                          <span className="min-w-0">{change.label}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <>
                      <p className="text-[12px] text-zinc-400">
                        {t("preview.workspace.noChanges")}
                      </p>
                      <p className="mt-0.5 text-[11px] leading-relaxed text-zinc-500">
                        {t("preview.workspace.changesHint")}
                      </p>
                    </>
                  )}
                  {changes.length > 0 && (
                    <button
                      type="button"
                      onClick={requestReset}
                      disabled={isApplying}
                      className="mt-2 inline-flex cursor-pointer items-center gap-1 text-[11px] text-zinc-400 underline-offset-2 transition-colors hover:text-white hover:underline disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <RotateCcwIcon className="size-3" />
                      {t("preview.workspace.resetAll")}
                    </button>
                  )}
                </section>
              )}

              {editingAvailable && (
                <section className="mt-4 border-t border-white/10 pt-3">
                  <SectionLabel>{activeToolLabel}</SectionLabel>
                  {activeTool === "view" ? (
                    <p className="text-[11px] leading-relaxed text-zinc-500">
                      {t("preview.workspace.shortcutHint")}
                    </p>
                  ) : (
                    <p className="text-[11px] leading-relaxed text-zinc-500">
                      {activeToolHint}
                    </p>
                  )}
                </section>
              )}

              <section className="mt-4 border-t border-white/10 pt-3">
                <SectionLabel>{t("preview.workspace.actionsSection")}</SectionLabel>
                <div className="space-y-1.5">
                  {image.actions?.map((action) => (
                    <Button
                      key={action.id}
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={action.disabled || pendingAction !== null}
                      className="w-full justify-start border-white/10 bg-white/[0.03] text-zinc-200 hover:bg-white/10 hover:text-white"
                      onClick={() => void runAction(action.id)}
                    >
                      {pendingAction === action.id
                        ? t("common.loading")
                        : action.label}
                    </Button>
                  ))}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="w-full justify-start border-white/10 bg-white/[0.03] text-zinc-200 hover:bg-white/10 hover:text-white"
                    title={
                      isDirty
                        ? t("preview.workspace.downloadHint")
                        : t("preview.download")
                    }
                    onClick={handleDownload}
                  >
                    <DownloadIcon className="size-3.5" />
                    {t("preview.download")}
                  </Button>
                  {isDirty && (
                    <p className="px-0.5 text-[10px] leading-relaxed text-zinc-500">
                      {t("preview.workspace.downloadHint")}
                    </p>
                  )}
                </div>
              </section>
            </div>

            {editingAvailable && image.editable && (
              <div className="shrink-0 border-t border-white/10 p-3">
                {image.editable.applyAlternateLabel &&
                  image.editable.onApplyAlternate && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="mb-2 w-full border-white/15 text-zinc-200 hover:bg-white/10 hover:text-white"
                      disabled={!isDirty || isApplying || runPhase === "running"}
                      onClick={() => requestApply("alternate")}
                    >
                      {image.editable.applyAlternateLabel}
                    </Button>
                  )}
                <Button
                  type="button"
                  variant={isDirty ? "default" : "secondary"}
                  size="default"
                  className="w-full"
                  disabled={!canApply}
                  onClick={() => requestApply("primary")}
                >
                  {isApplying && <Loader2Icon className="size-4 animate-spin" />}
                  {isApplying
                    ? t("preview.edit.applying")
                    : image.editable.applyLabel}
                </Button>
                {applyError && (
                  <p className="mt-1.5 text-[11px] leading-relaxed text-red-300">
                    {applyError}
                  </p>
                )}
              </div>
            )}
          </aside>
      </div>

      <ConfirmDialog
        open={confirmIntent !== null}
        destructive
        title={
          confirmIntent === "reset"
            ? t("preview.workspace.resetTitle")
            : t("preview.edit.discardTitle")
        }
        description={
          confirmIntent === "reset"
            ? t("preview.workspace.resetDesc")
            : t("preview.edit.discardDesc")
        }
        confirmLabel={
          confirmIntent === "reset"
            ? t("preview.workspace.resetConfirm")
            : t("preview.edit.discardConfirm")
        }
        onCancel={() => setConfirmIntent(null)}
        onConfirm={() => {
          const intent = confirmIntent;
          setConfirmIntent(null);
          if (intent === "reset") resetWorkspace();
          else if (intent === "close") {
            abortRun();
            onClose();
          }
        }}
      />

      <ConfirmDialog
        open={maskConfirmOpen}
        title={t("preview.edit.discardMaskTitle")}
        description={t("preview.edit.discardMaskDesc")}
        confirmLabel={t("preview.edit.discardMaskConfirm")}
        busy={isApplying}
        onCancel={() => {
          setPendingApply(null);
          setMaskConfirmOpen(false);
        }}
        onConfirm={confirmDiscardAndApply}
      />
    </div>
  );
}

function OptionIconButton({
  label,
  pressed,
  onClick,
  children,
}: {
  label: string;
  pressed?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Button
      type="button"
      variant={pressed ? "secondary" : "ghost"}
      size="icon-xs"
      className="shrink-0 text-zinc-300 hover:text-white"
      title={label}
      aria-label={label}
      aria-pressed={pressed}
      onClick={onClick}
    >
      {children}
    </Button>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
      {children}
    </h2>
  );
}

function InfoRow({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="shrink-0 text-[12px] text-zinc-500">{label}</dt>
      <dd
        className={cn(
          "truncate font-mono text-[12px] tabular-nums",
          highlight ? "text-zinc-100" : "text-zinc-300"
        )}
      >
        {value}
      </dd>
    </div>
  );
}
