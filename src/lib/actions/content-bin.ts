"use server";

import { revalidatePath } from "next/cache";
import { actionRpcResult } from "@/lib/errors/safe-action-error";
import { createClient } from "@/lib/supabase/server";
import type { ContentBinEntityType } from "@/lib/content-bin/labels";

export type { ContentBinEntityType } from "@/lib/content-bin/labels";
export { contentBinEntityLabel } from "@/lib/content-bin/labels";

export type ContentBinItem = {
  entity_type: ContentBinEntityType;
  entity_id: string;
  name: string;
  year_id: string | null;
  deleted_at: string | null;
  purge_after: string | null;
  deleted_by: string | null;
  has_r2: boolean;
};

const ENTITY_TYPES = new Set<string>([
  "material_folder",
  "material",
  "pearl_point",
  "ospe_station",
  "question",
  "prof_session_day",
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
  revalidatePath("/academic");
  revalidatePath("/materials");
  revalidatePath("/free-resources");
}

/** Soft-delete → Bin (7-day purge_after). Does not delete R2. */
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
  return actionRpcResult("purgeContentFromBin", error);
}

export async function listContentBin(
  yearId?: string | null
): Promise<{ items: ContentBinItem[]; error?: string }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("list_content_bin", {
    p_year_id: yearId ?? null,
  });
  if (error) {
    const result = actionRpcResult("listContentBin", error);
    return { items: [], error: result.error };
  }

  const rows = Array.isArray(data) ? data : [];
  const items: ContentBinItem[] = [];
  for (const raw of rows) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as Record<string, unknown>;
    const entity_type = String(row.entity_type ?? "");
    if (!ENTITY_TYPES.has(entity_type)) continue;
    items.push({
      entity_type: entity_type as ContentBinEntityType,
      entity_id: String(row.entity_id ?? ""),
      name: String(row.name ?? "Untitled"),
      year_id: typeof row.year_id === "string" ? row.year_id : null,
      deleted_at: typeof row.deleted_at === "string" ? row.deleted_at : null,
      purge_after: typeof row.purge_after === "string" ? row.purge_after : null,
      deleted_by: typeof row.deleted_by === "string" ? row.deleted_by : null,
      has_r2: Boolean(row.has_r2),
    });
  }

  items.sort((a, b) => {
    const ta = a.deleted_at ? Date.parse(a.deleted_at) : 0;
    const tb = b.deleted_at ? Date.parse(b.deleted_at) : 0;
    return tb - ta;
  });

  return { items };
}
