"use server";

import { actionRpcResult } from "@/lib/errors/safe-action-error";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

function revalidateMcqBankPaths(productKey?: string) {
  revalidatePath("/admin/mcq-bank");
  revalidatePath("/admin/mcq-bank/classify");
  revalidatePath("/admin/bin");
  revalidatePath("/admin/questions");
  revalidatePath("/academic");
  if (productKey) {
    revalidatePath(`/admin/mcq-bank/${productKey}`);
  }
}

export async function createMcqBankFolder(
  productSubjectId: string,
  name: string,
  productKey?: string
) {
  if (!productSubjectId) return { error: "Product subject required.", id: null as string | null };
  const trimmed = name.trim();
  if (!trimmed) return { error: "Folder name required.", id: null as string | null };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_create_mcq_bank_folder", {
    p_product_subject_id: productSubjectId,
    p_name: trimmed,
  });
  revalidateMcqBankPaths(productKey);
  if (error) {
    const result = actionRpcResult("createMcqBankFolder", error);
    return { error: result.error, id: null as string | null };
  }
  return { id: typeof data === "string" ? data : null, error: undefined };
}

export async function renameMcqBankFolder(
  folderId: string,
  name: string,
  productKey?: string
) {
  if (!folderId) return { error: "Folder required." };
  const trimmed = name.trim();
  if (!trimmed) return { error: "Folder name required." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_rename_mcq_bank_folder", {
    p_folder_id: folderId,
    p_name: trimmed,
  });
  revalidateMcqBankPaths(productKey);
  return actionRpcResult("renameMcqBankFolder", error);
}

export async function reorderMcqBankFolders(
  productSubjectId: string,
  orderedIds: string[],
  productKey?: string
) {
  if (!productSubjectId || orderedIds.length === 0) {
    return { error: "Reorder requires a product subject and folder list." };
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_reorder_mcq_bank_folders", {
    p_product_subject_id: productSubjectId,
    p_ordered_ids: orderedIds,
  });
  revalidateMcqBankPaths(productKey);
  return actionRpcResult("reorderMcqBankFolders", error);
}

export async function softDeleteMcqBankFolder(
  folderId: string,
  productKey?: string
) {
  if (!folderId) return { error: "Folder required." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_soft_delete_mcq_bank_folder", {
    p_folder_id: folderId,
  });
  revalidateMcqBankPaths(productKey);
  return actionRpcResult("softDeleteMcqBankFolder", error);
}

export async function removeQuestionFromMcqBankFolder(
  questionId: string,
  productKey?: string
) {
  if (!questionId) return { error: "Question required." };
  const supabase = await createClient();
  const { error } = await supabase.rpc(
    "admin_remove_question_from_mcq_bank_folder",
    { p_question_id: questionId }
  );
  revalidateMcqBankPaths(productKey);
  revalidatePath(`/admin/questions/${questionId}`);
  return actionRpcResult("removeQuestionFromMcqBankFolder", error);
}

export async function assignUnassignedQuestionToFolder(
  questionId: string,
  folderId: string,
  productKey?: string
) {
  if (!questionId || !folderId) {
    return { error: "Question and folder required." };
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc(
    "admin_assign_unassigned_question_to_folder",
    {
      p_question_id: questionId,
      p_folder_id: folderId,
    }
  );
  revalidateMcqBankPaths(productKey);
  revalidatePath(`/admin/questions/${questionId}`);
  return actionRpcResult("assignUnassignedQuestionToFolder", error);
}
