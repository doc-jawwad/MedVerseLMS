-- Batch B: return_to_draft_test, reuse_test_as_draft, tests.syllabus.
-- Transaction-scoped fixtures; rolled back.
begin;
select plan(33);

select test_helpers.as_runner();
select * into temp curriculum from test_helpers.make_curriculum();
select test_helpers.make_admin('Life Main') as id into temp t_admin;
select test_helpers.make_limited_admin('Life Zero', '{}') as id into temp t_zero;
select test_helpers.make_limited_admin('Life Pub', array['publish_tests']) as id
  into temp t_publisher;
select test_helpers.make_student((select year_id from curriculum), 'Life Stu') as id
  into temp t_student;
select test_helpers.make_question((select topic_id from curriculum), 'A') as id
  into temp t_q;

grant select on curriculum, t_admin, t_zero, t_publisher, t_student, t_q
  to anon, authenticated;

------------------------------------------------------------------
-- Fixtures
------------------------------------------------------------------
select test_helpers.as_runner();

-- Compose as draft, freeze versions, then flip status (protect triggers).
with ins as (
  insert into public.tests (
    title, year_id, status, opens_at, closes_at,
    duration_minutes, marks_per_question, negative_mark, min_questions,
    syllabus, entitlement
  )
  values (
    'B1 future published',
    (select year_id from curriculum),
    'draft',
    now() + interval '2 hours',
    now() + interval '5 hours',
    60, 1, 0, 1,
    'Syllabus alpha',
    'free'
  )
  returning id
)
select id into temp t_future from ins;

insert into public.test_questions (test_id, question_id, question_version_id, position, marks)
select
  (select id from t_future),
  (select id from t_q),
  q.current_version_id,
  1,
  2
from public.questions q
where q.id = (select id from t_q);

insert into public.test_audiences (test_id, year_id)
values ((select id from t_future), (select year_id from curriculum));

insert into public.test_prep_guidelines (test_id, body_text)
values ((select id from t_future), 'Prep for alpha');

update public.tests
set status = 'published'
where id = (select id from t_future);

-- Past-open published (opened).
with ins as (
  insert into public.tests (
    title, year_id, status, opens_at, closes_at,
    duration_minutes, marks_per_question, negative_mark, min_questions
  )
  values (
    'B1 already open',
    (select year_id from curriculum),
    'draft',
    now() - interval '10 minutes',
    now() + interval '3 hours',
    60, 1, 0, 1
  )
  returning id
)
select id into temp t_open from ins;
update public.tests set status = 'published' where id = (select id from t_open);

-- NULL opens_at published.
with ins as (
  insert into public.tests (
    title, year_id, status, opens_at, closes_at,
    duration_minutes, marks_per_question, negative_mark, min_questions
  )
  values (
    'B1 null opens',
    (select year_id from curriculum),
    'draft',
    null,
    now() + interval '3 hours',
    60, 1, 0, 1
  )
  returning id
)
select id into temp t_null_opens from ins;
update public.tests set status = 'published' where id = (select id from t_null_opens);

-- Closed conducted source for reuse.
with ins as (
  insert into public.tests (
    title, year_id, status, opens_at, closes_at,
    duration_minutes, marks_per_question, negative_mark, min_questions,
    shuffle_questions, shuffle_options, show_review, syllabus, entitlement
  )
  values (
    'B2 source closed',
    (select year_id from curriculum),
    'draft',
    now() - interval '2 days',
    now() - interval '1 day',
    45, 1.5, 0.25, 1,
    false, true, 'after_submit',
    'Syllabus reuse me',
    'free'
  )
  returning id
)
select id into temp t_closed from ins;

insert into public.test_questions (test_id, question_id, question_version_id, position, marks)
select
  (select id from t_closed),
  (select id from t_q),
  q.current_version_id,
  3,
  5
from public.questions q
where q.id = (select id from t_q);

insert into public.test_audiences (test_id, year_id)
values ((select id from t_closed), (select year_id from curriculum));

insert into public.test_prep_guidelines (test_id, body_text)
values ((select id from t_closed), 'Prep reuse');

update public.tests set status = 'closed' where id = (select id from t_closed);

-- Invalidated source (ineligible for reuse).
with ins as (
  insert into public.tests (
    title, year_id, status, opens_at, closes_at,
    duration_minutes, marks_per_question, negative_mark, min_questions
  )
  values (
    'B2 invalidated',
    (select year_id from curriculum),
    'draft',
    now() - interval '2 days',
    now() - interval '1 day',
    60, 1, 0, 1
  )
  returning id
)
select id into temp t_invalid from ins;
update public.tests set status = 'invalidated' where id = (select id from t_invalid);

-- Draft for syllabus edit / freeze.
with ins as (
  insert into public.tests (
    title, year_id, status, opens_at, closes_at,
    duration_minutes, marks_per_question, negative_mark, min_questions,
    syllabus
  )
  values (
    'B3 draft syllabus',
    (select year_id from curriculum),
    'draft',
    now() + interval '1 hour',
    now() + interval '4 hours',
    60, 1, 0, 1,
    null
  )
  returning id
)
select id into temp t_draft from ins;

grant select on t_future, t_open, t_null_opens, t_closed, t_invalid, t_draft
  to anon, authenticated;

------------------------------------------------------------------
-- B1 permission + preconditions
------------------------------------------------------------------
select test_helpers.as_user((select id from t_zero));
select throws_ok(
  format('select public.return_to_draft_test(%L)', (select id from t_future)),
  'permission_denied',
  'B1: insufficient permission rejected'
);

select test_helpers.as_user((select id from t_publisher));
select throws_ok(
  format('select public.return_to_draft_test(%L)', (select id from t_open)),
  'test_already_open_or_unscheduled',
  'B1: opening time past rejected'
);

select throws_ok(
  format('select public.return_to_draft_test(%L)', (select id from t_null_opens)),
  'test_already_open_or_unscheduled',
  'B1: NULL opens_at rejected'
);

select throws_ok(
  format('select public.return_to_draft_test(%L)', (select id from t_closed)),
  'test_not_published_unopened',
  'B1: closed status rejected'
);

select throws_ok(
  format('select public.return_to_draft_test(%L)', (select id from t_invalid)),
  'test_not_published_unopened',
  'B1: invalidated status rejected'
);

-- Attempt history blocks return; status/versions unchanged on failure.
select test_helpers.as_runner();
insert into public.test_attempts (
  test_id, student_id, state, started_at, expires_at, device_id, question_order
)
values (
  (select id from t_future),
  (select id from t_student),
  'invalidated',
  now(),
  now() + interval '1 hour',
  gen_random_uuid(),
  array[(select current_version_id from public.questions where id = (select id from t_q))]
);

select test_helpers.as_user((select id from t_publisher));
select throws_ok(
  format('select public.return_to_draft_test(%L)', (select id from t_future)),
  'test_has_attempts',
  'B1: any attempt history rejected'
);

select is(
  (select status from public.tests where id = (select id from t_future)),
  'published',
  'B1: failed return leaves status published'
);

select ok(
  (
    select question_version_id is not null
    from public.test_questions
    where test_id = (select id from t_future)
    limit 1
  ),
  'B1: failed return leaves frozen question_version_id'
);

-- Remove attempt so happy path can proceed.
select test_helpers.as_runner();
delete from public.test_attempts where test_id = (select id from t_future);

-- Concurrent coordination: both RPCs lock tests FOR UPDATE (shared protocol).
select ok(
  position('for update' in lower(pg_get_functiondef('public.return_to_draft_test(uuid)'::regprocedure))) > 0,
  'B1: return_to_draft_test locks tests FOR UPDATE'
);
select ok(
  position('for update' in lower(pg_get_functiondef('public.start_attempt(uuid,uuid,integer)'::regprocedure))) > 0,
  'B1: start_attempt locks tests FOR UPDATE for new starts'
);

------------------------------------------------------------------
-- B1 happy path
------------------------------------------------------------------
select test_helpers.as_user((select id from t_publisher));
select lives_ok(
  format('select public.return_to_draft_test(%L)', (select id from t_future)),
  'B1: future published with zero attempts → draft'
);

select is(
  (select status from public.tests where id = (select id from t_future)),
  'draft',
  'B1: status is draft after return'
);

select is(
  (select syllabus from public.tests where id = (select id from t_future)),
  'Syllabus alpha',
  'B1: syllabus preserved when returned to draft'
);

select ok(
  (
    select question_version_id is null
    from public.test_questions
    where test_id = (select id from t_future)
    limit 1
  ),
  'B1: frozen versions cleared for republish'
);

------------------------------------------------------------------
-- B2 reuse
------------------------------------------------------------------
select test_helpers.as_user((select id from t_zero));
select throws_ok(
  format('select public.reuse_test_as_draft(%L)', (select id from t_closed)),
  'permission_denied',
  'B2: insufficient permission rejected'
);

select test_helpers.as_user((select id from t_publisher));
select throws_ok(
  format('select public.reuse_test_as_draft(%L)', (select id from t_invalid)),
  'test_not_reusable',
  'B2: invalidated source rejected'
);

select throws_ok(
  format('select public.reuse_test_as_draft(%L)', (select id from t_open)),
  'test_window_not_closed',
  'B2: open window rejected'
);

-- Snapshot source before reuse.
select test_helpers.as_runner();
create temp table t_src_snap as
select id, title, status, opens_at, closes_at, syllabus, duration_minutes,
       marks_per_question, negative_mark, shuffle_questions, shuffle_options,
       show_review, entitlement, year_id, subject_id, test_type
from public.tests where id = (select id from t_closed);

select count(*)::int as n into temp t_src_q_count
from public.test_questions where test_id = (select id from t_closed);

grant select on t_src_snap, t_src_q_count to authenticated;

select test_helpers.as_user((select id from t_publisher));
select public.reuse_test_as_draft((select id from t_closed)) as id into temp t_new;
grant select on t_new to authenticated;

select ok(
  (select id from t_new) is distinct from (select id from t_closed),
  'B2: new draft has its own id'
);

select is(
  (select status from public.tests where id = (select id from t_new)),
  'draft',
  'B2: new row is draft'
);

select ok(
  (
    select opens_at is null and closes_at is null
    from public.tests where id = (select id from t_new)
  ),
  'B2: new draft has no schedule'
);

select is(
  (select syllabus from public.tests where id = (select id from t_new)),
  'Syllabus reuse me',
  'B2: syllabus copied'
);

select is(
  (
    select count(*)::int from public.test_questions
    where test_id = (select id from t_new)
  ),
  (select n from t_src_q_count),
  'B2: questions copied'
);

select ok(
  (
    select question_version_id is null and position = 3 and marks = 5
    from public.test_questions
    where test_id = (select id from t_new)
    limit 1
  ),
  'B2: order/marks copied; versions null until publish'
);

select ok(
  exists (
    select 1 from public.test_audiences
    where test_id = (select id from t_new)
      and year_id = (select year_id from curriculum)
  ),
  'B2: audience copied'
);

select is(
  (
    select body_text from public.test_prep_guidelines
    where test_id = (select id from t_new)
  ),
  'Prep reuse',
  'B2: prep guidelines copied'
);

select is(
  (
    select count(*)::int from public.test_attempts
    where test_id = (select id from t_new)
  ),
  0,
  'B2: attempts not copied'
);

-- Source unchanged (logical byte-for-byte on config columns).
select ok(
  (
    select row(s.*) is not distinct from row(
      t.id, t.title, t.status, t.opens_at, t.closes_at, t.syllabus,
      t.duration_minutes, t.marks_per_question, t.negative_mark,
      t.shuffle_questions, t.shuffle_options, t.show_review,
      t.entitlement, t.year_id, t.subject_id, t.test_type
    )
    from t_src_snap s
    join public.tests t on t.id = s.id
  ),
  'B2: source test logically unchanged'
);

------------------------------------------------------------------
-- B3 syllabus draft edit + freeze + student read
------------------------------------------------------------------
select test_helpers.as_user((select id from t_publisher));
update public.tests
set syllabus = 'Draft syllabus body'
where id = (select id from t_draft);

select is(
  (select syllabus from public.tests where id = (select id from t_draft)),
  'Draft syllabus body',
  'B3: syllabus editable while draft'
);

-- Publish then freeze.
select test_helpers.as_runner();
insert into public.test_questions (test_id, question_id, position)
values ((select id from t_draft), (select id from t_q), 1);
insert into public.test_audiences (test_id, year_id)
values ((select id from t_draft), (select year_id from curriculum));

select test_helpers.as_user((select id from t_publisher));
select lives_ok(
  format('select public.publish_test(%L)', (select id from t_draft)),
  'B3: publish with syllabus'
);

select throws_ok(
  format(
    $q$update public.tests set syllabus = 'hacked' where id = %L$q$,
    (select id from t_draft)
  ),
  'published test config is frozen (docs/test-rules.md)',
  'B3: syllabus frozen after publish'
);

-- Student can read syllabus via catalog select; not protected question content.
select test_helpers.as_user((select id from t_student));
select is(
  (
    select syllabus from public.tests where id = (select id from t_draft)
  ),
  'Draft syllabus body',
  'B3: entitled student can read syllabus before start'
);

-- Syllabus column is plain text on tests; correct_key lives on question_versions.
select ok(
  (
    select syllabus = 'Draft syllabus body'
       and syllabus !~* 'correct'
    from public.tests
    where id = (select id from t_draft)
  ),
  'B3: syllabus is plain catalog text (not answer keys)'
);

-- Length check.
select test_helpers.as_runner();
select throws_ok(
  format(
    $q$update public.tests set syllabus = %L where id = %L$q$,
    repeat('x', 8001),
    (select id from t_future)
  ),
  '23514',
  null,
  'B3: syllabus length > 8000 rejected'
);

select * from finish();
rollback;
