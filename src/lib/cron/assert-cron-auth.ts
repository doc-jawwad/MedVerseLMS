/**
 * Shared CRON_SECRET gate for /api/cron/* routes.
 * Missing or empty secret => 503; wrong/missing Authorization => 401.
 * Never logs or returns the secret value.
 * Comparison is timing-safe (Node crypto.timingSafeEqual).
 *
 * When `cronSecret` is omitted, reads `process.env.CRON_SECRET`.
 * An explicit second argument (including `undefined`/`null`) is used as-is
 * so tests can simulate an unconfigured secret without mutating the process env.
 */
import { timingSafeEqualBearer } from "../security/timing-safe-equal";

export type CronAuthResult =
  | { ok: true }
  | { ok: false; status: 401 | 503; error: "unauthorized" | "cron_secret_unconfigured" };

export function assertCronAuthorized(
  authHeader: string | null,
  cronSecret?: string | null
): CronAuthResult {
  const configured =
    arguments.length > 1
      ? (cronSecret ?? "")
      : (process.env.CRON_SECRET ?? "");
  if (!configured) {
    return { ok: false, status: 503, error: "cron_secret_unconfigured" };
  }
  if (!timingSafeEqualBearer(authHeader, configured)) {
    return { ok: false, status: 401, error: "unauthorized" };
  }
  return { ok: true };
}
