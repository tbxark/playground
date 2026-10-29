import { i18n } from "@/i18n";

/**
 * Safely extracts user-friendly error messages from various error shapes:
 * - OpenAI SDK APIError (err.error?.message, err.message, err.status)
 * - Fetch/Network response errors (err.response?.data?.error?.message)
 * - Standard Error objects
 * - Arbitrary string / JSON shapes
 */
export function extractErrorMessage(err: unknown): string {
  if (!err) return i18n.t("err.unknownFailure");
  if (typeof err === "string") return err;

  if (typeof err === "object") {
    const e = err as Record<string, any>;

    // OpenAI SDK APIError: err.error?.message
    if (e.error && typeof e.error === "object" && typeof e.error.message === "string" && e.error.message.trim()) {
      return e.error.message.trim();
    }

    // Response body nested error
    if (e.response?.data?.error?.message && typeof e.response.data.error.message === "string") {
      return e.response.data.error.message.trim();
    }

    if (e.response?.data?.message && typeof e.response.data.message === "string") {
      return e.response.data.message.trim();
    }

    // Standard Error.message
    if (typeof e.message === "string" && e.message.trim()) {
      return e.message.trim();
    }

    try {
      const json = JSON.stringify(err);
      if (json !== "{}" && json.length < 300) {
        return json;
      }
    } catch {
      // ignore
    }
  }

  return String(err);
}
