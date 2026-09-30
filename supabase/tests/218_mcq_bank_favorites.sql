-- MCQ Bank Favorites: marked reuse, isolation, folder favorites batch, independence from Done.
begin;
select plan(21);

select test_helpers.as_runner();
select * into temp curriculum from test_helpers.make_curriculum();
select test_helpers.make_student((select year_id from curriculum), 'Fav Fold Paid') as id
  into temp t_paid;
select test_helpers.make_student((select year_id from curriculum), 'Fav Fold Other') as id
  into temp t_other;
select test_helpers.make_student((select year_id from curriculum), 'Fav Fold Locked') as id
  into temp t_locked;
select test_helpers.make_admin('Fav Fold Admin') as id into temp t_admin;

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
set active_session_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa32'
where id = (select id from t_paid);
update public.profiles
set active_session_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb32'
where id = (select id from t_other);
update public.profiles
set active_session_id = 'dddddddd-dddd-dddd-dddd-dddddddddd32'
where id = (select id from t_locked);
update public.profiles
set active_session_id = 'cccccccc-cccc-cccc-cccc-cccccccccc32'
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
values ((select year_id from curriculum), 'Fav Fold Anatomy', 98);
select id into temp t_anatomy
  from public.subjects
  where year_id = (select year_id from curriculum) and name = 'Fav Fold Anatomy'
  order by created_at desc limit 1;
grant select on t_anatomy to authenticated;
select test_helpers.as_user((select id from t_admin));
select public.set_resource_entitlement(
  'practice_subject', (select id from t_anatomy), 'free'
);

select test_helpers.as_runner();
insert into public.books (subject_id, name)
values ((select id from t_anatomy), 'Fav Fold Book');
select id into temp t_book from public.books
  where subject_id = (select id from t_anatomy) order by created_at desc limit 1;
insert into public.chapters (book_id, name)
values ((select id from t_book), 'Fav Fold Ch');
select id into temp t_chapter from public.chapters
  where book_id = (select id from t_book) order by created_at desc limit 1;
insert into public.topics (chapter_id, name)
values ((select id from t_chapter), 'Fav Fold Topic');
select id into temp t_topic from public.topics
  where chapter_id = (select id from t_chapter) order by created_at desc limit 1;

grant select on t_book, t_chapter, t_topic to authenticated;

select test_helpers.make_question((select id from t_topic), 'A') as id into temp t_q_a;
update public.questions set status = 'approved' where id = (select id from t_q_a);
select test_helpers.make_question((select id from t_topic), 'B') as id into temp t_q_b;
update public.questions set status = 'approved' where id = (select id from t_q_b);
select test_helpers.make_question((select id from t_topic), 'C') as id into temp t_q_c;
update public.questions set status = 'approved' where id = (select id from t_q_c);

grant select on t_q_a, t_q_b, t_q_c to authenticated;

create temporary table t_q_a_ver (id uuid);
grant select, insert on t_q_a_ver to authenticated;
insert into t_q_a_ver (id)
select current_version_id from public.questions where id = (select id from t_q_a);

select test_helpers.as_user((select id from t_admin));
create temporary table t_folder_a (id uuid);
create temporary table t_folder_b (id uuid);
grant select, insert on t_folder_a, t_folder_b to authenticated;
insert into t_folder_a (id)
select public.admin_create_mcq_bank_folder((select id from t_block1), 'Fav Folder A');
insert into t_folder_b (id)
select public.admin_create_mcq_bank_folder((select id from t_block1), 'Fav Folder B');

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

-- 1) Zero favorites → empty favorites batch
select test_helpers.as_user((select id from t_paid));
select is(
  (select count(*)::int from public.get_practice_batch(
    'mcq_bank_folder_favorites', (select id from t_folder_a), 50
  )),
  0,
  '1 zero favorites → empty favorites batch'
);

select is(
  (public.get_mcq_bank_folder_practice_progress((select id from t_folder_a))->>'favorites')::int,
  0,
  '2 progress favorites count is 0'
);

-- 3) Favorite MCQ A
select lives_ok(
  format(
    'select public.set_practice_item_marked(''question'', %L::uuid, true)',
    (select id from t_q_a)
  ),
  '3 favorite MCQ A'
);

select ok(
  (
    select marked
    from public.practice_progress
    where student_id = (select id from t_paid)
      and item_kind = 'question'
      and item_id = (select id from t_q_a)
  ),
  '4 marked=true persisted for A'
);

-- 5–6) Favorites practice returns only A
select is(
  (select count(*)::int from public.get_practice_batch(
    'mcq_bank_folder_favorites', (select id from t_folder_a), 50
  )),
  1,
  '5 favorites batch size 1'
);

select is(
  (
    select question_id
    from public.get_practice_batch(
      'mcq_bank_folder_favorites', (select id from t_folder_a), 50
    )
    limit 1
  ),
  (select id from t_q_a),
  '6 favorites batch contains A only'
);

-- 7) Persistence reload via get_practice_progress
select ok(
  exists (
    select 1
    from jsonb_array_elements(
      public.get_practice_progress((select id from t_anatomy))->'items'
    ) x
    where x.value->>'item_id' = (select id::text from t_q_a)
      and (x.value->>'marked')::boolean = true
  ),
  '7 reload via get_practice_progress keeps favorite'
);

-- 8–9) Unfavorite A → empty set
select lives_ok(
  format(
    'select public.set_practice_item_marked(''question'', %L::uuid, false)',
    (select id from t_q_a)
  ),
  '8 unfavorite A'
);

select is(
  (select count(*)::int from public.get_practice_batch(
    'mcq_bank_folder_favorites', (select id from t_folder_a), 50
  )),
  0,
  '9 unfavorite → favorites batch empty'
);

-- 10–11) Favorite + Done independence
select public.set_practice_item_marked('question', (select id from t_q_a), true);
select public.set_practice_item_state('question', (select id from t_q_a), 'done');

select is(
  (
    select state
    from public.practice_progress
    where student_id = (select id from t_paid) and item_id = (select id from t_q_a)
  ),
  'done',
  '10 favorite + done: state remains done'
);
select ok(
  (
    select marked
    from public.practice_progress
    where student_id = (select id from t_paid) and item_id = (select id from t_q_a)
  ),
  '11 favorite + done: marked remains true'
);

-- 12) Unfavorite does not reset Done
select public.set_practice_item_marked('question', (select id from t_q_a), false);
select is(
  (
    select state
    from public.practice_progress
    where student_id = (select id from t_paid) and item_id = (select id from t_q_a)
  ),
  'done',
  '12 unfavorite does not reset Done'
);

-- 13–15) Favorite + Incorrect-compatible (answer history untouched by mark)
select public.set_practice_item_marked('question', (select id from t_q_a), true);
select lives_ok(
  format(
    'select public.submit_practice_answer(%L::uuid, ''A'')',
    (select id from t_q_a_ver)
  ),
  '13 submit practice answer while favorited'
);
select public.set_practice_item_marked('question', (select id from t_q_a), false);
select ok(
  exists (
    select 1 from public.practice_answers
    where student_id = (select id from t_paid)
      and question_version_id = (select id from t_q_a_ver)
  ),
  '14 unfavorite does not delete practice_answers (Incorrect-compatible)'
);
select is(
  (
    select state
    from public.practice_progress
    where student_id = (select id from t_paid) and item_id = (select id from t_q_a)
  ),
  'done',
  '15 Done still true after unfavorite + answer history'
);

-- 16–17) Folder isolation
select public.set_practice_item_marked('question', (select id from t_q_c), true);
select is(
  (select count(*)::int from public.get_practice_batch(
    'mcq_bank_folder_favorites', (select id from t_folder_a), 50
  )),
  0,
  '16 folder isolation: folder B favorite absent from folder A'
);

select ok(
  exists (
    select 1 from public.get_practice_batch(
      'mcq_bank_folder_favorites', (select id from t_folder_b), 50
    ) where question_id = (select id from t_q_c)
  ),
  '17 folder B favorites returns C'
);

-- 18–19) Student isolation (both entitled; favorites are caller-scoped)
select test_helpers.as_user((select id from t_other));
select is(
  (select count(*)::int from public.get_practice_batch(
    'mcq_bank_folder_favorites', (select id from t_folder_b), 50
  )),
  0,
  '18 other student favorites batch omits peer marks'
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

-- 20) Authorization: unauthenticated cannot favorite
select test_helpers.as_runner();
select throws_ok(
  format(
    'select public.set_practice_item_marked(''question'', %L::uuid, true)',
    (select id from t_q_a)
  ),
  'P0001',
  'not_authenticated',
  '20 unauthenticated cannot favorite'
);

-- 21) Authorization: enrolled but unpaid cannot open folder favorites batch
select test_helpers.as_user((select id from t_locked));
select throws_ok(
  format(
    'select * from public.get_practice_batch(''mcq_bank_folder_favorites'', %L::uuid, 5)',
    (select id from t_folder_a)
  ),
  'P0001',
  'practice_access_denied',
  '21 unpaid without product access denied on favorites batch'
);

select * from finish();
rollback;
