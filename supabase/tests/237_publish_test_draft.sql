-- Focused publish_test / validate_test permission + freeze coverage.
-- Complements 070_test_builder.sql and 231_content_bin_test_reference_retention.sql.
-- Transaction-scoped fixtures; rolled back.

begin;
select plan(8);

select test_helpers.as_runner();
select * into temp curriculum from test_helpers.make_curriculum();
select test_helpers.make_admin('Pub Main') as id into temp t_admin;
select test_helpers.make_limited_admin('Pub Zero', '{}') as id into temp t_zero;
select test_helpers.make_limited_admin('Pub Only', array['publish_tests']) as id
  into temp t_publisher;
select test_helpers.make_student((select year_id from curriculum), 'Pub Student') as id
  into temp t_student;

grant select on curriculum, t_admin, t_zero, t_publisher, t_student to authenticated;

------------------------------------------------------------------
-- 1) Limited admin without publish_tests cannot validate or publish.
------------------------------------------------------------------
select test_helpers.as_runner();
with ins as (
  insert into public.tests (
    title, year_id, status, opens_at, closes_at,
    duration_minutes, marks_per_question, negative_mark, min_questions
  )
  values (
    'Pub gate draft',
    (select year_id from curriculum),
    'draft',
    now() - interval '1 minute',
    now() + interval '3 hours',
    60, 1, 0, 1
  )
  returning id
)
select id into temp t_empty from ins;
grant select on t_empty to authenticated;

select test_helpers.as_user((select id from t_zero));
select throws_ok(
  format('select public.validate_test(%L)', (select id from t_empty)),
  'permission_denied',
  'admin without publish_tests cannot validate_test'
);
select throws_ok(
  format('select public.publish_test(%L)', (select id from t_empty)),
  'permission_denied',
  'admin without publish_tests cannot publish_test'
);

------------------------------------------------------------------
-- 2) publish_tests admin: empty draft fails first checklist item;
--    valid draft freezes versions and leaves draft status.
------------------------------------------------------------------
select test_helpers.as_user((select id from t_publisher));
select throws_ok(
  format('select public.publish_test(%L)', (select id from t_empty)),
  'validation failed: question count >= 1',
  'publish_tests admin still gets existing validation failed reason'
);

select test_helpers.as_runner();
select test_helpers.make_question((select topic_id from curriculum), 'A') as id
  into temp t_q;
grant select on t_q to authenticated;

with ins as (
  insert into public.tests (
    title, year_id, status, opens_at, closes_at,
    duration_minutes, marks_per_question, negative_mark, min_questions
  )
  values (
    'Pub valid draft',
    (select year_id from curriculum),
    'draft',
    now() - interval '1 minute',
    now() + interval '3 hours',
    60, 1, 0, 1
  )
  returning id
)
select id into temp t_valid from ins;
grant select on t_valid to authenticated;

insert into public.test_questions (test_id, question_id, position)
values ((select id from t_valid), (select id from t_q), 1);
insert into public.test_audiences (test_id, year_id)
values ((select id from t_valid), (select year_id from curriculum));

-- Capture current_version_id before publish for freeze assertion.
select current_version_id as version_id
into temp t_ver
from public.questions where id = (select id from t_q);
grant select on t_ver to authenticated;

select is(
  (select question_version_id from public.test_questions
   where test_id = (select id from t_valid)),
  null,
  'draft test_questions.question_version_id is unset before publish'
);

select test_helpers.as_user((select id from t_publisher));
select lives_ok(
  format('select public.publish_test(%L)', (select id from t_valid)),
  'publish_tests admin can publish a valid draft'
);

select is(
  (select status from public.tests where id = (select id from t_valid)),
  'published',
  'published test status is published'
);
select is(
  (select question_version_id from public.test_questions
   where test_id = (select id from t_valid)),
  (select version_id from t_ver),
  'publish freezes question_version_id to current_version_id'
);

------------------------------------------------------------------
-- 3) Re-publish refused; no longer treated as draft.
------------------------------------------------------------------
select throws_ok(
  format('select public.publish_test(%L)', (select id from t_valid)),
  'only draft tests can be published',
  'already-published test cannot be published again'
);

select * from finish();
rollback;
