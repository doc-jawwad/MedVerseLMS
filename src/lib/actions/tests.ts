"use server";

import {
  actionRpcResult,
  logServerError,
  toClientActionError,
} from "@/lib/errors/safe-action-error";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { readAdminSelectedYearId } from "@/lib/admin/selected-class";
import { createClient } from "@/lib/supabase/server";
import type { QuestionContent, QuestionMeta } from "@/lib/actions/questions";
import {
  pickTestConfigUpdate,
  TEST_SYLLABUS_MAX_CHARS,
  type TestConfig,
} from "@/lib/tests/test-config-update";
import {
  pickRandomQuestionIds,
  resolveMcqBankScope,
  type RandomSelectionFilter,
} from "@/lib/tests/random-selection-scope";
import { publishTestErrorMessage } from "@/lib/tests/publish-test-errors";
import { lifecycleTestErrorMessage } from "@/lib/tests/lifecycle-test-errors";

// Types only — "use server" modules must not re-export sync helpers/constants.
export type { TestConfig } from "@/lib/tests/test-config-update";
export type { RandomSelectionFilter as QuestionFilter } from "@/lib/tests/random-selection-scope";

function reval(testId?: string) {
  revalidatePath("/admin/tests");
  if (testId) revalidatePath(`/admin/tests/${testId}`);
}

function normalizeSyllabus(
  syllabus: string | null | undefined
): string | null | { error: string } {
  if (syllabus == null) return null;
  const trimmed = syllabus.trim();
  if (!trimmed) return null;
  if (trimmed.length > TEST_SYLLABUS_MAX_CHARS) {
    return {
      error: `Syllabus must be at most ${TEST_SYLLABUS_MAX_CHARS} characters.`,
    };
  }
  return trimmed;
}

export async function createTest(config: TestConfig) {
  const selectedYearId = await readAdminSelectedYearId();
  if (!selectedYearId) {
    return { error: "Select a class before creating a test." };
  }
  const syllabusNorm = normalizeSyllabus(config.syllabus);
  if (typeof syllabusNorm === "object" && syllabusNorm && "error" in syllabusNorm) {
    return syllabusNorm;
  }
  // Class-first: create always binds to the selected admin class, not a
  // stale/empty Year control on the form.
  const bound: TestConfig = {
    ...config,
    year_id: selectedYearId,
    syllabus: syllabusNorm,
  };
  const supabase = await createClient();
  if (config.subject_id) {
    const { data: subject } = await supabase
      .from("subjects")
      .select("year_id")
      .eq("id", config.subject_id)
      .maybeSingle();
    if (!subject || subject.year_id !== selectedYearId) {
      return { error: "Subject must belong to the selected class." };
    }
  }
  const { data, error } = await supabase
    .from("tests")
    .insert(bound)
    .select("id")
    .single();
  if (error) return actionRpcResult("action", error);
  reval();
  redirect(`/admin/tests/${data.id}`);
}

export async function updateTestConfig(
  testId: string,
  config: Partial<TestConfig> & Record<string, unknown>
) {
  const picked = pickTestConfigUpdate(config);
  if ("error" in picked) {
    return {
      error:
        picked.error === "invalid_test_config_field"
          ? "Invalid test configuration field."
          : "No valid fields to update.",
    };
  }
  if (Object.prototype.hasOwnProperty.call(picked, "syllabus")) {
    const syllabusNorm = normalizeSyllabus(picked.syllabus);
    if (
      typeof syllabusNorm === "object" &&
      syllabusNorm &&
      "error" in syllabusNorm
    ) {
      return syllabusNorm;
    }
    picked.syllabus = syllabusNorm;
  }
  const supabase = await createClient();
  const { error } = await supabase.from("tests").update(picked).eq("id", testId);
  reval(testId);
  return actionRpcResult("action", error);
}

export async function addQuestionToTest(testId: string, questionId: string) {
  const supabase = await createClient();
  const { data: maxRow } = await supabase
    .from("test_questions")
    .select("position")
    .eq("test_id", testId)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();
  const { error } = await supabase.from("test_questions").insert({
    test_id: testId,
    question_id: questionId,
    position: (maxRow?.position ?? 0) + 1,
  });
  reval(testId);
  if (error) {
    // unique(test_id, question_id) — normally unreachable since the pool
    // already excludes questions already in the test, but a double-click
    // race is possible; give the same friendly duplicate message the
    // question-bank create flow uses rather than a raw constraint name.
    return {
      error:
        error.code === "23505"
          ? "That question is already in this test."
          : toClientActionError(error, "addQuestionToTest"),
    };
  }
  return { error: undefined };
}

/** Bulk-add approved bank questions to a draft test; skips already-in-test ids. */
export async function addQuestionsToTest(testId: string, questionIds: string[]) {
  const supabase = await createClient();
  const { data: test } = await supabase
    .from("tests")
    .select("status")
    .eq("id", testId)
    .maybeSingle();
  if (!test) return { error: "Test not found." };
  if (test.status !== "draft") {
    return { error: "Only draft tests can be edited." };
  }

  const uniqueIds = [...new Set(questionIds.filter(Boolean))];
  if (uniqueIds.length === 0) return { added: 0 };

  const { data: existing } = await supabase
    .from("test_questions")
    .select("question_id")
    .eq("test_id", testId);
  const excluded = new Set((existing ?? []).map((r) => r.question_id));
  const toAdd = uniqueIds.filter((id) => !excluded.has(id));
  if (toAdd.length === 0) return { added: 0 };

  const { data: maxRow } = await supabase
    .from("test_questions")
    .select("position")
    .eq("test_id", testId)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();
  const base = maxRow?.position ?? 0;

  const { error } = await supabase.from("test_questions").insert(
    toAdd.map((qid, i) => ({
      test_id: testId,
      question_id: qid,
      position: base + i + 1,
    }))
  );
  if (error) {
    return {
      error:
        error.code === "23505"
          ? "That question is already in this test."
          : toClientActionError(error, "addQuestionsToTest"),
    };
  }
  reval(testId);
  return { added: toAdd.length };
}

/**
 * Create an approved question via create_question (topic year must match the
 * test year), then attach it to the draft test.
 */
export async function createManualTestQuestion(
  testId: string,
  content: QuestionContent,
  meta: QuestionMeta
) {
  const supabase = await createClient();
  const { data: test } = await supabase
    .from("tests")
    .select("id, year_id, status")
    .eq("id", testId)
    .maybeSingle();
  if (!test) return { error: "Test not found." };
  if (test.status !== "draft") {
    return { error: "Only draft tests can be edited." };
  }

  const { data: topic } = await supabase
    .from("topics")
    .select("year_id")
    .eq("id", meta.topic_id)
    .maybeSingle();
  if (!topic || topic.year_id !== test.year_id) {
    return { error: "Topic must belong to the same year as this test." };
  }

  const { data: questionId, error } = await supabase.rpc("create_question", {
    p_topic_id: meta.topic_id,
    p_stem: content.stem,
    p_options: content.options,
    p_correct_key: content.correct_key,
    p_explanation: content.explanation,
    p_reference: content.reference,
    p_difficulty: meta.difficulty,
    p_tags: meta.tags ?? [],
    p_status: "approved",
  });
  if (error) {
    return {
      error:
        error.code === "23505"
          ? "An identical question already exists (duplicate)."
          : toClientActionError(error, "createManualTestQuestion"),
    };
  }

  revalidatePath("/admin/questions");
  return addQuestionToTest(testId, questionId as string);
}

// Swap `position` with the immediately-adjacent question (by current
// order). Delegates to a single SECURITY DEFINER RPC (reorder_test_question,
// 20260913000006_reorder_test_question_atomic.sql) so the swap is atomic —
// an earlier version of this action did the swap as three sequential
// client-side updates through a temporary position, which could leave a
// row permanently stuck mid-swap on a partial failure (a real risk:
// test_questions.position determines exam question order when
// shuffle_questions is off). Only meaningful pre-publish —
// protect_published_test_questions() already blocks any position change
// once the test is no longer 'draft', unchanged by this RPC.
export async function reorderQuestion(
  testId: string,
  questionId: string,
  direction: "up" | "down"
) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("reorder_test_question", {
    p_test_id: testId,
    p_question_id: questionId,
    p_direction: direction,
  });
  reval(testId);
  return actionRpcResult("action", error);
}

// Per-question marks override (test_questions.marks). null clears the
// override, falling back to tests.marks_per_question — exactly the
// coalesce(tq.marks, t.marks_per_question) already used by score_attempt.
export async function setQuestionMarks(
  testId: string,
  questionId: string,
  marks: number | null
) {
  if (marks !== null && !(marks > 0)) {
    return { error: "Marks must be a positive number, or blank to use the test default." };
  }
  const supabase = await createClient();
  const { error } = await supabase
    .from("test_questions")
    .update({ marks })
    .eq("test_id", testId)
    .eq("question_id", questionId);
  reval(testId);
  return actionRpcResult("action", error);
}

// "Add N randomly from this filtered set" — a builder convenience, not autopilot.
// Always scoped to the test's own year — a test must never pull random
// questions from a different year's curriculum regardless of what other
// filters are (or aren't) applied.
// MCQ Bank bank/folder/subfolder (when set) is an exact placement scope —
// never silently broaden to the whole departmental subject.
export async function addRandomQuestions(
  testId: string,
  filter: RandomSelectionFilter,
  n: number
) {
  const supabase = await createClient();

  const { data: test } = await supabase
    .from("tests")
    .select("year_id")
    .eq("id", testId)
    .single();
  if (!test) return { error: "Test not found." };

  const [{ data: existing }, { data: folderRows }, { data: subfolderRows }] =
    await Promise.all([
      supabase
        .from("test_questions")
        .select("question_id")
        .eq("test_id", testId),
      supabase
        .from("mcq_bank_folders")
        .select("id, year_id, academic_product_subject_id")
        .eq("year_id", test.year_id)
        .is("deleted_at", null),
      supabase
        .from("mcq_bank_subfolders")
        .select("id, folder_id")
        .is("deleted_at", null),
    ]);

  const folders = (folderRows ?? []) as Array<{
    id: string;
    year_id: string;
    academic_product_subject_id: string;
  }>;
  const folderIds = new Set(folders.map((f) => f.id));
  const subfolders = ((subfolderRows ?? []) as Array<{
    id: string;
    folder_id: string;
  }>).filter((s) => folderIds.has(s.folder_id));

  const mcqScope = resolveMcqBankScope({
    filter,
    testYearId: test.year_id,
    folders,
    subfolders,
  });
  if (mcqScope.kind === "invalid") {
    return {
      error:
        "MCQ Bank scope does not match this test class. Clear or re-select bank/folder/subfolder.",
    };
  }
  if (mcqScope.kind === "bank_folders" && mcqScope.folderIds.length === 0) {
    return { added: 0 };
  }

  const excluded = new Set((existing ?? []).map((r) => r.question_id));

  let q = supabase
    .from("questions")
    .select("id")
    .eq("status", "approved")
    .eq("year_id", test.year_id)
    .is("deleted_at", null);
  if (filter.subject_id) q = q.eq("subject_id", filter.subject_id);
  if (filter.book_id) q = q.eq("book_id", filter.book_id);
  if (filter.chapter_id) q = q.eq("chapter_id", filter.chapter_id);
  if (filter.topic_id) q = q.eq("topic_id", filter.topic_id);
  if (filter.difficulty) q = q.eq("difficulty", filter.difficulty);
  if (mcqScope.kind === "subfolder") {
    q = q.eq("mcq_bank_subfolder_id", mcqScope.subfolderId);
  } else if (mcqScope.kind === "folder") {
    q = q.eq("mcq_bank_folder_id", mcqScope.folderId);
  } else if (mcqScope.kind === "bank_folders") {
    q = q.in("mcq_bank_folder_id", mcqScope.folderIds);
  }

  const { data: pool, error } = await q.limit(2000);
  if (error) return actionRpcResult("action", error);

  const pickedIds = pickRandomQuestionIds({
    candidateIds: (pool ?? []).map((r) => r.id as string),
    excludedIds: excluded,
    n,
  });
  if (pickedIds.length === 0) return { added: 0 };

  const base = excluded.size;
  const { error: insErr } = await supabase.from("test_questions").insert(
    pickedIds.map((questionId, i) => ({
      test_id: testId,
      question_id: questionId,
      position: base + i + 1,
    }))
  );
  if (insErr) return actionRpcResult("addRandomQuestions.insert", insErr);
  reval(testId);
  return { added: pickedIds.length };
}

export async function removeQuestionFromTest(testId: string, questionId: string) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("test_questions")
    .delete()
    .eq("test_id", testId)
    .eq("question_id", questionId);
  reval(testId);
  return actionRpcResult("action", error);
}

export async function setAudienceYears(testId: string, yearIds: string[]) {
  const supabase = await createClient();
  await supabase.from("test_audiences").delete().eq("test_id", testId);
  if (yearIds.length > 0) {
    const { error } = await supabase
      .from("test_audiences")
      .insert(yearIds.map((y) => ({ test_id: testId, year_id: y })));
    if (error) return actionRpcResult("action", error);
  }
  reval(testId);
  return { error: undefined };
}

export async function upsertTestPrepGuidelines(testId: string, bodyText: string) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("upsert_test_prep_guidelines", {
    p_test_id: testId,
    p_body_text: bodyText,
  });
  reval(testId);
  revalidatePath(`/tests/${testId}/attempt`);
  revalidatePath("/tests");
  return actionRpcResult("action", error);
}

export async function publishTest(testId: string) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("publish_test", { p_test_id: testId });
  reval(testId);
  if (!error) return {};
  // Preserve existing publish_test checklist language for admins; do not
  // genericize "validation failed: …" through the snake_case-only sanitizer.
  logServerError("publishTest", error.message);
  return { error: publishTestErrorMessage(error.message) };
}

/** Hard-delete a draft test only — see public.delete_draft_test. */
export async function deleteDraftTest(testId: string) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("delete_draft_test", {
    p_test_id: testId,
  });
  if (error) return actionRpcResult("deleteDraftTest", error);
  reval();
  return {};
}

export async function closeTestNow(testId: string) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("close_test_now", { p_test_id: testId });
  reval(testId);
  return actionRpcResult("action", error);
}

/** Unopened published → draft (zero attempts). See return_to_draft_test. */
export async function returnToDraftTest(testId: string) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("return_to_draft_test", {
    p_test_id: testId,
  });
  reval(testId);
  revalidatePath("/tests");
  if (!error) return {};
  logServerError("returnToDraftTest", error.message);
  return { error: lifecycleTestErrorMessage(error.message) };
}

/** Conducted test → new unscheduled draft. Source unchanged. */
export async function reuseTestAsDraft(sourceTestId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("reuse_test_as_draft", {
    p_source_test_id: sourceTestId,
  });
  if (error) {
    logServerError("reuseTestAsDraft", error.message);
    return { error: lifecycleTestErrorMessage(error.message) };
  }
  const newId = data as string;
  reval();
  reval(newId);
  redirect(`/admin/tests/${newId}`);
}

export async function invalidateTest(testId: string, reason: string) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("invalidate_test", {
    p_test_id: testId,
    p_reason: reason,
  });
  reval(testId);
  return actionRpcResult("action", error);
}

export async function voidTestQuestion(
  testId: string,
  questionId: string,
  policy: "exclude" | "credit_all"
) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("void_test_question", {
    p_test_id: testId,
    p_question_id: questionId,
    p_policy: policy,
  });
  reval(testId);
  return actionRpcResult("action", error);
}
