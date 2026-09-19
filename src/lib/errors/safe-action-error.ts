import "server-only";

import {
  isSafeBusinessErrorCode,
  sanitizeClientErrorMessage,
} from "@/lib/errors/client-safe-error";

export { isSafeBusinessErrorCode, sanitizeClientErrorMessage };

/**
 * Map server/Auth/DB failures to safe client strings.
 * Business codes (snake_case tokens from SECURITY DEFINER RPCs) are passed through
 * so existing UI mappers keep working. Everything else becomes a generic message.
 */

const GENERIC = "Something went wrong. Please try again.";

export function logServerError(scope: string, error: unknown): void {
  const detail =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : error && typeof error === "object" && "message" in error
          ? String((error as { message?: unknown }).message ?? "")
          : String(error ?? "");
  console.error(`[${scope}]`, detail || error);
}

/**
 * @param error - typically a PostgREST/Auth `{ message }` or string code
 * @param scope - log label (never sent to the client)
 * @param fallback - generic client message when the error is not a safe code
 */
export function toClientActionError(
  error: { message?: string | null } | string | null | undefined,
  scope: string,
  fallback: string = GENERIC
): string {
  const raw =
    typeof error === "string"
      ? error.trim()
      : (error?.message ?? "").trim();
  logServerError(scope, raw || error);
  return sanitizeClientErrorMessage(raw, fallback);
}

export function clientActionFailed(
  scope: string,
  error: { message?: string | null } | string | null | undefined,
  fallback?: string
): { error: string } {
  return { error: toClientActionError(error, scope, fallback) };
}

/** Convert a PostgREST `{ error }` (or null) into `{ error?: string }` for actions. */
export function actionRpcResult(
  scope: string,
  error: { message?: string | null } | null | undefined,
  fallback?: string
): { error?: string } {
  if (!error) return {};
  return clientActionFailed(scope, error, fallback);
}
