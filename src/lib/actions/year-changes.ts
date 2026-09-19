"use server";

import { actionRpcResult } from "@/lib/errors/safe-action-error";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

function revalidateYearChangePaths() {
  revalidatePath("/profile");
  revalidatePath("/admin/year-changes");
  revalidatePath("/admin/students");
  revalidatePath("/dashboard");
  revalidatePath("/practice");
  revalidatePath("/tests");
  revalidatePath("/materials");
}

export async function createYearChangeRequest(
  toYearId: string,
  reason?: string | null
) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_year_change_request", {
    p_to_year_id: toYearId,
    p_reason: reason ?? null,
  });
  revalidateYearChangePaths();
  if (error) return actionRpcResult("action", error);
  return { id: data as string };
}

export async function updatePendingYearChangeRequest(
  requestId: string,
  toYearId?: string | null,
  reason?: string | null
) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("update_pending_year_change_request", {
    p_request_id: requestId,
    p_to_year_id: toYearId ?? null,
    p_reason: reason ?? null,
  });
  revalidateYearChangePaths();
  return actionRpcResult("action", error);
}

export async function approveYearChangeRequest(
  requestId: string,
  reviewNote?: string | null
) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("approve_year_change_request", {
    p_request_id: requestId,
    p_review_note: reviewNote ?? null,
  });
  revalidateYearChangePaths();
  return actionRpcResult("action", error);
}

export async function rejectYearChangeRequest(
  requestId: string,
  reviewNote?: string | null
) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("reject_year_change_request", {
    p_request_id: requestId,
    p_review_note: reviewNote ?? null,
  });
  revalidateYearChangePaths();
  return actionRpcResult("action", error);
}
