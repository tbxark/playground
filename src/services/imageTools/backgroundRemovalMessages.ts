import type { ImageToolStage } from "./types";

export type BackgroundRemovalRequest = {
  type: "run";
  blob: Blob;
};

export type BackgroundRemovalResponse =
  | {
      type: "progress";
      progress: number;
      stage: Extract<
        ImageToolStage,
        "runtime" | "download" | "load" | "infer" | "encode"
      >;
      loaded?: number;
      total?: number;
    }
  | { type: "result"; blob: Blob }
  | { type: "error"; message: string };
