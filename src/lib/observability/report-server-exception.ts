import "server-only";

import * as Sentry from "@sentry/nextjs";
import { sentryServerEnabled } from "@/lib/observability/sentry";

/**
 * Report an unexpected server failure to Sentry (no-op when disabled).
 * Does not replace console logging — call after or beside existing logs.
 */
export function reportServerException(
  scope: string,
  error: unknown,
  extra?: Record<string, unknown>
): void {
  if (!sentryServerEnabled()) return;

  Sentry.withScope((sentryScope) => {
    sentryScope.setTag("medverse.scope", scope);
    if (extra) {
      for (const [key, value] of Object.entries(extra)) {
        sentryScope.setExtra(key, value);
      }
    }
    if (error instanceof Error) {
      Sentry.captureException(error);
      return;
    }
    const message =
      typeof error === "string"
        ? error
        : error && typeof error === "object" && "message" in error
          ? String((error as { message?: unknown }).message ?? "unknown")
          : "unknown_server_error";
    Sentry.captureException(new Error(message));
  });
}
