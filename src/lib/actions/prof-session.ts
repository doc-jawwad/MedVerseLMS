"use server";

import { revalidatePath } from "next/cache";
import { actionRpcResult } from "@/lib/errors/safe-action-error";
import { createClient } from "@/lib/supabase/server";
import type { ContentBinEntityType } from "@/lib/content-bin/labels";
import {
  moveContentToBin,
  restoreContentFromBin,
} from "@/lib/actions/content-bin";

function revalidateProfSession() {
  revalidatePath("/admin/prof-session");
  revalidatePath("/admin/bin");
  revalidatePath("/admin/library");
  revalidatePath("/academic");
  revalidatePath("/academic/prof-session");
}

export async function createProfSessionDay(
  subjectId: string,
  name: string,
  sortOrder?: number | null
) {
  if (!subjectId) {
    return { error: "Subject required.", id: null as string | null };
  }
  const trimmed = name.trim();
  if (!trimmed) return { error: "Day name required.", id: null as string | null };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_create_prof_session_day", {
    p_subject_id: subjectId,
    p_name: trimmed,
    p_sort_order: sortOrder ?? null,
  });
  revalidateProfSession();
  if (error) {
    const result = actionRpcResult("createProfSessionDay", error);
    return { error: result.error, id: null as string | null };
  }
  return { id: typeof data === "string" ? data : null, error: undefined };
}

export async function updateProfSessionDay(args: {
  dayId: string;
  name?: string | null;
  sortOrder?: number | null;
  status?: "draft" | "published" | null;
}) {
  if (!args.dayId) return { error: "Day required." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_update_prof_session_day", {
    p_day_id: args.dayId,
    p_name: args.name?.trim() || null,
    p_sort_order: args.sortOrder ?? null,
    p_status: args.status ?? null,
  });
  revalidateProfSession();
  return actionRpcResult("updateProfSessionDay", error);
}

export async function reorderProfSessionDays(
  subjectId: string,
  dayIds: string[]
) {
  if (!subjectId || dayIds.length === 0) {
    return { error: "Reorder requires a subject and day list." };
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_reorder_prof_session_days", {
    p_subject_id: subjectId,
    p_day_ids: dayIds,
  });
  revalidateProfSession();
  return actionRpcResult("reorderProfSessionDays", error);
}

/** Soft-delete day into Bin (shared content-bin contract). */
export async function softDeleteProfSessionDay(dayId: string) {
  const result = await moveContentToBin(
    "prof_session_day" satisfies ContentBinEntityType,
    dayId
  );
  revalidateProfSession();
  return result;
}

export async function restoreProfSessionDay(dayId: string) {
  const result = await restoreContentFromBin("prof_session_day", dayId);
  revalidateProfSession();
  return result;
}
