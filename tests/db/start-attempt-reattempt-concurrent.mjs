/**
 * True multi-session concurrency proof for start_attempt reattempts
 * (docs/exam-state-machine.md "Attempt selection"). Local Postgres only.
 * Commits fixtures, races simultaneous starts from separate connections,
 * asserts no duplicate attempt rows, then cleans up.
 *
 * Usage:
 *   node tests/db/start-attempt-reattempt-concurrent.mjs
 * Env: PGTAP_DB_URL or SUPABASE_DB_URL (defaults to local docker).
 * Requires supabase/tests/000_helpers.sql to have been loaded once
 * (scripts/run-pgtap.mjs does this).
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import pg from "pg";
import { assertNotCloudProduction } from "../../scripts/lib/env-guard.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadEnv() {
  const p = path.join(__dirname, "../../.env.local");
  const out = {};
  if (fs.existsSync(p)) {
    for (const line of fs.readFileSync(p, "utf8").replace(/^﻿/, "").split(/\r?\n/)) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m) out[m[1]] = m[2];
    }
  }
  return out;
}

const env = loadEnv();
const DB =
  process.env.PGTAP_DB_URL ||
  env.SUPABASE_DB_URL ||
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

assertNotCloudProduction(DB, { allowStaging: false });

let fail = 0;
function check(name, ok, detail) {
  if (ok) console.log(`ok - ${name}`);
  else {
    fail += 1;
    console.log(`not ok - ${name}`, detail ?? "");
  }
}

const DEVICE_A = "aaaaaaaa-0000-4000-8000-0000000000c1";
const DEVICE_B = "bbbbbbbb-0000-4000-8000-0000000000c2";

/** One start_attempt call in its own connection + transaction (like one HTTP request). */
async function startAs(studentId, testId, device, attemptNo) {
  const c = new pg.Client({ connectionString: DB });
  await c.connect();
  try {
    await c.query("begin");
    await c.query(`select set_config('request.jwt.claims', $1, true)`, [
      JSON.stringify({ sub: studentId, role: "authenticated" }),
    ]);
    await c.query("set local role authenticated");
    const r = await c.query(
      `select public.start_attempt($1::uuid, $2::uuid, $3::int) as p`,
      [testId, device, attemptNo]
    );
    await c.query("commit");
    return { ok: true, attemptId: r.rows[0].p.attempt_id };
  } catch (e) {
    await c.query("rollback").catch(() => {});
    return { ok: false, message: e.message };
  } finally {
    await c.end();
  }
}

async function main() {
  const c = new pg.Client({ connectionString: DB });
  await c.connect();
  const created = { testId: null, studentId: null, adminId: null, curriculum: null, qids: [] };

  try {
    await c.query("reset role");
    const cur = (await c.query(`select * from test_helpers.make_curriculum()`)).rows[0];
    created.curriculum = cur;
    created.adminId = (await c.query(`select test_helpers.make_admin('Conc Admin') as id`)).rows[0].id;
    created.studentId = (
      await c.query(`select test_helpers.make_student($1::uuid, 'Conc Student') as id`, [cur.year_id])
    ).rows[0].id;

    created.testId = (
      await c.query(
        `insert into public.tests (title, year_id, status, opens_at, closes_at, duration_minutes,
           negative_mark, min_questions, max_attempts)
         values ('PGCONC reattempt', $1::uuid, 'draft', now() - interval '1 minute',
           now() + interval '2 hours', 60, 0, 1, 2) returning id`,
        [cur.year_id]
      )
    ).rows[0].id;
    for (let i = 1; i <= 3; i += 1) {
      const qid = (
        await c.query(`select test_helpers.make_question($1::uuid, 'A') as id`, [cur.topic_id])
      ).rows[0].id;
      created.qids.push(qid);
      await c.query(
        `insert into public.test_questions (test_id, question_id, position) values ($1, $2, $3)`,
        [created.testId, qid, i]
      );
    }
    await c.query(`insert into public.test_audiences (test_id, year_id) values ($1, $2)`, [
      created.testId,
      cur.year_id,
    ]);
    await c.query("begin");
    await c.query(`select test_helpers.as_user($1::uuid, gen_random_uuid())`, [created.adminId]);
    await c.query(`select public.publish_test($1::uuid)`, [created.testId]);
    await c.query("commit");
    await c.query("reset role");

    // Attempt #1: already submitted (history).
    const a1 = await startAs(created.studentId, created.testId, DEVICE_A, null);
    check("setup: first attempt started", a1.ok, a1);
    await c.query(
      `update public.test_attempts set state = 'submitted', submitted_at = now(),
         submit_source = 'student', score = 0, max_score = 3, percentage = 0
       where id = $1::uuid`,
      [a1.attemptId]
    );

    // Scenario A: 8 simultaneous retake clicks from the same device.
    const burst = await Promise.all(
      Array.from({ length: 8 }, () => startAs(created.studentId, created.testId, DEVICE_A, 2))
    );
    const okIds = new Set(burst.filter((r) => r.ok).map((r) => r.attemptId));
    check("A: every simultaneous retake request succeeded", burst.every((r) => r.ok), burst);
    check("A: all requests resolved to one attempt id", okIds.size === 1, [...okIds]);
    const rowsA = (
      await c.query(
        `select count(*)::int as total,
                count(*) filter (where state = 'in_progress')::int as live
         from public.test_attempts where test_id = $1 and student_id = $2`,
        [created.testId, created.studentId]
      )
    ).rows[0];
    check("A: exactly one new attempt row (2 total, 1 in progress)", rowsA.total === 2 && rowsA.live === 1, rowsA);

    // Scenario B: finish attempt #2; limit now reached. Racing retakes create nothing.
    await c.query(
      `update public.test_attempts set state = 'submitted', submitted_at = now(),
         submit_source = 'student', score = 0, max_score = 3, percentage = 0
       where id = $1::uuid`,
      [[...okIds][0]]
    );
    const exhausted = await Promise.all(
      Array.from({ length: 6 }, () => startAs(created.studentId, created.testId, DEVICE_A, 3))
    );
    check(
      "B: exhausted attempts -> attempt_limit_reached for every request",
      exhausted.every((r) => !r.ok && r.message.includes("attempt_limit_reached")),
      exhausted
    );
    const stale = await startAs(created.studentId, created.testId, DEVICE_A, 2);
    check("B: stale attempt number -> attempt_limit_reached (exhausted wins)", !stale.ok && stale.message.includes("attempt_limit_reached"), stale);
    const rowsB = (
      await c.query(`select count(*)::int as n from public.test_attempts where test_id = $1 and student_id = $2`, [
        created.testId,
        created.studentId,
      ])
    ).rows[0];
    check("B: still 2 attempt rows", rowsB.n === 2, rowsB);

    // Scenario C: invalidate #2, then two devices race the freed attempt.
    await c.query(
      `update public.test_attempts set state = 'invalidated', invalidated_reason = 'conc test',
         invalidated_by = $2::uuid where id = $1::uuid`,
      [[...okIds][0], created.adminId]
    );
    const race = await Promise.all([
      startAs(created.studentId, created.testId, DEVICE_A, 2),
      startAs(created.studentId, created.testId, DEVICE_B, 2),
      startAs(created.studentId, created.testId, DEVICE_A, 2),
      startAs(created.studentId, created.testId, DEVICE_B, 2),
    ]);
    const winners = new Set(race.filter((r) => r.ok).map((r) => r.attemptId));
    check("C: two devices racing created a single attempt", winners.size === 1, race);
    check(
      "C: the losing device is locked out, not given a second attempt",
      race.filter((r) => !r.ok).every((r) => r.message.includes("attempt_locked_other_device")),
      race
    );
    const rowsC = (
      await c.query(
        `select count(*) filter (where state in ('in_progress','submitted'))::int as counted,
                count(*) filter (where state = 'in_progress')::int as live,
                count(*) filter (where state = 'invalidated')::int as inv
         from public.test_attempts where test_id = $1 and student_id = $2`,
        [created.testId, created.studentId]
      )
    ).rows[0];
    check("C: counted=2, live=1, invalidated history kept", rowsC.counted === 2 && rowsC.live === 1 && rowsC.inv === 1, rowsC);
  } finally {
    // Cleanup of everything this script committed.
    await c.query("reset role").catch(() => {});
    await c.query("set session_replication_role = replica");
    if (created.testId) {
      await c.query(`delete from public.attempt_answers where attempt_id in
        (select id from public.test_attempts where test_id = $1)`, [created.testId]);
      await c.query(`delete from public.test_attempts where test_id = $1`, [created.testId]);
      await c.query(`delete from public.rank_dirty_queue where test_id = $1`, [created.testId]);
      await c.query(`delete from public.test_questions where test_id = $1`, [created.testId]);
      await c.query(`delete from public.test_audiences where test_id = $1`, [created.testId]);
      await c.query(`delete from public.tests where id = $1`, [created.testId]);
    }
    if (created.qids.length) {
      await c.query(`update public.questions set current_version_id = null where id = any($1::uuid[])`, [created.qids]);
      await c.query(`delete from public.question_versions where question_id = any($1::uuid[])`, [created.qids]);
      await c.query(`delete from public.questions where id = any($1::uuid[])`, [created.qids]);
    }
    for (const id of [created.studentId, created.adminId].filter(Boolean)) {
      // Replica mode skips FK actions: do what audit_logs_actor_fk's
      // ON DELETE SET NULL would do, so no orphaned actor_id is left behind.
      await c.query(`update public.audit_logs set actor_id = null where actor_id = $1`, [id]);
      await c.query(`delete from public.enrollments where student_id = $1`, [id]);
      await c.query(`delete from public.admin_permissions where admin_id = $1`, [id]);
      await c.query(`delete from public.profiles where id = $1`, [id]);
      await c.query(`delete from auth.users where id = $1`, [id]);
    }
    if (created.curriculum) {
      const k = created.curriculum;
      await c.query(`delete from public.topics where id = $1`, [k.topic_id]);
      await c.query(`delete from public.chapters where id = $1`, [k.chapter_id]);
      await c.query(`delete from public.books where id = $1`, [k.book_id]);
      await c.query(`delete from public.subjects where id = $1`, [k.subject_id]);
    }
    await c.query("set session_replication_role = origin");
    await c.end();
  }

  if (fail > 0) {
    console.log(`\n${fail} FAILURE(S)`);
    process.exit(1);
  }
  console.log("\nALL CONCURRENCY CHECKS PASSED");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
