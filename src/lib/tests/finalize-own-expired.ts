/**
 * Student-scoped lazy finalize for overdue in_progress attempts.
 * Uses existing finalize_if_expired clocks (expires_at + 60s).
 */

type RpcClient = {
  rpc: (
    fn: string,
    args?: Record<string, unknown>
  ) => PromiseLike<{ error: { message: string } | null }>;
};

export async function finalizeOwnExpiredAttempts(
  supabase: RpcClient
): Promise<void> {
  const { error } = await supabase.rpc("finalize_own_expired_attempts");
  if (error) {
    console.error("finalize_own_expired_attempts failed", error.message);
  }
}
