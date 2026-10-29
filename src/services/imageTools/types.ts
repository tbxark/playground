export type ImageToolKind = "background-removal" | "upscale";

export type ImageToolStage =
  | "prepare"
  | "runtime"
  | "download"
  | "load"
  | "infer"
  | "resample"
  | "encode";

export type ImageToolProgress = {
  /** 0–100; callers should treat it as monotonic within a run. */
  progress: number;
  stage: ImageToolStage;
  loaded?: number;
  total?: number;
};

export type ImageToolOutput = {
  blob: Blob;
  width: number;
  height: number;
};

export type UpscaleFactor = 2 | 4;
