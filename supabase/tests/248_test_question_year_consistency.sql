-- Future-test year integrity guards. Run ONLY on disposable PostgreSQL.
-- All synthetic fixtures and temporary trigger toggles roll back.
begin;
select plan(59);

select test_helpers.as_runner();
select * into temp t_year1 from test_helpers.make_curriculum();
select id as year_id into temp t_year2
  from public.years where year_number = 2 limit 1;

with added as (
  insert into public.subjects (year_id, name)
  select year_id, 'PGTAP year guard ' || gen_random_uuid()::text from t_year2
  returning id
) select id as subject_id into temp t_subject2 from added;

with added as (
  insert into public.books (subject_id, name)
  select subject_id, 'PGTAP year guard book' from t_subject2 returning id
) select id as book_id into temp t_book2 from added;

with added as (
  insert into public.chapters (book_id, name)
  select book_id, 'PGTAP year guard chapter' from t_book2 returning id
) select id as chapter_id into temp t_chapter2 from added;

with added as (
  insert into public.topics (chapter_id, name)
  select chapter_id, 'PGTAP year guard topic' from t_chapter2 returning id
) select id as topic_id into temp t_topic2 from added;

select test_helpers.make_question((select topic_id from t_year1))
  as id into temp t_question1;
select test_helpers.make_question((select topic_id from t_topic2))
  as id into temp t_question2;

-- Same year, deliberately DIFFERENT subject: departmental question taxonomy
-- may legitimately differ from the test's product/authoring subject.
with added as (
  insert into public.subjects (year_id, name)
  select year_id, 'PGTAP other subject ' || gen_random_uuid()::text
  from t_year1 returning id
) select id as subject_id into temp t_exam_subject from added;

with added as (
  insert into public.tests (
    title, year_id, subject_id, status, opens_at, closes_at,
    duration_minutes, negative_mark, min_questions
  )
  select
    'PGTAP year integrity', year_id,
    (select subject_id from t_exam_subject), 'draft',
    now() - interval '1 minute', now() + interval '2 hours',
    60, 0, 1
  from t_year1 returning id
) select id into temp t_exam from added;

insert into public.test_audiences (test_id, year_id)
select (select id from t_exam), (select year_id from t_year1);

select lives_ok(
  format('insert into public.test_questions(test_id,question_id,position)
          values (%L,%L,1)',
    (select id from t_exam), (select id from t_question1)),
  'same-year draft question can be assigned'
);

select throws_ok(
  format('insert into public.test_questions(test_id,question_id,position)
          values (%L,%L,2)',
    (select id from t_exam), (select id from t_question2)),
  '23514', 'test_question_year_mismatch',
  'wrong-year question insert is rejected'
);

select throws_ok(
  format('update public.test_questions set question_id=%L
          where test_id=%L and position=1',
    (select id from t_question2), (select id from t_exam)),
  '23514', 'test_question_year_mismatch',
  'wrong-year question reassignment is rejected'
);

-- Simulate a historical wrong-year draft link inserted before the guard.
-- Isolated test database only; DDL and data changes are transaction-scoped.
alter table public.test_questions
  disable trigger test_questions_enforce_year_on_link;
insert into public.test_questions(test_id,question_id,position)
select (select id from t_exam), (select id from t_question2), 2;
alter table public.test_questions
  enable trigger test_questions_enforce_year_on_link;

select test_helpers.make_admin('PGTAP year guard admin')
  as id into temp t_admin;
grant select on t_exam, t_admin to authenticated;
select test_helpers.as_user((select id from t_admin), gen_random_uuid());

select throws_ok(
  format('select public.publish_test(%L)', (select id from t_exam)),
  '23514', 'test_question_year_mismatch',
  'legacy wrong-year draft fails publication without changing history'
);
select test_helpers.as_runner();

select is(
  (select status from public.tests where id = (select id from t_exam)),
  'draft', 'failed publication leaves test in draft'
);
select is(
  (select count(*)::integer from public.test_questions
   where test_id = (select id from t_exam)
     and question_version_id is not null),
  0, 'failed publication rolls back all frozen question snapshots'
);

-- Published links must not be moved between exams, even within the same year.
select test_helpers.make_question((select topic_id from t_year1)) as id into temp t_question3;
create temp table t_move_tests(k text primary key,id uuid not null default gen_random_uuid());
insert into t_move_tests(k) values ('frozen'),('draft_source'),('draft_target');
insert into public.tests(id,title,year_id,subject_id,status,opens_at,closes_at,duration_minutes,negative_mark,min_questions)
select m.id,'PGTAP frozen-link '||m.k,y.year_id,(select subject_id from t_exam_subject),'draft',
  now()-interval '1 minute',now()+interval '2 hours',60,0,1
from t_move_tests m cross join t_year1 y;
insert into public.test_audiences(test_id,year_id)
select id,(select year_id from t_year1) from t_move_tests;
insert into public.test_questions(test_id,question_id,position)
values ((select id from t_move_tests where k='frozen'),(select id from t_question1),1),
       ((select id from t_move_tests where k='draft_source'),(select id from t_question3),1);
grant select on t_move_tests,t_question1,t_question3 to authenticated;
select test_helpers.as_user((select id from t_admin), gen_random_uuid());
select public.publish_test((select id from t_move_tests where k='frozen'));
select throws_ok(format('update public.test_questions set test_id=%L where test_id=%L and question_id=%L',
 (select id from t_move_tests where k='draft_target'),(select id from t_move_tests where k='frozen'),(select id from t_question1)),
 'P0001','questions of a published test are frozen','published question cannot move to a draft');
select throws_ok(format('update public.test_questions set test_id=%L where test_id=%L and question_id=%L',
 (select id from t_move_tests where k='frozen'),(select id from t_move_tests where k='draft_source'),(select id from t_question3)),
 'P0001','questions of a published test are frozen','draft question cannot move into published test');
select test_helpers.as_runner();
select is((select count(*)::int from public.test_questions where test_id=(select id from t_move_tests where k='frozen') and question_id=(select id from t_question1) and question_version_id is not null),1,'frozen original snapshot retained');
select is((select count(*)::int from public.test_questions where test_id=(select id from t_move_tests where k='draft_source') and question_id=(select id from t_question3)),1,'draft source retained');

-- ===========================================================================
-- #38 guards (plan r3). Everything below runs as AUTHENTICATED roles unless a
-- line says "runner setup". No trigger toggles except the one marked
-- historical-fixture setup, which only manufactures pre-guard drift.
-- ===========================================================================
select test_helpers.as_runner();
select test_helpers.make_limited_admin('PGTAP 38 editor', array['edit_questions']) as id into temp t_editor;
select test_helpers.make_student((select year_id from t_year1), 'PGTAP 38 student') as id into temp t_student;
create temp table t38(k text primary key, id uuid not null default gen_random_uuid());
insert into t38(k) values ('d1'),('d2'),('empty'),('pub_future'),('legacy');
insert into public.tests(id,title,year_id,status,opens_at,closes_at,duration_minutes,negative_mark,min_questions)
select t.id,'PGTAP 38 '||t.k,(select year_id from t_year1),'draft',
  case when t.k='pub_future' then now()+interval '1 day' else now()-interval '1 minute' end,
  case when t.k='pub_future' then now()+interval '2 days' else now()+interval '2 hours' end,
  60,0,1
from t38 t;
insert into public.test_audiences(test_id,year_id) select id,(select year_id from t_year1) from t38;
create temp table t38q(k text primary key, id uuid);
insert into t38q values
  ('qa', test_helpers.make_question((select topic_id from t_year1))),
  ('qb', test_helpers.make_question((select topic_id from t_year1))),
  ('qc', test_helpers.make_question((select topic_id from t_year1))),
  ('qh', test_helpers.make_question((select topic_id from t_year1)));
insert into public.test_questions(test_id,question_id,position) values
  ((select id from t38 where k='d1'),(select id from t38q where k='qa'),1),
  ((select id from t38 where k='d1'),(select id from t38q where k='qb'),2),
  ((select id from t38 where k='pub_future'),(select id from t38q where k='qc'),1),
  ((select id from t38 where k='legacy'),(select id from t38q where k='qh'),1);
grant select on t38, t38q, t_editor, t_student, t_topic2, t_year1, t_year2 to authenticated;

select test_helpers.as_user((select id from t_admin), gen_random_uuid());
select public.publish_test((select id from t38 where k='pub_future'));
select public.publish_test((select id from t38 where k='legacy'));

-- Y1: question year change -------------------------------------------------
select throws_ok(
  format('update public.questions set topic_id=%L where id=%L',
    (select topic_id from t_topic2), (select id from t38q where k='qa')),
  '23514', 'test_question_year_mismatch',
  'Y1: moving a question out of the year of its draft test is rejected');
select throws_ok(
  format('update public.questions set topic_id=%L where id=%L',
    (select topic_id from t_topic2), (select id from t_question1)),
  '23514', 'test_question_year_mismatch',
  'Y1: moving a question out of the year of its published test is rejected');
select throws_ok(
  format('update public.questions set year_id=%L where id=%L',
    (select year_id from t_year2), (select id from t38q where k='qa')),
  '23514', 'test_question_year_mismatch',
  'Y1: a direct year_id edit is rejected too');
delete from public.test_questions
where test_id=(select id from t38 where k='d1') and question_id=(select id from t38q where k='qb');
select lives_ok(
  format('update public.questions set topic_id=%L where id=%L',
    (select topic_id from t_topic2), (select id from t38q where k='qb')),
  'Y1: the move is allowed once the question is removed from the draft');
select lives_ok(
  format('update public.questions set difficulty=''hard'' where id=%L', (select id from t_question1)),
  'Y1: non-year edits of a published-test question still work');

-- Y2: draft test year change -----------------------------------------------
select throws_ok(
  format('update public.tests set year_id=%L where id=%L',
    (select year_id from t_year2), (select id from t38 where k='d1')),
  '23514', 'test_question_year_mismatch',
  'Y2: a draft holding current-year questions cannot change year');
select lives_ok(
  format('update public.tests set year_id=%L where id=%L',
    (select year_id from t_year2), (select id from t38 where k='empty')),
  'Y2: an empty draft can change year');
select lives_ok(
  format('update public.tests set year_id=%L where id=%L',
    (select year_id from t_year1), (select id from t38 where k='empty')),
  'Y2: and change back');

-- C1: reparent keeps both counts exact --------------------------------------
select lives_ok(
  format('update public.test_questions set test_id=%L where test_id=%L and question_id=%L',
    (select id from t38 where k='d2'), (select id from t38 where k='d1'), (select id from t38q where k='qa')),
  'C1: draft -> draft reparent allowed');
select ok(
  (select question_count from public.tests where id=(select id from t38 where k='d1')) = 0
  and (select question_count from public.tests where id=(select id from t38 where k='d2')) = 1,
  'C1: source and destination question_count exact after reparent');

-- G1: direct publication ----------------------------------------------------
select throws_ok(
  format('update public.tests set status=''published'' where id=%L', (select id from t38 where k='d2')),
  'P0001', 'validation failed: question versions freeze',
  'G1: direct publish without the freeze is rejected');
select test_helpers.as_runner();
-- runner setup: a newer version becomes current; v1 is now stale.
select current_version_id as v1 into temp t38v1 from public.questions where id=(select id from t38q where k='qa');
with v2 as (
  insert into public.question_versions (question_id, version_no, stem, options, correct_key, explanation, reference)
  select question_id, version_no + 1, stem || ' v2', options, correct_key, explanation, reference
  from public.question_versions where id = (select v1 from t38v1)
  returning id
) update public.questions set current_version_id = (select id from v2)
  where id = (select id from t38q where k='qa');
grant select on t38v1 to authenticated;
select test_helpers.as_user((select id from t_admin), gen_random_uuid());
update public.test_questions set question_version_id=(select v1 from t38v1)
where test_id=(select id from t38 where k='d2');
select throws_ok(
  format('update public.tests set status=''published'' where id=%L', (select id from t38 where k='d2')),
  'P0001', 'validation failed: question versions freeze',
  'G1: hand-freeze to a stale version is rejected');
update public.test_questions tq set question_version_id=q.current_version_id
from public.questions q where q.id=tq.question_id and tq.test_id=(select id from t38 where k='d2');
select test_helpers.as_runner();
update public.questions set status='needs_revision' where id=(select id from t38q where k='qa');
select test_helpers.as_user((select id from t_admin), gen_random_uuid());
select throws_ok(
  format('update public.tests set status=''published'' where id=%L', (select id from t38 where k='d2')),
  'P0001', 'validation failed: all questions approved',
  'G1: a hand-frozen direct publish is still fully validated');
select test_helpers.as_runner();
update public.questions set status='approved' where id=(select id from t38q where k='qa');
select test_helpers.as_user((select id from t_admin), gen_random_uuid());

-- Isolation -----------------------------------------------------------------
select throws_ok(
  format('update public.tests set status=''published'', min_questions=2 where id=%L', (select id from t38 where k='d2')),
  '23514', 'test_status_change_must_be_isolated',
  'isolation: status + min_questions is rejected');
select throws_ok(
  format('update public.tests set status=''published'', duration_minutes=30 where id=%L', (select id from t38 where k='d2')),
  '23514', 'test_status_change_must_be_isolated',
  'isolation: status + duration is rejected');
select throws_ok(
  format('update public.tests set status=''published'', opens_at=now()-interval ''5 minutes'' where id=%L', (select id from t38 where k='d2')),
  '23514', 'test_status_change_must_be_isolated',
  'isolation: status + schedule is rejected');
select ok(
  (select min_questions=1 and duration_minutes=60 and status='draft' from public.tests where id=(select id from t38 where k='d2')),
  'isolation: rejected mixed updates leave the persisted row unchanged');
select lives_ok(
  format('update public.tests set status=''published'' where id=%L', (select id from t38 where k='d2')),
  'G1: an isolated, hand-frozen, fully valid direct publish is accepted (same end state as the RPC)');
select throws_ok(
  format('update public.tests set status=''draft'', closes_at=closes_at+interval ''1 hour'' where id=%L', (select id from t38 where k='pub_future')),
  '23514', 'test_status_change_must_be_isolated',
  'isolation: status -> draft + closes_at is rejected');

-- G2: direct published -> draft --------------------------------------------
select throws_ok(
  format('update public.tests set status=''draft'' where id=%L', (select id from t_move_tests where k='frozen')),
  'P0001', 'test_already_open_or_unscheduled',
  'G2: direct draft flip of an opened published test is rejected');
select test_helpers.as_runner();
-- runner setup: synthetic attempt row on the not-yet-open published test.
insert into public.test_attempts (test_id, student_id, expires_at, device_id, question_order)
values ((select id from t38 where k='pub_future'), (select id from t_student),
        now() + interval '2 days', gen_random_uuid(), array[(select id from t38q where k='qc')]);
select test_helpers.as_user((select id from t_admin), gen_random_uuid());
select throws_ok(
  format('update public.tests set status=''draft'' where id=%L', (select id from t38 where k='pub_future')),
  'P0001', 'test_has_attempts',
  'G2: direct draft flip of a test with attempts is rejected');
select throws_ok(
  format('select public.return_to_draft_test(%L)', (select id from t38 where k='pub_future')),
  'P0001', 'test_has_attempts',
  'RPC: return_to_draft_test contract unchanged (test_has_attempts)');
select test_helpers.as_runner();
delete from public.test_attempts where test_id=(select id from t38 where k='pub_future');
select test_helpers.as_user((select id from t_admin), gen_random_uuid());
select lives_ok(
  format('select public.return_to_draft_test(%L)', (select id from t38 where k='pub_future')),
  'RPC: return_to_draft_test still succeeds on a valid fixture');
select is(
  (select count(*)::int from public.test_questions
   where test_id=(select id from t38 where k='pub_future') and question_version_id is null),
  1, 'RPC: return_to_draft_test still clears frozen versions');

-- G0: initial status --------------------------------------------------------
select throws_ok(
  format('insert into public.tests(title,year_id,status,opens_at,closes_at,duration_minutes,negative_mark,min_questions)
          values (''PGTAP 38 direct'',%L,%L,now(),now()+interval ''1 hour'',30,0,1)', (select year_id from t_year1), s),
  '23514', 'tests_must_be_created_as_draft',
  'G0: direct insert as ' || s || ' is rejected')
from unnest(array['published','closed','archived','invalidated']) s;
select lives_ok(
  format('insert into public.tests(title,year_id,status,opens_at,closes_at,duration_minutes,negative_mark,min_questions)
          values (''PGTAP 38 direct draft'',%L,''draft'',now(),now()+interval ''1 hour'',30,0,1)', (select year_id from t_year1)),
  'G0: direct insert as draft still works');

-- G3: a draft leaves draft only by publication ------------------------------
select throws_ok(
  format('update public.tests set status=%L where id=%L', s, (select id from t38 where k='empty')),
  'P0001', 'only draft tests can be published',
  'G3: direct draft -> ' || s || ' is rejected')
from unnest(array['closed','archived','invalidated']) s;

-- RPC contracts unchanged ---------------------------------------------------
select throws_ok(
  format('select public.publish_test(%L)', gen_random_uuid()),
  'P0001', 'test not found', 'RPC: publish_test unknown id -> test not found');
select throws_ok(
  format('select public.publish_test(%L)', (select id from t_move_tests where k='frozen')),
  'P0001', 'only draft tests can be published', 'RPC: publish_test non-draft contract unchanged');
select lives_ok(
  format('select public.close_test_now(%L)', (select id from t_move_tests where k='frozen')),
  'RPC: close_test_now still closes a published test');
select lives_ok(
  format('select public.reuse_test_as_draft(%L)', (select id from t_move_tests where k='frozen')),
  'RPC: reuse_test_as_draft still copies a closed test as a draft');
select lives_ok(
  format('select public.invalidate_test(%L, %L)', (select id from t_move_tests where k='frozen'), 'PGTAP 38 contract check'),
  'RPC: invalidate_test still works on a closed test');
select throws_ok(
  format('select public.delete_draft_test(%L)', (select id from t38 where k='d2')),
  'P0001', 'test_not_draft', 'RPC: delete_draft_test non-draft contract unchanged');
select lives_ok(
  format('select public.delete_draft_test(%L)', (select id from t38 where k='d1')),
  'RPC: delete_draft_test still deletes a draft');

-- Authorization (no widening) ------------------------------------------------
select test_helpers.as_user((select id from t_editor), gen_random_uuid());
select throws_ok(
  format('insert into public.test_questions(test_id,question_id,position) values (%L,%L,9)',
    (select id from t38 where k='empty'), (select id from t38q where k='qc')),
  '42501', null, 'auth: edit_questions-only admin cannot attach');
select throws_ok(
  format('select public.publish_test(%L)', (select id from t38 where k='empty')),
  'P0001', 'permission_denied', 'auth: edit_questions-only admin cannot publish');
update public.tests set status='published' where id=(select id from t38 where k='empty');
select test_helpers.as_user((select id from t_student), gen_random_uuid());
select throws_ok(
  format('insert into public.test_questions(test_id,question_id,position) values (%L,%L,9)',
    (select id from t38 where k='empty'), (select id from t38q where k='qc')),
  '42501', null, 'auth: student cannot attach');
select test_helpers.as_anon();
select throws_ok(
  'insert into public.test_questions(test_id,question_id,position) values (gen_random_uuid(),gen_random_uuid(),9)',
  '42501', null, 'auth: anon cannot attach');
select test_helpers.as_runner();
select is((select status from public.tests where id=(select id from t38 where k='empty')), 'draft',
  'auth: edit_questions-only direct status update changed nothing');

-- Historical fixture: published wrong-year link stays byte-identical --------
-- historical-fixture setup (runner): manufacture pre-guard drift only, by
-- writing the denormalized year directly with user triggers suspended for
-- this one statement (transaction-local; rolled back with the file).
set local session_replication_role = replica;
update public.questions set year_id=(select year_id from t_year2) where id=(select id from t38q where k='qh');
set local session_replication_role = origin;
create temp view t38hv as
select (select md5(string_agg(to_jsonb(tq)::text, '|' order by tq.id))
        from public.test_questions tq where tq.test_id = (select id from t38 where k='legacy'))
    || (select md5(to_jsonb(t)::text) from public.tests t where t.id = (select id from t38 where k='legacy'))
    as h;
select h into temp t38h from t38hv;
-- runner setup: a year-3 topic, to move the drifted question once more.
with s as (insert into public.subjects (year_id, name)
           select id, 'PGTAP 38 y3 ' || gen_random_uuid()::text from public.years where year_number = 3 returning id),
     b as (insert into public.books (subject_id, name) select id, 'PGTAP 38 y3' from s returning id),
     c as (insert into public.chapters (book_id, name) select id, 'PGTAP 38 y3' from b returning id),
     t as (insert into public.topics (chapter_id, name) select id, 'PGTAP 38 y3' from c returning id)
select id as topic_id into temp t_topic3 from t;
grant select on t38h, t38hv, t_topic3 to authenticated;
select test_helpers.as_user((select id from t_admin), gen_random_uuid());
select throws_ok(
  format('delete from public.test_questions where test_id=%L', (select id from t38 where k='legacy')),
  'P0001', 'questions of a published test are frozen', 'history: legacy wrong-year link cannot be deleted');
select throws_ok(
  format('update public.test_questions set marks=2 where test_id=%L', (select id from t38 where k='legacy')),
  'P0001', 'only voiding may change on a published test', 'history: legacy wrong-year link cannot be edited');
select lives_ok(
  format('update public.questions set difficulty=''easy'' where id=%L', (select id from t38q where k='qh')),
  'history: the drifted question stays editable for non-year fields');
select lives_ok(
  format('update public.questions set topic_id=%L where id=%L',
    (select topic_id from t_topic3), (select id from t38q where k='qh')),
  'history: Y1 does not block a year move when the only link is already mismatched');
select test_helpers.as_runner();
select is(
  (select h from t38hv),
  (select h from t38h),
  'history: legacy published test and its wrong-year link are byte-identical');
select * from finish();
rollback;
