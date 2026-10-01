-- Content Bin ↔ test_questions retention + publish prevention.
-- Covers: unreferenced purge after eligibility; test-referenced retention;
-- soft-deleted questions cannot publish; draft refs stay until admin removes TQ;
-- published/attempt history untouched. Transaction-scoped; rolled back.
begin;
select plan(14);

select test_helpers.as_runner();
select * into temp curriculum from test_helpers.make_curriculum();
select test_helpers.make_admin('Bin TQ Retention Admin') as id into temp t_admin;
select test_helpers.make_student((select year_id from curriculum), 'Bin TQ Retention Student') as id
  into temp t_student;
grant select on curriculum, t_admin, t_student to authenticated, anon;

------------------------------------------------------------------
-- a) Unreferenced soft-deleted question becomes purgeable after eligibility
------------------------------------------------------------------
select test_helpers.make_question((select topic_id from curriculum), 'Unref') as id
  into temp t_unref;
grant select on t_unref to authenticated, anon;

update public.questions
set deleted_at = now() - interval '8 days',
    purge_after = now() - interval '1 day',
    deleted_by = (select id from t_admin)
where id = (select id from t_unref);

select is(
  (select count(*)::int from public.test_questions where question_id = (select id from t_unref)),
  0,
  'a) fixture unreferenced question has no test_questions'
);

select public.purge_expired_bin_items();

select is(
  (select count(*)::int from public.questions where id = (select id from t_unref)),
  0,
  'a) unreferenced overdue question is hard-deleted by purge_expired_bin_items'
);

select ok(
  exists (
    select 1 from public.purge_log
    where deleted_count >= 1
    order by ran_at desc
    limit 1
  ),
  'a) purge_log records a successful delete'
);

------------------------------------------------------------------
-- b) Test-referenced soft-deleted question remains protected
------------------------------------------------------------------
select test_helpers.make_question((select topic_id from curriculum), 'DraftRef') as id
  into temp t_draft_q;
grant select on t_draft_q to authenticated, anon;

with ins as (
  insert into public.tests (
    title, year_id, status, opens_at, closes_at, duration_minutes, min_questions
  ) values (
    'Draft retention test',
    (select year_id from curriculum),
    'draft',
    now() + interval '1 day',
    now() + interval '2 days',
    30,
    1
  )
  returning id
)
select id into temp t_draft_test from ins;
grant select on t_draft_test to authenticated, anon;

insert into public.test_questions (test_id, question_id, position)
values ((select id from t_draft_test), (select id from t_draft_q), 1);

update public.questions
set deleted_at = now() - interval '8 days',
    purge_after = now() - interval '1 day',
    deleted_by = (select id from t_admin)
where id = (select id from t_draft_q);

select public.purge_expired_bin_items();

select ok(
  exists (select 1 from public.questions where id = (select id from t_draft_q)),
  'b) draft-referenced overdue question is still present after purge cron'
);

select ok(
  exists (
    select 1 from public.purge_log
    where retained_count >= 1
      and retained_text like '%question_referenced_by_test%'
      and coalesce(error_text, '') not like '%' || (select id::text from t_draft_q) || '%'
    order by ran_at desc
    limit 1
  ),
  'b) expected reference retention is logged in retained_*, not error_text for that question'
);

------------------------------------------------------------------
-- c) published test cannot be created/published with deleted question
------------------------------------------------------------------
select test_helpers.make_question((select topic_id from curriculum), 'PubBlock') as id
  into temp t_pub_q;
grant select on t_pub_q to authenticated, anon;

with ins as (
  insert into public.tests (
    title, year_id, status, opens_at, closes_at, duration_minutes, min_questions, marks_per_question, negative_mark
  ) values (
    'Publish soft-deleted block',
    (select year_id from curriculum),
    'draft',
    now() + interval '1 hour',
    now() + interval '3 hours',
    60,
    1,
    1,
    0
  )
  returning id
)
select id into temp t_pub_test from ins;
grant select on t_pub_test to authenticated, anon;

insert into public.test_questions (test_id, question_id, position)
values ((select id from t_pub_test), (select id from t_pub_q), 1);
insert into public.test_audiences (test_id, year_id)
values ((select id from t_pub_test), (select year_id from curriculum));

update public.questions
set deleted_at = now(),
    purge_after = now() + interval '7 days',
    deleted_by = (select id from t_admin)
where id = (select id from t_pub_q);

select test_helpers.as_user((select id from t_admin));
select is(
  (
    select (c ->> 'pass')::boolean
    from jsonb_array_elements(public.validate_test((select id from t_pub_test))) c
    where c ->> 'check' = 'no soft-deleted questions'
  ),
  false,
  'c) validate_test fails no soft-deleted questions when a Bin question is attached'
);

select throws_ok(
  format('select public.publish_test(%L)', (select id from t_pub_test)),
  'validation failed: no soft-deleted questions',
  'c) publish_test refuses a draft that includes a soft-deleted question'
);

select is(
  (select status from public.tests where id = (select id from t_pub_test)),
  'draft',
  'c) test remains draft after refused publish'
);

------------------------------------------------------------------
-- d) draft-referenced deleted question remains retained (manual purge)
------------------------------------------------------------------
select test_helpers.as_user((select id from t_admin));
select throws_ok(
  format(
    'select public.purge_content(%L, %L)',
    'question',
    (select id from t_draft_q)
  ),
  'question_referenced_by_test',
  'd) purge_content still raises question_referenced_by_test for draft refs'
);

------------------------------------------------------------------
-- e) removing draft test_questions makes question eligible for normal purge
------------------------------------------------------------------
select test_helpers.as_runner();
delete from public.test_questions
where test_id = (select id from t_draft_test)
  and question_id = (select id from t_draft_q);

select is(
  (select count(*)::int from public.test_questions where question_id = (select id from t_draft_q)),
  0,
  'e) draft test_questions reference removed'
);

-- already overdue from earlier update
select public.purge_expired_bin_items();

select is(
  (select count(*)::int from public.questions where id = (select id from t_draft_q)),
  0,
  'e) after TQ removal, overdue question is purged by normal Content Bin rules'
);

------------------------------------------------------------------
-- f) existing published/attempt history remains untouched
------------------------------------------------------------------
select test_helpers.as_runner();
select test_helpers.make_question((select topic_id from curriculum), 'Hist') as id
  into temp t_hist_q;
grant select on t_hist_q to authenticated, anon;

with ins as (
  insert into public.tests (
    title, year_id, status, opens_at, closes_at, duration_minutes, min_questions, marks_per_question, negative_mark
  ) values (
    'History freeze test',
    (select year_id from curriculum),
    'draft',
    now() - interval '1 hour',
    now() + interval '2 hours',
    60,
    1,
    1,
    0
  )
  returning id
)
select id into temp t_hist_test from ins;
grant select on t_hist_test to authenticated, anon;

insert into public.test_questions (test_id, question_id, position)
select (select id from t_hist_test), (select id from t_hist_q), 1;
insert into public.test_audiences (test_id, year_id)
values ((select id from t_hist_test), (select year_id from curriculum));

select test_helpers.as_user((select id from t_admin));
select public.publish_test((select id from t_hist_test));

select current_version_id as version_id
into temp t_hist_ver
from public.questions where id = (select id from t_hist_q);
grant select on t_hist_ver to authenticated, anon;

select test_helpers.as_runner();
create temp table t_hist_attempt as
with ins as (
  insert into public.test_attempts (
    test_id, student_id, state, started_at, expires_at, submitted_at, submit_source,
    device_id, question_order, score, raw_correct, raw_wrong, raw_blank, percentage
  )
  select
    (select id from t_hist_test),
    (select id from t_student),
    'submitted',
    now() - interval '30 minutes',
    now() + interval '30 minutes',
    now() - interval '5 minutes',
    'student',
    gen_random_uuid(),
    array[(select version_id from t_hist_ver)],
    1, 1, 0, 0, 100
  returning id
)
select id from ins;
grant select on t_hist_attempt to authenticated, anon;

insert into public.attempt_answers (attempt_id, question_version_id, selected_key, save_seq)
values (
  (select id from t_hist_attempt),
  (select version_id from t_hist_ver),
  'A',
  1
);

-- Soft-delete after publish (active-test soft-delete would block via soft_delete_content;
-- set columns directly to simulate post-publish Bin state without rewriting history).
update public.questions
set deleted_at = now() - interval '8 days',
    purge_after = now() - interval '1 day',
    deleted_by = (select id from t_admin)
where id = (select id from t_hist_q);

select public.purge_expired_bin_items();

select ok(
  exists (select 1 from public.questions where id = (select id from t_hist_q) and deleted_at is not null),
  'f) published-referenced soft-deleted question remains after cron'
);

select is(
  (select question_version_id from public.test_questions where test_id = (select id from t_hist_test)),
  (select version_id from t_hist_ver),
  'f) frozen test_questions.question_version_id untouched'
);

select ok(
  exists (
    select 1 from public.attempt_answers
    where attempt_id = (select id from t_hist_attempt)
      and question_version_id = (select version_id from t_hist_ver)
  ),
  'f) attempt_answers / version history untouched'
);

select * from finish();
rollback;
