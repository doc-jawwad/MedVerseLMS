"use server";

import { actionRpcResult, toClientActionError } from "@/lib/errors/safe-action-error";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type QuestionOption = { key: string; text: string };

export type QuestionContent = {
  stem: string;
  options: QuestionOption[];
  correct_key: string;
  explanation: string;
  reference: string;
};

export type QuestionMeta = {
  topic_id: string;
  difficulty: "easy" | "medium" | "hard";
  tags: string[];
  status?: string;
};

export async function createQuestion(content: QuestionContent, meta: QuestionMeta) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_question", {
    p_topic_id: meta.topic_id,
    p_stem: content.stem,
    p_options: content.options,
    p_correct_key: content.correct_key,
    p_explanation: content.explanation,
    p_reference: content.reference,
    p_difficulty: meta.difficulty,
    p_tags: meta.tags,
    p_status: meta.status ?? "draft",
  });
  revalidatePath("/admin/questions");
  if (error) {
    return {
      error:
        error.code === "23505"
          ? "An identical question already exists (duplicate)."
          : toClientActionError(error, "createQuestion"),
    };
  }
  return { id: data as string };
}

// Editing content = append an immutable new version (docs/database.md).
export async function saveNewVersion(questionId: string, content: QuestionContent) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("create_question_version", {
    p_question_id: questionId,
    p_stem: content.stem,
    p_options: content.options,
    p_correct_key: content.correct_key,
    p_explanation: content.explanation,
    p_reference: content.reference,
  });
  revalidatePath(`/admin/questions/${questionId}`);
  revalidatePath("/admin/questions");
  return actionRpcResult("action", error);
}

// Metadata (not content) may change in place on the identity row.
export async function updateQuestionMeta(
  questionId: string,
  meta: Partial<Pick<QuestionMeta, "topic_id" | "difficulty" | "tags">>
) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("questions")
    .update(meta)
    .eq("id", questionId);
  revalidatePath(`/admin/questions/${questionId}`);
  revalidatePath("/admin/questions");
  return actionRpcResult("action", error);
}

const allowedTransitions: Record<string, string[]> = {
  draft: ["review", "approved", "archived"],
  review: ["approved", "needs_revision", "draft", "archived"],
  approved: ["needs_revision", "archived"],
  needs_revision: ["review", "approved", "archived"],
  archived: ["draft"],
};

export async function setQuestionStatus(
  questionId: string,
  from: string,
  to: string
) {
  if (!allowedTransitions[from]?.includes(to)) {
    return { error: `Cannot move a ${from} question to ${to}.` };
  }
  const supabase = await createClient();
  const { error } = await supabase
    .from("questions")
    .update({ status: to })
    .eq("id", questionId)
    .eq("status", from);
  revalidatePath(`/admin/questions/${questionId}`);
  revalidatePath("/admin/questions");
  return actionRpcResult("action", error);
}
