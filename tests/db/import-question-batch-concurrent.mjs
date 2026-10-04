/**
 * True two-session concurrency proof for import_question_batch.
 * Local Postgres only. Creates/commits fixtures, races two admins, cleans up.
 *
 * Usage:
 *   node tests/db/import-question-batch-concurrent.mjs
 * Env: PGTAP_DB_URL or SUPABASE_DB_URL (defaults to local docker).
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
    for (const line of fs.readFileSync(p, "utf8").replace(/^\uFEFF/, "").split(/\r?\n/)) {
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

const TAG = `dbconc-${Date.now().toString(36)}`;
let fail = 0;

function check(name, ok, detail) {
  if (ok) console.log(`ok - ${name}`);
  else {
    fail += 1;
    console.log(`not ok - ${name}`, detail ?? "");
  }
}

async function asUser(client, userId) {
  await client.query(`select set_config('request.jwt.claims', $1, false)`, [
    JSON.stringify({ sub: userId, role: "authenticated" }),
  ]);
  await client.query(`set role authenticated`);
}

async function asRunner(client) {
  await client.query(`reset role`);
  await client.query(`select set_config('request.jwt.claims', '', false)`);
}

async function makeAdmin(client, name) {
  const id = (
    await client.query(`select gen_random_uuid() as id`)
  ).rows[0].id;
  await client.query(
    `insert into auth.users
      (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
       created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
     values
      ($1::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       $2, '', now(), now(), now(), '{}',
       jsonb_build_object('full_name', $3::text))`,
    [id, `${id}@test.invalid`, name]
  );
  await client.query(
    `update public.profiles set role = 'admin', is_main_admin = true where id = $1::uuid`,
    [id]
  );
  return id;
}

function row({ rowNumber, subjectId, book, chapter, topic, stem }) {
  return {
    row_number: rowNumber,
    subject_id: subjectId,
    book,
    chapter,
    topic,
    stem,
    options: [
      { key: "A", text: "Opt A" },
      { key: "B", text: "Opt B" },
      { key: "C", text: "Opt C" },
      { key: "D", text: "Opt D" },
    ],
    correct_key: "A",
    explanation: "because",
    reference: "ref",
    difficulty: "easy",
    tags: ["db-concurrent", TAG],
    status: "approved",
  };
}

async function importAs(userId, batchId, rows, createMissing = true) {
  const c = new pg.Client({ connectionString: DB });
  await c.connect();
  try {
    await asUser(c, userId);
    const t0 = Date.now();
    const r = await c.query(
      `select public.import_question_batch($1::uuid, $2::jsonb, $3::boolean, null) as result`,
      [batchId, JSON.stringify(rows), createMissing]
    );
    return { ok: true, ms: Date.now() - t0, result: r.rows[0].result };
  } catch (e) {
    return {
      ok: false,
      ms: 0,
      error: { code: e.code, message: e.message, detail: e.detail },
    };
  } finally {
    await asRunner(c).catch(() => {});
    await c.end();
  }
}

async function cleanup(setup) {
  const c = new pg.Client({ connectionString: DB });
  await c.connect();
  try {
    await asRunner(c);
    if (setup.questionIds?.length) {
      await c.query(`set session_replication_role = replica`);
      await c.query(
        `update public.questions set current_version_id = null where id = any($1::uuid[])`,
        [setup.questionIds]
      );
      await c.query(
        `delete from public.import_rows where question_id = any($1::uuid[])`,
        [setup.questionIds]
      );
      await c.query(
        `delete from public.question_versions where question_id = any($1::uuid[])`,
        [setup.questionIds]
      );
      await c.query(`delete from public.questions where id = any($1::uuid[])`, [
        setup.questionIds,
      ]);
      await c.query(`set session_replication_role = origin`);
    }
    if (setup.batchIds?.length) {
      await c.query(
        `delete from public.import_rows where batch_id = any($1::uuid[])`,
        [setup.batchIds]
      );
      await c.query(`delete from public.import_batches where id = any($1::uuid[])`, [
        setup.batchIds,
      ]);
    }
    if (setup.bookNames?.length && setup.subjectId) {
      for (const name of setup.bookNames) {
        const books = await c.query(
          `select id from public.books where subject_id = $1::uuid and name = $2`,
          [setup.subjectId, name]
        );
        for (const b of books.rows) {
          const n = await c.query(
            `select count(*)::int as n from public.questions q
             join public.topics t on t.id = q.topic_id
             where t.book_id = $1::uuid`,
            [b.id]
          );
          if (n.rows[0].n === 0) {
            await c.query(`delete from public.topics where book_id = $1::uuid`, [b.id]);
            await c.query(`delete from public.chapters where book_id = $1::uuid`, [
              b.id,
            ]);
            await c.query(`delete from public.books where id = $1::uuid`, [b.id]);
          }
        }
      }
    }
    for (const id of setup.adminIds || []) {
      await c.query(`delete from public.admin_permissions where admin_id = $1::uuid`, [
        id,
      ]);
      await c.query(`delete from public.profiles where id = $1::uuid`, [id]);
      await c.query(`delete from auth.users where id = $1::uuid`, [id]);
    }
  } finally {
    await c.end();
  }
}

async function main() {
  const setup = {
    adminIds: [],
    batchIds: [],
    questionIds: [],
    bookNames: [],
    subjectId: null,
  };
  const c = new pg.Client({ connectionString: DB });
  await c.connect();

  try {
    await asRunner(c);
    const subject = (
      await c.query(
        `select s.id from public.subjects s
         join public.years y on y.id = s.year_id
         order by y.year_number, s.sort_order limit 1`
      )
    ).rows[0];
    if (!subject) throw new Error("no subjects — seed local DB first");
    setup.subjectId = subject.id;

    const adminA = await makeAdmin(c, `DB Conc A ${TAG}`);
    const adminB = await makeAdmin(c, `DB Conc B ${TAG}`);
    setup.adminIds.push(adminA, adminB);

    // ------------------------------------------------------------------
    // Scenario A: distinct taxonomy concurrent — both succeed
    // ------------------------------------------------------------------
    const bookA = `DbConcA-${TAG}`;
    const bookB = `DbConcB-${TAG}`;
    setup.bookNames.push(bookA, bookB);
    const batchDistinctA = (
      await c.query(
        `insert into public.import_batches (filename, total_rows, created_by)
         values ($1, 2, $2::uuid) returning id`,
        [`distinct-a-${TAG}.csv`, adminA]
      )
    ).rows[0].id;
    const batchDistinctB = (
      await c.query(
        `insert into public.import_batches (filename, total_rows, created_by)
         values ($1, 2, $2::uuid) returning id`,
        [`distinct-b-${TAG}.csv`, adminB]
      )
    ).rows[0].id;
    setup.batchIds.push(batchDistinctA, batchDistinctB);

    const rowsDistinctA = [1, 2].map((n) =>
      row({
        rowNumber: n + 1,
        subjectId: subject.id,
        book: bookA,
        chapter: `ChA-${TAG}`,
        topic: `TpA-${TAG}`,
        stem: `Distinct A${n} ${TAG} ${Math.random().toString(36).slice(2)}`,
      })
    );
    const rowsDistinctB = [1, 2].map((n) =>
      row({
        rowNumber: n + 1,
        subjectId: subject.id,
        book: bookB,
        chapter: `ChB-${TAG}`,
        topic: `TpB-${TAG}`,
        stem: `Distinct B${n} ${TAG} ${Math.random().toString(36).slice(2)}`,
      })
    );

    const [da, db] = await Promise.all([
      importAs(adminA, batchDistinctA, rowsDistinctA, true),
      importAs(adminB, batchDistinctB, rowsDistinctB, true),
    ]);
    check("distinct concurrent A ok", da.ok && da.result?.inserted === 2, da);
    check("distinct concurrent B ok", db.ok && db.result?.inserted === 2, db);
    setup.questionIds.push(...(da.result?.question_ids || []), ...(db.result?.question_ids || []));

    // ------------------------------------------------------------------
    // Scenario B: shared missing taxonomy — both succeed, one book row
    // ------------------------------------------------------------------
    let taxReproduced = false;
    for (let attempt = 1; attempt <= 5; attempt++) {
      const sharedBook = `DbShared-${TAG}-t${attempt}`;
      setup.bookNames.push(sharedBook);
      const ba = (
        await c.query(
          `insert into public.import_batches (filename, total_rows, created_by)
           values ($1, 8, $2::uuid) returning id`,
          [`shared-a-${TAG}-${attempt}.csv`, adminA]
        )
      ).rows[0].id;
      const bb = (
        await c.query(
          `insert into public.import_batches (filename, total_rows, created_by)
           values ($1, 8, $2::uuid) returning id`,
          [`shared-b-${TAG}-${attempt}.csv`, adminB]
        )
      ).rows[0].id;
      setup.batchIds.push(ba, bb);

      const aRows = Array.from({ length: 8 }, (_, i) =>
        row({
          rowNumber: i + 2,
          subjectId: subject.id,
          book: sharedBook,
          chapter: `SharedCh-${TAG}`,
          topic: `SharedTp-${TAG}`,
          stem: `SharedTax A${attempt}-${i} ${Math.random().toString(36).slice(2)}`,
        })
      );
      const bRows = Array.from({ length: 8 }, (_, i) =>
        row({
          rowNumber: i + 2,
          subjectId: subject.id,
          book: sharedBook,
          chapter: `SharedCh-${TAG}`,
          topic: `SharedTp-${TAG}`,
          stem: `SharedTax B${attempt}-${i} ${Math.random().toString(36).slice(2)}`,
        })
      );

      const [ra, rb] = await Promise.all([
        importAs(adminA, ba, aRows, true),
        importAs(adminB, bb, bRows, true),
      ]);

      const bookCount = (
        await c.query(
          `select count(*)::int as n from public.books
           where subject_id = $1::uuid and name = $2`,
          [subject.id, sharedBook]
        )
      ).rows[0].n;

      const aQs = ra.result?.question_ids || [];
      const bQs = rb.result?.question_ids || [];
      setup.questionIds.push(...aQs, ...bQs);

      const bothOk = ra.ok && rb.ok && ra.result?.inserted === 8 && rb.result?.inserted === 8;
      const oneBook = bookCount === 1;
      const noLeak = new Set([...aQs, ...bQs]).size === aQs.length + bQs.length;

      check(`shared taxonomy attempt ${attempt} both succeed`, bothOk, { ra, rb });
      check(`shared taxonomy attempt ${attempt} one book row`, oneBook, { bookCount });
      check(`shared taxonomy attempt ${attempt} no cross-batch q leak`, noLeak, {
        aQs,
        bQs,
      });

      if (bothOk && oneBook && noLeak) {
        taxReproduced = true;
        const owners = await c.query(
          `select id, created_by from public.questions where id = any($1::uuid[])`,
          [[...aQs, ...bQs]]
        );
        const aOwned = owners.rows
          .filter((q) => aQs.includes(q.id))
          .every((q) => q.created_by === adminA);
        const bOwned = owners.rows
          .filter((q) => bQs.includes(q.id))
          .every((q) => q.created_by === adminB);
        check("shared taxonomy created_by per importer", aOwned && bOwned, owners.rows);
        break;
      }
    }
    check("shared taxonomy race resolved (at least one attempt)", taxReproduced);

    // ------------------------------------------------------------------
    // Scenario C: identical content_hash concurrent → one insert + one skip
    // ------------------------------------------------------------------
    const hashBook = `DbHashBook-${TAG}`;
    setup.bookNames.push(hashBook);
    // Pre-create taxonomy so only content_hash races.
    const bookId = (
      await c.query(
        `insert into public.books (subject_id, name) values ($1::uuid, $2) returning id`,
        [subject.id, hashBook]
      )
    ).rows[0].id;
    const chapterId = (
      await c.query(
        `insert into public.chapters (book_id, name) values ($1::uuid, $2) returning id`,
        [bookId, `HashCh-${TAG}`]
      )
    ).rows[0].id;
    await c.query(
      `insert into public.topics (chapter_id, name) values ($1::uuid, $2)`,
      [chapterId, `HashTp-${TAG}`]
    );

    let hashOk = false;
    for (let attempt = 1; attempt <= 8; attempt++) {
      const stem = `Identical hash stem ${TAG} attempt-${attempt}`;
      const ba = (
        await c.query(
          `insert into public.import_batches (filename, total_rows, created_by)
           values ($1, 1, $2::uuid) returning id`,
          [`hash-a-${TAG}-${attempt}.csv`, adminA]
        )
      ).rows[0].id;
      const bb = (
        await c.query(
          `insert into public.import_batches (filename, total_rows, created_by)
           values ($1, 1, $2::uuid) returning id`,
          [`hash-b-${TAG}-${attempt}.csv`, adminB]
        )
      ).rows[0].id;
      setup.batchIds.push(ba, bb);

      const payload = [
        row({
          rowNumber: 2,
          subjectId: subject.id,
          book: hashBook,
          chapter: `HashCh-${TAG}`,
          topic: `HashTp-${TAG}`,
          stem,
        }),
      ];

      const [ra, rb] = await Promise.all([
        importAs(adminA, ba, payload, false),
        importAs(adminB, bb, payload, false),
      ]);

      const hardFail =
        (!ra.ok && /content_hash|unique/i.test(ra.error?.message || "")) ||
        (!rb.ok && /content_hash|unique/i.test(rb.error?.message || ""));

      const soft =
        ra.ok &&
        rb.ok &&
        ((ra.result?.inserted === 1 && ra.result?.skipped === 0 && rb.result?.skipped === 1) ||
          (rb.result?.inserted === 1 && rb.result?.skipped === 0 && ra.result?.skipped === 1));

      for (const id of [...(ra.result?.question_ids || []), ...(rb.result?.question_ids || [])]) {
        setup.questionIds.push(id);
      }

      if (hardFail) {
        check(`hash attempt ${attempt} no hard unique fail`, false, { ra, rb });
        break;
      }

      if (soft) {
        hashOk = true;
        const outcomes = await c.query(
          `select batch_id, outcome from public.import_rows
           where batch_id in ($1::uuid, $2::uuid)`,
          [ba, bb]
        );
        const hasInsert = outcomes.rows.some((r) => r.outcome === "inserted");
        const hasSkip = outcomes.rows.some((r) => r.outcome === "skipped_duplicate");
        check(`hash attempt ${attempt} insert+skip outcomes`, hasInsert && hasSkip, outcomes.rows);

        const qCount = (
          await c.query(
            `select count(*)::int as n from public.questions
             where content_hash = public.question_content_hash(
               $1, $2::jsonb, 'A'::char)`,
            [stem, JSON.stringify(payload[0].options)]
          )
        ).rows[0].n;
        check(`hash attempt ${attempt} exactly one question`, qCount === 1, { qCount });
        break;
      }
    }
    check("identical content_hash concurrent resolves to skipped_duplicate", hashOk);
  } finally {
    await c.end();
    try {
      await cleanup(setup);
      console.log("cleanup ok");
    } catch (e) {
      console.error("cleanup error", e.message);
      fail += 1;
    }
  }

  if (fail > 0) {
    console.error(`\nFAILED assertions: ${fail}`);
    process.exit(1);
  }
  console.log("\nAll concurrent import assertions passed.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
