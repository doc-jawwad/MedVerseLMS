"use server";

import { actionRpcResult } from "@/lib/errors/safe-action-error";
import { mcqBankMoveRevalidatePaths } from "@/lib/admin/mcq-bank-move";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

function revalidateMcqBankPaths(
  productKey?: string,
  folderId?: string,
  opts?: {
    folderIds?: Array<string | null | undefined>;
    subfolders?: Array<{
      folderId: string | null | undefined;
      subfolderId: string | null | undefined;
    }>;
  }
) {
  const folderIds = [
    folderId,
    ...(opts?.folderIds ?? []),
  ];
  for (const path of mcqBankMoveRevalidatePaths({
    productKey,
    folderIds,
    subfolders: opts?.subfolders,
  })) {
    revalidatePath(path);
  }
}

export async function createMcqBankSubfolder(
  folderId: string,
  name: string,
  productKey?: string
) {
  if (!folderId) return { error: "Folder required.", id: null as string | null };
  const trimmed = name.trim();
  if (!trimmed) return { error: "Subfolder name required.", id: null as string | null };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_create_mcq_bank_subfolder", {
    p_folder_id: folderId,
    p_name: trimmed,
  });
  revalidateMcqBankPaths(productKey, folderId);
  if (error) {
    const result = actionRpcResult("createMcqBankSubfolder", error);
    return { error: result.error, id: null as string | null };
  }
  return { id: typeof data === "string" ? data : null, error: undefined };
}

export async function renameMcqBankSubfolder(
  subfolderId: string,
  name: string,
  productKey?: string,
  folderId?: string
) {
  if (!subfolderId) return { error: "Subfolder required." };
  const trimmed = name.trim();
  if (!trimmed) return { error: "Subfolder name required." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_rename_mcq_bank_subfolder", {
    p_subfolder_id: subfolderId,
    p_name: trimmed,
  });
  revalidateMcqBankPaths(productKey, folderId);
  return actionRpcResult("renameMcqBankSubfolder", error);
}

export async function reorderMcqBankSubfolders(
  folderId: string,
  orderedIds: string[],
  productKey?: string
) {
  if (!folderId || orderedIds.length === 0) {
    return { error: "Reorder requires a folder and subfolder list." };
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_reorder_mcq_bank_subfolders", {
    p_folder_id: folderId,
    p_ordered_ids: orderedIds,
  });
  revalidateMcqBankPaths(productKey, folderId);
  return actionRpcResult("reorderMcqBankSubfolders", error);
}

export async function softDeleteMcqBankSubfolder(
  subfolderId: string,
  productKey?: string,
  folderId?: string
) {
  if (!subfolderId) return { error: "Subfolder required." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_soft_delete_mcq_bank_subfolder", {
    p_subfolder_id: subfolderId,
  });
  revalidateMcqBankPaths(productKey, folderId);
  return actionRpcResult("softDeleteMcqBankSubfolder", error);
}

export async function removeQuestionFromMcqBankSubfolder(
  questionId: string,
  productKey?: string,
  folderId?: string
) {
  if (!questionId) return { error: "Question required." };
  const supabase = await createClient();
  const { error } = await supabase.rpc(
    "admin_remove_question_from_mcq_bank_subfolder",
    { p_question_id: questionId }
  );
  revalidateMcqBankPaths(productKey, folderId);
  revalidatePath(`/admin/questions/${questionId}`);
  return actionRpcResult("removeQuestionFromMcqBankSubfolder", error);
}

export async function assignUnassignedQuestionToSubfolder(
  questionId: string,
  subfolderId: string,
  productKey?: string
) {
  if (!questionId || !subfolderId) {
    return { error: "Question and subfolder required." };
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc(
    "admin_assign_unassigned_question_to_subfolder",
    {
      p_question_id: questionId,
      p_subfolder_id: subfolderId,
    }
  );
  revalidateMcqBankPaths(productKey);
  revalidatePath(`/admin/questions/${questionId}`);
  return actionRpcResult("assignUnassignedQuestionToSubfolder", error);
}

export type BulkMoveSubfolderQuestionsResult = {
  moved: number;
  source_subfolder_id: string;
  dest_subfolder_id: string;
  question_ids: string[];
};

export type BulkRemoveSubfolderQuestionsResult = {
  removed: number;
  subfolder_id: string;
  question_ids: string[];
};

export type BulkSoftDeleteSubfolderQuestionsResult = {
  binned: number;
  blocked_active_test: number;
  not_found: number;
  blocked_ids: string[];
  subfolder_id: string;
};

/** Atomic subfolder→subfolder move (same product/year). Preserves question IDs. */
export async function bulkMoveMcqBankSubfolderQuestions(input: {
  sourceSubfolderId: string;
  destSubfolderId: string;
  questionIds?: string[];
  allInSource?: boolean;
  productKey?: string;
  folderId?: string;
  destFolderId?: string;
}) {
  if (!input.sourceSubfolderId || !input.destSubfolderId) {
    return { error: "Source and destination subfolders required." };
  }
  if (!input.allInSource && !(input.questionIds?.length)) {
    return { error: "No questions selected." };
  }
  const supabase = await createClient();
  const { data, error } = await supabase.rpc(
    "admin_bulk_move_mcq_bank_subfolder_questions",
    {
      p_source_subfolder_id: input.sourceSubfolderId,
      p_dest_subfolder_id: input.destSubfolderId,
      p_question_ids: input.allInSource ? null : (input.questionIds ?? null),
      p_all_in_source: Boolean(input.allInSource),
    }
  );
  revalidateMcqBankPaths(input.productKey, input.folderId, {
    folderIds: [input.destFolderId],
    subfolders: [
      {
        folderId: input.folderId,
        subfolderId: input.sourceSubfolderId,
      },
      {
        folderId: input.destFolderId ?? input.folderId,
        subfolderId: input.destSubfolderId,
      },
    ],
  });
  if (error) return actionRpcResult("bulkMoveMcqBankSubfolderQuestions", error);
  return { result: data as BulkMoveSubfolderQuestionsResult };
}

/** Bulk unassign from subfolder (questions remain in Question Bank). */
export async function bulkRemoveQuestionsFromMcqBankSubfolder(input: {
  subfolderId: string;
  questionIds?: string[];
  allInSubfolder?: boolean;
  productKey?: string;
  folderId?: string;
}) {
  if (!input.subfolderId) return { error: "Subfolder required." };
  if (!input.allInSubfolder && !(input.questionIds?.length)) {
    return { error: "No questions selected." };
  }
  const supabase = await createClient();
  const { data, error } = await supabase.rpc(
    "admin_bulk_remove_questions_from_mcq_bank_subfolder",
    {
      p_subfolder_id: input.subfolderId,
      p_question_ids: input.allInSubfolder ? null : (input.questionIds ?? null),
      p_all_in_subfolder: Boolean(input.allInSubfolder),
    }
  );
  revalidateMcqBankPaths(input.productKey, input.folderId);
  revalidatePath("/admin/questions");
  if (error) {
    return actionRpcResult("bulkRemoveQuestionsFromMcqBankSubfolder", error);
  }
  return { result: data as BulkRemoveSubfolderQuestionsResult };
}

/** Soft-delete (Content Bin) questions currently in this subfolder. */
export async function bulkSoftDeleteSubfolderQuestions(input: {
  subfolderId: string;
  questionIds?: string[];
  allInSubfolder?: boolean;
  productKey?: string;
  folderId?: string;
}) {
  if (!input.subfolderId) return { error: "Subfolder required." };
  if (!input.allInSubfolder && !(input.questionIds?.length)) {
    return { error: "No questions selected." };
  }
  const supabase = await createClient();
  const { data, error } = await supabase.rpc(
    "admin_bulk_soft_delete_subfolder_questions",
    {
      p_subfolder_id: input.subfolderId,
      p_question_ids: input.allInSubfolder ? null : (input.questionIds ?? null),
      p_all_in_subfolder: Boolean(input.allInSubfolder),
    }
  );
  revalidateMcqBankPaths(input.productKey, input.folderId);
  revalidatePath("/admin/questions");
  revalidatePath("/admin/bin");
  if (error) return actionRpcResult("bulkSoftDeleteSubfolderQuestions", error);
  return { result: data as BulkSoftDeleteSubfolderQuestionsResult };
}

export type BulkRestoreSubfolderQuestionsResult = {
  restored: number;
  subfolder_id: string;
  question_ids: string[];
};

/** Restore soft-deleted questions that still belong to this subfolder. */
export async function bulkRestoreSubfolderQuestions(input: {
  subfolderId: string;
  questionIds?: string[];
  allBinnedInSubfolder?: boolean;
  productKey?: string;
  folderId?: string;
}) {
  if (!input.subfolderId) return { error: "Subfolder required." };
  if (!input.allBinnedInSubfolder && !(input.questionIds?.length)) {
    return { error: "No questions selected." };
  }
  const supabase = await createClient();
  const { data, error } = await supabase.rpc(
    "admin_bulk_restore_subfolder_questions",
    {
      p_subfolder_id: input.subfolderId,
      p_question_ids: input.allBinnedInSubfolder
        ? null
        : (input.questionIds ?? null),
      p_all_binned_in_subfolder: Boolean(input.allBinnedInSubfolder),
    }
  );
  revalidateMcqBankPaths(input.productKey, input.folderId);
  revalidatePath("/admin/questions");
  revalidatePath("/admin/bin");
  if (error) return actionRpcResult("bulkRestoreSubfolderQuestions", error);
  return { result: data as BulkRestoreSubfolderQuestionsResult };
}
