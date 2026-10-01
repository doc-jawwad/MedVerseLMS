export const CONTENT_BIN_PURGE_BATCH_SIZE = 500;
export const CONTENT_BIN_PAGE_SIZE = 50;

export type ContentBinPurgeOutcome = {
  entityType: string;
  entityId: string;
  outcome: "purged" | "blocked" | "already_gone" | string;
  detail: string | null;
};

export type ContentBinBulkPurgeResult = {
  purged: number;
  blocked: number;
  alreadyGone: number;
  failed: number;
  outcomes: ContentBinPurgeOutcome[];
  message: string;
  rpcCalls: number;
};

/** Pure summary of purge_content_batch outcomes. */
export function summarizePurgeOutcomes(
  outcomes: ContentBinPurgeOutcome[],
  rpcCalls: number
): ContentBinBulkPurgeResult {
  let purged = 0;
  let blocked = 0;
  let alreadyGone = 0;
  let failed = 0;
  for (const o of outcomes) {
    if (o.outcome === "purged") purged += 1;
    else if (o.outcome === "blocked") blocked += 1;
    else if (o.outcome === "already_gone") alreadyGone += 1;
    else failed += 1;
  }
  const retainedByTest = outcomes.filter(
    (o) =>
      o.outcome === "blocked" &&
      (o.detail === "question_referenced_by_test" ||
        o.detail?.includes("question_referenced_by_test"))
  ).length;
  const blockedOther = blocked - retainedByTest;
  const parts: string[] = [];
  if (purged) parts.push(`Purged ${purged}`);
  if (retainedByTest)
    parts.push(
      `${retainedByTest} retained because referenced by test`
    );
  if (blockedOther) parts.push(`${blockedOther} blocked`);
  if (alreadyGone) parts.push(`${alreadyGone} already gone`);
  if (failed) parts.push(`${failed} failed`);
  const message = parts.length > 0 ? parts.join("; ") : "No items processed";
  return { purged, blocked, alreadyGone, failed, outcomes, message, rpcCalls };
}
