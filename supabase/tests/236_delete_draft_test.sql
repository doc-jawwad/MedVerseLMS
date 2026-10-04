-- delete_draft_test: draft-only hard delete + RLS refuse for non-draft.
-- Transaction-scoped fixtures; rolled back — nothing persists.
begin;
select plan(10);

select test_helpers.as_runner();
select * into temp curriculum from test_helpers.make_curriculum();
select test_helpers.make_admin('Draft Del Admin') as id into temp t_admin;
select test_helpers.make_limited_admin(
  'Draft Del Limited',
  array['edit_questions']
) as id into temp t_limited;
select test_helpers.make_student((select year_id from curriculum), 'Draft Del Stu') as id
  into temp t_student;
select test_helpers.make_question((select topic_id from curriculum), 'A') as id
  into temp t_q;

grant select on curriculum, t_admin, t_limited, t_student, t_q to anon, authenticated;

------------------------------------------------------------------
-- Fixtures: draft with composition, published sibling
------------------------------------------------------------------
select test_helpers.as_runner();
with ins as (
  insert into public.tests (
    title, year_id, status, opens_at, closes_at,
    duration_minutes, marks_per_question, negative_mark, min_questions
  )
  values (
    'PGTAP draft delete',
    (select year_id from curriculum),
    'draft',
    now() - interval '1 minute',
    now() + interval '3 hours',
    60, 1, 0, 1
  )
  returning id
)
select id into temp t_draft from ins;

with ins as (
  insert into public.tests (
    title, year_id, status, opens_at, closes_at,
    duration_minutes, marks_per_question, negative_mark, min_questions
  )
  values (
    'PGTAP published keep',
    (select year_id from curriculum),
    'published',
    now() - interval '1 minute',
    now() + interval '3 hours',
    60, 1, 0, 1
  )
  returning id
)
select id into temp t_published from ins;

insert into public.test_questions (test_id, question_id, position)
values ((select id from t_draft), (select id from t_q), 1);

insert into public.test_audiences (test_id, year_id)
values ((select id from t_draft), (select year_id from curriculum));

grant select on t_draft, t_published to anon, authenticated;

------------------------------------------------------------------
-- Auth gates
------------------------------------------------------------------
-- EXECUTE revoked from anon/public — call fails at privilege check, not RPC body.
select test_helpers.as_anon();
select throws_ok(
  format('select public.delete_draft_test(%L)', (select id from t_draft)),
  '42501',
  'permission denied for function delete_draft_test',
  'anon cannot execute delete_draft_test'
);

select test_helpers.as_user((select id from t_student));
select throws_ok(
  format('select public.delete_draft_test(%L)', (select id from t_draft)),
  'admin only',
  'student cannot delete_draft_test'
);

select test_helpers.as_user((select id from t_limited));
select throws_ok(
  format('select public.delete_draft_test(%L)', (select id from t_draft)),
  'permission_denied',
  'edit_questions-only admin cannot delete_draft_test'
);

------------------------------------------------------------------
-- Refuse non-draft (RPC + RLS table DELETE)
------------------------------------------------------------------
select test_helpers.as_user((select id from t_admin));
select throws_ok(
  format('select public.delete_draft_test(%L)', (select id from t_published)),
  'test_not_draft',
  'delete_draft_test refuses published tests'
);

-- RLS delete policy is draft-only: DELETE matches 0 rows (no exception).
delete from public.tests where id = (select id from t_published);

select is(
  (select count(*)::int from public.tests where id = (select id from t_published)),
  1,
  'RLS + RPC leave published tests untouched'
);

------------------------------------------------------------------
-- Happy path: draft + composition removed; bank question untouched
------------------------------------------------------------------
select lives_ok(
  format('select public.delete_draft_test(%L)', (select id from t_draft)),
  'publish_tests admin can delete a draft'
);

select is(
  (select count(*)::int from public.tests where id = (select id from t_draft)),
  0,
  'draft test row removed'
);

select is(
  (select count(*)::int from public.test_questions where test_id = (select id from t_draft)),
  0,
  'draft test_questions cascaded away'
);

select is(
  (select count(*)::int from public.questions where id = (select id from t_q)),
  1,
  'bank question is not deleted with the draft'
);

select is(
  (select count(*)::int from public.audit_logs
   where action = 'test_draft_deleted'
     and target_id = (select id from t_draft)),
  1,
  'delete_draft_test writes audit log'
);

select * from finish();
rollback;
