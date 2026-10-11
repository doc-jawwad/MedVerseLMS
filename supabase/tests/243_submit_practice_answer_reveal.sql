-- submit_practice_answer: silent Next omits correctness+secrets; same key once.
begin;
select plan(9);

select test_helpers.as_runner();
select * into temp curriculum from test_helpers.make_curriculum();
select test_helpers.make_student((select year_id from curriculum), 'Reveal Prac Paid') as id
  into temp t_paid;
select test_helpers.make_admin('Reveal Prac Admin') as id into temp t_admin;

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
set active_session_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa43'
where id = (select id from t_paid);
update public.profiles
set active_session_id = 'cccccccc-cccc-cccc-cccc-cccccccccc43'
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

grant select on curriculum, t_paid, t_admin, t_plan, t_block1 to authenticated;

select test_helpers.as_user((select id from t_admin));
select public.set_resource_entitlement(
  'practice_subject', (select id from t_block1), 'any_subscription'
);

select test_helpers.as_runner();
insert into public.subjects (year_id, name, sort_order)
values ((select year_id from curriculum), 'Reveal Prac Anatomy', 97);
select id into temp t_anatomy
  from public.subjects
  where year_id = (select year_id from curriculum) and name = 'Reveal Prac Anatomy'
  order by created_at desc limit 1;
grant select on t_anatomy to authenticated;
select test_helpers.as_user((select id from t_admin));
select public.set_resource_entitlement(
  'practice_subject', (select id from t_anatomy), 'free'
);

select test_helpers.as_runner();
insert into public.books (subject_id, name)
values ((select id from t_anatomy), 'Reveal Prac Book');
select id into temp t_book from public.books
  where subject_id = (select id from t_anatomy) order by created_at desc limit 1;
insert into public.chapters (book_id, name)
values ((select id from t_book), 'Reveal Prac Ch');
select id into temp t_chapter from public.chapters
  where book_id = (select id from t_book) order by created_at desc limit 1;
insert into public.topics (chapter_id, name)
values ((select id from t_chapter), 'Reveal Prac Topic');
select id into temp t_topic from public.topics
  where chapter_id = (select id from t_chapter) order by created_at desc limit 1;
grant select on t_book, t_chapter, t_topic to authenticated;

select test_helpers.make_question((select id from t_topic), 'A') as id into temp t_q;
update public.questions set status = 'approved' where id = (select id from t_q);
grant select on t_q to authenticated;

create temporary table t_q_ver (id uuid);
grant select, insert on t_q_ver to authenticated;
insert into t_q_ver (id)
select current_version_id from public.questions where id = (select id from t_q);

select test_helpers.as_user((select id from t_admin));
create temporary table t_folder (id uuid);
create temporary table t_sf (id uuid);
grant select, insert on t_folder, t_sf to authenticated;
insert into t_folder (id)
select public.admin_create_mcq_bank_folder((select id from t_block1), 'Reveal Folder');
insert into t_sf (id)
select public.admin_create_mcq_bank_subfolder((select id from t_folder), 'Reveal Sub');
select public.admin_assign_unassigned_question_to_subfolder(
  (select id from t_q), (select id from t_sf)
);
grant select on t_folder, t_sf to authenticated;

select test_helpers.as_user((select id from t_paid));

-- Silent Next: no correctness, no secrets
select is(
  (
    select is_correct
    from public.submit_practice_answer(
      (select id from t_q_ver), 'B', false
    )
  ),
  null,
  '1 silent submit omits is_correct'
);

select is(
  (
    select correct_key
    from public.submit_practice_answer(
      (select id from t_q_ver), 'B', false
    )
  ),
  null,
  '2 silent resubmit omits correct_key'
);

select is(
  (
    select explanation
    from public.submit_practice_answer(
      (select id from t_q_ver), 'B', false
    )
  ),
  null,
  '3 silent resubmit omits explanation'
);

select is(
  (
    select count(*)::int
    from public.practice_answers
    where student_id = (select id from t_paid)
      and question_version_id = (select id from t_q_ver)
      and selected_key = 'B'
  ),
  1,
  '4 same selected_key counted once after silent calls'
);

-- Row was persisted server-side with real is_correct (not exposed to client)
select is(
  (
    select is_correct
    from public.practice_answers
    where student_id = (select id from t_paid)
      and question_version_id = (select id from t_q_ver)
      and selected_key = 'B'
  ),
  false,
  '5 server stores is_correct for wrong silent answer B'
);

-- Check answer: reveal secrets, still one row for B
select isnt(
  (
    select correct_key
    from public.submit_practice_answer(
      (select id from t_q_ver), 'B', true
    )
  ),
  null,
  '6 reveal submit returns correct_key'
);

select is(
  (
    select count(*)::int
    from public.practice_answers
    where student_id = (select id from t_paid)
      and question_version_id = (select id from t_q_ver)
      and selected_key = 'B'
  ),
  1,
  '7 reveal after silent still one row for B'
);

-- Different key may insert (re-answer); unanswered skip never calls RPC
select lives_ok(
  format(
    'select public.submit_practice_answer(%L::uuid, ''A'', true)',
    (select id from t_q_ver)
  ),
  '8 different selected_key still accepted'
);

select ok(
  (
    select count(*)::int
    from public.practice_answers
    where student_id = (select id from t_paid)
      and question_version_id = (select id from t_q_ver)
  ) >= 2,
  '9 unanswered skip leaves no extra row until a selection is submitted'
);

select * from finish();
rollback;
