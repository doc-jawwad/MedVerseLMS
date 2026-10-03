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

export type BulkMoveFolderQuestionsResult = {
  moved: number;
  source_folder_id: string;
  dest_folder_id: string;
  question_ids: string[];
};

export type BulkRemoveFolderQuestionsResult = {
  removed: number;
  folder_id: string;
  question_ids: string[];
};

export type BulkSoftDeleteFolderQuestionsResult = {
  binned: number;
  blocked_active_test: number;
  not_found: number;
  blocked_ids: string[];
  folder_id: string;
};

/** Atomic folder→destination-subfolder move. Preserves question IDs. */
export async function bulkMoveMcqBankFolderQuestions(input: {
  sourceFolderId: string;
  destSubfolderId: string;
  questionIds?: string[];
  allInSource?: boolean;
  productKey?: string;
}) {
  if (!input.sourceFolderId || !input.destSubfolderId) {
    return { error: "Source folder and destination subfolder required." };
  }
  if (!input.allInSource && !(input.questionIds?.length)) {
    return { error: "No questions selected." };
  }
  const supabase = await createClient();
  const { data, error } = await supabase.rpc(
    "admin_bulk_move_mcq_bank_folder_questions",
    {
      p_source_folder_id: input.sourceFolderId,
      p_dest_subfolder_id: input.destSubfolderId,
      p_question_ids: input.allInSource ? null : (input.questionIds ?? null),
      p_all_in_source: Boolean(input.allInSource),
    }
  );
  revalidateMcqBankPaths(input.productKey);
  revalidatePath("/admin/questions");
  if (error) return actionRpcResult("bulkMoveMcqBankFolderQuestions", error);
  return { result: data as BulkMoveFolderQuestionsResult };
}

/** Bulk unassign from folder (questions remain in Question Bank). */
export async function bulkRemoveQuestionsFromMcqBankFolder(input: {
  folderId: string;
  questionIds?: string[];
  allInFolder?: boolean;
  productKey?: string;
}) {
  if (!input.folderId) return { error: "Folder required." };
  if (!input.allInFolder && !(input.questionIds?.length)) {
    return { error: "No questions selected." };
  }
  const supabase = await createClient();
  const { data, error } = await supabase.rpc(
    "admin_bulk_remove_questions_from_mcq_bank_folder",
    {
      p_folder_id: input.folderId,
      p_question_ids: input.allInFolder ? null : (input.questionIds ?? null),
      p_all_in_folder: Boolean(input.allInFolder),
    }
  );
  revalidateMcqBankPaths(input.productKey);
  revalidatePath("/admin/questions");
  if (error) {
    return actionRpcResult("bulkRemoveQuestionsFromMcqBankFolder", error);
  }
  return { result: data as BulkRemoveFolderQuestionsResult };
}

/** Soft-delete (Content Bin) questions currently in this folder. */
export async function bulkSoftDeleteFolderQuestions(input: {
  folderId: string;
  questionIds?: string[];
  allInFolder?: boolean;
  productKey?: string;
}) {
  if (!input.folderId) return { error: "Folder required." };
  if (!input.allInFolder && !(input.questionIds?.length)) {
    return { error: "No questions selected." };
  }
  const supabase = await createClient();
  const { data, error } = await supabase.rpc(
    "admin_bulk_soft_delete_folder_questions",
    {
      p_folder_id: input.folderId,
      p_question_ids: input.allInFolder ? null : (input.questionIds ?? null),
      p_all_in_folder: Boolean(input.allInFolder),
    }
  );
  revalidateMcqBankPaths(input.productKey);
  revalidatePath("/admin/questions");
  revalidatePath("/admin/bin");
  if (error) return actionRpcResult("bulkSoftDeleteFolderQuestions", error);
  return { result: data as BulkSoftDeleteFolderQuestionsResult };
}

export type BulkRestoreFolderQuestionsResult = {
  restored: number;
  folder_id: string;
  question_ids: string[];
};

/** Restore soft-deleted questions that still belong to this folder. */
export async function bulkRestoreFolderQuestions(input: {
  folderId: string;
  questionIds?: string[];
  allBinnedInFolder?: boolean;
  productKey?: string;
}) {
  if (!input.folderId) return { error: "Folder required." };
  if (!input.allBinnedInFolder && !(input.questionIds?.length)) {
    return { error: "No questions selected." };
  }
  const supabase = await createClient();
  const { data, error } = await supabase.rpc(
    "admin_bulk_restore_folder_questions",
    {
      p_folder_id: input.folderId,
      p_question_ids: input.allBinnedInFolder
        ? null
        : (input.questionIds ?? null),
      p_all_binned_in_folder: Boolean(input.allBinnedInFolder),
    }
  );
  revalidateMcqBankPaths(input.productKey);
  revalidatePath("/admin/questions");
  revalidatePath("/admin/bin");
  if (error) return actionRpcResult("bulkRestoreFolderQuestions", error);
  return { result: data as BulkRestoreFolderQuestionsResult };
}
