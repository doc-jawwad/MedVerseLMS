-- Question Bank foundation: regression coverage for create_question,
-- create_question_version (versioning + immutability + current_version_id
-- update), the new DB-level status-transition guard
-- (20260913000005_question_status_transition_guard.sql), duplicate
-- detection via content_hash, admin-only authorization, and the absence of
-- correct_key/explanation from any path a student can reach. None of this
-- was previously covered by pgTAP (create_question/create_question_version/
-- status transitions had zero prior test coverage). Transaction-scoped
-- fixtures, rolled back — nothing here persists.

begin;
select plan(19);

select test_helpers.as_runner();
select * into temp curriculum from test_helpers.make_curriculum();
select test_helpers.make_admin('QB Admin') as id into temp t_admin;
select test_helpers.make_student((select year_id from curriculum), 'QB Student') as id
  into temp t_student;

grant select on curriculum, t_admin, t_student to anon, authenticated;

------------------------------------------------------------------
-- 1) create_question: admin-only, creates identity row + version 1,
--    sets current_version_id, computes tenant_id/content_hash/stem_normalized.
------------------------------------------------------------------
select test_helpers.as_anon();
select throws_ok(
  format('select public.create_question(%L, ''Stem A'', ''[{"key":"A","text":"x"},{"key":"B","text":"y"},{"key":"C","text":"z"},{"key":"D","text":"w"}]''::jsonb, ''A'')',
    (select topic_id from curriculum)),
  'permission denied for function create_question',
  'anon is blocked at the grant level from create_question'
);

select test_helpers.as_user((select id from t_student));
select throws_ok(
  format('select public.create_question(%L, ''Stem A'', ''[{"key":"A","text":"x"},{"key":"B","text":"y"},{"key":"C","text":"z"},{"key":"D","text":"w"}]''::jsonb, ''A'')',
    (select topic_id from curriculum)),
  'admin only',
  'a signed-in non-admin student cannot create a question'
);

select test_helpers.as_user((select id from t_admin));
select public.create_question(
  (select topic_id from curriculum), 'What is the powerhouse of the cell?',
  '[{"key":"A","text":"Mitochondria"},{"key":"B","text":"Nucleus"},{"key":"C","text":"Ribosome"},{"key":"D","text":"Golgi"}]'::jsonb,
  'A', 'Mitochondria produces ATP.', 'Cell biology 101', 'medium', array['cell_biology'], 'draft'
) as id into temp t_q;
grant select on t_q to authenticated;

select test_helpers.as_runner();
select is(
  (select status from public.questions where id = (select id from t_q)),
  'draft',
  'create_question creates the identity row in the requested (allowed) status'
);
select is(
  (select tenant_id from public.questions where id = (select id from t_q)),
  '00000000-0000-0000-0000-000000000001'::uuid,
  'create_question sets tenant_id to the single-tenant default'
);
select is(
  (select version_no from public.question_versions where id =
    (select current_version_id from public.questions where id = (select id from t_q))),
  1,
  'create_question inserts version 1 and points current_version_id at it'
);
select is(
  (select content_hash from public.questions where id = (select id from t_q)) is not null,
  true,
  'content_hash is computed on create'
);

------------------------------------------------------------------
-- 2) Duplicate detection: an identical question (same stem/options/
--    correct_key) collides on the content_hash unique index.
------------------------------------------------------------------
select test_helpers.as_user((select id from t_admin));
select throws_ok(
  format('select public.create_question(%L, ''What is the powerhouse of the cell?'', ''[{"key":"A","text":"Mitochondria"},{"key":"B","text":"Nucleus"},{"key":"C","text":"Ribosome"},{"key":"D","text":"Golgi"}]''::jsonb, ''A'')',
    (select topic_id from curriculum)),
  'duplicate key value violates unique constraint "questions_content_hash_unique"',
  'an exact duplicate (same stem+options+correct_key) is rejected by the content_hash unique index'
);

------------------------------------------------------------------
-- 3) create_question_version: appends version 2, repoints
--    current_version_id, and the OLD version row stays byte-for-byte
--    immutable (never updated in place).
------------------------------------------------------------------
select test_helpers.as_user((select id from t_admin));
select public.create_question_version(
  (select id from t_q), 'What organelle is the powerhouse of the cell?',
  '[{"key":"A","text":"Mitochondria"},{"key":"B","text":"Nucleus"},{"key":"C","text":"Ribosome"},{"key":"D","text":"Golgi"}]'::jsonb,
  'A', 'Revised explanation.', 'Cell biology 101'
);

select test_helpers.as_runner();
select is(
  (select count(*)::int from public.question_versions where question_id = (select id from t_q)),
  2,
  'create_question_version appends a new version rather than mutating the existing one'
);
select is(
  (select version_no from public.question_versions v
   join public.questions q on q.current_version_id = v.id where q.id = (select id from t_q)),
  2,
  'current_version_id now points at the newly-created version 2'
);
select is(
  (select stem from public.question_versions where question_id = (select id from t_q) and version_no = 1),
  'What is the powerhouse of the cell?',
  'the original version 1 row is untouched — its stem never changed'
);
select throws_ok(
  format('update public.question_versions set stem = ''tampered'' where question_id = %L and version_no = 1',
    (select id from t_q)),
  'question_versions are immutable (append-only)',
  'version 1 cannot be mutated in place even after a newer version exists'
);

------------------------------------------------------------------
-- 4) Status transition guard (20260913000005): valid transitions
--    succeed, invalid transitions are rejected even via a DIRECT table
--    UPDATE (not just through the setQuestionStatus Server Action) —
--    this is the actual DB-level enforcement the app-level check alone
--    could not guarantee.
------------------------------------------------------------------
select test_helpers.as_user((select id from t_admin));
update public.questions set status = 'review' where id = (select id from t_q);
select is(
  (select status from public.questions where id = (select id from t_q)),
  'review',
  'a valid transition (draft -> review) succeeds via direct table update'
);

update public.questions set status = 'needs_revision' where id = (select id from t_q);
select is(
  (select status from public.questions where id = (select id from t_q)),
  'needs_revision',
  'a valid transition (review -> needs_revision) succeeds'
);

update public.questions set status = 'approved' where id = (select id from t_q);
select is(
  (select status from public.questions where id = (select id from t_q)),
  'approved',
  'a valid transition (needs_revision -> approved) succeeds'
);

select throws_ok(
  format('update public.questions set status = ''draft'' where id = %L', (select id from t_q)),
  'invalid question status transition: approved -> draft',
  'an invalid transition (approved -> draft is not in the allowed graph) is rejected at the DB level, even via a direct table UPDATE bypassing the Server Action entirely'
);
select is(
  (select status from public.questions where id = (select id from t_q)),
  'approved',
  'the rejected transition left status unchanged'
);

------------------------------------------------------------------
-- 5) Student access restrictions: RLS (not a table-level grant — the
--    standard Supabase pattern, confirmed via information_schema that
--    `authenticated` does hold table-level SELECT here) filters both
--    tables to zero rows for a non-admin, since `questions_admin_all` /
--    `question_versions_admin_select` are the only policies and both are
--    is_admin()-gated. Correct_key/explanation are therefore never
--    reachable via a direct SELECT for a student, only via the exam/
--    practice RPCs (which themselves omit them until answered).
------------------------------------------------------------------
select test_helpers.as_user((select id from t_student));
select is(
  (select count(*)::int from public.questions),
  0,
  'a student sees zero rows from questions via direct SELECT (RLS-filtered, is_admin()-only policy) — the question bank is RPC-mediated for students'
);
select is(
  (select count(*)::int from public.question_versions),
  0,
  'a student sees zero rows from question_versions via direct SELECT — correct_key/explanation are never directly reachable'
);
select throws_ok(
  format('insert into public.questions (topic_id, status, difficulty, content_hash, stem_normalized) values (%L, ''draft'', ''medium'', ''x'', ''x'')',
    (select topic_id from curriculum)),
  'new row violates row-level security policy for table "questions"',
  'a student cannot directly INSERT into questions (RLS with-check, is_admin()-only)'
);

select * from finish();
rollback;
