/**
 * Frozen exam membership / publication / year-change concurrency (#38).
 * True two- and three-session races on LOCAL DISPOSABLE PostgreSQL only.
 * Plan: docs/plans/frozen-exam-membership-concurrency-20261127.md (r3).
 *
 * Usage:
 *   node tests/db/frozen-exam-membership-concurrent.mjs            # races + sequential guards
 *   node tests/db/frozen-exam-membership-concurrent.mjs history-create <out.json>
 *   node tests/db/frozen-exam-membership-concurrent.mjs history-hash <in.json>
 *   FROZEN_RACE_ONLY=R1,R14 node tests/db/frozen-exam-membership-concurrent.mjs
 * Env: PGTAP_DB_URL or SUPABASE_DB_URL (defaults to local docker).
 *
 * Determinism: session A runs its step without committing; session B's
 * statement is launched un-awaited; the runner polls pg_blocking_pids(B)
 * until it contains A (fail if never blocked where blocking is expected, or
 * blocked where it is not). Every session has lock_timeout = 10s. Deadlock
 * victims are pinned with deadlock_timeout (A = 50ms, others = 10s).
 *
 * All fixtures are synthetic (PGTAP-style curriculum, fixture questions,
 * synthetic admins/students). No real user or exam rows are read or written.
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

const TAG = `frozen-${Date.now().toString(36)}`;
const ONLY = (process.env.FROZEN_RACE_ONLY || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const DEVICE = "11111111-1111-1111-1111-111111111111";

let failCount = 0;
let passCount = 0;
const summary = [];

function check(name, ok, detail) {
  if (ok) {
    passCount += 1;
    console.log(`ok - ${name}`);
  } else {
    failCount += 1;
    console.log(`not ok - ${name}`, detail === undefined ? "" : JSON.stringify(detail));
  }
  return ok;
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------
async function asUser(client, userId) {
  await client.query(`select set_config('request.jwt.claims', $1, false)`, [
    JSON.stringify({ sub: userId, role: "authenticated" }),
  ]);
  await client.query(`set role authenticated`);
}

async function open(userId, { deadlock = "10s" } = {}) {
  const c = new pg.Client({ connectionString: DB });
  await c.connect();
  c.on("error", () => {});
  await c.query(`set deadlock_timeout = '${deadlock}'`);
  await c.query(`set lock_timeout = '10s'`);
  const pid = (await c.query(`select pg_backend_pid() as p`)).rows[0].p;
  if (userId) await asUser(c, userId);
  return { c, pid };
}

async function close(...sessions) {
  for (const s of sessions) {
    if (!s) continue;
    try {
      await s.c.query("rollback");
    } catch {}
    await s.c.end().catch(() => {});
  }
}

/** Run a statement and capture its outcome without throwing. */
function settle(promise) {
  return promise.then(
    (r) => ({ ok: true, rows: r.rows }),
    (e) => ({ ok: false, code: e.code, message: e.message })
  );
}

async function blockedOn(runner, pidB, pidA, timeoutMs = 5000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const r = await runner.query(`select pg_blocking_pids($1::int) as b`, [pidB]);
    if ((r.rows[0].b || []).includes(pidA)) return true;
    await new Promise((res) => setTimeout(res, 25));
  }
  return false;
}

/** Resolves true if the promise settles within ms (i.e. was NOT blocked). */
async function settlesWithin(p, ms = 3000) {
  let done = false;
  p.then(() => (done = true));
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (done) return true;
    await new Promise((res) => setTimeout(res, 20));
  }
  return done;
}

// ---------------------------------------------------------------------------
// Synthetic fixtures (runner, committed; cleaned up at the end)
// ---------------------------------------------------------------------------
const created = { tests: [], questions: [], users: [], subjects: [] };

async function runnerClient() {
  const c = new pg.Client({ connectionString: DB });
  await c.connect();
  await c.query(`reset role`);
  return c;
}

async function makeCurriculum(r, yearNumber) {
  const year = (
    await r.query(`select id from public.years where year_number = $1`, [yearNumber])
  ).rows[0].id;
  const name = `PGTAP ${TAG} y${yearNumber} ${Math.random().toString(36).slice(2, 8)}`;
  const subject = (
    await r.query(
      `insert into public.subjects (year_id, name) values ($1, $2) returning id`,
      [year, name]
    )
  ).rows[0].id;
  created.subjects.push(subject);
  const book = (
    await r.query(`insert into public.books (subject_id, name) values ($1, $2) returning id`, [
      subject,
      name,
    ])
  ).rows[0].id;
  const chapter = (
    await r.query(`insert into public.chapters (book_id, name) values ($1, $2) returning id`, [
      book,
      name,
    ])
  ).rows[0].id;
  const topic = (
    await r.query(`insert into public.topics (chapter_id, name) values ($1, $2) returning id`, [
      chapter,
      name,
    ])
  ).rows[0].id;
  return { year, topic };
}

async function makeQuestion(r, topic) {
  const id = (await r.query(`select test_helpers.make_question($1) as id`, [topic])).rows[0].id;
  created.questions.push(id);
  return id;
}

async function makeAdmin(r, name) {
  const id = (await r.query(`select test_helpers.make_admin($1) as id`, [name])).rows[0].id;
  await r.query(`reset role`);
  created.users.push(id);
  return id;
}

async function makeLimitedAdmin(r, name, codes) {
  const id = (
    await r.query(`select test_helpers.make_limited_admin($1, $2::text[]) as id`, [name, codes])
  ).rows[0].id;
  await r.query(`reset role`);
  created.users.push(id);
  return id;
}

async function makeStudent(r, year, name) {
  const id = (await r.query(`select test_helpers.make_student($1, $2) as id`, [year, name])).rows[0]
    .id;
  await r.query(`reset role`);
  created.users.push(id);
  return id;
}

/** Draft test (valid for publish) with n fresh questions of `cur`. */
async function makeDraft(r, cur, n, { opensInFuture = false, minQuestions = 1 } = {}) {
  const opens = opensInFuture ? `now() + interval '1 day'` : `now() - interval '1 minute'`;
  const closes = opensInFuture ? `now() + interval '2 days'` : `now() + interval '2 hours'`;
  const testId = (
    await r.query(
      `insert into public.tests
         (title, year_id, status, opens_at, closes_at, duration_minutes, negative_mark, min_questions)
       values ($1, $2, 'draft', ${opens}, ${closes}, 60, 0, $3) returning id`,
      [`PGTAP ${TAG}`, cur.year, minQuestions]
    )
  ).rows[0].id;
  created.tests.push(testId);
  await r.query(`insert into public.test_audiences (test_id, year_id) values ($1, $2)`, [
    testId,
    cur.year,
  ]);
  const qids = [];
  for (let i = 0; i < n; i++) {
    const q = await makeQuestion(r, cur.topic);
    await r.query(
      `insert into public.test_questions (test_id, question_id, position) values ($1, $2, $3)`,
      [testId, q, i + 1]
    );
    qids.push(q);
  }
  return { testId, qids };
}

async function linkIds(r, testId) {
  return (
    await r.query(`select id, question_id from public.test_questions where test_id = $1 order by id`, [
      testId,
    ])
  ).rows;
}

async function publishAs(adminId, testId) {
  const s = await open(adminId);
  try {
    return await settle(s.c.query(`select public.publish_test($1)`, [testId]));
  } finally {
    await close(s);
  }
}

/** Post-case invariants for the given tests (published only for freeze/year). */
async function invariants(r, label, testIds) {
  const rows = (
    await r.query(
      `select t.id, t.status, t.question_count,
              (select count(*)::int from public.test_questions tq where tq.test_id = t.id) as actual,
              (select count(*)::int from public.test_questions tq
                 left join public.question_versions qv on qv.id = tq.question_version_id
                where tq.test_id = t.id
                  and (tq.question_version_id is null or qv.question_id is distinct from tq.question_id)) as unfrozen,
              (select count(*)::int from public.test_questions tq
                 join public.questions q on q.id = tq.question_id
                where tq.test_id = t.id and q.year_id is distinct from t.year_id) as mismatched
       from public.tests t where t.id = any($1::uuid[])`,
      [testIds]
    )
  ).rows;
  for (const t of rows) {
    check(`${label}: question_count exact (${t.id.slice(0, 8)})`, t.question_count === t.actual, t);
    if (t.status === "published") {
      check(`${label}: published links frozen (${t.id.slice(0, 8)})`, t.unfrozen === 0, t);
      check(`${label}: published links same-year (${t.id.slice(0, 8)})`, t.mismatched === 0, t);
    } else if (t.status === "draft" && !label.startsWith("R7")) {
      check(`${label}: no unexpected draft mismatch (${t.id.slice(0, 8)})`, t.mismatched === 0, t);
    }
  }
}

// ---------------------------------------------------------------------------
// History fixture: 3 published tests x 7 links = 21 wrong-year links, with
// submitted attempts, created on the pre-patch baseline via the realistic
// path (publish matching-year, attempts, then question topic move).
// ---------------------------------------------------------------------------
async function historyCreate(outFile) {
  const r = await runnerClient();
  try {
    const y1 = await makeCurriculum(r, 1);
    const y2 = await makeCurriculum(r, 2);
    const admin = await makeAdmin(r, `History admin ${TAG}`);
    const students = [
      await makeStudent(r, y1.year, `History student A ${TAG}`),
      await makeStudent(r, y1.year, `History student B ${TAG}`),
    ];
    const tests = [];
    for (let i = 0; i < 3; i++) {
      const d = await makeDraft(r, y1, 7);
      const p = await publishAs(admin, d.testId);
      if (!p.ok) throw new Error(`history publish failed: ${p.message}`);
      tests.push(d);
    }
    for (const t of tests) {
      for (const [si, st] of students.entries()) {
        const s = await open(st);
        try {
          const start = (
            await s.c.query(`select public.start_attempt($1, $2::uuid) as p`, [t.testId, DEVICE])
          ).rows[0].p;
          const qs = start.questions;
          for (const [i, q] of qs.entries()) {
            await s.c.query(
              `select public.save_answer($1, $2, $3, false, $4, $5::uuid)`,
              [start.attempt_id, q.question_version_id, (i + si) % 2 === 0 ? "A" : "B", i + 1, DEVICE]
            );
          }
          await s.c.query(`select public.submit_attempt($1, $2::uuid)`, [start.attempt_id, DEVICE]);
        } finally {
          await close(s);
        }
      }
    }
    // Pre-guard drift: move every linked question to a year-2 topic.
    const qids = tests.flatMap((t) => t.qids);
    await r.query(`update public.questions set topic_id = $1 where id = any($2::uuid[])`, [
      y2.topic,
      qids,
    ]);
    // Settle coalesced ranking now (the auto-submit cron would otherwise
    // write rank/percentile later and make the pre-hash a moving target).
    for (let i = 0; i < 10; i++) {
      await r.query(`select public.rank_dirty_tests()`);
      const n = (await r.query(`select count(*)::int n from public.rank_dirty_queue`)).rows[0].n;
      if (n === 0) break;
    }
    const wrong = (
      await r.query(
        `select tq.id from public.test_questions tq
         join public.tests t on t.id = tq.test_id
         join public.questions q on q.id = tq.question_id
         where t.id = any($1::uuid[]) and q.year_id is distinct from t.year_id order by tq.id`,
        [tests.map((t) => t.testId)]
      )
    ).rows.map((x) => x.id);
    const nonDraft = (
      await r.query(`select id from public.tests where status <> 'draft' order by id`)
    ).rows.map((x) => x.id);
    const out = {
      tag: TAG,
      fixtureTestIds: tests.map((t) => t.testId),
      wrongYearLinkIds: wrong,
      nonDraftTestIds: nonDraft,
    };
    fs.writeFileSync(outFile, JSON.stringify(out, null, 2));
    console.log(
      `history fixture: ${out.fixtureTestIds.length} tests, ${wrong.length} wrong-year links, ${nonDraft.length} non-draft tests -> ${outFile}`
    );
  } finally {
    await r.end();
  }
}

async function historyHash(inFile) {
  const fx = JSON.parse(fs.readFileSync(inFile, "utf8"));
  const r = await runnerClient();
  try {
    const ids = fx.nonDraftTestIds;
    const q = (sql) =>
      r.query(
        `select count(*)::int as n,
                encode(sha256(convert_to(coalesce(string_agg(x::text, '|' order by x::text), ''), 'UTF8')), 'hex') as h
         from (${sql}) x`,
        [ids]
      );
    const parts = {
      tests: await q(`select to_jsonb(t) as x from public.tests t where t.id = any($1::uuid[])`),
      test_questions: await q(
        `select to_jsonb(tq) as x from public.test_questions tq where tq.test_id = any($1::uuid[])`
      ),
      test_attempts: await q(
        `select to_jsonb(a) as x from public.test_attempts a where a.test_id = any($1::uuid[])`
      ),
      attempt_answers: await q(
        `select to_jsonb(aa) as x from public.attempt_answers aa
         join public.test_attempts a on a.id = aa.attempt_id where a.test_id = any($1::uuid[])`
      ),
      ranked_test_attempts: await q(
        `select to_jsonb(rk) as x from public.ranked_test_attempts rk where rk.test_id = any($1::uuid[])`
      ),
    };
    const wrongNow = (
      await r.query(
        `select tq.id from public.test_questions tq
         join public.tests t on t.id = tq.test_id
         join public.questions q on q.id = tq.question_id
         where t.id = any($1::uuid[]) and q.year_id is distinct from t.year_id order by tq.id`,
        [fx.fixtureTestIds]
      )
    ).rows.map((x) => x.id);
    const report = Object.fromEntries(
      Object.entries(parts).map(([k, v]) => [k, `${v.rows[0].n}:${v.rows[0].h}`])
    );
    report.wrong_year_links = `${wrongNow.length}:${wrongNow.join(",") === fx.wrongYearLinkIds.join(",") ? "ids-identical" : "IDS-CHANGED"}`;
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await r.end();
  }
}

// ---------------------------------------------------------------------------
// Cases
// ---------------------------------------------------------------------------
const ctx = {};

async function runCase(id, fn) {
  if (ONLY.length && !ONLY.includes(id)) return;
  const before = failCount;
  console.log(`# ${id}`);
  try {
    await fn();
  } catch (e) {
    check(`${id}: case threw`, false, e.message);
  }
  summary.push(`${id}: ${failCount === before ? "PASS" : "FAIL"}`);
}

const isFrozenErr = (o) => !o.ok && /questions of a published test are frozen/.test(o.message);
const notDeadlock = (o) => o.code !== "40P01";

async function main() {
  const r = await runnerClient();
  ctx.r = r;
  try {
    ctx.y1 = await makeCurriculum(r, 1);
    ctx.y2 = await makeCurriculum(r, 2);
    ctx.admin = await makeAdmin(r, `Frozen race admin ${TAG}`);
    ctx.limited = await makeLimitedAdmin(r, `Frozen race editor ${TAG}`, ["edit_questions"]);
    ctx.student = await makeStudent(r, ctx.y1.year, `Frozen race student ${TAG}`);
    const { y1, y2, admin } = ctx;

    // R1 attach first, publish blocked; new link must be frozen.
    await runCase("R1", async () => {
      const x = await makeDraft(r, y1, 2);
      const q = await makeQuestion(r, y1.topic);
      const A = await open(admin);
      const B = await open(admin);
      try {
        await A.c.query("begin");
        await A.c.query(
          `insert into public.test_questions (test_id, question_id, position) values ($1,$2,3)`,
          [x.testId, q]
        );
        const pB = settle(B.c.query(`select public.publish_test($1)`, [x.testId]));
        check("R1: publish blocked on attach", await blockedOn(r, B.pid, A.pid));
        await A.c.query("commit");
        const b = await pB;
        check("R1: publish succeeds after attach commits", b.ok && notDeadlock(b), b);
      } finally {
        await close(A, B);
      }
      await invariants(r, "R1", [x.testId]);
    });

    // R2 publish first, attach blocked then rejected.
    await runCase("R2", async () => {
      const x = await makeDraft(r, y1, 2);
      const q = await makeQuestion(r, y1.topic);
      const A = await open(admin);
      const B = await open(admin);
      try {
        await A.c.query("begin");
        await A.c.query(`select public.publish_test($1)`, [x.testId]);
        const pB = settle(
          B.c.query(
            `insert into public.test_questions (test_id, question_id, position) values ($1,$2,3)`,
            [x.testId, q]
          )
        );
        check("R2: attach blocked on publish", await blockedOn(r, B.pid, A.pid));
        await A.c.query("commit");
        const b = await pB;
        check("R2: attach rejected as frozen", isFrozenErr(b), b);
      } finally {
        await close(A, B);
      }
      await invariants(r, "R2", [x.testId]);
    });

    // R3 publish source first, reparent out blocked.
    await runCase("R3", async () => {
      const x = await makeDraft(r, y1, 2);
      const y = await makeDraft(r, y1, 0);
      const [l1] = await linkIds(r, x.testId);
      const A = await open(admin);
      const B = await open(admin);
      try {
        await A.c.query("begin");
        await A.c.query(`select public.publish_test($1)`, [x.testId]);
        const pB = settle(
          B.c.query(`update public.test_questions set test_id = $1 where id = $2`, [y.testId, l1.id])
        );
        check("R3: reparent blocked on publish", await blockedOn(r, B.pid, A.pid));
        await A.c.query("commit");
        const b = await pB;
        check("R3: reparent rejected, no deadlock", isFrozenErr(b) && notDeadlock(b), b);
      } finally {
        await close(A, B);
      }
      await invariants(r, "R3", [x.testId, y.testId]);
    });

    // R4 publish destination first, reparent in blocked.
    await runCase("R4", async () => {
      const x = await makeDraft(r, y1, 1);
      const y = await makeDraft(r, y1, 1);
      const [l1] = await linkIds(r, x.testId);
      const A = await open(admin);
      const B = await open(admin);
      try {
        await A.c.query("begin");
        await A.c.query(`select public.publish_test($1)`, [y.testId]);
        const pB = settle(
          B.c.query(`update public.test_questions set test_id = $1 where id = $2`, [y.testId, l1.id])
        );
        check("R4: reparent blocked on destination publish", await blockedOn(r, B.pid, A.pid));
        await A.c.query("commit");
        const b = await pB;
        check("R4: reparent into published rejected", isFrozenErr(b) && notDeadlock(b), b);
      } finally {
        await close(A, B);
      }
      const ylinks = await linkIds(r, y.testId);
      check("R4: destination frozen set unchanged", ylinks.length === 1, ylinks);
      await invariants(r, "R4", [x.testId, y.testId]);
    });

    // R5 delete link first, publish blocked; publishes reduced set.
    await runCase("R5", async () => {
      const x = await makeDraft(r, y1, 3);
      const links = await linkIds(r, x.testId);
      const A = await open(admin);
      const B = await open(admin);
      try {
        await A.c.query("begin");
        await A.c.query(`delete from public.test_questions where id = $1`, [links[2].id]);
        const pB = settle(B.c.query(`select public.publish_test($1)`, [x.testId]));
        check("R5: publish blocked on detach", await blockedOn(r, B.pid, A.pid));
        await A.c.query("commit");
        const b = await pB;
        check("R5: publish succeeds, no deadlock", b.ok, b);
      } finally {
        await close(A, B);
      }
      check("R5: reduced set published", (await linkIds(r, x.testId)).length === 2);
      await invariants(r, "R5", [x.testId]);
    });

    // R6 question year change breaking a matching link fails at once.
    await runCase("R6", async () => {
      const x = await makeDraft(r, y1, 1);
      const A = await open(admin);
      try {
        const a = await settle(
          A.c.query(`update public.questions set topic_id = $1 where id = $2`, [y2.topic, x.qids[0]])
        );
        check("R6: year change breaking matching link rejected (23514)", !a.ok && a.code === "23514", a);
      } finally {
        await close(A);
      }
    });

    // R7 + R9 accepted residual (draft mismatch) and post-lock re-read.
    await runCase("R7", async () => {
      const x = await makeDraft(r, y1, 1);
      const q = await makeQuestion(r, y1.topic);
      const A = await open(admin);
      const B = await open(admin);
      try {
        await A.c.query("begin");
        await A.c.query(`update public.questions set topic_id = $1 where id = $2`, [y2.topic, q]);
        const pB = settle(
          B.c.query(
            `insert into public.test_questions (test_id, question_id, position) values ($1,$2,2)`,
            [x.testId, q]
          )
        );
        check("R7: attach NOT blocked by question year change", await settlesWithin(pB));
        const b = await pB;
        check("R7: attach passes on old year", b.ok, b);
        await A.c.query("commit");
      } finally {
        await close(A, B);
      }
      const mm = (
        await r.query(
          `select count(*)::int n from public.test_questions tq join public.questions q on q.id=tq.question_id
           where tq.test_id=$1 and q.year_id <> $2`,
          [x.testId, y1.year]
        )
      ).rows[0].n;
      check("R7: expected draft mismatch present (documented residual)", mm === 1, mm);
      const p = await publishAs(admin, x.testId);
      check("R7: publication of mismatched draft fails 23514", !p.ok && /test_question_year_mismatch/.test(p.message), p);
      ctx.r7 = { x, q };
    });

    await runCase("R9", async () => {
      if (!ctx.r7) return check("R9: requires R7", false);
      const { x, q } = ctx.r7;
      for (const mode of ["rollback", "commit"]) {
        const A = await open(admin);
        const B = await open(admin);
        try {
          await A.c.query("begin");
          await A.c.query(`update public.questions set topic_id = $1 where id = $2`, [y1.topic, q]);
          const pB = settle(B.c.query(`select public.publish_test($1)`, [x.testId]));
          check(`R9 ${mode}: publish blocked on question row`, await blockedOn(r, B.pid, A.pid));
          await A.c.query(mode);
          const b = await pB;
          if (mode === "rollback") {
            check("R9 rollback: publish fails on committed old year", !b.ok && /test_question_year_mismatch/.test(b.message), b);
          } else {
            check("R9 commit: publish re-reads locked year and succeeds", b.ok, b);
          }
        } finally {
          await close(A, B);
        }
      }
      await invariants(r, "R9", [x.testId]);
    });

    // R8 publish holds the question; year change blocked then rejected.
    await runCase("R8", async () => {
      const x = await makeDraft(r, y1, 1);
      const A = await open(admin);
      const B = await open(admin);
      try {
        await A.c.query("begin");
        await A.c.query(`select public.publish_test($1)`, [x.testId]);
        const pB = settle(
          B.c.query(`update public.questions set topic_id = $1 where id = $2`, [y2.topic, x.qids[0]])
        );
        check("R8: year change blocked on publish", await blockedOn(r, B.pid, A.pid));
        await A.c.query("commit");
        const b = await pB;
        check("R8: year change rejected (Y1)", !b.ok && b.code === "23514", b);
      } finally {
        await close(A, B);
      }
      await invariants(r, "R8", [x.testId]);
    });

    // R10 draft test year change holds the test; attach re-reads year.
    await runCase("R10", async () => {
      const x = await makeDraft(r, y1, 0);
      const q = await makeQuestion(r, y1.topic);
      const A = await open(admin);
      const B = await open(admin);
      try {
        await A.c.query("begin");
        await A.c.query(`update public.tests set year_id = $1 where id = $2`, [y2.year, x.testId]);
        const pB = settle(
          B.c.query(
            `insert into public.test_questions (test_id, question_id, position) values ($1,$2,1)`,
            [x.testId, q]
          )
        );
        check("R10: attach blocked on draft year change", await blockedOn(r, B.pid, A.pid));
        await A.c.query("commit");
        const b = await pB;
        check("R10: attach rejected on locked new year (23514)", !b.ok && b.code === "23514", b);
      } finally {
        await close(A, B);
      }
      await invariants(r, "R10", [x.testId]);
    });

    // R11 reparent holds both parents; insert into destination waits.
    await runCase("R11", async () => {
      const x = await makeDraft(r, y1, 2);
      const y = await makeDraft(r, y1, 1);
      const q = await makeQuestion(r, y1.topic);
      const [l1] = await linkIds(r, x.testId);
      const A = await open(admin);
      const B = await open(admin);
      try {
        await A.c.query("begin");
        await A.c.query(`update public.test_questions set test_id = $1, position = 10 where id = $2`, [
          y.testId,
          l1.id,
        ]);
        const pB = settle(
          B.c.query(
            `insert into public.test_questions (test_id, question_id, position) values ($1,$2,11)`,
            [y.testId, q]
          )
        );
        check("R11: insert blocked on reparent", await blockedOn(r, B.pid, A.pid));
        await A.c.query("commit");
        const b = await pB;
        check("R11: insert succeeds", b.ok, b);
      } finally {
        await close(A, B);
      }
      await invariants(r, "R11", [x.testId, y.testId]);
    });

    // R12 two publishes sharing a question serialize without deadlock.
    await runCase("R12", async () => {
      const x = await makeDraft(r, y1, 1);
      const z = await makeDraft(r, y1, 1);
      await r.query(
        `insert into public.test_questions (test_id, question_id, position) values ($1,$2,2)`,
        [z.testId, x.qids[0]]
      );
      const A = await open(admin);
      const B = await open(admin);
      try {
        await A.c.query("begin");
        await A.c.query(`select public.publish_test($1)`, [x.testId]);
        const pB = settle(B.c.query(`select public.publish_test($1)`, [z.testId]));
        check("R12: second publish blocked on shared question", await blockedOn(r, B.pid, A.pid));
        await A.c.query("commit");
        const b = await pB;
        check("R12: second publish succeeds, no deadlock", b.ok, b);
      } finally {
        await close(A, B);
      }
      await invariants(r, "R12", [x.testId, z.testId]);
    });

    // R13 attempt holds the published test; membership writes rejected.
    await runCase("R13", async () => {
      const x = await makeDraft(r, y1, 2);
      const y = await makeDraft(r, y1, 0);
      const q = await makeQuestion(r, y1.topic);
      check("R13: setup publish", (await publishAs(admin, x.testId)).ok);
      const links = await linkIds(r, x.testId);
      const hash = async () =>
        (
          await r.query(
            `select md5(coalesce(string_agg(to_jsonb(a)::text, '|' order by a.id), '')) h from public.test_attempts a where a.test_id = $1`,
            [x.testId]
          )
        ).rows[0].h +
        (
          await r.query(
            `select md5(coalesce(string_agg(to_jsonb(tq)::text, '|' order by tq.id), '')) h from public.test_questions tq where tq.test_id = $1`,
            [x.testId]
          )
        ).rows[0].h;
      const A = await open(ctx.student);
      const B = await open(admin);
      let h0;
      try {
        await A.c.query("begin");
        await A.c.query(`select public.start_attempt($1, $2::uuid)`, [x.testId, DEVICE]);
        const pB = settle(
          B.c.query(
            `insert into public.test_questions (test_id, question_id, position) values ($1,$2,9)`,
            [x.testId, q]
          )
        );
        check("R13: attach blocked on start_attempt", await blockedOn(r, B.pid, A.pid));
        await A.c.query("commit");
        const b = await pB;
        check("R13: attach rejected", isFrozenErr(b), b);
        h0 = await hash();
        const d = await settle(B.c.query(`delete from public.test_questions where id = $1`, [links[0].id]));
        check("R13: delete rejected", isFrozenErr(d), d);
        const m = await settle(
          B.c.query(`update public.test_questions set test_id = $1 where id = $2`, [y.testId, links[1].id])
        );
        check("R13: reparent rejected", isFrozenErr(m), m);
      } finally {
        await close(A, B);
      }
      check("R13: attempt + membership rows hash-identical", (await hash()) === h0);
      await invariants(r, "R13", [x.testId, y.testId]);
    });

    // R14 publish first; existing-link UPDATE / DELETE wait on the child.
    await runCase("R14", async () => {
      const x = await makeDraft(r, y1, 3);
      const links = await linkIds(r, x.testId);
      const A = await open(admin);
      const B = await open(admin);
      try {
        await A.c.query("begin");
        await A.c.query(`select public.publish_test($1)`, [x.testId]);
        const pB = settle(
          B.c.query(`update public.test_questions set marks = 2 where id = $1`, [links[0].id])
        );
        check("R14: link UPDATE blocked on publish", await blockedOn(r, B.pid, A.pid));
        await A.c.query("commit");
        const b = await pB;
        check(
          "R14: link UPDATE rejected after publish, no deadlock",
          !b.ok && notDeadlock(b) && /only voiding may change/.test(b.message),
          b
        );
        const d = await settle(B.c.query(`delete from public.test_questions where id = $1`, [links[1].id]));
        check("R14: link DELETE rejected", isFrozenErr(d), d);
      } finally {
        await close(A, B);
      }
      await invariants(r, "R14", [x.testId]);
    });

    // R14-NC negative control: the r1 ordering (test row first, then child
    // freeze) against an existing-link writer deadlocks under real barriers.
    await runCase("R14-NC", async () => {
      const x = await makeDraft(r, y1, 1);
      const [l1] = await linkIds(r, x.testId);
      const A = await open(admin, { deadlock: "50ms" });
      const B = await open(admin);
      try {
        await A.c.query("begin");
        await A.c.query(`select 1 from public.tests where id = $1 for update`, [x.testId]);
        const pB = settle(B.c.query(`update public.test_questions set marks = 2 where id = $1`, [l1.id]));
        check("R14-NC: writer holds child and waits on test row", await blockedOn(r, B.pid, A.pid));
        const a = await settle(
          A.c.query(
            `update public.test_questions tq set question_version_id = q.current_version_id
             from public.questions q where q.id = tq.question_id and tq.id = $1`,
            [l1.id]
          )
        );
        check("R14-NC: r1 ordering deadlocks (A is the pinned victim, 40P01)", !a.ok && a.code === "40P01", a);
        await A.c.query("rollback").catch(() => {});
        const b = await pB;
        check("R14-NC: writer proceeds after victim rollback", b.ok, b);
      } finally {
        await close(A, B);
      }
    });

    // R15 writer holds the child first; publish waits in L0, no deadlock.
    await runCase("R15", async () => {
      for (const mode of ["commit", "rollback"]) {
        const x = await makeDraft(r, y1, 2);
        const [l1] = await linkIds(r, x.testId);
        const A = await open(admin);
        const B = await open(admin);
        try {
          await A.c.query("begin");
          await A.c.query(`update public.test_questions set marks = 3 where id = $1`, [l1.id]);
          const pB = settle(B.c.query(`select public.publish_test($1)`, [x.testId]));
          check(`R15 ${mode}: publish blocked on child writer`, await blockedOn(r, B.pid, A.pid));
          await A.c.query(mode);
          const b = await pB;
          check(`R15 ${mode}: publish succeeds, no deadlock`, b.ok, b);
          const m = (await r.query(`select marks from public.test_questions where id = $1`, [l1.id])).rows[0]
            .marks;
          check(
            `R15 ${mode}: frozen row carries ${mode === "commit" ? "updated" : "original"} marks`,
            mode === "commit" ? Number(m) === 3 : m === null,
            m
          );
        } finally {
          await close(A, B);
        }
        await invariants(r, `R15 ${mode}`, [x.testId]);
      }
    });

    // R16 X1 residual: out-of-order multi-statement writer vs publish.
    await runCase("R16", async () => {
      const x = await makeDraft(r, y1, 2);
      const [lo, hi] = await linkIds(r, x.testId);
      const A = await open(admin, { deadlock: "50ms" });
      const B = await open(admin);
      try {
        await A.c.query("begin");
        await A.c.query(`update public.test_questions set marks = 4 where id = $1`, [hi.id]);
        const pB = settle(B.c.query(`select public.publish_test($1)`, [x.testId]));
        check("R16: publish holds lo, waits on hi", await blockedOn(r, B.pid, A.pid));
        const a = await settle(A.c.query(`update public.test_questions set marks = 4 where id = $1`, [lo.id]));
        check("R16: writer is the pinned 40P01 victim (abort-safe residual X1)", !a.ok && a.code === "40P01", a);
        await A.c.query("rollback").catch(() => {});
        const b = await pB;
        check("R16: publish completes", b.ok, b);
      } finally {
        await close(A, B);
      }
      const marks = (await r.query(`select marks from public.test_questions where test_id = $1`, [x.testId])).rows;
      check("R16: victim fully rolled back", marks.every((m) => m.marks === null), marks);
      await invariants(r, "R16", [x.testId]);
    });

    // R17 reorder RPC vs publish.
    await runCase("R17", async () => {
      const x = await makeDraft(r, y1, 3);
      const A = await open(admin);
      const B = await open(admin);
      try {
        await A.c.query("begin");
        await A.c.query(`select public.reorder_test_question($1, $2, 'up')`, [x.testId, x.qids[1]]);
        const pB = settle(B.c.query(`select public.publish_test($1)`, [x.testId]));
        check("R17: publish blocked on reorder", await blockedOn(r, B.pid, A.pid));
        await A.c.query("commit");
        const b = await pB;
        check("R17: publish succeeds, no deadlock", b.ok, b);
      } finally {
        await close(A, B);
      }
      const order = (
        await r.query(`select question_id from public.test_questions where test_id = $1 order by position`, [x.testId])
      ).rows.map((o) => o.question_id);
      check("R17: frozen positions match post-reorder order", order.join() === [x.qids[1], x.qids[0], x.qids[2]].join(), order);
      await invariants(r, "R17", [x.testId]);
    });

    // R18 return_to_draft_test vs link writer, both orders.
    await runCase("R18", async () => {
      {
        const x = await makeDraft(r, y1, 2, { opensInFuture: true });
        check("R18: setup publish", (await publishAs(admin, x.testId)).ok);
        const [l1] = await linkIds(r, x.testId);
        const A = await open(admin);
        const B = await open(admin);
        try {
          await A.c.query("begin");
          await A.c.query(`select public.return_to_draft_test($1)`, [x.testId]);
          const pB = settle(B.c.query(`update public.test_questions set marks = 2 where id = $1`, [l1.id]));
          check("R18a: link writer blocked on return_to_draft", await blockedOn(r, B.pid, A.pid));
          await A.c.query("commit");
          const b = await pB;
          check("R18a: link writer succeeds on the draft", b.ok, b);
        } finally {
          await close(A, B);
        }
        await invariants(r, "R18a", [x.testId]);
      }
      {
        const x = await makeDraft(r, y1, 2, { opensInFuture: true });
        check("R18: setup publish 2", (await publishAs(admin, x.testId)).ok);
        const [l1] = await linkIds(r, x.testId);
        const A = await open(admin);
        const B = await open(admin);
        try {
          await A.c.query("begin");
          await A.c.query(`update public.test_questions set voided = voided where id = $1`, [l1.id]);
          const pB = settle(B.c.query(`select public.return_to_draft_test($1)`, [x.testId]));
          check("R18b: return_to_draft blocked on child writer", await blockedOn(r, B.pid, A.pid));
          await A.c.query("commit");
          const b = await pB;
          check("R18b: return_to_draft succeeds, no deadlock", b.ok, b);
        } finally {
          await close(A, B);
        }
        await invariants(r, "R18b", [x.testId]);
      }
    });

    // R19 delete_draft_test vs detach.
    await runCase("R19", async () => {
      const x = await makeDraft(r, y1, 2);
      const [l1] = await linkIds(r, x.testId);
      const A = await open(admin);
      const B = await open(admin);
      try {
        await A.c.query("begin");
        await A.c.query(`delete from public.test_questions where id = $1`, [l1.id]);
        const pB = settle(B.c.query(`select public.delete_draft_test($1)`, [x.testId]));
        check("R19: delete_draft_test blocked on detach", await blockedOn(r, B.pid, A.pid));
        await A.c.query("commit");
        const b = await pB;
        check("R19: delete_draft_test succeeds, no deadlock", b.ok, b);
      } finally {
        await close(A, B);
      }
      const n = (await r.query(`select count(*)::int n from public.test_questions where test_id = $1`, [x.testId])).rows[0].n;
      check("R19: no orphan links", n === 0, n);
    });

    // R20 question state change before validation.
    await runCase("R20", async () => {
      const variants = [
        ["unapproved", `update public.questions set status = 'needs_revision' where id = $1`, /all questions approved/],
        ["soft-deleted", `update public.questions set deleted_at = now(), purge_after = now() + interval '7 days' where id = $1`, /no soft-deleted questions/],
        ["new-version", null, null],
      ];
      for (const [name, sql, expectErr] of variants) {
        const x = await makeDraft(r, y1, 1);
        const q = x.qids[0];
        const A = await open(null);
        const B = await open(admin);
        let v2 = null;
        try {
          await A.c.query("begin");
          if (sql) {
            await A.c.query(sql, [q]);
          } else {
            v2 = (
              await A.c.query(
                `insert into public.question_versions (question_id, version_no, stem, options, correct_key, explanation, reference)
                 select question_id, version_no + 1, stem || ' v2', options, correct_key, explanation, reference
                 from public.question_versions where id = (select current_version_id from public.questions where id = $1)
                 returning id`,
                [q]
              )
            ).rows[0].id;
            await A.c.query(`update public.questions set current_version_id = $1 where id = $2`, [v2, q]);
          }
          const pB = settle(B.c.query(`select public.publish_test($1)`, [x.testId]));
          check(`R20 ${name}: publish blocked on question before validation`, await blockedOn(r, B.pid, A.pid));
          await A.c.query("commit");
          const b = await pB;
          if (expectErr) {
            check(`R20 ${name}: publish validates committed state`, !b.ok && expectErr.test(b.message), b);
          } else {
            check(`R20 ${name}: publish succeeds`, b.ok, b);
            const fv = (await r.query(`select question_version_id from public.test_questions where test_id = $1`, [x.testId]))
              .rows[0].question_version_id;
            check(`R20 ${name}: freezes the new version`, fv === v2, { fv, v2 });
          }
        } finally {
          await close(A, B);
        }
        await invariants(r, `R20 ${name}`, [x.testId]);
      }
    });

    // R21 start_attempt holds published X; direct draft flip waits then fails.
    await runCase("R21", async () => {
      const x = await makeDraft(r, y1, 1);
      check("R21: setup publish", (await publishAs(admin, x.testId)).ok);
      const A = await open(ctx.student);
      const B = await open(admin);
      try {
        await A.c.query("begin");
        await A.c.query(`select public.start_attempt($1, $2::uuid)`, [x.testId, DEVICE]);
        const pB = settle(B.c.query(`update public.tests set status = 'draft' where id = $1`, [x.testId]));
        check("R21: direct draft flip blocked on start_attempt", await blockedOn(r, B.pid, A.pid));
        await A.c.query("commit");
        const b = await pB;
        check(
          "R21: direct draft flip rejected (G2)",
          !b.ok && /test_already_open_or_unscheduled|test_has_attempts/.test(b.message),
          b
        );
      } finally {
        await close(A, B);
      }
      const st = (await r.query(`select status from public.tests where id = $1`, [x.testId])).rows[0].status;
      check("R21: test stays published", st === "published", st);
      await invariants(r, "R21", [x.testId]);
    });

    // R22 permission errors return without waiting on locks.
    await runCase("R22", async () => {
      const x = await makeDraft(r, y1, 1);
      const A = await open(admin);
      const B = await open(ctx.limited);
      try {
        await A.c.query("begin");
        await A.c.query(`select public.publish_test($1)`, [x.testId]);
        for (const fn of ["publish_test", "return_to_draft_test", "delete_draft_test"]) {
          const p = settle(B.c.query(`select public.${fn}($1)`, [x.testId]));
          check(`R22: ${fn} by edit_questions-only admin does not block`, await settlesWithin(p, 2000));
          const b = await p;
          check(`R22: ${fn} returns permission error`, !b.ok && /permission_denied/.test(b.message), b);
        }
        await A.c.query("commit");
      } finally {
        await close(A, B);
      }
      await invariants(r, "R22", [x.testId]);
    });

    // R23 three sessions: post-lock year re-check (direct and RPC).
    await runCase("R23", async () => {
      for (const path of ["direct", "rpc"]) {
        const x = await makeDraft(r, y1, 1);
        const q = await makeQuestion(r, y1.topic);
        const A = await open(admin);
        const B = await open(admin);
        const C = await open(admin);
        try {
          await A.c.query("begin");
          await A.c.query(`update public.questions set topic_id = $1 where id = $2`, [y2.topic, q]);
          const c = await settle(
            C.c.query(
              `insert into public.test_questions (test_id, question_id, position) values ($1,$2,2)`,
              [x.testId, q]
            )
          );
          check(`R23 ${path}: C attach commits on old year`, c.ok, c);
          let pB;
          if (path === "direct") {
            await C.c.query(
              `update public.test_questions tq set question_version_id = q.current_version_id
               from public.questions q where q.id = tq.question_id and tq.test_id = $1`,
              [x.testId]
            );
            pB = settle(B.c.query(`update public.tests set status = 'published' where id = $1`, [x.testId]));
          } else {
            pB = settle(B.c.query(`select public.publish_test($1)`, [x.testId]));
          }
          check(`R23 ${path}: publication blocked on question row`, await blockedOn(r, B.pid, A.pid));
          await A.c.query("commit");
          const b = await pB;
          check(`R23 ${path}: publication rejected 23514 after re-read`, !b.ok && /test_question_year_mismatch/.test(b.message), b);
        } finally {
          await close(A, B, C);
        }
        const st = (await r.query(`select status from public.tests where id = $1`, [x.testId])).rows[0].status;
        check(`R23 ${path}: test stays draft`, st === "draft", st);
      }
    });

    // R24 link inserted during publish's wait is frozen.
    await runCase("R24", async () => {
      const x = await makeDraft(r, y1, 1);
      const q = await makeQuestion(r, y1.topic);
      const A = await open(admin);
      const B = await open(admin);
      try {
        await A.c.query("begin");
        await A.c.query(
          `insert into public.test_questions (test_id, question_id, position) values ($1,$2,2)`,
          [x.testId, q]
        );
        const pB = settle(B.c.query(`select public.publish_test($1)`, [x.testId]));
        check("R24: publish blocked on inserter's test row", await blockedOn(r, B.pid, A.pid));
        await A.c.query("commit");
        const b = await pB;
        check("R24: publish succeeds", b.ok, b);
      } finally {
        await close(A, B);
      }
      check("R24: both links published", (await linkIds(r, x.testId)).length === 2);
      await invariants(r, "R24", [x.testId]);
    });

    // R25 X3 residual, outcome class over 20 iterations.
    await runCase("R25", async () => {
      const outcomes = {};
      for (let i = 0; i < 20; i++) {
        const x = await makeDraft(r, y1, 1);
        const q = await makeQuestion(r, y1.topic);
        const A = await open(admin);
        const B = await open(admin);
        const C = await open(admin);
        let cls = "unknown";
        try {
          await A.c.query("begin");
          const ins = await A.c.query(
            `insert into public.test_questions (test_id, question_id, position) values ($1,$2,2) returning id`,
            [x.testId, q]
          );
          const newId = ins.rows[0].id;
          const pB = settle(B.c.query(`select public.publish_test($1)`, [x.testId]));
          await blockedOn(r, B.pid, A.pid);
          await A.c.query("commit");
          const c = await settle(C.c.query(`update public.test_questions set marks = 5 where id = $1`, [newId]));
          const b = await pB;
          if (b.ok && !c.ok && /only voiding may change/.test(c.message)) cls = "i:publish-then-reject";
          else if (b.ok && c.code === "40P01") cls = "ii:writer-victim";
          else if (!b.ok && b.code === "40P01" && c.ok) cls = "ii:publish-victim";
          else cls = `unexpected:${b.ok}/${b.code}/${c.ok}/${c.code}/${c.message || ""}`;
        } finally {
          await close(A, B, C);
        }
        outcomes[cls] = (outcomes[cls] || 0) + 1;
        await invariants(r, `R25#${i}`, [x.testId]);
      }
      check(
        "R25: every iteration in the accepted outcome class",
        Object.keys(outcomes).every((k) => !k.startsWith("unexpected") && k !== "unknown"),
        outcomes
      );
      console.log(`# R25 outcomes ${JSON.stringify(outcomes)}`);
    });

    // R26 link inserted during delete_draft_test's wait is deleted too.
    await runCase("R26", async () => {
      const x = await makeDraft(r, y1, 1);
      const q = await makeQuestion(r, y1.topic);
      const A = await open(admin);
      const B = await open(admin);
      try {
        await A.c.query("begin");
        await A.c.query(
          `insert into public.test_questions (test_id, question_id, position) values ($1,$2,2)`,
          [x.testId, q]
        );
        const pB = settle(B.c.query(`select public.delete_draft_test($1)`, [x.testId]));
        check("R26: delete_draft_test blocked on inserter", await blockedOn(r, B.pid, A.pid));
        await A.c.query("commit");
        const b = await pB;
        check("R26: delete_draft_test succeeds, no deadlock", b.ok, b);
      } finally {
        await close(A, B);
      }
      const n = (await r.query(`select count(*)::int n from public.test_questions where test_id = $1`, [x.testId])).rows[0].n;
      const t = (await r.query(`select count(*)::int n from public.tests where id = $1`, [x.testId])).rows[0].n;
      check("R26: test and all links deleted", n === 0 && t === 0, { n, t });
    });

    // R27 committed config change is what publish validates.
    await runCase("R27", async () => {
      const x = await makeDraft(r, y1, 1);
      const A = await open(admin);
      const B = await open(admin);
      try {
        await A.c.query("begin");
        await A.c.query(`update public.tests set min_questions = 5 where id = $1`, [x.testId]);
        const pB = settle(B.c.query(`select public.publish_test($1)`, [x.testId]));
        check("R27: publish blocked on config writer", await blockedOn(r, B.pid, A.pid));
        await A.c.query("commit");
        const b = await pB;
        check("R27: publish validates the committed min_questions", !b.ok && /question count >= 5/.test(b.message), b);
      } finally {
        await close(A, B);
      }
    });

    // ---------------- Sequential guards (reproduce baseline gaps) ----------
    await runCase("S1", async () => {
      const x = await makeDraft(r, y1, 1);
      const B = await open(admin);
      try {
        const b = await settle(B.c.query(`update public.tests set status = 'published' where id = $1`, [x.testId]));
        check("S1: direct publish without freeze rejected", !b.ok && /question versions freeze/.test(b.message), b);
        await B.c.query(
          `update public.test_questions tq set question_version_id = q.current_version_id
           from public.questions q where q.id = tq.question_id and tq.test_id = $1`,
          [x.testId]
        );
        await B.c.query(`delete from public.test_audiences where test_id = $1`, [x.testId]);
        const b2 = await settle(B.c.query(`update public.tests set status = 'published' where id = $1`, [x.testId]));
        check("S1: hand-frozen direct publish still fully validated", !b2.ok && /audience assigned/.test(b2.message), b2);
      } finally {
        await close(B);
      }
    });

    await runCase("S2", async () => {
      const x = await makeDraft(r, y1, 1);
      const B = await open(admin);
      try {
        const b = await settle(
          B.c.query(`update public.tests set status = 'published', min_questions = 1, duration_minutes = 999 where id = $1`, [
            x.testId,
          ])
        );
        check("S2: mixed status + config update rejected", !b.ok && /test_status_change_must_be_isolated/.test(b.message), b);
      } finally {
        await close(B);
      }
    });

    await runCase("S3", async () => {
      const B = await open(admin);
      try {
        for (const st of ["published", "closed"]) {
          const b = await settle(
            B.c.query(
              `insert into public.tests (title, year_id, status, opens_at, closes_at, duration_minutes, negative_mark, min_questions)
               values ($1, $2, $3, now(), now() + interval '1 hour', 30, 0, 1) returning id`,
              [`PGTAP ${TAG} direct`, y1.year, st]
            )
          );
          if (b.ok) created.tests.push(b.rows[0].id);
          check(`S3: direct insert as ${st} rejected`, !b.ok && /tests_must_be_created_as_draft/.test(b.message), b);
        }
      } finally {
        await close(B);
      }
    });

    await runCase("S4", async () => {
      const x = await makeDraft(r, y1, 1);
      const B = await open(admin);
      try {
        const b = await settle(B.c.query(`update public.tests set status = 'closed' where id = $1`, [x.testId]));
        check("S4: direct draft -> closed rejected", !b.ok && /only draft tests can be published/.test(b.message), b);
      } finally {
        await close(B);
      }
    });

    await runCase("S5", async () => {
      const x = await makeDraft(r, y1, 2);
      const y = await makeDraft(r, y1, 1);
      const [l1] = await linkIds(r, x.testId);
      const B = await open(admin);
      try {
        await B.c.query(`update public.test_questions set test_id = $1, position = 9 where id = $2`, [y.testId, l1.id]);
      } finally {
        await close(B);
      }
      await invariants(r, "S5 reparent counts", [x.testId, y.testId]);
    });

    await runCase("S6", async () => {
      const x = await makeDraft(r, y1, 1);
      check("S6: setup publish", (await publishAs(admin, x.testId)).ok);
      const B = await open(admin);
      try {
        const b = await settle(
          B.c.query(`update public.questions set topic_id = $1 where id = $2`, [y2.topic, x.qids[0]])
        );
        check("S6: question move breaking a published link rejected", !b.ok && b.code === "23514", b);
      } finally {
        await close(B);
      }
      await invariants(r, "S6", [x.testId]);
    });
  } finally {
    await cleanup(r).catch((e) => console.log(`# cleanup warning: ${e.message}`));
    await r.end();
  }

  console.log(`\n# summary\n${summary.join("\n")}`);
  console.log(`\n# ${passCount} passed, ${failCount} failed`);
  if (failCount > 0) process.exit(1);
}

/** Best-effort removal of this run's synthetic rows (disposable DB only). */
async function cleanup(r) {
  if (process.env.FROZEN_RACE_KEEP === "1") return;
  await r.query(`reset role`);
  await r.query(`set session_replication_role = replica`);
  const t = created.tests;
  await r.query(
    `delete from public.attempt_answers where attempt_id in (select id from public.test_attempts where test_id = any($1::uuid[]))`,
    [t]
  );
  await r.query(`delete from public.rank_dirty_queue where test_id = any($1::uuid[])`, [t]).catch(() => {});
  await r.query(`delete from public.test_attempts where test_id = any($1::uuid[])`, [t]);
  await r.query(`delete from public.test_questions where test_id = any($1::uuid[])`, [t]);
  await r.query(`delete from public.test_audiences where test_id = any($1::uuid[])`, [t]);
  await r.query(`delete from public.tests where id = any($1::uuid[])`, [t]);
  await r.query(`update public.questions set current_version_id = null where id = any($1::uuid[])`, [created.questions]);
  await r.query(`delete from public.question_versions where question_id = any($1::uuid[])`, [created.questions]);
  await r.query(`delete from public.questions where id = any($1::uuid[])`, [created.questions]);
  await r.query(`set session_replication_role = origin`);
}

const [cmd, arg] = process.argv.slice(2);
if (cmd === "history-create") {
  await historyCreate(arg);
} else if (cmd === "history-hash") {
  await historyHash(arg);
} else {
  await main();
}
