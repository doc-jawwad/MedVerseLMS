/**
 * Regression: simultaneous retake starts must RESUME the winner's in-progress
 * attempt, never raise attempt_limit_reached / already_submitted / mismatch.
 *
 * Race being guarded (start_attempt, pre-lock decision): the "is there a live
 * attempt?" read and the "count attempts" read are separate statements. If the
 * winning request commits between them, the loser saw no live attempt but
 * counted it, and wrongly concluded the limit was reached.
 *
 * Pre-connects N clients, releases them together through a barrier, and
 * repeats for several rounds. Every outcome of every round must be a
 * successful start returning one and the same attempt id, with exactly one new
 * attempt row and the invalidated/submitted history intact.
 *
 * Usage:
 *   node tests/db/start-attempt-resume-race.mjs
 * Env: PGTAP_DB_URL or SUPABASE_DB_URL (defaults to local docker),
 *      RACE_ROUNDS (default 25), RACE_CLIENTS (default 16).
 * Requires supabase/tests/000_helpers.sql to have been loaded once.
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
const ROUNDS = Number(process.env.RACE_ROUNDS || 25);
const CLIENTS = Number(process.env.RACE_CLIENTS || 16);

assertNotCloudProduction(DB, { allowStaging: false });

const DEVICE = "aaaaaaaa-0000-4000-8000-0000000000d1";
let fail = 0;
function check(name, ok, detail) {
  if (ok) console.log(`ok - ${name}`);
  else {
    fail += 1;
    console.log(`not ok - ${name}`, detail ?? "");
  }
}

async function main() {
  const c = new pg.Client({ connectionString: DB });
  await c.connect();
  const created = { testId: null, studentId: null, adminId: null, curriculum: null, qids: [] };
  const outcomes = new Map();

  try {
    await c.query("reset role");
    const dbName = (await c.query("select current_database() as d")).rows[0].d;
    console.log(`target database: ${dbName}`);
    const cur = (await c.query(`select * from test_helpers.make_curriculum()`)).rows[0];
    created.curriculum = cur;
    created.adminId = (await c.query(`select test_helpers.make_admin('Race Admin') as id`)).rows[0].id;
    created.studentId = (
      await c.query(`select test_helpers.make_student($1::uuid, 'Race Student') as id`, [cur.year_id])
    ).rows[0].id;
    created.testId = (
      await c.query(
        `insert into public.tests (title, year_id, status, opens_at, closes_at, duration_minutes,
           negative_mark, min_questions, max_attempts)
         values ('PGRACE resume', $1::uuid, 'draft', now() - interval '1 minute',
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

    // Attempt #1: submitted history, so a retake (#2) is the contested start.
    const first = new pg.Client({ connectionString: DB });
    await first.connect();
    await first.query("begin");
    await first.query(`select set_config('request.jwt.claims', $1, true)`, [
      JSON.stringify({ sub: created.studentId, role: "authenticated" }),
    ]);
    await first.query("set local role authenticated");
    const a1 = (
      await first.query(`select public.start_attempt($1::uuid, $2::uuid, null) as p`, [created.testId, DEVICE])
    ).rows[0].p.attempt_id;
    await first.query("commit");
    await first.end();
    await c.query(
      `update public.test_attempts set state = 'submitted', submitted_at = now(),
         submit_source = 'student', score = 0, max_score = 3, percentage = 0 where id = $1::uuid`,
      [a1]
    );

    for (let round = 1; round <= ROUNDS; round += 1) {
      // Pre-connect + open transactions, then fire together.
      const clients = await Promise.all(
        Array.from({ length: CLIENTS }, async () => {
          const k = new pg.Client({ connectionString: DB });
          await k.connect();
          await k.query("begin");
          await k.query(`select set_config('request.jwt.claims', $1, true)`, [
            JSON.stringify({ sub: created.studentId, role: "authenticated" }),
          ]);
          await k.query("set local role authenticated");
          return k;
        })
      );
      const results = await Promise.all(
        clients.map(async (k) => {
          try {
            const r = await k.query(`select public.start_attempt($1::uuid, $2::uuid, 2) as p`, [
              created.testId,
              DEVICE,
            ]);
            await k.query("commit");
            return { ok: true, attemptId: r.rows[0].p.attempt_id };
          } catch (e) {
            await k.query("rollback").catch(() => {});
            return { ok: false, message: e.message };
          } finally {
            await k.end();
          }
        })
      );

      for (const r of results) {
        const key = r.ok ? "ok" : `ERR:${r.message}`;
        outcomes.set(key, (outcomes.get(key) ?? 0) + 1);
      }
      const ids = new Set(results.filter((r) => r.ok).map((r) => r.attemptId));
      const bad = results.filter((r) => !r.ok);
      const rows = (
        await c.query(
          `select count(*) filter (where state in ('in_progress','submitted'))::int as counted,
                  count(*) filter (where state = 'in_progress')::int as live
           from public.test_attempts where test_id = $1 and student_id = $2`,
          [created.testId, created.studentId]
        )
      ).rows[0];
      const roundOk = bad.length === 0 && ids.size === 1 && rows.counted === 2 && rows.live === 1;
      if (!roundOk) {
        check(`round ${round}/${ROUNDS}: all ${CLIENTS} resumed one attempt`, false, {
          errors: bad.map((b) => b.message),
          distinctAttemptIds: ids.size,
          rows,
        });
      }

      // Reset for the next round: remove the contested attempt (fixture only).
      await c.query(
        `delete from public.test_attempts where test_id = $1 and student_id = $2 and id <> $3::uuid`,
        [created.testId, created.studentId, a1]
      );
    }

    console.log("outcome distribution:", Object.fromEntries(outcomes));
    const errs = [...outcomes.keys()].filter((k) => k !== "ok");
    check(
      `${ROUNDS} rounds x ${CLIENTS} simultaneous retake starts: every request resumed the winner`,
      errs.length === 0,
      Object.fromEntries(outcomes)
    );
  } finally {
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
  console.log("\nALL RACE CHECKS PASSED");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
