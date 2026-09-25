"use server";

import { revalidatePath } from "next/cache";
import { actionRpcResult } from "@/lib/errors/safe-action-error";
import { createClient } from "@/lib/supabase/server";
import type { ContentBinEntityType } from "@/lib/content-bin/labels";
import {
  moveContentToBin,
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

export async function setDayPracticeQuestions(
  dayId: string,
  questionIds: string[]
) {
  if (!dayId) return { error: "Day required." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_set_day_practice_questions", {
    p_day_id: dayId,
    p_question_ids: questionIds,
  });
  revalidateProfSession();
  revalidatePath(`/admin/prof-session/${dayId}`);
  return actionRpcResult("setDayPracticeQuestions", error);
}

export async function setOneLinerDay(
  oneLinerId: string,
  dayId: string | null
) {
  if (!oneLinerId) return { error: "One-liner required." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_set_one_liner_day", {
    p_one_liner_id: oneLinerId,
    p_day_id: dayId,
  });
  revalidateProfSession();
  revalidatePath("/admin/one-liners");
  if (dayId) revalidatePath(`/admin/prof-session/${dayId}`);
  return actionRpcResult("setOneLinerDay", error);
}

export async function setTestProfSessionDay(
  testId: string,
  dayId: string | null
) {
  if (!testId) return { error: "Test required." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_set_test_prof_session_day", {
    p_test_id: testId,
    p_day_id: dayId,
  });
  revalidateProfSession();
  revalidatePath("/admin/tests");
  if (dayId) revalidatePath(`/admin/prof-session/${dayId}`);
  return actionRpcResult("setTestProfSessionDay", error);
}

export async function addProfSessionDayFolder(args: {
  yearId: string;
  subjectId: string;
  dayId: string;
  slotKey: "guidelines" | "los";
  name: string;
  entitlement?: "free" | "any_subscription";
}) {
  const trimmed = args.name.trim();
  if (!trimmed) return { error: "Folder name required.", id: null as string | null };
  if (!args.yearId || !args.subjectId || !args.dayId) {
    return { error: "Year, subject, and day are required.", id: null as string | null };
  }
  if (args.slotKey !== "guidelines" && args.slotKey !== "los") {
    return { error: "Invalid day slot.", id: null as string | null };
  }

  const entitlement = args.entitlement ?? "any_subscription";
  const supabase = await createClient();
  // protect_resource_entitlement allows INSERT only as free; paid/plan must
  // go through set_resource_entitlement after the row exists.
  const { data: folder, error } = await supabase
    .from("material_folders")
    .insert({
      year_id: args.yearId,
      subject_id: args.subjectId,
      name: trimmed,
      library_type: args.slotKey,
      entitlement: "free",
      content_surface: "prof_session",
      prof_session_day_id: args.dayId,
      day_slot_key: args.slotKey,
    })
    .select("id")
    .single();

  if (error || !folder?.id) {
    revalidateProfSession();
    const result = actionRpcResult(
      "addProfSessionDayFolder.insert",
      error ?? { message: "folder_create_failed" }
    );
    return { error: result.error, id: null as string | null };
  }

  if (entitlement !== "free") {
    const { error: entError } = await supabase.rpc("set_resource_entitlement", {
      p_kind: "materials_folder",
      p_id: folder.id,
      p_entitlement: entitlement,
      p_required_plan_id: null,
    });
    if (entError) {
      await supabase.from("material_folders").delete().eq("id", folder.id);
      revalidateProfSession();
      const result = actionRpcResult(
        "addProfSessionDayFolder.entitlement",
        entError
      );
      return { error: result.error, id: null as string | null };
    }
  }

  revalidateProfSession();
  revalidatePath(`/admin/prof-session/${args.dayId}`);
  revalidatePath("/admin/materials");
  revalidatePath("/admin/library");
  return { id: folder.id as string, error: undefined };
}
