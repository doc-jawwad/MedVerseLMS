"use server";

import { revalidatePath } from "next/cache";
import { actionRpcResult, toClientActionError } from "@/lib/errors/safe-action-error";
import { createClient } from "@/lib/supabase/server";
import type { ContentBinEntityType } from "@/lib/content-bin/labels";
import {
  CONTENT_BIN_PAGE_SIZE,
  CONTENT_BIN_PURGE_BATCH_SIZE,
  summarizePurgeOutcomes,
  type ContentBinBulkPurgeResult,
  type ContentBinPurgeOutcome,
} from "@/lib/content-bin/purge-batch";
import { contentBinPurgeErrorMessage } from "@/lib/content-bin/purge-errors";

export type ContentBinItem = {
  entity_type: ContentBinEntityType;
  entity_id: string;
  name: string;
  year_id: string | null;
  deleted_at: string | null;
  purge_after: string | null;
  deleted_by: string | null;
  has_r2: boolean;
  /** e.g. retained_referenced_by_test — expected hold, not a purge failure */
  retain_reason: string | null;
};

const ENTITY_TYPES = new Set<string>([
  "material_folder",
  "material",
  "pearl_point",
  "ospe_station",
  "question",
  "prof_session_day",
  "one_liner",
  "mcq_bank_folder",
  "mcq_bank_subfolder",
]);

function revalidateBinSurfaces() {
  revalidatePath("/admin/bin");
  revalidatePath("/admin/materials");
  revalidatePath("/admin/free-resources");
  revalidatePath("/admin/library");
  revalidatePath("/admin/pearls");
  revalidatePath("/admin/ospe-stations");
  revalidatePath("/admin/questions");
  revalidatePath("/admin/prof-session");
  revalidatePath("/admin/one-liners");
  revalidatePath("/admin/mcq-bank");
  revalidatePath("/academic");
  revalidatePath("/materials");
  revalidatePath("/free-resources");
}

/** Soft-delete → Bin (purge_after = deleted_at + 7 days eligibility). Does not delete R2. */
export async function moveContentToBin(
  entityType: ContentBinEntityType,
  entityId: string
) {
  if (!ENTITY_TYPES.has(entityType) || !entityId) {
    return { error: "Invalid content reference." };
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc("soft_delete_content", {
    p_entity_type: entityType,
    p_entity_id: entityId,
  });
  revalidateBinSurfaces();
  return actionRpcResult("moveContentToBin", error);
}

export async function restoreContentFromBin(
  entityType: ContentBinEntityType,
  entityId: string
) {
  if (!ENTITY_TYPES.has(entityType) || !entityId) {
    return { error: "Invalid content reference." };
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc("restore_content", {
    p_entity_type: entityType,
    p_entity_id: entityId,
  });
  revalidateBinSurfaces();
  return actionRpcResult("restoreContentFromBin", error);
}

/** Permanent purge — queues R2 via Data Spine; irreversible. */
export async function purgeContentFromBin(
  entityType: ContentBinEntityType,
  entityId: string
) {
  if (!ENTITY_TYPES.has(entityType) || !entityId) {
    return { error: "Invalid content reference." };
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc("purge_content", {
    p_entity_type: entityType,
    p_entity_id: entityId,
  });
  revalidateBinSurfaces();
  if (error) {
    const mapped = contentBinPurgeErrorMessage(error.message);
    if (mapped !== "Something went wrong. Please try again.") {
      return { error: mapped };
    }
    return actionRpcResult("purgeContentFromBin", error);
  }
  return {};
}

export type ContentBinBulkItem = {
  entityType: ContentBinEntityType;
  entityId: string;
};

/** Bulk restore — loops existing restore_content RPC (no second lifecycle). */
export async function bulkRestoreContentFromBin(items: ContentBinBulkItem[]) {
  const unique = dedupeBinItems(items);
  if (unique.length === 0) return { error: "Nothing selected." };
  const supabase = await createClient();
  let restored = 0;
  const failures: string[] = [];
  for (const item of unique) {
    const { error } = await supabase.rpc("restore_content", {
      p_entity_type: item.entityType,
      p_entity_id: item.entityId,
    });
    if (error) failures.push(`${item.entityType}:${item.entityId}`);
    else restored += 1;
  }
  revalidateBinSurfaces();
  return { restored, failed: failures.length, failures };
}

/**
 * Bulk permanent delete via purge_content_batch (≤500 IDs per RPC).
 * Auto-chunks larger selections. Retry-safe: already-purged → already_gone.
 */
export async function bulkPurgeContentFromBin(
  items: ContentBinBulkItem[]
): Promise<ContentBinBulkPurgeResult | { error: string }> {
  const unique = dedupeBinItems(items);
  if (unique.length === 0) return { error: "Nothing selected." };

  const supabase = await createClient();
  const outcomes: ContentBinPurgeOutcome[] = [];
  let rpcCalls = 0;

  for (let i = 0; i < unique.length; i += CONTENT_BIN_PURGE_BATCH_SIZE) {
    const chunk = unique.slice(i, i + CONTENT_BIN_PURGE_BATCH_SIZE);
    const payload = chunk.map((item) => ({
      entity_type: item.entityType,
      entity_id: item.entityId,
    }));
    rpcCalls += 1;
    const { data, error } = await supabase.rpc("purge_content_batch", {
      p_items: payload,
    });
    if (error) {
      return {
        error: toClientActionError(error, "bulkPurgeContentFromBin"),
      };
    }
    const rows = Array.isArray(data) ? data : [];
    for (const raw of rows) {
      if (!raw || typeof raw !== "object") continue;
      const row = raw as Record<string, unknown>;
      outcomes.push({
        entityType: String(row.entity_type ?? ""),
        entityId: String(row.entity_id ?? ""),
        outcome: String(row.outcome ?? "error"),
        detail: row.detail == null ? null : String(row.detail),
      });
    }
  }

  revalidateBinSurfaces();
  return summarizePurgeOutcomes(outcomes, rpcCalls);
}

function dedupeBinItems(items: ContentBinBulkItem[]): ContentBinBulkItem[] {
  const seen = new Set<string>();
  const out: ContentBinBulkItem[] = [];
  for (const item of items) {
    if (!ENTITY_TYPES.has(item.entityType) || !item.entityId) continue;
    const key = `${item.entityType}:${item.entityId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

export async function listContentBin(
  yearId?: string | null,
  opts?: { limit?: number; offset?: number }
): Promise<{
  items: ContentBinItem[];
  totalCount: number;
  error?: string;
}> {
  const limit = Math.min(
    Math.max(opts?.limit ?? CONTENT_BIN_PAGE_SIZE, 1),
    100
  );
  const offset = Math.max(opts?.offset ?? 0, 0);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("list_content_bin_page", {
    p_year_id: yearId ?? null,
    p_limit: limit,
    p_offset: offset,
  });
  if (error) {
    const result = actionRpcResult("listContentBin", error);
    return { items: [], totalCount: 0, error: result.error };
  }

  const rows = Array.isArray(data) ? data : [];
  const items: ContentBinItem[] = [];
  let totalCount = 0;
  for (const raw of rows) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as Record<string, unknown>;
    const entity_type = String(row.entity_type ?? "");
    if (!ENTITY_TYPES.has(entity_type)) continue;
    if (typeof row.total_count === "number") totalCount = row.total_count;
    else if (typeof row.total_count === "string")
      totalCount = Number(row.total_count) || totalCount;
    items.push({
      entity_type: entity_type as ContentBinEntityType,
      entity_id: String(row.entity_id ?? ""),
      name: String(row.name ?? "Untitled"),
      year_id: typeof row.year_id === "string" ? row.year_id : null,
      deleted_at: typeof row.deleted_at === "string" ? row.deleted_at : null,
      purge_after: typeof row.purge_after === "string" ? row.purge_after : null,
      deleted_by: typeof row.deleted_by === "string" ? row.deleted_by : null,
      has_r2: Boolean(row.has_r2),
      retain_reason:
        typeof row.retain_reason === "string" ? row.retain_reason : null,
    });
  }

  return { items, totalCount };
}
