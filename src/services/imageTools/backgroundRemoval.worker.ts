import { env, pipeline } from "@huggingface/transformers";
import wasmUrl from "onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url";
import mjsUrl from "onnxruntime-web/ort-wasm-simd-threaded.asyncify.mjs?url";
import type {
  BackgroundRemovalRequest,
  BackgroundRemovalResponse,
} from "./backgroundRemovalMessages";

/**
 * Background removal runs in a dedicated worker so the 35 MB first-run
 * download and the inference never block typing or dragging on the canvas.
 *
 * Model: MODNet (Apache-2.0), quantized to ~6.6 MB. The ONNX Runtime WASM
 * binary is fetched once by transformers.js and cached by the browser.
 */
const MODEL_ID = "Xenova/modnet";

env.allowLocalModels = false;
env.allowRemoteModels = true;
env.useBrowserCache = true;

if (env.backends.onnx.wasm) {
  // Threaded WASM needs COOP/COEP headers, which this static app does not set.
  env.backends.onnx.wasm.numThreads = 1;
  env.backends.onnx.wasm.proxy = false;
  // Self-host the runtime. transformers.js otherwise points at jsDelivr, which
  // makes the first removal depend on a third-party CDN (and fail offline).
  env.backends.onnx.wasm.wasmPaths = { wasm: wasmUrl, mjs: mjsUrl };
}

type Segmenter = (image: Blob) => Promise<unknown>;

type ProgressInfo = {
  status: string;
  progress?: number;
  loaded?: number;
  total?: number;
};

let segmenterPromise: Promise<Segmenter> | null = null;

function send(message: BackgroundRemovalResponse): void {
  self.postMessage(message);
}

function report(
  progress: number,
  stage: Extract<
    BackgroundRemovalResponse,
    { type: "progress" }
  >["stage"],
  extra?: { loaded?: number; total?: number }
): void {
  send({ type: "progress", progress, stage, ...extra });
}

function getSegmenter(): Promise<Segmenter> {
  if (!segmenterPromise) {
    report(4, "runtime");
    segmenterPromise = (
      pipeline("background-removal", MODEL_ID, {
        dtype: "q8",
        device: "wasm",
        progress_callback: (info: ProgressInfo) => {
          if (info.status === "progress_total") {
            const percent = Math.max(0, Math.min(100, info.progress ?? 0));
            report(5 + Math.round(percent * 0.62), "download", {
              loaded: info.loaded,
              total: info.total,
            });
          } else if (info.status === "ready") {
            report(70, "load");
          }
        },
      }) as unknown as Promise<Segmenter>
    ).catch((error) => {
      // Allow a retry to rebuild the pipeline after a failed download.
      segmenterPromise = null;
      throw error;
    });
  }
  return segmenterPromise;
}

self.onmessage = async (event: MessageEvent<BackgroundRemovalRequest>) => {
  if (event.data?.type !== "run") return;
  try {
    report(3, "runtime");
    const segmenter = await getSegmenter();
    report(76, "infer");
    const output = await segmenter(event.data.blob);
    const image = (Array.isArray(output) ? output[0] : output) as {
      toBlob: (type?: string) => Promise<Blob>;
    };
    report(94, "encode");
    const blob = await image.toBlob("image/png");
    send({ type: "result", blob });
  } catch (error) {
    send({
      type: "error",
      message: error instanceof Error ? error.message : String(error),
    });
  }
};
