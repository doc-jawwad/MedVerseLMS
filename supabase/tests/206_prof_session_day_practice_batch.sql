-- Prof. Session day practice batch isolation (get_practice_batch scope).
begin;
select plan(8);

select test_helpers.as_runner();
select * into temp curriculum from test_helpers.make_curriculum();
select test_helpers.make_student((select year_id from curriculum), 'PS Day Paid') as id
  into temp t_paid;
select test_helpers.make_admin('PS Day Admin') as id into temp t_admin;
select id into temp t_plan
  from public.subscription_plans
  where is_complimentary = false
  order by sort_order, name
  limit 1;
select id into temp t_block1
  from public.subjects
  where year_id = (select year_id from curriculum) and product_key = 'block-1'
  limit 1;

update public.profiles
set active_session_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa01'
where id = (select id from t_paid);
update public.profiles
set active_session_id = 'cccccccc-cccc-cccc-cccc-cccccccccc01'
where id = (select id from t_admin);

insert into public.subscriptions (
  student_id, plan_id, year_id, status, starts_at, ends_at, grace_days
)
select
  (select id from t_paid),
  (select id from t_plan),
  (select year_id from curriculum),
  'active',
  now() - interval '1 day',
  now() + interval '30 days',
  0;

-- Authoring tree under the product Block so questions.subject_id = block-1
insert into public.books (subject_id, name)
values ((select id from t_block1), 'PS Day Book');
select id into temp t_book
  from public.books
  where subject_id = (select id from t_block1) and name = 'PS Day Book'
  order by created_at desc
  limit 1;

insert into public.chapters (book_id, name)
values ((select id from t_book), 'PS Day Chapter');
select id into temp t_chapter
  from public.chapters
  where book_id = (select id from t_book) and name = 'PS Day Chapter'
  order by created_at desc
  limit 1;

insert into public.topics (chapter_id, name)
values ((select id from t_chapter), 'PS Day Topic');
select id into temp t_topic
  from public.topics
  where chapter_id = (select id from t_chapter) and name = 'PS Day Topic'
  order by created_at desc
  limit 1;

select test_helpers.make_question((select id from t_topic), 'A') as id into temp t_q1;
select test_helpers.make_question((select id from t_topic), 'B') as id into temp t_q2;

grant select on curriculum, t_paid, t_admin, t_plan, t_block1,
  t_book, t_chapter, t_topic, t_q1, t_q2
  to anon, authenticated;

select test_helpers.as_user((select id from t_admin));

select lives_ok(
  $$select public.admin_create_prof_session_day(
    (select id from t_block1), 'Isolation Day 1', 1
  )$$,
  'admin creates day 1'
);
select lives_ok(
  $$select public.admin_create_prof_session_day(
    (select id from t_block1), 'Isolation Day 2', 2
  )$$,
  'admin creates day 2'
);

select id into temp t_day1 from public.prof_session_days
where subject_id = (select id from t_block1) and name = 'Isolation Day 1' and deleted_at is null
limit 1;
select id into temp t_day2 from public.prof_session_days
where subject_id = (select id from t_block1) and name = 'Isolation Day 2' and deleted_at is null
limit 1;
grant select on t_day1, t_day2 to anon, authenticated;

select lives_ok(
  $$select public.admin_set_day_practice_questions(
    (select id from t_day1),
    array[(select id from t_q1)]
  )$$,
  'link q1 to day 1'
);
select lives_ok(
  $$select public.admin_set_day_practice_questions(
    (select id from t_day2),
    array[(select id from t_q2)]
  )$$,
  'link q2 to day 2'
);

select lives_ok(
  $$select public.admin_update_prof_session_day(
    (select id from t_day1), null, null, 'published'
  )$$,
  'publish day 1'
);
select lives_ok(
  $$select public.admin_update_prof_session_day(
    (select id from t_day2), null, null, 'published'
  )$$,
  'publish day 2'
);

select test_helpers.as_user((select id from t_paid));

select is(
  (
    select array_agg(question_id order by question_id)
    from public.get_practice_batch('prof_session_day', (select id from t_day1), 10)
  ),
  array[(select id from t_q1)],
  'day1 batch returns only day1 question'
);

select is(
  (
    select array_agg(question_id order by question_id)
    from public.get_practice_batch('prof_session_day', (select id from t_day2), 10)
  ),
  array[(select id from t_q2)],
  'day2 batch returns only day2 question'
);

select * from finish();
rollback;
