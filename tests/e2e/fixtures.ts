import fs from "fs";
import path from "path";

// Provisions an isolated student + published test for e2e runs via the
// service-role REST API, so specs never depend on (or pollute) real app data.
// Cleans up in `teardown()`.

function loadEnvLocal(): Record<string, string> {
  const p = path.join(__dirname, "..", "..", ".env.local");
  const out: Record<string, string> = {};
  for (const line of fs.readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

const env = loadEnvLocal();
const BASE = env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

function svcHeaders(extra: Record<string, string> = {}) {
  return {
    apikey: SERVICE_KEY,
    Authorization: `Bearer ${SERVICE_KEY}`,
    "Content-Type": "application/json",
    ...extra,
  };
}

export type ExamFixture = {
  email: string;
  password: string;
  testId: string;
  studentId: string;
};

export async function provisionExamFixture(opts: {
  questionCount?: number;
  durationMinutes?: number;
  negativeMark?: number;
}): Promise<ExamFixture> {
  const suffix = Math.random().toString(36).slice(2, 10);
  const email = `e2e-${suffix}@test.invalid`;
  const password = "E2ePass123!";

  const yearRes = await fetch(`${BASE}/rest/v1/years?year_number=eq.1&select=id`, {
    headers: svcHeaders(),
  }).then((r) => r.json());
  const yearId = yearRes[0].id;

  const userRes = await fetch(`${BASE}/auth/v1/admin/users`, {
    method: "POST",
    headers: svcHeaders(),
    body: JSON.stringify({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: "E2E Student", year_id: yearId },
    }),
  }).then((r) => r.json());
  const studentId = userRes.id as string;

  const enrollRes = await fetch(
    `${BASE}/rest/v1/enrollments?student_id=eq.${studentId}&select=id`,
    { headers: svcHeaders() }
  ).then((r) => r.json());
  await fetch(`${BASE}/rest/v1/enrollments?id=eq.${enrollRes[0].id}`, {
    method: "PATCH",
    headers: svcHeaders(),
    body: JSON.stringify({ status: "active" }),
  });

  const subjRes = await fetch(
    `${BASE}/rest/v1/subjects?year_id=eq.${yearId}&select=id&limit=1`,
    { headers: svcHeaders() }
  ).then((r) => r.json());
  const subjectId = subjRes[0].id;

  const tag = `E2E_${suffix}`;
  const bookRes = await fetch(`${BASE}/rest/v1/books`, {
    method: "POST",
    headers: svcHeaders({ Prefer: "return=representation" }),
    body: JSON.stringify({ subject_id: subjectId, name: tag }),
  }).then((r) => r.json());
  const chapterRes = await fetch(`${BASE}/rest/v1/chapters`, {
    method: "POST",
    headers: svcHeaders({ Prefer: "return=representation" }),
    body: JSON.stringify({ book_id: bookRes[0].id, name: tag }),
  }).then((r) => r.json());
  const topicRes = await fetch(`${BASE}/rest/v1/topics`, {
    method: "POST",
    headers: svcHeaders({ Prefer: "return=representation" }),
    body: JSON.stringify({ chapter_id: chapterRes[0].id, name: tag }),
  }).then((r) => r.json());
  const topicId = topicRes[0].id;

  const n = opts.questionCount ?? 5;
  const questionIds: string[] = [];
  for (let i = 0; i < n; i++) {
    const qRes = await fetch(`${BASE}/rest/v1/questions`, {
      method: "POST",
      headers: svcHeaders({ Prefer: "return=representation" }),
      body: JSON.stringify({
        topic_id: topicId,
        status: "approved",
        difficulty: "medium",
        content_hash: `${tag}_${i}`,
        stem_normalized: `${tag} question ${i}`,
      }),
    }).then((r) => r.json());
    const qid = qRes[0].id;
    await fetch(`${BASE}/rest/v1/question_versions`, {
      method: "POST",
      headers: svcHeaders(),
      body: JSON.stringify({
        question_id: qid,
        version_no: 1,
        stem: `E2E fixture question ${i + 1}: pick option A.`,
        options: [
          { key: "A", text: "Correct option" },
          { key: "B", text: "Wrong option 1" },
          { key: "C", text: "Wrong option 2" },
          { key: "D", text: "Wrong option 3" },
        ],
        correct_key: "A",
        explanation: "A is correct by fixture design.",
        reference: "e2e fixture",
      }),
    });
    const vRes = await fetch(
      `${BASE}/rest/v1/question_versions?question_id=eq.${qid}&select=id`,
      { headers: svcHeaders() }
    ).then((r) => r.json());
    await fetch(`${BASE}/rest/v1/questions?id=eq.${qid}`, {
      method: "PATCH",
      headers: svcHeaders(),
      body: JSON.stringify({ current_version_id: vRes[0].id }),
    });
    questionIds.push(qid);
  }

  const testRes = await fetch(`${BASE}/rest/v1/tests`, {
    method: "POST",
    headers: svcHeaders({ Prefer: "return=representation" }),
    body: JSON.stringify({
      title: `E2E Exam ${suffix}`,
      year_id: yearId,
      status: "draft",
      opens_at: new Date(Date.now() - 60_000).toISOString(),
      closes_at: new Date(Date.now() + 2 * 3600_000).toISOString(),
      duration_minutes: opts.durationMinutes ?? 60,
      negative_mark: opts.negativeMark ?? 0,
      min_questions: 1,
    }),
  }).then((r) => r.json());
  const testId = testRes[0].id;

  await fetch(`${BASE}/rest/v1/test_questions`, {
    method: "POST",
    headers: svcHeaders(),
    body: JSON.stringify(
      questionIds.map((qid, i) => ({ test_id: testId, question_id: qid, position: i + 1 }))
    ),
  });
  await fetch(`${BASE}/rest/v1/test_audiences`, {
    method: "POST",
    headers: svcHeaders(),
    body: JSON.stringify({ test_id: testId, year_id: yearId }),
  });

  // publish_test() requires an admin JWT (auth.uid()-based gate) — sign in as
  // an existing admin via password grant, then call the RPC as them.
  const adminLogin = await fetch(`${BASE}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({
      email: "admin@medverse.local",
      password: "AdminPass123!",
    }),
  }).then((r) => r.json());
  await fetch(`${BASE}/rest/v1/rpc/publish_test`, {
    method: "POST",
    headers: {
      apikey: ANON_KEY,
      Authorization: `Bearer ${adminLogin.access_token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ p_test_id: testId }),
  });

  return { email, password, testId, studentId };
}

export async function teardownExamFixture(f: ExamFixture) {
  await fetch(`${BASE}/auth/v1/admin/users/${f.studentId}`, {
    method: "DELETE",
    headers: svcHeaders(),
  });
  await fetch(`${BASE}/rest/v1/tests?id=eq.${f.testId}`, {
    method: "DELETE",
    headers: svcHeaders(),
  });
}

// Admin credentials shared with the publish_test call above — reused here
// so a Test Builder spec can drive the real admin UI end-to-end.
export const ADMIN_EMAIL = "admin@medverse.local";
export const ADMIN_PASSWORD = "AdminPass123!";

export type QuestionPoolFixture = {
  yearId: string;
  subjectId: string;
  bookId: string;
  chapterId: string;
  topicId: string;
  questionIds: string[];
  tag: string;
};

// Curriculum + N approved questions only — deliberately does NOT create or
// publish a test, so a Test Builder spec can build one itself through the
// admin UI (the thing actually under test) rather than having it
// pre-provisioned like provisionExamFixture does for the student-side specs.
export async function provisionQuestionPoolFixture(opts: {
  questionCount?: number;
}): Promise<QuestionPoolFixture> {
  const suffix = Math.random().toString(36).slice(2, 10);
  const tag = `E2E_TB_${suffix}`;

  const yearRes = await fetch(`${BASE}/rest/v1/years?year_number=eq.1&select=id`, {
    headers: svcHeaders(),
  }).then((r) => r.json());
  const yearId = yearRes[0].id;

  const subjRes = await fetch(
    `${BASE}/rest/v1/subjects?year_id=eq.${yearId}&select=id&limit=1`,
    { headers: svcHeaders() }
  ).then((r) => r.json());
  const subjectId = subjRes[0].id;

  const bookRes = await fetch(`${BASE}/rest/v1/books`, {
    method: "POST",
    headers: svcHeaders({ Prefer: "return=representation" }),
    body: JSON.stringify({ subject_id: subjectId, name: tag }),
  }).then((r) => r.json());
  const chapterRes = await fetch(`${BASE}/rest/v1/chapters`, {
    method: "POST",
    headers: svcHeaders({ Prefer: "return=representation" }),
    body: JSON.stringify({ book_id: bookRes[0].id, name: tag }),
  }).then((r) => r.json());
  const topicRes = await fetch(`${BASE}/rest/v1/topics`, {
    method: "POST",
    headers: svcHeaders({ Prefer: "return=representation" }),
    body: JSON.stringify({ chapter_id: chapterRes[0].id, name: tag }),
  }).then((r) => r.json());
  const topicId = topicRes[0].id;

  const n = opts.questionCount ?? 3;
  const questionIds: string[] = [];
  for (let i = 0; i < n; i++) {
    const qRes = await fetch(`${BASE}/rest/v1/questions`, {
      method: "POST",
      headers: svcHeaders({ Prefer: "return=representation" }),
      body: JSON.stringify({
        topic_id: topicId,
        status: "approved",
        difficulty: "medium",
        content_hash: `${tag}_${i}`,
        stem_normalized: `${tag} question ${i}`,
      }),
    }).then((r) => r.json());
    const qid = qRes[0].id;
    await fetch(`${BASE}/rest/v1/question_versions`, {
      method: "POST",
      headers: svcHeaders(),
      body: JSON.stringify({
        question_id: qid,
        version_no: 1,
        stem: `${tag} builder fixture question ${i + 1}`,
        options: [
          { key: "A", text: "Option A" },
          { key: "B", text: "Option B" },
          { key: "C", text: "Option C" },
          { key: "D", text: "Option D" },
        ],
        correct_key: "A",
        explanation: "Fixture explanation.",
        reference: "e2e fixture",
      }),
    });
    const vRes = await fetch(
      `${BASE}/rest/v1/question_versions?question_id=eq.${qid}&select=id`,
      { headers: svcHeaders() }
    ).then((r) => r.json());
    await fetch(`${BASE}/rest/v1/questions?id=eq.${qid}`, {
      method: "PATCH",
      headers: svcHeaders(),
      body: JSON.stringify({ current_version_id: vRes[0].id }),
    });
    questionIds.push(qid);
  }

  return { yearId, subjectId, bookId: bookRes[0].id, chapterId: chapterRes[0].id, topicId, questionIds, tag };
}

// Only deletes the test row (if any). question_versions are immutable —
// forbid_version_mutation() blocks UPDATE/DELETE unconditionally, for every
// role including service_role, with no bypass reachable via the Data API
// (only a raw SQL session can use session_replication_role to work around
// it, which e2e fixtures deliberately never use). That in turn blocks
// deleting `questions` (question_versions.question_id references it
// on delete cascade, and the trigger still fires on a cascaded delete) and
// therefore `topics`/`chapters`/`books` too. This matches
// teardownExamFixture's existing behavior above, which also never attempts
// to delete question/curriculum rows — not an oversight there, the same
// structural limitation applies. Tagged fixture rows (`E2E_TB_*`) are left
// behind by design, same as the rest of this suite's fixtures.
export async function teardownQuestionPoolFixture(
  f: QuestionPoolFixture,
  extra?: { testId?: string }
) {
  if (extra?.testId) {
    await fetch(`${BASE}/rest/v1/tests?id=eq.${extra.testId}`, {
      method: "DELETE",
      headers: svcHeaders(),
    });
  }
}
