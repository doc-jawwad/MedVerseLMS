/**
 * Shared CRON_SECRET gate for /api/cron/* routes.
 * Missing or empty secret => 503; wrong/missing Authorization => 401.
 * Never logs or returns the secret value.
 */
export type CronAuthResult =
  | { ok: true }
  | { ok: false; status: 401 | 503; error: "unauthorized" | "cron_secret_unconfigured" };

export function assertCronAuthorized(
  authHeader: string | null,
  cronSecret: string | undefined = process.env.CRON_SECRET
): CronAuthResult {
  if (!cronSecret) {
    return { ok: false, status: 503, error: "cron_secret_unconfigured" };
  }
  if (authHeader !== `Bearer ${cronSecret}`) {
    return { ok: false, status: 401, error: "unauthorized" };
  }
  return { ok: true };
}
