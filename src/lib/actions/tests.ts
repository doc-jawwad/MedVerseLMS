"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type TestConfig = {
  title: string;
  year_id: string;
  subject_id: string | null;
  opens_at: string | null;
  closes_at: string | null;
  duration_minutes: number;
  marks_per_question: number;
  negative_mark: number;
  shuffle_questions: boolean;
  shuffle_options: boolean;
  show_review: "after_submit" | "after_close" | "never";
  min_questions: number;
};

function reval(testId?: string) {
  revalidatePath("/admin/tests");
  if (testId) revalidatePath(`/admin/tests/${testId}`);
}

export async function createTest(config: TestConfig) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("tests")
    .insert(config)
    .select("id")
    .single();
  if (error) return { error: error.message };
  reval();
  redirect(`/admin/tests/${data.id}`);
}

export async function updateTestConfig(testId: string, config: Partial<TestConfig>) {
  const supabase = await createClient();
  const { error } = await supabase.from("tests").update(config).eq("id", testId);
  reval(testId);
  return { error: error?.message };
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
          : error.message,
    };
  }
  return { error: undefined };
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
  return { error: error?.message };
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
  return { error: error?.message };
}

export type QuestionFilter = {
  subject_id?: string;
  book_id?: string;
  chapter_id?: string;
  topic_id?: string;
  difficulty?: string;
};

// "Add N randomly from this filtered set" — a builder convenience, not autopilot.
// Always scoped to the test's own year — a test must never pull random
// questions from a different year's curriculum regardless of what other
// filters are (or aren't) applied.
export async function addRandomQuestions(
  testId: string,
  filter: QuestionFilter,
  n: number
) {
  const supabase = await createClient();

  const { data: test } = await supabase
    .from("tests")
    .select("year_id")
    .eq("id", testId)
    .single();
  if (!test) return { error: "Test not found." };

  const { data: existing } = await supabase
    .from("test_questions")
    .select("question_id")
    .eq("test_id", testId);
  const excluded = new Set((existing ?? []).map((r) => r.question_id));

  let q = supabase
    .from("questions")
    .select("id")
    .eq("status", "approved")
    .eq("year_id", test.year_id);
  if (filter.subject_id) q = q.eq("subject_id", filter.subject_id);
  if (filter.book_id) q = q.eq("book_id", filter.book_id);
  if (filter.chapter_id) q = q.eq("chapter_id", filter.chapter_id);
  if (filter.topic_id) q = q.eq("topic_id", filter.topic_id);
  if (filter.difficulty) q = q.eq("difficulty", filter.difficulty);

  const { data: pool, error } = await q.limit(2000);
  if (error) return { error: error.message };

  const candidates = (pool ?? []).filter((r) => !excluded.has(r.id));
  // Fisher–Yates shuffle, take n
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
  }
  const picked = candidates.slice(0, n);
  if (picked.length === 0) return { added: 0 };

  const base = excluded.size;
  const { error: insErr } = await supabase.from("test_questions").insert(
    picked.map((r, i) => ({
      test_id: testId,
      question_id: r.id,
      position: base + i + 1,
    }))
  );
  if (insErr) return { error: insErr.message };
  reval(testId);
  return { added: picked.length };
}

export async function removeQuestionFromTest(testId: string, questionId: string) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("test_questions")
    .delete()
    .eq("test_id", testId)
    .eq("question_id", questionId);
  reval(testId);
  return { error: error?.message };
}

export async function setAudienceYears(testId: string, yearIds: string[]) {
  const supabase = await createClient();
  await supabase.from("test_audiences").delete().eq("test_id", testId);
  if (yearIds.length > 0) {
    const { error } = await supabase
      .from("test_audiences")
      .insert(yearIds.map((y) => ({ test_id: testId, year_id: y })));
    if (error) return { error: error.message };
  }
  reval(testId);
  return { error: undefined };
}

export async function publishTest(testId: string) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("publish_test", { p_test_id: testId });
  reval(testId);
  return { error: error?.message };
}

export async function closeTestNow(testId: string) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("close_test_now", { p_test_id: testId });
  reval(testId);
  return { error: error?.message };
}

export async function invalidateTest(testId: string, reason: string) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("invalidate_test", {
    p_test_id: testId,
    p_reason: reason,
  });
  reval(testId);
  return { error: error?.message };
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
  return { error: error?.message };
}
