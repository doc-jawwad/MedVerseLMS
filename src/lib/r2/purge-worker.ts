export type R2PurgeQueueRow = {
  id: string;
  object_key: string;
  entity_type: string | null;
  entity_id: string | null;
  attempts: number;
  last_error: string | null;
  completed_at: string | null;
};

export type R2PurgeItemResult = {
  id: string;
  object_key: string;
  outcome: "deleted" | "skipped_still_referenced" | "failed";
  error?: string;
};

export type R2PurgeBatchResult = {
  claimed: number;
  results: R2PurgeItemResult[];
  deleted: number;
  skipped: number;
  failed: number;
};

export type R2PurgeDeps = {
  claimBatch: (limit: number) => Promise<R2PurgeQueueRow[]>;
  complete: (id: string, error?: string | null) => Promise<void>;
  isObjectKeyStillReferenced: (objectKey: string) => Promise<boolean>;
  deleteObject: (objectKey: string) => Promise<{ error?: string }>;
};

/** Max attempts before leaving the row open with last_error only (manual review). */
export const R2_PURGE_MAX_ATTEMPTS = 20;

export function assertSafeStudyPurgeKey(objectKey: string): string | null {
  if (
    !objectKey ||
    objectKey.includes("://") ||
    objectKey.includes("..") ||
    /\s/.test(objectKey)
  ) {
    return "invalid_object_key";
  }
  if (objectKey.startsWith("medverse/")) {
    return "backup_prefix_forbidden";
  }
  if (
    !objectKey.startsWith("study-content/") &&
    !objectKey.startsWith("payment-proofs/")
  ) {
    return "unsupported_object_prefix";
  }
  return null;
}

/** @deprecated Prefer assertSafeStudyPurgeKey (now allows study-content/ and payment-proofs/). */
export const assertSafePurgeKey = assertSafeStudyPurgeKey;

/**
 * Claim → safety-check → delete R2 → complete.
 * Duplicate claimers use FOR UPDATE SKIP LOCKED in claim_r2_purge_batch.
 * Still-referenced keys are completed without delete (shared-key safe).
 */
export async function processR2PurgeBatch(
  deps: R2PurgeDeps,
  options?: { limit?: number }
): Promise<R2PurgeBatchResult> {
  const limit = Math.max(1, Math.min(options?.limit ?? 50, 200));
  const claimed = await deps.claimBatch(limit);
  const results: R2PurgeItemResult[] = [];

  for (const row of claimed) {
    const key = row.object_key;
    const keyErr = assertSafeStudyPurgeKey(key);
    if (keyErr) {
      await deps.complete(row.id, keyErr);
      results.push({
        id: row.id,
        object_key: key,
        outcome: "failed",
        error: keyErr,
      });
      continue;
    }

    try {
      const stillReferenced = await deps.isObjectKeyStillReferenced(key);
      if (stillReferenced) {
        // Shared object key: another live/soft row still needs the bytes.
        // Mark complete so we do not retry-delete an active object.
        await deps.complete(row.id, null);
        results.push({
          id: row.id,
          object_key: key,
          outcome: "skipped_still_referenced",
        });
        continue;
      }

      const deleted = await deps.deleteObject(key);
      if (deleted.error) {
        await deps.complete(row.id, deleted.error);
        results.push({
          id: row.id,
          object_key: key,
          outcome: "failed",
          error: deleted.error,
        });
        continue;
      }

      await deps.complete(row.id, null);
      results.push({
        id: row.id,
        object_key: key,
        outcome: "deleted",
      });
    } catch (err) {
      const message =
        err instanceof Error ? err.message.slice(0, 500) : "purge_worker_error";
      await deps.complete(row.id, message);
      results.push({
        id: row.id,
        object_key: key,
        outcome: "failed",
        error: message,
      });
    }
  }

  return {
    claimed: claimed.length,
    results,
    deleted: results.filter((r) => r.outcome === "deleted").length,
    skipped: results.filter((r) => r.outcome === "skipped_still_referenced")
      .length,
    failed: results.filter((r) => r.outcome === "failed").length,
  };
}
