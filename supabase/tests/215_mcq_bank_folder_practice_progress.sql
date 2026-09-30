-- MCQ Bank folder practice_progress hydration:
-- batch returns questions.subject_id; Done/Marked survive re-fetch;
-- product-subject get_practice_progress must not be required for folder hydration;
-- cross-student isolation; departmental practice subject path unchanged.
begin;
select plan(12);

select test_helpers.as_runner();
select * into temp curriculum from test_helpers.make_curriculum();
select test_helpers.make_student((select year_id from curriculum), 'MCQ Prog Paid') as id
  into temp t_paid;
select test_helpers.make_student((select year_id from curriculum), 'MCQ Prog Other') as id
  into temp t_other;
select test_helpers.make_admin('MCQ Prog Admin') as id into temp t_admin;

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
set active_session_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa21'
where id = (select id from t_paid);
update public.profiles
set active_session_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb21'
where id = (select id from t_other);
update public.profiles
set active_session_id = 'cccccccc-cccc-cccc-cccc-cccccccccc21'
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

grant select on curriculum, t_paid, t_other, t_admin, t_plan, t_block1
  to authenticated;

-- Product subject paid; departmental subject free (folder access ≠ dept entitlement)
select test_helpers.as_user((select id from t_admin));
select public.set_resource_entitlement(
  'practice_subject', (select id from t_block1), 'any_subscription'
);

select test_helpers.as_runner();
insert into public.subjects (year_id, name, sort_order)
values ((select year_id from curriculum), 'MCQ Prog Anatomy', 96);
select id into temp t_anatomy
  from public.subjects
  where year_id = (select year_id from curriculum) and name = 'MCQ Prog Anatomy'
  order by created_at desc limit 1;
grant select on t_anatomy to authenticated;
-- new subjects default free; keep departmental free for catalog visibility
select test_helpers.as_user((select id from t_admin));
select public.set_resource_entitlement(
  'practice_subject', (select id from t_anatomy), 'free'
);

select test_helpers.as_runner();
insert into public.books (subject_id, name)
values ((select id from t_anatomy), 'MCQ Prog Book');
select id into temp t_book from public.books
  where subject_id = (select id from t_anatomy) order by created_at desc limit 1;
insert into public.chapters (book_id, name)
values ((select id from t_book), 'MCQ Prog Ch');
select id into temp t_chapter from public.chapters
  where book_id = (select id from t_book) order by created_at desc limit 1;
insert into public.topics (chapter_id, name)
values ((select id from t_chapter), 'MCQ Prog Topic');
select id into temp t_topic from public.topics
  where chapter_id = (select id from t_chapter) order by created_at desc limit 1;

select test_helpers.make_question((select id from t_topic), 'A') as id into temp t_q1;
update public.questions set status = 'approved' where id = (select id from t_q1);

select id into temp t_folder
  from public.mcq_bank_folders
  where academic_product_subject_id = (select id from t_block1)
    and deleted_at is null
  order by sort_order, name
  limit 1;

grant select on t_book, t_chapter, t_topic, t_q1, t_folder to authenticated;

select test_helpers.as_user((select id from t_admin));
create temporary table t_sf (id uuid);
grant select, insert on t_sf to authenticated;
insert into t_sf (id)
select public.admin_create_mcq_bank_subfolder((select id from t_folder), '215 Prog Sub');
select public.admin_assign_unassigned_question_to_subfolder(
  (select id from t_q1), (select id from t_sf)
);

-- Paid student: folder batch returns departmental subject_id
select test_helpers.as_user((select id from t_paid));
select is(
  (
    select subject_id
    from public.get_practice_batch(
      'mcq_bank_folder', (select id from t_folder), 10
    )
    where question_id = (select id from t_q1)
    limit 1
  ),
  (select id from t_anatomy),
  '1 batch subject_id is questions.subject_id (departmental)'
);

select lives_ok(
  format(
    'select public.set_practice_item_state(''question'', %L::uuid, ''done'')',
    (select id from t_q1)
  ),
  '2 set done via folder access (dept may be free; product entitled)'
);
select lives_ok(
  format(
    'select public.set_practice_item_marked(''question'', %L::uuid, true)',
    (select id from t_q1)
  ),
  '3 set marked'
);

select is(
  (
    select subject_id
    from public.practice_progress
    where student_id = (select id from t_paid)
      and item_kind = 'question'
      and item_id = (select id from t_q1)
  ),
  (select id from t_anatomy),
  '4 stored practice_progress.subject_id is departmental'
);

-- Re-fetch as get_practice_progress(departmental) — survives "reload"
select ok(
  exists (
    select 1
    from jsonb_array_elements(
      public.get_practice_progress((select id from t_anatomy))->'items'
    ) x
    where x.value->>'item_id' = (select id::text from t_q1)
      and x.value->>'state' = 'done'
      and (x.value->>'marked')::boolean = true
  ),
  '5 re-fetch via departmental subject keeps Done+Marked'
);

-- Product-subject progress query does not carry the row (wrong key)
select ok(
  not exists (
    select 1
    from jsonb_array_elements(
      public.get_practice_progress((select id from t_block1))->'items'
    ) x
    where x.value->>'item_id' = (select id::text from t_q1)
  ),
  '6 product-subject progress does not list folder question row'
);

-- Other student isolation
select test_helpers.as_user((select id from t_other));
select is(
  (
    select count(*)::int
    from public.practice_progress
    where student_id = (select id from t_paid)
  ),
  0,
  '7 other student cannot SELECT peer practice_progress'
);
select ok(
  coalesce(
    (
      select count(*)::int
      from jsonb_array_elements(
        public.get_practice_progress((select id from t_anatomy))->'items'
      ) x
      where x.value->>'item_id' = (select id::text from t_q1)
    ),
    0
  ) = 0,
  '8 other student get_practice_progress omits peer items'
);

-- Departmental practice path unchanged: subject-scope batch still returns subject_id
select test_helpers.as_user((select id from t_admin));
select public.set_resource_entitlement(
  'practice_subject', (select id from t_anatomy), 'free'
);
select test_helpers.as_user((select id from t_paid));
select is(
  (
    select subject_id
    from public.get_practice_batch('subject', (select id from t_anatomy), 10)
    where question_id = (select id from t_q1)
    limit 1
  ),
  (select id from t_anatomy),
  '9 subject-scope batch still returns departmental subject_id'
);

select is(
  (
    select state
    from public.practice_progress
    where student_id = (select id from t_paid)
      and item_id = (select id from t_q1)
  ),
  'done',
  '10 same progress row shared with departmental practice'
);

-- Folder write denied without product access
select test_helpers.as_user((select id from t_admin));
select public.set_resource_entitlement(
  'practice_subject', (select id from t_block1), 'plan', (select id from t_plan)
);
select public.set_resource_entitlement(
  'practice_subject', (select id from t_anatomy), 'plan', (select id from t_plan)
);

select test_helpers.as_runner();
select test_helpers.make_student((select year_id from curriculum), 'MCQ Prog Free') as id
  into temp t_free;
update public.profiles
set active_session_id = 'dddddddd-dddd-dddd-dddd-dddddddddd21'
where id = (select id from t_free);
grant select on t_free to authenticated;

select test_helpers.as_user((select id from t_free));
select throws_ok(
  format(
    'select public.set_practice_item_state(''question'', %L::uuid, ''done'')',
    (select id from t_q1)
  ),
  'P0001',
  'practice_access_denied',
  '11 unentitled student cannot set folder question progress'
);

-- Restore free dept + any_subscription product for cleanup assertion
select test_helpers.as_user((select id from t_admin));
select public.set_resource_entitlement(
  'practice_subject', (select id from t_anatomy), 'free'
);
select public.set_resource_entitlement(
  'practice_subject', (select id from t_block1), 'any_subscription'
);

select test_helpers.as_user((select id from t_paid));
select lives_ok(
  format(
    'select public.reset_practice_done_to_remaining(%L::uuid)',
    (select id from t_anatomy)
  ),
  '12 reset via departmental subject still works'
);

select * from finish();
rollback;
