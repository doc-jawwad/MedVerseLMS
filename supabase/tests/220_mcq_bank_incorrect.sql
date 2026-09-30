-- MCQ Bank Incorrect: wrong→set, correct→clear, wrong again→keep; isolation; empty; Done/Favorites independence.
begin;
select plan(22);

select test_helpers.as_runner();
select * into temp curriculum from test_helpers.make_curriculum();
select test_helpers.make_student((select year_id from curriculum), 'Inc Fold Paid') as id
  into temp t_paid;
select test_helpers.make_student((select year_id from curriculum), 'Inc Fold Other') as id
  into temp t_other;
select test_helpers.make_student((select year_id from curriculum), 'Inc Fold Locked') as id
  into temp t_locked;
select test_helpers.make_admin('Inc Fold Admin') as id into temp t_admin;

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
set active_session_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa42'
where id = (select id from t_paid);
update public.profiles
set active_session_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb42'
where id = (select id from t_other);
update public.profiles
set active_session_id = 'dddddddd-dddd-dddd-dddd-dddddddddd42'
where id = (select id from t_locked);
update public.profiles
set active_session_id = 'cccccccc-cccc-cccc-cccc-cccccccccc42'
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

insert into public.subscriptions (
  student_id, plan_id, year_id, status, starts_at, ends_at, grace_days
)
select
  (select id from t_other),
  (select id from t_plan),
  (select year_id from curriculum),
  'active',
  now() - interval '1 day',
  now() + interval '30 days',
  0;

grant select on curriculum, t_paid, t_other, t_locked, t_admin, t_plan, t_block1
  to authenticated;

select test_helpers.as_user((select id from t_admin));
select public.set_resource_entitlement(
  'practice_subject', (select id from t_block1), 'any_subscription'
);

select test_helpers.as_runner();
insert into public.subjects (year_id, name, sort_order)
values ((select year_id from curriculum), 'Inc Fold Anatomy', 98);
select id into temp t_anatomy
  from public.subjects
  where year_id = (select year_id from curriculum) and name = 'Inc Fold Anatomy'
  order by created_at desc limit 1;
grant select on t_anatomy to authenticated;
select test_helpers.as_user((select id from t_admin));
select public.set_resource_entitlement(
  'practice_subject', (select id from t_anatomy), 'free'
);

select test_helpers.as_runner();
insert into public.books (subject_id, name)
values ((select id from t_anatomy), 'Inc Fold Book');
select id into temp t_book from public.books
  where subject_id = (select id from t_anatomy) order by created_at desc limit 1;
insert into public.chapters (book_id, name)
values ((select id from t_book), 'Inc Fold Ch');
select id into temp t_chapter from public.chapters
  where book_id = (select id from t_book) order by created_at desc limit 1;
insert into public.topics (chapter_id, name)
values ((select id from t_chapter), 'Inc Fold Topic');
select id into temp t_topic from public.topics
  where chapter_id = (select id from t_chapter) order by created_at desc limit 1;

grant select on t_book, t_chapter, t_topic to authenticated;

select test_helpers.make_question((select id from t_topic), 'A') as id into temp t_q_a;
update public.questions set status = 'approved' where id = (select id from t_q_a);
select test_helpers.make_question((select id from t_topic), 'A') as id into temp t_q_b;
update public.questions set status = 'approved' where id = (select id from t_q_b);
select test_helpers.make_question((select id from t_topic), 'A') as id into temp t_q_c;
update public.questions set status = 'approved' where id = (select id from t_q_c);

grant select on t_q_a, t_q_b, t_q_c to authenticated;

create temporary table t_q_a_ver (id uuid);
create temporary table t_q_b_ver (id uuid);
create temporary table t_q_c_ver (id uuid);
grant select, insert on t_q_a_ver, t_q_b_ver, t_q_c_ver to authenticated;
insert into t_q_a_ver (id)
select current_version_id from public.questions where id = (select id from t_q_a);
insert into t_q_b_ver (id)
select current_version_id from public.questions where id = (select id from t_q_b);
insert into t_q_c_ver (id)
select current_version_id from public.questions where id = (select id from t_q_c);

select test_helpers.as_user((select id from t_admin));
create temporary table t_folder_a (id uuid);
create temporary table t_folder_b (id uuid);
grant select, insert on t_folder_a, t_folder_b to authenticated;
insert into t_folder_a (id)
select public.admin_create_mcq_bank_folder((select id from t_block1), 'Inc Folder A');
insert into t_folder_b (id)
select public.admin_create_mcq_bank_folder((select id from t_block1), 'Inc Folder B');

select public.admin_assign_unassigned_question_to_folder(
  (select id from t_q_a), (select id from t_folder_a)
);
select public.admin_assign_unassigned_question_to_folder(
  (select id from t_q_b), (select id from t_folder_a)
);
select public.admin_assign_unassigned_question_to_folder(
  (select id from t_q_c), (select id from t_folder_b)
);

grant select on t_folder_a, t_folder_b to authenticated;

-- 1–2) Empty Incorrect practice
select test_helpers.as_user((select id from t_paid));
select is(
  (select count(*)::int from public.get_practice_batch(
    'mcq_bank_folder_incorrect', (select id from t_folder_a), 50
  )),
  0,
  '1 empty Incorrect → empty batch'
);

select is(
  (public.get_mcq_bank_folder_practice_progress((select id from t_folder_a))->>'incorrect')::int,
  0,
  '2 progress incorrect count is 0'
);

-- 3–5) Wrong answer creates Incorrect
select lives_ok(
  format(
    'select public.submit_practice_answer(%L::uuid, ''B'')',
    (select id from t_q_a_ver)
  ),
  '3 wrong answer on A'
);

select ok(
  (
    select incorrect
    from public.practice_progress
    where student_id = (select id from t_paid)
      and item_kind = 'question'
      and item_id = (select id from t_q_a)
  ),
  '4 incorrect=true after wrong answer'
);

select is(
  (select count(*)::int from public.get_practice_batch(
    'mcq_bank_folder_incorrect', (select id from t_folder_a), 50
  )),
  1,
  '5 Incorrect batch size 1 after wrong'
);

select is(
  (
    select question_id
    from public.get_practice_batch(
      'mcq_bank_folder_incorrect', (select id from t_folder_a), 50
    )
    limit 1
  ),
  (select id from t_q_a),
  '6 Incorrect batch contains A'
);

select is(
  (public.get_mcq_bank_folder_practice_progress((select id from t_folder_a))->>'incorrect')::int,
  1,
  '7 progress incorrect count is 1'
);

-- 8–9) Correct later removes Incorrect
select lives_ok(
  format(
    'select public.submit_practice_answer(%L::uuid, ''A'')',
    (select id from t_q_a_ver)
  ),
  '8 correct answer on A'
);

select ok(
  not (
    select incorrect
    from public.practice_progress
    where student_id = (select id from t_paid)
      and item_id = (select id from t_q_a)
  ),
  '9 incorrect=false after correct'
);

select is(
  (select count(*)::int from public.get_practice_batch(
    'mcq_bank_folder_incorrect', (select id from t_folder_a), 50
  )),
  0,
  '10 Incorrect batch empty after correct'
);

-- 11–12) Wrong again retains Incorrect
select public.submit_practice_answer((select id from t_q_a_ver), 'B');
select ok(
  (
    select incorrect
    from public.practice_progress
    where student_id = (select id from t_paid) and item_id = (select id from t_q_a)
  ),
  '11 incorrect=true after wrong again'
);
select ok(
  exists (
    select 1 from public.get_practice_batch(
      'mcq_bank_folder_incorrect', (select id from t_folder_a), 50
    ) where question_id = (select id from t_q_a)
  ),
  '12 Incorrect practice returns A after wrong again'
);

-- 13–14) Incorrect independent of Done / Favorites
select public.set_practice_item_state('question', (select id from t_q_a), 'done');
select public.set_practice_item_marked('question', (select id from t_q_a), true);
select ok(
  (
    select incorrect and marked and state = 'done'
    from public.practice_progress
    where student_id = (select id from t_paid) and item_id = (select id from t_q_a)
  ),
  '13 Done + Favorites preserve Incorrect'
);
select public.set_practice_item_marked('question', (select id from t_q_a), false);
select ok(
  (
    select incorrect and not marked and state = 'done'
    from public.practice_progress
    where student_id = (select id from t_paid) and item_id = (select id from t_q_a)
  ),
  '14 unfavorite preserves Incorrect + Done'
);

-- 15) Answer history still appended
select ok(
  (
    select count(*)::int >= 3 from public.practice_answers
    where student_id = (select id from t_paid)
      and question_version_id = (select id from t_q_a_ver)
  ),
  '15 practice_answers history retained'
);

-- 16–17) Folder isolation
select public.submit_practice_answer((select id from t_q_b_ver), 'B');
select public.submit_practice_answer((select id from t_q_c_ver), 'B');

select is(
  (select count(*)::int from public.get_practice_batch(
    'mcq_bank_folder_incorrect', (select id from t_folder_a), 50
  )),
  2,
  '16 folder A Incorrect has A+B (not C)'
);
select ok(
  exists (
    select 1 from public.get_practice_batch(
      'mcq_bank_folder_incorrect', (select id from t_folder_b), 50
    ) where question_id = (select id from t_q_c)
  )
  and not exists (
    select 1 from public.get_practice_batch(
      'mcq_bank_folder_incorrect', (select id from t_folder_b), 50
    ) where question_id = (select id from t_q_a)
  ),
  '17 folder B Incorrect returns C only'
);

-- 18–19) Student isolation
select test_helpers.as_user((select id from t_other));
select is(
  (select count(*)::int from public.get_practice_batch(
    'mcq_bank_folder_incorrect', (select id from t_folder_a), 50
  )),
  0,
  '18 other student Incorrect batch omits peer incorrect'
);
select is(
  (
    select count(*)::int
    from public.practice_progress
    where student_id = (select id from t_paid)
  ),
  0,
  '19 other student cannot SELECT peer practice_progress'
);

-- 20) Unauthenticated cannot answer
select test_helpers.as_runner();
select throws_ok(
  format(
    'select public.submit_practice_answer(%L::uuid, ''B'')',
    (select id from t_q_a_ver)
  ),
  'P0001',
  'not_authenticated',
  '20 unauthenticated cannot submit practice answer'
);

-- 21–22) Unpaid denied on Incorrect batch
select test_helpers.as_user((select id from t_locked));
select throws_ok(
  format(
    'select * from public.get_practice_batch(''mcq_bank_folder_incorrect'', %L::uuid, 5)',
    (select id from t_folder_a)
  ),
  'P0001',
  'practice_access_denied',
  '21 unpaid denied on Incorrect batch'
);
select throws_ok(
  format(
    'select public.get_mcq_bank_folder_practice_progress(%L::uuid)',
    (select id from t_folder_a)
  ),
  'P0001',
  'practice_access_denied',
  '22 unpaid denied on folder progress (incorrect count gated)'
);

select * from finish();
rollback;
