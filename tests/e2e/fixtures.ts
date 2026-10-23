// Provisions an isolated student + published test for e2e runs via the
// Auth Admin + Data API, so specs never depend on (or pollute) real app data.
// Cleans up in `teardown()`.
//
// Staging (`E2E_TARGET=staging`): uses `.env.e2e.staging` and refuses production.
// Local: uses `.env.local`. PostgREST service_role must be a JWT; new-format
// `sb_secret_*` keys are Auth-Admin-only — REST then uses the staging admin JWT.

import { isJwtSecret, loadE2EEnv } from "./load-e2e-env";

const e2e = loadE2EEnv();
const AUTH = e2e.authUrl.replace(/\/$/, "");
const REST = e2e.restUrl.replace(/\/$/, "");
const SERVICE_KEY = e2e.serviceRoleKey;
const ANON_KEY = e2e.anonKey;

let cachedAdminJwt: { token: string; expMs: number } | null = null;

async function dataApiBearer(): Promise<string> {
  if (isJwtSecret(SERVICE_KEY)) return SERVICE_KEY;
  return adminAccessToken();
}

async function svcHeaders(extra: Record<string, string> = {}) {
  const bearer = await dataApiBearer();
  return {
    apikey: ANON_KEY,
    Authorization: `Bearer ${bearer}`,
    "Content-Type": "application/json",
    ...extra,
  };
}

function authAdminHeaders(extra: Record<string, string> = {}) {
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
  title: string;
};

export async function provisionExamFixture(opts: {
  questionCount?: number;
  durationMinutes?: number;
  negativeMark?: number;
  /** Reattempts: tests.max_attempts (omitted = DB default 1). */
  maxAttempts?: number;
  /** tests.show_review (omitted = DB default after_close). */
  showReview?: "after_submit" | "after_close" | "never";
}): Promise<ExamFixture> {
  const suffix = Math.random().toString(36).slice(2, 10);
  const email = `e2e-${suffix}@test.invalid`;
  const password = "E2ePass123!";

  const yearRes = await fetch(`${REST}/rest/v1/years?year_number=eq.1&select=id`, {
    headers: await svcHeaders(),
  }).then((r) => r.json());
  const yearId = yearRes[0].id;

  const userRes = await fetch(`${AUTH}/auth/v1/admin/users`, {
    method: "POST",
    headers: authAdminHeaders(),
    body: JSON.stringify({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: "E2E Student", year_id: yearId },
    }),
  }).then((r) => r.json());
  const studentId = userRes.id as string;
  if (!studentId) {
    throw new Error(`auth admin create user failed: ${JSON.stringify(userRes)}`);
  }
  // handle_new_user() inserts enrollments(status=active) when year_id is in
  // user_metadata. Admin JWT cannot SELECT/PATCH enrollments (student-only RLS),
  // and there is no service_role JWT for staging PostgREST — do not touch rows.

  const subjRes = await fetch(
    `${REST}/rest/v1/subjects?year_id=eq.${yearId}&select=id&limit=1`,
    { headers: await svcHeaders() }
  ).then((r) => r.json());
  const subjectId = subjRes[0].id;

  const tag = `E2E_${suffix}`;
  const bookRes = await fetch(`${REST}/rest/v1/books`, {
    method: "POST",
    headers: await svcHeaders({ Prefer: "return=representation" }),
    body: JSON.stringify({ subject_id: subjectId, name: tag }),
  }).then((r) => r.json());
  const chapterRes = await fetch(`${REST}/rest/v1/chapters`, {
    method: "POST",
    headers: await svcHeaders({ Prefer: "return=representation" }),
    body: JSON.stringify({ book_id: bookRes[0].id, name: tag }),
  }).then((r) => r.json());
  const topicRes = await fetch(`${REST}/rest/v1/topics`, {
    method: "POST",
    headers: await svcHeaders({ Prefer: "return=representation" }),
    body: JSON.stringify({ chapter_id: chapterRes[0].id, name: tag }),
  }).then((r) => r.json());
  const topicId = topicRes[0].id;

  const n = opts.questionCount ?? 5;
  const questionIds: string[] = [];
  for (let i = 0; i < n; i++) {
    const qRes = await fetch(`${REST}/rest/v1/questions`, {
      method: "POST",
      headers: await svcHeaders({ Prefer: "return=representation" }),
      body: JSON.stringify({
        topic_id: topicId,
        status: "approved",
        difficulty: "medium",
        content_hash: `${tag}_${i}`,
        stem_normalized: `${tag} question ${i}`,
      }),
    }).then((r) => r.json());
    const qid = qRes[0].id;
    await fetch(`${REST}/rest/v1/question_versions`, {
      method: "POST",
      headers: await svcHeaders(),
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
      `${REST}/rest/v1/question_versions?question_id=eq.${qid}&select=id`,
      { headers: await svcHeaders() }
    ).then((r) => r.json());
    await fetch(`${REST}/rest/v1/questions?id=eq.${qid}`, {
      method: "PATCH",
      headers: await svcHeaders(),
      body: JSON.stringify({ current_version_id: vRes[0].id }),
    });
    questionIds.push(qid);
  }

  const testRes = await fetch(`${REST}/rest/v1/tests`, {
    method: "POST",
    headers: await svcHeaders({ Prefer: "return=representation" }),
    body: JSON.stringify({
      title: `E2E Exam ${suffix}`,
      year_id: yearId,
      status: "draft",
      opens_at: new Date(Date.now() - 60_000).toISOString(),
      closes_at: new Date(Date.now() + 2 * 3600_000).toISOString(),
      duration_minutes: opts.durationMinutes ?? 60,
      negative_mark: opts.negativeMark ?? 0,
      min_questions: 1,
      ...(opts.maxAttempts !== undefined ? { max_attempts: opts.maxAttempts } : {}),
      ...(opts.showReview !== undefined ? { show_review: opts.showReview } : {}),
    }),
  }).then((r) => r.json());
  const testId = testRes[0].id;

  await fetch(`${REST}/rest/v1/test_questions`, {
    method: "POST",
    headers: await svcHeaders(),
    body: JSON.stringify(
      questionIds.map((qid, i) => ({ test_id: testId, question_id: qid, position: i + 1 }))
    ),
  });
  await fetch(`${REST}/rest/v1/test_audiences`, {
    method: "POST",
    headers: await svcHeaders(),
    body: JSON.stringify({ test_id: testId, year_id: yearId }),
  });

  // publish_test() requires an admin JWT (auth.uid()-based gate).
  const adminToken = await adminAccessToken();
  const publishRes = await fetch(`${REST}/rest/v1/rpc/publish_test`, {
    method: "POST",
    headers: {
      apikey: ANON_KEY,
      Authorization: `Bearer ${adminToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ p_test_id: testId }),
  });
  if (!publishRes.ok) {
    throw new Error(
      `publish_test failed: ${publishRes.status} ${await publishRes.text()}`
    );
  }

  // Cloud Auth does not fire VPS handle_new_user — ensure_profile creates
  // profiles/enrollments (required before subscription FK inserts).
  await ensureProfileForCredentials(email, password);

  return { email, password, testId, studentId, title: `E2E Exam ${suffix}` };
}

export async function teardownExamFixture(f: ExamFixture) {
  await fetch(`${AUTH}/auth/v1/admin/users/${f.studentId}`, {
    method: "DELETE",
    headers: authAdminHeaders(),
  });
  await deleteTestRowForE2e(f.testId);
}

/**
 * Issue #4 regression seed: N published in-window tests the student already
 * submitted. Opens earlier than a later open test so the old pre-filter cap
 * would hide that open test. Staging SSH only (direct attempt insert).
 */
export async function seedSubmittedInWindowFillersForDashboardCap(opts: {
  studentId: string;
  yearId: string;
  count: number;
  /** Base opens_at; fillers use base + i minutes. */
  opensAtBaseMs: number;
  tag: string;
}): Promise<string[]> {
  const sshHost = stagingSshHost();
  if (e2e.target !== "staging" || !sshHost) {
    throw new Error(
      "seedSubmittedInWindowFillersForDashboardCap requires E2E_TARGET=staging and E2E_STAGING_SSH"
    );
  }
  requireUuid(opts.studentId, "studentId");
  requireUuid(opts.yearId, "yearId");
  if (opts.count < 1 || opts.count > 40) {
    throw new Error(`count out of range: ${opts.count}`);
  }
  if (!/^E2E_[A-Za-z0-9_]+$/.test(opts.tag)) {
    throw new Error(`tag must be E2E_* alnum: ${opts.tag}`);
  }

  const closesAt = new Date(Date.now() + 4 * 3600_000).toISOString();
  const values: string[] = [];
  for (let i = 0; i < opts.count; i++) {
    const opensAt = new Date(opts.opensAtBaseMs + i * 60_000).toISOString();
    const title = `${opts.tag}_filler_${i}`.replace(/'/g, "''");
    values.push(
      `(gen_random_uuid(), '${title}', '${opts.yearId}'::uuid, ` +
        `'published', '${opensAt}'::timestamptz, '${closesAt}'::timestamptz, ` +
        `60, 0, 1, 'free')`
    );
  }

  // Insert published tests + audiences + submitted attempts in one shot.
  // question_order may be empty: dashboard listing only needs attempt state.
  const sql =
    `with ins as (` +
    `  insert into public.tests ` +
    `    (id, title, year_id, status, opens_at, closes_at, duration_minutes, ` +
    `     negative_mark, min_questions, entitlement) ` +
    `  values ${values.join(",")} ` +
    `  returning id` +
    `), aud as (` +
    `  insert into public.test_audiences (test_id, year_id) ` +
    `  select id, '${opts.yearId}'::uuid from ins` +
    `), att as (` +
    `  insert into public.test_attempts ` +
    `    (test_id, student_id, state, expires_at, submitted_at, submit_source, ` +
    `     device_id, question_order, score, max_score) ` +
    `  select id, '${opts.studentId}'::uuid, 'submitted', ` +
    `         now() + interval '1 hour', now(), 'student', ` +
    `         gen_random_uuid(), array[]::uuid[], 1, 1 ` +
    `  from ins ` +
    `  where current_database()='medverse_staging'` +
    `) select id::text from ins;`;

  const out = await stagingPsql(sshHost, sql);
  const ids = out
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) =>
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(l)
    );
  if (ids.length !== opts.count) {
    throw new Error(
      `seedSubmittedInWindowFillersForDashboardCap expected ${opts.count} ids, got ${ids.length}: ${out}`
    );
  }
  return ids;
}

/** Soft-delete Issue #4 filler tests (and cascade attempts). */
export async function teardownDashboardCapFillers(testIds: string[]) {
  const sshHost = stagingSshHost();
  if (e2e.target === "staging" && sshHost && testIds.length > 0) {
    for (const testId of testIds) requireUuid(testId, "testId");
    const list = testIds.map((id) => `'${id}'::uuid`).join(",");
    await stagingPsql(
      sshHost,
      `update public.tests set status='draft' where id in (${list}) ` +
        `and current_database()='medverse_staging'; ` +
        `delete from public.tests where id in (${list}) ` +
        `and current_database()='medverse_staging';`
    );
    return;
  }
  for (const testId of testIds) {
    requireUuid(testId, "testId");
    await deleteTestRowForE2e(testId);
  }
}

/** Year id for a test (staging SSH). */
export async function yearIdForTestE2e(testId: string): Promise<string> {
  requireUuid(testId, "testId");
  const sshHost = stagingSshHost();
  if (e2e.target !== "staging" || !sshHost) {
    throw new Error("yearIdForTestE2e requires E2E_TARGET=staging and E2E_STAGING_SSH");
  }
  const out = await stagingPsql(
    sshHost,
    `select year_id::text from public.tests where id='${testId}'::uuid ` +
      `and current_database()='medverse_staging';`
  );
  const m = out.match(
    /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i
  );
  if (!m) {
    throw new Error(`yearIdForTestE2e: no year for ${testId}: ${out}`);
  }
  return m[0];
}

export async function changeStudentYear(studentId: string, yearNumber: number) {
  const yearRes = await fetch(
    `${REST}/rest/v1/years?year_number=eq.${yearNumber}&select=id`,
    { headers: await svcHeaders() }
  ).then((r) => r.json());
  const yearId = yearRes[0].id as string;

  // Staging admin cannot mutate enrollments via PostgREST RLS. Prefer SSH SQL
  // bridge when configured; otherwise attempt Data API (local service_role JWT).
  const sshHost = stagingSshHost();
  if (e2e.target === "staging" && sshHost) {
    requireUuid(studentId, "studentId");
    requireUuid(yearId, "yearId");
    await stagingPsql(
      sshHost,
      `update public.enrollments set status='expired' where student_id='${studentId}'::uuid and status='active'; ` +
        `insert into public.enrollments (student_id, year_id, status) ` +
        `select '${studentId}'::uuid, '${yearId}'::uuid, 'active' ` +
        `where current_database()='medverse_staging';`
    );
    return;
  }

  const enrollRes = await fetch(
    `${REST}/rest/v1/enrollments?student_id=eq.${studentId}&status=eq.active&select=id`,
    { headers: await svcHeaders() }
  ).then((r) => r.json());
  if (!enrollRes?.[0]?.id) {
    throw new Error(
      `changeStudentYear: no visible enrollment (staging needs E2E_STAGING_SSH). got=${JSON.stringify(enrollRes)}`
    );
  }
  await fetch(`${REST}/rest/v1/enrollments?id=eq.${enrollRes[0].id}`, {
    method: "PATCH",
    headers: await svcHeaders(),
    body: JSON.stringify({ status: "expired" }),
  });
  await fetch(`${REST}/rest/v1/enrollments`, {
    method: "POST",
    headers: await svcHeaders(),
    body: JSON.stringify({
      student_id: studentId,
      year_id: yearId,
      status: "active",
    }),
  });
}

async function stagingPsql(sshHost: string, sql: string) {
  const { spawnSync } = await import("node:child_process");
  const wrapped =
    `sudo -n -u postgres psql -d medverse_staging -v ON_ERROR_STOP=1 -c ` +
    JSON.stringify(sql);
  const res = spawnSync("ssh", [sshHost, wrapped], {
    encoding: "utf8",
    shell: false,
  });
  if (res.status !== 0) {
    throw new Error(
      `stagingPsql failed: ${res.stderr || res.stdout || res.error}`
    );
  }
  return res.stdout || "";
}

function requireUuid(value: string, label: string) {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value
    )
  ) {
    throw new Error(`${label} is not a uuid: ${value}`);
  }
}

function stagingSshHost(): string | undefined {
  return e2e.stagingSsh || process.env.E2E_STAGING_SSH;
}

/** Password-grant + ensure_profile for Cloud Auth → VPS profiles bridge. */
async function ensureProfileForCredentials(email: string, password: string) {
  const login = await fetch(`${AUTH}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  }).then((r) => r.json());
  if (!login.access_token) {
    throw new Error(
      `ensureProfileForCredentials login failed: ${JSON.stringify(login)}`
    );
  }
  const res = await fetch(`${REST}/rest/v1/rpc/ensure_profile`, {
    method: "POST",
    headers: {
      apikey: ANON_KEY,
      Authorization: `Bearer ${login.access_token}`,
      "Content-Type": "application/json",
    },
    body: "{}",
  });
  if (!res.ok) {
    throw new Error(
      `ensure_profile failed: ${res.status} ${await res.text()}`
    );
  }
}

async function adminRpc(
  name: string,
  body: Record<string, unknown>
): Promise<{ ok: boolean; status: number; text: string; json: unknown }> {
  const token = await adminAccessToken();
  const res = await fetch(`${REST}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: {
      apikey: ANON_KEY,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json: unknown = text;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* keep text */
  }
  return { ok: res.ok, status: res.status, text, json };
}

export type PaidSubscriptionFixture = {
  subscriptionId: string;
  planId: string;
  /** Removes the fixture subscription row (staging SSH or Data API). */
  cleanup: () => Promise<void>;
};

export async function markTestPaidWithLiveSubscription(
  testId: string,
  studentId: string
): Promise<PaidSubscriptionFixture> {
  requireUuid(testId, "testId");
  requireUuid(studentId, "studentId");

  const planRes = await fetch(
    `${REST}/rest/v1/subscription_plans?is_complimentary=eq.false&select=id&limit=1`,
    { headers: await svcHeaders() }
  ).then((r) => r.json());
  const planId = planRes[0].id as string;
  requireUuid(planId, "planId");

  // Entitlement changes go through set_resource_entitlement (not a raw PATCH).
  const entRes = await adminRpc("set_resource_entitlement", {
    p_kind: "test",
    p_id: testId,
    p_entitlement: "any_subscription",
    p_required_plan_id: null,
  });
  if (!entRes.ok) {
    throw new Error(
      `set_resource_entitlement failed: ${entRes.status} ${entRes.text}`
    );
  }
  await fetch(`${REST}/rest/v1/tests?id=eq.${testId}`, {
    method: "PATCH",
    headers: await svcHeaders(),
    body: JSON.stringify({ show_review: "after_submit" }),
  });

  const starts = new Date(Date.now() - 86400_000).toISOString();
  const ends = new Date(Date.now() + 30 * 86400_000).toISOString();
  const sshHost = stagingSshHost();

  let subscriptionId: string | null = null;

  // Preferred product path: activate_subscription (manage_subscriptions).
  const act = await adminRpc("activate_subscription", {
    p_student_id: studentId,
    p_plan_id: planId,
    p_starts_at: starts,
    p_ends_at: ends,
    p_application_id: null,
    p_grace_days: 0,
    p_paid_access_mode: "all_entitled",
  });
  if (act.ok && typeof act.json === "string") {
    subscriptionId = act.json;
  } else if (act.ok && act.json && typeof act.json === "object") {
    // unexpected shape
    subscriptionId = String(act.json);
  }

  // Staging fallback: postgres via SSH (admin JWT cannot INSERT subscriptions).
  if (!subscriptionId && e2e.target === "staging" && sshHost) {
    const out = await stagingPsql(
      sshHost,
      `with ins as (` +
        `insert into public.subscriptions (` +
        `student_id, plan_id, status, starts_at, ends_at, grace_days, paid_access_mode` +
        `) select '${studentId}'::uuid, '${planId}'::uuid, 'active', ` +
        `'${starts}'::timestamptz, '${ends}'::timestamptz, 0, 'all_entitled' ` +
        `where current_database() = 'medverse_staging' ` +
        `returning id` +
        `) select id::text from ins;`
    );
    const m = out.match(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i
    );
    if (!m) {
      throw new Error(
        `staging subscription insert returned no id: ${out} (activate_subscription: ${act.status} ${act.text})`
      );
    }
    subscriptionId = m[0];
  }

  if (!subscriptionId) {
    // Local service_role JWT path
    const subRes = await fetch(`${REST}/rest/v1/subscriptions`, {
      method: "POST",
      headers: await svcHeaders({ Prefer: "return=representation" }),
      body: JSON.stringify({
        student_id: studentId,
        plan_id: planId,
        status: "active",
        starts_at: starts,
        ends_at: ends,
        grace_days: 0,
        paid_access_mode: "all_entitled",
      }),
    }).then((r) => r.json());
    if (!subRes?.[0]?.id) {
      throw new Error(
        `subscription create failed: ${JSON.stringify(subRes)}; activate_subscription=${act.status} ${act.text}`
      );
    }
    subscriptionId = subRes[0].id as string;
  }

  requireUuid(subscriptionId, "subscriptionId");

  return {
    subscriptionId,
    planId,
    cleanup: async () => {
      await deleteSubscriptionFixture(subscriptionId!);
    },
  };
}

export async function expireSubscription(subscriptionId: string) {
  requireUuid(subscriptionId, "subscriptionId");
  const ended = new Date(Date.now() - 3600_000).toISOString();
  const started = new Date(Date.now() - 2 * 86400_000).toISOString();

  // Preferred: set_subscription_end while still active (requires ends_at > starts_at).
  // That path also releases payment-proof R2 objects via release_subscription_payment_proof.
  let rpc = await adminRpc("set_subscription_end", {
    p_subscription_id: subscriptionId,
    p_ends_at: ended,
  });
  if (rpc.ok) return;

  const sshHost = stagingSshHost();
  if (e2e.target === "staging" && sshHost) {
    // Freshly activated rows have starts_at ≈ now; rewind starts_at so
    // ends_at < now still satisfies subscriptions_check (ends_at > starts_at),
    // then retry the RPC so payment-proof cleanup runs.
    await stagingPsql(
      sshHost,
      `update public.subscriptions set starts_at=least(starts_at, '${started}'::timestamptz) ` +
        `where id='${subscriptionId}'::uuid and status='active' ` +
        `and current_database()='medverse_staging';`
    );
    rpc = await adminRpc("set_subscription_end", {
      p_subscription_id: subscriptionId,
      p_ends_at: ended,
    });
    if (rpc.ok) return;

    // Last resort: expire + release via privileged SQL (keeps history; clears proof key).
    await stagingPsql(
      sshHost,
      `begin; ` +
        `update public.subscriptions set status='expired', ` +
        `starts_at=least(starts_at, '${started}'::timestamptz), ` +
        `ends_at='${ended}'::timestamptz ` +
        `where id='${subscriptionId}'::uuid and current_database()='medverse_staging'; ` +
        `select public.release_subscription_payment_proof('${subscriptionId}'::uuid); ` +
        `commit;`
    );
    return;
  }
  await fetch(`${REST}/rest/v1/subscriptions?id=eq.${subscriptionId}`, {
    method: "PATCH",
    headers: await svcHeaders(),
    body: JSON.stringify({
      status: "expired",
      starts_at: started,
      ends_at: ended,
    }),
  });
}

/** Restore live access after expire (renewal). Prefer new activate window via SSH/RPC. */
export async function renewSubscription(subscriptionId: string) {
  requireUuid(subscriptionId, "subscriptionId");
  const ends = new Date(Date.now() + 30 * 86400_000).toISOString();
  const sshHost = stagingSshHost();

  // Expired rows cannot use set_subscription_end (status must be active).
  // Staging: privileged SQL. Local: Data API PATCH.
  if (e2e.target === "staging" && sshHost) {
    await stagingPsql(
      sshHost,
      `update public.subscriptions set status='active', ends_at='${ends}'::timestamptz, ` +
        `deactivated_by=null, deactivated_at=null ` +
        `where id='${subscriptionId}'::uuid and current_database()='medverse_staging';`
    );
    return;
  }
  await fetch(`${REST}/rest/v1/subscriptions?id=eq.${subscriptionId}`, {
    method: "PATCH",
    headers: await svcHeaders(),
    body: JSON.stringify({ status: "active", ends_at: ends }),
  });
}

export async function deleteSubscriptionFixture(subscriptionId: string) {
  requireUuid(subscriptionId, "subscriptionId");
  const sshHost = stagingSshHost();
  if (e2e.target === "staging" && sshHost) {
    await stagingPsql(
      sshHost,
      `delete from public.subscriptions where id='${subscriptionId}'::uuid ` +
        `and current_database()='medverse_staging';`
    );
    return;
  }
  await fetch(`${REST}/rest/v1/subscriptions?id=eq.${subscriptionId}`, {
    method: "DELETE",
    headers: await svcHeaders(),
  });
}

// Admin credentials — staging uses E2E_ADMIN_*; local defaults remain for Test Builder.
export const ADMIN_EMAIL = e2e.adminEmail;
export const ADMIN_PASSWORD = e2e.adminPassword;

async function adminAccessToken(): Promise<string> {
  const now = Date.now();
  if (cachedAdminJwt && cachedAdminJwt.expMs > now + 60_000) {
    return cachedAdminJwt.token;
  }
  const adminLogin = await fetch(`${AUTH}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD,
    }),
  }).then((r) => r.json());
  if (!adminLogin.access_token) {
    throw new Error(`admin login failed: ${JSON.stringify(adminLogin)}`);
  }
  cachedAdminJwt = {
    token: adminLogin.access_token as string,
    expMs: now + 50 * 60_000,
  };
  return cachedAdminJwt.token;
}

export async function closeTestNow(testId: string) {
  const token = await adminAccessToken();
  const res = await fetch(`${REST}/rest/v1/rpc/close_test_now`, {
    method: "POST",
    headers: {
      apikey: ANON_KEY,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ p_test_id: testId }),
  });
  if (!res.ok) {
    throw new Error(`close_test_now failed: ${res.status} ${await res.text()}`);
  }
}

/** Admin invalidates one attempt (controlled retake / ranking recompute). */
export async function invalidateAttemptAsAdmin(attemptId: string, reason: string) {
  requireUuid(attemptId, "attemptId");
  const res = await adminRpc("invalidate_attempt", {
    p_attempt_id: attemptId,
    p_reason: reason,
  });
  if (!res.ok) {
    throw new Error(`invalidate_attempt failed: ${res.status} ${res.text}`);
  }
}

/** Staging-only read-only scalar/rows query over the guarded SSH psql bridge. */
async function stagingRows(sql: string): Promise<string[]> {
  const sshHost = stagingSshHost();
  if (e2e.target !== "staging" || !sshHost) {
    throw new Error("stagingRows requires E2E_TARGET=staging and E2E_STAGING_SSH");
  }
  const { spawnSync } = await import("node:child_process");
  const wrapped =
    `sudo -n -u postgres env PGOPTIONS="-c default_transaction_read_only=on" ` +
    `psql -d medverse_staging -Atq -v ON_ERROR_STOP=1 -c ${JSON.stringify(sql)}`;
  const res = spawnSync("ssh", [sshHost, wrapped], { encoding: "utf8", shell: false });
  if (res.status !== 0) {
    throw new Error(`stagingRows failed: ${res.stderr || res.stdout || res.error}`);
  }
  return (res.stdout || "").split(/\r?\n/).filter((l) => l.trim().length > 0);
}

export type E2eAttemptRow = {
  id: string;
  state: string;
  score: number | null;
  rank: number | null;
};

/** The student's attempts on a test, oldest first (admin read via the guarded bridge). */
export async function listAttemptsForE2e(
  testId: string,
  studentId: string
): Promise<E2eAttemptRow[]> {
  requireUuid(testId, "testId");
  requireUuid(studentId, "studentId");
  const lines = await stagingRows(
    `select id||'|'||state||'|'||coalesce(score::text,'')||'|'||coalesce(rank::text,'') ` +
      `from public.test_attempts where test_id='${testId}'::uuid and student_id='${studentId}'::uuid ` +
      `and current_database()='medverse_staging' order by started_at, id`
  );
  return lines.map((l) => {
    const [id, state, score, rank] = l.split("|");
    return {
      id,
      state,
      score: score === "" ? null : Number(score),
      rank: rank === "" ? null : Number(rank),
    };
  });
}

/** Drain the coalesced ranking queue now (staging has no pg_cron tick). */
export async function rankDirtyNow() {
  const sshHost = stagingSshHost();
  if (e2e.target !== "staging" || !sshHost) {
    throw new Error("rankDirtyNow requires E2E_TARGET=staging and E2E_STAGING_SSH");
  }
  await stagingPsql(
    sshHost,
    `select public.rank_dirty_tests() where current_database()='medverse_staging';`
  );
}

export async function provisionEnrolledStudent(): Promise<{
  email: string;
  password: string;
  studentId: string;
}> {
  const suffix = Math.random().toString(36).slice(2, 10);
  const email = `e2e-${suffix}@test.invalid`;
  const password = "E2ePass123!";
  const yearRes = await fetch(`${REST}/rest/v1/years?year_number=eq.1&select=id`, {
    headers: await svcHeaders(),
  }).then((r) => r.json());
  const yearId = yearRes[0].id;
  const userRes = await fetch(`${AUTH}/auth/v1/admin/users`, {
    method: "POST",
    headers: authAdminHeaders(),
    body: JSON.stringify({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: "E2E Other Student", year_id: yearId },
    }),
  }).then((r) => r.json());
  const studentId = userRes.id as string;
  if (!studentId) {
    throw new Error(`auth admin create user failed: ${JSON.stringify(userRes)}`);
  }
  // Enrollment is created active by handle_new_user() via year_id metadata.
  await ensureProfileForCredentials(email, password);
  return { email, password, studentId };
}

export async function deleteStudent(studentId: string) {
  await fetch(`${AUTH}/auth/v1/admin/users/${studentId}`, {
    method: "DELETE",
    headers: authAdminHeaders(),
  });
}

export async function forceAttemptExpiry(testId: string, studentId: string) {
  requireUuid(testId, "testId");
  requireUuid(studentId, "studentId");
  const ended = new Date(Date.now() - 70_000).toISOString();
  const sshHost = stagingSshHost();
  if (e2e.target === "staging" && sshHost) {
    await stagingPsql(
      sshHost,
      `update public.test_attempts set expires_at='${ended}'::timestamptz ` +
        `where test_id='${testId}'::uuid and student_id='${studentId}'::uuid ` +
        `and current_database()='medverse_staging';`
    );
    return;
  }
  await fetch(
    `${REST}/rest/v1/test_attempts?test_id=eq.${testId}&student_id=eq.${studentId}`,
    {
      method: "PATCH",
      headers: await svcHeaders(),
      body: JSON.stringify({ expires_at: ended }),
    }
  );
}

export type QuestionPoolFixture = {
  yearId: string;
  subjectId: string;
  subjectName: string;
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

  const yearRes = await fetch(`${REST}/rest/v1/years?year_number=eq.1&select=id`, {
    headers: await svcHeaders(),
  }).then((r) => r.json());
  const yearId = yearRes[0].id;

  const subjRes = await fetch(
    `${REST}/rest/v1/subjects?year_id=eq.${yearId}&select=id,name&limit=1`,
    { headers: await svcHeaders() }
  ).then((r) => r.json());
  const subjectId = subjRes[0].id;
  const subjectName = String(subjRes[0].name);

  const bookRes = await fetch(`${REST}/rest/v1/books`, {
    method: "POST",
    headers: await svcHeaders({ Prefer: "return=representation" }),
    body: JSON.stringify({ subject_id: subjectId, name: tag }),
  }).then((r) => r.json());
  const chapterRes = await fetch(`${REST}/rest/v1/chapters`, {
    method: "POST",
    headers: await svcHeaders({ Prefer: "return=representation" }),
    body: JSON.stringify({ book_id: bookRes[0].id, name: tag }),
  }).then((r) => r.json());
  const topicRes = await fetch(`${REST}/rest/v1/topics`, {
    method: "POST",
    headers: await svcHeaders({ Prefer: "return=representation" }),
    body: JSON.stringify({ chapter_id: chapterRes[0].id, name: tag }),
  }).then((r) => r.json());
  const topicId = topicRes[0].id;

  const n = opts.questionCount ?? 3;
  const questionIds: string[] = [];
  for (let i = 0; i < n; i++) {
    const qRes = await fetch(`${REST}/rest/v1/questions`, {
      method: "POST",
      headers: await svcHeaders({ Prefer: "return=representation" }),
      body: JSON.stringify({
        topic_id: topicId,
        status: "approved",
        difficulty: "medium",
        content_hash: `${tag}_${i}`,
        stem_normalized: `${tag} question ${i}`,
      }),
    }).then((r) => r.json());
    const qid = qRes[0].id;
    await fetch(`${REST}/rest/v1/question_versions`, {
      method: "POST",
      headers: await svcHeaders(),
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
      `${REST}/rest/v1/question_versions?question_id=eq.${qid}&select=id`,
      { headers: await svcHeaders() }
    ).then((r) => r.json());
    await fetch(`${REST}/rest/v1/questions?id=eq.${qid}`, {
      method: "PATCH",
      headers: await svcHeaders(),
      body: JSON.stringify({ current_version_id: vRes[0].id }),
    });
    questionIds.push(qid);
  }

  return {
    yearId,
    subjectId,
    subjectName,
    bookId: bookRes[0].id,
    chapterId: chapterRes[0].id,
    topicId,
    questionIds,
    tag,
  };
}

/** Draft test row only — Test Builder e2e adds questions through the admin UI. */
export async function createDraftTestForBuilder(
  fixture: QuestionPoolFixture,
  title: string
): Promise<string> {
  const res = await fetch(`${REST}/rest/v1/tests`, {
    method: "POST",
    headers: await svcHeaders({ Prefer: "return=representation" }),
    body: JSON.stringify({
      title,
      year_id: fixture.yearId,
      status: "draft",
      opens_at: new Date(Date.now() - 60_000).toISOString(),
      closes_at: new Date(Date.now() + 2 * 3600_000).toISOString(),
      duration_minutes: 60,
      marks_per_question: 1,
      negative_mark: 0,
      min_questions: 1,
    }),
  }).then((r) => r.json());
  const id = Array.isArray(res) ? res[0]?.id : null;
  if (!id) {
    throw new Error(`create draft test failed: ${JSON.stringify(res)}`);
  }
  return String(id);
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
    await deleteTestRowForE2e(extra.testId);
  }
}

/** Draft Prof. Session day on Year 1 Block product subject (admin RPC). */
export async function createDraftProfSessionDay(
  name: string
): Promise<{ dayId: string; yearId: string; subjectId: string }> {
  const yearRes = await fetch(`${REST}/rest/v1/years?year_number=eq.1&select=id`, {
    headers: await svcHeaders(),
  }).then((r) => r.json());
  const yearId = yearRes[0]?.id as string | undefined;
  if (!yearId) throw new Error("year 1 missing");

  const subjRes = await fetch(
    `${REST}/rest/v1/subjects?year_id=eq.${yearId}&product_key=not.is.null&select=id,product_key&order=sort_order&limit=1`,
    { headers: await svcHeaders() }
  ).then((r) => r.json());
  const subjectId = subjRes[0]?.id as string | undefined;
  if (!subjectId) throw new Error("no product subject for year 1");

  const created = await adminRpc("admin_create_prof_session_day", {
    p_subject_id: subjectId,
    p_name: name,
    p_sort_order: null,
  });
  if (!created.ok || typeof created.json !== "string") {
    throw new Error(
      `admin_create_prof_session_day failed: ${created.status} ${created.text}`
    );
  }
  return { dayId: created.json, yearId, subjectId };
}

/** Publish a draft Prof. Session day so students can see it. */
export async function publishProfSessionDayForE2e(dayId: string) {
  requireUuid(dayId, "dayId");
  const res = await adminRpc("admin_update_prof_session_day", {
    p_day_id: dayId,
    p_name: null,
    p_sort_order: null,
    p_status: "published",
  });
  if (!res.ok) {
    throw new Error(
      `admin_update_prof_session_day failed: ${res.status} ${res.text}`
    );
  }
}

/** Soft-delete day into Content Bin (shared contract). */
export async function softDeleteProfSessionDayForE2e(dayId: string) {
  const res = await adminRpc("soft_delete_content", {
    p_entity_type: "prof_session_day",
    p_entity_id: dayId,
  });
  if (!res.ok) {
    throw new Error(
      `soft_delete_content(prof_session_day) failed: ${res.status} ${res.text}`
    );
  }
}

/** Attach a published test to a Prof. Session day (admin RPC; same year required). */
export async function linkTestToProfSessionDay(testId: string, dayId: string) {
  requireUuid(testId, "testId");
  requireUuid(dayId, "dayId");
  const res = await adminRpc("admin_set_test_prof_session_day", {
    p_test_id: testId,
    p_day_id: dayId,
  });
  if (!res.ok) {
    throw new Error(
      `admin_set_test_prof_session_day failed: ${res.status} ${res.text}`
    );
  }
}

/** product_key of the Year 1 Block subject used by createDraftProfSessionDay. */
export async function profSessionProductKey(subjectId: string): Promise<string> {
  requireUuid(subjectId, "subjectId");
  const rows = await fetch(
    `${REST}/rest/v1/subjects?id=eq.${subjectId}&select=product_key`,
    { headers: await svcHeaders() }
  ).then((r) => r.json());
  const key = rows[0]?.product_key as string | undefined;
  if (!key) throw new Error("subject has no product_key");
  return key;
}

/** E2E cleanup: tests_admin_delete is draft-only; reopen then hard-delete. */
async function deleteTestRowForE2e(testId: string) {
  await fetch(`${REST}/rest/v1/tests?id=eq.${testId}`, {
    method: "PATCH",
    headers: await svcHeaders(),
    body: JSON.stringify({ status: "draft" }),
  });
  await fetch(`${REST}/rest/v1/tests?id=eq.${testId}`, {
    method: "DELETE",
    headers: await svcHeaders(),
  });
}

export async function deletePublishedTest(testId: string) {
  requireUuid(testId, "testId");
  await deleteTestRowForE2e(testId);
}

/** Extra published test on year 1 for an existing fixture student (same tenant). */
export async function provisionCompanionPublishedTest(opts: {
  questionCount?: number;
  durationMinutes?: number;
  negativeMark?: number;
}): Promise<{ testId: string }> {
  const suffix = Math.random().toString(36).slice(2, 10);
  const yearRes = await fetch(`${REST}/rest/v1/years?year_number=eq.1&select=id`, {
    headers: await svcHeaders(),
  }).then((r) => r.json());
  const yearId = yearRes[0].id as string;
  const subjRes = await fetch(
    `${REST}/rest/v1/subjects?year_id=eq.${yearId}&select=id&limit=1`,
    { headers: await svcHeaders() }
  ).then((r) => r.json());
  const subjectId = subjRes[0].id as string;
  const tag = `E2E_C_${suffix}`;
  const bookRes = await fetch(`${REST}/rest/v1/books`, {
    method: "POST",
    headers: await svcHeaders({ Prefer: "return=representation" }),
    body: JSON.stringify({ subject_id: subjectId, name: tag }),
  }).then((r) => r.json());
  const chapterRes = await fetch(`${REST}/rest/v1/chapters`, {
    method: "POST",
    headers: await svcHeaders({ Prefer: "return=representation" }),
    body: JSON.stringify({ book_id: bookRes[0].id, name: tag }),
  }).then((r) => r.json());
  const topicRes = await fetch(`${REST}/rest/v1/topics`, {
    method: "POST",
    headers: await svcHeaders({ Prefer: "return=representation" }),
    body: JSON.stringify({ chapter_id: chapterRes[0].id, name: tag }),
  }).then((r) => r.json());
  const topicId = topicRes[0].id as string;

  const n = opts.questionCount ?? 2;
  const questionIds: string[] = [];
  for (let i = 0; i < n; i++) {
    const qRes = await fetch(`${REST}/rest/v1/questions`, {
      method: "POST",
      headers: await svcHeaders({ Prefer: "return=representation" }),
      body: JSON.stringify({
        topic_id: topicId,
        status: "approved",
        difficulty: "medium",
        content_hash: `${tag}_${i}`,
        stem_normalized: `${tag} question ${i}`,
      }),
    }).then((r) => r.json());
    const qid = qRes[0].id as string;
    await fetch(`${REST}/rest/v1/question_versions`, {
      method: "POST",
      headers: await svcHeaders(),
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
      `${REST}/rest/v1/question_versions?question_id=eq.${qid}&select=id`,
      { headers: await svcHeaders() }
    ).then((r) => r.json());
    await fetch(`${REST}/rest/v1/questions?id=eq.${qid}`, {
      method: "PATCH",
      headers: await svcHeaders(),
      body: JSON.stringify({ current_version_id: vRes[0].id }),
    });
    questionIds.push(qid);
  }

  const testRes = await fetch(`${REST}/rest/v1/tests`, {
    method: "POST",
    headers: await svcHeaders({ Prefer: "return=representation" }),
    body: JSON.stringify({
      title: `E2E Companion ${suffix}`,
      year_id: yearId,
      status: "draft",
      opens_at: new Date(Date.now() - 60_000).toISOString(),
      closes_at: new Date(Date.now() + 2 * 3600_000).toISOString(),
      duration_minutes: opts.durationMinutes ?? 60,
      negative_mark: opts.negativeMark ?? 0,
      min_questions: 1,
    }),
  }).then((r) => r.json());
  const testId = testRes[0].id as string;
  await fetch(`${REST}/rest/v1/test_questions`, {
    method: "POST",
    headers: await svcHeaders(),
    body: JSON.stringify(
      questionIds.map((qid, i) => ({
        test_id: testId,
        question_id: qid,
        position: i + 1,
      }))
    ),
  });
  await fetch(`${REST}/rest/v1/test_audiences`, {
    method: "POST",
    headers: await svcHeaders(),
    body: JSON.stringify({ test_id: testId, year_id: yearId }),
  });
  const publish = await adminRpc("publish_test", { p_test_id: testId });
  if (!publish.ok) {
    throw new Error(`publish_test failed: ${publish.status} ${publish.text}`);
  }
  return { testId };
}
